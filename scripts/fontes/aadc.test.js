const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const aadc = require("./aadc");
const { paraLinha, criarCliente, textoDoPdf } = require("./comum");

const FIX = path.join(__dirname, "..", "fixtures", "fontes", "aadc");
const ler = (nome) => fs.readFileSync(path.join(FIX, nome), "utf8");
const json = (nome) => JSON.parse(ler(nome));

// Cliente falso que responde com as páginas salvas em 25/11/2026 (scripts/fixtures/fontes/aadc/).
function clienteDasFixtures() {
  const POR_SUB = { 2104: "publicacoes-pregao.json", 2488: "publicacoes-cotacao.json", 2102: "publicacoes-dispensa.json", 2527: "publicacoes-credenciamento.json" };
  const posts = [];
  return {
    posts,
    texto: async (url) => (url.endsWith("/client-page/aadc/licitacoes") ? ler("lista-licitacoes.html") : ler("subcategoria-pregao.html")),
    postForm: async (url, campos, headers) => {
      posts.push({ url, campos, headers });
      const arq = POR_SUB[campos.subcategory_id];
      return arq ? json(arq) : { recordsFiltered: 0, data: [] };
    },
  };
}

test("lê a grade de modalidades e o token da sessão da página salva", () => {
  const subs = aadc.subcategoriasDaPagina(ler("lista-licitacoes.html"));
  assert.ok(subs.some((s) => s.id === "2104" && s.nome === "Pregão"));
  assert.ok(subs.some((s) => s.id === "2488" && s.nome === "Convocação para Cotação"));
  assert.deepEqual(aadc.sessaoDaPagina(ler("subcategoria-pregao.html")), { token: "TOKEN_DE_TESTE", entidade: "21" });
  assert.equal(aadc.sessaoDaPagina("<html></html>"), null);
});

test("descrição vira processo, objeto limpo e tipo (aviso x resultado)", () => {
  const pp = aadc.lerDescricao("PP 014/2026 - Contratação de cenografia", 1, "Pregão");
  assert.deepEqual([pp.idExterno, pp.processo, pp.numero, pp.ano, pp.objeto, pp.resultado], ["PP-014/2026", "PP 014/2026", "014", 2026, "Contratação de cenografia", false]);
  assert.equal(aadc.lerDescricao("Credenciamento 01/2024 - Cachê artístico", 2, "Credenciamento").idExterno, "CRED-001/2024");
  assert.equal(aadc.lerDescricao("Credenciamento 002/2025 - Cartão alimentação - Resultado julgamento", 3, "Credenciamento").resultado, true);
  assert.equal(aadc.lerDescricao("Homologação - Aquisição de materiais de sonorização", 4, "Dispensa de Licitação").resultado, true);
  const cot = aadc.lerDescricao("CONVOCAÇÃO PARA COTAÇÃO_AQUISIÇÃO DE MATERIAIS DE LIMPEZA", 99, "Convocação para Cotação");
  assert.deepEqual([cot.idExterno, cot.objeto, cot.resultado], ["PUB-99", "AQUISIÇÃO DE MATERIAIS DE LIMPEZA", false]);
  // "recursos humanos" no objeto não é recurso administrativo.
  assert.equal(aadc.lerDescricao("PP 001/2026 - Gestão de recursos humanos", 5, "Pregão").resultado, false);
});

test("agrupa publicações do mesmo processo: a mais nova manda e resultado encerra", () => {
  const sub = { id: "2527", nome: "Credenciamento" };
  const itens = aadc.agruparPorProcesso(json("publicacoes-credenciamento.json").data.map((p) => ({ ...p, subcategoria: sub })));
  const cred2025 = itens.find((i) => i.idExterno === "CRED-002/2025");
  assert.equal(cred2025.aberto, false, "última publicação é resultado");
  const cred2026 = itens.find((i) => i.idExterno === "CRED-001/2026");
  assert.equal(cred2026.aberto, true);
  assert.equal(cred2026.publicacao, "2026-11-16T09:14:46");
  assert.match(cred2026.linkEdital, /^https:\/\/space-dd1\.sfo2\.digitaloceanspaces\.com\/prod\/transparencia\/aadc\/.+\.pdf$/);

  const pregao = aadc.agruparPorProcesso(json("publicacoes-pregao.json").data.map((p) => ({ ...p, subcategoria: { id: "2104", nome: "Pregão" } })));
  const pp005 = pregao.filter((i) => i.idExterno === "PP-005/2026");
  assert.equal(pp005.length, 1, "republicação não duplica o processo");
  assert.equal(pp005[0].anexos.length, 2);
  assert.equal(pp005[0].publicacao, "2026-03-02T04:39:59");
  assert.equal(pp005[0].srp, true);
});

test("caminho de arquivo estranho não vira link", () => {
  const [item] = aadc.agruparPorProcesso([{ id: 1, description: "PP 001/2026 - X", created_at: "2026-11-01 10:00:00", PDF: "../../etc/passwd", link: null, subcategoria: { id: "2104", nome: "Pregão" } }]);
  assert.equal(item.linkEdital, null);
});

test("data da sessão e prazo da cotação saem do texto do aviso", () => {
  assert.equal(aadc.dataSessaoDoTexto(ler("aviso-pp014-2026.txt")), "2026-11-13T09:00:00");
  assert.equal(aadc.modalidadeDoTexto(ler("aviso-pp014-2026.txt"), "Pregão"), "Pregão - Presencial");
  assert.equal(aadc.dataSessaoDoTexto(ler("aviso-cotacao-eventos.txt")), "2026-11-26T15:00:00");
  assert.equal(aadc.dataSessaoDoTexto("Data da Sessão: 31/02/2026"), null);
  assert.equal(aadc.dataSessaoDoTexto("sem data"), null);
});

test("listar usa a sessão da página, filtra a janela e ignora sorteio e inexigibilidade", async () => {
  const cliente = clienteDasFixtures();
  const itens = await aadc.listar({ cliente, desdeIso: "2026-07-28" });
  const subsPedidas = new Set(cliente.posts.map((p) => p.campos.subcategory_id));
  assert.ok(!subsPedidas.has("2487") && !subsPedidas.has("2103"), "sorteio e inexigibilidade ficam de fora");
  assert.ok(cliente.posts.every((p) => p.campos._token === "TOKEN_DE_TESTE" && p.headers["X-CSRF-TOKEN"] === "TOKEN_DE_TESTE" && p.campos.entity_id === "21"));
  assert.ok(itens.every((i) => i.publicacao >= "2026-07-28"));
  const abertos = itens.filter((i) => i.aberto).map((i) => i.idExterno);
  assert.ok(abertos.includes("PP-016/2026") && abertos.includes("PP-014/2026") && abertos.includes("CRED-001/2026"));
  assert.ok(itens.some((i) => !i.aberto), "homologações da dispensa chegam como encerradas");
});

test("listar falha com mensagem clara quando a página muda", async () => {
  const cliente = { texto: async () => "<html>nada</html>", postForm: async () => ({}) };
  await assert.rejects(aadc.listar({ cliente, desdeIso: "2026-01-01" }), /estrutura mudou/);
});

test("detalhe lê o PDF com texto e marca o escaneado", async () => {
  const item = { idExterno: "PP-014/2026", modalidade: "Pregão", encerramento: null, linkEdital: "https://x/aviso.pdf" };
  const cliente = { bytes: async () => Buffer.from("pdf") };
  const comTexto = await aadc.detalhe(item, { cliente, textoDoPdf: async () => ler("aviso-pp014-2026.txt") });
  assert.deepEqual([comTexto.encerramento, comTexto.modalidade, comTexto.pdfSemTexto], ["2026-11-13T09:00:00", "Pregão - Presencial", false]);
  const escaneado = await aadc.detalhe(item, { cliente, textoDoPdf: async () => "  \n " });
  assert.equal(escaneado.pdfSemTexto, true);
  assert.equal(escaneado.encerramento, null);
});

test("item vira linha de oportunidades_abertas no formato que o painel e o boletim leem", () => {
  const item = { idExterno: "PP-014/2026", aberto: true, objeto: "Cenografia", modalidade: "Pregão - Presencial", processo: "PP 014/2026", numero: "014", ano: 2026, srp: true,
    publicacao: "2026-11-10T13:44:54", encerramento: "2026-11-13T09:00:00", orgao: aadc.ORGAO, linkOficial: "https://oficial", linkEdital: "https://pdf", versao: "7", anexos: [] };
  const linha = paraLinha(aadc.FONTE, item);
  assert.equal(linha.chave, "fonte:aadc:PP-014/2026");
  assert.equal(linha.numero_controle_pncp, null);
  assert.deepEqual([linha.uf, linha.publicacao, linha.encerramento], ["AM", "2026-11-10", "2026-11-13"]);
  const d = linha.dado;
  assert.equal(d.numeroControlePNCP, linha.chave, "o painel abre a edição do boletim pela chave");
  assert.deepEqual([d.orgao, d.municipio, d.fonte, d.link, d.linkSistemaOrigem], ["AGENCIA AMAZONENSE DE DESENVOLVIMENTO CULTURAL", "Manaus", "Portal do órgão, fora do PNCP", "https://pdf", "https://oficial"]);
});

test("cliente HTTP: um pedido por vez com intervalo mínimo, cookie da sessão e User-Agent do projeto", async () => {
  const pedidos = [];
  const fetchImpl = async (url, op) => {
    pedidos.push({ url, em: Date.now(), cookie: op.headers.Cookie, ua: op.headers["User-Agent"] });
    return { ok: true, status: 200, headers: { getSetCookie: () => ["sessao=abc; path=/; HttpOnly"] }, text: async () => "ok" };
  };
  const cliente = criarCliente({ intervaloMs: 120, fetchImpl });
  await Promise.all([cliente.texto("https://a/1"), cliente.texto("https://a/2"), cliente.texto("https://a/3")]);
  assert.equal(pedidos.length, 3);
  assert.ok(pedidos[1].em - pedidos[0].em >= 110 && pedidos[2].em - pedidos[1].em >= 110);
  assert.equal(pedidos[0].cookie, undefined);
  assert.equal(pedidos[1].cookie, "sessao=abc");
  assert.match(pedidos[0].ua, /^LicitaPlenaBot\/1\.0/);
});

test("cliente HTTP: erro 404 falha na hora, sem repetir", async () => {
  let n = 0;
  const cliente = criarCliente({ intervaloMs: 0, tentativas: 2, fetchImpl: async () => { n += 1; return { ok: false, status: 404, headers: {} }; } });
  await assert.rejects(cliente.texto("https://a/x"), /HTTP 404/);
  assert.equal(n, 1);
});

test("textoDoPdf devolve vazio para bytes que não são PDF", async () => {
  assert.equal(await textoDoPdf(Buffer.from("isto não é pdf")), "");
});

// Opcional: TESTE_AO_VIVO=1 node --test scripts/fontes/aadc.test.js (consulta o portal real, 1 pedido por segundo).
test("ao vivo: o portal da AADC ainda responde no formato esperado", { skip: process.env.TESTE_AO_VIVO !== "1" }, async () => {
  const itens = await aadc.listar({ cliente: criarCliente({ intervaloMs: 1000 }), desdeIso: new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10), maxPaginas: 1 });
  assert.ok(itens.length > 0, "nenhuma publicação nos últimos 120 dias");
  assert.ok(itens.every((i) => i.publicacao && i.objeto && i.linkOficial));
});
