const test = require("node:test");
const assert = require("node:assert/strict");
const { comoLogado } = require("./fixtures/login-aprovado");
const handler = comoLogado(require("../pncp-itens").handler);

const evento = { queryStringParameters: { cnpj: "12345678000190", ano: "2026", sequencial: "7" } };

test("pncp-itens: lista com itens fica guardada (2ª abertura não vai ao PNCP); lista vazia não fica", async () => {
  require("../_cache_publico")._limparMemoria();
  const original = global.fetch;
  let chamadas = 0, vazio = true;
  global.fetch = async () => {
    chamadas += 1;
    return { ok: true, json: async () => (vazio ? [] : [{ numeroItem: 1, descricao: "Papel A4", quantidade: 10 }]) };
  };
  try {
    const a = await handler(evento);
    assert.deepEqual(JSON.parse(a.body).itens, []);
    vazio = false;
    const b = await handler(evento);
    assert.equal(JSON.parse(b.body).itens.length, 1, "vazio não foi guardado: tentou o PNCP de novo");
    assert.equal(b.headers["X-Dados-Origem"], "ao-vivo");
    const antes = chamadas;
    const c = await handler(evento);
    assert.equal(c.headers["X-Dados-Origem"], "cache");
    assert.equal(chamadas, antes);
  } finally {
    global.fetch = original;
  }
});
