// Disparo imediato dos robôs (incidente 23/11: pedido de cliente esperando o cron do GitHub por horas).
const test = require("node:test");
const assert = require("node:assert/strict");
const { dispararWorkflows } = require("../_disparo_robos");

test("sem GITHUB_DISPARO_TOKEN não chama o GitHub e não falha", async () => {
  let chamadas = 0;
  const r = await dispararWorkflows(["gerar-dossies.yml"], { env: {}, fetchFn: async () => { chamadas += 1; } });
  assert.deepEqual(r, { configurado: false, disparados: [] });
  assert.equal(chamadas, 0);
});

test("com token dispara cada workflow na branch configurada e só conta o 204", async () => {
  const pedidos = [];
  const fetchFn = async (url, op) => {
    pedidos.push({ url, op });
    if (url.includes("esteira.yml")) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return { status: url.includes("gerar-dossies") ? 204 : 404 };
  };
  const r = await dispararWorkflows(["gerar-dossies.yml", "esteira.yml", "outro.yml"], { env: { GITHUB_DISPARO_TOKEN: "t" }, fetchFn });
  assert.deepEqual(r, { configurado: true, disparados: ["gerar-dossies.yml"] });
  assert.equal(pedidos[0].url, "https://api.github.com/repos/licitaplenasite-ai/hc-mercado-web/actions/workflows/gerar-dossies.yml/dispatches");
  assert.equal(pedidos[0].op.method, "POST");
  assert.equal(pedidos[0].op.headers.Authorization, "Bearer t");
  assert.deepEqual(JSON.parse(pedidos[0].op.body), { ref: "main" });
  const r2 = await dispararWorkflows(["x.yml"], { env: { GITHUB_DISPARO_TOKEN: "t", GITHUB_DISPARO_REPO: "a/b", GITHUB_DISPARO_REF: "teste" },
    fetchFn: async (url, op) => { pedidos.push({ url, op }); return { status: 204 }; } });
  assert.deepEqual(r2.disparados, ["x.yml"]);
  assert.match(pedidos.at(-1).url, /repos\/a\/b\/actions\/workflows\/x\.yml/);
  assert.deepEqual(JSON.parse(pedidos.at(-1).op.body), { ref: "teste" });
});
