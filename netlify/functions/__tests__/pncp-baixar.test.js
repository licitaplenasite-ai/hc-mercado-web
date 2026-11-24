const test = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../pncp-baixar.js");

function comArquivo(bytes, fn) {
  const original = global.fetch;
  global.fetch = async () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
  return fn().finally(() => { global.fetch = original; });
}
const evento = (extra) => ({ headers: {}, queryStringParameters: { cnpj: "89971758000180", ano: "2026", sequencial: "1381", documento: "10", nome: "Edital", ...extra } });

test("ver=1 com PDF: abre na tela (inline), só emoldurado pelo próprio site", () => comArquivo(Buffer.from("%PDF-1.4 x"), async () => {
  const r = await handler(evento({ ver: "1" }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Content-Type"], "application/pdf");
  assert.match(r.headers["Content-Disposition"], /^inline; filename="Edital\.pdf"$/);
  assert.equal(r.headers["Content-Security-Policy"], "frame-ancestors 'self'");
  assert.equal(r.headers["X-Frame-Options"], "SAMEORIGIN");
}));

test("sem ver=1, ou arquivo que não é PDF: continua baixando", () => comArquivo(Buffer.from("PK\u0003\u0004zip"), async () => {
  const r = await handler(evento({ ver: "1" }));
  assert.match(r.headers["Content-Disposition"], /^attachment;/);
  const r2 = await handler(evento({}));
  assert.match(r2.headers["Content-Disposition"], /^attachment;/);
}));

test("falha na rede não devolve o detalhe técnico da exceção ao visitante (auditoria 23/11)", async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:443 segredo-interno"); };
  try {
    const r = await handler(evento({}));
    assert.equal(r.statusCode, 502);
    assert.doesNotMatch(r.body, /ECONNREFUSED|segredo|10\.0\.0\.1/);
  } finally { global.fetch = original; }
});
