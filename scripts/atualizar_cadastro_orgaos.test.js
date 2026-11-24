const test = require("node:test");
const assert = require("node:assert/strict");
const { paraLinha, baixarCadastro, carregar } = require("./atualizar_cadastro_orgaos");

test("cadastro de órgãos: registro do PNCP vira linha válida; sem CNPJ fica fora; inativo vai marcado", () => {
  assert.deepEqual(paraLinha({ cnpj: "22812960000199", razaoSocial: " MUNICIPIO  DE APUI ", esferaId: "M", poderId: "E", statusAtivo: true }),
    { cnpj: "22812960000199", nome: "MUNICIPIO DE APUI", esfera: "M", poder: "E", ativo: true });
  assert.equal(paraLinha({ cnpj: "22812960000199", razaoSocial: "X", statusAtivo: true }), null, "nome curto");
  assert.equal(paraLinha({ cnpj: "2281296000019", razaoSocial: "MUNICIPIO" }), null, "CNPJ com 13 dígitos");
  assert.equal(paraLinha({ cnpj: "22812960000199", razaoSocial: "MUNICIPIO", statusAtivo: false }).ativo, false, "inativo marcado");
  assert.equal(paraLinha({ cnpj: "22812960000199", razaoSocial: "MUNICIPIO", esferaId: "municipal" }).esfera, null);
  assert.equal(paraLinha(null), null);
});

test("cadastro de órgãos: baixa a lista inteira e carrega em lotes de até 2.000", async () => {
  const lista = Array.from({ length: 4500 }, (_, i) => ({ cnpj: String(10000000000000 + i), razaoSocial: `ORGAO ${i}`, esferaId: "F", statusAtivo: true }));
  const linhas = await baixarCadastro(async () => new Response(JSON.stringify(lista)));
  assert.equal(linhas.length, 4500);
  await assert.rejects(baixarCadastro(async () => new Response("{}")), /não é uma lista/);
  await assert.rejects(baixarCadastro(async () => new Response("", { status: 503 })), /HTTP 503/);
  const lotes = [];
  const gravados = await carregar(linhas, async (caminho, op) => { lotes.push(JSON.parse(op.body).p_orgaos.length); return new Response("7"); });
  assert.deepEqual(lotes, [2000, 2000, 500]);
  assert.equal(gravados, 21);
});
