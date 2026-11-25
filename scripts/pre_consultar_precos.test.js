const test = require("node:test");
const assert = require("node:assert/strict");
const { escolherTermos, consultarTermo, executar, esperaDepoisDo429, proximosPendentes, TERMOS_INICIAIS } = require("./pre_consultar_precos");
const { chaveDaConsulta } = require("../netlify/functions/comprasgov-marcas-produto");

test("escolherTermos: mais buscados primeiro, completa com a lista inicial, sem repetir nem passar do total", () => {
  assert.ok(TERMOS_INICIAIS.length >= 200);
  const t = escolherTermos(["Toner 85A", "papel A4", "12345678000190"], 5);
  assert.deepEqual(t, ["toner 85a", "papel a4", "caneta", "caneta esferografica", "lapis"]);
  assert.equal(escolherTermos([], 200).length, 200);
});

// Fonte simulada: busca com o produto principal e 2 páginas dele.
const corpoBusca = JSON.stringify({ ok: true, catalogos: [{ codigo: 8435, descricao: "Notebook", total: 10 }], itens: [] });
const corpoPagina = (pagina) => JSON.stringify({ ok: true, pagina, paginas: 2, itens: [] });
const fonte = (opcoes = {}) => async (consulta) => {
  if (opcoes.bloquear?.(consulta)) { const e = new Error("fonte-429"); e.status = 429; e.esperarS = 20; throw e; }
  if (consulta.codigoPdm === null) return { corpo: corpoBusca, parcial: Boolean(opcoes.parcial), esperarS: opcoes.parcial ? 30 : null };
  return { corpo: corpoPagina(consulta.pagina), parcial: false };
};

test("consultarTermo: guarda a busca e as páginas do produto principal com a mesma chave que a tela pede", async () => {
  const r = await consultarTermo("notebook", { montar: fonte(), agora: () => new Date("2026-11-24T06:17:00Z") });
  assert.equal(r.bloqueadoS, null);
  assert.deepEqual(r.linhas.map((l) => l.chave), [
    chaveDaConsulta({ termo: "notebook", uf: "", codigoPdm: null, codigoItem: null, pagina: 1, produto: "" }),
    // Mesmos parâmetros que mercado-comprasgov.js manda ao escolher o produto (codigoPdm, pagina, produto).
    chaveDaConsulta({ termo: "notebook", uf: "", codigoPdm: 8435, codigoItem: null, pagina: 1, produto: "Notebook" }),
    chaveDaConsulta({ termo: "notebook", uf: "", codigoPdm: 8435, codigoItem: null, pagina: 2, produto: "Notebook" }),
  ]);
  assert.ok(r.linhas.every((l) => l.fonte === "precos" && l.termo === "notebook" && l.atualizado_em === "2026-11-24T06:17:00.000Z"));
  // Resposta parcial não é guardada (a tela mostraria lista incompleta o dia todo).
  const parcial = await consultarTermo("notebook", { montar: fonte({ parcial: true }) });
  assert.deepEqual([parcial.linhas.length, parcial.bloqueadoS], [0, 30]);
});

test("executar: 429 espera o Retry-After e tenta de novo; 429 seguidos param o robô cedo", async () => {
  const esperas = [], gravadas = [];
  let bloqueiosRestantes = 1;
  const montar = fonte({ bloquear: () => bloqueiosRestantes-- > 0 });
  const r1 = await executar({ termos: ["notebook", "toner"], montar, gravar: async (l) => gravadas.push(...l), esperar: async (ms) => esperas.push(ms), log: () => {}, aleatorio: () => 0 });
  assert.deepEqual([r1.completos, r1.bloqueios, r1.parouCedo], [2, 1, null]);
  assert.ok(esperas[0] >= 19900 && esperas[0] <= 20000, `esperou o Retry-After (20 s), acima do mínimo de 15 s: ${esperas[0]}`);
  assert.equal(gravadas.length, 6);
  assert.deepEqual([r1.falharam, r1.naoRodaram], [[], []]);

  const sempre = fonte({ bloquear: () => true });
  const r2 = await executar({ termos: ["a1", "b2", "c3", "d4", "e5"], montar: sempre, gravar: async () => {}, esperar: async () => {}, log: () => {}, concorrencia: 1 });
  assert.equal(r2.parouCedo, "429");
  assert.equal(r2.completos, 0);
  assert.ok(r2.bloqueios <= 4, `parou cedo, sem insistir: ${r2.bloqueios} bloqueios`);
});

test("executar: para quando acaba o tempo e guarda o que já fez", async () => {
  let t = 0;
  const r = await executar({ termos: ["notebook", "toner", "caneta"], montar: fonte(), gravar: async () => {}, esperar: async () => {},
    relogio: () => (t += 60000), limiteMs: 150000, log: () => {} });
  assert.equal(r.parouCedo, "tempo");
  assert.ok(r.completos >= 1 && r.completos < 3);
});

test("executar: 2 termos por vez consultam todos, cada um gravado uma vez", async () => {
  const gravados = [];
  const r = await executar({ termos: ["notebook", "toner", "caneta", "lapis", "cola"], montar: fonte(), gravar: async (l) => gravados.push(l[0].termo),
    esperar: async () => {}, log: () => {}, concorrencia: 2 });
  assert.equal(r.completos, 5);
  assert.deepEqual([...gravados].sort(), ["caneta", "cola", "lapis", "notebook", "toner"]);
});

test("esperaDepoisDo429: recuo exponencial com teto, Retry-After como piso e jitter limitado", () => {
  // Padrões: base 15 s, teto 120 s, jitter 30%.
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => esperaDepoisDo429(n, null, () => 0)), [15000, 30000, 60000, 120000, 120000]);
  assert.equal(esperaDepoisDo429(1, 45, () => 0), 45000, "Retry-After maior que o recuo manda");
  assert.equal(esperaDepoisDo429(1, 300, () => 0), 300000, "Retry-After passa do teto: a fonte manda");
  assert.equal(esperaDepoisDo429(2, 10, () => 0.999), Math.round(30000 * (1 + 0.3 * 0.999)), "jitter até +30%");
});

test("executar: 429 pausa todos os termos simultâneos e respeita a pausa antes do próximo pedido", async () => {
  let t = 0;
  const esperas = [];
  let bloqueios = 1;
  const pedidos = [];
  const montar = async (consulta) => {
    pedidos.push({ termo: consulta.termo, t });
    if (consulta.codigoPdm === null && consulta.termo === "toner" && bloqueios-- > 0) { const e = new Error("fonte-429"); e.status = 429; e.esperarS = 60; throw e; }
    return fonte()(consulta);
  };
  // O relógio só anda quando alguém espera (esperar avança t).
  const r = await executar({ termos: ["toner", "caneta", "lapis"], montar, gravar: async () => {}, relogio: () => t,
    esperar: async (ms) => { esperas.push(ms); t += ms; }, log: () => {}, concorrencia: 2, aleatorio: () => 0 });
  assert.equal(r.completos, 3);
  assert.ok(esperas.includes(60000), "esperou o Retry-After de 60 s");
  // Nenhum pedido de outro termo antes de a pausa do 429 acabar (exceto os que já tinham saído antes do 429).
  const depois = pedidos.filter((p) => p.termo === "lapis");
  assert.ok(depois.every((p) => p.t >= 60000), `lapis só depois da pausa: ${JSON.stringify(depois)}`);
});

test("executar: termo bloqueado em todas as tentativas vai para a lista de retomada, e o que não rodou também", async () => {
  const montar = fonte({ bloquear: (c) => c.termo === "toner" });
  const r = await executar({ termos: ["toner", "caneta", "lapis"], montar, gravar: async () => {}, esperar: async () => {}, log: () => {},
    concorrencia: 1, aleatorio: () => 0 });
  // 4 bloqueios seguidos (1 + 3 tentativas) param o robô: toner falhou, caneta e lapis ficaram para depois.
  assert.equal(r.parouCedo, "429");
  assert.deepEqual([r.falharam, r.naoRodaram], [["toner"], ["caneta", "lapis"]]);
});

test("proximosPendentes: falhou soma, não rodou mantém, completou sai, desiste em MAX_RETOMADAS", () => {
  const anterior = { toner: 1, caneta: 2, lapis: 0, cola: 1 };
  const fila = proximosPendentes(anterior, { falharam: ["toner", "caneta", "novo"], naoRodaram: ["lapis", "papel a4"] }, 3);
  // cola completou (não está em nenhuma lista); caneta chegou a 3 e sai.
  assert.deepEqual(fila, { toner: 2, novo: 1, lapis: 0, "papel a4": 0 });
  assert.deepEqual(proximosPendentes({}, { falharam: [], naoRodaram: [] }, 3), {});
});

test("escolherTermos: retomados entram primeiro, sem repetir os mais buscados", () => {
  assert.deepEqual(escolherTermos(["toner", "papel a4", "toner"], 3), ["toner", "papel a4", "caneta"]);
});

test("lista ampliada: entram os termos populares do dicionário (tv, micro-ondas...) depois da lista inicial", () => {
  const { alvosPorUf } = require("./pre_consultar_precos");
  const todos = escolherTermos([], 1000);
  for (const t of ["geladeira", "tv", "micro ondas", "ar condicionado split", "smart tv", "airfryer"]) assert.ok(todos.includes(t), t);
  assert.ok(todos.length >= 390, `${todos.length} termos`);
  assert.equal(new Set(todos).size, todos.length, "sem repetir");
  assert.deepEqual(alvosPorUf(["geladeira", "tv", "pneu"], ["AM", "SP"], 2), ["geladeira|AM", "tv|AM", "geladeira|SP", "tv|SP"]);
  assert.deepEqual(alvosPorUf(["geladeira"], [], 30), []);
});

test("consultarTermo com UF: grava com a mesma chave que a tela usa com o filtro de estado", async () => {
  const r = await consultarTermo("notebook|AM", { montar: fonte(), agora: () => new Date("2026-11-25T06:00:00Z") });
  assert.equal(r.linhas[0].chave, chaveDaConsulta({ termo: "notebook", uf: "AM", codigoPdm: null, codigoItem: null, pagina: 1, produto: "" }));
  assert.equal(r.linhas[1].chave, chaveDaConsulta({ termo: "notebook", uf: "AM", codigoPdm: 8435, codigoItem: null, pagina: 1, produto: "Notebook" }));
  assert.ok(r.linhas.every((l) => l.termo === "notebook"));
});

test("status da execução para o admin: próxima rodada às 05:41 UTC e contagens sem dado de usuário", () => {
  const { proximaExecucao, statusDaExecucao } = require("./pre_consultar_precos");
  assert.equal(proximaExecucao(new Date("2026-11-25T03:00:00Z")), "2026-11-25T05:41:00.000Z");
  assert.equal(proximaExecucao(new Date("2026-11-25T16:42:00Z")), "2026-11-26T05:41:00.000Z");
  const s = statusDaExecucao({ termos: 480, completos: 300, falhas: 4, bloqueios: 17, parouCedo: "429", minutos: 80.2, bytes: 104857600,
    falharam: ["alcool 70"], naoRodaram: ["a", "b|AM"] }, { "alcool 70": 1, a: 0, "b|AM": 0 }, new Date("2026-11-25T07:00:00Z"));
  assert.deepEqual([s.em, s.proxima, s.consultas, s.completos, s.bloqueios429, s.parouCedo, s.naoRodaram, s.paraProxima, s.megabytes],
    ["2026-11-25T07:00:00.000Z", "2026-11-26T05:41:00.000Z", 480, 300, 17, "429", 2, 3, 100]);
});
