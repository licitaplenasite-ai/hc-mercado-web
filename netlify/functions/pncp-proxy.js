// Netlify Function: proxy genérico para os endpoints públicos de busca/consulta do PNCP
// (api/search, api/consulta/v1/contratos etc.) usados pelo painel na busca "ao vivo" de
// licitações e contratos. O PNCP não libera CORS pra chamada direta do navegador nesses
// endpoints (confirmado: toda chamada direta dá "Failed to fetch") — por isso o painel
// precisa passar por aqui, no mesmo espírito de pncp-arquivos.js e pncp-itens.js, só que
// genérico (repassa a URL completa do PNCP em vez de montar um endpoint fixo).
//
// Uso: GET /.netlify/functions/pncp-proxy?url=<URL completa e codificada do endpoint do PNCP>
// Por segurança (pra não virar um proxy aberto pra qualquer domínio), só aceita URLs https
// cujo host seja pncp.gov.br.
const { cabecalhosPadrao, exigirAprovadoComLimite } = require("./_auth");
const { comCache, cabecalhosDoCache } = require("./_cache_publico");
const HOST_PERMITIDO = "pncp.gov.br";

// O endpoint api/search/ do PNCP reseta a conexão na hora (sem timeout, sem erro HTTP) quando
// a requisição não tem um User-Agent de navegador — confirmado testando com e sem o header
// várias vezes seguidas. Sem isso, toda busca ao vivo do Boletim e do Encontrar Licitações
// falhava com "API do PNCP não respondeu", mesmo com o PNCP no ar.
const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Uma consulta ao PNCP: { status, texto }, ou lança { foraDoHost: true } se o redirect sair de pncp.gov.br.
async function consultarPncp(urlInicial) {
  const ctrl = new AbortController();
  // A busca do PNCP costuma responder pouco depois dos 14 s em horários de pico.
  // Encerrar antes disso fazia o Boletim cair no cache mesmo com a API ainda ativa.
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    // Redirect seguido à mão e só dentro de https://pncp.gov.br: com o redirect automático, um
    // Location do PNCP apontando para outro host levaria o proxy até lá (SSRF; teste de ataque 19/11, M5).
    let url = urlInicial, resp;
    for (let saltos = 0; ; saltos++) {
      resp = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT_NAVEGADOR },
        signal: ctrl.signal,
        redirect: "manual",
      });
      const local = resp.status >= 300 && resp.status < 400 && resp.headers.get("location");
      if (!local) break;
      const proximo = new URL(local, url);
      if (saltos >= 3 || proximo.protocol !== "https:" || proximo.hostname !== HOST_PERMITIDO) throw { foraDoHost: true };
      url = proximo.toString();
    }
    return { status: resp.status, texto: await resp.text() };
  } finally {
    clearTimeout(t);
  }
}

exports.handler = async (event) => {
  // Proxy do governo: CORS só do nosso domínio, login aprovado, teto por minuto da conta e teto diário por IP (abuso 20/11).
  const headers = cabecalhosPadrao(event);
  const limite = await exigirAprovadoComLimite(event, "pncp-proxy");
  if (!limite.ok) return { statusCode: limite.status, headers, body: JSON.stringify({ erro: limite.erro }) };
  const alvo = (event.queryStringParameters && event.queryStringParameters.url) || "";

  let destino;
  try {
    destino = new URL(alvo);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Parâmetro url ausente ou inválido." }) };
  }
  if (destino.protocol !== "https:" || destino.hostname !== HOST_PERMITIDO) {
    return { statusCode: 400, headers, body: JSON.stringify({ erro: "Só é permitido fazer proxy para pncp.gov.br." }) };
  }

  // Cache compartilhado por URL (só leitura pública do PNCP; _cache_publico.js): a mesma busca de outro cliente
  // em até 10 min volta na hora, e com o PNCP fora do ar (ou devolvendo 429) volta a última resposta com a data.
  // Só resposta 200 é guardada; erro do PNCP segue para a tela como antes.
  try {
    const r = await comCache(`pncp-proxy|${destino}`, async () => {
      const resposta = await consultarPncp(destino.toString());
      if (resposta.status !== 200) throw resposta;
      return resposta.texto || JSON.stringify({});
    }, { frescoS: 600, guardaS: 2 * 86400 });
    return { statusCode: 200, headers: { ...headers, ...cabecalhosDoCache(r) }, body: r.valor };
  } catch (e) {
    if (e && e.foraDoHost) return { statusCode: 502, headers, body: JSON.stringify({ erro: "O PNCP redirecionou para fora de pncp.gov.br." }) };
    if (e && Number.isInteger(e.status)) return { statusCode: e.status, headers, body: e.texto || JSON.stringify({}) };
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ erro: "Não foi possível falar com a API do PNCP agora: " + String((e && e.message) || e) }),
    };
  }
};
