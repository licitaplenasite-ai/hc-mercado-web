'use strict';
// Montador do Orçamento de obra: fluxo completo (Leitor -> Orçamentista -> Auditor), as 7 abas e a exportação .xlsx
// (gravada e lida de volta), além da planilha do edital preenchida. Fixtures fictícias e reduzidas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lerXlsx, gravarXlsx, letraColuna, indiceColuna } = require('./scripts/xlsx_simples');
const L = require('./orcamento-obra-leitor.js');
const M = require('./orcamento-obra-montador.js');

const FIX = path.join(__dirname, 'scripts', 'fixtures', 'orcamento-obra');
const pasta = (n) => lerXlsx(fs.readFileSync(path.join(FIX, n)));
const BDI = { tipo: 'edificios', ac: 400, s: 80, g: 0, r: 127, df: 123, l: 740, issAliquota: 200, issBase: 10000, pis: 65, cofins: 300, cprb: 450 };

function orcamentoDoEdital(op = {}) {
  const abas = pasta('edital-reduzido.xlsx'), leitura = L.lerPasta(abas);
  const cpu = L.lerCpu(pasta('cpu-reduzida.xlsx')[0].linhas);
  return { abas, leitura, orc: M.montarOrcamento(leitura, { bases: cpu.bases, bdi: BDI, cronogramaEdital: L.lerCronograma(abas[1].linhas), regime: { desonerado: true, ano: 2023 }, ...op }) };
}

test('fluxo sem desconto refaz o orçamento do edital centavo por centavo', () => {
  const { orc } = orcamentoDoEdital();
  assert.equal(orc.bdiNoUnitario, false, 'edital com BDI no rodapé');
  assert.equal(orc.bdi, 0.2835);
  assert.equal(orc.total, 3072.11);
  assert.equal(orc.globalProposta, 3943.05);
  assert.equal(orc.globalReferencia, 3943.05);
  assert.deepEqual(orc.crono.porMes, [2064.54, 1007.57]);
  assert.deepEqual(orc.alertas.map((a) => a.regra), ['cpu_incompleta', 'bdi_faixa', 'checklist_envio']);
  assert.match(orc.alertas[0].texto, /^9 item\(ns\) sem a composição \(CPU\): 2\.2, 2\.3, 2\.4/, 'as composições do órgão (ORG) não vieram na CPU');
});

test('desconto linear de 17% vai em cada preço unitário e o Auditor avisa a garantia adicional', () => {
  const { orc } = orcamentoDoEdital({ desconto: { linear: 0.17 } });
  const it = orc.linhas.find((l) => l.item === '1.1');
  assert.equal(it.unitario, 44.15); // 53,20 × 0,83 = 44,156 (truncado)
  assert.equal(it.total, 797.79); // 18,07 × 44,15 = 797,7905
  assert.ok(orc.globalProposta < orc.globalReferencia * 0.85);
  assert.deepEqual(orc.alertas.map((a) => a.regra).sort(), ['bdi_faixa', 'checklist_envio', 'cpu_incompleta', 'garantia_adicional']);
});

test('as 9 abas saem com o aviso do engenheiro e números como número; o .xlsx volta igual', () => {
  const { orc } = orcamentoDoEdital({ desconto: { linear: 0.17 } });
  const abas = M.montarAbas(orc);
  assert.deepEqual(abas.map((a) => a.nome), ['Orçamento sintético', 'CPU', 'Composições próprias', 'BDI', 'Encargos sociais', 'Curva ABC', 'Cronograma', 'Carta-proposta', 'Alertas do Auditor']);
  for (const a of abas) assert.ok(a.linhas.flat().includes(M.AVISO), `aviso em ${a.nome}`);
  const lida = lerXlsx(gravarXlsx(abas));
  assert.deepEqual(lida.map((a) => a.nome), abas.map((a) => a.nome));
  const sint = lida[0].linhas, linha11 = sint.find((l) => l[0] === '1.1');
  assert.deepEqual(linha11.slice(0, 11), ['1.1', '97622', 'SINAPI', 'DEMOLIÇÃO DE ALVENARIA DE BLOCO FURADO, DE FORMA MANUAL', 'm³', 18.07, 53.2, 53.2, 0.17, 44.15, 797.79]);
  assert.ok(sint.some((l) => l[3] === 'PREÇO GLOBAL DA PROPOSTA' && l[10] === orc.globalProposta));
  const cpu = lida[1].linhas;
  assert.ok(cpu.some((l) => l[2] === 'Custo pela CPU' && l[6] === 344.16));
  assert.ok(lida[3].linhas.some((l) => l[0] === 'BDI FINAL' && l[1] === '28,35%'));
  assert.ok(lida[4].linhas.some((l) => /optante pela desoneração/.test(l[0]) && l[1] === '( X ) Sim    (   ) Não'), 'campo de opção pela desoneração');
  assert.deepEqual(lida[5].linhas.find((l) => l[0] === '2.2').slice(-1), ['A']);
  const carta = lida[7].linhas;
  assert.ok(carta.some((l) => l[0] === 'Valor global da proposta (R$):' && l[1] === orc.globalProposta));
  assert.ok(carta.some((l) => l[0] === 'Objeto:' && l[1] === 'REFORMA DE PRÉDIO PÚBLICO EM MUNICÍPIO/AM'));
  assert.ok(carta.some((l) => l[2] === 'Responsável técnico (CREA/CAU nº ______)'));
  assert.ok(lida[2].linhas.some((l) => l[0] === 'Item 2.2') && lida[2].linhas.some((l) => /detalhar mão de obra/.test(l[1] || '')), 'composição própria sem cotação pede CPU');
});

test('planilha do edital preenchida: troca só preço, total e rodapé da proposta', () => {
  const { abas, orc } = orcamentoDoEdital({ desconto: { linear: 0.17 } });
  const m = M.formatoEdital(abas[0].linhas, orc);
  const k = orc.leitura.colunas, linha = m[orc.linhas.find((l) => l.item === '1.1').linhaPlanilha];
  assert.deepEqual([linha[k.precoUnitario], linha[k.total]], [44.15, 797.79]);
  const rotulo = (re) => m.find((l) => re.test(String(l[0])));
  assert.equal(rotulo(/CUSTO DIRETO/)[k.total], orc.total);
  assert.equal(rotulo(/DESCONTO/)[k.total], 0.17);
  assert.equal(rotulo(/OFERTADO PELO LICITANTE/)[k.total], orc.globalProposta);
  assert.equal(rotulo(/ESTIMADO/)[k.total], 3943.05, 'o estimado pelo contratante não muda');
  assert.equal(abas[0].linhas[orc.linhas.find((l) => l.item === '1.1').linhaPlanilha][k.precoUnitario], 53.2, 'não altera a matriz original');
});

test('planilha em branco com várias bases: cada item diz qual base valeu e o que falta', () => {
  const leitura = L.lerPasta(pasta('edital-em-branco.xlsx'));
  const orc = M.montarOrcamento(leitura, {
    bases: { SINAPI: { precos: { 'composicao|97647': 4.08 }, composicoes: {}, uf: 'PB', referencia: '2026-10', desonerado: false } },
    manuais: { 1.1: { preco: 600, fonte: 'ORSE', dataBase: '09/2026' }, 1.2: { preco: 2368.61, fonte: 'SETOP', dataBase: '07/2026' } },
    cotacoes: { 2.1: [{ fornecedor: 'Fornecedor 1', valor: 230 }, { fornecedor: 'Fornecedor 2', valor: 241 }, { fornecedor: 'Fornecedor 3', valor: 253 }] },
    bdiFracao: 0.2385, bdiPorItem: { 2.3: 0.1528 }, regime: { desonerado: false, ano: 2026 },
  });
  assert.equal(orc.bdiNoUnitario, true);
  const por = Object.fromEntries(orc.linhas.filter((l) => l.tipo === 'servico').map((l) => [l.item, l.origem]));
  assert.deepEqual(por, { 1.1: 'manual', 1.2: 'manual', 1.3: 'base', 2.1: 'cotacao', 2.2: 'sem_referencia', 2.3: 'sem_referencia' });
  assert.equal(orc.linhas.find((l) => l.item === '1.3').baseUsada, 'SINAPI 97647 · 2026-10 · PB · não desonerado');
  assert.equal(orc.linhas.find((l) => l.item === '2.1').unitario, 298.47); // 241 × 1,2385 = 298,4785
  assert.deepEqual(orc.alertas.filter((a) => a.regra === 'sem_referencia').map((a) => a.item), ['2.2', '2.3']);
  assert.equal(orc.globalReferencia, null, 'planilha em branco não tem orçamento de referência para comparar');
  const cpu = M.montarAbas(orc)[1].linhas;
  assert.ok(cpu.some((l) => l[0] === 'Memória:' && /Mediana de 3/.test(l[1])));
  assert.ok(cpu.some((l) => l[0] === 'Fornecedor 2' && l[2] === 241));
  const m = M.formatoEdital(pasta('edital-em-branco.xlsx')[0].linhas, orc), k = orc.leitura.colunas;
  const l11 = m[orc.linhas.find((l) => l.item === '1.1').linhaPlanilha];
  assert.deepEqual([l11[k.precoUnitario], l11[k.unitarioComBdi], l11[k.total]], [600, 743.1, 743.1]);
});

test('ajuste ao lance: maior planilha que cabe no lance, e tabela de lances com os riscos', () => {
  const abas = pasta('edital-reduzido.xlsx'), leitura = L.lerPasta(abas);
  const op = { bases: L.lerCpu(pasta('cpu-reduzida.xlsx')[0].linhas).bases, bdi: BDI, regime: { desonerado: true, ano: 2023 } };
  const o = M.ajustarAoLance(leitura, op, 3500);
  assert.ok(o.globalProposta <= 3500 && o.sobra >= 0, `global ${o.globalProposta}`);
  const umPassoAntes = M.montarOrcamento(leitura, { ...op, desconto: { linear: o.desconto.linear - 0.0001 } });
  assert.ok(umPassoAntes.globalProposta > 3500, 'é o menor desconto que cabe no lance');
  assert.equal(M.ajustarAoLance(leitura, op, -1), null, 'lance impossível');
  const t = M.tabelaDeLances(leitura, op, [0.1, 0.2, 0.3]);
  assert.deepEqual(t.map((x) => x.riscos), [[], ['Abaixo de 85%: garantia adicional', 'Desconto na faixa que mais cai'], ['Abaixo de 75% do orçamento (inexequível)', 'Desconto na faixa que mais cai']]);
  assert.ok(t[0].global > t[1].global && t[1].global > t[2].global);
});

test('valor por extenso da carta-proposta', () => {
  const x = M.valorPorExtenso;
  assert.equal(x(705488.9), 'setecentos e cinco mil quatrocentos e oitenta e oito reais e noventa centavos');
  assert.equal(x(849986.63), 'oitocentos e quarenta e nove mil novecentos e oitenta e seis reais e sessenta e três centavos');
  assert.equal(x(1), 'um real');
  assert.equal(x(0.01), 'um centavo');
  assert.equal(x(100), 'cem reais');
  assert.equal(x(1500), 'mil e quinhentos reais');
  assert.equal(x(2010.5), 'dois mil e dez reais e cinquenta centavos');
  assert.equal(x(1000000), 'um milhão de reais');
  assert.equal(x(1200000), 'um milhão e duzentos mil reais');
  assert.equal(x(9212765.02), 'nove milhões duzentos e doze mil setecentos e sessenta e cinco reais e dois centavos');
});

test('colunas do .xlsx: letra e índice', () => {
  assert.deepEqual([0, 25, 26, 701].map(letraColuna), ['A', 'Z', 'AA', 'ZZ']);
  assert.deepEqual(['A', 'Z', 'AA', 'ZZ'].map(indiceColuna), [0, 25, 26, 701]);
});
