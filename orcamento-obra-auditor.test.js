'use strict';
// Auditor do Orçamento de obra: um teste por regra da base (orcamento-obra-regras.js), com o caso que dispara e o
// caso que não dispara. Todo alerta tem de trazer fonte legal.
const test = require('node:test');
const assert = require('node:assert');
const A = require('./orcamento-obra-auditor.js');
const { REGRAS } = require('./orcamento-obra-regras.js');

const regras = (alertas) => alertas.map((a) => `${a.regra}:${a.nivel}`);
const s = (item, extra) => ({ item, tipo: 'servico', descricao: `Serviço ${item}`, unidade: 'm2', quantidade: 2, ...extra });
// BDI do TRE-AM (28,35% com CPRB) em centésimos de ponto, como a calculadora de BDI.
const BDI_EDIF = { tipo: 'edificios', ac: 400, s: 80, g: 0, r: 127, df: 123, l: 740, issAliquota: 200, issBase: 10000, pis: 65, cofins: 300, cprb: 450 };

test('toda regra tem título, fonte e explicação; todo alerta traz a fonte da regra', () => {
  for (const [id, r] of Object.entries(REGRAS)) assert.ok(r.titulo && r.fonte && r.explica, id);
  const a = A.auditar({ linhas: [s('1.1', { unitario: 1.234, total: 2.47 })] });
  assert.ok(a.length && a.every((x) => x.fonte && x.titulo && REGRAS[x.regra]));
});

test('bdi_faixa: acima da faixa só por causa da CPRB vira informação; fora da faixa sem CPRB vira atenção', () => {
  assert.deepEqual(regras(A.regraBdi({ bdi: BDI_EDIF })), ['bdi_faixa:info']);
  assert.match(A.regraBdi({ bdi: BDI_EDIF })[0].texto, /sem ela fica em 22,23%/);
  assert.deepEqual(regras(A.regraBdi({ bdi: { ...BDI_EDIF, cprb: 0, l: 1500 } })).slice(0, 1), ['bdi_faixa:atencao']);
  assert.deepEqual(A.regraBdi({ bdi: { ...BDI_EDIF, cprb: 0 } }), [], 'BDI 22,23% sem CPRB está dentro da faixa');
  assert.deepEqual(A.regraBdi({}), []);
});

test('iss_faixa: ISS fora de 2% a 5% pode desclassificar', () => {
  assert.ok(regras(A.regraBdi({ bdi: { ...BDI_EDIF, cprb: 0, issAliquota: 100 } })).includes('iss_faixa:erro'));
  assert.ok(!regras(A.regraBdi({ bdi: { ...BDI_EDIF, cprb: 0, issAliquota: 500 } })).includes('iss_faixa:erro'));
});

test('total_nao_fecha (BDI): BDI usado nos preços diferente do BDI composto', () => {
  assert.deepEqual(regras(A.regraBdi({ bdi: { ...BDI_EDIF, cprb: 0 }, bdiAplicado: 0.25 })), ['total_nao_fecha:erro']);
  assert.deepEqual(A.regraBdi({ bdi: { ...BDI_EDIF, cprb: 0 }, bdiAplicado: 0.2223 }), []);
});

test('unitario_acima: preço da proposta acima da referência do edital (com o BDI do edital)', () => {
  const linhas = [s('1.1', { unitario: 68.29, referenciaEdital: 53.2 }), s('1.2', { unitario: 68.28, referenciaEdital: 53.2 }), s('1.3', { unitario: 9 })];
  const a = A.regraUnitario({ linhas, bdiEdital: 0.2835, modo: 'truncar' });
  assert.deepEqual(a.map((x) => x.item), ['1.1']);
  assert.match(a[0].texto, /R\$\s68,29 acima da referência R\$\s68,28/);
});

test('etapa_acima: etapa e mês do cronograma acima da referência', () => {
  const linhas = [{ item: '1', tipo: 'etapa', descricao: 'Demolições', total: 100.01 }, { item: '2', tipo: 'etapa', descricao: 'Canteiro', total: 50 }];
  assert.deepEqual(regras(A.regraGlobalEtapas({ linhas, etapasReferencia: { 1: 100, 2: 50 } })), ['etapa_acima:erro']);
  const meses = A.regraGlobalEtapas({ linhas: [], cronograma: [10, 20.02], cronogramaReferencia: [10.5, 20] });
  assert.deepEqual(meses.map((x) => x.texto.slice(0, 5)), ['Mês 2']);
});

test('global_acima, inexequivel, garantia_adicional e zona_de_risco pelo preço global', () => {
  const g = (globalProposta) => regras(A.regraGlobalEtapas({ linhas: [], globalProposta, globalReferencia: 1000 }));
  assert.deepEqual(g(1000.01), ['global_acima:erro']);
  assert.deepEqual(g(1000), []);
  assert.deepEqual(g(900), []);
  assert.deepEqual(g(830), ['garantia_adicional:atencao']);
  assert.deepEqual(g(790), ['garantia_adicional:atencao', 'zona_de_risco:atencao']);
  assert.deepEqual(g(750), ['garantia_adicional:atencao', 'zona_de_risco:atencao'], 'exatamente 75% não é inexequível');
  assert.deepEqual(g(749.99), ['inexequivel:erro', 'zona_de_risco:atencao']);
  assert.match(A.regraGlobalEtapas({ linhas: [], globalProposta: 690, globalReferencia: 1000 })[1].texto, /48,6% \(66% no Norte\).*memorial de exequibilidade/);
  assert.match(A.regraGlobalEtapas({ linhas: [], globalProposta: 750, globalReferencia: 1000 })[1].texto, /27% das propostas/);
  assert.match(A.regraGlobalEtapas({ linhas: [], globalProposta: 705488.9, globalReferencia: 849986.63 })[0].texto, /garantia adicional de R\$\s16\.999,74/);
});

test('lei_13303: estatal não usa os 75% nem os 85%; global acima continua erro', () => {
  const g = (globalProposta) => regras(A.regraGlobalEtapas({ linhas: [], globalProposta, globalReferencia: 1000, lei: '13303' }));
  assert.deepEqual(g(700), ['lei_13303:info']);
  assert.deepEqual(g(1001), ['lei_13303:info', 'global_acima:erro']);
});

test('desoneracao: CPRB e INSS juntos, nenhum dos dois, regime trocado e edital em outro regime', () => {
  const d = (bdi, regime) => regras(A.regraDesoneracao({ bdi, regime }));
  assert.deepEqual(d(BDI_EDIF, { inssEncargos: 0.2, desonerado: true }), ['desoneracao:erro']);
  assert.deepEqual(d({ ...BDI_EDIF, cprb: 0 }, { inssEncargos: 0, desonerado: false }), ['desoneracao:erro']);
  assert.deepEqual(d(BDI_EDIF, { inssEncargos: 0 }), ['encargos:atencao'], 'sem a opção desonerado/não desonerado marcada');
  assert.deepEqual(d({ ...BDI_EDIF, cprb: 0 }, { desonerado: true }), ['desoneracao:erro']);
  assert.deepEqual(d(BDI_EDIF, { desonerado: false }), ['desoneracao:erro']);
  assert.deepEqual(d(BDI_EDIF, { desonerado: true, editalDesonerado: false }), ['desoneracao:atencao']);
  assert.deepEqual(d(BDI_EDIF, { desonerado: true, inssEncargos: 0, editalDesonerado: true, ano: 2023 }), []);
});

test('reoneracao: em 2026 a CPRB é 2,70% e o INSS da folha 10%', () => {
  assert.deepEqual(regras(A.regraDesoneracao({ bdi: BDI_EDIF, regime: { desonerado: true, ano: 2026, inssEncargos: 0 } })), ['reoneracao:erro', 'reoneracao:erro']);
  assert.deepEqual(A.regraDesoneracao({ bdi: { ...BDI_EDIF, cprb: 270 }, regime: { desonerado: true, ano: 2026, inssEncargos: 0.1 } }), []);
});

test('simples: empresa do Simples com PIS/COFINS/CPRB de outro regime', () => {
  assert.deepEqual(regras(A.regraDesoneracao({ bdi: BDI_EDIF, regime: { simples: true, desonerado: true } })), ['simples:atencao']);
  assert.deepEqual(A.regraDesoneracao({ bdi: { ...BDI_EDIF, pis: 0, cofins: 0, cprb: 0 }, regime: { simples: true, desonerado: false } }), []);
});

test('total_nao_fecha: quantidade × unitário e soma da etapa; desconto_so_no_global', () => {
  const linhas = [{ item: '1', tipo: 'etapa', total: 30 }, s('1.1', { unitario: 10, total: 20 }), s('1.2', { unitario: 5, total: 11 })];
  const a = A.regraTotais({ linhas, modo: 'truncar' });
  assert.deepEqual(a.map((x) => [x.regra, x.item]), [['total_nao_fecha', '1.2'], ['total_nao_fecha', '1']]);
  assert.deepEqual(regras(A.regraTotais({ linhas: [], total: 849986.63, globalProposta: 705488.9 })), ['desconto_so_no_global:atencao']);
  assert.deepEqual(A.regraTotais({ linhas: [{ item: '1', tipo: 'etapa', total: 20 }, s('1.1', { unitario: 10, total: 20 })], total: 20, globalProposta: 20 }), []);
});

test('total vazio (fórmula sem valor salvo) e descrição mudada', () => {
  assert.match(A.regraTotais({ linhas: [s('3.2.1', { unitario: 267.8, total: null })] })[0].texto, /total está vazio, e fica fora da soma/);
  const a = A.regraItens({ itensEdital: [s('1.1', { descricao: 'Remoção de telhas' })], linhas: [s('1.1', { descricao: 'REMOÇÃO DE TELHAS' }), ] });
  assert.deepEqual(a, [], 'maiúscula e acento não contam');
  assert.deepEqual(regras(A.regraItens({ itensEdital: [s('1.1', { descricao: 'Remoção de telhas' })], linhas: [s('1.1', { descricao: 'Remoção de forro' })] })), ['item_faltando:atencao']);
});

test('codigo_repetido: mesmo código da mesma tabela em itens diferentes', () => {
  const linhas = [s('3.2.19', { fonte: 'SIURB', codigo: '9082084', descricao: 'MÓDULO FOTOVOLTAICO 555 W' }), s('3.2.20', { fonte: 'SIURB', codigo: '9082084', descricao: 'OTIMIZADOR DE POTÊNCIA' }),
    s('1.4', { fonte: 'SETOP', codigo: 'CO-3266', descricao: 'Projeto elétrico' }), s('1.8', { fonte: 'SETOP', codigo: 'CO-3266', descricao: 'Projeto elétrico' }), s('2.3', { fonte: 'CREA', codigo: 'n/a', descricao: 'ART' }), s('2.4', { fonte: 'CREA', codigo: 'n/a', descricao: 'ART execução' })];
  assert.deepEqual(A.regraCodigoRepetido({ linhas }).map((x) => x.item), ['3.2.20']);
});

test('bdi_diferenciado: equipamento relevante com o BDI dos serviços; item sem BDI', () => {
  const linhas = [s('3.2.19', { descricao: 'MÓDULO FOTOVOLTAICO 555 W', total: 800, bdi: 0.2385 }), s('1.1', { descricao: 'Remoção de telhas', total: 150, bdi: 0.2385 }), s('1.2', { descricao: 'Projeto', total: 50, bdi: 0 })];
  assert.deepEqual(regras(A.regraBdiDiferenciado({ linhas })), ['bdi_diferenciado:atencao', 'bdi_diferenciado:info']);
  assert.deepEqual(A.regraBdiDiferenciado({ linhas: [{ ...linhas[0], bdi: 0.1528 }, linhas[1]] }), []);
});

test('arredondamento: mais de 2 casas e modo diferente do edital', () => {
  const a = A.regraArredondamento({ linhas: [s('1.1', { quantidade: 1, unitario: 705.9679, total: 705.97 })] });
  assert.deepEqual(regras(a), ['arredondamento:erro']);
  // 18,07 × 53,20 = 961,324 e 3,45 × 204,99 = 707,2155: o edital trunca, a proposta arredondou.
  const b = A.regraArredondamento({ modoTotal: 'truncar', linhas: [s('1.1', { quantidade: 3.45, unitario: 204.99, total: 707.22 }), s('1.2', { quantidade: 3.45, unitario: 204.99, total: 707.21 })] });
  assert.deepEqual(b.map((x) => [x.regra, x.nivel, x.item]), [['arredondamento', 'atencao', '1.1']]);
});

test('item_faltando: item que sumiu, quantidade mudada, unidade diferente e item a mais', () => {
  const itensEdital = [s('1.1'), s('1.2'), s('1.3'), s('1.4')];
  const linhas = [s('1.1'), s('1.2', { quantidade: 3 }), s('1.3', { unidade: 'm3' }), s('1.9')];
  const a = A.regraItens({ itensEdital, linhas });
  assert.deepEqual(a.map((x) => [x.nivel, x.item]), [['erro', '1.2'], ['atencao', '1.3'], ['erro', '1.4'], ['atencao', '1.9']]);
  assert.deepEqual(A.regraItens({ linhas }), []);
});

test('sem_referencia, cotacao e data_base: item sem preço, poucas cotações e preço sem mês', () => {
  const linhas = [
    s('1.1', { origem: 'sem_referencia', fonte: 'SETOP', codigo: 'CO-1' }),
    s('1.2', { origem: 'cotacao', propria: { aviso: 'Só 2 cotação(ões): a lei pede pelo menos 3 para justificar o preço.' } }),
    s('1.3', { origem: 'manual', manual: { fonte: 'ORSE', preco: 10 } }),
    s('1.4', { origem: 'manual', manual: { fonte: 'ORSE', preco: 10, dataBase: '09/2026' } }),
    s('1.5', { origem: 'base' }),
  ];
  assert.deepEqual(A.regraReferencias({ linhas }).map((x) => [x.regra, x.item]), [['sem_referencia', '1.1'], ['cotacao', '1.2'], ['data_base', '1.3']]);
  const semData = A.regraReferencias({ linhas: [s('1.6', { origem: 'cotacao', propria: { aviso: null, cotacoes: [{ valor: 1 }, { valor: 1, data: '01/11/2026' }] } })] });
  assert.deepEqual(regras(semData), ['cotacao:info']);
  assert.deepEqual(regras(A.regraReferencias({ linhas: [], dataBaseEdital: '2023-09', dataBaseBanco: '2026-10' })), ['data_base:atencao']);
  assert.deepEqual(A.regraReferencias({ linhas: [], dataBaseEdital: '2026-10', dataBaseBanco: '2026-10' }), []);
});

test('cpu_incompleta: item sem composição ou com insumo sem preço; insumo puro e cotação não pedem CPU', () => {
  const linhas = [s('1.1', { referencia: 10, origem: 'manual' }), s('1.2', { referencia: 10, origem: 'edital', cpu: { semPreco: [] } }), s('1.3', { referencia: 5, origem: 'base', insumo: true }),
    s('1.4', { referencia: 7, origem: 'cotacao' }), s('1.5', { referencia: 9, origem: 'base', cpu: { semPreco: ['4813'] } }), s('1.6', { referencia: null, origem: 'sem_referencia' })];
  const a = A.regraCpuIncompleta({ linhas });
  assert.deepEqual(a.map((x) => x.texto.slice(0, 40)), ['1 item(ns) sem a composição (CPU): 1.1. ', '1 composição(ões) com insumo sem preço: ']);
  assert.ok(a.every((x) => x.nivel === 'erro' && /chat da sessão/.test(x.fonte)));
  assert.equal(A.regraCpuIncompleta({ linhas: [s('1.1', { referencia: 10, origem: 'manual', manual: { cpuAnexada: true } })] }).length, 0, 'quem marcou que anexa a CPU da tabela');
});

test('checklist_envio: lembrete das declarações assinadas pelo RT e do prazo de 2 h', () => {
  assert.match(A.regraChecklistEnvio({ linhas: [s('1.1')] })[0].texto, /assinados pelo responsável técnico.*opção desonerado ou não desonerado.*2 horas/);
  assert.deepEqual(A.regraChecklistEnvio({ linhas: [] }), []);
});

test('jogo_de_planilha: descontos muito desiguais nos itens que mais pesam', () => {
  const linhas = [s('1.1', { total: 500, desconto: 0 }), s('1.2', { total: 400, desconto: 0.4 }), s('1.3', { total: 100, desconto: 0.1 })];
  assert.deepEqual(regras(A.regraJogoDePlanilha({ linhas })), ['jogo_de_planilha:atencao']);
  assert.deepEqual(A.regraJogoDePlanilha({ linhas: linhas.map((l) => ({ ...l, desconto: 0.17 })) }), []);
});

test('encargos: total informado diferente de A+B+C+D', () => {
  const grupos = { A: [{ valor: 0.178 }], B: [{ valor: 0.4667 }], C: [{ valor: 0.1058 }], D2: 0.0037 };
  assert.deepEqual(regras(A.regraEncargos({ encargos: { grupos, informado: 0.85 } })), ['encargos:erro']);
  assert.deepEqual(A.regraEncargos({ encargos: { grupos, informado: 0.8373 } }), []);
});

test('auditar ordena por gravidade e resumo diz se está pronto para o engenheiro', () => {
  const a = A.auditar({ linhas: [s('1.1', { origem: 'sem_referencia' })], globalProposta: 830, globalReferencia: 1000 });
  assert.deepEqual(a.map((x) => x.regra), ['sem_referencia', 'garantia_adicional', 'checklist_envio']);
  assert.deepEqual(A.resumo(a), { erro: 1, atencao: 1, info: 1, pronto: false });
  assert.equal(A.resumo([]).pronto, true);
});
