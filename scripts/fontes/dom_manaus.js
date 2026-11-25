// Adaptador do Diário Oficial do Município de Manaus (DOM), site Plone da Prefeitura.
// Quem roda: scripts/coletar_diarios_am.js.
//
// De onde vêm os dados (conferido em 25/11/2026; robots.txt de dom.manaus.am.gov.br libera tudo para anônimos):
//   GET /diario-oficial-de-manaus/RSS -> RSS 1.0 com as últimas ~15 publicações; cada item é um PDF
//       /pdf/AAAA/<mês>/DOM%20<edição>%20<dd.mm.aaaa>%20CAD%20<n>.pdf (um PDF por caderno; "ED EXTRA" na extra).
//   O PDF tem camada de texto (44 a 56 páginas por caderno, 1 a 4 MB). Volume de compra é baixo: Manaus publica a
//   maioria no PNCP/Compras Manaus; aqui aparecem chamamentos, avisos de dispensa e extratos.
//   O servidor às vezes derruba a conexão (ECONNRESET) no primeiro pedido do PDF: o cliente de comum.js já repete.
const { classificar, segmentarPaginas, modalidadeNumero, TIPOS_OPORTUNIDADE } = require("./diario_extracao");
// Bloco curto sem número é só o cabeçalho da Comissão ("AVISO DE LICITAÇÃO / ... torna público:"); os pregões vêm nos blocos seguintes.
const MIN_BLOCO_SEM_NUMERO = 400;

const BASE = "https://dom.manaus.am.gov.br";
const URL_RSS = `${BASE}/diario-oficial-de-manaus/RSS`;
const TEMPO_PDF_MS = 60000;
const FONTE = {
  id: "diario-dom-manaus",
  nome: "Diário Oficial do Município de Manaus (DOM)",
  rotulo: "DOM Manaus",
  portal: "Diário Oficial do Município de Manaus",
  paginaOficial: `${BASE}/diario-oficial-de-manaus`,
};
const ORGAO_PADRAO = "Prefeitura Municipal de Manaus";

// RSS -> [{ url, edicao, dia, caderno }] (só PDFs de edição com data no nome).
function lerRss(xml) {
  const urls = new Set([...String(xml).matchAll(/rdf:(?:resource|about)="([^"]+\.pdf)"/gi)].map((m) => m[1]));
  const saida = [];
  for (const url of urls) {
    const nome = decodeURIComponent(url.split("/").pop());
    const m = /DOM\s+(\d+)\s+(\d{2})\.(\d{2})\.(\d{4})\s*(.*)\.pdf$/i.exec(nome);
    if (m) saida.push({ url, edicao: m[1], dia: `${m[4]}-${m[3]}-${m[2]}`, caderno: m[5].trim() || "CAD 1" });
  }
  return saida;
}

// Texto por página com o PDF.js que vem no pdf-parse (mesmo carregamento de netlify/functions/_empresa_pdf_leitor.js,
// que não serve aqui por limitar a 2 MB e 8 páginas). Página sem texto (escaneada) volta vazia.
async function lerPaginasPdf(bytes) {
  const pdf = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
  const { WorkerMessageHandler } = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js");
  const port = new pdf.LoopbackPort(true);
  const worker = pdf.PDFWorker.fromPort(port);
  WorkerMessageHandler.initializeFromPort(port);
  const tarefa = pdf.getDocument({ data: new Uint8Array(bytes), worker });
  let timer;
  try {
    const leitura = (async () => {
      const doc = await tarefa;
      const paginas = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const { items } = await (await doc.getPage(p)).getTextContent();
        let y = null;
        let texto = "";
        for (const it of items) {
          const yi = it.transform && it.transform[5];
          texto += y === null ? "" : Math.abs(yi - y) > 2 ? "\n" : " ";
          texto += it.str;
          y = yi;
        }
        paginas.push({ pagina: p, texto });
      }
      return paginas;
    })();
    return await Promise.race([leitura, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("tempo de leitura do PDF esgotado")), TEMPO_PDF_MS); })]);
  } finally {
    clearTimeout(timer);
    try { await tarefa.destroy(); } finally { worker.destroy(); port.terminate(); }
  }
}

// Blocos de um caderno -> publicações (cada bloco já tem o texto inteiro, então não há segundo pedido).
function publicacoesDoCaderno(caderno, paginas) {
  const saida = [];
  segmentarPaginas(paginas).forEach((b, i) => {
    const tipo = classificar(b.titulo, b.texto);
    if (!tipo) return;
    if (TIPOS_OPORTUNIDADE.has(tipo) && b.texto.length < MIN_BLOCO_SEM_NUMERO && !modalidadeNumero(b.titulo, b.texto).numero) return;
    saida.push({
      idExterno: `${caderno.edicao}-${caderno.caderno.replace(/\s+/g, "")}-p${b.pagina}-${i + 1}`,
      titulo: b.titulo, tipo, publicacao: caderno.dia, edicao: caderno.edicao, pagina: b.pagina,
      orgao: { nome: b.orgao || ORGAO_PADRAO, municipio: "Manaus", uf: "AM", esfera: "M" },
      linkOficial: `${caderno.url}#page=${b.pagina}`,
      linkEdicao: caderno.url,
      texto: TIPOS_OPORTUNIDADE.has(tipo) ? b.texto : b.texto.slice(0, 600),
    });
  });
  return saida;
}

// ctx: { cliente, desde, ate, lidos (Set de URLs de caderno já lidas), tempoRestanteMs }.
async function listar(ctx) {
  const cadernos = lerRss(await ctx.cliente.texto(URL_RSS)).filter((c) => c.dia >= ctx.desde && c.dia <= ctx.ate && !ctx.lidos.has(c.url));
  const publicacoes = [];
  const lidas = [];
  for (const caderno of cadernos) {
    if (ctx.tempoRestanteMs() < 90000) break;
    try {
      const paginas = await lerPaginasPdf(await ctx.cliente.bytes(caderno.url));
      if (!paginas.some((p) => p.texto.trim())) console.log(`[${FONTE.id}] ${caderno.url} sem camada de texto (escaneado).`);
      publicacoes.push(...publicacoesDoCaderno(caderno, paginas));
      lidas.push(caderno.url);
    } catch (e) {
      console.log(`[${FONTE.id}] Caderno ${caderno.url} não lido (${e.message}); fica para a próxima rodada.`);
    }
  }
  return { publicacoes, lidas };
}

module.exports = { FONTE, listar, lerRss, publicacoesDoCaderno, lerPaginasPdf };
