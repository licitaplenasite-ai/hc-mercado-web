const test = require("node:test");
const assert = require("node:assert/strict");
const { paraLinha, baixarCadastro, carregar, localDasUnidades, localDoOrgao, completarLocal } = require("./atualizar_cadastro_orgaos");

test("cadastro de órgãos: registro do PNCP vira linha válida; sem CNPJ fica fora; inativo vai marcado", () => {
  assert.deepEqual(paraLinha({ cnpj: "22812960000199", razaoSocial: " MUNICIPIO  DE APUI ", esferaId: "M", poderId: "E", statusAtivo: true, codigoNaturezaJuridica: "1244" }),
    { cnpj: "22812960000199", nome: "MUNICIPIO DE APUI", esfera: "M", poder: "E", ativo: true, natureza: "1244" });
  assert.equal(paraLinha({ cnpj: "22812960000199", razaoSocial: "MUNICIPIO", codigoNaturezaJuridica: null }).natureza, null, "sem natureza");
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

const unidade = (uf, nome, ativo = true) => ({ statusAtivo: ativo, municipio: { nome, uf: { siglaUF: uf } } });

test("local dos órgãos: UF e cidade mais comuns entre as unidades ativas", () => {
  assert.deepEqual(localDasUnidades("1", [unidade("AM", "Manaus"), unidade("AM", "Parintins"), unidade("AM", "Manaus"), unidade("PA", "Belém"), unidade("PA", "Belém", false), unidade("PA", "Santarém")]),
    { cnpj: "1", uf: "AM", municipio: "Manaus" });
  assert.deepEqual(localDasUnidades("1", [unidade("xx", "X"), { municipio: null }]), { cnpj: "1", uf: null, municipio: null }, "sem unidade válida");
  assert.deepEqual(localDasUnidades("1", null), { cnpj: "1", uf: null, municipio: null });
});

test("local dos órgãos: 404 marca sem unidade, falha tenta depois; fila consumida em lotes até acabar", async () => {
  const resp = (status, corpo) => async () => new Response(JSON.stringify(corpo ?? []), { status });
  assert.deepEqual(await localDoOrgao("1", resp(404, {})), { cnpj: "1", uf: null, municipio: null });
  assert.equal(await localDoOrgao("1", resp(503)), null);
  assert.equal(await localDoOrgao("1", async () => { throw new Error("rede"); }), null);
  const filas = [["10", "11", "12"], ["13"], []], gravados = [];
  const rest = async (caminho, op) => {
    if (caminho === "rpc/orgaos_sem_local") return new Response(JSON.stringify(filas.shift()));
    gravados.push(...JSON.parse(op.body).p_locais); return new Response("1");
  };
  const pncp = async (url) => (url.includes("/12/") ? new Response("", { status: 500 }) : new Response(JSON.stringify([unidade("AC", "Rio Branco")])));
  const r = await completarLocal({ rest, fetchImpl: pncp, prazoMs: 60000, concorrencia: 2 });
  assert.deepEqual(r, { consultados: 3, comUf: 3, falhas: 1 });
  assert.deepEqual(gravados.map((l) => l.cnpj).sort(), ["10", "11", "13"]);
  // PNCP fora do ar: o lote inteiro falha e o robô para (não fica repetindo os mesmos CNPJs).
  let chamadas = 0;
  const r2 = await completarLocal({ rest: async () => { chamadas++; return new Response(JSON.stringify(["1", "2"])); }, fetchImpl: resp(503), prazoMs: 60000 });
  assert.deepEqual([r2.falhas, chamadas], [2, 1]);
});
