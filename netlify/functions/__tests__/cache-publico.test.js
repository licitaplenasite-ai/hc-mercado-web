const test = require("node:test");
const assert = require("node:assert/strict");
const { comCache, cabecalhosDoCache, _limparMemoria } = require("../_cache_publico");

const relogio = (inicio = 1_700_000_000_000) => { let t = inicio; return { agora: () => t, andar: (s) => { t += s * 1000; } }; };

test("comCache: 1ª vez vai ao portal; dentro da validade responde guardado sem chamar o portal", async () => {
  _limparMemoria();
  const r = relogio(); let chamadas = 0;
  const buscar = async () => { chamadas += 1; return { n: chamadas }; };
  const a = await comCache("k1", buscar, { frescoS: 60, agora: r.agora });
  assert.deepEqual([a.origem, a.valor.n, chamadas], ["ao-vivo", 1, 1]);
  r.andar(30);
  const b = await comCache("k1", buscar, { frescoS: 60, agora: r.agora });
  assert.deepEqual([b.origem, b.valor.n, chamadas], ["cache", 1, 1]);
  assert.equal(cabecalhosDoCache(b)["X-Dados-Origem"], "cache");
});

test("comCache: vencido e portal no ar -> atualiza; vencido e portal fora -> devolve o guardado com a data", async () => {
  _limparMemoria();
  const r = relogio();
  await comCache("k2", async () => "v1", { frescoS: 60, agora: r.agora });
  const gravadoEm = new Date(r.agora()).toISOString();
  r.andar(120);
  const novo = await comCache("k2", async () => "v2", { frescoS: 60, agora: r.agora });
  assert.deepEqual([novo.origem, novo.valor], ["ao-vivo", "v2"]);
  r.andar(120);
  const fora = await comCache("k2", async () => { throw new Error("502"); }, { frescoS: 60, agora: r.agora });
  assert.equal(fora.origem, "guardado"); assert.equal(fora.valor, "v2");
  assert.notEqual(fora.guardadoEm, gravadoEm);
});

test("comCache: portal lento além do prazo devolve o guardado; sem guardado espera o portal", async () => {
  _limparMemoria();
  const r = relogio();
  await comCache("k3", async () => "velho", { frescoS: 1, agora: r.agora });
  r.andar(10);
  const lento = () => new Promise((ok) => setTimeout(() => ok("novo"), 200));
  const inicio = Date.now();
  const res = await comCache("k3", lento, { frescoS: 1, prazoMs: 20, agora: r.agora });
  assert.equal(res.origem, "guardado"); assert.equal(res.valor, "velho");
  assert.ok(Date.now() - inicio < 150);
  const semGuardado = await comCache("k4", lento, { frescoS: 1, prazoMs: 20, agora: r.agora });
  assert.deepEqual([semGuardado.origem, semGuardado.valor], ["ao-vivo", "novo"]);
});

test("comCache: além do prazo de guarda não usa o guardado; erro sem guardado propaga; null não é guardado", async () => {
  _limparMemoria();
  const r = relogio();
  await comCache("k5", async () => "antigo", { frescoS: 1, guardaS: 100, agora: r.agora });
  r.andar(200);
  await assert.rejects(comCache("k5", async () => { throw new Error("fora"); }, { frescoS: 1, guardaS: 100, agora: r.agora }));
  let n = 0;
  await comCache("k6", async () => { n += 1; return null; }, { agora: r.agora });
  await comCache("k6", async () => { n += 1; return null; }, { agora: r.agora });
  assert.equal(n, 2);
});

test("comCache: usa caches.default do Cloudflare quando existe (compartilhado entre isolates)", async () => {
  _limparMemoria();
  const guardados = new Map();
  globalThis.caches = { default: {
    match: async (req) => (guardados.has(req.url) ? new Response(guardados.get(req.url)) : undefined),
    put: async (req, resp) => { guardados.set(req.url, await resp.text()); },
  } };
  try {
    const r = relogio();
    await comCache("termo=papel a4", async () => ({ ok: 1 }), { agora: r.agora });
    assert.equal(guardados.size, 1);
    assert.match([...guardados.keys()][0], /^https:\/\/licitaplena\.com\.br\/__cache-consultas\/termo%3Dpapel%20a4$/);
    _limparMemoria(); // outro isolate: memória vazia, Cloudflare ainda tem
    const b = await comCache("termo=papel a4", async () => { throw new Error("não devia chamar"); }, { agora: r.agora });
    assert.deepEqual([b.origem, b.valor], ["cache", { ok: 1 }]);
  } finally {
    delete globalThis.caches;
  }
});
