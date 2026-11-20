// Robô do banco de peças reais, parte da Lei 14.133: esclarecimentos, impugnações, recursos e contrarrazões (com a
// resposta ou decisão quando o órgão publica no mesmo arquivo) que os órgãos anexam às contratações no PNCP.
// Complementa scripts/coletar_pecas_juridicas.js, que só cobre o ComprasNet antigo (até 2023). Grava pecas_juridicas.
//   node scripts/coletar_pecas_pncp.js
//
// Fonte: API pública do PNCP, sem login e sem captcha (pncp.gov.br não publica robots.txt; conferido em 20/11/2026):
//   /api/consulta/v1/contratacoes/atualizacao (lista do dia por modalidade)
//   /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/arquivos (documentos da contratação)
//   o "url" de cada documento (o próprio arquivo, PDF)
// O PNCP não tem um tipo de documento "impugnação" ou "recurso": o órgão anexa como "Outros Documentos" (16) ou
// "Pareceres" (41) e o título diz o que é ("ESCLARECIMENTO PREGAO 106 2026.pdf"). Só esses títulos são baixados.
// O Compras.gov novo (comprasnet-fase-externa) exige hCaptcha em cada chamada: NÃO é usado.
// Cortesia: pausa mínima de 1 s entre pedidos, timeout, teto de pedidos e de tamanho de arquivo por execução.
// LGPD: mesmo anonimizar() do robô do ComprasNet (CPF, e-mail, telefone, RG, OAB e nomes de pessoas apagados).
// Rodar de novo é seguro: upsert pelo id; o cursor (dados_robo) anda um dia por vez para a frente e para em ontem.
//
// Variáveis:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória para gravar (scripts/supabase_dados.js)
//   LIMITE_MINUTOS             8 — orçamento de tempo
//   ORCAMENTO_PEDIDOS          500 — teto de pedidos ao PNCP por execução
//   PAUSA_MS                   1200 — pausa entre pedidos (mínimo 1000)
//   PECAS_PNCP_DIA_INICIAL     2026-01-01 — primeiro dia (data de atualização da contratação) da varredura
//   PECAS_PNCP_MODALIDADES     6,4 — códigos do PNCP (6 pregão eletrônico, 4 concorrência eletrônica)
const { anonimizar, leiDe } = require("./coletar_pecas_juridicas");
const { semCpf } = require("../netlify/functions/_cpf");

const LIMITE_MS = Number(process.env.LIMITE_MINUTOS || 8) * 60000;
const ORCAMENTO_PEDIDOS = Number(process.env.ORCAMENTO_PEDIDOS || 500);
const PAUSA_MS = Math.max(1000, Number(process.env.PAUSA_MS || 1200));
const DIA_INICIAL = process.env.PECAS_PNCP_DIA_INICIAL || "2026-01-01";
const MODALIDADES = (process.env.PECAS_PNCP_MODALIDADES || "6,4").split(",").map((m) => m.trim()).filter((m) => /^\d{1,2}$/.test(m));
const CHAVE_CURSOR = "pecas_juridicas_pncp_cursor";
const BASE = "https://pncp.gov.br";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIPOS_DOC_ACEITOS = new Set([16, 41]);
const MAX_ARQUIVO = 3 * 1024 * 1024;
const MIN_TEXTO = 200; // menos que isso é PDF escaneado (imagem) ou capa: não vira peça
const POR_PAGINA = 50;

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_+.-]+/g, " ").replace(/\s+/g, " ").trim();

// Título do arquivo -> tipo da peça, ou null. "Recursos humanos/financeiros/orçamentários" não é recurso administrativo.
function tipoPeloTitulo(titulo) {
  const t = semAcento(titulo);
  if (/contra ?r?raz/.test(t)) return "contrarrazao";
  if (/impugna/.test(t)) return "impugnacao";
  if (/esclarec/.test(t)) return "esclarecimento";
  if (/intenc\w* (de )?recurso/.test(t)) return "intencao_recurso";
  if (/\brecurs[oa]s?\b/.test(t) && !/recursos? (humanos|financeiros|orcament|proprios|materiais|vinculados|federa)/.test(t)) return "recurso";
  return null;
}

// Primeiro CNPJ do texto que não é o do órgão (a empresa que pediu ou recorreu), ou null.
function cnpjDaEmpresa(texto, cnpjOrgao) {
  for (const m of String(texto).matchAll(/\b(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})\b/g)) {
    const c = m.slice(1).join("");
    if (c !== cnpjOrgao) return c;
  }
  return null;
}

// Linha de pecas_juridicas a partir da contratação (consulta do PNCP), do documento (lista de arquivos) e do texto lido.
function montarLinha(compra, doc, textoBruto) {
  const cnpj = String(compra.orgaoEntidade?.cnpj || "");
  const texto = anonimizar(textoBruto);
  const orgao = String(compra.orgaoEntidade?.razaoSocial || "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  const numero = /^\d{1,6}$/.test(String(compra.numeroCompra || "").replace(/^0+(?=\d)/, "")) ? String(Number(compra.numeroCompra)) : null;
  const uasg = String(compra.unidadeOrgao?.codigoUnidade || "");
  const amparo = `${compra.amparoLegal?.nome || ""} ${compra.amparoLegal?.descricao || ""}`;
  return {
    id: `pncp-${cnpj}-${compra.anoCompra}-${compra.sequencialCompra}-${doc.sequencialDocumento}`,
    tipo: tipoPeloTitulo(doc.titulo),
    pregao: numero ? `${numero}/${compra.anoCompra}` : null,
    uasg: /^\d{5,6}$/.test(uasg) ? uasg : null,
    orgao, prgcod: null, item: null,
    data: /^\d{4}-\d{2}-\d{2}/.test(doc.dataPublicacaoPncp || "") ? doc.dataPublicacaoPncp.slice(0, 10) : null,
    empresa_cnpj: cnpjDaEmpresa(semCpf(textoBruto, " "), cnpj), empresa_nome: null,
    texto, resposta: null, resultado: null,
    lei: leiDe(amparo) || leiDe(texto),
    url: `${BASE}/app/editais/${cnpj}/${compra.anoCompra}/${compra.sequencialCompra}`,
    busca: semAcento(`${texto} ${orgao || ""}`).slice(0, 20000),
  };
}

// Pedidos ao PNCP com pausa mínima, timeout e teto por execução (mesmo espírito do leitor do ComprasNet).
function criarCliente({ fetchImpl = (...a) => fetch(...a), esperar = (ms) => new Promise((r) => setTimeout(r, ms)), pausaMs = PAUSA_MS, orcamento = ORCAMENTO_PEDIDOS, agora = Date.now } = {}) {
  let restante = orcamento, ultimo = null;
  async function pedir(url, aceitar) {
    if (!url.startsWith(`${BASE}/`)) throw new Error("Endereço fora do PNCP.");
    if (restante <= 0) throw new Error("Orçamento de pedidos do PNCP esgotado.");
    restante -= 1;
    if (ultimo !== null) { const falta = pausaMs - (agora() - ultimo); if (falta > 0) await esperar(falta); }
    ultimo = agora();
    const r = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: aceitar }, signal: globalThis.AbortSignal.timeout(20000) });
    if (r.status === 204) return null;
    if (!r.ok) throw Object.assign(new Error(`PNCP HTTP ${r.status}`), { status: r.status });
    return r;
  }
  return {
    get usados() { return orcamento - restante; },
    async json(url) { const r = await pedir(url, "application/json"); return r ? r.json() : null; },
    async arquivo(url) {
      const r = await pedir(url, "application/pdf,*/*");
      if (!r || Number(r.headers?.get?.("content-length")) > MAX_ARQUIVO) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.length <= MAX_ARQUIVO ? buf : null;
    },
  };
}

// shortcut: só PDF com texto; .docx/.odt e PDF escaneado ficam de fora. Ler docx com mammoth se aparecerem muitos.
async function textoDoPdf(bytes, lerPdf) {
  if (!bytes || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return "";
  try {
    const { paginas } = await lerPdf(bytes);
    return paginas.map((p) => p.texto).join("\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch { return ""; }
}

async function coletarCompra(cliente, compra, lerPdf) {
  const cnpj = String(compra.orgaoEntidade?.cnpj || "");
  if (!/^\d{14}$/.test(cnpj)) return [];
  const docs = await cliente.json(`${BASE}/api/pncp/v1/orgaos/${cnpj}/compras/${compra.anoCompra}/${compra.sequencialCompra}/arquivos`) || [];
  const linhas = [];
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!doc.statusAtivo || !TIPOS_DOC_ACEITOS.has(doc.tipoDocumentoId) || !tipoPeloTitulo(doc.titulo)) continue;
    if (!String(doc.url || "").startsWith(`${BASE}/pncp-api/`)) continue;
    const texto = await textoDoPdf(await cliente.arquivo(doc.url), lerPdf);
    if (texto.length >= MIN_TEXTO) linhas.push(montarLinha(compra, doc, texto));
  }
  return linhas;
}

const isoParaPncp = (iso) => iso.replace(/-/g, "");
const proximoDia = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const ontem = (agora = new Date()) => { const d = new Date(agora); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

// Um passo do cursor { dia, modalidade (índice), pagina, indice }: lê uma página da lista e as contratações dela.
async function passo(cliente, cursor, { lerPdf, gravar, tempoAcabou }) {
  const mod = MODALIDADES[cursor.modalidade];
  const lista = await cliente.json(`${BASE}/api/consulta/v1/contratacoes/atualizacao?dataInicial=${isoParaPncp(cursor.dia)}&dataFinal=${isoParaPncp(cursor.dia)}&codigoModalidadeContratacao=${mod}&pagina=${cursor.pagina}&tamanhoPagina=${POR_PAGINA}`);
  const compras = Array.isArray(lista?.data) ? lista.data : [];
  let gravadas = 0;
  while (cursor.indice < compras.length && !tempoAcabou()) {
    let linhas = [];
    try { linhas = await coletarCompra(cliente, compras[cursor.indice], lerPdf); }
    catch (e) {
      if (/Orçamento/.test(e.message)) throw e; // continua desta contratação na próxima execução
      console.log(`[pecas-pncp] contratação ${compras[cursor.indice]?.numeroControlePNCP || "?"} pulada: ${e.message}`);
    }
    if (linhas.length) gravadas += await gravar(linhas);
    cursor.indice += 1;
  }
  if (cursor.indice < compras.length) return gravadas;
  cursor.indice = 0;
  if (cursor.pagina < Number(lista?.totalPaginas || 0)) { cursor.pagina += 1; return gravadas; }
  cursor.pagina = 1; cursor.modalidade += 1;
  if (cursor.modalidade >= MODALIDADES.length) { cursor.modalidade = 0; cursor.dia = proximoDia(cursor.dia); }
  return gravadas;
}

async function main() {
  const { buscarBlob, salvarBlob, upsertEmLotes } = require("./supabase_dados");
  const { lerPaginasPdf } = require("../netlify/functions/_empresa_pdf_leitor");
  const inicio = Date.now();
  const tempoAcabou = () => Date.now() - inicio >= LIMITE_MS;
  const cliente = criarCliente();
  const cursor = { dia: DIA_INICIAL, modalidade: 0, pagina: 1, indice: 0, ...(await buscarBlob("dados_robo", CHAVE_CURSOR)) };
  if (cursor.modalidade >= MODALIDADES.length) cursor.modalidade = 0;
  const gravar = async (linhas) => {
    try { await upsertEmLotes("pecas_juridicas", linhas, "id", 100); return linhas.length; }
    catch (e) { console.log(`[pecas-pncp] gravação recusada (${linhas[0]?.id}): ${e.message}`); return 0; }
  };
  let gravadas = 0;
  try {
    while (cursor.dia <= ontem() && !tempoAcabou()) gravadas += await passo(cliente, cursor, { lerPdf: (b) => lerPaginasPdf(b, 15000), gravar, tempoAcabou });
  } catch (e) {
    console.log(`[pecas-pncp] parou: ${e.message}`);
  }
  await salvarBlob("dados_robo", CHAVE_CURSOR, cursor);
  console.log(`[pecas-pncp] ${gravadas} peças gravadas, ${cliente.usados} pedidos; cursor ${cursor.dia} mod ${MODALIDADES[cursor.modalidade]} pág ${cursor.pagina} #${cursor.indice}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { tipoPeloTitulo, cnpjDaEmpresa, montarLinha, criarCliente, coletarCompra, passo, textoDoPdf };
