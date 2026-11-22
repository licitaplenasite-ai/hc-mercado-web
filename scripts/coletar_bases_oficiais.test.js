const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./coletar_bases_oficiais");

const R = C.SICRO_RAIZ;
// Recorte da página da região Norte (22/11/2026): link por UF e mês, com "revisado" e a pasta fora do padrão do Acre.
const NORTE = `
<a href="${R}/norte/amazonas/2026/abril/abril-2026">Abril</a>
<a href="${R}/norte/amazonas/2026/julho/julho-2026">Julho</a>
<a href="${R}/norte/acre/2026/abril-2026/abril-2026">Abril</a>
<a href="${R}/norte/acre/2018/julho/julho-2018-revisado">Julho revisado</a>
<a href="${R}/norte/para/2026/julho/julho-2026">Julho</a>
<a href="${R}/norte/para/2026/julho/julho-2026-revisado">Julho revisado</a>
<a href="http://www.facebook.com/sharer.php?u=${R}/norte/norte">compartilhar</a>
<a href="${R}/norte/atlantida/2026/julho/julho-2026">UF que não existe</a>`;

test("sicroMesesDaRegiao: mês mais novo de cada UF, revisado vence, pasta fora do padrão e UF desconhecida", () => {
  const m = C.sicroMesesDaRegiao(NORTE, "norte");
  assert.deepEqual(Object.keys(m).sort(), ["AC", "AM", "PA"]);
  assert.equal(m.AM.mes, "2026-07");
  assert.equal(m.AC.mes, "2026-04");
  assert.equal(m.PA.revisado, true);
  assert.match(m.PA.url, /julho-2026-revisado$/);
});

test("sicroArquivo acha o .7z da página do mês", () => {
  assert.equal(C.sicroArquivo(`<a href="${R}/norte/amazonas/2026/julho/am-07-2026.7z" class="internal-link">Julho/2026</a>`), `${R}/norte/amazonas/2026/julho/am-07-2026.7z`);
  assert.equal(C.sicroArquivo("<p>sem arquivo</p>"), null);
});

test("lerTabelaPorCabecalho: acha o cabeçalho pelo nome, ignora título e linha sem preço, lê coluna com desoneração", () => {
  const linhas = [
    ["DNIT - SICRO", "", "", ""],
    ["Relatório Sintético de Composições de Custos", "", "", ""],
    [],
    ["Código", "Descrição", "Unidade", "Custo Unitário", "Custo Unitário com desoneração"],
    ["5502978", "Compactação de aterros a 100% do Proctor normal", "m³", 4.5123, 4.3101],
    ["", "FASE 1", "", ""],
    ["5502985", "Escavação", "m³", 0, 0],
    ["M0001", "Areia média", "m³", "abc", ""],
  ];
  const r = C.lerTabelaPorCabecalho(linhas);
  assert.equal(r.temDesonerado, true);
  assert.deepEqual(r.linhas, [{ codigo: "5502978", descricao: "Compactação de aterros a 100% do Proctor normal", unidade: "m³", preco: 4.5123, precoDesonerado: 4.3101 }]);
});

test("lerTabelaPorCabecalho sem cabeçalho reconhecível devolve vazio (o robô para e avisa)", () => {
  assert.deepEqual(C.lerTabelaPorCabecalho([["a", "b"], [1, 2]]), { linhas: [], temDesonerado: false });
});

test("partesSicro e versaoSicro: preços por UF no formato do SINAPI e regra de arredondamento do SICRO", () => {
  const p = Object.fromEntries(C.partesSicro("AM", [{ codigo: "5502978", descricao: "Compactação", unidade: "m³", preco: 4.51, precoDesonerado: null }], [{ codigo: "M0001", descricao: "Areia", unidade: "m³", preco: 90, precoDesonerado: null }]).map((x) => [x.parte, x.conteudo]));
  assert.deepEqual(p["precos:AM:55"], { "composicao|5502978": [4.51, null] });
  assert.deepEqual(p["precos:AM:M0"], { "insumo|M0001": [90, null] });
  const v = C.versaoSicro("AM", "2026-07", "https://x/am-07-2026.7z", "precos", 2, "nao_informado");
  assert.equal(v.arredondamento, "arredondar");
  assert.equal(v.versao, "07/2026");
  assert.equal(v.data_base, "2026-07-01");
  assert.equal(v.arquivo, "am-07-2026.7z");
});

test("seinfraVersoes e orseUltimoMes leem o texto da página oficial", () => {
  assert.deepEqual(C.seinfraVersoes("<li>Tabela 028 Sem Desoneração</li><li>Tabela 028.1 Com Desoneração</li>"), [{ versao: "028", desonerado: false }, { versao: "028.1", desonerado: true }]);
  assert.equal(C.orseUltimoMes('<a href="contardownloads.asp?url=downloads/20260701-00.ORSE">x</a> 20260801-00.ORSE 20251201-01.ORSE'), "2026-08");
  assert.equal(C.orseUltimoMes("nada"), null);
});

test("atrasada: SICRO trimestral com 2 meses de tolerância; base sem calendário nunca atrasa", () => {
  assert.equal(C.atrasada("SICRO", "2026-07", Date.UTC(2026, 10, 22)), false); // 4 meses
  assert.equal(C.atrasada("SICRO", "2026-04", Date.UTC(2026, 10, 22)), true); // 7 meses
  assert.equal(C.atrasada("SEINFRA-CE", "2023-10", Date.UTC(2026, 10, 22)), false);
});
