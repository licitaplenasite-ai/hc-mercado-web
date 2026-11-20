const assert = require("node:assert/strict");
const test = require("node:test");
const B = require("./baixa-concorrencia.js");

const it = (n, situacao, parts, data = "2025-01-01") => ({ numero_item: n, descricao: `item ${n}`, situacao_item: situacao, historico_compras: { data_publicacao: data }, historico_participacoes: parts });
const prop = (chave, extra = {}) => ({ fornecedor_chave: chave, classificacao: 1, ...extra });

test("agrupa por nº de licitantes; deserto e fracassado vão para Desertos; sem lista de propostas não conta", () => {
  const { grupos, semLista } = B.classificarItens([
    it(1, "Deserto", []),
    it(2, "Fracassado", [prop("a")]),
    it(3, "Homologado", [prop("a")]),
    it(4, "Homologado", [prop("a"), prop("b", { classificacao: null, valor_proposta: 10 })], "2026-02-01"),
    it(5, "Homologado", [prop("a"), prop("a", { classificacao: 2 }), prop("b"), prop("c")]),
    it(6, "Homologado", [{ fornecedor_chave: "a", classificacao: null, valor_proposta: null }]),
    it(7, "Homologado", [prop("a"), prop("b"), prop("c"), prop("d")]),
    it(8, "Homologado", [prop("x")], "2026-03-01"),
  ]);
  assert.deepEqual(grupos.desertos.map((i) => i.numero_item), [1, 2]);
  assert.deepEqual(grupos[1].map((i) => i.numero_item), [8, 3], "mais recente primeiro");
  assert.deepEqual(grupos[2].map((i) => i.numero_item), [4]);
  assert.deepEqual(grupos[3].map((i) => i.numero_item), [5], "mesmo fornecedor em duas linhas conta uma vez");
  assert.equal(semLista, 1, "só o vencedor da Pesquisa de Preços: a fonte não diz quantos foram");
});

test("filtro or= do PostgREST só com letras, números e espaço", () => {
  assert.equal(B.filtroOu(["papel sulfite", "ca", "café, (moído)"]), "descricao.ilike.*papel sulfite*,descricao.ilike.*café moído*");
  assert.equal(B.filtroOu([]), "");
});

test("planilha: grupo em cada linha, valor como número e célula com fórmula neutralizada", () => {
  const grupos = { desertos: [], 1: [{ ...it(3, "Homologado", []), descricao: "=HYPERLINK(1)", valor_estimado: 12.5, historico_compras: { link_origem: "https://evil.example/x" } }], 2: [], 3: [] };
  const [cab, linha] = B.linhasPlanilha(grupos);
  assert.equal(cab[0], "Grupo");
  assert.equal(linha[0], "1 licitante");
  assert.equal(linha[6], "'=HYPERLINK(1)");
  assert.equal(linha[9], 12.5);
  assert.equal(linha[11], "", "link fora dos hosts oficiais não vai para a planilha");
});
