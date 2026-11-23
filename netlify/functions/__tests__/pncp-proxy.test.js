const test = require("node:test");
const assert = require("node:assert/strict");
const { comoLogado } = require("./fixtures/login-aprovado");
const handler = comoLogado(require("../pncp-proxy").handler);

const evento = (url) => ({ httpMethod: "GET", headers: {}, queryStringParameters: { url } });

async function comFetch(respostas, fn) {
  // Cada teste começa sem nada guardado (o proxy guarda as respostas 200 por URL).
  require("../_cache_publico")._limparMemoria();
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

test("pncp-proxy guarda só a resposta 200: a mesma URL volta sem ir ao PNCP; erro do PNCP passa adiante", () =>
  comFetch([{ status: 429, corpo: '{"erro":"limite"}' }, { status: 200, corpo: '{"items":[1]}' }], async (chamadas) => {
    const url = "https://pncp.gov.br/api/search?q=cadeira&pagina=1";
    const erro = await handler(evento(url));
    assert.equal(erro.statusCode, 429);
    assert.equal(erro.body, '{"erro":"limite"}');
    const a = await handler(evento(url));
    assert.deepEqual([a.statusCode, a.body, a.headers["X-Dados-Origem"]], [200, '{"items":[1]}', "ao-vivo"]);
    const b = await handler(evento(url));
    assert.deepEqual([b.statusCode, b.body, b.headers["X-Dados-Origem"]], [200, '{"items":[1]}', "cache"]);
    assert.equal(chamadas.length, 2);
  }));

test("pncp-proxy continua recusando host fora do PNCP", async () => {
  const r = await handler(evento("https://exemplo.com/api"));
  assert.equal(r.statusCode, 400);
});

test("pncp-proxy sem login responde 401 e não chama o PNCP (abuso 20/11)", async () => {
  const original = global.fetch;
  let chamadas = 0;
  global.fetch = async () => { chamadas++; throw new Error("não deve chamar"); };
  try {
    const r = await require("../pncp-proxy").handler(evento("https://pncp.gov.br/api/search?q=a"));
    assert.equal(r.statusCode, 401);
    assert.equal(chamadas, 0);
  } finally { global.fetch = original; }
});
