// Netlify Function: lista os documentos anexados a uma contratação no PNCP (edital, projeto
// básico, avisos, esclarecimentos, impugnações, recursos etc.) — proxy simples pra fugir de
// CORS, já que o navegador não consegue chamar pncp.gov.br diretamente do nosso domínio.
// API pública, sem necessidade de token.
//
// Também devolve a situação atual da licitação (Divulgada no PNCP, Revogada, Anulada,
// Suspensa etc.) — é assim que a gente consegue avisar o cliente quando uma licitação que
// ele está acompanhando muda de status, sem precisar de "monitoramento de chat" em tempo
// real (que dependeria de integrar com cada portal de disputa individualmente, sem API
// pública — Comprasnet, BLL, Licitanet etc. cada um com seu próprio sistema fechado).
//
// Uso: GET /.netlify/functions/pncp-arquivos?cnpj=...&ano=...&sequencial=...
const { cabecalhosPadrao, exigirAprovadoComLimite } = require("./_auth");
const { comCache, cabecalhosDoCache } = require("./_cache_publico");
const BASE_URL = "https://pncp.gov.br/api/pncp/v1/orgaos";
const BASE_URL_COMPRA = "https://pncp.gov.br/api/consulta/v1/orgaos";

// Ver nota em pncp-proxy.js: alguns endpoints do PNCP resetam a conexão sem User-Agent de
// navegador. Manda em todo fetch pro PNCP por segurança.
const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

exports.handler = async (event) => {
  // Proxy do governo: CORS só do nosso domínio, login aprovado, teto por minuto da conta e teto diário por IP (abuso 20/11).
  const headers = cabecalhosPadrao(event);
  const limite = await exigirAprovadoComLimite(event, "pncp-arquivos");
  if (!limite.ok) return { statusCode: limite.status, headers, body: JSON.stringify({ erro: limite.erro }) };
  const q = event.queryStringParameters || {};
  const cnpj = (q.cnpj || "").replace(/\D/g, "");
  const ano = parseInt(q.ano, 10);
  const sequencial = parseInt(q.sequencial, 10);
  if (cnpj.length !== 14 || !ano || !sequencial) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Informe cnpj, ano e sequencial válidos.", arquivos: [], situacaoCompraNome: null, situacaoCompraId: null }) };
  }

  // Lista de documentos e situação saem juntas (antes, uma depois da outra) e ficam guardadas 10 min entre clientes;
  // com o PNCP fora do ar volta a última resposta (_cache_publico.js). Resposta sem nada (as 2 falharam) não é guardada.
  try {
    const r = await comCache(`pncp-arquivos|${cnpj}|${ano}|${sequencial}`, async () => {
      const [arquivos, situacao] = await Promise.all([lerArquivos(cnpj, ano, sequencial), lerSituacao(cnpj, ano, sequencial)]);
      return { arquivos, ...situacao };
    }, { frescoS: 600, guardar: (v) => v.arquivos.length > 0 || v.situacaoCompraNome !== null });
    return { statusCode: 200, headers: { ...headers, ...cabecalhosDoCache(r) }, body: JSON.stringify({ erro: null, ...r.valor }) };
  } catch {
    return { statusCode: 200, headers, body: JSON.stringify({ erro: null, arquivos: [], situacaoCompraNome: null, situacaoCompraId: null }) };
  }
};

async function lerArquivos(cnpj, ano, sequencial) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(`${BASE_URL}/${cnpj}/compras/${ano}/${sequencial}/arquivos`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT_NAVEGADOR },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return [];
    const dados = await resp.json();
    return (Array.isArray(dados) ? dados : []).map((a) => ({
      sequencialDocumento: a.sequencialDocumento,
      titulo: a.titulo || "",
      tipoDocumentoNome: a.tipoDocumentoNome || a.tipoDocumentoDescricao || "",
      dataPublicacaoPncp: a.dataPublicacaoPncp || null,
    }));
  } catch (e) {
    return []; // segue mesmo sem lista de arquivos — não impede de mostrar a situação da compra
  }
}

// Situação atual da compra (não crítico: se falhar, só não mostra o aviso de status, mas a lista de arquivos continua).
async function lerSituacao(cnpj, ano, sequencial) {
  try {
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 10000);
    const respCompra = await fetch(`${BASE_URL_COMPRA}/${cnpj}/compras/${ano}/${sequencial}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT_NAVEGADOR },
      signal: ctrl2.signal,
    });
    clearTimeout(t2);
    if (!respCompra.ok) return { situacaoCompraNome: null, situacaoCompraId: null };
    const dadosCompra = await respCompra.json();
    return { situacaoCompraNome: dadosCompra.situacaoCompraNome || null, situacaoCompraId: dadosCompra.situacaoCompraId ?? null };
  } catch (e) {
    return { situacaoCompraNome: null, situacaoCompraId: null }; // não crítico
  }
}
