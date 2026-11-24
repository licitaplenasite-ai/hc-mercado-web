const test = require('node:test');
const assert = require('node:assert/strict');
const { coletarFicha, buscarNoPncp, handler } = require('../orgao-pncp');
const { _limparMemoria } = require('../_cache_publico');

const C = '22812960000199';
const json = (corpo, status = 200) => new Response(corpo == null ? null : JSON.stringify(corpo), { status });
// Respostas no formato real da API de consulta do PNCP (campos conferidos em 24/11/2026).
function pncpFalso({ falhar = [] } = {}) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const fonte = url.includes('/orgaos/') ? 'orgao' : url.includes('/proposta') ? 'abertas' : url.includes('/contratos') ? 'contratos' : 'atas';
    if (falhar.includes(fonte)) throw new Error('timeout');
    if (fonte === 'orgao') return json({ cnpj: C, razaoSocial: 'MUNICIPIO DE APUI', esferaId: 'M' });
    if (fonte === 'abertas') return json({ totalRegistros: 2, data: [
      { numeroControlePNCP: `${C}-1-000011/2026`, objetoCompra: 'Merenda escolar', dataPublicacaoPncp: '2026-11-10T09:00:00', dataEncerramentoProposta: '2026-12-01T09:00:00',
        modalidadeNome: 'Pregão - Eletrônico', valorTotalEstimado: 152000.5, unidadeOrgao: { ufSigla: 'AM', municipioNome: 'Apuí' } },
      { numeroControlePNCP: '99999999000191-1-000001/2026', objetoCompra: 'De outro órgão' }] });
    if (fonte === 'contratos') return json({ totalRegistros: 3, data: [
      { numeroControlePNCP: `${C}-2-000002/2026`, objetoContrato: 'Transporte escolar', dataAssinatura: '2026-09-01', tipoPessoa: 'PJ', nomeRazaoSocialFornecedor: 'Barcos Norte LTDA', valorGlobal: 9000 },
      { numeroControlePNCP: `${C}-2-000003/2026`, objetoContrato: 'Serviço de pessoa', dataAssinatura: '2026-08-01', tipoPessoa: 'PF', nomeRazaoSocialFornecedor: 'Fulano de Tal', valorInicial: 500 },
      { numeroControlePNCP: `${C}-2-000004/2026`, objetoContrato: 'Sem tipoPessoa', dataAssinatura: '2026-07-01', niFornecedor: '123.456.789-09', nomeRazaoSocialFornecedor: 'Beltrana', valorGlobal: 10 }] });
    return json(null, 204);
  };
  return { urls, fetchImpl };
}

test('coletarFicha: 4 fontes juntas, no formato da ficha, só deste órgão, sem nome de pessoa física', async () => {
  _limparMemoria();
  const { urls, fetchImpl } = pncpFalso();
  const r = await coletarFicha(C, { fetchImpl, agora: () => Date.parse('2026-11-24T15:00:00Z') });
  assert.equal(urls.length, 4);
  assert.ok(urls.some((u) => u.includes('/contratos?dataInicial=20251125&dataFinal=20261124&cnpjOrgao=' + C)), 'contratos dos últimos 12 meses');
  assert.ok(urls.some((u) => u.includes('/atas?dataInicial=20251125&dataFinal=20261124&cnpj=' + C)), 'atas dentro do limite de 365 dias');
  assert.deepEqual(r.orgao, { nome: 'MUNICIPIO DE APUI', esfera: 'M' });
  assert.deepEqual(r.abertas, [{ numero_controle_pncp: `${C}-1-000011/2026`, objeto: 'Merenda escolar', publicacao: '2026-11-10', encerramento: '2026-12-01',
    modalidade: 'Pregão - Eletrônico', valor: 152000.5, uf: 'AM', municipio: 'Apuí' }], 'registro de outro órgão fica fora');
  assert.deepEqual(r.contratos.map((c) => [c.fornecedor, c.valor]), [['Barcos Norte LTDA', 9000], ['Pessoa física', 500], ['Pessoa física', 10]], 'PF pelo tipo ou pelo CPF de 11 dígitos');
  assert.deepEqual(r.atas, [], '204 do PNCP = nenhuma ata');
  assert.deepEqual(r.totais, { abertas: 2, contratos: 3, atas: 0 });
  assert.deepEqual([r.origem, r.falharam], ['ao-vivo', []]);
  // Segunda vez: do cache, sem ir ao PNCP.
  const segunda = pncpFalso();
  const r2 = await coletarFicha(C, { fetchImpl: segunda.fetchImpl, agora: () => Date.parse('2026-11-24T15:10:00Z') });
  assert.equal(segunda.urls.length, 0);
  assert.equal(r2.origem, 'cache');
  assert.equal(r2.abertas.length, 1);
});

test('coletarFicha: fonte que não responde vira aviso; as outras seguem', async () => {
  _limparMemoria();
  const { fetchImpl } = pncpFalso({ falhar: ['contratos', 'orgao'] });
  const r = await coletarFicha(C, { fetchImpl });
  assert.deepEqual(r.falharam.sort(), ['contratos', 'orgao']);
  assert.equal(r.orgao, null);
  assert.equal(r.abertas.length, 1);
  assert.deepEqual(r.contratos, []);
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
