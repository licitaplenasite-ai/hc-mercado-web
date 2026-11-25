// Leitura por regras (sem IA) de avisos de licitação em texto corrido de diário oficial: DOU (scripts/fontes/dou.js)
// e diários municipais do Querido Diário (scripts/fontes/querido_diario.js). Um diário mistura vários atos, então o
// texto é cortado em avisos pelo rótulo "Objeto:"; modalidade e número vêm do trecho logo antes do objeto, e a
// data de abertura do trecho logo depois. Testes: scripts/fontes/avisos_texto.test.js.
const { limparEspacos } = require("./comum");
// Mesma família de modalidade que o coletor das fontes fora do PNCP usa para comparar com o PNCP.
const { familia } = require("../coletar_fontes_extras");
const { ehFomento } = require("./diario_extracao");

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const normalizar = (s) => limparEspacos(semAcento(s).toLowerCase());

// Mais específica primeiro: no mesmo ponto do texto, "pregão eletrônico" ganha de "pregão".
const MODALIDADES = [
  [/preg[aã]o\s+eletr[oô]nico/i, "Pregão - Eletrônico"],
  [/preg[aã]o\s+presencial/i, "Pregão - Presencial"],
  [/preg[aã]o/i, "Pregão"],
  [/concorr[eê]ncia\s+(?:p[uú]blica\s+)?eletr[oô]nica/i, "Concorrência - Eletrônica"],
  [/concorr[eê]ncia/i, "Concorrência"],
  [/dispensa\s+(?:de\s+licita[cç][aã]o\s+)?(?:eletr[oô]nica|na\s+forma\s+eletr[oô]nica)/i, "Dispensa Eletrônica"],
  [/dispensa/i, "Dispensa"],
  [/chamamento\s+p[uú]blico|chamada\s+p[uú]blica/i, "Chamamento público"],
  [/credenciamento/i, "Credenciamento"],
  [/tomada\s+de\s+pre[cç]os/i, "Tomada de preços"],
  [/leil[aã]o/i, "Leilão"],
  [/\bRDC\b|regime\s+diferenciado\s+de\s+contrata/i, "RDC"],
  [/\bconvite\b/i, "Convite"],
  [/cota[cç][aã]o\s+(?:de\s+pre[cç]os|eletr[oô]nica)/i, "Cotação"],
];

// Classificação pelo título do ato. Resultado/homologação encerram o processo; extratos, contratos, penalidades
// e afins não são disputa aberta. Suspensão não abre nem encerra.
const ENCERRA = /RESULTADO|HOMOLOGA|ADJUDICA|REVOGA|ANULA|CANCELA|FRACASSAD|DESERT|RATIFICA/;
const NAO_E_DISPUTA = /EXTRATO|INEXIGIBILIDADE|PENALIDADE|NOTIFICA|INTIMA|\bCITACAO|CIENTIFICA|CONVOCA[CÇ]|CONVENIO|DIPLOMA|CONCURSO|SELETIVO|AUDIENCIA|ACIONISTA|LICENCA|CONTRATO|ADITIVO|PORTARIA|DECRETO|LEI\b/;
const E_DISPUTA = /LICITA|PREGAO|CONCORRENCIA|CHAMAMENTO|CHAMADA PUBLICA|CREDENCIAMENTO|DISPENSA|COTACAO|TOMADA DE PRECOS|CONVITE|LEILAO|REABERTURA|ADIAMENTO|PRORROGA|ALTERACAO|RETIFICA|\bRDC\b|INSTRUMENTO CONVOCATORIO|EDITAL/;

// Chamamento de fomento cultural ou de OSC (MROSC) não é disputa de fornecedor: mesma regra dos diários do AM.
const ehFomentoAviso = (texto) => ehFomento(/chamamento|chamada\s+p[uú]blica|credenciamento/i.test(String(texto ?? "").slice(0, 2500)) ? "chamamento" : "", texto);

function classificar(titulo, texto) {
  const t = semAcento(titulo).toUpperCase();
  if (/SUSPENS/.test(t)) return "ignorar";
  if (ENCERRA.test(t)) return "encerramento";
  const disputa = /INSTRUMENTO CONVOCATORIO/.test(t) || (!NAO_E_DISPUTA.test(t) && (E_DISPUTA.test(t)
    // Título genérico ("AVISO", "EDITAL DE 24 DE NOVEMBRO"): só vale se o texto disser a modalidade.
    || Boolean(modalidadeNoFim(String(texto || "").slice(0, 300)))));
  return disputa && !ehFomentoAviso(`${titulo} ${texto || ""}`) ? "oportunidade" : "ignorar";
}

// Diário municipal não separa título de texto: vale a marca que aparece por último antes do "Objeto:".
// "AVISO DE HOMOLOGAÇÃO" -> encerramento; "EXTRATO DO CONTRATO" -> ignorar; "AVISO DE LICITAÇÃO" -> oportunidade.
const MARCA_ENCERRA = /HOMOLOGA|RESULTADO|ADJUDICA|REVOGA|ANULA|FRACASSAD|DESERT|RATIFICA/g;
const MARCA_NAO = /EXTRATO|ATA DE REGISTRO|INEXIGIBILIDADE|CONTRATO N|TERMO ADITIVO|SUSPENS/g;
const MARCA_DISPUTA = /AVISO DE (?:LICITA|PREG|DISPENSA|CHAMA|CREDENC|COTA|CONCORR|TOMADA|ABERT|REABERT)|EDITAL DE (?:CHAMA|CREDENC|LICITA|PREG|CONCORR)|TORNA PUBLICO|FARA REALIZAR|CONVIDA/g;
function ultimaMarca(texto, re) {
  let ultimo = -1;
  for (let m = re.exec(texto); m; m = re.exec(texto)) ultimo = m.index;
  re.lastIndex = 0;
  return ultimo;
}
function tipoDoTrecho(trecho) {
  const t = semAcento(trecho).toUpperCase();
  const [enc, nao, disp] = [MARCA_ENCERRA, MARCA_NAO, MARCA_DISPUTA].map((re) => ultimaMarca(t, re));
  if (enc > nao && enc > disp) return "encerramento";
  if (nao > disp) return "ignorar";
  return "oportunidade";
}

// Modalidade citada mais perto do fim do trecho (o trecho é o que vem antes do "Objeto:").
function modalidadeNoFim(trecho) {
  let melhor = null;
  MODALIDADES.forEach(([re, nome], ordem) => {
    const g = new RegExp(re.source, "gi");
    for (let m = g.exec(trecho); m; m = g.exec(trecho)) {
      if (!melhor || m.index > melhor.indice || (m.index === melhor.indice && ordem < melhor.ordem)) {
        melhor = { nome, indice: m.index, fim: m.index + m[0].length, ordem };
      }
    }
  });
  return melhor;
}

const NUMERO = /^[^0-9]{0,25}?(\d{1,6})\s*[/.-]\s*(\d{4})(?!\d)/;
function numeroDepois(texto) {
  const m = NUMERO.exec(texto);
  if (!m) return null;
  const ano = Number(m[2]);
  return ano >= 2000 && ano <= 2100 ? { numero: String(Number(m[1])), ano: String(ano) } : null;
}

// Fim do objeto = próximo rótulo com dois-pontos ("Realização: dia 10/12"); sem o ":" a palavra pode ser do próprio
// objeto ("contratação de empresa para realização de evento").
const FIM_OBJETO = /\s(?:Total\s+de\s+Itens|Edital|Entrega|Abertura|Data|Realiza[cç][aã]o|Informa[cç]|Recebimento|Sess[aã]o|Valor|Prazo|Local|Retirada|Fundamento|Dota[cç][aã]o|Crit[eé]rio|Modo\s+de\s+disputa|In[ií]cio|Processo)[^:.;]{0,45}:/i;
function objetoDepois(texto) {
  const corpo = limparEspacos(texto);
  const fim = FIM_OBJETO.exec(corpo);
  let objeto = fim ? corpo.slice(0, fim.index) : corpo.slice(0, 400);
  // Também termina no fim da frase (". A Prefeita...") ou no endereço do site do diário, depois de um mínimo.
  const frase = /\.\s+(?=[A-ZÀ-Ú])|\s(?:www\.|https?:)/.exec(objeto.slice(30));
  if (frase) objeto = objeto.slice(0, 30 + frase.index);
  objeto = objeto.replace(/[\s.;,-]+$/, "").slice(0, 400);
  return objeto.length >= 10 ? objeto : null;
}

// Aviso sem rótulo "Objeto:" ("torna público ... visando a aquisição de ...").
const OBJETO_VERBO = /((?:aquisi[cç][aã]o|contrata[cç][aã]o|registro\s+de\s+pre[cç]os|presta[cç][aã]o\s+de\s+servi[cç]os|execu[cç][aã]o\s+d|fornecimento|loca[cç][aã]o|obras?\s+d)[^.]{10,400})/i;

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const PALAVRA_ABERTURA = /abertura|sess[aã]o|realiza[cç][aã]o|disputa|data\s+do\s+preg[aã]o|data\s+da\s+licita|in[ií]cio\s+da\s+(?:sess|disputa)|certame\s+(?:ser[aá]|ocorrer)/gi;
const DATA_NUM = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const DATA_EXTENSO = /(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/i;
const HORA = /(?:^|[^\d/])(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?![\d/])/i;

function dataValida(a, m, d) {
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d ? data.toISOString().slice(0, 10) : null;
}

// Primeira data da janela (numérica ou por extenso; sem ano, o próximo dia/mês a partir da publicação) e o resto
// do texto da janela, onde se procura a hora. -> { dia: "AAAA-MM-DD", resto } ou null.
function dataNaJanela(janela, pub) {
  const n = DATA_NUM.exec(janela);
  if (n) return { dia: dataValida(+n[3], +n[2], +n[1]), resto: janela.replace(DATA_NUM, " ") };
  const e = DATA_EXTENSO.exec(janela);
  if (!e) return null;
  const mes = MESES.indexOf(semAcento(e[2]).toLowerCase()) + 1;
  const anoPub = Number(pub.slice(0, 4)) || new Date().getUTCFullYear();
  const pubMes = Number(pub.slice(5, 7)) || mes;
  return { dia: dataValida(e[3] ? +e[3] : anoPub + (mes < pubMes ? 1 : 0), mes, +e[1]), resto: janela.replace(DATA_EXTENSO, " ") };
}

function horaNoTexto(texto) {
  const h = HORA.exec(texto);
  return h && +h[1] <= 23 && +(h[2] || 0) <= 59 ? `${h[1].padStart(2, "0")}:${(h[2] || "00").padStart(2, "0")}` : "00:00";
}

// Maior data após uma palavra de abertura, entre o dia da publicação e 1 ano depois. "AAAA-MM-DDTHH:MM:00" ou null.
function aberturaNoTexto(texto, publicacaoIso) {
  const pub = String(publicacaoIso || "").slice(0, 10);
  const limite = pub ? new Date(Date.parse(pub) + 366 * 86400000).toISOString().slice(0, 10) : "9999";
  let melhor = null;
  const g = new RegExp(PALAVRA_ABERTURA.source, "gi");
  for (let m = g.exec(texto); m; m = g.exec(texto)) {
    const achado = dataNaJanela(texto.slice(m.index + m[0].length, m.index + m[0].length + 90), pub);
    if (!achado || !achado.dia || achado.dia < pub || achado.dia > limite) continue;
    const valor = `${achado.dia}T${horaNoTexto(achado.resto)}:00`;
    if (!melhor || valor > melhor) melhor = valor;
  }
  return melhor;
}

const UASG = /UASG\s*:?\s*(\d{5,6})/i;
const ROTULO_OBJETO = /\bobjeto\s*:/gi;
const ANTES = 400;
const CABECALHO = 160;
const DEPOIS = 1100;

// Texto corrido -> avisos [{ modalidade, numero, ano, uasg, objeto, encerramento, trecho }]. Sem "Objeto:", o texto
// inteiro vira um aviso só se disser modalidade e número.
function avisosDoTexto(textoBruto, publicacaoIso) {
  const texto = limparEspacos(textoBruto);
  const rotulos = [];
  const g = new RegExp(ROTULO_OBJETO.source, "gi");
  for (let m = g.exec(texto); m; m = g.exec(texto)) rotulos.push({ inicio: m.index, fim: m.index + m[0].length });
  const avisos = [];
  rotulos.forEach((r, i) => {
    const anterior = i ? rotulos[i - 1].fim : 0;
    const proximo = i + 1 < rotulos.length ? rotulos[i + 1].inicio : texto.length;
    const antes = texto.slice(Math.max(anterior, r.inicio - ANTES), r.inicio);
    const depois = texto.slice(r.fim, Math.min(proximo, r.fim + DEPOIS));
    avisos.push(montarAviso(antes, objetoDepois(depois), depois, publicacaoIso));
  });
  if (!rotulos.length) {
    // Só o cabeçalho: mais adiante o texto repete a modalidade ("na MODALIDADE Pregão...") já sem o número.
    const aviso = montarAviso(texto.slice(0, CABECALHO), (OBJETO_VERBO.exec(texto) || [])[1] || null, texto, publicacaoIso);
    if (aviso.modalidade && aviso.numero) avisos.push({ ...aviso, objeto: aviso.objeto && limparEspacos(aviso.objeto).slice(0, 400) });
  }
  return avisos.filter((a) => a.modalidade || a.numero);
}

function montarAviso(antes, objeto, depois, publicacaoIso) {
  const mod = modalidadeNoFim(antes);
  const num = mod ? numeroDepois(antes.slice(mod.fim)) : null;
  const uasg = UASG.exec(antes) || UASG.exec(depois);
  return {
    // "O objeto da presente ata..." é extrato de ata de registro de preços, não disputa.
    tipo: /^\W*(?:o\s+)?objeto\s+d[ao]\s+presente\s+(?:ata|contrato|termo)/i.test(objeto || "") ? "ignorar" : tipoDoTrecho(antes.slice(-300)),
    modalidade: mod ? mod.nome : null,
    numero: num ? num.numero : null,
    ano: num ? num.ano : null,
    uasg: uasg ? uasg[1] : null,
    objeto,
    encerramento: aberturaNoTexto(depois, publicacaoIso),
    trecho: limparEspacos(`${antes} Objeto: ${depois}`).slice(0, 1500),
  };
}

const UFS = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF",
  "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR", "santa catarina": "SC",
  "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};
// "Estado do Tocantins" / "Estado de São Paulo" / "Distrito Federal" -> "TO" / "SP" / "DF".
function ufDoNomeDoEstado(nome) {
  const n = normalizar(nome).replace(/^(governo\s+do\s+)?estado\s+(do|de|da)\s+/, "");
  return UFS[n] || null;
}

const SIGLAS_UF = Object.values(UFS).join("|");
const CIDADE_UF = new RegExp(`([A-ZÀ-Ú][A-Za-zÀ-ú'´]+(?:\\s+(?:d[aeo]s?\\s+)?[A-ZÀ-Ú][A-Za-zÀ-ú'´]+){0,4})\\s*[/-]\\s*(${SIGLAS_UF})\\b`, "g");
// Último "Cidade/UF" ou "Cidade - UF" do texto (endereço ou local e data no fim do aviso federal).
function cidadeUfNoTexto(texto) {
  let ultimo = null;
  const g = new RegExp(CIDADE_UF.source, "g");
  for (let m = g.exec(texto); m; m = g.exec(texto)) ultimo = { municipio: m[1], uf: m[2] };
  return ultimo;
}

// "PREFEITURA MUNICIPAL DE TEJUPÁ" -> "Tejupá" (nome de cidade em maiúsculas vira título).
function nomeDeCidade(nome) {
  const limpo = limparEspacos(nome).replace(/^(prefeitura\s+municipal|munic[ií]pio|c[aâ]mara\s+municipal)\s+(de|do|da)\s+/i, "");
  if (limpo !== limpo.toUpperCase()) return limpo;
  return limpo.toLowerCase().replace(/(^|\s|-)(\p{L})/gu, (t, a, b) => a + b.toUpperCase()).replace(/\s(D[aeo]s?)\s/g, (t) => t.toLowerCase());
}

// Chaves que identificam o processo em qualquer fonte (diário, PNCP): pela UASG (federal, Compras.gov) e pelo
// município. Sem número e ano não há como comparar: lista vazia.
function chavesDoProcesso({ uasg, uf, municipio, modalidade, numero, ano }) {
  // O PNCP guarda o número às vezes com prefixo ("PCE 127"); o diário, "127/2026". Compara só os dígitos.
  const digitos = (String(numero || "").split("/")[0].match(/\d+/) || [])[0];
  if (!digitos || !Number(ano)) return [];
  const base = `${familia(modalidade)}|${Number(digitos)}|${Number(ano)}`;
  const chaves = [];
  if (uasg && Number(uasg)) chaves.push(`uasg:${Number(uasg)}|${base}`);
  if (uf && municipio) chaves.push(`mun:${uf}|${normalizar(municipio)}|${base}`);
  return chaves;
}

module.exports = {
  semAcento, normalizar, tipoDoTrecho, chavesDoProcesso, classificar, ehFomentoAviso, modalidadeNoFim, numeroDepois, objetoDepois, aberturaNoTexto, avisosDoTexto,
  ufDoNomeDoEstado, cidadeUfNoTexto, nomeDeCidade, MODALIDADES,
};
