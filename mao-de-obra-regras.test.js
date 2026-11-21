const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./mao-de-obra-regras.js');

// Caso conferido à mão (ver os comentários de cada linha): servente de limpeza, 44h, salário R$ 1.800,00,
// insalubridade 20% do salário mínimo R$ 1.621,00, VT 2 × R$ 5,00 × 22 dias, VA R$ 25,00 × 22 dias,
// uniforme R$ 50,00, Lucro Presumido (PIS 0,65 + COFINS 3 + ISS 5), CI 3%, lucro 6%, 3 postos, 12 meses.
const SERVENTE = { salarioBase: 1800, insalubridadePct: 20, vtValorPassagem: 5, vaValorDia: 25, uniformes: 50, postos: 3 };
const valor = (r, modulo, item) => r.modulos.find((m) => m.id === modulo).linhas.find((l) => l.item === item).valor;
const total = (r, modulo) => r.modulos.find((m) => m.id === modulo).total;

test('caso conferido à mão: servente 44h, R$ 1.800,00 + insalubridade 20% do mínimo', () => {
  const r = R.calcular(SERVENTE);
  assert.equal(r.erro, undefined);
  // Módulo 1: 1.800,00 + 20% × 1.621,00 (324,20) = 2.124,20
  assert.equal(valor(r, '1', 'C'), 32420);
  assert.equal(total(r, '1'), 212420);
  // 2.1: 8,33% × 2.124,20 = 176,95 ; 2,78% = 59,05 → 236,00
  assert.equal(valor(r, '2.1', 'A'), 17695);
  assert.equal(valor(r, '2.1', 'B'), 5905);
  assert.equal(total(r, '2.1'), 23600);
  // 2.2 sobre 2.360,20: 472,04 + 59,01 + 70,81 + 35,40 + 23,60 + 14,16 + 4,72 + 188,82 = 868,56 (36,80%)
  assert.deepEqual(r.modulos.find((m) => m.id === '2.2').linhas.map((l) => l.valor), [47204, 5901, 7081, 3540, 2360, 1416, 472, 18882]);
  assert.equal(total(r, '2.2'), 86856);
  assert.equal(r.total22Pct, 36.8);
  // 2.3: VT 2 × 5,00 × 22 = 220,00 − 6% × 1.800,00 (108,00) = 112,00 ; VA 25,00 × 22 = 550,00
  assert.equal(valor(r, '2.3', 'A'), 11200);
  assert.equal(valor(r, '2.3', 'B'), 55000);
  assert.equal(total(r, '2.3'), 66200);
  // Módulo 3: 8,92 + 0,71 + 0,29 + 41,21 + 15,17 + 73,07 = 139,37
  assert.deepEqual(r.modulos.find((m) => m.id === '3').linhas.map((l) => l.valor), [892, 71, 29, 4121, 1517, 7307]);
  assert.equal(total(r, '3'), 13937);
  // Módulo 4: 176,95 + 11,90 + 1,06 + 0,42 + 0,64 + 0 = 190,97 ; incidência 36,8% = 70,28 → 261,25
  assert.deepEqual(r.modulos.find((m) => m.id === '4').linhas.map((l) => l.valor), [17695, 1190, 106, 42, 64, 0, 7028]);
  assert.equal(total(r, '4'), 26125);
  assert.equal(total(r, '5'), 5000);
  // Módulo 6: custo 4.341,38 ; CI 130,24 ; lucro 6% × 4.471,62 = 268,30 ; antes dos tributos 4.739,92
  // faturamento 4.739,92 / (1 − 8,65%) = 5.188,7466 → PIS 33,73 ; COFINS 155,66 ; ISS 259,44
  assert.deepEqual(r.modulos.find((m) => m.id === '6').linhas.map((l) => l.valor), [13024, 26830, 3373, 15566, 25944]);
  assert.equal(r.porEmpregado, 518875);
  assert.equal(r.porPosto, 518875);
  assert.equal(r.mensal, 1556625); // 3 postos
  assert.equal(r.contrato, 18679500); // 12 meses
});

test('insalubridade incide sobre o salário mínimo (não sobre o salário-base), salvo se a CCT mandar', () => {
  const minimo = R.calcular(SERVENTE);
  assert.equal(valor(minimo, '1', 'C'), 32420); // 20% de 1.621,00, não 20% de 1.800,00 (360,00)
  const sobreSalario = R.calcular({ ...SERVENTE, insalubridadeBase: 'salario' });
  assert.equal(valor(sobreSalario, '1', 'C'), 36000);
  const outroMinimo = R.calcular({ ...SERVENTE, salarioMinimo: 1700 });
  assert.equal(valor(outroMinimo, '1', 'C'), 34000);
  assert.ok(R.calcular({ ...SERVENTE, salarioMinimo: 0 }).erro);
});

test('quantidade entra certo: empregados por posto × postos × meses (12x36 = 2 por posto)', () => {
  const r = R.calcular({ ...SERVENTE, escala: '12x36-diurno', empregadosPorPosto: R.ESCALAS['12x36-diurno'].empregados, postos: 4, meses: 30 });
  assert.equal(R.ESCALAS['12x36-diurno'].empregados, 2);
  assert.equal(r.porPosto, r.porEmpregado * 2);
  assert.equal(r.mensal, r.porEmpregado * 8);
  assert.equal(r.contrato, r.porEmpregado * 8 * 30);
  // Meio posto (ex.: 0,5) também multiplica, arredondando no centavo
  const meio = R.calcular({ ...SERVENTE, postos: 0.5 });
  assert.equal(meio.mensal, Math.round(meio.porPosto / 2));
});

test('12x36 noturna: adicional noturno 20% e hora noturna reduzida sobre salário + periculosidade', () => {
  // Vigilante: 2.000,00 + periculosidade 30% (600,00) = 2.600,00 ; hora = 2.600 / 220
  // horas noturnas no mês = 7 × 15,21 = 106,47 ; AN = 2600/220 × 20% × 106,47 = 251,66
  // HNR = 2600/220 × 1,2 × 106,47 / 7 = 215,71
  const r = R.calcular({ servico: 'vigilancia', escala: '12x36-noturno', salarioBase: 2000, periculosidadePct: 30, diasMes: 15.21, empregadosPorPosto: 2 });
  assert.equal(valor(r, '1', 'B'), 60000);
  assert.equal(valor(r, '1', 'D'), 25166);
  assert.equal(valor(r, '1', 'E'), 21571);
  assert.equal(total(r, '1'), 260000 + 25166 + 21571);
  // DSR sobre os adicionais noturnos, quando a CCT pedir
  const comDsr = R.calcular({ servico: 'vigilancia', escala: '12x36-noturno', salarioBase: 2000, periculosidadePct: 30, diasMes: 15.21, dsrPct: 16.67 });
  assert.equal(valor(comDsr, '1', 'F'), Math.round((25166 + 21571) * 0.1667));
});

test('escala diurna não paga adicional noturno nem hora reduzida', () => {
  const r = R.calcular({ ...SERVENTE, escala: '12x36-diurno', diasMes: 15.21 });
  assert.equal(valor(r, '1', 'D'), 0);
  assert.equal(valor(r, '1', 'E'), 0);
});

test('VT: desconto de 6% do salário-base nunca deixa o benefício negativo', () => {
  const r = R.calcular({ ...SERVENTE, vtValorPassagem: 2 }); // custo 88,00 < desconto 108,00
  assert.equal(valor(r, '2.3', 'A'), 0);
  const sem = R.calcular({ ...SERVENTE, vtValorPassagem: 0 });
  assert.equal(valor(sem, '2.3', 'A'), 0);
});

test('VA com desconto do empregado (PAT/CCT)', () => {
  const r = R.calcular({ ...SERVENTE, vaDescontoPct: 20 });
  assert.equal(valor(r, '2.3', 'B'), 44000); // 550,00 − 20%
});

test('RAT é multiplicado pelo FAP', () => {
  const r = R.calcular({ ...SERVENTE, rat: 3, fap: 0.5 });
  assert.equal(r.total22Pct, 35.3);
  assert.equal(valor(r, '2.2', 'C'), Math.round(236020 * 0.015));
});

test('periculosidade e insalubridade juntas geram aviso (não se acumulam)', () => {
  const r = R.calcular({ ...SERVENTE, periculosidadePct: 30 });
  assert.ok(r.avisos.some((a) => /CLT, art\. 193/.test(a.texto)));
});

test('Simples Nacional: padrões zeram terceiros e PIS/COFINS/ISS, DAS entra como tributo por dentro', () => {
  const p = R.padroesRegime('simples');
  for (const k of R.TERCEIROS) assert.equal(p[k], 0, k);
  assert.equal(p.pisPct, 0); assert.equal(p.issPct, 0); assert.equal(p.simplesPct, 4.5);
  const r = R.calcular({ ...SERVENTE, regime: 'simples', ...p });
  assert.equal(r.total22Pct, 31); // INSS 20 + RAT 3 + FGTS 8: CPP fica fora do DAS no Anexo IV
  const m6 = r.modulos.find((m) => m.id === '6').linhas;
  assert.equal(m6.length, 4);
  assert.match(m6[2].descricao, /Simples Nacional/);
  assert.ok(!r.avisos.some((a) => a.tipo === 'erro'));
});

test('Simples: cessão de mão de obra vedada para portaria, recepção, copeiragem e motorista', () => {
  for (const s of ['portaria', 'recepcao', 'copeiragem', 'motorista']) {
    assert.equal(R.regraSimples(s), 'vedado', s);
    const r = R.calcular({ ...SERVENTE, servico: s, regime: 'simples', ...R.padroesRegime('simples') });
    assert.ok(r.avisos.some((a) => a.tipo === 'erro' && /art\. 17, XII/.test(a.texto)), s);
  }
  assert.equal(R.regraSimples('limpeza'), 'permitido');
  assert.equal(R.regraSimples('vigilancia'), 'permitido');
  assert.equal(R.regraSimples('manutencao'), 'atencao');
});

test('Simples com terceiros preenchidos avisa para zerar', () => {
  const r = R.calcular({ ...SERVENTE, regime: 'simples', simplesPct: 6 });
  assert.ok(r.avisos.some((a) => /art\. 13, § 3º/.test(a.texto)));
});

test('Lucro Real: padrões PIS 1,65 e COFINS 7,60 e tributos calculados sobre o faturamento', () => {
  const p = R.padroesRegime('real');
  const r = R.calcular({ ...SERVENTE, regime: 'real', ...p });
  const [ci, lucro, pis, cofins, iss] = r.modulos.find((m) => m.id === '6').linhas.map((l) => l.valor);
  const antes = r.porEmpregado - pis - cofins - iss;
  assert.equal(antes, 434138 + ci + lucro); // custo M1..M5 não muda com o regime
  // tributo = preço × alíquota, com preço = antes / (1 − 14,25%)
  assert.equal(cofins, Math.round(antes / (1 - 0.1425) * 0.076));
  assert.ok(Math.abs(r.porEmpregado - antes / (1 - 0.1425)) <= 1.5);
});

test('entradas inválidas não calculam', () => {
  assert.match(R.calcular({}).erro, /salário-base/);
  assert.match(R.calcular({ ...SERVENTE, salarioBase: -1 }).erro, /salarioBase/);
  assert.match(R.calcular({ ...SERVENTE, ciPct: 'abc' }).erro, /ciPct/);
  assert.match(R.calcular({ ...SERVENTE, issPct: 60, cofinsPct: 40 }).erro, /tributos/);
  assert.match(R.calcular({ ...SERVENTE, escala: 'x' }).erro, /Escala/);
  assert.match(R.calcular({ ...SERVENTE, divisorHoras: 0 }).erro, /divisor/);
});

test('aceita números digitados no formato brasileiro', () => {
  assert.equal(R.lerNumero('1.800,00'), 1800);
  assert.equal(R.lerNumero('8,33'), 8.33);
  assert.equal(R.lerNumero('R$ 2.124,2'), 2124.2);
  assert.equal(R.lerNumero(''), 0);
  assert.ok(Number.isNaN(R.lerNumero('1,2,3')));
  const r = R.calcular({ ...SERVENTE, salarioBase: '1.800,00', insalubridadePct: '20' });
  assert.equal(r.porEmpregado, 518875);
});

test('arredondamento no centavo, meio para cima, sem erro de ponto flutuante', () => {
  assert.equal(R.divArred(5, 2), 3);
  assert.equal(R.divArred(590050, 100), 5901); // 59,005 → 59,01 (Salário-Educação do caso à mão)
  assert.equal(R.fmtCent(518875), '5.188,75');
  assert.equal(R.fmtCent(18679500), '186.795,00');
  assert.equal(R.fmtCent(5), '0,05');
});

test('CSV no layout do Anexo VII-D: BOM, ";" e vírgula decimal', () => {
  const r = R.calcular(SERVENTE);
  const t = R.csv(SERVENTE, r);
  assert.ok(t.startsWith('﻿Planilha de Custos e Formação de Preços – Anexo VII-D'));
  assert.ok(t.includes('\r\nItem;Descrição;Percentual;Valor (R$)\r\n'));
  assert.ok(t.includes('C;Adicional de insalubridade (sobre o salário mínimo);20%;324,20'));
  assert.ok(t.includes(';Total do Módulo 1;;2.124,20'));
  assert.ok(t.includes(';Total do Submódulo 2.2;;868,56'));
  assert.ok(t.includes('A;13º (décimo terceiro) salário;8,33%;176,95'));
  assert.ok(t.includes(';Valor total por empregado;;5.188,75'));
  assert.ok(t.includes(';Valor mensal (3 posto(s));;15.566,25'));
  assert.ok(t.includes(';Valor total do contrato (12 meses);;186.795,00'));
  // texto com ";" ou aspas vai entre aspas
  assert.ok(R.csv({ ...SERVENTE, funcao: 'Servente; "A"' }, r).includes('Função;"Servente; ""A"""'));
});

test('rascunho guardado por conta', () => {
  assert.equal(R.chaveRascunho('u1'), 'licitaplena_mao_de_obra_u1');
  assert.notEqual(R.chaveRascunho('u1'), R.chaveRascunho('u2'));
});
