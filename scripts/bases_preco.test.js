const test = require("node:test");
const assert = require("node:assert/strict");
const bp = require("./bases_preco");

test("fatiar agrupa pelo balde dos 2 primeiros dígitos do código (igual a bases_preco_buscar)", () => {
  const partes = bp.fatiar("precos:AM", { "insumo|370": [1, 2], "composicao|37002": [3, null], "composicao|104658": [4, 5], "insumo|1": [6, 6] });
  assert.deepEqual(partes.map((p) => p.parte).sort(), ["precos:AM:1", "precos:AM:10", "precos:AM:37"]);
  assert.deepEqual(partes.find((p) => p.parte === "precos:AM:37").conteudo, { "insumo|370": [1, 2], "composicao|37002": [3, null] });
  assert.equal(bp.baldeDe("97622"), "97");
  assert.equal(bp.baldeDe("composicao|97622"), "97");
});

test("fatiar ignora código que não vira nome de parte válido", () => {
  assert.deepEqual(bp.fatiar("itens", { "insumo|á-1": ["x", "un"] }), []);
});

test("mesDeCorte guarda os últimos N meses contando o atual", () => {
  assert.equal(bp.mesDeCorte(Date.UTC(2026, 10, 22), 24), "2024-12");
  assert.equal(bp.mesDeCorte(Date.UTC(2026, 0, 5), 1), "2026-01");
});

test("referenciaZerada: mais da metade sem preço em nenhuma UF; vazio também é zerada", () => {
  const cheio = { precos: { AM: "10.00", AC: null } }, vazio = { precos: { AM: null, AC: null } };
  assert.equal(bp.referenciaZerada([cheio, cheio, vazio]), false);
  assert.equal(bp.referenciaZerada([cheio, vazio, vazio]), true);
  assert.equal(bp.referenciaZerada([]), true);
  assert.equal(bp.referenciaZerada([{ precos: { AM: "0" } }]), true);
});

test("permitidoPeloRobots: grupo *, prefixo, curinga, $ e Allow mais longo", () => {
  const robots = `User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /_layouts
Disallow: /*sendto_form
Allow: /privado/aberto
Disallow: /privado
Disallow: /fim$`;
  assert.equal(bp.permitidoPeloRobots(robots, "https://x.gov.br/Downloads/sinapi.zip"), true);
  assert.equal(bp.permitidoPeloRobots(robots, "https://x.gov.br/_layouts/15/a.aspx"), false);
  assert.equal(bp.permitidoPeloRobots(robots, "https://x.gov.br/a/b/sendto_form"), false);
  assert.equal(bp.permitidoPeloRobots(robots, "https://x.gov.br/privado/aberto/1"), true);
  assert.equal(bp.permitidoPeloRobots(robots, "https://x.gov.br/privado/x"), false);
  assert.equal(bp.permitidoPeloRobots(robots, "https://x.gov.br/fim"), false);
  assert.equal(bp.permitidoPeloRobots(robots, "https://x.gov.br/fim/2"), true);
  assert.equal(bp.permitidoPeloRobots("", "https://x.gov.br/qualquer"), true);
  assert.equal(bp.permitidoPeloRobots("User-agent: *\nDisallow: /", "https://x.gov.br/a"), false);
});
