const test = require("node:test");
const assert = require("node:assert/strict");
const { marcaUtil, selecionarPdms, normalizarResultado } = require("../comprasgov-marcas-produto");

test("selecionarPdms remove duplicados e prioriza descrições que começam pelo produto", () => {
  const pdms = selecionarPdms([
    { codigoPdm: 4416, descricaoPDM: "Caneta permanente" },
    { codigoPdm: 99, descricaoPDM: "Caneta esferográfica" },
    { codigoPdm: 99, descricaoPDM: "Caneta esferográfica" },
  ], "caneta");
  assert.equal(pdms.length, 2);
  assert.equal(pdms[0].codigo, 99);
});

test("normalizarResultado expõe somente marca declarada pela fonte", () => {
  assert.equal(marcaUtil("."), null);
  assert.equal(marcaUtil("NÃO SE APLICA"), null);
  assert.equal(marcaUtil("2025"), null);
  const item = normalizarResultado({ marca: "BIC", nomeFornecedor: "Fornecedor", estado: "SE", precoUnitario: "0.54" }, { codigo: 99, descricao: "Caneta esferográfica" });
  assert.equal(item.marca, "BIC");
  assert.equal(item.uf, "SE");
  assert.equal(item.valorUnitario, 0.54);
});

const { separarMarcaModelo, centavosDoPreco, MAX_PDMS } = require("../comprasgov-marcas-produto");
const handler = require("./fixtures/login-aprovado").comoLogado(require("../comprasgov-marcas-produto").handler);

test("marcaUtil descarta medida, característica repetida da descrição e textos genéricos", () => {
  assert.equal(marcaUtil("A4 90 GRAMAS", "PAPEL PARA IMPRESSÃO FORMATADO, GRAMATURA 90 G/M2"), null);
  assert.equal(marcaUtil("20L", "DETERGENTE"), null);
  assert.equal(marcaUtil("GALÃO C/ 5 LTS", "DETERGENTE"), null);
  assert.equal(marcaUtil("Cor: Amarela", "CLASSIFICADOR"), null);
  assert.equal(marcaUtil("Conforme TR", ""), null);
  assert.equal(marcaUtil("Não informado ", ""), null);
  assert.equal(marcaUtil("UND", ""), null);
  assert.equal(marcaUtil("térmico", "PAPEL PARA IMPRESSÃO BOBINADO, TIPO: TÉRMICO"), null);
  assert.equal(marcaUtil("BIC", "CANETA ESFEROGRÁFICA, MATERIAL: PLÁSTICO"), "BIC");
  assert.equal(marcaUtil("Ypê", "DETERGENTE, COMPOSIÇÃO: TENSOATIVOS"), "Ypê");
});

test("normalizarResultado recusa marca que repete o nome do produto e monta link, unidade e centavos", () => {
  // Como chega da fonte: número JSON de 17 dígitos, já arredondado pelo JSON.parse.
  const idCompraFonte = JSON.parse('{"id":15303805900452025}').id;
  const pdm = { codigo: 6136, descricao: "Detergente", ordem: 0 };
  // Marca que repete o produto não vira marca, mas a compra fica (grupo "marca não informada").
  const semMarca = normalizarResultado({ marca: "DETERGENTE DESINCRUS", descricaoItem: "DETERGENTE", precoUnitario: 2 }, pdm);
  assert.equal(semMarca.marca, null);
  assert.equal(semMarca.valorUnitarioCentavos, 200);
  assert.equal(normalizarResultado({ marca: "sm", descricaoItem: "DETERGENTE" }, pdm).marca, null);
  const item = normalizarResultado({ marca: "Ypê", descricaoItem: "DETERGENTE LÍQUIDO", precoUnitario: 1.385, siglaUnidadeFornecimento: "emb", nomeUnidadeFornecimento: "EMBALAGEM", idCompra: idCompraFonte, idCompraItem: "1530380590045202500021", estado: "ba" }, pdm);
  assert.equal(item.valorUnitarioCentavos, 139);
  assert.equal(item.unidade, "EMB");
  assert.equal(item.uf, "BA");
  // O número JSON perde precisão (…025 -> …024); o idCompraItem em texto preserva.
  assert.match(item.link, /compra=15303805900452025$/);
  assert.equal(item.compra, "15303805900452025");
  // Nº do item na compra: do numeroItemCompra; sem ele, dos 5 últimos dígitos do idCompraItem; sem nenhum, null.
  assert.equal(item.numeroItem, 21);
  assert.equal(normalizarResultado({ marca: "Ypê", descricaoItem: "X", numeroItemCompra: 107, idCompraItem: "1530380590045202500021" }, pdm).numeroItem, 107);
  assert.equal(normalizarResultado({ marca: "Ypê", descricaoItem: "X", idCompra: "15303805900452025" }, pdm).numeroItem, null);
  assert.equal(normalizarResultado({ marca: "Ypê", descricaoItem: "X", idCompraItem: "1530380590045202500000" }, pdm).numeroItem, null);
  assert.equal(normalizarResultado({ marca: "Ypê", descricaoItem: "X", idCompra: idCompraFonte }, pdm).link, null);
  assert.equal(normalizarResultado({ marca: "Ypê", descricaoItem: "X", idCompra: "../x" }, pdm).link, null);
});

test("separarMarcaModelo só separa quando a fonte escreveu os rótulos", () => {
  assert.deepEqual(separarMarcaModelo("BIC / Modelo Cristal"), { marca: "BIC", modelo: "Cristal", fabricante: null });
  assert.deepEqual(separarMarcaModelo("Marca: Faber Castell; Modelo: 1212"), { marca: "Faber Castell", modelo: "1212", fabricante: null });
  assert.deepEqual(separarMarcaModelo("Tilibra Fabricante: Tilibra SA"), { marca: "Tilibra", modelo: null, fabricante: "Tilibra SA" });
  assert.deepEqual(separarMarcaModelo("Chamex"), { marca: "Chamex", modelo: null, fabricante: null });
});

test("centavosDoPreco converte sem float e arredonda meio centavo para cima", () => {
  assert.equal(centavosDoPreco(0.49), 49);
  assert.equal(centavosDoPreco(66.5854), 6659);
  assert.equal(centavosDoPreco(66.5849), 6658);
  assert.equal(centavosDoPreco("1.005"), 101);
  assert.equal(centavosDoPreco(0.1 + 0.2), 30);
  assert.equal(centavosDoPreco(1e-7), null);
  assert.equal(centavosDoPreco(0), null);
  assert.equal(centavosDoPreco(-3), null);
  assert.equal(centavosDoPreco("abc"), null);
  assert.equal(centavosDoPreco(Number.NaN), null);
});

test("selecionarPdms usa apelido para papel A4, corta PDMs sem o termo e respeita o limite", () => {
  const pdms = selecionarPdms([
    { codigoPdm: 1160, descricaoPDM: "Dobradeira papel" },
    { codigoPdm: 125, descricaoPDM: "Papel jornal" },
    { codigoPdm: 19746, descricaoPDM: "Papel para impressão formatado" },
  ], "papel A4");
  assert.deepEqual(pdms.map((p) => p.codigo), [19746]);
  const muitos = Array.from({ length: 30 }, (_, k) => ({ codigoPdm: k + 1, descricaoPDM: `Detergente ${k}` }));
  assert.equal(selecionarPdms(muitos, "detergente").length, MAX_PDMS);
  assert.equal(selecionarPdms([{ codigoPdm: 6136, descricaoPDM: "Detergente" }, { codigoPdm: 6135, descricaoPDM: "Detergente - industrial" }], "detergente")[0].codigo, 6136);
});

test("handler valida termo e UF antes de chamar a fonte e limita subrequisições", async () => {
  const original = global.fetch;
  const chamadas = [];
  global.fetch = async (url) => {
    chamadas.push(String(url));
    if (String(url).includes("cnbs")) return { ok: true, json: async () => Array.from({ length: 40 }, (_, k) => ({ codigoPdm: k + 1, descricaoPDM: `Caneta ${k}` })) };
    return { ok: true, json: async () => ({ resultado: [{ marca: "BIC", descricaoItem: "CANETA", precoUnitario: 0.5, idCompra: "15303805900452025" }] }) };
  };
  try {
    assert.equal((await handler({ queryStringParameters: { termo: "a" } })).statusCode, 400);
    assert.equal((await handler({ queryStringParameters: { termo: "caneta", uf: "1A" } })).statusCode, 400);
    assert.equal(chamadas.length, 0);
    const r = await handler({ queryStringParameters: { termo: "caneta" } });
    assert.equal(r.statusCode, 200);
    assert.equal(chamadas.length, 1 + MAX_PDMS);
    assert.ok(chamadas.length <= 50);
    assert.match(r.headers["Cache-Control"], /max-age=600/);
    assert.ok(chamadas.slice(1).every((u) => Number(new URL(u).searchParams.get("tamanhoPagina")) * MAX_PDMS <= 200));
  } finally {
    global.fetch = original;
  }
});

test("selecionarPdms com termo de duas palavras fica só com o PDM que tem as duas", () => {
  const pdms = selecionarPdms([
    { codigoPdm: 18073, descricaoPDM: "Caneta - indicador" },
    { codigoPdm: 99, descricaoPDM: "Caneta esferográfica" },
    { codigoPdm: 2712, descricaoPDM: "Caneta alta rotação" },
  ], "caneta esferográfica");
  assert.deepEqual(pdms.map((p) => p.codigo), [99]);
  // Nenhum PDM com todas as palavras: mantém os parciais em vez de devolver nada.
  assert.equal(selecionarPdms([{ codigoPdm: 1, descricaoPDM: "Caneta" }], "caneta azul").length, 1);
});

const { separarEspecificacao, marcarEspecificacao } = require("../comprasgov-marcas-produto");

test("marcaUtil descarta siglas, medidas, cores, referência ao edital, preço e números; mantém marca real", () => {
  const sujas = ["sm", "TR", "tt", "C TR", "s/m", "eco", "INK", "sem", "20L", "1LT", "FRASCO 1L", "MILILITRO", "A4 90 gramas", "A4 BRANCO", "A3 ? 75g/m2",
    "Azul", "Conforme TR/edital", "Conforme o TR", "de acordo com o edital", "Não informado", "Não especificado", "Própria", "PRÓPRIA/PRÓPRIO", "Genérica",
    "GENÉRICO", "Marca/Fabricante", "Marca: PRÓPRIA", "R$ 26,49", "12345", "2025", "-", "DEC. PROPOSTA"];
  for (const m of sujas) assert.equal(marcaUtil(m, "DETERGENTE"), null, m);
  assert.equal(marcaUtil("3M", ""), "3M");
  assert.equal(marcaUtil("HP", ""), "HP");
  assert.equal(marcaUtil("ABC", ""), "ABC");
  assert.equal(marcaUtil("Diabo Verde", "DETERGENTE"), "Diabo Verde");
  assert.equal(marcaUtil("WEIZUR A-500 PREMIUM", "DETERGENTE"), "WEIZUR A-500 PREMIUM");
});

test("marcaUtil limpa pontuação e marca repetida", () => {
  assert.equal(marcaUtil("-EXBOM", ""), "EXBOM");
  assert.equal(marcaUtil("REPORT/REPORT", ""), "REPORT");
  assert.equal(marcaUtil("NSK - NSK", ""), "NSK");
  assert.equal(marcaUtil("ENZ ENZ", ""), "ENZ");
  assert.equal(marcaUtil("Diabo Verde/ Diabo Verde", ""), "Diabo Verde");
  assert.equal(marcaUtil("Marca: Faber; Modelo: 1212", ""), "Faber; Modelo: 1212");
});

test("separarEspecificacao: tira medida, formato e cor do termo e confere na descrição", () => {
  const papel = separarEspecificacao("papel A4");
  assert.equal(papel.produto, "papel");
  assert.deepEqual(papel.atributos.map((a) => a.rotulo), ["A4"]);
  const [a4] = papel.atributos;
  assert.equal(a4.confere("PAPEL PARA IMPRESSÃO FORMATADO, TAMANHO (C X L): 297 X 210 MM, GRAMATURA: 75 G/M2"), true);
  assert.equal(a4.confere("PAPEL A4 SULFITE"), true);
  assert.equal(a4.confere("PAPEL PARA IMPRESSÃO FORMATADO, TIPO: COUCHÊ , TAMANHO (C X L): 960 X 660 MM"), false);
  const caneta = separarEspecificacao("caneta esferográfica azul");
  assert.equal(caneta.produto, "caneta esferografica");
  assert.equal(caneta.atributos[0].confere("CANETA ESFEROGRÁFICA, COR TINTA: AZUL"), true);
  assert.equal(caneta.atributos[0].confere("CANETA ESFEROGRÁFICA, COR TINTA: PRETA"), false);
  const det = separarEspecificacao("detergente 500 ml");
  assert.equal(det.produto, "detergente");
  assert.equal(det.atributos[0].confere("DETERGENTE LÍQUIDO 500 ML"), true);
  assert.equal(det.atributos[0].confere("DETERGENTE 0,5 L"), true);
  assert.equal(det.atributos[0].confere("DETERGENTE 5 L"), false);
  assert.equal(det.atributos[0].confere("DETERGENTE 500 G"), false);
  const gram = separarEspecificacao("papel A4 75g");
  assert.deepEqual(gram.atributos.map((a) => a.rotulo).sort(), ["75g", "A4"]);
  assert.equal(gram.atributos.find((a) => a.rotulo === "75g").confere("GRAMATURA: 75 G/M2"), true);
  assert.equal(gram.atributos.find((a) => a.rotulo === "75g").confere("GRAMATURA: 90 G/M2"), false);
  assert.deepEqual(separarEspecificacao("detergente neutro").atributos, []);
});

test("marcarEspecificacao usa a embalagem da fonte (FR 500 ML) e é null sem atributo no termo", () => {
  const itens = [{ descricaoItem: "DETERGENTE, ASPECTO FÍSICO: LÍQUIDO", embalagem: "500 ML" }, { descricaoItem: "DETERGENTE, ASPECTO FÍSICO: LÍQUIDO", embalagem: "5 L" }, { descricaoItem: "DETERGENTE", embalagem: null }];
  assert.deepEqual(marcarEspecificacao(itens, "detergente 500 ml").map((i) => i.especificacao), [true, false, false]);
  assert.deepEqual(marcarEspecificacao(itens, "detergente").map((i) => i.especificacao), [null, null, null]);
  assert.equal(normalizarResultado({ marca: "Ypê", descricaoItem: "DETERGENTE", capacidadeUnidadeFornecimento: 500, siglaUnidadeMedida: "ml" }, { codigo: 1, descricao: "Detergente" }).embalagem, "500 ML");
  assert.equal(normalizarResultado({ marca: "Ypê", descricaoItem: "DETERGENTE", capacidadeUnidadeFornecimento: 0, siglaUnidadeMedida: "L" }, { codigo: 1, descricao: "Detergente" }).embalagem, null);
});

test("selecionarPdms ignora a especificação do termo: caneta azul fica só na esferográfica; papel A4 só no apelido", () => {
  const canetas = [{ codigoPdm: 99, descricaoPDM: "Caneta esferográfica" }, { codigoPdm: 2712, descricaoPDM: "Caneta alta rotação" }, { codigoPdm: 18073, descricaoPDM: "Caneta - indicador" }];
  assert.deepEqual(selecionarPdms(canetas, "caneta esferográfica azul").map((p) => p.codigo), [99]);
  const papeis = [{ codigoPdm: 19746, descricaoPDM: "Papel para impressão formatado" }, { codigoPdm: 1, descricaoPDM: "Papel alumínio" }, { codigoPdm: 2, descricaoPDM: "Papel almaço" }];
  assert.deepEqual(selecionarPdms(papeis, "papel A4").map((p) => p.codigo), [19746]);
  assert.equal(selecionarPdms([{ codigoPdm: 6136, descricaoPDM: "Detergente" }, { codigoPdm: 6135, descricaoPDM: "Detergente - industrial" }], "detergente 500 ml")[0].codigo, 6136);
});

test("handler devolve atributos do termo e compras sem marca aproveitável", async () => {
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("cnbs")) return { ok: true, json: async () => [{ codigoPdm: 99, descricaoPDM: "Caneta esferográfica" }] };
    return { ok: true, json: async () => ({ resultado: [
      { marca: "BIC", descricaoItem: "CANETA ESFEROGRÁFICA, COR TINTA: AZUL", precoUnitario: 0.81 },
      { marca: "sm", descricaoItem: "CANETA ESFEROGRÁFICA, COR TINTA: AZUL", precoUnitario: 0.9 },
      { marca: "BIC", descricaoItem: "CANETA ESFEROGRÁFICA, COR TINTA: PRETA", precoUnitario: 0.8 },
    ] }) };
  };
  try {
    const j = JSON.parse((await handler({ queryStringParameters: { termo: "caneta esferográfica azul" } })).body);
    assert.deepEqual(j.atributos, ["azul"]);
    assert.deepEqual(j.itens.map((i) => [i.marca, i.especificacao]), [["BIC", true], [null, true], ["BIC", false]]);
  } finally {
    global.fetch = original;
  }
});

test("codigoItem (CATMAT do PNCP) faz 1 consulta exata por codigoItemCatalogo e valida o código", async () => {
  const original = global.fetch;
  const chamadas = [];
  global.fetch = async (url) => {
    chamadas.push(String(url));
    return { ok: true, json: async () => ({ totalRegistros: 1, totalPaginas: 1, resultado: [{ marca: "BIC", descricaoItem: "CANETA", precoUnitario: 0.5, codigoItemCatalogo: 622254 }] }) };
  };
  try {
    assert.equal((await handler({ queryStringParameters: { termo: "caneta", codigoItem: "abc" } })).statusCode, 400);
    const r = await handler({ queryStringParameters: { termo: "caneta", codigoItem: "622254", produto: "caneta" } });
    assert.equal(r.statusCode, 200);
    assert.equal(chamadas.length, 1);
    const q = new URL(chamadas[0]).searchParams;
    assert.equal(q.get("tipo"), "codigoItemCatalogo");
    assert.equal(q.get("codigo"), "622254");
    assert.equal(JSON.parse(r.body).itens[0].marca, "BIC");
  } finally {
    global.fetch = original;
  }
});

test("busca por termo: produto lento vira pendente (resposta parcial sem esperar) e não é guardada; completa é guardada", async () => {
  const { consultarComPrazo } = require("../comprasgov-marcas-produto");
  require("../_cache_publico")._limparMemoria();
  const original = global.fetch;
  let lento = true, chamadas = 0;
  global.fetch = async (url) => {
    chamadas += 1;
    const u = new URL(String(url));
    if (u.hostname.includes("cnbs")) return { ok: true, json: async () => [{ codigoPdm: 1, descricaoPDM: "Grampeador" }, { codigoPdm: 2, descricaoPDM: "Grampeador alicate" }] };
    if (u.searchParams.get("codigo") === "2" && lento) await new Promise((ok) => setTimeout(ok, 400));
    return { ok: true, json: async () => ({ totalRegistros: 5, resultado: [{ marca: "BRW", descricaoItem: "GRAMPEADOR", precoUnitario: 10, idCompraItem: "153038059004520250000100001" }] }) };
  };
  try {
    // Prazo curto para o teste: o pendente não segura a resposta depois que um produto já trouxe compras.
    const inicio = Date.now();
    const estados = await consultarComPrazo([Promise.resolve({ itens: [1] }), new Promise((ok) => setTimeout(() => ok({ itens: [1] }), 300))], 30);
    assert.deepEqual(estados.map((e) => e.status), ["fulfilled", "pendente"]);
    assert.ok(Date.now() - inicio < 200);
    // Sem nenhum produto com compras, espera todos (não devolve tela vazia por pressa).
    const todos = await consultarComPrazo([Promise.resolve({ itens: [] }), new Promise((ok) => setTimeout(() => ok({ itens: [1] }), 60))], 10);
    assert.deepEqual(todos.map((e) => e.status), ["fulfilled", "fulfilled"]);

    lento = false;
    const a = await handler({ queryStringParameters: { termo: "grampeador" } });
    assert.equal(a.headers["X-Dados-Origem"], "ao-vivo");
    const antes = chamadas;
    const b = await handler({ queryStringParameters: { termo: "Grampeador " } });
    assert.equal(b.headers["X-Dados-Origem"], "cache");
    assert.equal(chamadas, antes, "a 2ª busca do mesmo termo não vai à fonte");
    assert.equal(b.body, a.body);
  } finally {
    global.fetch = original;
  }
});

test("termoParaContagem: minúsculo sem acento; CPF/CNPJ ou só números não entram na contagem", () => {
  const { termoParaContagem } = require("../comprasgov-marcas-produto");
  assert.equal(termoParaContagem("  Papel   A4 (Sulfite)  "), "papel a4 sulfite");
  assert.equal(termoParaContagem("Água sanitária"), "agua sanitaria");
  assert.equal(termoParaContagem("123.456.789-01 caneta"), null);
  assert.equal(termoParaContagem("12345678000190"), null);
  assert.equal(termoParaContagem("622254"), null);
  assert.equal(termoParaContagem("toner 85a"), "toner 85a");
});

test("pré-consulta do robô: responde da tabela sem ir à fonte, com a data; vencida (> 26 h) é ignorada; busca contada sem usuário", async () => {
  require("../_cache_publico")._limparMemoria();
  const { chaveDaConsulta, handler: semLogin } = require("../comprasgov-marcas-produto");
  const { logado } = require("./fixtures/login-aprovado");
  const handler = (evento) => semLogin(logado(evento));
  const original = global.fetch, chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const chamadas = [], contadas = [];
  let atualizado = new Date(Date.now() - 3600 * 1000).toISOString();
  const corpoGuardado = JSON.stringify({ ok: true, itens: [{ marca: "CHAMEX" }], catalogos: [] });
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srv";
  global.fetch = async (url, op = {}) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return Response.json({ id: "00000000-0000-4000-8000-000000000001" });
    if (u.includes("/rest/v1/clientes?")) return Response.json([{ status: "aprovado" }]);
    if (u.includes("/rest/v1/cache_consultas_publicas?")) {
      chamadas.push("tabela");
      assert.equal(op.headers.Authorization, "Bearer teste", "lê com a sessão do usuário (RLS), não com a chave de serviço");
      assert.ok(u.includes(encodeURIComponent(chaveDaConsulta({ termo: "papel a4", uf: "", codigoPdm: null, codigoItem: null, pagina: 1, produto: "" }))));
      return Response.json([{ corpo: corpoGuardado, atualizado_em: atualizado }]);
    }
    if (u.includes("/rpc/registrar_busca_termo")) { contadas.push(JSON.parse(op.body)); return new Response("", { status: 204 }); }
    if (u.includes("/rpc/")) return Response.json(1);
    chamadas.push("fonte");
    if (u.includes("cnbs")) return Response.json([{ codigoPdm: 1, descricaoPDM: "Papel para impressão formatado" }]);
    return Response.json({ totalRegistros: 1, resultado: [{ marca: "REPORT", descricaoItem: "PAPEL A4", precoUnitario: 20, idCompraItem: "153038059004520250000100001" }] });
  };
  try {
    const r = await handler({ queryStringParameters: { termo: "Papel A4" } });
    assert.deepEqual([r.statusCode, r.body, r.headers["X-Dados-Origem"], r.headers["X-Dados-Guardados-Em"]], [200, corpoGuardado, "pre-consulta", atualizado]);
    assert.deepEqual(chamadas, ["tabela"]);
    assert.deepEqual(contadas, [{ p_fonte: "precos", p_termo: "papel a4" }]);
    assert.ok(!JSON.stringify(contadas).includes("teste"), "a contagem não leva token nem usuário");
    // Página de um produto não conta como busca nova.
    await handler({ queryStringParameters: { termo: "papel a4", codigoPdm: "1", pagina: "2", produto: "Papel" } });
    assert.equal(contadas.length, 1);
    atualizado = new Date(Date.now() - 27 * 3600 * 1000).toISOString();
    chamadas.length = 0;
    const vencida = await handler({ queryStringParameters: { termo: "papel a4" } });
    assert.equal(vencida.headers["X-Dados-Origem"], "ao-vivo");
    assert.ok(chamadas.includes("fonte"));
  } finally {
    global.fetch = original;
    if (chaveAnterior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
  }
});

test("montarCorpo (robô): 429 da fonte devolve o tempo de espera pedido (Retry-After) e marca parcial", async () => {
  const { montarCorpo } = require("../comprasgov-marcas-produto");
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("cnbs")) return Response.json([{ codigoPdm: 1, descricaoPDM: "Detergente" }, { codigoPdm: 2, descricaoPDM: "Detergente líquido" }]);
    if (new URL(String(url)).searchParams.get("codigo") === "2") return new Response("{}", { status: 429, headers: { "Retry-After": "30" } });
    return Response.json({ totalRegistros: 1, resultado: [{ marca: "YPE", descricaoItem: "DETERGENTE", precoUnitario: 2 }] });
  };
  try {
    const r = await montarCorpo({ termo: "detergente", uf: "", codigoPdm: null, codigoItem: null, pagina: 1, produto: "" }, { prazoParcialMs: 30000 });
    assert.deepEqual([r.parcial, r.esperarS], [true, 30]);
  } finally {
    global.fetch = original;
  }
});
