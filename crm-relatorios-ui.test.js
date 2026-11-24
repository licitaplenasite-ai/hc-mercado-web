const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./crm-relatorios-ui.js');

// 15/11/2026 12:00 em Brasília.
const AGORA = Date.parse('2026-11-15T15:00:00Z');
const DIA = 864e5;

test('centavosDe aceita número e texto do Postgres; vazio, zero e inválido = null', () => {
  assert.equal(r.centavosDe('1234.56'), 123456);
  assert.equal(r.centavosDe(0.1 + 0.2), 30);
  assert.equal(r.centavosDe(''), null);
  assert.equal(r.centavosDe(0), null);
  assert.equal(r.centavosDe('abc'), null);
  assert.equal(r.centavosDe(null), null);
});

test('chanceDaEtapa: probabilidade da etapa vence o padrão; fora de 0..100 cai no padrão', () => {
  assert.equal(r.chanceDaEtapa({ probabilidade: 80 }, 'sessao'), 80);
  assert.equal(r.chanceDaEtapa({ probabilidade: 0 }, 'sessao'), 0);
  assert.equal(r.chanceDaEtapa({ probabilidade: null }, 'sessao'), r.CHANCE_PADRAO.sessao);
  assert.equal(r.chanceDaEtapa({ probabilidade: 150 }, 'sessao'), r.CHANCE_PADRAO.sessao);
  assert.equal(r.chanceDaEtapa(null, 'desconhecido'), 0);
});

test('mesDe usa o fuso de Brasília e não desloca data pura', () => {
  assert.equal(r.mesDe('2026-12-01T01:00:00Z'), '2026-11'); // 22h do dia 30/11 em Brasília
  assert.equal(r.mesDe('2026-12-01'), '2026-12');
  assert.equal(r.mesDe(''), null);
  assert.equal(r.somarMes('2026-11', 2), '2027-01');
});

test('previsão: disputa × chance no mês da sessão; sessão passada vai para o mês atual; sem valor fica de fora', () => {
  const etapas = [{ id: 'e1', nome: 'Participando', ordem: 1, status_sistema: 'preparacao', probabilidade: 50 }];
  const processos = [
    { id: 'a', status: 'preparacao', etapa_id: 'e1', preco_proposta: '1000.00', data_sessao: '2027-01-10T13:00:00Z' },
    { id: 'b', status: 'sessao', valor_estimado: 2000, data_sessao: '2026-10-01T13:00:00Z' },
    { id: 'c', status: 'sessao', valor_estimado: null },
    { id: 'd', status: 'perdido', valor_estimado: 9999 },
  ];
  const p = r.calcularPrevisao({ processos, etapas, agora: AGORA });
  assert.equal(p.meses.length, 6);
  assert.equal(p.meses[0].mes, '2026-11');
  assert.equal(p.meses[0].disputas, Math.round(200000 * r.CHANCE_PADRAO.sessao / 100));
  assert.equal(p.meses[2].disputas, 50000); // jan/27: R$ 1.000 × 50%
  assert.equal(p.semValor, 1);
  assert.equal(p.total, p.meses.reduce((s, m) => s + m.total, 0));
  assert.deepEqual(p.porEtapa.map((g) => [g.nome, g.quantidade, g.chance]), [['Participando', 1, 50], ['Sessão de lances', 2, r.CHANCE_PADRAO.sessao]]);
});

test('previsão: disputa além do horizonte vai para "depois", não para o total', () => {
  const p = r.calcularPrevisao({ processos: [{ id: 'a', status: 'habilitacao', valor_estimado: 100, data_sessao: '2027-09-01' }], agora: AGORA });
  assert.equal(p.total, 0);
  assert.equal(p.depois, Math.round(10000 * r.CHANCE_PADRAO.habilitacao / 100));
});

test('previsão: saldo do contrato = potencial − recebido, espalhado até a vigência, centavo exato', () => {
  const execucao = { g: { potencial: 100000, recebido: 40000, vigenciaFim: '2027-01-31' } };
  const p = r.calcularPrevisao({ processos: [{ id: 'g', status: 'contratado', data_resultado: '2026-11-01' }], execucao, agora: AGORA });
  assert.equal(p.saldoContratos, 60000);
  assert.deepEqual(p.meses.slice(0, 4).map((m) => m.contratos), [20000, 20000, 20000, 0]);
  assert.equal(p.totalContratos, 60000);
  assert.deepEqual(p.ganhos, { quantidade: 1, valor: 100000 });
});

test('previsão: sem vigência espalha em 12 meses; resto do centavo no 1º mês; vigência vencida = tudo agora', () => {
  const p = r.calcularPrevisao({ processos: [{ id: 'g', status: 'homologado', preco_proposta: '1000.01' }], agora: AGORA });
  assert.equal(p.saldoContratos, 100001);
  assert.deepEqual(p.meses.map((m) => m.contratos), [8338, 8333, 8333, 8333, 8333, 8333]);
  assert.equal(p.totalContratos + p.depois, 100001);
  const v = r.calcularPrevisao({ processos: [{ id: 'g', status: 'homologado' }], execucao: { g: { potencial: 5000, recebido: 0, vigenciaFim: '2025-01-01' } }, agora: AGORA });
  assert.equal(v.meses[0].contratos, 5000);
  const pago = r.calcularPrevisao({ processos: [{ id: 'g', status: 'homologado' }], execucao: { g: { potencial: 5000, recebido: 7000 } }, agora: AGORA });
  assert.equal(pago.saldoContratos, 0);
});

test('previsão: ganho antigo não entra em "ganhos nos últimos 90 dias"', () => {
  const p = r.calcularPrevisao({ processos: [{ id: 'g', status: 'homologado', valor_estimado: 10, data_resultado: new Date(AGORA - 120 * DIA).toISOString() }], agora: AGORA });
  assert.deepEqual(p.ganhos, { quantidade: 0, valor: 0 });
});

test('motivos: agrupa pelo código, soma valor, ordena e filtra o período', () => {
  const recente = new Date(AGORA - 10 * DIA).toISOString(), antigo = new Date(AGORA - 200 * DIA).toISOString();
  const processos = [
    { status: 'perdido', motivo_perda: 'Preço acima do vencedor: 8% abaixo', valor_estimado: 100, data_resultado: recente },
    { status: 'perdido', motivo_perda: 'Preço acima do vencedor', preco_proposta: 50, atualizado_em: recente },
    { status: 'perdido', motivo_perda: 'Inabilitação ou documento: CND vencida', valor_estimado: 300, data_resultado: antigo },
    { status: 'perdido', motivo_perda: 'texto livre antigo', valor_estimado: null, data_resultado: recente },
    { status: 'perdido', motivo_perda: null, data_resultado: recente },
    { status: 'sessao', motivo_perda: 'Preço acima do vencedor', data_resultado: recente },
  ];
  const m90 = r.agruparMotivos({ processos, periodo: '90d', agora: AGORA });
  assert.equal(m90.total, 4);
  assert.equal(m90.valorTotal, 15000);
  assert.deepEqual(m90.linhas.map((l) => [l.codigo, l.quantidade, l.valor]), [['preco', 2, 15000], ['outro', 1, 0], ['sem_motivo', 1, 0]]);
  assert.equal(m90.linhas[0].percentual, 50);
  assert.match(m90.linhas[0].conselho, /Pesquisa de Preços/);
  const tudo = r.agruparMotivos({ processos, periodo: 'tudo', agora: AGORA });
  assert.equal(tudo.total, 5);
  assert.match(tudo.linhas.find((l) => l.codigo === 'documento').conselho, /Minhas empresas e documentos/);
  assert.deepEqual(r.agruparMotivos({ processos: [], agora: AGORA }), { total: 0, valorTotal: 0, linhas: [] });
});

test('lerChance: vazio = padrão, 0..100 inteiro, resto inválido', () => {
  assert.equal(r.lerChance(''), null);
  assert.equal(r.lerChance(' 40 '), 40);
  assert.equal(r.lerChance('100'), 100);
  assert.equal(r.lerChance('101'), undefined);
  assert.equal(r.lerChance('4,5'), undefined);
  assert.equal(r.lerChance('-1'), undefined);
});

test('html escapa nome de etapa e mostra estimativa e estado vazio', () => {
  const p = r.calcularPrevisao({ processos: [{ id: 'a', status: 'preparacao', etapa_id: 'x', valor_estimado: 10 }], etapas: [{ id: 'x', nome: '<b>Etapa</b>', status_sistema: 'preparacao' }], agora: AGORA });
  const html = r.htmlPrevisao(p, { podeAjustar: true });
  assert.match(html, /Estimativa/);
  assert.match(html, /&lt;b&gt;Etapa/);
  assert.match(r.htmlMotivos({ total: 0, valorTotal: 0, linhas: [] }, '12m'), /Nenhuma licitação perdida/);
});

test('previsão zerada mostra convite em vez de 6 barras vazias', () => {
  const html = r.htmlPrevisao(r.calcularPrevisao({ processos: [], agora: AGORA }), { podeAjustar: false });
  assert.match(html, /Ainda não há o que prever/);
  assert.doesNotMatch(html, /crm-meses/);
  assert.doesNotMatch(html, /data-crm-ajustar/);
});

test('exemplos (coluna exemplo ou prefixo "[Exemplo] ") não entram na previsão nem nas perdas', () => {
  assert.equal(r.ehExemplo({ exemplo: true, objeto: 'Papel' }), true);
  assert.equal(r.ehExemplo({ exemplo: false, objeto: '  [Exemplo] Papel A4' }), true);
  assert.equal(r.ehExemplo({ exemplo: false, objeto: 'Papel [Exemplo]' }), false);
  const processos = [
    { id: 'x1', status: 'sessao', valor_estimado: 1000, exemplo: true },
    { id: 'x2', status: 'contratado', valor_estimado: 1000, objeto: '[Exemplo] Merenda', data_resultado: new Date(AGORA - DIA).toISOString() },
    { id: 'x3', status: 'perdido', motivo_perda: 'Preço acima do vencedor', objeto: '[EXEMPLO] Pneus', data_resultado: new Date(AGORA - DIA).toISOString() },
    { id: 'r1', status: 'sessao', valor_estimado: 100, objeto: 'Toner' },
  ];
  const p = r.calcularPrevisao({ processos, agora: AGORA });
  assert.equal(p.total, Math.round(10000 * r.CHANCE_PADRAO.sessao / 100));
  assert.equal(p.saldoContratos, 0);
  assert.deepEqual(p.ganhos, { quantidade: 0, valor: 0 });
  assert.equal(p.porEtapa[0].quantidade, 1);
  assert.equal(r.agruparMotivos({ processos, agora: AGORA }).total, 0);
});

test('ganha sem contrato usa o valor homologado antes da proposta e do estimado', () => {
  const g = { id: 'h', status: 'homologado', valor_homologado: '31200.50', preco_proposta: 33000, valor_estimado: 36000, data_resultado: new Date(AGORA - 5 * DIA).toISOString() };
  const p = r.calcularPrevisao({ processos: [g], agora: AGORA });
  assert.deepEqual(p.ganhos, { quantidade: 1, valor: 3120050 });
  assert.match(r.htmlPrevisao(p, { podeAjustar: false }), /Ganhos nos últimos 90 dias<\/dt><dd>R\$\s31\.200,50/);
  // Mesmo caminho do navegador: fasesExecucao sem contrato cai no homologado.
  const f = require('./contrato-publico.js').fasesExecucao({ homologado: g.valor_homologado });
  const comExec = r.calcularPrevisao({ processos: [g], execucao: { h: { potencial: Number(f.fases.potencial.valor), recebido: null } }, agora: AGORA });
  assert.equal(comExec.ganhos.valor, 3120050);
  assert.equal(r.calcularPrevisao({ processos: [{ ...g, valor_homologado: null, preco_proposta: null }], agora: AGORA }).ganhos.valor, 3600000);
});
