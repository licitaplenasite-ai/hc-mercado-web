// Leitura dos avisos publicados em diário oficial (Diário AAM, DOM Manaus, DOE-AM): classificação pelo título,
// extração dos campos por regras e, só quando a regra não resolve, IA barata (Gemini) com saída JSON validada.
// Quem usa: scripts/coletar_diarios_am.js. Os adaptadores de cada diário só trazem o texto de cada publicação.
//
// Por que regra primeiro: aviso de diário segue fórmula fixa ("Objeto: ...", "Data e horário da sessão: ...").
// Medido em 25/11/2026 nas edições de 18 a 24/11: a regra acha objeto e data na maioria; a IA fica para o resto.

const { limparEspacos } = require("./comum");

// 62 municípios do Amazonas (IBGE). Serve para achar o município no nome da entidade e no texto.
const MUNICIPIOS_AM = [
  "Alvarães", "Amaturá", "Anamã", "Anori", "Apuí", "Atalaia do Norte", "Autazes", "Barcelos", "Barreirinha",
  "Benjamin Constant", "Beruri", "Boa Vista do Ramos", "Boca do Acre", "Borba", "Caapiranga", "Canutama", "Carauari",
  "Careiro", "Careiro da Várzea", "Coari", "Codajás", "Eirunepé", "Envira", "Fonte Boa", "Guajará", "Humaitá",
  "Ipixuna", "Iranduba", "Itacoatiara", "Itamarati", "Itapiranga", "Japurá", "Juruá", "Jutaí", "Lábrea", "Manacapuru",
  "Manaquiri", "Manaus", "Manicoré", "Maraã", "Maués", "Nhamundá", "Nova Olinda do Norte", "Novo Airão",
  "Novo Aripuanã", "Parintins", "Pauini", "Presidente Figueiredo", "Rio Preto da Eva", "Santa Isabel do Rio Negro",
  "Santo Antônio do Içá", "São Gabriel da Cachoeira", "São Paulo de Olivença", "São Sebastião do Uatumã", "Silves",
  "Tabatinga", "Tapauá", "Tefé", "Tonantins", "Uarini", "Urucará", "Urucurituba",
];

const { mascararCpf } = require("./comum");

const TIPOS_OPORTUNIDADE = new Set(["aviso", "dispensa", "cotacao", "chamamento", "credenciamento"]);
// Chamamento de fomento cultural (prêmio/bolsa da PNAB, seleção de projeto) é para artista e coletivo, e parceria com
// OSC (MROSC, Lei 13.019: termo de colaboração/fomento) é para entidade sem fins lucrativos: nenhum é para fornecedor.
const FOMENTO = /aldir\s+blanc|\bpnab\b|premia[cç]|sele[cç][aã]o\s+de\s+projetos|fomento\s+[aà]\s+cultura|cultura\s+viva|concess[aã]o\s+de\s+bolsas|organiza[cç][oõ]es\s+da\s+sociedade\s+civil|\bosc\b|13\.019|termo\s+de\s+(?:colabora|fomento)|sem\s+fins\s+lucrativos/i;
const ehFomento = (tipo, texto) => tipo === "chamamento" && FOMENTO.test(String(texto ?? "").slice(0, 2500));
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MAX_TEXTO_IA = 6000;

// Sem acento e minúsculo: os diários escrevem "LICITAÇÃO", "Licitacao" e "LICITAǇAO" para a mesma coisa.
const normalizar = (txt) => String(txt ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ENTIDADES = { nbsp: " ", amp: "&", quot: '"', lt: "<", gt: ">", ordm: "º", ordf: "ª", deg: "°", ndash: "–", mdash: "—", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", sect: "§" };
function decodificarEntidades(txt) {
  return String(txt ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, nome) => {
      if (ENTIDADES[nome]) return ENTIDADES[nome];
      // &aacute; &Ccedil; &otilde; ... -> letra base + acento combinado.
      const a = /^([a-z])(acute|grave|circ|tilde|cedil|uml)$/i.exec(nome);
      const marca = a && { acute: "́", grave: "̀", circ: "̂", tilde: "̃", cedil: "̧", uml: "̈" }[a[2]];
      return marca ? (a[1] + marca).normalize("NFC") : m;
    });
}

// HTML de matéria -> texto corrido, mantendo quebra entre parágrafos (ajuda a cortar o objeto).
function textoDoHtml(html) {
  const semCodigo = String(html ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  const comQuebras = semCodigo.replace(/<\/(p|div|li|tr|h\d)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  return decodificarEntidades(comQuebras).split("\n").map(limparEspacos).filter(Boolean).join("\n");
}

// "Ã‡Ãƒ" (UTF-8 lido como Latin-1, visto no sumário do DOE-AM) -> "ÇÃ". Texto já correto passa intacto.
function corrigirMojibake(txt) {
  if (!/[ÃÂ][\u0080-¿]|â\u0080/.test(txt)) return txt;
  const convertido = Buffer.from(txt, "latin1").toString("utf8");
  return convertido.includes("�") ? txt : convertido;
}

function municipioNoTexto(txt) {
  const n = ` ${normalizar(txt).replace(/[^a-z0-9]+/g, " ")} `;
  let melhor = null;
  for (const nome of MUNICIPIOS_AM) {
    const alvo = ` ${normalizar(nome)} `;
    if (n.includes(alvo) && (!melhor || nome.length > melhor.length)) melhor = nome;
  }
  return melhor;
}

// Tipo da publicação pelo título (e pelo começo do texto quando o título é genérico).
// A ordem importa: "AVISO DE RESULTADO" é resultado; "EXTRATO DE DISPENSA" é resultado; "AVISO DE DISPENSA" é oportunidade.
function classificar(titulo, inicioTexto = "") {
  const n = normalizar(`${titulo} ${String(inicioTexto).slice(0, 300)}`);
  const t = normalizar(titulo);
  if (/edital de (notificacao|convocacao|intimacao|citacao|cadastramento|processo)|concurso publico|seletivo|selecao publica|leilao de bens|eleicao|conselheir|mesa diretora|processo de escolha|estagi|bolsista|vestibular|compromisso cultural|justificativa/.test(t)) return null;
  // Portaria/decreto que "DISPENSA" servidor da função ou nomeia comissão não é aviso de compra.
  if (/^\s*(portaria|decreto|resolucao|lei\b|lei complementar|instrucao normativa|termos? de compromisso)/.test(t)) return null;
  if (/homologa|adjudica|resultado|ratifica|extrato|aditivo|ata de registro|ata da sessao|revoga|anula|desert|fracassad|julgamento|recurso|apostilamento|rescis|distrato|contrato n/.test(t)) return "resultado";
  if (/errata|retifica|alteracao|aviso de altera/.test(t)) return "retificacao";
  if (/suspens|adiamento|adiad|cancelament/.test(t)) return "suspensao";
  if (/inexigib/.test(t)) return "inexigibilidade";
  if (/dispensa|compra direta|contratacao direta/.test(t)) return "dispensa";
  if (/cotacao/.test(t)) return "cotacao";
  if (/chamamento/.test(t)) return "chamamento";
  if (/credenciamento/.test(t)) return "credenciamento";
  if (/aviso de licitacao|aviso de edital|aviso de pregao|pregao|concorrencia|tomada de precos|\bleilao\b|\bconvite\b|dialogo competitivo|\blicitacao\b/.test(t)) return "aviso";
  // "EDITAL 001/2026" sozinho só é aviso de compra se o texto falar de licitação logo no começo.
  if (/\bedital\b/.test(t)) return /licitacao|pregao|concorrencia|tomada de precos|cotacao|dispensa/.test(n) ? "aviso" : null;
  // Título genérico ("#296085 - AVISO") com o tipo só no começo do texto.
  if (/aviso de licitacao|torna publico que realizara|preg[a]o eletronico n|concorrencia eletronica n/.test(n)) return "aviso";
  return null;
}

const MODALIDADE_NUMERO = /(preg[aã]o(?:\s+(?:eletr[oô]nico|presencial))?|concorr[eê]ncia(?:\s+(?:eletr[oô]nica|p[uú]blica|presencial))?|tomada\s+de\s+pre[cç]os|dispensa(?:\s+(?:eletr[oô]nica|de\s+licita[cç][aã]o))?|chamamento\s+p[uú]blico|credenciamento|leil[aã]o|convite|cota[cç][aã]o(?:\s+eletr[oô]nica)?|di[aá]logo\s+competitivo|inexigibilidade(?:\s+de\s+licita[cç][aã]o)?|compra\s+direta)\s*(?:(?:srp|com\s+registro\s+de\s+pre[cç]os?|para\s+registro\s+de\s+pre[cç]os?|eletr[oô]nic[oa]|presencial|emergencial|[-–])\s*)*(?:n\s*\.?\s*[º°o]?|n[º°o]\s*\.?|nº)?\s*:?\s*(\d{1,5})\s*[/\-.]\s*(\d{4}|\d{2})\b/i;

// Siglas das resenhas do CSC no DOE-AM ("1.1) CE n ° 035/2026-CSC: ...", "PE n° 501/2026").
const SIGLA_NUMERO = /(?:^|[\s(])(PE|CE|PP|CP|CC|DE|DL|TP)\s*[nN]?\s*[°º.]?\s*(\d{1,5})\s*\/\s*(\d{4})\b/;
const SIGLAS = { PE: "Pregão - Eletrônico", CE: "Concorrência - Eletrônica", PP: "Pregão - Presencial", CP: "Concorrência - Presencial", CC: "Concorrência - Presencial", DE: "Dispensa", DL: "Dispensa", TP: "Tomada de preços" };

// Nome no padrão do PNCP ("Pregão - Eletrônico") para o cartão e para comparar com o PNCP.
function nomeModalidade(bruto) {
  const n = normalizar(bruto);
  const eletronico = /eletronic/.test(n);
  if (n.startsWith("pregao")) return /presencial/.test(n) ? "Pregão - Presencial" : "Pregão - Eletrônico";
  if (n.startsWith("concorrencia")) return eletronico ? "Concorrência - Eletrônica" : "Concorrência - Presencial";
  if (n.startsWith("tomada")) return "Tomada de preços";
  if (n.startsWith("dispensa") || n.startsWith("compra direta")) return "Dispensa";
  if (n.startsWith("chamamento")) return "Chamamento público";
  if (n.startsWith("credenciamento")) return "Credenciamento";
  if (n.startsWith("leilao")) return "Leilão";
  if (n.startsWith("convite")) return "Convite";
  if (n.startsWith("cotacao")) return "Cotação eletrônica";
  if (n.startsWith("dialogo")) return "Diálogo competitivo";
  if (n.startsWith("inexigibilidade")) return "Inexigibilidade";
  return null;
}

function modalidadeNumero(...textos) {
  for (const txt of textos) {
    const m = MODALIDADE_NUMERO.exec(String(txt ?? ""));
    if (!m) continue;
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (ano < 2000 || ano > 2100) continue;
    return { modalidade: nomeModalidade(m[1]), numero: String(Number(m[2])).padStart(3, "0"), ano };
  }
  for (const txt of textos) {
    const m = SIGLA_NUMERO.exec(String(txt ?? ""));
    if (m && Number(m[3]) >= 2000 && Number(m[3]) <= 2100) return { modalidade: SIGLAS[m[1]], numero: String(Number(m[2])).padStart(3, "0"), ano: Number(m[3]) };
  }
  return { modalidade: null, numero: null, ano: null };
}

const PARADA_OBJETO = /(?:[.;]\s+|\n|,\s*(?=(?:tipo|crit[eé]rio|conforme|consoante|com\s+crit[eé]rio|modo\s+de|em\s+atendimento)\b))(?=(?:data|abertura|sess[aã]o|local|o\s+edital|edital|valor|prazo|informa[cç]|realiza[cç]|retirada|os\s+interessados|tipo|crit[eé]rio|modo\s+de|in[ií]cio|recebimento|endere[cç]o|fundamento|dota[cç]|vig[eê]ncia|justificativa|motivo|conforme|consoante|com\s+crit|em\s+atendimento|hora|as\s+especifica|a\s+cota[cç]|solicita|o\s+detalhamento|publicad[oa]\s+por|c[oó]digo\s+identificador|\d+\.)\b|[A-Z][a-zçãéõ]+\s*:)/i;
// "Objeto:", "OBJETO DA CONTRATAÇÃO DIRETA:", "deseja cotar o seguinte objeto:".
const OBJETO_ROTULO = /\bobjeto(?:\s+d[aoe]s?\s+[a-zçãâéêíóôõú ]{3,30}?)?\s*[:\-–]\s*/gi;
// "cujo objeto contempla a ...", "O objeto deste procedimento é a ...".
const OBJETO_FRASE = /(?:cujo\s+objeto|o\s+objeto\s+(?:deste|desta|do\s+presente|da\s+presente)\s+[a-zçã ]{3,30}?)\s+(?:[ée]|ser[aá]|contempla|consiste\s+(?:em|na|no))\s+/gi;
// Sem rótulo: primeiro "aquisição de / contratação de ..." depois de "torna público".
const OBJETO_VERBO = /["“_]?\s*(?<!comiss[aã]o\s+(?:\S+\s+){0,2})((?:eventual\s+)?(?:aquisi[cç][aã]o|contrata[cç][aã]o|presta[cç][aã]o\s+de\s+servi|execu[cç][aã]o\s+de|registro\s+de\s+pre[cç]os?\s+para|fornecimento\s+de|loca[cç][aã]o\s+de|forma[cç][aã]o\s+de\s+registro)(?!\s+direta)(?!\s+(?:da|do)\s+(?:prefeitura|munic|secretaria|comiss|c[aâ]mara)))/i;
// Cópia do rótulo sem ser o objeto da compra ("compatível com o objeto: comprovante de inscrição...").
const NAO_E_OBJETO = /^(comprovante|certid|ato\s+constitutivo|documento|declara|prova\s+de|registro\s+comercial|c[eé]dula|contrato\s+social|da\s+justificativa)/i;

function cortarObjeto(resto) {
  const parada = PARADA_OBJETO.exec(resto);
  const objeto = limparEspacos((parada ? resto.slice(0, parada.index) : resto).slice(0, 700)).replace(/^[\s"“”'_–-]+|[\s"“”'.;,:_–-]+$/g, "").replace(/^(?:a|o)\s+(?=\S)/i, "");
  return objeto.length >= 10 && !NAO_E_OBJETO.test(objeto) ? objeto : null;
}

function extrairObjeto(texto) {
  const t = String(texto ?? "");
  for (const re of [OBJETO_ROTULO, OBJETO_FRASE]) {
    for (let m, r = new RegExp(re.source, "gi"); (m = r.exec(t));) {
      const objeto = cortarObjeto(t.slice(m.index + m[0].length));
      if (objeto) return objeto;
    }
  }
  const inicio = /torna[\s-]+(?:se\s+)?p[uú]blic[oa]|torna\s*[-–]\s*se\s+p[uú]blico/i.exec(t);
  const corpo = inicio ? t.slice(inicio.index) : t;
  const v = OBJETO_VERBO.exec(corpo);
  return v ? cortarObjeto(corpo.slice(v.index)) : null;
}

// Datas no texto, na ordem em que aparecem: "09/12/2026", "9.12.26", "09 de dezembro de 2026". Com hora quando vem logo depois.
function datasNoTexto(texto) {
  const saida = [];
  const re = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b|(\d{1,2})º?\s+de\s+([a-zç]+)\s+de\s+(\d{4})/gi;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const dia = Number(m[1] || m[4]);
    const mes = m[2] ? Number(m[2]) : MESES.indexOf(normalizar(m[5])) + 1;
    const ano = Number(m[3] || m[6]) < 100 ? 2000 + Number(m[3]) : Number(m[3] || m[6]);
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    if (!mes || d.getUTCDate() !== dia || d.getUTCMonth() !== mes - 1) continue;
    const depois = texto.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const h = /^[^\d]{0,15}?(\d{1,2})\s*(?:h|:)\s*:?\s*(\d{2})?/i.exec(depois);
    const hora = h && Number(h[1]) < 24 && Number(h[2] || 0) < 60 ? `${String(h[1]).padStart(2, "0")}:${String(h[2] || "00").padStart(2, "0")}` : null;
    saida.push({ indice: m.index, dia: d.toISOString().slice(0, 10), hora });
  }
  return saida;
}

const GATILHO_ABERTURA = /abertura|sess[aã]o\s+p[uú]blica|in[ií]cio\s+da\s+(?:disputa|sess[aã]o)|data\s+(?:e\s+hor[aá]rio|da\s+(?:disputa|sess[aã]o|abertura|licita[cç][aã]o|realiza[cç][aã]o))|data\/hora|ser[aá]\s+realizad[ao]|realizar-se-[aá]|recebimento\s+d[ae]s?\s+propostas|envio\s+d[ae]s?\s+propostas|entrega\s+d[ae]s?\s+propostas|data\s*:/i;

// Abertura da disputa: a data MAIS TARDIA perto de um gatilho ("sessão pública", "limite para propostas"...). O aviso
// costuma trazer início do prazo, limite e sessão nessa ordem; a sessão (ou o limite, na dispensa) é a última.
// Sem gatilho, a primeira data posterior à publicação (assinatura e lei citada são sempre anteriores).
function extrairAbertura(texto, publicacaoIso) {
  const datas = datasNoTexto(texto);
  const pub = String(publicacaoIso || "").slice(0, 10);
  const valida = (d) => (!pub || (d.dia >= pub && Date.parse(d.dia) - Date.parse(pub) <= 365 * 86400000));
  const comHora = (d) => (d ? `${d.dia}T${d.hora || "00:00"}:00` : null);
  const perto = new Set();
  for (let g, re = new RegExp(GATILHO_ABERTURA.source, "gi"); (g = re.exec(texto));) {
    for (const d of datas) if (d.indice > g.index && d.indice - g.index < 160 && valida(d)) perto.add(d);
  }
  if (perto.size) {
    const ultima = [...perto].sort((a, b) => `${b.dia}${b.hora || ""}`.localeCompare(`${a.dia}${a.hora || ""}`))[0];
    return { abertura: comHora(ultima), porGatilho: true };
  }
  const primeira = datas.find((d) => valida(d) && d.dia > pub);
  return { abertura: comHora(primeira), porGatilho: false };
}

function extrairValor(texto) {
  const m = /valor\s+(?:total\s+|global\s+|m[aá]ximo\s+|estimado\s+|de\s+refer[eê]ncia\s+|da\s+contrata[cç][aã]o\s+)*[^R\n]{0,40}?R\$\s*([\d.]{1,15},\d{2})/i.exec(texto);
  if (!m) return null;
  const valor = Number(m[1].replace(/\./g, "").replace(",", "."));
  return valor > 0 && valor < 1e11 ? valor : null;
}

const PORTAIS_DISPUTA = /licitanet|bll(?:compras)?\.|portaldecompraspublicas|comprasnet|compras\.gov|gov\.br\/compras|bnc\.org|bnccompras|licitardigital|comprasbr|bbmnet|licitacoes-e|e-compras\.am|compras\.manaus|licitacao\.|pregao/i;
const PARECE_EDITAL = /pncp|transparencia|edital|licita|compras/i;

// URLs citadas (sem e-mail). Disputa = portal conhecido; edital = página que parece de edital/transparência.
function extrairLinks(texto) {
  const urls = [];
  const re = /(^|[\s(:"'])((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|gov|org|net|leg|jus)(?:\.br)?(?:\/[^\s,;)"'<>]*)?)/gi;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const bruto = m[2].replace(/[.,;:]+$/, "");
    if (texto[m.index + m[1].length - 1] === "@") continue;
    urls.push(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
  }
  const disputa = urls.find((u) => PORTAIS_DISPUTA.test(u) && !/pncp/i.test(u)) || null;
  const edital = urls.find((u) => PARECE_EDITAL.test(u) && u !== disputa) || disputa;
  return { urlDisputa: disputa, linkEdital: edital };
}

// Regras sobre uma publicação. confianca: alta = objeto + abertura + número; media = objeto e mais um; baixa = resto.
function extrairPorRegras({ titulo, texto, publicacao, contexto }) {
  const tipo = classificar(titulo, texto);
  const mn = modalidadeNumero(titulo, texto);
  const objeto = extrairObjeto(texto);
  // Resenha com vários avisos: a data pode vir depois do último item do grupo (contexto).
  const { abertura } = extrairAbertura(texto, publicacao).abertura ? extrairAbertura(texto, publicacao) : extrairAbertura(contexto || "", publicacao);
  const campos = { tipo, ...mn, objeto, abertura, valorEstimado: extrairValor(texto), ...extrairLinks(texto) };
  return { ...campos, confianca: avaliarConfianca(campos) };
}

function avaliarConfianca({ objeto, abertura, numero }) {
  if (objeto && abertura && numero) return "alta";
  if (objeto && (abertura || numero)) return "media";
  return "baixa";
}

// ---------- IA (Gemini) só para o que a regra não resolveu ----------

const ESQUEMA_IA = {
  type: "object",
  properties: {
    ehOportunidade: { type: "boolean", description: "true se o texto convida fornecedores a disputar ou cotar (aviso de licitação, dispensa com prazo para propostas, chamamento, credenciamento)" },
    orgao: { type: "string" },
    municipio: { type: "string" },
    modalidade: { type: "string" },
    numero: { type: "string", description: "só o número, sem o ano" },
    ano: { type: "integer" },
    objeto: { type: "string", description: "o objeto como está no texto, sem inventar" },
    abertura: { type: "string", description: "data e hora da sessão/abertura/limite de propostas no formato AAAA-MM-DDTHH:MM, ou vazio" },
    localDisputa: { type: "string", description: "site ou endereço onde ocorre a disputa, como está no texto, ou vazio" },
    valorEstimado: { type: "number", description: "valor estimado em reais, ou 0 se o texto não diz" },
    linkEdital: { type: "string", description: "URL do edital citada no texto, ou vazio" },
  },
  required: ["ehOportunidade", "objeto", "abertura"],
};

const INSTRUCAO_IA = "Você lê UMA publicação de diário oficial brasileiro e extrai os dados do aviso de licitação. "
  + "Copie os dados do texto; nunca invente. Campo ausente no texto: string vazia (ou 0 no valor). Responda só o JSON.";

const textoIa = (v, max = 700) => (typeof v === "string" ? limparEspacos(v).slice(0, max) : "");

// Objeto precisa ter pelo menos metade das palavras longas presentes no texto: barra resumo inventado.
function objetoConferido(objeto, fonte) {
  const palavras = normalizar(objeto).split(/[^a-z0-9]+/).filter((p) => p.length > 4);
  return objeto.length >= 10 && palavras.length && palavras.filter((p) => fonte.includes(p)).length / palavras.length >= 0.5 ? objeto : null;
}

// Data da IA só vale entre a véspera da publicação e um ano depois.
function aberturaConferida(bruto, publicacaoIso) {
  const ab = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(bruto);
  if (!ab) return null;
  const dias = (Date.parse(ab[1]) - Date.parse(String(publicacaoIso || ab[1]).slice(0, 10))) / 86400000;
  return dias >= -1 && dias <= 365 ? `${ab[1]}T${ab[2] || "00:00"}:00` : null;
}

// O número tem de aparecer como "número/ano" no texto; "12" de "10/12/2026" não conta.
function numeroConferido(bruto, fonte) {
  const m = /^\d{1,5}$/.exec(bruto.replace(/\D+$/, "").split("/")[0]);
  if (!m || !new RegExp(String.raw`(?<![\d/.])0*${Number(m[0])}\s*[/-]\s*(?:\d{4}|\d{2})\b`).test(fonte)) return null;
  return String(Number(m[0])).padStart(3, "0");
}

// Link só se o domínio está escrito no texto do diário.
function linkConferido(link, fonte) {
  if (!/^(https?:\/\/|www\.)[^\s]+$/i.test(link)) return null;
  if (!fonte.includes(normalizar(link.replace(/^https?:\/\//i, "").replace(/^www\./i, "")).split("/")[0])) return null;
  return /^https?:/i.test(link) ? link : `https://${link}`;
}

// Saída da IA -> só campos que passam na conferência; o que não está no texto fonte é descartado (anti-invenção).
function validarSaidaIa(saida, texto, publicacaoIso) {
  if (!saida || typeof saida !== "object") return null;
  const fonte = normalizar(texto);
  const valor = typeof saida.valorEstimado === "number" && saida.valorEstimado > 0 && saida.valorEstimado < 1e11 ? saida.valorEstimado : null;
  const campos = {
    ehOportunidade: saida.ehOportunidade === true,
    objeto: objetoConferido(textoIa(saida.objeto), fonte),
    abertura: aberturaConferida(textoIa(saida.abertura, 20), publicacaoIso),
    numero: numeroConferido(textoIa(saida.numero, 10), fonte),
    ano: Number.isInteger(saida.ano) && saida.ano >= 2000 && saida.ano <= 2100 ? saida.ano : null,
    modalidade: nomeModalidade(textoIa(saida.modalidade, 60)),
    valorEstimado: valor,
    linkEdital: linkConferido(textoIa(saida.linkEdital, 300), fonte),
    localDisputa: textoIa(saida.localDisputa, 200) || null,
    orgao: textoIa(saida.orgao, 200) || null,
    municipio: textoIa(saida.municipio, 200) || null,
  };
  // Campo reprovado some (undefined), para quem completa não confundir com "a IA disse vazio".
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null && v !== ""));
}

// Uma chamada ao Gemini. Modelo do projeto (mesmo de scripts/gerar_dossies_gemini.js); 429/5xx -> próximo modelo.
async function chamarIa({ texto, publicacao, apiKey, modelos, fetchImpl = fetch }) {
  const corpo = {
    systemInstruction: { parts: [{ text: INSTRUCAO_IA }] },
    contents: [{ role: "user", parts: [{ text: `Data da publicação: ${publicacao || "desconhecida"}\nTEXTO:\n${mascararCpf(String(texto).slice(0, MAX_TEXTO_IA))}` }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: ESQUEMA_IA, maxOutputTokens: 1024, temperature: 0 },
  };
  for (const modelo of modelos) {
    let resp;
    try {
      resp = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(corpo),
        signal: globalThis.AbortSignal.timeout(60000),
      });
    } catch (e) {
      console.log(`[diarios] IA ${modelo} sem resposta (${e.name}).`);
      continue;
    }
    if (resp.status === 404 || resp.status === 429 || resp.status >= 500) { console.log(`[diarios] IA ${modelo}: HTTP ${resp.status}.`); continue; }
    if (!resp.ok) throw new Error(`gemini_http_${resp.status}`);
    const dados = await resp.json();
    const parte = (dados.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    try {
      return { saida: JSON.parse(parte), uso: dados.usageMetadata || null, modelo };
    } catch {
      return { saida: null, uso: dados.usageMetadata || null, modelo };
    }
  }
  return null;
}

// ---------- Uma matéria com vários avisos ("torna público os seguintes procedimentos", resenha do CSC) ----------

const MARCA_ITEM = /(?:^|\n)[ \t]*(?:\d+(?:\.\d+)*\)\s*)?((?:PE|CE|PP|CP|CC|DE|DL)\s*n?\s*[°º.]?\s*(\d{1,5})\s*\/\s*(\d{4})|(?:PREG[AÃ]O|CONCORR[EÊ]NCIA|DISPENSA|TOMADA\s+DE\s+PRE[CÇ]OS)[^\n]{0,45}?n\s*[º°o.]?\s*(\d{1,5})\s*\/\s*(\d{4}))/gi;
const TAMANHO_CONTEXTO = 3000;

// texto -> [{ titulo, texto, contexto }]. Um só número de processo (repetido no título e no corpo): o texto inteiro.
function dividirAvisos(texto) {
  const t = String(texto ?? "");
  const marcas = [];
  for (let m, re = new RegExp(MARCA_ITEM.source, "gi"); (m = re.exec(t));) {
    const numero = `${Number(m[2] || m[4])}/${m[3] || m[5]}`;
    const inicio = m.index + (t[m.index] === "\n" ? 1 : 0);
    marcas.push({ numero, inicio, titulo: limparEspacos(m[1]) });
  }
  // Mesmo número que reaparece adiante (título repetido no corpo) não abre outro item.
  const unicas = marcas.filter((m, i) => marcas.findIndex((o) => o.numero === m.numero) === i);
  if (unicas.length < 2) return [{ titulo: null, texto: t, contexto: null }];
  return unicas.map((m, i) => ({
    titulo: m.titulo,
    texto: t.slice(m.inicio, unicas[i + 1] ? unicas[i + 1].inicio : undefined),
    contexto: t.slice(m.inicio, m.inicio + TAMANHO_CONTEXTO),
  }));
}

// ---------- Segmentação de PDF (DOM Manaus): um diário inteiro -> um bloco por publicação de compra ----------

// Linha que abre uma publicação de compra ("AVISO DE LICITAÇÃO", "(*) EDITAL DE CHAMAMENTO PÚBLICO Nº 007/2026").
const INICIO_PUBLICACAO = /^\s*(?:\(\*\)\s*)?(AVISO\s+DE\s+[A-ZÇÃÉÊÍÓÔÕÚ ]{3,40}|EDITAL\s+D[EO]\s+[A-ZÇÃÉÊÍÓÔÕÚ ]{3,40}|EXTRATO\s+D[EOA]S?\s+[A-ZÇÃÉÊÍÓÔÕÚ ]{3,40}|TERMO\s+DE\s+(?:HOMOLOGA|ADJUDICA|RATIFICA)[A-ZÇÃ]*|RESULTADO\s+D[EOA]\s+[A-ZÇÃÉÊÍÓÔÕÚ ]{3,40}|PREG[AÃ]O\s+(?:ELETR[OÔ]NICO|PRESENCIAL)\s+N|CONCORR[EÊ]NCIA\s+(?:ELETR[OÔ]NICA|P[UÚ]BLICA)?\s*N)/;
// Qualquer cabeçalho de ato (fim do bloco anterior).
const INICIO_ATO = /^\s*(?:\(\*\)\s*)?(?:PORTARIA|DECRETO|LEI\s+N|RESOLU[CÇ][AÃ]O|AVISO|EDITAL|EXTRATO|TERMO\s+DE|RESULTADO|ATA\s+D|DESPACHO|INSTRU[CÇ][AÃ]O\s+NORMATIVA|ERRATA|PREG[AÃ]O|CONCORR[EÊ]NCIA)\b/;
// Cabeçalho de órgão do DOM Manaus, procurado para trás a partir do aviso.
const CABECALHO_ORGAO = /^\s*((?:SECRETARIA|SUBSECRETARIA|CENTRO\s+MUNICIPAL|FUNDO\s+MUNICIPAL|SUPERINTEND[EÊ]NCIA|CONSELHO\s+MUNICIPAL|FUNDA[CÇ][AÃ]O|INSTITUTO|AG[EÊ]NCIA|EMPRESA|COMISS[AÃ]O\s+MUNICIPAL|CASA\s+(?:CIVIL|MILITAR)|PROCURADORIA|CONTROLADORIA|GABINETE|MANAUS\w*|UNIDADE\s+GESTORA|SERVI[CÇ]O\s+AUT[OÔ]NOMO|C[AÂ]MARA\s+MUNICIPAL)[A-ZÇÃÉÊÍÓÔÕÚÂ ,–\-/()]{4,120})$/;
const MAX_BLOCO = 4000;

// paginas: [{ pagina, texto }]. Devolve [{ titulo, texto, pagina, orgao }] só com blocos de publicação de compra.
function segmentarPaginas(paginas) {
  const linhas = [];
  for (const { pagina, texto } of paginas) for (const linha of String(texto).split("\n")) if (linha.trim()) linhas.push({ pagina, linha: linha.trim() });
  const blocos = [];
  for (let i = 0; i < linhas.length; i++) {
    if (!INICIO_PUBLICACAO.test(linhas[i].linha)) continue;
    // Título em duas linhas ("AVISO DE PROSSEGUIMENTO" / "PREGÃO ELETRÔNICO N. 076/2026"): a 2ª linha não fecha o bloco.
    let fim = i + 1 + (linhas[i + 1] && INICIO_ATO.test(linhas[i + 1].linha) ? 1 : 0);
    let tamanho = 0;
    while (fim < linhas.length && !INICIO_ATO.test(linhas[fim].linha) && tamanho < MAX_BLOCO) { tamanho += linhas[fim].linha.length + 1; fim += 1; }
    // Título pode quebrar em 2 linhas ("AVISO DE LICITAÇÃO" / "PREGÃO ELETRÔNICO Nº 12/2026").
    const titulo = limparEspacos(`${linhas[i].linha} ${linhas[i + 1] ? linhas[i + 1].linha : ""}`).slice(0, 200);
    let orgao = null;
    for (let j = i - 1, lidos = 0; j >= 0 && lidos < 6000 && !orgao; lidos += linhas[j].linha.length, j--) {
      const c = CABECALHO_ORGAO.exec(linhas[j].linha);
      // Nome do órgão quebrado em duas linhas ("FUNDAÇÃO MUNICIPAL DOS" / "DIREITOS DA PESSOA...").
      const seguinte = c && linhas[j + 1] && /^[A-ZÇÃÉÊÍÓÔÕÚÂ ,–\-/()]{3,80}$/.test(linhas[j + 1].linha) && !INICIO_PUBLICACAO.test(linhas[j + 1].linha) ? linhas[j + 1].linha : "";
      if (c) orgao = limparEspacos(`${c[1]} ${seguinte}`);
    }
    blocos.push({ titulo, texto: linhas.slice(i, fim).map((l) => l.linha).filter(Boolean).join("\n"), pagina: linhas[i].pagina, orgao });
    i = fim - 1;
  }
  return blocos;
}

// ---------- Chaves de comparação (dedup com o PNCP e entre diários) ----------

const familia = (modalidade) => {
  const n = normalizar(modalidade);
  return ["pregao", "concorrencia", "credenciamento", "dispensa", "convite", "chamamento", "tomada", "leilao", "cotacao", "inexigibilidade"].find((f) => n.includes(f)) || n;
};
// Quem numera o processo: Câmara e Prefeitura do mesmo município têm numerações próprias; órgão estadual pelo nome.
// Prefeitura, secretaria e fundo municipal caem no mesmo "municipio X" (no PNCP quase tudo vem como "MUNICIPIO DE X").
function localDe({ municipio, orgao, esfera }) {
  // "Secretaria de Estado de Educação e Desporto Escolar- SEDUC" e "SECRETARIA DE ESTADO DE EDUCACAO E DESPORTO ESCOLAR" iguais.
  const semSigla = String(orgao ?? "").replace(/\s*[-–]\s*[A-Za-zÀ-ú-]{2,12}\s*$/, "");
  const o = normalizar(semSigla).split(/[^a-z0-9]+/).filter((p) => p && !["de", "do", "da", "dos", "das", "e"].includes(p)).join(" ");
  const m = normalizar(municipio || municipioNoTexto(orgao) || "").replace(/[^a-z0-9]+/g, " ").trim();
  if (esfera === "E" || !m) return `estado ${o}`;
  return `${o.split(" ").includes("camara") ? "camara" : "municipio"} ${m}`;
}
// Grupo da busca por objeto parecido: o município, ou o Estado inteiro (nome de órgão estadual varia muito).
const grupoDe = (r) => (r.esfera === "E" || !normalizar(r.municipio || municipioNoTexto(r.orgao) || "") ? "estado" : localDe(r));

// forte = local + família + número + ano; media = local + número + ano (modalidade escrita de jeitos diferentes).
function chavesDedup({ municipio, orgao, esfera, modalidade, numero, ano }) {
  if (!numero || !ano) return [];
  const local = localDe({ municipio, orgao, esfera });
  const n = Number(String(numero).split("/")[0]);
  return [`${local}|${familia(modalidade)}|${n}|${Number(ano)}`, `${local}|${n}|${Number(ano)}`];
}

const palavrasObjeto = (objeto) => new Set(normalizar(objeto).split(/[^a-z0-9]+/).filter((p) => p.length > 3));

// Fuzzy: mesmo município, abertura a até 2 dias e objeto parecido (Jaccard das palavras >= 0,5).
function pareceMesmo(a, b) {
  if (grupoDe(a) !== grupoDe(b) || !a.abertura || !b.abertura) return false;
  if (Math.abs(Date.parse(a.abertura.slice(0, 10)) - Date.parse(b.abertura.slice(0, 10))) > 2 * 86400000) return false;
  const pa = palavrasObjeto(a.objeto);
  const pb = palavrasObjeto(b.objeto);
  const comuns = [...pa].filter((p) => pb.has(p)).length;
  return comuns / (pa.size + pb.size - comuns || 1) >= 0.5;
}

module.exports = {
  MUNICIPIOS_AM, TIPOS_OPORTUNIDADE, ESQUEMA_IA, ehFomento,
  normalizar, textoDoHtml, decodificarEntidades, corrigirMojibake, municipioNoTexto, classificar, modalidadeNumero, nomeModalidade,
  extrairObjeto, extrairAbertura, extrairValor, extrairLinks, extrairPorRegras, avaliarConfianca,
  validarSaidaIa, chamarIa, dividirAvisos, segmentarPaginas, chavesDedup, pareceMesmo, grupoDe, familia,
};
