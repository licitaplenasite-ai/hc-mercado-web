// Adaptador dos editais da FAEPI (Fundação de Apoio ao Ensino, Pesquisa, Extensão e Interiorização do IFAM),
// contrato em scripts/fontes/README.md. Fundação de apoio de direito privado: compra pelo Decreto 8.241/2014,
// não pela Lei 14.133, e não está no PNCP ("Ente não cadastrado", consulta de 25/11/2026 ao CNPJ 04.623.300/0001-88).
//
// De onde vêm os dados (conferido em 25/11/2026; robots.txt da faepi.org libera tudo):
//   1. GET https://faepi.org/wp-json/wp/v2/edital  (REST pública do WordPress, tipo "edital", 50 por página)
//      Só entram os de pessoa jurídica (classe "direcionamento_do_ed-pessoa-juridica"): os de pessoa física são
//      seleção de bolsista. A classe "apoiada-xxx" diz o instituto do projeto.
//   2. Página de cada edital aberto: o objeto de verdade (o título quase sempre é só "SELEÇÃO PÚBLICA DE
//      FORNECEDORES") fica num <h6> logo depois de "Apoiada: X", e os PDFs ficam em "Editais e Anexos".
//   3. PDF do edital (também na listagem): "Início da disputa: dd/mm/aaaa às hh:mm"; disputa já feita = fechado.
//   A disputa acontece na BLL Compras (bll.org.br); por isso o adaptador da BLL ignora a FAEPI (não duplicar).
//   Os pedidos de cotação (SF/CD/DL) do portal Conveniar estão em faepi_cotacoes.js.
// shortcut: o site deixa "em andamento" editais de agosto com disputa já feita; "aberto" = em andamento e publicado
// há até JANELA_ABERTO_DIAS dias (as disputas vistas saem 4 a 14 dias depois da publicação). Se o site passar a
// marcar "encerrado" em dia, tirar a janela.
const { decodificar, textoDoHtml, dataBr, agoraBrasilia } = require("./html_texto");

const URL_EDITAIS = "https://faepi.org/wp-json/wp/v2/edital";
const POR_PAGINA = 50;
const JANELA_ABERTO_DIAS = 30;
const FONTE = {
  id: "faepi",
  nome: "FAEPI — Fundação de Apoio do IFAM (editais)",
  portal: "BLL Compras (edital no site da FAEPI)",
  paginaOficial: "https://faepi.org/editais-2026/",
};
const ORGAO = { nome: "FUNDACAO DE APOIO AO ENSINO, PESQUISA, EXTENSAO E INTERIORIZACAO DO IFAM - FAEPI", cnpj: "04623300000188", uf: "AM", municipio: "Manaus" };
const MODALIDADE = "Seleção Pública de Fornecedores (Decreto 8.241/2014)";
const OBJETO_GENERICO = /^sele[cç][aã]o\s+p[uú]blica\s+de\s+fornecedores(\s+para\s+contrata[cç][aã]o\s+de\s+pessoa\s+jur[ií]dica)?\W*$/i;

// "EDITAL Nº 2026-126", "129-2026", "2026/120", "N.º 2026-122", "0137-2026" -> { numero: "126", ano: 2026 }.
function numeroDoTitulo(titulo) {
  const t = String(titulo);
  const anoPrimeiro = /\b(20\d{2})\s*[-/]\s*0*(\d{1,4})\b/.exec(t);
  if (anoPrimeiro) return { numero: anoPrimeiro[2], ano: Number(anoPrimeiro[1]) };
  const numPrimeiro = /\b0*(\d{1,4})\s*[-/]\s*(20\d{2})\b/.exec(t);
  return numPrimeiro ? { numero: numPrimeiro[1], ano: Number(numPrimeiro[2]) } : null;
}

// Objeto = título sem o "EDITAL Nº ... –" e sem o "/ FAEPI PREÂMBULO" que todos repetem.
function objetoDoTitulo(titulo) {
  return titulo
    .replace(/^\s*edital\s+(?:informativo\s+)?n[.\s]*[ºo°]?\s*[\d/-]+\s*[-–—]*\s*/i, "")
    .replace(/\s*[-–—/]*\s*FAEPI(\s+PRE[AÂ]MBULO)?\s*$/i, "")
    .trim() || titulo;
}

const somarDias = (iso, dias) => new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);

// Um registro da REST -> item normalizado (ou null se não for compra de pessoa jurídica).
function itemDoEdital(e, hojeIso = agoraBrasilia().slice(0, 10)) {
  const classes = e.class_list || [];
  if (!classes.includes("direcionamento_do_ed-pessoa-juridica")) return null;
  const titulo = textoDoHtml(e.title && e.title.rendered);
  const num = numeroDoTitulo(titulo);
  const apoiada = (classes.find((c) => c.startsWith("apoiada-")) || "").replace("apoiada-", "").toUpperCase();
  const publicacao = String(e.date || "").slice(0, 19) || null;
  return {
    idExterno: num ? `SPF-${num.numero.padStart(3, "0")}/${num.ano}` : `PUB-${e.id}`,
    // Há edital sem termo de status (ex.: 2026/120): só "encerrado" explícito fecha.
    aberto: !classes.some((c) => c.startsWith("status_-encerrad")) && (publicacao || "") >= somarDias(hojeIso, -JANELA_ABERTO_DIAS),
    objeto: objetoDoTitulo(titulo),
    apoiada,
    modalidade: MODALIDADE,
    numero: num ? num.numero.padStart(3, "0") : null,
    ano: num ? num.ano : null,
    publicacao,
    encerramento: null,
    orgao: ORGAO,
    linkOficial: e.link,
    linkEdital: null,
    versao: String(e.modified || e.date || e.id),
  };
}

// Página do edital -> { descricao, anexos: [{ nome, url, publicadoEm }] }; só arquivos do próprio site.
function lerPagina(html) {
  const desc = /Apoiada:[^<]*<\/h6>[\s\S]{0,600}?<h6[^>]*>([\s\S]*?)<\/h6>/i.exec(html);
  const anexos = [];
  const re = /(?:<span class="edital-anexos__meta">([\s\S]*?)<\/span>\s*)?<a href="(https:\/\/faepi\.org\/wp-content\/uploads\/[^"]+\.(?:pdf|docx?|xlsx?|odt))"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) anexos.push({ nome: textoDoHtml(m[3]), url: decodificar(m[2]), publicadoEm: dataBr(textoDoHtml(m[1])) });
  return { descricao: desc ? textoDoHtml(desc[1]) : "", anexos };
}

// Objeto final: a descrição da página quando diz mais que o título; o instituto apoiado no fim.
function objetoFinal(item, descricao) {
  const base = descricao && !OBJETO_GENERICO.test(descricao) ? descricao : item.objeto;
  return item.apoiada ? `${base} (projeto apoiado: ${item.apoiada})` : base;
}

const INICIO_DISPUTA = /(?:in[ií]cio\s+da\s+disputa|abertura\s+da\s+sess[aã]o|data\s+da\s+sess[aã]o)\s*:?\s*(\d{2}\/\d{2}\/\d{4}(?:\s*(?:[àa]s|-)?\s*\d{1,2}[:h]\d{2})?)/i;
const dataDisputaDoTexto = (texto) => {
  const m = INICIO_DISPUTA.exec(String(texto || "").replace(/\s+/g, " "));
  return m ? dataBr(m[1].replace(/\s*(?:[àa]s|-)\s*/i, " ")) : null;
};

async function listarRest(cliente, desdeIso, maxPaginas, tempoRestanteMs) {
  const registros = [];
  for (let pagina = 1; pagina <= maxPaginas && tempoRestanteMs() > 20000; pagina++) {
    const url = `${URL_EDITAIS}?per_page=${POR_PAGINA}&page=${pagina}&after=${desdeIso}T00:00:00&orderby=date&order=desc&_fields=id,date,modified,link,title,class_list`;
    let lote;
    try {
      lote = await cliente.json(url);
    } catch (e) {
      // O WordPress responde 400 para página além da última: fim da lista, não falha.
      if (pagina > 1 && /HTTP 400/.test(e.message)) break;
      throw e;
    }
    if (!Array.isArray(lote)) throw new Error("FAEPI: a REST de editais não devolveu lista (a estrutura mudou?)");
    registros.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }
  return registros;
}

// Página + PDF de um edital aberto: objeto de verdade, anexos e data da disputa. Disputa já feita = fechado
// (por isso o PDF é lido aqui e não no detalhe: o coletor só olha "aberto" na listagem).
async function completarAberto(item, { cliente, textoDoPdf, agoraIso }) {
  const pagina = lerPagina(await cliente.texto(item.linkOficial));
  const completo = { ...item, objeto: objetoFinal(item, pagina.descricao), anexos: pagina.anexos, srp: /registro\s+de\s+pre[cç]o/i.test(pagina.descricao) };
  let lido = completo;
  try {
    lido = await lerPdfDoEdital(completo, { cliente, textoDoPdf });
  } catch (e) {
    console.log(`[faepi] PDF de ${item.idExterno} não lido (${e.message}); segue sem a data.`);
  }
  return lido.encerramento && lido.encerramento < agoraIso ? { ...lido, aberto: false } : lido;
}

async function listar({ cliente, textoDoPdf, desdeIso, maxPaginas = 5, tempoRestanteMs = () => Infinity, hojeIso, agoraIso = agoraBrasilia() }) {
  const porId = new Map();
  // A REST vem do mais novo ao mais velho: número repetido (republicação) fica só com o post mais novo.
  for (const e of await listarRest(cliente, desdeIso, maxPaginas, tempoRestanteMs)) {
    const item = itemDoEdital(e, hojeIso);
    if (item && !porId.has(item.idExterno)) porId.set(item.idExterno, item);
  }
  const itens = [];
  for (const item of porId.values()) {
    if (!item.aberto) { itens.push(item); continue; }
    // Sem tempo para a página: o aberto fica de fora (devolver "fechado" apagaria a linha do banco).
    if (tempoRestanteMs() < 20000) continue;
    itens.push(await completarAberto(item, { cliente, textoDoPdf, agoraIso }));
  }
  return itens;
}

// Lê o PDF do edital (primeiro anexo cujo nome começa com "Edital") para a data da disputa.
async function lerPdfDoEdital(item, { cliente, textoDoPdf }) {
  const lista = item.anexos || [];
  const edital = lista.find((a) => /^\W*\d*\W*edital/i.test(a.nome) && /\.pdf$/i.test(a.url)) || lista.find((a) => /\.pdf$/i.test(a.url));
  if (!edital) return item;
  const texto = await textoDoPdf(await cliente.bytes(edital.url));
  if (texto.replace(/\s+/g, "").length < 50) return { ...item, pdfSemTexto: true };
  return { ...item, encerramento: dataDisputaDoTexto(texto) || item.encerramento, pdfSemTexto: false };
}

// Tudo já vem da listagem (inclusive o PDF).
const detalhe = async (item) => item;
const anexos = (item) => item.anexos || [];

module.exports = { FONTE, ORGAO, listar, detalhe, anexos, numeroDoTitulo, objetoDoTitulo, itemDoEdital, lerPagina, objetoFinal, dataDisputaDoTexto, lerPdfDoEdital };
