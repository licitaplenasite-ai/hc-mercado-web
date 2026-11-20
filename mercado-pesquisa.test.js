const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./mercado-pesquisa.js");

const contrato = (cnpj, nome, orgao, valor, data) => M.deContrato({ cnpjFornecedor: cnpj, nomeFornecedor: nome, orgao, uf: "AM", valor, dataAssinatura: data, objeto: "Papel A4" }, "c");
const resultado = (id, doc, unit, qtd, data, desc = "PAPEL A4, 75G", un = "RESMA") => M.deResultado({
  item: { id, descricao: desc, unidadeMedida: un }, fornecedor: { nome: "Fornecedor " + doc, documento: doc },
  resultado: { data, valorUnitarioHomologado: unit, quantidadeHomologada: qtd }, compra: { uf: "am" } }, "link-" + id);
const aoVivo = (itemCompra, doc, unit, data, orgao) => M.dePrecoAoVivo({ itemCompra, fornecedor: "F " + doc, documentoFornecedor: doc, orgao, uf: "PA", dataResultado: data, descricaoItem: "Papel A4 (alcalino)", unidade: "resma", valorUnitario: unit, quantidade: 10, link: "vivo-" + itemCompra });

test("juntar: tira o item repetido entre base guardada e consulta ao vivo e respeita o período", () => {
  const vendas = M.juntar([[resultado("1", "11", 20, 5, "2026-10-01")], [aoVivo("1", "11", 20, "2026-10-01", "X"), aoVivo("2", "22", 30, "2025-01-01", "X")]], "2026-01-01");
  assert.equal(vendas.length, 1);
  // Sem data entra (fonte não informou), como no resto do painel.
  assert.equal(M.juntar([[contrato("1", "A", "O", 10, "")]], "2026-01-01").length, 1);
});

test("quemGanha ordena por vitórias e soma valor (contrato + item homologado)", () => {
  const r = M.quemGanha([contrato("11.111/0001", "Alfa", "O", 100, "2026-01-01"), resultado("9", "111110001", 10, 3, "2026-02-01"), contrato("22", "Beta", "O", 999, "2026-01-01")]);
  assert.equal(r[0].documento, "111110001");
  assert.equal(r[0].vitorias, 2);
  assert.equal(r[0].valor, 130);
  assert.equal(r[1].fornecedor, "Beta");
});

test("quemCompra ignora venda sem órgão e ordena por valor", () => {
  const r = M.quemCompra([contrato("1", "A", "Prefeitura X", 50, ""), contrato("2", "B", "prefeitura  x", 50, ""), contrato("3", "C", "Hospital Y", 70, ""), resultado("4", "4", 1, 1, "")]);
  assert.deepEqual(r.map((o) => [o.orgao, o.compras, o.valor]), [["Prefeitura X", 2, 100], ["Hospital Y", 1, 70]]);
});

test("quantoSePaga agrupa por produto e unidade, com médio, menor (e seu link) e maior", () => {
  const r = M.quantoSePaga([resultado("1", "1", 20, 1, ""), resultado("2", "2", 30, 1, ""), aoVivo("3", "3", 10, "", "O"), resultado("5", "5", 99, 1, "", "PAPEL A4", "CAIXA"), contrato("6", "C", "O", 100, "")]);
  const resma = r.find((g) => g.unidade === "RESMA");
  assert.equal(resma.compras, 3);
  assert.equal(resma.menor, 10);
  assert.equal(resma.maior, 30);
  assert.equal(resma.medio, 20);
  assert.equal(resma.linkMenor, "vivo-3");
  assert.equal(r.length, 2, "caixa é outro grupo; contrato sem preço unitário fica fora");
});

test("porMes guarda os últimos 12 meses em ordem e põe rótulo curto", () => {
  const meses14 = ["2026-02", "2026-01", ...Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`)];
  const vendas = meses14.map((m) => contrato("1", "A", "O", 10, `${m}-05`));
  const meses = M.porMes(vendas);
  assert.equal(meses.length, 12);
  assert.equal(meses.at(-1).rotulo, "Fev/26");
  assert.equal(meses[0].chave, "2025-03");
});

test("porMes preenche com zero os meses sem compra entre o primeiro e o último", () => {
  const meses = M.porMes([contrato("1", "A", "O", 10, "2026-06-03"), contrato("1", "A", "O", 30, "2026-09-20"), contrato("1", "A", "O", 5, "2026-09-01")]);
  assert.deepEqual(meses.map((m) => [m.rotulo, m.valor]), [["Jun/26", 10], ["Jul/26", 0], ["Ago/26", 0], ["Set/26", 35]]);
  assert.deepEqual(M.porMes([contrato("1", "A", "O", 10, "")]), []);
});

test("preço ao vivo: embalagem entra na unidade para não misturar caixa de 10 com caixa de 500", () => {
  const g = M.quantoSePaga([aoVivo("1", "1", 5, "", "O"), M.dePrecoAoVivo({ itemCompra: "2", descricaoItem: "Papel A4", unidade: "emb", embalagem: "500 FL", valorUnitario: 25 })]);
  assert.deepEqual(g.map((x) => x.unidade).sort(), ["EMB 500 FL", "RESMA"]);
});

test("resumo conta compras, valor, fornecedores e órgãos distintos", () => {
  assert.deepEqual(M.resumo([contrato("1", "A", "O", 10, ""), contrato("1", "A", "P", 5, ""), resultado("2", "2", 1, 1, "")]), { compras: 3, valor: 16, fornecedores: 2, orgaos: 2 });
});

test("deAta: cada vencedor de cada item vira uma venda com o órgão da ata", () => {
  const vendas = M.deAta({ numeroControlePNCPAta: "A1", orgao: "Hospital Z", ufOrgao: "am", dataAssinatura: "2026-03-01T00:00:00", itens: [
    { numeroItem: 1, descricao: "Luva", vencedores: [{ nome: "X", cnpj: "11.222.333/0001-81", valorUnitario: 2, quantidade: 10 }, { nome: "Y", cnpj: "9", valorUnitario: 3, valorTotal: 50, data: "2026-04-02" }] },
    { numeroItem: 2, descricao: "Deserto", vencedores: [] }] }, "lk");
  assert.equal(vendas.length, 2);
  assert.deepEqual([vendas[0].documento, vendas[0].valorTotal, vendas[0].data, vendas[0].uf, vendas[0].orgao], ["11222333000181", 20, "2026-03-01", "AM", "Hospital Z"]);
  assert.deepEqual([vendas[1].valorTotal, vendas[1].data, vendas[1].link], [50, "2026-04-02", "lk"]);
});
