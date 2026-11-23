const test = require("node:test");
const assert = require("node:assert/strict");
const { registrar } = require("./registrar_robo.js");

test("grava o batimento do robô pela função do banco", async () => {
  const chamadas = [];
  const r = await registrar("boletim", async (caminho, op) => { chamadas.push([caminho, JSON.parse(op.body)]); return { json: async () => ({ robo: "boletim" }) }; });
  assert.deepEqual(chamadas, [["rpc/robo_registrar_sucesso", { p_robo: "boletim" }]]);
  assert.equal(r.robo, "boletim");
});

test("recusa robô fora da lista sem chamar o banco", async () => {
  let chamou = false;
  await assert.rejects(registrar("inventado", async () => { chamou = true; }), /desconhecido/);
  assert.equal(chamou, false);
});
