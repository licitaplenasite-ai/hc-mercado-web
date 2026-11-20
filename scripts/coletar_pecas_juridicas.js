// Robô do banco de peças reais (Jurídico & Dúvidas): esclarecimentos, impugnações, intenções de recurso, recursos e
// contrarrazões publicados no ComprasNet antigo, com a resposta/decisão do pregoeiro. Grava a tabela pecas_juridicas
// (supabase/pecas_juridicas.sql).
//   node scripts/coletar_pecas_juridicas.js
//
// Fonte: páginas PÚBLICAS e SEM captcha (conferido em 19/11/2026, ver _historico/mapa-comprasnet-antigo-20261119.md):
//   ata4.asp (POST, lista de pregões por UF e semana) -> ata2.asp (prgcod e órgão)
//   avisos2.asp?Tipo=E|I (lista) -> avisos4.asp?qaCod=&texto=T|R (pedido e resposta, texto inteiro)
//   VisualizarRecursosPregao.asp (por sessão) -> Termojulg2.asp (intenção, recurso, contrarrazão, decisões)
// Só cobre pregões do ComprasNet antigo (até 2023): pregões novos do Compras.gov não aparecem lá. A ata completa
// (AtaEletronico.asp) tem captcha e NUNCA é aberta (o leitor de _comprasnet_antigo.js recusa a página).
// Cortesia: o leitor faz pausa mínima de 1,5 s entre páginas, timeout e teto de páginas por execução.
// LGPD: CPF, e-mail, telefone, RG, OAB e nomes de pessoas físicas (heurística) são apagados antes de gravar; ficam
// empresa (razão social), CNPJ e órgão, que são dados públicos de pessoa jurídica.
// Rodar de novo é seguro: upsert pelo id da peça; o cursor (dados_robo) anda uma UF/semana por vez, para trás no tempo.
//
// Variáveis:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória para gravar (scripts/supabase_dados.js)
//   LIMITE_MINUTOS             10 — orçamento de tempo
//   ORCAMENTO_PAGINAS          300 — teto de páginas do ComprasNet por execução
//   PAUSA_MS                   2000 — pausa entre páginas (mínimo 1500, imposto pelo leitor)
//   PECAS_SEMANA_INICIAL       2023-12-25 — segunda-feira em que a varredura começa (anda para trás)
//   PECAS_SEMANA_FINAL         2021-04-05 — para aqui (Lei 14.133 começa em 04/2021; antes disso já há 8.666/10.520)
//   PECAS_UFS                  todas as UFs, separadas por vírgula
const { criarLeitor, lerLista, lerPrgcod, decodificar, linkPregaoAntigo, BASE } = require("../netlify/functions/_comprasnet_antigo");
const { semCpf } = require("../netlify/functions/_cpf");

const LIMITE_MS = Number(process.env.LIMITE_MINUTOS || 10) * 60000;
const ORCAMENTO_PAGINAS = Number(process.env.ORCAMENTO_PAGINAS || 300);
const PAUSA_MS = Number(process.env.PAUSA_MS || 2000);
const SEMANA_INICIAL = process.env.PECAS_SEMANA_INICIAL || "2023-12-25";
const SEMANA_FINAL = process.env.PECAS_SEMANA_FINAL || "2021-04-05";
const UFS = (process.env.PECAS_UFS || "AC,AL,AM,AP,BA,CE,DF,ES,GO,MA,MG,MS,MT,PA,PB,PE,PI,PR,RJ,RN,RO,RR,RS,SC,SE,SP,TO").split(",").map((u) => u.trim()).filter(Boolean);
const CHAVE_CURSOR = "pecas_juridicas_cursor";
const MAX_TEXTO = 60000;

// ---------- texto ----------
const textoDeHtml = (html) => decodificar(String(html || "")
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " "))
  // Marcadores de lista colados do Word (fonte Wingdings, \u00e1rea de uso privado) aparecem como caixa: viram "\u2022".
  .replace(/[\ue000-\uf8ff]/g, "\u2022").replace(/[ \t\u00a0\u2000-\u200a]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const dataIso = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || "")); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const leiDe = (t) => /14[.\s]?133/.test(t) ? "14133" : /13[.\s]?303/.test(t) ? "13303" : /10[.\s]?024|10[.\s]?520/.test(t) ? "10520" : /8[.\s]?666/.test(t) ? "8666" : null;

// ---------- LGPD ----------
// shortcut: nome de pessoa é achado por gatilho ("representada por", "Sr.", "advogado"...) + palavras com inicial
// maiúscula, e por linha de assinatura no fim. Nome solto no meio do texto passa; ampliar com lista de prenomes se aparecer.
const GATILHOS = /(?:representad[ao]\s+(?:legalmente\s+)?(?:neste\s+ato\s+)?(?:por\s+)?(?:seu|sua)?\s*(?:s[óo]ci[oa](?:[- ]administrador[a]?)?|representante\s+legal|procurador[a]?|diretor[a]?|administrador[a]?)?\s*,?\s*(?:o|a)?\s*(?:Sr\.?|Sra\.?|Senhor[a]?)?|\bSr\.?\s*(?:\(a\)\.?)?|\bSra\.?|\bSenhor[a]?|\badvogad[oa]|\bprocurador[a]?|\bpregoeir[oa](?:\(a\))?\s*:?|\brepresentante\s+legal\s*,?|\bs[óo]ci[oa](?:[- ]administrador[a]?)?\s*,?|\bassinad[oa]\s+(?:digitalmente\s+)?por|\bDra?\.|\bprofissional|\bengenheir[oa]|\bEng\.|\barquitet[oa]|\brespons[áa]vel(?:\s+(?:legal|t[ée]cnic[oa]))?\s*:?|\bservidor[a]?|\bcontador[a]?)\s*/gi;
const PALAVRA = "\\p{Lu}[\\p{L}'’]+";
const NOME = new RegExp(`${PALAVRA}(?:\\s+(?:(?:d[aeo]s?|e|D[AEO]S?|E)\\s+)?${PALAVRA}){1,5}`, "uy");
const NAO_NOME = /^(?:(?:d[aeo]s?|e|a|o)\b|comiss|departament|munic|prefeit|secretari|universidade|instituto|minist|empresa|licita|preg|autoridade|senhor|ilmo|ilustr|presidente)/i;
const EMPRESA = /\b(?:ltda|eireli|s\.?\/?a\.?|me|epp|mei|cia|comercio|com[ée]rcio|servi[çc]os|industria|ind[úu]stria|engenharia|construtora|distribuidora)\b/i;
function apagarNomes(texto) {
  let saida = "", pos = 0;
  for (const g of texto.matchAll(GATILHOS)) {
    if (g.index < pos) continue;
    NOME.lastIndex = g.index + g[0].length;
    const n = NOME.exec(texto);
    if (!n || NAO_NOME.test(n[0]) || EMPRESA.test(n[0])) continue;
    saida += texto.slice(pos, n.index) + "[nome removido]";
    pos = n.index + n[0].length;
  }
  saida += texto.slice(pos);
  // Linha que começa com nome seguido de " - cargo" ou ", cargo" (assinatura de decisão, lista de equipe).
  saida = saida.replace(new RegExp(`^(${PALAVRA}(?:\\s+(?:(?:d[aeo]s?|e|D[AEO]S?|E)\\s+)?${PALAVRA}){1,5})(?=\\s*[-–,]\\s)`, "gmu"),
    (n) => (NAO_NOME.test(n) || EMPRESA.test(n) ? n : "[nome removido]"));
  // Assinatura: nas últimas linhas, linha que é só um nome (2 a 6 palavras com inicial maiúscula, sem número nem sufixo de empresa).
  const linhas = saida.split("\n");
  const linhaNome = new RegExp(`^\\s*${PALAVRA}(?:\\s+(?:(?:d[aeo]s?|e|D[AEO]S?|E)\\s+)?${PALAVRA}){1,5}\\s*$`, "u");
  for (let i = Math.max(0, linhas.length - 12); i < linhas.length; i++) {
    if (linhaNome.test(linhas[i]) && !EMPRESA.test(linhas[i]) && !/\d/.test(linhas[i]) && !NAO_NOME.test(linhas[i].trim()) && !/deferimento|termos|atenciosamente/i.test(linhas[i])) linhas[i] = "[nome removido]";
  }
  return linhas.join("\n");
}
function anonimizar(texto) {
  const t = semCpf(String(texto || ""), "[CPF removido]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail removido]")
    .replace(/(?:\(?\b\d{2}\)?\s?)?\b9?\d{4}[-\s]\d{4}\b/g, "[telefone removido]")
    .replace(/\b(RG|R\.G\.|carteira de identidade)\s*(?:n[º°o.]*\s*)?[\dXx][\d.\-Xx/ ]{4,}\d(?:\s*[A-Z]{2,5}(?:\/[A-Z]{2})?)?/gi, "$1 [removido]")
    .replace(/\bOAB\s*\/?\s*[A-Z]{2}\s*(?:n[º°o.]*\s*)?[\d.]+/gi, "OAB [removida]");
  return apagarNomes(t).slice(0, MAX_TEXTO);
}

// ---------- leitores de página ----------
// avisos2: [{ tipo: 'esclarecimento'|'impugnacao', data, qaCod, temResposta }]
function lerAvisos(html) {
  const saida = [];
  for (const m of String(html).matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rotulo = /(Esclarecimento|Impugna[çc][ãa]o)\s*:/i.exec(textoDeHtml(m[1]));
    const qa = /avisos4\.asp\?qaCod=(\d+)&texto=T/i.exec(m[1]);
    if (!rotulo || !qa) continue;
    saida.push({ tipo: /^esc/i.test(rotulo[1]) ? "esclarecimento" : "impugnacao", data: dataIso(m[1]), qaCod: qa[1], temResposta: new RegExp(`qaCod=${qa[1]}&texto=R`, "i").test(m[1]) });
  }
  return saida;
}
// avisos4: texto inteiro do pedido (T) ou da resposta (R).
const lerTextoAviso = (html) => textoDeHtml(/<p class="tex3">([\s\S]*?)<\/p>/i.exec(String(html))?.[1] || "");
// VisualizarRecursosPregao: links das peças em ordem, com item e fornecedor; e as outras sessões.
function lerRecursos(html) {
  const t = String(html), links = [];
  let item = null, cnpj = null, nome = null;
  const re = /<b>Item:\s*<\/b>\s*(\d+)|<b>CNPJ:\s*<\/b>\s*([\d./-]{14,18})\s*-\s*<b>Raz[ãa]o Social\/Nome:(?:&nbsp;|\s)*<\/b>([^<]*)|Termojulg2\.asp\?([^'"]+)['"][^>]*>([^<]*)/gi;
  for (const m of t.matchAll(re)) {
    if (m[1]) { item = Number(m[1]); continue; }
    if (m[2]) { cnpj = m[2].replace(/\D/g, ""); nome = decodificar(m[3]).replace(/\s+/g, " ").trim(); continue; }
    const q = new URLSearchParams(decodificar(m[4]));
    const tipo = q.get("Tipo");
    if (!["I", "R", "CR", "DP", "DA"].includes(tipo)) continue;
    const forn = tipo === "CR" ? /([\d./-]{18})\s*-\s*(.+)$/.exec(decodificar(m[5]).replace(/\s+/g, " ").trim()) : null;
    links.push({ tipo, item, ipgCod: q.get("ipgCod"), reCod: q.get("reCod"), cliente: q.get("Cliente_ID"), query: decodificar(m[4]),
      cnpj: forn ? forn[1].replace(/\D/g, "") : ["DP", "DA"].includes(tipo) ? null : cnpj, nome: forn ? forn[2].trim() : ["DP", "DA"].includes(tipo) ? null : nome });
  }
  const sessoes = [...new Set([...t.matchAll(/reSeqSessao=(\d+)/gi)].map((m) => m[1]))];
  return { links, sessoes };
}
// Termojulg2: cabeçalho ("RECURSO:", "DECISÃO DO PREGOEIRO: NÃO PROCEDE") e texto.
function lerPeca(html) {
  const t = String(html);
  const cab = textoDeHtml(/class="mensagem">([\s\S]*?)<\/td>/i.exec(t)?.[1] || "");
  const corpo = textoDeHtml(/colspan=4 class="tex3">([\s\S]*?)<\/td>/i.exec(t)?.[1] || "");
  return { cabecalho: cab, resultado: /:\s*(.+)$/.exec(cab)?.[1]?.trim() || null, texto: corpo };
}
// ata2: órgão da UASG e regime declarado no cabeçalho.
function lerCabecalhoPregao(html) {
  const t = textoDeHtml(html).replace(/\s+/g, " ");
  return { orgao: /UASG\s+\d{5,6}\s*-\s*(.+?)\s+Preg[ãa]o/i.exec(t)?.[1]?.trim() || null, lei: leiDe(t) };
}

// ---------- montagem das linhas ----------
const TIPO_RECURSO = { I: "intencao_recurso", R: "recurso", CR: "contrarrazao" };
function linha(pregao, extra) {
  const texto = anonimizar(extra.texto);
  const resposta = extra.resposta ? anonimizar(extra.resposta) : null;
  return { ...extra, texto, resposta, empresa_nome: extra.empresa_nome ? semCpf(extra.empresa_nome, " ").replace(/\s+/g, " ").trim().slice(0, 300) || null : null,
    pregao: pregao.rotulo, uasg: pregao.uasg, orgao: pregao.orgao, prgcod: pregao.prgcod, url: pregao.url,
    lei: leiDe(`${extra.texto} ${extra.resposta || ""}`) || pregao.lei,
    busca: semAcento(`${texto} ${resposta || ""} ${pregao.orgao || ""} ${extra.empresa_nome || ""}`).slice(0, 20000) };
}

async function coletarAvisos(leitor, pregao) {
  const linhas = [];
  for (const tipo of ["E", "I"]) {
    for (const a of lerAvisos(await leitor.pagina(`/avisos2.asp?prgcod=${pregao.prgcod}&Tipo=${tipo}`))) {
      const texto = lerTextoAviso(await leitor.pagina(`/avisos4.asp?qaCod=${a.qaCod}&texto=T`));
      const resposta = a.temResposta ? lerTextoAviso(await leitor.pagina(`/avisos4.asp?qaCod=${a.qaCod}&texto=R`)) : null;
      if (!texto) continue;
      const cnpj = /\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/.exec(texto)?.[1];
      linhas.push(linha(pregao, { id: `cn-${pregao.prgcod}-qa-${a.qaCod}`, tipo: a.tipo, data: a.data, texto, resposta, resultado: null, item: null, empresa_cnpj: cnpj ? cnpj.replace(/\D/g, "") : null, empresa_nome: null }));
    }
  }
  return linhas;
}

// Decisões do pregoeiro (DP) e da autoridade (DA) por item, lidas uma vez por página de sessão.
async function lerDecisoes(leitor, links) {
  const decisoes = new Map();
  for (const l of links.filter((x) => x.tipo === "DP" || x.tipo === "DA")) {
    if (!decisoes.has(`${l.ipgCod}:${l.tipo}`)) decisoes.set(`${l.ipgCod}:${l.tipo}`, lerPeca(await leitor.pagina(`/Termojulg2.asp?${l.query}`)));
  }
  return decisoes;
}

async function coletarRecursos(leitor, pregao, data) {
  const primeira = lerRecursos(await leitor.pagina(`/VisualizarRecursosPregao.asp?prgCod=${pregao.prgcod}`));
  const paginas = [primeira];
  for (const s of primeira.sessoes) paginas.push(lerRecursos(await leitor.pagina(`/VisualizarRecursosPregao.asp?prgCod=${pregao.prgcod}&reSeqSessao=${s}`)));
  const linhas = [], vistos = new Set();
  for (const { links } of paginas) {
    const decisoes = await lerDecisoes(leitor, links);
    for (const l of links.filter((x) => TIPO_RECURSO[x.tipo])) {
      const id = `cn-${pregao.prgcod}-${l.ipgCod}-${l.reCod}-${l.tipo}${l.cliente ? `-${l.cliente}` : ""}`;
      if (vistos.has(id)) continue;
      vistos.add(id);
      const peca = lerPeca(await leitor.pagina(`/Termojulg2.asp?${l.query}`));
      if (!peca.texto) continue;
      // A decisão vale para o item: a do pregoeiro traz a fundamentação; a da autoridade, quando existe, é a final.
      const dp = decisoes.get(`${l.ipgCod}:DP`), da = decisoes.get(`${l.ipgCod}:DA`);
      const resposta = [dp?.texto && `${dp.cabecalho}\n${dp.texto}`, da?.texto && `${da.cabecalho}\n${da.texto}`].filter(Boolean).join("\n\n") || null;
      linhas.push(linha(pregao, { id, tipo: TIPO_RECURSO[l.tipo], data, item: l.item, texto: peca.texto, resposta, resultado: da?.resultado || dp?.resultado || null,
        empresa_cnpj: /^\d{14}$/.test(l.cnpj || "") ? l.cnpj : null, empresa_nome: l.nome || null }));
    }
  }
  return linhas;
}

async function coletarPregao(leitor, ref) {
  const numero = String(Number(ref.numprp.slice(0, -4))), ano = ref.numprp.slice(-4);
  const html2 = await leitor.pagina(`/ata2.asp?co_no_uasg=${ref.uasg}&numprp=${ref.numprp}&codigoModalidade=5`);
  const prgcod = lerPrgcod(html2);
  if (!prgcod) return [];
  const pregao = { ...lerCabecalhoPregao(html2), prgcod, uasg: ref.uasg, rotulo: `${numero}/${ano}`, url: linkPregaoAntigo({ uasg: ref.uasg, numero, ano }) };
  return [...await coletarAvisos(leitor, pregao), ...await coletarRecursos(leitor, pregao, ref.data || null)];
}

// ---------- cursor e laço ----------
const voltarSemana = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10); };
const br = (iso, dias = 0) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10).split("-").reverse().join("/"); };

async function main() {
  const { buscarBlob, salvarBlob, upsertEmLotes } = require("./supabase_dados");
  const inicio = Date.now();
  const leitor = criarLeitor({ pausaMs: PAUSA_MS, orcamento: ORCAMENTO_PAGINAS });
  const cursor = { semana: SEMANA_INICIAL, uf: 0, indice: 0, ...(await buscarBlob("dados_robo", CHAVE_CURSOR)) };
  let gravadas = 0, pregoes = 0;
  try {
    while (cursor.semana >= SEMANA_FINAL && Date.now() - inicio < LIMITE_MS) {
      const corpo = new URLSearchParams({ rdTpPregao: "E", lstSrp: "T", lstICMS: "T", uf: UFS[cursor.uf], co_uasg: "", txtlstUasg: "", numprp: "", dt_ini_sessao: br(cursor.semana), dt_fim_sessao: br(cursor.semana, 6) });
      // shortcut: a lista de ata4 por UF e semana veio inteira nos testes (sem paginação); se o portal paginar, ler as páginas seguintes.
      const lista = lerLista(await leitor.pagina("/ata4.asp", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo.toString() })).filter((l) => l.tipo === "E" && l.modalidade === 5);
      while (cursor.indice < lista.length && Date.now() - inicio < LIMITE_MS) {
        let linhas = [];
        try { linhas = await coletarPregao(leitor, lista[cursor.indice]); }
        catch (e) {
          if (/Orçamento/.test(e.message)) throw e; // continua deste pregão na próxima execução
          console.log(`[pecas] pregão ${lista[cursor.indice].uasg}/${lista[cursor.indice].numprp} pulado: ${e.message}`);
        }
        if (linhas.length) { await upsertEmLotes("pecas_juridicas", linhas, "id", 200); gravadas += linhas.length; }
        cursor.indice += 1; pregoes += 1;
      }
      if (cursor.indice < lista.length) break;
      cursor.indice = 0; cursor.uf += 1;
      if (cursor.uf >= UFS.length) { cursor.uf = 0; cursor.semana = voltarSemana(cursor.semana); }
    }
  } catch (e) {
    // Orçamento de páginas esgotado ou falha do portal: guarda onde parou e sai sem erro (a próxima execução continua).
    console.log(`[pecas] parou: ${e.message}`);
  }
  await salvarBlob("dados_robo", CHAVE_CURSOR, cursor);
  console.log(`[pecas] ${pregoes} pregões lidos, ${gravadas} peças gravadas, ${leitor.usadas} páginas; cursor ${cursor.semana} ${UFS[cursor.uf]} #${cursor.indice}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { anonimizar, lerAvisos, lerTextoAviso, lerRecursos, lerPeca, lerCabecalhoPregao, coletarPregao, leiDe, BASE };
