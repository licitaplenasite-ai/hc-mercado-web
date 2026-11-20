const assert = require("node:assert/strict");
const test = require("node:test");
const B = require("./busca-extra.js");

const ed = (objeto, extra = {}) => ({ objeto, modalidadeNome: "Pregão - Eletrônico", ...extra });

test("limitar exige todos os termos; vazio não filtra", () => {
  const lista = [ed("Papel sulfite A4 branco"), ed("Papel toalha"), ed("Sulfite colorido")];
  assert.equal(B.filtrarExtra(lista, { limitar: "papel, sulfite" }).length, 1);
  assert.equal(B.filtrarExtra(lista, {}).length, 3);
});

test("modalidade, portal, ME/EPP e SRP", () => {
  const lista = [
    ed("Aquisição exclusiva para ME/EPP de café", { usuarioNome: "Compras.gov.br" }),
    ed("Registro de preços para papel", { srp: true, usuarioNome: "BLL Compras" }),
    ed("Café", { modalidadeNome: "Dispensa", srp: false }),
    ed("Participação exclusiva de microempresas e empresas de pequeno porte"),
  ];
  assert.deepEqual(B.filtrarExtra(lista, { modalidade: "dispensa" }).map((r) => r.objeto), ["Café"]);
  assert.equal(B.filtrarExtra(lista, { portal: "BLL" }).length, 1);
  assert.equal(B.filtrarExtra(lista, { mePp: true }).length, 2);
  assert.equal(B.filtrarExtra(lista, { excluirSrp: true }).length, 3);
  assert.equal(B.exclusivaMeEpp(ed("Material para ME do município")), false);
});

test("período por abertura usa o prazo; padrão usa a publicação", () => {
  const r = { publicacao: "2026-11-01", encerramento: "2026-11-20" };
  assert.equal(B.dataDoPeriodo(r, "abertura"), "2026-11-20");
  assert.equal(B.dataDoPeriodo(r, ""), "2026-11-01");
});

test("sugestão completa o último termo e não repete o que já está no campo", () => {
  const s = B.sugerirPalavras("café, papel s");
  assert.ok(s.includes("papel sulfite"));
  assert.deepEqual(B.sugerirPalavras("p"), []);
  assert.ok(!B.sugerirPalavras("café, caf").includes("café"));
  assert.equal(B.aplicarSugestao("café, papel s", "papel sulfite"), "café, papel sulfite, ");
});

test("UASG + número vira o id do Compras.gov e o link oficial", () => {
  assert.equal(B.idCompraGov("158465", "pregao", "90012/2026"), "15846505900122026");
  assert.equal(B.idCompraGov("926", "dispensa", "12-2025"), "00092606000122025");
  assert.equal(B.idCompraGov("158465", "pregao", "abc"), null);
  assert.equal(B.idCompraGov("1234567", "pregao", "1/2026"), null);
  assert.equal(B.idCompraGov("158465", "concorrencia", "1/2026"), null);
  assert.match(B.linkComprasGov("15846505900122026"), /compra=15846505900122026$/);
  assert.equal(B.linkComprasGov("123"), null);
});

test("mesmoNumero compara UASG sem zeros e número/ano", () => {
  const r = { codigoUnidade: "158465", numeroCompra: "90012", anoCompra: "2026" };
  assert.equal(B.mesmoNumero(r, "158465", "90012/2026"), true);
  assert.equal(B.mesmoNumero({ ...r, numeroCompra: "90012/2026" }, "158465", "90.012/2026"), true);
  assert.equal(B.mesmoNumero(r, "158466", "90012/2026"), false);
  assert.equal(B.mesmoNumero(r, "158465", "90012/2025"), false);
});

test("centavos em BigInt sem ponto flutuante", () => {
  assert.equal(B.centavos("10.5"), 1050n);
  assert.equal(B.centavos(0.1), 10n);
  assert.equal(B.centavos("12.345"), 1234n);
  assert.equal(B.centavos(null), null);
});

test("sinais do histórico: deserto/fracassado e lance acima do estimado", () => {
  const mapa = B.sinaisPorUasg([
    { uasg: "015846", historico_itens: [
      { situacao_item: "Deserto", valor_estimado: 10 },
      { situacao_item: "Homologado", valor_estimado: "10.00", historico_participacoes: [{ valor_lance: "12.50" }, { valor_negociado: "11" }] },
      { situacao_item: "Homologado", valor_estimado: 10, historico_participacoes: [{ valor_lance: 9 }, { valor_lance: 15 }] },
    ] },
    { uasg: "200", historico_itens: [{ situacao_item: "Homologado", valor_estimado: null, historico_participacoes: [{ valor_lance: 5 }] }] },
  ]);
  assert.deepEqual(mapa.get("15846"), { itens: 3, semVencedor: 1, acimaEstimado: 1 });
  assert.equal(B.temSinal(mapa.get("15846")), true);
  assert.equal(B.temSinal(mapa.get("200")), false);
  assert.equal(B.temSinal(undefined), false);
});

test("órgãos agrupados por nome/cidade, com portais, UASG e CAPAG", () => {
  const linhas = [
    { orgao: "Prefeitura Municipal de Manaus", municipio: "Manaus", uf: "AM", codigoUnidade: "1", usuarioNome: "Compras.gov.br" },
    { orgao: "PREFEITURA MUNICIPAL DE MANAUS", municipio: "Manaus", uf: "AM", usuarioNome: "Licitanet" },
    { orgao: "UFAM", municipio: "Manaus", uf: "AM" },
  ];
  const r = B.agruparOrgaos(linhas, (g) => (/prefeitura/i.test(g.orgao) ? { disponivel: true, nota: "B" } : { disponivel: false }));
  assert.equal(r.length, 2);
  assert.equal(r[0].abertas, 2);
  assert.deepEqual(r[0].portais, ["Compras.gov.br", "Licitanet"]);
  assert.deepEqual(r[0].uasgs, ["1"]);
  assert.equal(r[0].capag, "B");
  assert.equal(r[1].capag, null);
});

test("item da busca do PNCP vira cartão com número e UASG", () => {
  const e = B.editalDaBusca({ description: "Café", orgao_nome: "X", unidade_codigo: "158465", numero: "90012", ano: "2026", numero_controle_pncp: "1-1-1/2026" });
  assert.equal(B.mesmoNumero(e, "158465", "90012/2026"), true);
  assert.equal(e.objeto, "Café");
});
