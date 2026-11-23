const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("./estudo_obras");

test("tipoDeObra classifica pelo objeto; o que não é obra fica de fora", () => {
  assert.equal(E.tipoDeObra("Contratação de empresa para REFORMA do prédio do Fórum"), "reforma");
  assert.equal(E.tipoDeObra("Execução das obras de construção da Escola Municipal"), "construcao");
  assert.equal(E.tipoDeObra("Obra de pavimentação asfáltica em vias urbanas"), "pavimentacao");
  assert.equal(E.tipoDeObra("Serviços de engenharia para manutenção predial"), "reforma");
  assert.equal(E.tipoDeObra("Aquisição de instrumental de urologia"), null);
});

test("faixas de valor e de desconto nos mesmos cortes do estudo; região da UF", () => {
  assert.deepEqual([1e6, 1e6 + 1, 5e6, 20e6, 100e6, 1e8 + 1].map(E.faixaDeValor), ["ate_1mi", "1a5mi", "1a5mi", "5a20mi", "20a100mi", "acima_100mi"]);
  assert.deepEqual([9.99, 10, 24.99, 25, 25.01, 30, 30.01].map(E.faixaDeDesconto), ["0a10", "10a20", "20a25", "25", "25a30", "25a30", "acima_30"]);
  assert.equal(E.regiaoDe("AM"), "N");
  assert.equal(E.regiaoDe("XX"), null);
});

test("registrosCsv: ponto e vírgula, aspas, aspas dobradas, ; e quebra de linha dentro do campo, BOM", () => {
  const csv = '\uFEFF"a";"b"\r\n"1";"x; ""y"""\n"2";"linha\ncontinua"\n';
  assert.deepEqual([...E.registrosCsv(csv)], [{ a: "1", b: 'x; "y"' }, { a: "2", b: "linha\ncontinua" }]);
});

test("conferirColunas avisa quando o repositório muda o cabeçalho", () => {
  assert.doesNotThrow(() => E.conferirColunas('"id_compra";"uf"\n', ["id_compra"], "x"));
  assert.throws(() => E.conferirColunas('"id";"uf"\n', ["id_compra"], "x"), (e) => e.formato && /id_compra/.test(e.message));
});

const COMPRA = { id_compra: "12345678901234567", modalidade_nome: "Concorrência - Eletrônica", valor_total_estimado: "1000000.00", unidade_orgao_uf_sigla: "AM", objeto_compra: "Reforma da escola", modo_disputa_nome_pncp: "Aberto-Fechado", ind_atual: "True", contratacao_excluida: "False" };

test("compraDoEstudo: só concorrência de obra, atual, não excluída e com valor", () => {
  assert.deepEqual(E.compraDoEstudo(COMPRA), { id_compra: "12345678901234567", uf: "AM", tipo_obra: "reforma", valor_estimado: 1000000, modo_disputa: "Aberto-Fechado" });
  assert.equal(E.compraDoEstudo({ ...COMPRA, modalidade_nome: "Pregão - Eletrônico" }), null);
  assert.equal(E.compraDoEstudo({ ...COMPRA, objeto_compra: "Aquisição de papel" }), null);
  assert.equal(E.compraDoEstudo({ ...COMPRA, valor_total_estimado: "0" }), null);
  assert.equal(E.compraDoEstudo({ ...COMPRA, ind_atual: "False" }), null);
  assert.equal(E.compraDoEstudo({ ...COMPRA, contratacao_excluida: "True" }), null);
});

const prop = (id, cls, sit, valor, extra = {}) => ({ id_compra: COMPRA.id_compra, numero_item: "1", identificacao_participante: id, porte_empresa_participante: "1", valor_proposta_calculado: String(valor * 1.2), valor_lance_calculado: String(valor), valor_negociado_julgamento_calculado: "", situacao_proposta: sit, classificacao: cls, homologado: "S", data_hora_alteracao_homologacao: "2026-10-20 10:00:00", ...extra });

test("disputaDe: desconto da vencedora pelo valor final, recusadas mais baratas (situação 2), faixas e sem CNPJ", () => {
  const c = E.compraDoEstudo(COMPRA);
  const ps = [
    prop("A", "1", "6", 820000, { valor_negociado_julgamento_calculado: "815000" }), // negociado vale
    prop("B", "", "2", 700000), // 30% de desconto, recusada
    prop("C", "", "2", 760000), // 24%, recusada
    prop("D", "2", "1", 900000),
    prop("E", "", "2", 950000), // recusada, mas mais cara: não conta
  ];
  const d = E.disputaDe(c, ps);
  assert.equal(d.desconto_vencedor, 18.5);
  assert.equal(d.participantes, 5);
  assert.equal(d.recusadas_mais_baratas, 2);
  assert.deepEqual(d.descontos_recusadas, [30, 24]);
  assert.deepEqual(d.propostas_por_faixa, { "10a20": [2, 0], "25a30": [1, 1], "20a25": [1, 1], "0a10": [1, 1] });
  assert.deepEqual(d.situacoes, { 6: 1, 2: 3, 1: 1 });
  assert.equal(d.vencedor_me_epp, true);
  assert.equal(d.faixa_valor, "ate_1mi");
  assert.equal(d.data_resultado, "2026-10-20");
  assert.equal(JSON.stringify(E.disputaDe(c, ps.map((p) => ({ ...p, identificacao_participante: `9999${p.identificacao_participante}`.padEnd(14, "0") })))).includes("9999"), false, "nenhum CNPJ de participante na disputa");
});

test("disputaDe fora do recorte: mais de 1 item, sem vencedora, vencedora abaixo de 30% ou acima de 110%", () => {
  const c = E.compraDoEstudo(COMPRA);
  assert.equal(E.disputaDe(c, [prop("A", "1", "6", 800000), prop("B", "", "2", 700000, { numero_item: "2" })]), null);
  assert.equal(E.disputaDe(c, [prop("A", "2", "6", 800000)]), null);
  assert.equal(E.disputaDe(c, [prop("A", "1", "6", 250000)]), null);
  assert.equal(E.disputaDe(c, [prop("A", "1", "6", 1150000)]), null);
});

test("estatisticas: recortes BR, região e UF × tipo × faixa, com mediana, quartis e % com recusa", () => {
  const base = { tipo_obra: "reforma", faixa_valor: "ate_1mi", participantes: 10, vencedor_me_epp: true, propostas_por_faixa: {}, data_resultado: "2026-01-01" };
  const ds = [10, 20, 30, 40].map((x, i) => ({ ...base, uf: i < 3 ? "AM" : "SP", desconto_vencedor: x, recusadas_mais_baratas: i % 2 }));
  const est = Object.fromEntries(E.estatisticas(ds).map((e) => [e.recorte, e]));
  assert.equal(est["BR|*|*"].n, 4);
  assert.equal(est["BR|*|*"].dados.desconto_mediana, 25);
  assert.equal(est["BR|*|*"].dados.desconto_p25, 17.5);
  assert.equal(est["BR|*|*"].dados.pct_com_recusa_mais_barata, 50);
  assert.equal(est["uf:AM|reforma|ate_1mi"].n, 3);
  assert.equal(est["uf:AM|reforma|ate_1mi"].dados.desconto_mediana, 20);
  assert.equal(est["regiao:N|*|*"].n, 3);
  assert.equal(est["regiao:SE|reforma|*"].n, 1);
  assert.equal(Object.keys(est).every((k) => /^(BR|regiao:[A-Z]{1,2}|uf:[A-Z]{2})\|[a-z_*]{1,30}\|[a-z0-9_*]{1,20}$/.test(k)), true, "recorte no formato do CHECK do banco");
});

test("disputasDaAmostra lê o CSV do estudo de 22/11 (cabeçalho real)", () => {
  const csv = "\uFEFFid_compra;numero_controle_pncp;uf;municipio;orgao;objeto;valor_estimado;participantes;vencedor;porte_vencedor(1=ME/EPP);desconto_vencedor_pct;recusadas_mais_baratas;descontos_das_recusadas;modo_disputa\n"
    + "98486503000402023;x;MG;MONTES CLAROS;M;Execução das obras de construção da Escola;10849097.2;5;CONSTRUTORA X LTDA;1;13.1;2;25.5|30.1;Aberto-Fechado\n"
    + "1;x;AM;M;M;obra;1;1;X;1;1;0;;Aberto\n";
  const [d, ...resto] = E.disputasDaAmostra(csv);
  assert.equal(resto.length, 0);
  assert.equal(d.tipo_obra, "construcao");
  assert.equal(d.faixa_valor, "5a20mi");
  assert.deepEqual(d.descontos_recusadas, [25.5, 30.1]);
  assert.equal(d.fonte, "amostra_20261122");
  assert.equal(JSON.stringify(d).includes("CONSTRUTORA"), false, "nome do vencedor não entra");
});

test("anonimizarMotivo tira CNPJ, CPF, e-mail, telefone, link, nome da empresa e nome depois de Sr./pregoeiro", () => {
  const t = "Sr. João da Silva, a proposta da CONSTRUTORA ALFA LTDA (12.345.678/0001-90) foi recusada: CPU incompleta. CPF 123.456.789-01, contato joao@alfa.com.br ou (92) 99999-8888, ver https://x.gov.br/a";
  const s = E.anonimizarMotivo(t, ["CONSTRUTORA ALFA LTDA"]);
  assert.equal(s, "Sr. [nome], a proposta da [empresa] ([CNPJ]) foi recusada: CPU incompleta. CPF [CPF], contato [e-mail] ou [telefone], ver [link]");
  assert.doesNotMatch(s, /@|\d{3}\.\d{3}/);
  assert.equal(E.anonimizarMotivo("x".repeat(2000)).length, 1000);
});

test("categoriaDoMotivo separa os motivos que mais derrubam", () => {
  assert.equal(E.categoriaDoMotivo("A empresa não enviou a proposta ajustada no prazo de 2 horas"), "prazo");
  assert.equal(E.categoriaDoMotivo("Composições de custo unitário ausentes"), "cpu");
  assert.equal(E.categoriaDoMotivo("Tabela de encargos sem a opção de desoneração"), "encargos");
  assert.equal(E.categoriaDoMotivo("Proposta inexequível, abaixo de 75%"), "inexequivel");
  assert.equal(E.categoriaDoMotivo("Preço unitário acima do valor de referência"), "preco_acima");
  assert.equal(E.categoriaDoMotivo("Atestado de capacidade técnica insuficiente"), "habilitacao");
  assert.equal(E.categoriaDoMotivo("Declaração sem assinatura do responsável técnico"), "documento");
  assert.equal(E.categoriaDoMotivo("Outra coisa"), "outro");
});

test("URLs do repositório seguem o LEIAME (propostas com hífen, compras com sublinhado)", () => {
  assert.equal(E.urlPropostas("2026-10"), "https://repositorio.dados.gov.br/seges/comprasgov/propostas/2026/10/propostas-2026-10.csv.zip");
  assert.equal(E.urlCompras("2026-10"), "https://repositorio.dados.gov.br/seges/comprasgov/pncp/2026/10/compra_2026_10.csv.zip");
});

test("semente do repositório (workflow estudo-obras.yml, semente=1): lê as 1466 disputas e não traz órgão nem vencedor", () => {
  const texto = require("node:fs").readFileSync(require("node:path").join(__dirname, "sementes", "amostra-obras-20261122.csv"), "utf8");
  const cabecalho = texto.split(/\r?\n/)[0].split(";").map((c) => c.trim()); // trim tira o BOM do UTF-8
  for (const proibida of ["orgao", "vencedor", "municipio", "numero_controle_pncp"]) assert.ok(!cabecalho.includes(proibida), proibida);
  const ds = E.disputasDaAmostra(texto);
  assert.equal(ds.length, 1466);
  assert.ok(ds.every((d) => d.fonte === "amostra_20261122" && /^[0-9]{17}$/.test(d.id_compra)));
});
