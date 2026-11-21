const test = require("node:test");
const assert = require("node:assert/strict");
const { consultarAno } = require("../despesas-fornecedor.js");

// Portal da Transparência falso: `paginas` = quantos documentos cada página devolve.
function portal(paginas) {
  const pedidas = [];
  global.fetch = async (url) => {
    const pagina = Number(new URL(url).searchParams.get("pagina"));
    pedidas.push(pagina);
    const n = paginas[pagina - 1] ?? 0;
    return { ok: true, text: async () => JSON.stringify(Array.from({ length: n }, () => ({ valor: 1 }))) };
  };
  return pedidas;
}

test("pagamentos: soma todas as páginas do ano, não só a primeira", async () => {
  const pedidas = portal([15, 15, 4]);
  const r = await consultarAno("14220230000170", 2026, "t");
  assert.deepEqual([r.ok, r.dados.length, r.parcial, pedidas], [true, 34, false, [1, 2, 3]]);
});

test("pagamentos: página cheia até o limite marca o total como parcial", async () => {
  portal(Array(20).fill(15));
  const r = await consultarAno("14220230000170", 2026, "t");
  assert.deepEqual([r.dados.length, r.parcial], [8 * 15, true]);
});

test("pagamentos: falha na 1ª página é erro; depois dela, guarda o que leu como parcial", async () => {
  global.fetch = async () => ({ ok: false });
  assert.equal((await consultarAno("1", 2026, "t")).ok, false);
  let n = 0;
  global.fetch = async () => (++n === 1 ? { ok: true, text: async () => JSON.stringify(Array(15).fill({ valor: 2 })) } : { ok: false });
  const r = await consultarAno("1", 2026, "t");
  assert.deepEqual([r.ok, r.dados.length, r.parcial], [true, 15, true]);
});
