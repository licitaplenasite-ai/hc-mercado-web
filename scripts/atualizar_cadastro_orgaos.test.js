const test = require("node:test");
const assert = require("node:assert/strict");
const { paraLinha, baixarCadastro, carregar, localDasUnidades, localDoOrgao, completarLocal, criarRitmo, esperaDo429 } = require("./atualizar_cadastro_orgaos");

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

const semDormir = async () => {};

test("local dos órgãos: 404 marca sem unidade; erro vira falha gravada; fila consumida em lotes até acabar", async () => {
  const resp = (status, corpo) => async () => new Response(JSON.stringify(corpo ?? []), { status });
  assert.deepEqual(await localDoOrgao("1", { fetchImpl: resp(404, {}) }), { cnpj: "1", uf: null, municipio: null });
  assert.deepEqual(await localDoOrgao("1", { fetchImpl: resp(503) }), { cnpj: "1", falhou: true });
  assert.deepEqual(await localDoOrgao("1", { fetchImpl: async () => { throw new Error("rede"); } }), { cnpj: "1", falhou: true });
  const filas = [["10", "11", "12"], ["13"], []], gravados = [];
  const rest = async (caminho, op) => {
    if (caminho === "rpc/orgaos_sem_local") return new Response(JSON.stringify(filas.shift()));
    gravados.push(...JSON.parse(op.body).p_locais); return new Response("1");
  };
  const pncp = async (url) => (url.includes("/12/") ? new Response("", { status: 500 }) : new Response(JSON.stringify([unidade("AC", "Rio Branco")])));
  const r = await completarLocal({ rest, fetchImpl: pncp, prazoMs: 60000, concorrencia: 2, intervaloMs: 0, dormir: semDormir });
  assert.deepEqual(r, { consultados: 3, comUf: 3, falhas: 1, limite429: 0 });
  assert.deepEqual(gravados.map((l) => l.cnpj).sort(), ["10", "11", "12", "13"], "a falha também vai para o banco (contador de falhas)");
  assert.deepEqual(gravados.find((l) => l.cnpj === "12"), { cnpj: "12", falhou: true });
  // PNCP fora do ar: o lote inteiro falha e o robô para (não fica repetindo os mesmos CNPJs).
  let chamadas = 0;
  const r2 = await completarLocal({ rest: async (c) => { if (c === "rpc/orgaos_sem_local") chamadas++; return new Response(JSON.stringify(["1", "2"])); }, fetchImpl: resp(503), prazoMs: 60000, intervaloMs: 0, dormir: semDormir });
  assert.deepEqual([r2.falhas, chamadas], [2, 1]);
});

test("local dos órgãos: ritmo global entre chamadas, 429 respeita Retry-After e para a rodada se insistir", async () => {
  // Relógio falso: dormir avança o tempo.
  let t = 0;
  const dormir = async (ms) => { t += ms; };
  const ritmo = criarRitmo(3000, { agora: () => t, dormir });
  const horarios = [];
  for (let i = 0; i < 3; i++) { await ritmo.esperar(); horarios.push(t); }
  assert.deepEqual(horarios, [0, 3000, 6000], "1 chamada a cada 3 s (20 por minuto)");
  ritmo.frear(60000);
  await ritmo.esperar();
  assert.equal(t, 66000, "Retry-After de um 429 vale para a próxima chamada de qualquer um");
  // Espera do 429: segundos, data HTTP, sem cabeçalho = backoff; jitter até 20%; teto de 5 min.
  assert.equal(esperaDo429("30", 0, () => 0), 30000);
  assert.equal(esperaDo429("30", 0, () => 1), 36000);
  assert.equal(esperaDo429(null, 0, () => 0), 5000);
  assert.equal(esperaDo429(null, 2, () => 0), 20000);
  assert.equal(esperaDo429("9999", 0, () => 0), 300000);
  assert.ok(esperaDo429(new Date(Date.now() + 10000).toUTCString(), 0, () => 0) > 8000);
  // 429 e depois 200: tenta de novo e acerta; o total conta o 429.
  let n = 0;
  const total = {};
  const pncp = async () => (n++ === 0 ? new Response("", { status: 429, headers: { "Retry-After": "2" } }) : new Response(JSON.stringify([unidade("AM", "Manaus")])));
  assert.deepEqual(await localDoOrgao("1", { fetchImpl: pncp, ritmo: criarRitmo(0, { dormir: semDormir }), dormir: semDormir, total }), { cnpj: "1", uf: "AM", municipio: "Manaus" });
  assert.equal(total.limite429, 1);
  // 429 sempre: depois das tentativas a rodada para, sem gravar o órgão como falha.
  const gravados = [];
  const rest = async (c, op) => { if (c === "rpc/orgaos_sem_local") return new Response(JSON.stringify(["1", "2", "3"])); gravados.push(...JSON.parse(op.body).p_locais); return new Response("1"); };
  const r = await completarLocal({ rest, fetchImpl: async () => new Response("", { status: 429 }), prazoMs: 60000, concorrencia: 1, intervaloMs: 0, dormir: semDormir });
  assert.deepEqual([r.consultados, r.falhas, r.limite429, gravados.length], [0, 0, 4, 0], "1 + 3 tentativas, depois para");
});
