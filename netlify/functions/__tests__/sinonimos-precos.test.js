const test = require("node:test");
const assert = require("node:assert/strict");
const { SINONIMOS, traduzirTermo, singular, termosDoDicionario } = require("../_sinonimos_precos");
const { buscaDoCatalogo, chaveDaConsulta, montarCorpo, complementarComPncp, normalizarPncp, padraoDescricao, linkPncp } = require("../comprasgov-marcas-produto");

test("dicionário: 150+ termos populares, cada um com ao menos um nome do catálogo", () => {
  assert.ok(Object.keys(SINONIMOS).length >= 150, `${Object.keys(SINONIMOS).length} termos`);
  for (const [chave, nomes] of Object.entries(SINONIMOS)) {
    assert.equal(chave, chave.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(), `chave sem acento/minúscula: ${chave}`);
    assert.ok(Array.isArray(nomes) && nomes.length && nomes.every((n) => typeof n === "string" && n.length >= 2), chave);
  }
  assert.equal(termosDoDicionario().length, Object.keys(SINONIMOS).length);
});

test("geladeira, televisão, micro-ondas e ar-condicionado viram o nome do catálogo, com plural e acento", () => {
  const casos = {
    geladeira: "refrigerador doméstico", Geladeiras: "refrigerador doméstico", "GELADEIRA": "refrigerador doméstico",
    "televisão": "televisor", "televisões": "televisor", TV: "televisor", "smart tv": "televisor",
    "micro-ondas": "forno microondas", microondas: "forno microondas", "Micro ondas": "forno microondas",
    "ar-condicionado": "aparelho ar condicionado", "ar condicionado": "aparelho ar condicionado", split: "aparelho ar condicionado",
    "ares condicionados": "aparelho ar condicionado", notebook: null, pneus: "pneu", "fogões": "fogão", "papéis": null, computador: "microcomputador",
    celular: "aparelho telefônico celular", "água mineral": "agua mineral natural", "sabão em pó": "sabao po",
  };
  for (const [termo, esperado] of Object.entries(casos)) {
    const t = traduzirTermo(termo);
    assert.equal(t?.automatico ? t.termo : null, esperado, termo);
  }
  assert.deepEqual(traduzirTermo("geladeira").sugestoes, SINONIMOS.geladeira);
});

test("termo que só começa pelo popular não é trocado sozinho: vira sugestão; nome do catálogo vai como está", () => {
  const coco = traduzirTermo("agua de coco");
  assert.equal(coco.automatico, false);
  assert.deepEqual(coco.sugestoes, SINONIMOS.agua);
  assert.equal(traduzirTermo("geladeira consul").automatico, false);
  // O botão de uma sugestão manda o nome do catálogo: não pode virar "refrigerador domestico duplex".
  assert.equal(traduzirTermo("refrigerador duplex"), null);
  assert.equal(traduzirTermo("refrigerador domestico"), null);
  assert.equal(traduzirTermo("liquidificador"), null);
  assert.equal(traduzirTermo(""), null);
});

test("singular: plural comum do português; palavra curta fica", () => {
  assert.deepEqual(["televisoes", "fogoes", "papeis", "geladeiras", "ares", "tv", "gas", "pneus"].map(singular), ["televisao", "fogao", "papel", "geladeira", "ar", "tv", "gas", "pneu"]);
});

test("busca do catálogo usa a tradução só para o produto; a especificação continua no termo e muda a chave do cache", () => {
  assert.equal(buscaDoCatalogo("geladeira 300 litros").busca, "refrigerador doméstico");
  assert.equal(buscaDoCatalogo("caneta azul").busca, "caneta azul");
  const chave = (termo) => chaveDaConsulta({ termo, uf: "", codigoPdm: null, codigoItem: null, pagina: 1, produto: "" });
  assert.equal(chave("caneta"), "marcas-produto|caneta||||1|", "termo sem tradução mantém a chave de antes (pré-consulta vale)");
  assert.equal(chave("Geladeira"), "marcas-produto|geladeira>refrigerador domestico||||1|");
  // Página de um produto já escolhido não passa pelo dicionário.
  assert.equal(chaveDaConsulta({ termo: "geladeira", uf: "AM", codigoPdm: 13629, codigoItem: null, pagina: 2, produto: "Refrigerador doméstico" }), "marcas-produto|geladeira|AM|13629||2|Refrigerador doméstico");
});

function fonteFalsa(catalogoPorPalavra, chamadas) {
  return async (url) => {
    const u = new URL(String(url));
    chamadas.push(u.hostname.includes("cnbs") ? `catalogo:${u.searchParams.get("palavra")}` : `preco:${u.searchParams.get("codigo")}`);
    if (u.hostname.includes("cnbs")) return Response.json(catalogoPorPalavra[u.searchParams.get("palavra")] || []);
    return Response.json({ totalRegistros: 3, resultado: [{ marca: "ELECTROLUX", descricaoItem: "REFRIGERADOR", precoUnitario: 2500, idCompraItem: "1530380590045202500001" + u.searchParams.get("codigo").padStart(5, "0").slice(-1) }] });
  };
}
const consulta = (termo, uf = "") => ({ termo, uf, codigoPdm: null, codigoItem: null, pagina: 1, produto: "" });

test("montarCorpo: 'geladeira' consulta o catálogo como 'refrigerador domestico' e devolve as sugestões", async () => {
  const original = global.fetch, chamadas = [];
  global.fetch = fonteFalsa({ "refrigerador doméstico": [{ codigoPdm: 13629, descricaoPDM: "Refrigerador doméstico" }] }, chamadas);
  try {
    const corpo = JSON.parse((await montarCorpo(consulta("geladeira"))).corpo);
    assert.deepEqual(chamadas, ["catalogo:refrigerador doméstico", "preco:13629"]);
    assert.equal(corpo.buscaCatalogo, "refrigerador doméstico");
    assert.deepEqual(corpo.sugestoes, SINONIMOS.geladeira);
    assert.equal(corpo.catalogos[0].descricao, "Refrigerador doméstico");
    assert.equal(corpo.itens.length, 1);
  } finally { global.fetch = original; }
});

test("montarCorpo: nada no catálogo com o nome inteiro tenta as palavras (a mais longa primeiro, também pelo dicionário)", async () => {
  const original = global.fetch, chamadas = [];
  global.fetch = fonteFalsa({ "refrigerador doméstico": [{ codigoPdm: 13629, descricaoPDM: "Refrigerador doméstico" }] }, chamadas);
  try {
    const corpo = JSON.parse((await montarCorpo(consulta("geladeira consul frost"))).corpo);
    assert.deepEqual(chamadas.slice(0, 2), ["catalogo:geladeira consul frost", "catalogo:refrigerador doméstico"]);
    assert.equal(corpo.buscaCatalogo, "refrigerador doméstico");
    assert.equal(corpo.itens.length, 1);
    // Uma palavra só: não há parte para tentar; volta vazio (a tela mostra as sugestões, se houver).
    chamadas.length = 0;
    const vazio = JSON.parse((await montarCorpo(consulta("xyzabc"))).corpo);
    assert.deepEqual([chamadas, vazio.itens, vazio.catalogos], [["catalogo:xyzabc"], [], []]);
  } finally { global.fetch = original; }
});

test("PNCP complementa quando o Compras.gov trouxe pouco, sem repetir compra e como produto à parte", async () => {
  const linha = (id, valor) => ({ id_compra_item: id, descricao_item: "REFRIGERADOR DOMÉSTICO 300 L", uf: "AM", data_resultado: "2026-10-01",
    item: { numero: 3, unidadeMedida: "Unidade" }, resultado: { valorUnitarioHomologado: valor, quantidadeHomologada: 2 },
    fornecedor: { nome: "LOJA X", documento: "12345678000190" }, compra: { id: "1", cnpjOrgao: "04312419000130", numeroControlePncp: "04312419000130-1-000045/2026" } });
  const pncp = [linha("A1", 2999.9), linha("B2", 3100), linha("C3", null)].map(normalizarPncp);
  const corpo = JSON.stringify({ ok: true, itens: [{ itemCompra: "A1", marca: "ELECTROLUX", codigoPdm: 13629 }], catalogos: [{ codigo: 13629, descricao: "Refrigerador doméstico", total: 1 }], buscaCatalogo: "refrigerador domestico" });
  let pedido;
  const r = JSON.parse(await complementarComPncp(corpo, consulta("geladeira", "AM"), {}, async (...a) => { pedido = a; return pncp.filter((i) => i.valorUnitarioCentavos); }));
  assert.deepEqual(pedido.slice(0, 2), ["refrigerador domestico", "AM"]);
  assert.deepEqual(r.itens.map((i) => i.itemCompra), ["A1", "B2"], "A1 já veio do Compras.gov; C3 sem preço sai");
  assert.equal(r.itens[1].fonte, "PNCP");
  assert.equal(r.itens[1].valorUnitarioCentavos, 310000);
  assert.equal(r.itens[1].orgao, "Órgão CNPJ 04.312.419/0001-30");
  assert.equal(r.itens[1].link, "https://pncp.gov.br/app/editais/04312419000130/2026/45");
  assert.deepEqual(r.catalogos.at(-1), { codigo: "pncp", descricao: "Outras compras no PNCP (estados e municípios)", total: 1, fixo: true });
  // Compras.gov com bastante resultado: não consulta o PNCP.
  const muitos = JSON.stringify({ ok: true, itens: Array.from({ length: 40 }, (_, k) => ({ itemCompra: String(k) })), catalogos: [] });
  assert.equal(await complementarComPncp(muitos, consulta("caneta"), {}, async () => assert.fail("não deveria consultar")), muitos);
});

test("padrão da descrição do PNCP: a palavra mais longa do produto, com acento, sem a especificação", () => {
  assert.equal(padraoDescricao("refrigerador domestico"), "*refrigerador*");
  assert.equal(padraoDescricao("Televisão azul 2 litros"), "*televisão*");
  assert.equal(padraoDescricao("aparelho ar condicionado"), "*condicionado*");
  assert.equal(padraoDescricao("pão"), null);
  assert.equal(linkPncp("lixo"), null);
});
