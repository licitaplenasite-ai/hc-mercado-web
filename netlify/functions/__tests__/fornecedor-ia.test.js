const test = require("node:test");
const assert = require("node:assert/strict");
const { handler, termosDaDescricao, agruparCandidatos, lerAvaliacaoIA } = require("../fornecedor-ia");

const evento = (corpo, metodo = "POST") => ({ httpMethod: metodo, headers: { origin: "https://licitaplena.com.br", authorization: "Bearer t" }, body: JSON.stringify(corpo) });
const linhas = [
  { cnpj_fornecedor: "11111111000111", objeto: "Aquisição de papel sulfite A4", uf: "AM", nome: "Papelaria Um", valor: "1000" },
  { cnpj_fornecedor: "11111111000111", objeto: "Papel sulfite A4 branco", uf: "PA", nome: "Papelaria Um", valor: "500" },
  { cnpj_fornecedor: "22222222000122", objeto: "Papel toalha", uf: "AM", nome: "Limpeza Dois", valor: "300" },
  { cnpj_fornecedor: "33333333000133", objeto: "Sulfite A4 resma", uf: "RR", nome: "Gráfica Três", valor: "200" },
  { cnpj_fornecedor: "44444444000144", objeto: "Papel sulfite", uf: "AC", nome: "Quatro", valor: "100" },
  { cnpj_fornecedor: null, objeto: "Papel sulfite", uf: "AC", nome: "Sem CNPJ", valor: "1" },
];
const receita = { "11111111000111": { cnpj: "11111111000111", opcao_pelo_mei: false, ddd_telefone_1: "9233334444", email: "VENDAS@PAPELARIA.COM.BR", municipio: "MANAUS", uf: "AM", descricao_situacao_cadastral: "ATIVA", cnae_fiscal_descricao: "Comércio de papel" },
  "44444444000144": { cnpj: "44444444000144", opcao_pelo_mei: true, ddd_telefone_1: "6899998888", email: "pessoa@gmail.com", municipio: "RIO BRANCO", uf: "AC" } };
const fetchFalso = async (url) => {
  if (String(url).includes("/rest/v1/contratos")) return new Response(JSON.stringify(linhas));
  const cnpj = String(url).split("/").pop();
  return receita[cnpj] ? new Response(JSON.stringify(receita[cnpj])) : new Response("{}", { status: 404 });
};
const ok = { autenticar: async () => ({ ok: true, userId: "u1" }), limitar: async () => ({ ok: true, usadas: 3, limite: 20 }), env: {}, fetch: fetchFalso };

test("termos: só palavras úteis de 4+ letras, sem acento e sem repetição", () => {
  assert.deepEqual(termosDaDescricao("Preciso de papel sulfite A4 para a escola, papel branco"), ["papel", "sulfite", "escola", "branco"]);
});

test("agrupa por CNPJ e põe primeiro quem tem mais termos no objeto e mais contratos", () => {
  const c = agruparCandidatos(linhas, ["papel", "sulfite"]);
  assert.deepEqual(c.map((x) => x.cnpj), ["11111111000111", "44444444000144", "22222222000122", "33333333000133"]);
  assert.deepEqual(c[0].ufs, ["AM", "PA"]);
  assert.equal(c[0].contratos, 2);
});

test("sem IA: 3 fornecedores com aderência pelos dados, contato só da Receita, MEI sem contato e site nunca inventado", async () => {
  const r = await handler(evento({ descricao: "papel sulfite" }), ok);
  assert.equal(r.statusCode, 200);
  const d = JSON.parse(r.body);
  assert.equal(d.fornecedores.length, 3);
  assert.equal(d.maisDisponiveis, true);
  assert.deepEqual(d.uso, { usadas: 3, limite: 20 });
  const um = d.fornecedores.find((f) => f.cnpj === "11111111000111");
  assert.equal(um.aderencia, 100);
  assert.deepEqual(um.contato, { telefone: "(92) 3333-4444", email: "vendas@papelaria.com.br", site: null, mei: false });
  const mei = d.fornecedores.find((f) => f.cnpj === "44444444000144");
  assert.deepEqual(mei.contato, { telefone: null, email: null, site: null, mei: true });
  const semCadastro = d.fornecedores.find((f) => f.cnpj === "22222222000122");
  assert.equal(semCadastro.contato.telefone, null);
});

test("trazer mais três pula os já mostrados", async () => {
  const r = await handler(evento({ descricao: "papel sulfite", pular: ["11111111000111", "44444444000144", "22222222000122", "x"] }), ok);
  const d = JSON.parse(r.body);
  assert.deepEqual(d.fornecedores.map((f) => f.cnpj), ["33333333000133"]);
  assert.equal(d.maisDisponiveis, false);
});

test("com IA: usa nota e motivo só das empresas enviadas e descarta motivo com contato", async () => {
  let enviado;
  const responder = async (m) => { enviado = JSON.stringify(m); return { ok: true, texto: '{"fornecedores":[{"id":"C1","aderencia":95,"porque":"Fornece papel A4."},{"id":"C2","aderencia":40,"porque":"ligue 92999998888"},{"id":"C9","aderencia":99,"porque":"inventado"}]}' }; };
  const r = await handler(evento({ descricao: "papel sulfite, contato joao@x.com" }), { ...ok, env: { GROQ_API_KEY: "g" }, responder });
  const d = JSON.parse(r.body);
  assert.equal(d.analise, "ia");
  assert.equal(d.fornecedores[0].aderencia, 95);
  assert.equal(d.fornecedores[0].analisePor, "ia");
  assert.ok(d.fornecedores.slice(1).every((f) => f.analisePor === "dados"));
  assert.ok(!/joao@x|3333-4444|vendas@/.test(enviado));
});

test("lerAvaliacaoIA rejeita nota fora de 0-100 e JSON inválido", () => {
  assert.equal(lerAvaliacaoIA('{"fornecedores":[{"id":"C1","aderencia":150,"porque":"x"}]}', new Set(["C1"])).size, 0);
  assert.equal(lerAvaliacaoIA("não sei", new Set(["C1"])).size, 0);
});

test("barreiras: login, método, descrição vazia e limite diário antes de consultar", async () => {
  const nada = { fetch: async () => assert.fail("consultou"), responder: async () => assert.fail("IA chamada") };
  assert.equal((await handler(evento({ descricao: "papel" }), { ...ok, ...nada, autenticar: async () => ({ ok: false, status: 401, erro: "x" }) })).statusCode, 401);
  assert.equal((await handler(evento({}, "GET"), { ...ok, ...nada })).statusCode, 405);
  assert.equal((await handler(evento({ descricao: "a4" }), { ...ok, ...nada, limitar: async () => assert.fail("cota gasta") })).statusCode, 400);
  assert.equal((await handler(evento({ descricao: "papel" }), { ...ok, ...nada, limitar: async () => ({ ok: false, status: 429, erro: "Limite" }) })).statusCode, 429);
});

test("falha na consulta de contratos vira 503 sem detalhe interno", async () => {
  const r = await handler(evento({ descricao: "papel" }), { ...ok, fetch: async () => new Response("segredo", { status: 500 }) });
  assert.equal(r.statusCode, 503);
  assert.doesNotMatch(r.body, /segredo|HTTP/);
});
