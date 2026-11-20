const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./coletar_sinapi");

// Recorte do layout real (SINAPI_Referência_2026_10.xlsx): UF na linha 4, dados a partir da 11.
const COMPARTILHADOS = ["AC", "AM", "MATERIAL", "AREIA MÉDIA &amp; LAVADA", "M3", "CR", "Alvenaria", "ALVENARIA DE VEDAÇÃO", "M2"];
const sst = `<sst>${COMPARTILHADOS.map((t, i) => (i === 3 ? `<si><r><t>AREIA MÉDIA </t></r><r><t>&amp; LAVADA</t></r></si>` : `<si><t>${t}</t></si>`)).join("")}</sst>`;
const insumos = `<sheetData>
<row r="4"><c r="F4" t="s"><v>0</v></c><c r="G4" t="s"><v>1</v></c></row>
<row r="10"><c r="B10" t="inlineStr"><is><t>Código</t></is></c></row>
<row r="11"><c r="A11" t="s"><v>2</v></c><c r="B11"><v>370</v></c><c r="C11" t="s"><v>3</v></c><c r="D11" t="s"><v>4</v></c><c r="E11" t="s"><v>5</v></c><c r="F11"><v>99.5</v></c><c r="G11"><v>72.84999999999999</v></c></row>
<row r="12"><c r="A12" t="s"><v>2</v></c><c r="B12"><v>371</v></c><c r="C12" t="s"><v>3</v></c><c r="F12"><v>10</v></c></row>
</sheetData>`;
const composicoes = `<sheetData>
<row r="4"><c r="E4" t="s"><v>0</v></c><c r="G4" t="s"><v>1</v></c></row>
<row r="11"><c r="A11" t="s"><v>6</v></c><c r="B11" s="18"><f>HYPERLINK("#"&amp;CELL("address",OFFSET(Analítico!$B$1,MATCH(104658,Analítico!$B:$B,0)-1,3)),104658)</f><v>0</v></c><c r="C11" t="s"><v>7</v></c><c r="D11" t="s"><v>8</v></c><c r="E11"><v>1</v></c><c r="G11"><v>269.08</v></c><c r="H11"><v>0</v></c></row>
</sheetData>`;

test("textosCompartilhados junta rich text e decodifica entidades", () => {
  const t = S.textosCompartilhados(sst);
  assert.equal(t[3], "AREIA MÉDIA & LAVADA");
  assert.equal(t[1], "AM");
});

test("lerTabela (insumo): coluna de cada UF pela linha 4, preço arredondado a centavo, em branco vira null", () => {
  const l = S.lerTabela(insumos, S.textosCompartilhados(sst), "ISD", ["AM", "AC"]);
  assert.deepEqual(l[0], { tipo: "insumo", codigo: "370", descricao: "AREIA MÉDIA & LAVADA", unidade: "M3", grupo: "MATERIAL", origem: "CR",
    precos: { AM: "72.85", AC: "99.50" } });
  assert.deepEqual(l[1].precos, { AM: null, AC: "10.00" });
});

test("lerTabela (composição): código sai da fórmula HYPERLINK (valor em cache 0)", () => {
  const [c] = S.lerTabela(composicoes, S.textosCompartilhados(sst), "CCD", ["AM"]);
  assert.equal(c.codigo, "104658");
  assert.equal(c.tipo, "composicao");
  assert.equal(c.precos.AM, "269.08");
  assert.equal(c.origem, null);
  assert.equal(c.grupo, "Alvenaria");
});

test("lerTabela recusa layout sem a UF no cabeçalho (não grava lixo)", () => {
  assert.throws(() => S.lerTabela(insumos, S.textosCompartilhados(sst), "ISD", ["AM", "SP"]), /coluna da UF SP/);
});

test("montarLinhas: descrição uma vez; por UF, par sem/com desoneração; sem preço nos dois regimes fica fora", () => {
  const comp = S.textosCompartilhados(sst);
  const sd = S.lerTabela(insumos, comp, "ISD", ["AM", "AC"]);
  const cd = [{ ...sd[0], precos: { AM: "70.00", AC: null } }];
  const { itens, custos } = S.montarLinhas(sd, cd, ["AM", "AC"], "2026-10");
  assert.equal(itens.length, 2);
  assert.deepEqual(itens[0], { tipo: "insumo", codigo: "370", descricao: "AREIA MÉDIA & LAVADA", unidade: "M3", grupo: "MATERIAL", origem: "CR", referencia: "2026-10-01", busca: "areia media & lavada" });
  assert.deepEqual(custos, [
    { uf: "AM", tipo: "insumo", codigo: "370", preco_sd: "72.85", preco_cd: "70.00", referencia: "2026-10-01" },
    { uf: "AC", tipo: "insumo", codigo: "370", preco_sd: "99.50", preco_cd: null, referencia: "2026-10-01" },
    { uf: "AC", tipo: "insumo", codigo: "371", preco_sd: "10.00", preco_cd: null, referencia: "2026-10-01" },
  ]);
});

test("lerAnalitico: pula a linha da composição, lê itens com coeficiente e soma item repetido", () => {
  const xml = `<sheetData>
<row r="10"><c r="C10" t="inlineStr"><is><t>Tipo Item</t></is></c></row>
<row r="11"><c r="A11" t="inlineStr"><is><t>Acessibilidade</t></is></c><c r="B11"><v>104658</v></c><c r="E11" t="inlineStr"><is><t>PISO PODOTÁTIL</t></is></c><c r="F11" t="inlineStr"><is><t>M2</t></is></c></row>
<row r="12"><c r="B12"><v>104658</v></c><c r="C12" t="inlineStr"><is><t>COMPOSICAO</t></is></c><c r="D12"><v>88316</v></c><c r="E12" t="inlineStr"><is><t>SERVENTE</t></is></c><c r="F12" t="inlineStr"><is><t>H</t></is></c><c r="G12"><v>1.279</v></c><c r="H12" t="inlineStr"><is><t>COM CUSTO</t></is></c></row>
<row r="13"><c r="B13"><v>104658</v></c><c r="C13" t="inlineStr"><is><t>INSUMO</t></is></c><c r="D13"><v>34357</v></c><c r="E13" t="inlineStr"><is><t>REJUNTE</t></is></c><c r="F13" t="inlineStr"><is><t>KG</t></is></c><c r="G13"><v>0.24</v></c></row>
<row r="14"><c r="B14"><v>104658</v></c><c r="C14" t="inlineStr"><is><t>INSUMO</t></is></c><c r="D14"><v>34357</v></c><c r="E14" t="inlineStr"><is><t>REJUNTE</t></is></c><c r="G14"><v>0.01</v></c></row>
</sheetData>`;
  const a = S.lerAnalitico(xml, [], "2026-10");
  assert.equal(a.length, 2);
  assert.deepEqual(a[0], { composicao: "104658", item_tipo: "composicao", item_codigo: "88316", descricao: "SERVENTE", unidade: "H", coeficiente: "1.279", situacao: "COM CUSTO", referencia: "2026-10-01" });
  assert.equal(a[1].item_tipo, "insumo");
  assert.equal(Number(a[1].coeficiente), 0.25);
});

test("mapaAbas liga nome da aba ao XML pelo rels", () => {
  const wb = '<sheets><sheet name="Menu" sheetId="1" r:id="rId1"/><sheet name="ISD" sheetId="3" r:id="rId3"/></sheets>';
  const rels = '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="x" Target="/xl/worksheets/sheet3.xml"/>';
  assert.deepEqual(S.mapaAbas(wb, rels), { Menu: "xl/worksheets/sheet1.xml", ISD: "xl/worksheets/sheet3.xml" });
});

test("mesesParaTras e nomesDoMes: mês atual primeiro, virada de ano, retificação antes da original", () => {
  assert.deepEqual(S.mesesParaTras(Date.parse("2026-01-10T00:00:00Z"), 3), ["2026-01", "2025-12", "2025-11"]);
  const n = S.nomesDoMes("2026-02");
  assert.equal(n[0], "SINAPI-2026-02-formato-xlsx_Retificacao03.zip");
  assert.equal(n[n.length - 1], "SINAPI-2026-02-formato-xlsx.zip");
});
