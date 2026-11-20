const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./processo-documentos-ui.js");
const D = require("./documentos-pastas-ui.js");

test("validade conferida na data da sessão quando existe", () => {
  const doc = { vencimento: "2026-12-10" };
  assert.equal(P.situacao(doc, "2026-12-05T10:00:00-03:00").classe, "proximo");
  assert.equal(P.situacao(doc, "2026-12-15T10:00:00-03:00").classe, "vencido");
  assert.equal(P.situacao(doc, "2026-11-01T10:00:00-03:00").classe, "valido");
  assert.match(P.situacao(doc, "2026-11-01T10:00:00-03:00").texto, /10\/12\/2026/);
  assert.equal(P.situacao({ vencimento: null }).classe, "sem-data");
});

test("escolha: grava só o novo e apaga só o tirado", () => {
  assert.deepEqual(P.diferenca(["a", "b"], ["b", "c"]), { incluir: ["c"], tirar: ["a"] });
  assert.deepEqual(P.diferenca([], []), { incluir: [], tirar: [] });
});

test("grupos por pasta em ordem alfabética, Sem pasta por último", () => {
  const docs = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const g = P.agrupar(docs, new Map([["1", "Técnica"], ["3", "Fiscal"]]), D.SEM_PASTA);
  assert.deepEqual(g.map(([p, itens]) => [p, itens.map((d) => d.id)]), [["Fiscal", ["3"]], ["Técnica", ["1"]], ["Sem pasta", ["2"]]]);
  assert.equal(P.linkResumo("e", "p"), "resumo-processo.html?empresa=e&processo=p");
});

test("pastas: nome no .zip por pasta e extensão do arquivo; filtro e limpeza do nome", () => {
  assert.equal(D.nomeNoZip({ tipo: "CND Federal", titulo: "Receita", arquivo_nome: "cnd.PDF" }, "Fiscal"), "Fiscal/CND Federal - Receita.pdf");
  assert.equal(D.nomeNoZip({ tipo: "Balanço", arquivo_caminho: "o/e/x-balanco.xlsx" }), "Sem pasta/Balanço.xlsx");
  assert.equal(D.limparPasta("  Habilitação/ jurídica <x> "), "Habilitação- jurídica -x-");
  assert.equal(D.passaNoFiltro(undefined, D.SEM_PASTA), true);
  assert.equal(D.passaNoFiltro("Fiscal", D.SEM_PASTA), false);
  assert.equal(D.passaNoFiltro("Fiscal", ""), true);
  assert.deepEqual(D.pastasDe(new Map([["a", "Técnica"], ["b", "Fiscal"], ["c", "Fiscal"]])), ["Fiscal", "Técnica"]);
});
