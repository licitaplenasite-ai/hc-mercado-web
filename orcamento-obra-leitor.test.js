'use strict';
// Leitor do Orçamento de obra: lê .xlsx de verdade (gravados pelo openpyxl, com textos compartilhados) e entende
// itens, fontes, data-base, UF, regime, rodapé, cronograma e a CPU do edital. Fixtures fictícias e reduzidas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lerXlsx } = require('./scripts/xlsx_simples');
const L = require('./orcamento-obra-leitor.js');

const FIX = path.join(__dirname, 'scripts', 'fixtures', 'orcamento-obra');
const pasta = (n) => lerXlsx(fs.readFileSync(path.join(FIX, n)));

test('lê o orçamento sintético do edital: cabeçalho, itens, fontes e rodapé', () => {
  const r = L.lerPasta(pasta('edital-reduzido.xlsx'));
  assert.equal(r.aba, 'Orçamento Sintético');
  assert.deepEqual(r.cabecalho, { dataBase: '2023-09', uf: 'AM', desonerado: true, encargosHorista: 0.8373, encargosMensalista: 0.4663, lei: null });
  const s = r.itens.filter((i) => i.tipo === 'servico');
  assert.equal(s.length, 12);
  assert.equal(r.itens.filter((i) => i.tipo === 'etapa').length, 2);
  assert.deepEqual({ ...s[0], linhaPlanilha: undefined }, { item: '1.1', nivel: 2, tipo: 'servico', descricao: 'DEMOLIÇÃO DE ALVENARIA DE BLOCO FURADO, DE FORMA MANUAL', linhaPlanilha: undefined,
    codigo: '97622', fonte: 'SINAPI', unidade: 'm³', quantidade: 18.07, precoUnitario: 53.2, unitarioComBdiEdital: null, totalEdital: 961.32 });
  assert.equal(s.find((i) => i.codigo === '74209/001').fonte, 'SINAPI', 'código antigo do SINAPI com barra');
  assert.equal(s.find((i) => i.codigo === 'ORG - 0450').fonte, 'PROPRIA');
  assert.deepEqual(r.fontes, { SINAPI: 3, PROPRIA: 9 });
  assert.equal(r.resumo.custoDireto, 3072.11);
  assert.equal(r.resumo.bdi, 0.2835);
  assert.equal(r.resumo.global, 3943.05);
  assert.equal(r.emBranco, false);
  assert.deepEqual(r.avisos, []);
});

test('item gravado como número no Excel (2.10 virou 2.1) volta a ser 2.10, sem duplicar o 2.1', () => {
  const s = L.lerPasta(pasta('edital-reduzido.xlsx')).itens.filter((i) => i.tipo === 'servico');
  assert.deepEqual(s.filter((i) => i.item.startsWith('2.')).map((i) => i.item), ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9', '2.10']);
});

test('planilha em branco com várias bases: reconhece cada fonte e marca emBranco', () => {
  const r = L.lerPasta(pasta('edital-em-branco.xlsx'));
  assert.equal(r.emBranco, true);
  assert.equal(r.cabecalho.uf, 'PB');
  assert.equal(r.cabecalho.dataBase, null);
  assert.ok(r.avisos.some((a) => /data-base/.test(a)));
  const fonte = Object.fromEntries(r.itens.filter((i) => i.tipo === 'servico').map((i) => [i.item, i.fonte]));
  assert.deepEqual(fonte, { 1.1: 'ORSE', 1.2: 'SETOP', 1.3: 'SINAPI', 2.1: 'PROPRIA', 2.2: 'CREA', 2.3: 'SIURB' });
  assert.equal(r.colunas.unitarioComBdi, 8, 'acha a coluna "Valor Unit com BDI"');
  assert.equal(r.colunas.total, 9);
});

test('regime: "não desonerado", "desonerado" e os dois juntos (edital que deixa escolher)', () => {
  assert.equal(L.metadados(['Planilha NÃO DESONERADA']).desonerado, false);
  assert.equal(L.metadados(['Encargos sem desoneração']).desonerado, false);
  assert.equal(L.metadados(['LEIS SOCIAIS DESONERADAS']).desonerado, true);
  assert.equal(L.metadados(['EMPRESA OPTANTE PELA DESONERAÇÃO ( )   EMPRESA NÃO OPTANTE PELA DESONERAÇÃO ( )']).desonerado, null);
  assert.equal(L.metadados(['SINAPI - AMAZONAS   VIGÊNCIA']).uf, 'AM');
  assert.equal(L.metadados(['Data-base: 03/2026']).dataBase, '2026-03');
});

test('sem cabeçalho reconhecível devolve erro em português', () => {
  assert.match(L.lerPlanilha([['a', 'b'], [1, 2]]).erro, /linha de títulos/);
  assert.match(L.lerPasta([{ nome: 'x', linhas: [['nada']] }]).erro, /Nenhuma aba/);
});

test('cronograma do edital vira fração por mês', () => {
  const c = L.lerCronograma(pasta('edital-reduzido.xlsx')[1].linhas);
  assert.equal(c.meses, 2);
  assert.deepEqual(c.linhas.map((l) => [l.item, l.fracoes]), [['1', [1, 0]], ['2', [0.4, 0.6]]]);
  assert.deepEqual(c.geral, [0.6712, 0.3288]);
});

test('CPU do edital vira base por fonte, com o custo que o edital deu a cada composição', () => {
  const { bases, custosEdital } = L.lerCpu(pasta('cpu-reduzida.xlsx')[0].linhas);
  assert.deepEqual(Object.keys(bases), ['SINAPI']);
  assert.deepEqual(custosEdital, { 97622: 53.2, 97640: 1.97, '74209/001': 344.16 });
  assert.equal(bases.SINAPI.composicoes['74209/001'].itens.length, 7);
  assert.equal(bases.SINAPI.precos['composicao|88316'], 20.25);
  assert.equal(bases.SINAPI.precos['insumo|00004813'], 250);
});
