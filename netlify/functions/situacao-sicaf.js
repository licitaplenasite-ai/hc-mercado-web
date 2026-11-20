// Situação do fornecedor no SICAF pelos dados abertos do Compras.gov.br (grátis, sem chave, sem captcha).
//   GET /api/situacao-sicaf?cnpj=00000000000000  (Authorization: Bearer <sessão>)
// Resposta: { cnpj, encontrado, ativo, habilitadoLicitar, razaoSocial, fonte, consultadoEm }.
// A API pública só traz cadastro ativo e "habilitado a licitar": NÃO traz validade das certidões (Receita, FGTS,
// CNDT), que só saem nos sites oficiais com captcha (pesquisa em _historico/certidoes-automaticas-20261120.md).
// Login aprovado + teto por minuto e por IP (exigirAprovadoComLimite), como os demais proxies do Compras.gov.
const { cabecalhosPadrao, exigirAprovadoComLimite } = require('./_auth');

const FONTE = 'https://dadosabertos.compras.gov.br/modulo-fornecedor/1_consultarFornecedor';

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), 'Cache-Control': 'no-store' };
  const resposta = (status, body) => ({ statusCode: status, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return resposta(204, {});
  if (event.httpMethod !== 'GET') return resposta(405, { erro: 'Método não permitido.' });
  const auth = await exigirAprovadoComLimite(event, 'situacao-sicaf');
  if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
  const cnpj = String(event.queryStringParameters?.cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) return resposta(400, { erro: 'Informe um CNPJ válido de 14 dígitos.' });
  const consultadoEm = new Date().toISOString();
  try {
    const r = await fetch(`${FONTE}?${new URLSearchParams({ pagina: '1', tamanhoPagina: '10', ativo: 'true', cnpj })}`, {
      headers: { Accept: 'application/json' }, signal: globalThis.AbortSignal.timeout(15000),
    });
    // A API responde 404 quando não há fornecedor ativo com esse CNPJ.
    if (r.status === 404) return resposta(200, { cnpj, encontrado: false, ativo: false, habilitadoLicitar: false, razaoSocial: null, fonte: FONTE, consultadoEm });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const corpo = await r.json();
    const item = Array.isArray(corpo?.resultado) ? corpo.resultado.find((f) => f?.cnpj === cnpj) : null;
    return resposta(200, {
      cnpj, encontrado: !!item, ativo: item?.ativo === true, habilitadoLicitar: item?.habilitadoLicitar === true,
      razaoSocial: item?.nomeRazaoSocialFornecedor || null, fonte: FONTE, consultadoEm,
    });
  } catch (e) {
    console.warn('situacao-sicaf:', e.message);
    return resposta(503, { erro: 'O Compras.gov.br não respondeu agora. Tente de novo em instantes.' });
  }
};
