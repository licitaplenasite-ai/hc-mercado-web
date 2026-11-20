// /api/situacao-sicaf: só logado e aprovado, CNPJ validado, lê os dados abertos do Compras.gov (dublê do fetch).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../situacao-sicaf");

const U = "11111111-1111-4111-8111-111111111111";
async function comFetch(responder, fn) {
  const anterior = global.fetch, chamadas = [];
  global.fetch = async (url, op = {}) => {
    const u = new URL(url);
    if (u.pathname === "/auth/v1/user") return op.headers.Authorization === "Bearer TOKEN-U" ? Response.json({ id: U }) : new Response("{}", { status: 401 });
    if (u.pathname === "/rest/v1/clientes") return Response.json([{ status: "aprovado" }]);
    chamadas.push(u);
    return responder(u);
  };
  try { return await fn(chamadas); } finally { global.fetch = anterior; }
}
const evento = (cnpj, headers = { authorization: "Bearer TOKEN-U" }, httpMethod = "GET") => ({ httpMethod, headers, queryStringParameters: { cnpj } });
const FORNECEDOR = { ativo: true, habilitadoLicitar: true, cnpj: "11222333000181", nomeRazaoSocialFornecedor: "EMPRESA TESTE LTDA" };

test("cadastro ativo e habilitado: devolve situação, fonte e data da consulta", () => comFetch(() => Response.json({ resultado: [FORNECEDOR] }), async (chamadas) => {
  const r = await handler(evento("11.222.333/0001-81"));
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.deepEqual([b.encontrado, b.ativo, b.habilitadoLicitar, b.razaoSocial], [true, true, true, "EMPRESA TESTE LTDA"]);
  assert.match(b.fonte, /dadosabertos\.compras\.gov\.br/);
  assert.ok(!Number.isNaN(Date.parse(b.consultadoEm)));
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].searchParams.get("cnpj"), "11222333000181");
  assert.equal(chamadas[0].searchParams.get("ativo"), "true");
}));

test("404 da API = não encontrado no SICAF (não é erro)", () => comFetch(() => new Response("{}", { status: 404 }), async () => {
  const b = JSON.parse((await handler(evento("11222333000181"))).body);
  assert.deepEqual([b.encontrado, b.ativo, b.habilitadoLicitar], [false, false, false]);
}));

test("resultado de outro CNPJ não conta como encontrado", () => comFetch(() => Response.json({ resultado: [{ ...FORNECEDOR, cnpj: "99999999000199" }] }), async () => {
  assert.equal(JSON.parse((await handler(evento("11222333000181"))).body).encontrado, false);
}));

test("fonte fora do ar: 503 com mensagem simples", () => comFetch(() => new Response("x", { status: 500 }), async () => {
  const r = await handler(evento("11222333000181"));
  assert.equal(r.statusCode, 503);
  assert.match(JSON.parse(r.body).erro, /Compras\.gov\.br/);
}));

test("sem login, CNPJ inválido ou método errado: recusa sem chamar a fonte", () => comFetch(() => Response.json({ resultado: [FORNECEDOR] }), async (chamadas) => {
  assert.equal((await handler(evento("11222333000181", {}))).statusCode, 401);
  assert.equal((await handler(evento("123"))).statusCode, 400);
  assert.equal((await handler(evento("11222333000181", undefined, "POST"))).statusCode, 405);
  assert.equal(chamadas.length, 0);
}));
