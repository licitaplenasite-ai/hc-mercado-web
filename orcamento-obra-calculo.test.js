'use strict';
// Orçamentista: CPU conferida à mão contra o SINAPI, arredondamento, composição própria, preço por fonte, BDI e
// desconto, encargos, curva ABC e cronograma.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lerXlsx } = require('./scripts/xlsx_simples');
const L = require('./orcamento-obra-leitor.js');
const C = require('./orcamento-obra-calculo.js');
const BDI = require('./bdi-calculadora.js');

const cpu = L.lerCpu(lerXlsx(fs.readFileSync(path.join(__dirname, 'scripts', 'fixtures', 'orcamento-obra', 'cpu-reduzida.xlsx')))[0].linhas);

test('truncar e arredondar em 2 casas, sem ruído de ponto flutuante', () => {
  assert.equal(C.truncar(0.3541 * 24.71), 8.74); // 8,749811
  assert.equal(C.arredondar(0.3541 * 24.71), 8.75);
  assert.equal(C.truncar(3.45 * 204.99), 707.21); // 707,2155
  assert.equal(C.arredondar(3.45 * 204.99), 707.22);
  assert.equal(C.truncar(1.15 * 100), 115); // 114,99999999999999 no float
  assert.equal(C.arredondar(2.675), 2.68); // 2,67499999... no float
  assert.equal(C.truncar(-1.239), -1.23);
  assert.equal(C.ajustar(0.0229 * 29.13, 'truncar'), 0.66);
  assert.equal(C.ajustar(0.0229 * 29.13, 'arredondar'), 0.67);
});

// Contas feitas à mão com os coeficientes e preços do SINAPI AM 09/2023 desonerado (CPU de um edital real):
test('CPU 97622 (demolição de alvenaria): 0,3541 × 24,71 = 8,74 + 2,1957 × 20,25 = 44,46 → 53,20 = SINAPI', () => {
  const c = C.montarCpu('97622', cpu.bases.SINAPI);
  assert.deepEqual(c.linhas.map((l) => l.parcial), [8.74, 44.46]);
  assert.equal(c.custo, 53.2);
  assert.equal(c.custo, cpu.custosEdital['97622']);
});
test('CPU 97640 (remoção de forro): 0,0229 × 29,13 = 0,66 + 0,0647 × 20,25 = 1,31 → 1,97 = SINAPI', () => {
  const c = C.montarCpu('97640', cpu.bases.SINAPI);
  assert.deepEqual(c.linhas.map((l) => l.parcial), [0.66, 1.31]);
  assert.equal(c.custo, 1.97);
  // Arredondando cada linha daria 0,67 + 1,31 = 1,98: o SINAPI trunca.
  assert.equal(C.montarCpu('97640', cpu.bases.SINAPI, 'arredondar').custo, 1.98);
});
test('CPU 74209/001 (placa de obra): 24,37 + 40,50 + 5,55 + 5,44 + 16,08 + 250,00 + 2,22 = 344,16 = SINAPI', () => {
  const c = C.montarCpu('74209/001', cpu.bases.SINAPI);
  assert.deepEqual(c.linhas.map((l) => l.parcial), [24.37, 40.5, 5.55, 5.44, 16.08, 250, 2.22]);
  assert.equal(c.custo, 344.16);
  assert.deepEqual(c.semPreco, []);
});
test('CPU com insumo sem preço avisa quais faltam e não inventa valor', () => {
  const base = { composicoes: { X: { itens: [{ tipo: 'insumo', codigo: 'A', coeficiente: 2 }, { tipo: 'insumo', codigo: 'B', coeficiente: 1 }] } }, precos: { 'insumo|A': 1.5 } };
  const c = C.montarCpu('X', base);
  assert.deepEqual(c.semPreco, ['B']);
  assert.equal(c.custo, 3);
  assert.equal(C.montarCpu('naoExiste', base), null);
});

test('composição própria: mediana de 3 cotações, memória de cálculo e avisos', () => {
  const r = C.composicaoPropria([{ fornecedor: 'Loja A', valor: 100, data: '01/11/2026' }, { fornecedor: 'Loja B', valor: 120 }, { fornecedor: 'Loja C', valor: 110 }]);
  assert.equal(r.preco, 110);
  assert.equal(r.n, 3);
  assert.equal(r.aviso, null);
  assert.equal(r.memoria, 'Mediana de 3 cotação(ões): Loja A (01/11/2026) R$ 100,00; Loja C R$ 110,00; Loja B R$ 120,00 → R$ 110,00.');
  assert.equal(C.composicaoPropria([10, 20]).preco, 15);
  assert.match(C.composicaoPropria([10, 20]).aviso, /pelo menos 3/);
  assert.match(C.composicaoPropria([100, 105, 400]).aviso, /muito diferente/);
  assert.equal(C.composicaoPropria([]).preco, null);
  assert.equal(C.composicaoPropria(['abc', -1, 0]).preco, null);
});

test('preço por fonte: cada item usa a base da sua fonte e diz qual base valeu', () => {
  const itens = [
    { item: '1', tipo: 'etapa' },
    { item: '1.1', tipo: 'servico', fonte: 'SINAPI', codigo: '97622' },
    { item: '1.2', tipo: 'servico', fonte: 'SICRO', codigo: '5502978' },
    { item: '1.3', tipo: 'servico', fonte: 'SETOP', codigo: 'CO-3317' },
    { item: '1.4', tipo: 'servico', fonte: 'PROPRIA', codigo: '1' },
    { item: '1.5', tipo: 'servico', fonte: 'ORSE', codigo: '13045' },
    { item: '1.6', tipo: 'servico', fonte: 'SINAPI', codigo: '97640', precoUnitario: 2.5 },
  ];
  const bases = { SINAPI: { ...cpu.bases.SINAPI, precos: { ...cpu.bases.SINAPI.precos, 'composicao|97622': 53.2 }, uf: 'AM', referencia: '2023-09', desonerado: true }, SICRO: { precos: { 'composicao|5502978': 12.34 } } };
  const r = C.precificar(itens, bases, { manuais: { 1.3: { preco: 2368.61, fonte: 'SETOP', dataBase: '04/2026' } }, cotacoes: { 1.4: [100, 110, 120] } });
  const por = Object.fromEntries(r.filter((l) => l.tipo === 'servico').map((l) => [l.item, [l.origem, l.referencia]]));
  assert.deepEqual(por, { 1.1: ['base', 53.2], 1.2: ['base', 12.34], 1.3: ['manual', 2368.61], 1.4: ['cotacao', 110], 1.5: ['sem_referencia', null], 1.6: ['edital', 2.5] });
  assert.equal(r[1].baseUsada, 'SINAPI 97622 · 2023-09 · AM · desonerado');
  assert.equal(r[3].baseUsada, 'SETOP CO-3317 · 04/2026 (preço digitado)');
  assert.match(r[4].baseUsada, /^Composição própria: Mediana de 3/);
  assert.equal(r[5].baseUsada, 'ORSE 13045: sem preço no sistema');
});

test('BDI pela fórmula do TCU: [(1+AC+S+R+G)(1+DF)(1+L)/(1−I)] − 1', () => {
  // Edital real: AC 4%, S+G 0,8%, R 1,27%, DF 1,23%, L 7,4%, PIS 0,65%, COFINS 3%, ISS 2%, CPRB 4,5% -> 28,35%
  assert.equal(BDI.calcularBdi({ ac: 400, s: 80, r: 127, g: 0, df: 123, l: 740, i: 1015 }).bdi, 2835);
  // Conta à mão: 1,0607 × 1,0123 × 1,074 = 1,15320386; ÷ 0,8985 = 1,28348 -> 28,35%
  assert.equal(C.arredondar((1.0607 * 1.0123 * 1.074) / (1 - 0.1015) - 1, 4), 0.2835);
});

test('proposta: BDI e desconto no preço unitário, nunca acima da referência com BDI', () => {
  const itens = [{ item: '1', tipo: 'etapa' }, { item: '1.1', tipo: 'servico', quantidade: 18.07, referencia: 53.2 }, { item: '1.2', tipo: 'servico', quantidade: 2, referencia: 10 }];
  const r = C.proposta(itens, { bdi: 0.2835, desconto: { linear: 0.17 } });
  const s = r.linhas.filter((l) => l.tipo === 'servico');
  assert.equal(s[0].refComBdi, 68.28); // 53,20 × 1,2835 = 68,2822
  assert.equal(s[0].unitario, 56.67); // 68,28 × 0,83 = 56,6724
  assert.equal(s[0].unitarioSemBdi, 44.15); // 53,20 × 0,83 = 44,156
  assert.equal(s[0].total, 1024.02); // 18,07 × 56,67 = 1024,0269
  assert.equal(s[1].total, 21.28); // 2 × (10 × 1,2835 = 12,83 × 0,83 = 10,64)
  assert.equal(r.linhas[0].total, 1045.3);
  assert.equal(r.total, 1045.3);
  // Desconto negativo não aumenta o preço; desconto por item vale mais que o linear; BDI diferenciado por item.
  const r2 = C.proposta(itens, { bdi: 0.2, desconto: { linear: -0.1, porItem: { 1.2: 0.5 } }, bdiPorItem: { 1.2: 0.1 } });
  assert.equal(r2.linhas[1].unitario, r2.linhas[1].refComBdi);
  assert.deepEqual([r2.linhas[2].bdi, r2.linhas[2].refComBdi, r2.linhas[2].unitario], [0.1, 11, 5.5]);
  // Edital que põe o BDI só no rodapé: preço unitário fica sem BDI.
  assert.equal(C.proposta(itens, { bdi: 0.2835, bdiNoUnitario: false }).linhas[1].unitario, 53.2);
});

test('encargos sociais (SINAPI AM horista desonerado): A 17,80 + B 46,67 + C 10,58 + D 8,68 = 83,73%', () => {
  const g = { A: [0, 0.015, 0.01, 0.002, 0.006, 0.025, 0.03, 0.08, 0.01].map((valor) => ({ valor })),
    B: [0.1795, 0.0401, 0.0086, 0.1094, 0.0007, 0.0073, 0.0189, 0.001, 0.1008, 0.0004].map((valor) => ({ valor })),
    C: [0.0437, 0.001, 0.0298, 0.0276, 0.0037].map((valor) => ({ valor })), D2: 0.0037 };
  assert.deepEqual(C.encargosSociais(g), { A: 0.178, B: 0.4667, C: 0.1058, D1: 0.0831, D2: 0.0037, D: 0.0868, total: 0.8373 });
  // Mesmo quadro sem desoneração: INSS 20% no grupo A.
  const sem = { ...g, A: [{ valor: 0.2 }, ...g.A.slice(1)] };
  assert.equal(C.encargosSociais(sem).A, 0.378);
});

test('reoneração gradual: INSS da folha e CPRB da construção por ano', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028].map((a) => C.inssGrupoA(true, a)), [0, 0.05, 0.1, 0.15, 0.2]);
  assert.equal(C.inssGrupoA(false, 2026), 0.2);
  assert.deepEqual([2024, 2025, 2026, 2027, 2028].map(C.cprbConstrucao), [0.045, 0.036, 0.027, 0.018, 0]);
});

test('curva ABC: ordem por valor, acumulado e classe pelo acumulado antes do item', () => {
  const linhas = [70, 15, 10, 5].map((total, i) => ({ item: `1.${i + 1}`, tipo: 'servico', total }));
  const abc = C.curvaAbc([{ item: '1', tipo: 'etapa', total: 100 }, ...linhas.reverse()]);
  assert.deepEqual(abc.map((x) => [x.item, x.acumulado, x.classe]), [['1.1', 0.7, 'A'], ['1.2', 0.85, 'A'], ['1.3', 0.95, 'B'], ['1.4', 1, 'C']]);
});

test('cronograma: distribui por mês e o último mês fecha a etapa no centavo', () => {
  const linhas = [{ item: '1', tipo: 'etapa', total: 100 }, { item: '2', tipo: 'etapa', total: 10 }, { item: '2.1', tipo: 'etapa', total: 10 }];
  const c = C.cronograma(linhas, 3, { 1: [0.5, 0.5, 0] });
  assert.deepEqual(c.etapas.map((e) => e.valores), [[50, 50, 0], [3.33, 3.33, 3.34]]);
  assert.deepEqual(c.porMes, [53.33, 53.33, 3.34]);
  assert.deepEqual(c.acumulado, [53.33, 106.66, 110]);
  assert.equal(c.total, 110);
});
