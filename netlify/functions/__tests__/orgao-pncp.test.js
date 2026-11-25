const test = require('node:test');
const assert = require('node:assert/strict');
const { coletarFicha, buscarNoPncp, trimestresContratos, handler } = require('../orgao-pncp');

const C = '22812960000199';
const AGORA = Date.parse('2026-11-24T15:00:00Z');
const json = (corpo, status = 200) => new Response(corpo == null ? null : JSON.stringify(corpo), { status });
// Respostas no formato real da API de consulta do PNCP (campos conferidos em 24/11/2026).
function pncpFalso({ falhar = [], lentos = [] } = {}) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const fonte = url.includes('/orgaos/') ? 'orgao' : url.includes('/proposta') ? 'abertas' : url.includes('/contratos') ? 'contratos' : 'atas';
    const mes = /dataInicial=(\d{6})/.exec(url)?.[1];
    if (falhar.includes(fonte) || falhar.includes(mes)) throw new Error('timeout');
    if (lentos.includes(mes)) await new Promise((ok) => setTimeout(ok, 60));
    if (fonte === 'orgao') return json({ cnpj: C, razaoSocial: 'MUNICIPIO DE APUI', esferaId: 'M' });
    if (fonte === 'abertas') return json({ totalRegistros: 2, totalPaginas: 1, data: [
      { numeroControlePNCP: `${C}-1-000011/2026`, objetoCompra: 'Merenda escolar', dataPublicacaoPncp: '2026-11-10T09:00:00', dataEncerramentoProposta: '2026-12-01T09:00:00',
        modalidadeNome: 'Pregão - Eletrônico', valorTotalEstimado: 152000.5, unidadeOrgao: { ufSigla: 'AM', municipioNome: 'Apuí', codigoUnidade: '925001', nomeUnidade: 'SEMED' } },
      { numeroControlePNCP: '99999999000191-1-000001/2026', objetoCompra: 'De outro órgão' }] });
    if (fonte === 'contratos' && mes === '202610') return json({ totalRegistros: 3, data: [
      { numeroControlePNCP: `${C}-2-000002/2026`, objetoContrato: 'Transporte escolar', dataAssinatura: '2026-11-01', tipoPessoa: 'PJ', nomeRazaoSocialFornecedor: 'Barcos Norte LTDA', valorGlobal: 9000,
        unidadeOrgao: { codigoUnidade: '925001', nomeUnidade: 'SEMED' }, categoriaProcesso: { id: 8, nome: 'Serviços' } },
      { numeroControlePNCP: `${C}-2-000003/2026`, objetoContrato: 'Serviço de pessoa', dataAssinatura: '2026-11-02', tipoPessoa: 'PF', nomeRazaoSocialFornecedor: 'Fulano de Tal', valorInicial: 500 },
      { numeroControlePNCP: `${C}-2-000004/2026`, objetoContrato: 'MEI', dataAssinatura: '2026-11-03', niFornecedor: '12345678000190', nomeRazaoSocialFornecedor: 'BELTRANA SILVA 97048143215', valorGlobal: 10 },
      { numeroControlePNCP: '99999999000191-2-000001/2026', objetoContrato: 'De outro órgão' }] });
    return json(null, 204);
  };
  return { urls, fetchImpl };
}
const gravacoes = () => { const g = []; return { g, gravar: async (cnpj, lotes) => { g.push({ cnpj, lotes }); return true; } }; };

test('trimestresContratos: trimestres de calendário que cobrem os últimos 12 meses, o atual até hoje', () => {
  const t = trimestresContratos(AGORA);
  assert.deepEqual(t.map((x) => x.periodo), ['202610', '202607', '202604', '202601', '202510']);
  assert.deepEqual(t[0], { periodo: '202610', inicio: '20261001', fim: '20261124' });
  assert.deepEqual(t[4], { periodo: '202510', inicio: '20251001', fim: '20251231' }, 'o mais antigo vem inteiro');
  assert.deepEqual(trimestresContratos(Date.parse('2026-12-31T12:00:00Z')).map((x) => x.periodo), ['202610', '202607', '202604', '202601'], 'dezembro: 4 trimestres');
  assert.equal(trimestresContratos(Date.parse('2027-01-01T02:00:00Z'))[0].periodo, '202610', '23h de 31/12 em Brasília ainda é 2026');
});

test('coletarFicha: contratos por trimestre, só deste órgão, sem nome de pessoa física nem CPF de MEI, e grava no banco', async () => {
  const { urls, fetchImpl } = pncpFalso();
  const { g, gravar } = gravacoes();
  const r = await coletarFicha(C, { fetchImpl, agora: () => AGORA, gravar });
  assert.equal(urls.length, 8, 'cadastro + abertas + atas + 5 trimestres de contratos');
  assert.ok(urls.some((u) => u.includes('/contratos?dataInicial=20261001&dataFinal=20261124&cnpjOrgao=' + C + '&pagina=1&tamanhoPagina=500')));
  assert.ok(urls.some((u) => u.includes('/atas?dataInicial=20251125&dataFinal=20261124&cnpj=' + C)), 'atas dentro do limite de 365 dias');
  assert.deepEqual(r.orgao, { nome: 'MUNICIPIO DE APUI', esfera: 'M' });
  assert.deepEqual([r.falharam, r.pendentes, r.gravado], [[], 0, true]);
  assert.deepEqual(r.totais, { abertas: 2, atas: 0, contratos: 3 });
  assert.equal(g.length, 1, 'tudo chegou no prazo: uma gravação');
  const lotes = g[0].lotes, nov = lotes.find((l) => l.periodo === '202610');
  assert.equal(lotes.length, 8);
  assert.deepEqual(nov.itens.map((c) => [c.fornecedor, c.valor, c.uasg, c.categoria]),
    [['Barcos Norte LTDA', 9000, '925001', 'Serviços'], ['Pessoa física', 500, null, null], ['BELTRANA SILVA', 10, null, null]], 'registro de outro órgão fica fora');
  assert.ok(!JSON.stringify(lotes).includes('Fulano') && !JSON.stringify(lotes).includes('97048143215'), 'LGPD');
  assert.deepEqual(lotes.find((l) => l.fonte === 'abertas').itens.map((a) => [a.objeto, a.uasg, a.unidade]), [['Merenda escolar', '925001', 'SEMED']]);
  assert.deepEqual(lotes.find((l) => l.periodo === '202604'), { fonte: 'contratos', periodo: '202604', total: 0, itens: [] }, '204 = trimestre sem contrato, também guardado');
  // Com o cadastro e os trimestres fechados já guardados, só vão ao PNCP abertas, atas e o trimestre atual.
  const segunda = pncpFalso();
  await coletarFicha(C, { fetchImpl: segunda.fetchImpl, agora: () => AGORA, gravar, pular: ['orgao', '202607', '202604', '202601', '202510'] });
  assert.equal(segunda.urls.length, 3);
});

test('coletarFicha: trimestre lento chega depois da resposta e é gravado em segundo plano; o que falha vira aviso', async () => {
  const { fetchImpl } = pncpFalso({ lentos: ['202607'], falhar: ['202604', 'atas'] });
  const { g, gravar } = gravacoes();
  const esperas = [];
  const r = await coletarFicha(C, { fetchImpl, agora: () => AGORA, gravar, prazoRespostaMs: 20, waitUntil: (p) => esperas.push(p) });
  assert.deepEqual([r.pendentes, r.falharam.sort()], [1, ['atas', 'contratos']]);
  assert.equal(g[0].lotes.length, 5, 'gravou na hora o que chegou');
  assert.equal(esperas.length, 1, 'o resto fica vivo no waitUntil');
  await esperas[0];
  assert.deepEqual(g[1].lotes.map((l) => l.periodo), ['202607'], 'o trimestre lento é gravado quando chega');
});

test('coletarFicha: no máximo 6 chamadas juntas ao PNCP, e 429 tenta de novo', async () => {
  const { fetchImpl: base } = pncpFalso();
  let ativas = 0, pico = 0;
  const vezes = new Map();
  const fetchImpl = async (url) => {
    ativas += 1; pico = Math.max(pico, ativas);
    try {
      await new Promise((ok) => setTimeout(ok, 5));
      const n = (vezes.get(url) || 0) + 1; vezes.set(url, n);
      if (url.includes('dataInicial=20261001') && n === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '0.01' } });
      return base(url);
    } finally { ativas -= 1; }
  };
  const { g, gravar } = gravacoes();
  const r = await coletarFicha(C, { fetchImpl, agora: () => AGORA, gravar });
  assert.ok(pico <= 7, 'cadastro + 6 da fila: ' + pico);
  assert.deepEqual([r.falharam, r.totais.contratos], [[], 3], 'o trimestre com 429 entrou na segunda tentativa');
  assert.equal(g[0].lotes.length, 8);
});

test('buscarNoPncp: CNPJ válido, sem repetir, e corpo vazio do PNCP não quebra', async () => {
  const itens = { items: [{ cnpj: '04365326000173', nome: 'MUNICIPIO DE MANAUS', total: 90 }, { cnpj: '04365326000173', nome: 'MUNICIPIO DE MANAUS' },
    { cnpj: '123', nome: 'Inválido' }, { cnpj: '04461836000144', nome: '' }] };
  assert.deepEqual(await buscarNoPncp('manaus', async () => json(itens)), [{ cnpj: '04365326000173', nome: 'MUNICIPIO DE MANAUS', total: 90 }]);
  assert.deepEqual(await buscarNoPncp('manaus', async () => new Response('')), []);
  await assert.rejects(buscarNoPncp('manaus', async () => json({}, 503)), /PNCP HTTP 503/);
});

test('handler valida método e pedido antes do login e de qualquer chamada ao PNCP', async (t) => {
  t.mock.method(global, 'fetch', async () => { throw new Error('não deveria chamar'); });
  const ev = (body, m = 'POST') => ({ httpMethod: m, headers: {}, body: JSON.stringify(body) });
  assert.equal((await handler(ev({}, 'GET'))).statusCode, 405);
  assert.equal((await handler(ev({ acao: 'ficha', cnpj: '123' }))).statusCode, 400);
  assert.equal((await handler(ev({ acao: 'buscar', q: 'ab' }))).statusCode, 400);
  assert.equal((await handler(ev({ acao: 'apagar' }))).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'POST', headers: {}, body: 'x'.repeat(600) })).statusCode, 413);
  const semLogin = await handler(ev({ acao: 'ficha', cnpj: C }));
  assert.equal(semLogin.statusCode, 401);
  assert.notEqual(semLogin.headers['Access-Control-Allow-Origin'], '*', 'CORS só do site');
});
