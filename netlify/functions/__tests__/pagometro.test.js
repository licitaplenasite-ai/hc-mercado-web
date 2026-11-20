const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../_pagometro');
const { coletar, handler } = require('../pagometro');

// Linhas no formato do SICONFI (RREO Anexo 7), só a linha I e uma de poder para provar o filtro.
const linha = (cod, valor, conta = 'RESTOS A PAGAR (EXCETO INTRA-ORÇAMENTÁRIOS) (I)') => ({ cod_conta: cod, conta, valor, instituicao: 'Prefeitura QA', uf: 'ZZ' });
const anexo = ({ a = 0, b = 0, c = 0, d = 0, h = 0, i = 0 }) => [
  linha(P.CONTAS.a, a), linha(P.CONTAS.b, b), linha(P.CONTAS.c, c), linha(P.CONTAS.d, d), linha(P.CONTAS.h, h), linha(P.CONTAS.i, i),
  linha(P.CONTAS.c, 1, 'PODER EXECUTIVO'),
];
const calc = (v) => P.calcular(anexo(v), { idEnte: '9999901', ano: 2025, fonte: 'x' });

test('esfera pelo tamanho do código IBGE', () => {
  assert.equal(P.esferaDoEnte('1302603'), 'M');
  assert.equal(P.esferaDoEnte('35'), 'E');
  assert.equal(P.esferaDoEnte('123'), null);
  assert.equal(P.esferaDoEnte('13026O3'), null);
  assert.match(P.urlRreo('35', 2025), /co_esfera=E&id_ente=35$/);
  assert.match(P.urlRreo('1302603', 2025), /an_exercicio=2025&nr_periodo=6.*no_anexo=RREO-Anexo\+07&co_esfera=M/);
});

test('conta de Manaus 2025 (valores reais do SICONFI): verde', () => {
  const r = calc({ a: 4098749.43, b: 63860647.8, c: 61093367.97, d: 2205105.52, h: 100022365.25, i: 99676427.69 });
  assert.equal(r.semaforo, 'verde');
  assert.equal(r.indicadores.devido, 167981762.48);
  assert.ok(Math.abs(r.indicadores.taxaPago - 0.957) < 0.001);
  assert.equal(r.nome, 'Prefeitura QA'); assert.equal(r.uf, 'ZZ'); assert.equal(r.esfera, 'M');
});

test('semáforo: limites e cada motivo de vermelho', () => {
  assert.equal(calc({ b: 100, c: 90 }).semaforo, 'verde'); // 90% pago, borda
  assert.equal(calc({ b: 100, c: 89 }).semaforo, 'amarelo');
  assert.equal(calc({ b: 100, c: 69 }).semaforo, 'vermelho'); // pagou pouco
  assert.equal(calc({ b: 100, c: 95, d: 16 }).semaforo, 'vermelho'); // cancelou conta já entregue
  assert.equal(calc({ b: 100, c: 95, d: 6 }).semaforo, 'amarelo');
  assert.equal(calc({ a: 51, b: 49, c: 95 }).semaforo, 'vermelho'); // arrasta dívida velha
  assert.equal(calc({ a: 21, b: 79, c: 95 }).semaforo, 'amarelo');
  assert.equal(calc({}).semaforo, 'verde'); // nada ficou para o ano seguinte
});

test('sem a linha I (ente não publicou) devolve null', () => {
  assert.equal(P.calcular([], { idEnte: '35', ano: 2025 }), null);
  assert.equal(P.calcular([linha(P.CONTAS.c, 5, 'PODER EXECUTIVO')], { idEnte: '35', ano: 2025 }), null);
  assert.equal(P.calcular(undefined, { idEnte: '35', ano: 2025 }), null);
});

test('coletar: ano anterior vazio cai para dois anos antes; erro HTTP sobe', async () => {
  const urls = [];
  const agora = Date.parse('2026-01-15T12:00:00Z');
  const r = await coletar('35', { agora, fetchImpl: async (u) => { urls.push(u); return new Response(JSON.stringify({ items: u.includes('an_exercicio=2025') ? [] : anexo({ b: 10, c: 10 }) })); } });
  assert.equal(r.exercicio, 2024);
  assert.equal(urls.length, 2);
  assert.equal(await coletar('35', { agora, fetchImpl: async () => new Response('{"items":[]}') }), null);
  await assert.rejects(coletar('35', { agora, fetchImpl: async () => new Response('', { status: 503 }) }), /SICONFI HTTP 503/);
});

test('handler valida método e ente antes de qualquer chamada; exige sessão', async (t) => {
  t.mock.method(global, 'fetch', async () => { throw new Error('não deveria chamar'); });
  const ev = (q, m = 'GET') => ({ httpMethod: m, headers: {}, queryStringParameters: q });
  assert.equal((await handler(ev({ ente: '123' }))).statusCode, 400);
  assert.equal((await handler(ev({ ente: "35'or" }))).statusCode, 400);
  assert.equal((await handler(ev({ ente: '35' }, 'POST'))).statusCode, 405);
  assert.equal((await handler(ev({ ente: '35' }))).statusCode, 401);
});

// ---- Prazo médio de pagamento ----
const { prazo } = require('../pagometro');
const { mesesAte, diaUtil15 } = require('../../../scripts/coletar_pagometro_prazos');
const AGORA = Date.parse('2026-11-20T12:00:00Z');
const pagamentos = (n, chave, liq, pag) => Array.from({ length: n }, (_, k) => [
  { chave: `${chave}${k}`, tipo: 'liquidacao', data: liq }, { chave: `${chave}${k}`, tipo: 'pagamento', data: pag }]).flat();

test('fonte do prazo: federal por UG, municípios de SP pelo TCE-SP (menos a capital), resto sem fonte', () => {
  assert.equal(P.fontePrazo('F:160001'), 'transparencia');
  assert.equal(P.fontePrazo('M:3509502'), 'tce-sp');
  assert.equal(P.fontePrazo('M:3550308'), null);
  assert.equal(P.fontePrazo('M:1302603'), null);
  assert.equal(P.fontePrazo('F:16000'), null);
  assert.equal(P.fontePrazo(undefined), null);
});

test('prazos: casa com a liquidação mais recente até o pagamento e separa 24 e 36 meses', () => {
  const ev = [
    ...pagamentos(10, 'novo', '2026-01-10', '2026-02-09'), // 30 dias, dentro de 24m
    ...pagamentos(10, 'velho', '2024-01-01', '2024-01-11'), // 10 dias, só em 36m
    { chave: 'parcela', tipo: 'liquidacao', data: '2026-03-01' }, { chave: 'parcela', tipo: 'liquidacao', data: '2026-05-01' },
    { chave: 'parcela', tipo: 'pagamento', data: '2026-05-05' }, // casa com 01/05 -> 4 dias
    { chave: 'sem-liq', tipo: 'pagamento', data: '2026-05-05' }, // sem liquidação: fora
    { chave: 'futura', tipo: 'liquidacao', data: '2026-06-02' }, { chave: 'futura', tipo: 'pagamento', data: '2026-06-01' }, // liquidação depois: fora
    ...pagamentos(1, 'antigo', '2023-01-01', '2023-02-01'), // fora dos 36 meses
  ];
  const r = P.prazosDePagamento(ev, AGORA);
  assert.deepEqual(r, { dias_24m: Math.round((300 + 4) / 11), amostra_24m: 11, dias_36m: Math.round((300 + 4 + 100) / 21), amostra_36m: 21 });
});

test('prazos: menos de 10 pagamentos não vira média', () => {
  const r = P.prazosDePagamento(pagamentos(9, 'x', '2026-01-01', '2026-01-31'), AGORA);
  assert.equal(r.dias_24m, null); assert.equal(r.amostra_24m, 9); assert.equal(r.dias_36m, null);
  assert.equal(P.prazosDePagamento([], AGORA).amostra_36m, 0);
});

test('eventos do TCE-SP: só CNPJ, liquidação e pagamento, chave órgão + empenho', () => {
  const linhas = [
    { orgao: 'PREF', evento: 'Valor Liquidado', nr_empenho: '1-2025', id_fornecedor: 'CNPJ - PESSOA JURÍDICA - 04002395000112', dt_emissao_despesa: '12/03/2025' },
    { orgao: 'PREF', evento: 'Valor Pago', nr_empenho: '1-2025', id_fornecedor: 'CNPJ - PESSOA JURÍDICA - 04002395000112', dt_emissao_despesa: '17/03/2025' },
    { orgao: 'PREF', evento: 'Empenhado', nr_empenho: '1-2025', id_fornecedor: 'CNPJ - PESSOA JURÍDICA - 04002395000112', dt_emissao_despesa: '06/03/2025' },
    { orgao: 'PREF', evento: 'Valor Pago', nr_empenho: '2-2025', id_fornecedor: 'PESSOA FÍSICA - 037328', dt_emissao_despesa: '17/03/2025' },
  ];
  assert.deepEqual(P.eventosTceSp(linhas), [
    { chave: 'PREF|1-2025', tipo: 'liquidacao', data: '2025-03-12' }, { chave: 'PREF|1-2025', tipo: 'pagamento', data: '2025-03-17' }]);
  assert.deepEqual(P.eventosTceSp(null), []);
});

test('eventos federais: pagamento + liquidações relacionadas; datas BR ou ISO', () => {
  const ev = P.eventosFederal({ documento: '170001000012025OB000123', data: '20/05/2025' },
    [{ fase: 'Empenho', data: '01/02/2025' }, { fase: 'Liquidação', data: '2025-04-30' }, { fase: 'Liquidação', data: 'xx' }]);
  assert.deepEqual(ev.map((e) => `${e.tipo}@${e.data}`), ['pagamento@2025-05-20', 'liquidacao@2025-04-30', 'liquidacao@null']);
  assert.equal(P.dataIso('2025-04-30T00:00:00'), '2025-04-30');
  assert.equal(P.dataIso('ontem'), null);
  assert.equal(P.slugTceSp("Santa Bárbara d'Oeste"), 'santa-barbara-d-oeste');
});

test('robô: meses fechados e dia útil 15', () => {
  assert.deepEqual(mesesAte(AGORA, 3), [{ ano: 2026, mes: 8 }, { ano: 2026, mes: 9 }, { ano: 2026, mes: 10 }]);
  assert.equal(mesesAte(Date.parse('2026-01-05T12:00:00Z'), 1)[0].mes, 12);
  assert.equal(diaUtil15(2026, 11), '16/11/2026'); // 15/11/2026 é domingo
  assert.equal(diaUtil15(2025, 3), '17/03/2025'); // sábado
  assert.equal(diaUtil15(2026, 10), '15/10/2026');
});

test('handler do prazo: chave inválida 400; ente sem fonte responde sem dado sem chamar nada', async (t) => {
  t.mock.method(global, 'fetch', async () => { throw new Error('não deveria chamar'); });
  const resp = (s, b) => ({ statusCode: s, body: b });
  assert.equal((await prazo({ headers: {} }, 'E:35', resp)).statusCode, 400);
  const semFonte = await prazo({ headers: {} }, 'M:1302603', resp);
  assert.equal(semFonte.statusCode, 200); assert.equal(semFonte.body.situacao, 'sem_fonte');
  assert.equal((await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { prazo: 'M:3509502' } })).statusCode, 401);
});
