const test = require("node:test");
const assert = require("node:assert/strict");
const { comoLogado } = require("./fixtures/login-aprovado");
const handler = comoLogado(require("../pncp-arquivos").handler);

const evento = { queryStringParameters: { cnpj: "12345678000190", ano: "2026", sequencial: "9" } };

test("pncp-arquivos: documentos e situação saem juntos, resposta guardada; PNCP fora sem guardado devolve vazio", async () => {
  require("../_cache_publico")._limparMemoria();
  const original = global.fetch;
  let abertas = 0, maximo = 0, fora = true;
  global.fetch = async (url) => {
    abertas += 1; maximo = Math.max(maximo, abertas);
    await new Promise((ok) => setTimeout(ok, 10));
    abertas -= 1;
    if (fora) throw new Error("rede");
    return String(url).endsWith("/arquivos")
      ? Response.json([{ sequencialDocumento: 1, titulo: "Edital" }])
      : Response.json({ situacaoCompraNome: "Revogada", situacaoCompraId: 3 });
  };
  try {
    const vazio = JSON.parse((await handler(evento)).body);
    assert.deepEqual([vazio.arquivos, vazio.situacaoCompraNome], [[], null]);
    fora = false;
    const a = await handler(evento);
    const j = JSON.parse(a.body);
    assert.deepEqual([j.arquivos.length, j.situacaoCompraNome, j.situacaoCompraId], [1, "Revogada", 3]);
    assert.equal(maximo, 2);
    fora = true;
    const b = await handler(evento);
    assert.equal(b.headers["X-Dados-Origem"], "cache");
    assert.equal(JSON.parse(b.body).situacaoCompraNome, "Revogada");
  } finally {
    global.fetch = original;
  }
});
