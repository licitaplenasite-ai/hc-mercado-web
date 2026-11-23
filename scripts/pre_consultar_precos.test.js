const test = require("node:test");
const assert = require("node:assert/strict");
const { escolherTermos, consultarTermo, executar, TERMOS_INICIAIS } = require("./pre_consultar_precos");
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
  const r1 = await executar({ termos: ["notebook", "toner"], montar, gravar: async (l) => gravadas.push(...l), esperar: async (ms) => esperas.push(ms), log: () => {} });
  assert.deepEqual([r1.completos, r1.bloqueios, r1.parouCedo], [2, 1, null]);
  assert.equal(esperas[0], 20000, "esperou o Retry-After (20 s), acima do mínimo de 15 s");
  assert.equal(gravadas.length, 6);

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
