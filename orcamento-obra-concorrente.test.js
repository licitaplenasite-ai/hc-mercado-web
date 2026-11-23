'use strict';
// Modo "Analisar concorrente": cada regra nova tem um caso que aponta (pode desclassificar ou dá atenção) e um que
// passa. Planilhas fictícias montadas como o Leitor lê; no fim, o caso real de Santo Antônio do Içá (TRE-AM 2/2023),
// que só roda quando os arquivos (fora do repositório) estão nesta máquina.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const L = require('./orcamento-obra-leitor.js');
const P = require('./orcamento-obra-pdf.js');
const K = require('./orcamento-obra-concorrente.js');
const { REGRAS } = require('./orcamento-obra-regras.js');

const TOPO = [['OBRA:', 'REFORMA DE PRÉDIO PÚBLICO'], ['DATA BASE: SETEMBRO/2023 - SINAPI - AMAZONAS DESONERADO']];
const br = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const EDITAL = [['1.1', '97622', 'DEMOLIÇÃO DE ALVENARIA', 'm³', 10, 100], ['1.2', 'TRE - 0450', 'TRANSPORTE DE PESSOAL', 'SV', 1, 500], ['1.3', '87878', 'CHAPISCO', 'm²', 100, 5]];
// itens: [item, código, descrição, unidade, quantidade, unitário, total?]. BDI de 25% no rodapé, como no TRE-AM.
function planilha(itens, { topo = TOPO, ofertado, bdi = '25,00', estimado } = {}) {
  const linhas = itens.map(([i, c, d, u, q, p, t]) => [i, c, d, u, br(q), br(p), br(t ?? Math.trunc(Math.round(q * p * 1e6) / 1e4) / 100)]);
  const soma = itens.reduce((a, [, , , , q, p, t]) => a + (t ?? Math.trunc(Math.round(q * p * 1e6) / 1e4) / 100), 0);
  const rod = [['', 'CUSTO DIRETO TOTAL', br(soma)], ['', `BDI (${bdi}%)`]];
  if (estimado) rod.push(['', 'PREÇO GLOBAL DA OBRA (ESTIMADO PELO CONTRATANTE)', br(estimado)]);
  if (ofertado) rod.push(['', 'PREÇO GLOBAL DA OBRA (OFERTADO PELO LICITANTE)', br(ofertado)]);
  return L.lerPlanilha([...topo, P.TITULOS, ['1', '', 'SERVIÇOS PRELIMINARES', '', '', '', ''], ...linhas, [], ...rod]);
}
const edital = () => planilha(EDITAL, { estimado: 2500 });
const comDesconto = (f) => EDITAL.map(([i, c, d, u, q, p]) => [i, c, d, u, q, Math.round(p * f * 100) / 100]);
const analisar = (conc, op = {}) => K.analisarConcorrente({ concorrente: conc, edital: edital(), ...op });
const regras = (r) => r.achados.map((a) => `${a.regra}:${a.nivel}`);
const tem = (r, chave) => regras(r).includes(chave);

test('regras novas têm título, fonte e explicação (vão para o rascunho de recurso)', () => {
  for (const k of ['item_desconto_alto', 'verba_generica', 'regime_nao_declarado', 'leitura_documento']) assert.ok(REGRAS[k].titulo && REGRAS[k].fonte && REGRAS[k].explica, k);
});

test('proposta limpa (10% de desconto em tudo): nada que desclassifica nem de atenção', () => {
  const r = analisar(planilha(comDesconto(0.9), { ofertado: 2250 }));
  assert.deepEqual(regras(r), ['cpu_incompleta:info']);
  assert.equal(r.precoFinal, 2250);
  assert.equal(r.referencia, 2500);
  assert.equal(r.placar.nota, 0);
});

test('global_acima: preço acima do orçado desclassifica; unitário acima também aparece', () => {
  const r = analisar(planilha(comDesconto(1.04), { ofertado: 2600 }));
  assert.ok(tem(r, 'global_acima:erro') && tem(r, 'unitario_acima:erro'));
  assert.ok(!tem(analisar(planilha(comDesconto(0.9), { ofertado: 2250 })), 'global_acima:erro'));
});

test('inexequivel: abaixo de 75% desclassifica (pede desclassificação ou diligência); 75% cravado não', () => {
  const r = analisar(planilha(comDesconto(0.7), { ofertado: 1750 }));
  assert.ok(tem(r, 'inexequivel:erro'));
  assert.match(r.achados.find((a) => a.regra === 'inexequivel').texto, /linha dos 75% \(R\$\s1\.875,00\).*diligência/);
  assert.ok(tem(r, 'zona_de_risco:info'));
  assert.ok(!tem(analisar(planilha(comDesconto(0.75), { ofertado: 1875 })), 'inexequivel:erro'), 'exatamente 75% não é inferior');
});

test('garantia_adicional: abaixo de 85% o concorrente deve prestar garantia (atenção); 90% passa', () => {
  const r = analisar(planilha(comDesconto(0.8), { ofertado: 2000 }));
  assert.match(r.achados.find((a) => a.regra === 'garantia_adicional').texto, /garantia adicional de R\$\s125,00/);
  assert.ok(!tem(analisar(planilha(comDesconto(0.9), { ofertado: 2250 })), 'garantia_adicional:atencao'));
});

test('unitario_acima: um item acima do edital, mesmo com o global abaixo', () => {
  const itens = comDesconto(0.8); itens[0] = ['1.1', '97622', 'DEMOLIÇÃO DE ALVENARIA', 'm³', 10, 101];
  const r = analisar(planilha(itens));
  const a = r.achados.filter((x) => x.regra === 'unitario_acima');
  assert.deepEqual(a.map((x) => x.item), ['1.1']);
  assert.match(a[0].texto, /R\$\s126,25 acima da referência R\$\s125,00 \(valores com BDI\)/);
});

test('item_desconto_alto: item com mais de 25% de desconto pede prova de exequibilidade', () => {
  const itens = comDesconto(0.9); itens[2] = ['1.3', '87878', 'CHAPISCO', 'm²', 100, 3];
  const a = analisar(planilha(itens)).achados.find((x) => x.regra === 'item_desconto_alto');
  assert.equal(a.nivel, 'atencao');
  assert.match(a.texto, /1\.3 \(40,00%\)/);
  assert.ok(!tem(analisar(planilha(comDesconto(0.76))), 'item_desconto_alto:atencao'), '24% em cada item não é acima de 25%');
});

test('item_faltando: item apagado e quantidade mudada desclassificam', () => {
  const sem = analisar(planilha(comDesconto(0.9).slice(0, 2)));
  assert.ok(sem.achados.some((a) => a.regra === 'item_faltando' && a.nivel === 'erro' && a.item === '1.3'));
  const qtd = comDesconto(0.9); qtd[0][4] = 9;
  assert.match(analisar(planilha(qtd)).achados.find((a) => a.regra === 'item_faltando').texto, /quantidade 9, o edital pede 10/);
});

test('total_nao_fecha: quantidade × unitário errado; aceita truncar ou arredondar', () => {
  const itens = comDesconto(0.9); itens[0] = [...itens[0], 950];
  const r = analisar(planilha(itens));
  assert.ok(r.achados.some((a) => a.regra === 'total_nao_fecha' && a.item === '1.1' && a.nivel === 'erro'));
  // 3 × 33,333 = 99,999: 99,99 (truncado) e 100,00 (arredondado) passam.
  for (const t of [99.99, 100]) assert.ok(!K.analisarConcorrente({ concorrente: planilha([['1.1', '1', 'X', 'm', 3, 33.333, t]]) }).achados.some((a) => a.regra === 'total_nao_fecha'), String(t));
});

test('desconto_so_no_global: unitários iguais aos do edital e desconto só no total', () => {
  const r = analisar(planilha(EDITAL, { ofertado: 2250 }));
  assert.match(r.achados.find((a) => a.regra === 'desconto_so_no_global').texto, /R\$\s2\.250,00.*R\$\s2\.500,00/);
  assert.ok(!tem(analisar(planilha(comDesconto(0.9), { ofertado: 2250 })), 'desconto_so_no_global:atencao'));
  assert.ok(tem(analisar(planilha(comDesconto(0.9), { ofertado: 2300 })), 'total_nao_fecha:erro'), 'global maior que a soma');
});

test('verba_generica: verba criada pelo concorrente desclassifica; a que já vem no modelo do edital não', () => {
  const itens = comDesconto(0.9); itens[1] = ['1.2', 'TRE - 0450', 'TRANSPORTE DE PESSOAL', 'VB', 1, 450];
  assert.ok(analisar(planilha(itens)).achados.some((a) => a.regra === 'verba_generica' && a.nivel === 'erro' && a.item === '1.2'));
  const ed = planilha(EDITAL.map((x, i) => (i === 1 ? [...x.slice(0, 3), 'VB', 1, 500] : x)), { estimado: 2500 });
  assert.ok(!K.analisarConcorrente({ concorrente: planilha(itens), edital: ed }).achados.some((a) => a.regra === 'verba_generica'));
});

test('regime_nao_declarado e desoneracao: proposta sem a opção, e proposta em regime diferente do edital', () => {
  const semRegime = planilha(comDesconto(0.9), { topo: [['DATA BASE: SETEMBRO/2023 - SINAPI - AMAZONAS']] });
  assert.ok(tem(analisar(semRegime), 'regime_nao_declarado:atencao'));
  const outro = planilha(comDesconto(0.9), { topo: [['DATA BASE: SETEMBRO/2023 - SINAPI - AMAZONAS NÃO DESONERADO']] });
  assert.match(analisar(outro).achados.find((a) => a.regra === 'desoneracao').texto, /proposta do concorrente está não desonerada/);
  assert.ok(!tem(analisar(planilha(comDesconto(0.9))), 'regime_nao_declarado:atencao'));
});

test('cpu_incompleta: item sem composição na CPU do concorrente desclassifica; CPU completa passa; sem CPU só avisa', () => {
  const cpu = (codigos) => ({ bases: { SINAPI: { composicoes: Object.fromEntries(codigos.map((c) => [c, { itens: [] }])), precos: {} } } });
  const falta = analisar(planilha(comDesconto(0.9)), { cpu: cpu(['97622', '87878']) }).achados.find((a) => a.regra === 'cpu_incompleta');
  assert.equal(falta.nivel, 'erro'); assert.match(falta.texto, /1 item\(ns\) sem composição.*1\.2/);
  assert.ok(!analisar(planilha(comDesconto(0.9)), { cpu: cpu(['97622', 'TRE - 0450', '87878']) }).achados.some((a) => a.regra === 'cpu_incompleta'));
  assert.equal(analisar(planilha(comDesconto(0.9)), { cpu: cpu(['X']) }).achados.find((a) => a.regra === 'cpu_incompleta').nivel, 'atencao', 'CPU que não liga com nada: não acusa');
});

test('cronograma do concorrente: etapa que não soma 100% desclassifica; etapa da planilha fora do cronograma é atenção', () => {
  const r = analisar(planilha(comDesconto(0.9)), { cronograma: { meses: 2, linhas: [{ item: '1', descricao: 'SERVIÇOS PRELIMINARES', fracoes: [0.7, 0.5] }] } });
  assert.ok(tem(r, 'cronograma:erro'));
  assert.ok(tem(analisar(planilha(comDesconto(0.9)), { cronograma: { meses: 2, linhas: [{ item: '9', descricao: 'OUTRA', fracoes: [0.5, 0.5] }] } }), 'cronograma:atencao'));
  assert.ok(!analisar(planilha(comDesconto(0.9)), { cronograma: { meses: 2, linhas: [{ item: '1', descricao: 'X', fracoes: [0.5, 0.5] }] } }).achados.some((a) => a.regra === 'cronograma'));
});

test('arredondamento: valores com mais de 2 casas viram um achado só, de atenção', () => {
  const r = K.analisarConcorrente({ concorrente: planilha([['1.1', '1', 'X', 'm', 2, 10.125, 20.25], ['1.2', '2', 'Y', 'm', 1, 3.3333, 3.33]]) });
  const a = r.achados.filter((x) => x.regra === 'arredondamento');
  assert.equal(a.length, 1); assert.equal(a[0].nivel, 'atencao'); assert.match(a[0].texto, /2 item\(ns\).*1\.1, 1\.2/);
});

test('sem a planilha do edital: usa o "estimado pelo contratante" da própria proposta e avisa que não comparou itens', () => {
  const r = K.analisarConcorrente({ concorrente: planilha(comDesconto(0.7), { ofertado: 1750, estimado: 2500 }) });
  assert.equal(r.referencia, 2500);
  assert.ok(tem(r, 'inexequivel:erro') && tem(r, 'item_faltando:info'));
});

test('placar: cada regra conta uma vez por nível; 2 erros e 1 atenção = 80 (alta chance)', () => {
  const p = K.placar([{ regra: 'a', nivel: 'erro' }, { regra: 'a', nivel: 'erro' }, { regra: 'b', nivel: 'erro' }, { regra: 'c', nivel: 'atencao' }, { regra: 'd', nivel: 'info' }]);
  assert.deepEqual(p, { nota: 80, faixa: 'Alta chance de desclassificar', erro: 3, atencao: 1, info: 1 });
  assert.equal(K.placar([]).nota, 0);
});

test('rascunho de recurso: aviso de advogado, fatos com o achado, direito com a fonte, pedido e prazo; sem os "para saber"', () => {
  const r = analisar(planilha(comDesconto(0.7), { ofertado: 1750 }));
  const t = K.textoRecurso(r, { concorrente: 'Construtora X', orgao: '' });
  assert.ok(t.startsWith(K.AVISO_RECURSO));
  assert.match(t, /contra a aceitação da proposta da empresa Construtora X/);
  assert.match(t, /\[órgão\]/);
  assert.match(t, /I\. DOS FATOS[\s\S]*Abaixo de 75% do orçamento[\s\S]*linha dos 75%/);
  assert.match(t, /II\. DO DIREITO[\s\S]*Fonte: Lei 14\.133\/2021 art\. 59, §4º/);
  assert.match(t, /III\. DO PEDIDO[\s\S]*desclassificação[\s\S]*art\. 165/);
  assert.doesNotMatch(t, /Desconto na faixa que mais cai/, 'info não entra nos fatos');
});

test('relatório: html escapa o que a pessoa digitou; xlsx tem achados e rascunho', () => {
  const r = analisar(planilha(comDesconto(0.7), { ofertado: 1750 }));
  const html = K.relatorioHtml(r, { concorrente: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert') && html.includes('&lt;script&gt;'));
  const abas = K.abasRelatorio(r, {});
  assert.deepEqual(abas.map((a) => a.nome), ['Achados', 'Rascunho de recurso']);
  assert.ok(abas[0].linhas.some((l) => l[2] === REGRAS.inexequivel.titulo));
});

test('lerProposta: usa a coluna de preço da proposta, não a de referência', () => {
  const linhas = [['ITEM', 'CÓDIGO', 'DESCRIÇÃO', 'UNID.', 'QUANT.', 'Preço unit. referência (sem BDI)', 'Preço unit. proposta', 'Total proposta'], ['1.1', '97622', 'X', 'm³', 10, 100, 90, 900]];
  const r = K.lerProposta([{ nome: 'Orçamento sintético', linhas }]);
  assert.equal(r.itens[0].precoUnitario, 90);
  assert.equal(r.itens[0].totalEdital, 900);
});

// ---- Leitura de PDF com texto e da resposta da IA ----
const it = (str, x, y, w = str.length * 4) => ({ str, x, y, w });
test('PDF com texto: descrição em duas linhas, etapa com o nome em outra linha, linha repetida e rodapé', () => {
  const pagina = [
    it('OBRA:', 40, 700, 20), it('REFORMA DO CART', 108, 700, 60), it('ÓRIO ELEITORAL', 168, 700),
    it('DATA BASE: SETEMBRO/2023 - SINAPI - AMAZONAS DESONERADO', 40, 690),
    it('ITEM', 48, 650), it('CÓDIGO', 70, 650), it('DESCRIÇÃO', 200, 650), it('UNID.', 385, 650), it('QUANT.', 410, 650), it('PREÇO', 455, 654), it('UNITÁRIO', 452, 646), it('PREÇO TOTAL', 500, 650),
    it(' 1 ', 52, 630, 8), it('SERVIÇOS PRELIMINARES', 108, 630), it('1.500,00', 524, 630),
    it(' 1.1 ', 51, 610, 10), it(' 97622 ', 79, 610, 18), it('DEMOLIÇÃO DE ALVENARIA', 108, 614), it('DE FORMA MANUAL', 108, 606), it('m³', 390, 610), it('10,00', 419, 610), it('100,00', 457, 610), it('1.000,00', 527, 610),
    it(' 1.1 ', 51, 610, 10), it(' 97622 ', 79, 610, 18), it('m³', 390, 610), it('10,00', 419, 610), it('100,00', 457, 610), it('1.000,00', 527, 610),
    it(' 1.2 ', 51, 595, 10), it('TRE - 0450  TRANSPORTE', 79, 595, 100), it('SV', 390, 595), it('1,00', 421, 595), it('500,00', 457, 595), it('500,00', 527, 595),
    it(' 2 ', 52, 580, 8), it('ETAPA COM NOME', 108, 584), it('EM DUAS LINHAS', 108, 576),
    it(' 2.1 ', 51, 565, 10), it(' 87878 ', 79, 565, 18), it('CHAPISCO', 108, 565), it('m²', 390, 565), it('100,00', 418, 565), it('5,00', 459, 565), it('500,00', 527, 565),
    it('CUSTO DIRETO TOTAL', 409, 540), it(' R$ 2.000,00 ', 490, 540),
    it('PREÇO GLOBAL DA OBRA (OFERTADO PELO LICITANTE)', 255, 520), it(' R$ 2.250,00 ', 491, 520),
    it('Endereço: Rua Qualquer, 36', 31, 26), it('1 de 1', 23, 11),
  ];
  const r = P.lerMatriz(P.matrizDoPdf([pagina]));
  assert.equal(r.erro, undefined);
  const s = r.itens.filter((x) => x.tipo === 'servico');
  assert.deepEqual(s.map((x) => [x.item, x.codigo, x.descricao, x.unidade, x.quantidade, x.precoUnitario, x.totalEdital]), [
    ['1.1', '97622', 'DEMOLIÇÃO DE ALVENARIA DE FORMA MANUAL', 'm³', 10, 100, 1000],
    ['1.2', 'TRE - 0450', 'TRANSPORTE', 'SV', 1, 500, 500],
    ['2.1', '87878', 'CHAPISCO', 'm²', 100, 5, 500],
  ]);
  assert.deepEqual(r.itens.filter((x) => x.tipo === 'etapa').map((x) => [x.item, x.descricao]), [['1', 'SERVIÇOS PRELIMINARES'], ['2', 'ETAPA COM NOME EM DUAS LINHAS']]);
  assert.equal(r.cabecalho.objeto, 'REFORMA DO CARTÓRIO ELEITORAL');
  assert.equal(r.cabecalho.desonerado, true);
  assert.deepEqual([r.resumo.custoDireto, r.resumo.globalOfertado], [2000, 2250]);
  assert.deepEqual(P.conferirExtracao(r).problemas, []);
});

test('conferência da leitura: total que não fecha, etapa que não soma e soma diferente do custo direto', () => {
  const r = L.lerPlanilha([P.TITULOS, ['1', '', 'ETAPA', '', '', '', '200,00'], ['1.1', '1', 'X', 'm', '2,00', '10,00', '25,00'], ['1.2', '2', 'Y', 'm', '1,00', '', ''], [], ['', 'CUSTO DIRETO TOTAL', '30,00']]);
  const c = P.conferirExtracao(r);
  assert.equal(c.ok, false);
  assert.deepEqual(c.problemas.map((p) => p.split(':')[0]), ['Item 1.1', 'Item 1.2', 'Etapa 1', 'Os itens lidos somam 25,00, mas o custo direto diz 30,00.'.split(':')[0]]);
});

test('resposta da IA: só linhas numeradas, sem repetir a mesma linha, rodapé vira as linhas que o Leitor entende', () => {
  const m = P.matrizDaIa([
    { textos: ['DATA BASE: SETEMBRO/2023 - SINAPI - AMAZONAS DESONERADO'], linhas: [{ item: '1', descricao: 'ETAPA', total: '1.000,00' }, { item: '1.1', codigo: '97622', descricao: 'DEMOLIÇÃO', unidade: 'm³', quantidade: '10,00', precoUnitario: '100,00', total: '1.000,00' }, { item: 'TOTAL', total: '1.000,00' }] },
    { linhas: [{ item: '1.1', codigo: '97622', descricao: 'DEMOLIÇÃO', unidade: 'm³', quantidade: '10,00', precoUnitario: '100,00', total: '1.000,00' }], rodape: { custoDireto: '1.000,00', bdi: '25,00', globalOfertado: '1.200,00' } },
  ]);
  const r = P.lerMatriz(m);
  assert.deepEqual(r.itens.map((x) => [x.item, x.tipo]), [['1', 'etapa'], ['1.1', 'servico']]);
  assert.deepEqual([r.resumo.custoDireto, r.resumo.bdi, r.resumo.globalOfertado], [1000, 0.25, 1200]);
  assert.equal(r.cabecalho.uf, 'AM');
});

// ---- Caso real: Santo Antônio do Içá (TRE-AM, Concorrência 2/2023). Arquivos fora do repositório. ----
const PASTA = 'D:/TEDENCIA CLIENTE/COMPRASNET/CONCORRENCIA 2.2023 SANTO ANTONIO DO ICA';
const EDITAL_REAL = `${PASTA}/CONCORRENCIA 2-2023/PROJETO BÁSICO - SANTO ANTONIO IÇÁ/2- PB  Sto Ant - Editaveis/ANEXO 02 e 04 - ORÇAMENTO E CRONOGRAMA - SAI.xlsx`;
const GERADO = 'C:/Users/harre/Desktop/LICITAPLENA/_historico/orcamentista/piloto/santo-antonio-orcamento-gerado.xlsx';
const TENDENCIA = `${PASTA}/propostatendencia`;
const existe = (...f) => f.every((x) => fs.existsSync(x));
const lerReal = (f) => require('./scripts/xlsx_simples').lerXlsx(fs.readFileSync(f));

test('real: o nosso orçamento gerado (17% linear) como "concorrente" contra o edital original', { skip: !existe(EDITAL_REAL, GERADO) && 'arquivos do piloto fora desta máquina' }, () => {
  const r = K.analisarConcorrente({ concorrente: K.lerProposta(lerReal(GERADO)), edital: L.lerPasta(lerReal(EDITAL_REAL)) });
  assert.equal(r.precoFinal, 705413.23);
  assert.equal(Math.round(r.referencia * 100) / 100, 849986.63);
  assert.equal(r.placar.erro, 0, JSON.stringify(r.achados.filter((a) => a.nivel === 'erro')));
  assert.ok(tem(r, 'garantia_adicional:atencao'));
  assert.ok(!tem(r, 'unitario_acima:erro') && !tem(r, 'item_faltando:erro'));
});

test('real: proposta da Tendência (Excel e PDF) acha as etapas 30.2 e 30.3 que não fecham e o desconto só no global', { skip: !existe(EDITAL_REAL, `${TENDENCIA}/ANEXO 02 - ORÇAMENTO.pdf`) && 'arquivos do caso fora desta máquina' }, async () => {
  const edital = L.lerPasta(lerReal(EDITAL_REAL));
  const xlsx = K.analisarConcorrente({ concorrente: K.lerProposta(lerReal(`${TENDENCIA}/EXCEL/ANEXO 02 e 04 - ORÇAMENTO E CRONOGRAMA - SAI.xlsx`)), edital, cpu: L.lerCpu(lerReal(`${TENDENCIA}/EXCEL/ANEXO 05 - CPU - SAI.xlsx`).flatMap((a) => a.linhas)) });
  const chave = (r) => r.achados.filter((a) => a.nivel !== 'info').map((a) => `${a.regra}:${a.item || ''}`).sort();
  assert.deepEqual(chave(xlsx), ['desconto_so_no_global:', 'garantia_adicional:', 'total_nao_fecha:30.2', 'total_nao_fecha:30.3']);
  // O mesmo pelo PDF entregue (pdf.js do pdf-parse, o mesmo motor do navegador): mesmos números, mesmos achados.
  const pdf = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
  const doc = await pdf.getDocument({ data: new Uint8Array(fs.readFileSync(`${TENDENCIA}/ANEXO 02 - ORÇAMENTO.pdf`)) });
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) paginas.push((await (await doc.getPage(p)).getTextContent()).items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width })));
  const lido = P.lerMatriz(P.matrizDoPdf(paginas));
  assert.equal(lido.itens.filter((x) => x.tipo === 'servico').length, 258);
  assert.equal(P.conferirExtracao(lido).soma, 662241.24);
  const doPdf = K.analisarConcorrente({ concorrente: lido, edital, origem: 'pdf' });
  assert.deepEqual(chave(doPdf), chave(xlsx).filter((k) => k !== 'cpu_incompleta:'));
  assert.ok(tem(doPdf, 'leitura_documento:info'));
});
