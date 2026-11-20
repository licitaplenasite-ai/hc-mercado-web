const test = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../pncp-proxy");

const evento = (url) => ({ httpMethod: "GET", headers: {}, queryStringParameters: { url } });

async function comFetch(respostas, fn) {
  const original = global.fetch, chamadas = [];
  global.fetch = async (url, op) => {
    chamadas.push({ url, op });
    const r = respostas.shift();
    return { status: r.status, headers: new Headers(r.headers || {}), text: async () => r.corpo || "" };
  };
  try { return await fn(chamadas); } finally { global.fetch = original; }
}

test("pncp-proxy segue redirect dentro de pncp.gov.br sem redirect automático", () =>
  comFetch([{ status: 301, headers: { location: "/api/search/?q=a" } }, { status: 200, corpo: '{"ok":1}' }], async (chamadas) => {
    const r = await handler(evento("https://pncp.gov.br/api/search?q=a"));
    assert.equal(r.statusCode, 200);
    assert.equal(r.body, '{"ok":1}');
    assert.equal(chamadas[1].url, "https://pncp.gov.br/api/search/?q=a");
    assert.ok(chamadas.every((c) => c.op.redirect === "manual"));
  }));

test("pncp-proxy recusa redirect para outro host (SSRF)", () =>
  comFetch([{ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }], async (chamadas) => {
    const r = await handler(evento("https://pncp.gov.br/api/search?q=a"));
    assert.equal(r.statusCode, 502);
    assert.equal(chamadas.length, 1);
  }));

test("pncp-proxy para depois de 3 redirects", () =>
  comFetch(Array.from({ length: 5 }, () => ({ status: 302, headers: { location: "https://pncp.gov.br/x" } })), async (chamadas) => {
    const r = await handler(evento("https://pncp.gov.br/api/search?q=a"));
    assert.equal(r.statusCode, 502);
    assert.equal(chamadas.length, 4);
  }));

test("pncp-proxy continua recusando host fora do PNCP", async () => {
  const r = await handler(evento("https://exemplo.com/api"));
  assert.equal(r.statusCode, 400);
});
