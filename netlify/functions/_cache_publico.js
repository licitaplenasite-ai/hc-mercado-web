// Cache compartilhado das consultas a portais públicos (PNCP, Compras.gov, Portal da Transparência).
//
// Por quê: cada busca ia ao portal ao vivo, e o mesmo termo pesquisado por clientes diferentes era
// consultado de novo. Medido em 23/11/2026: a Pesquisa de Preços do Compras.gov leva 7-9 s na 1ª
// consulta de um produto e 0,1-0,6 s quando o portal já a tem; o PNCP devolve 429 quando repetimos
// muito. Aqui a resposta fica guardada por chave (só dado público; nunca nada do usuário) e:
//   - nova (até `frescoS`): responde na hora, sem ir ao portal;
//   - velha (até `guardaS`): tenta o portal com prazo curto (`prazoMs`); se o portal falhar ou demorar,
//     responde o que estava guardado, marcado como "guardado" com a data (a tela avisa "portal fora do ar");
//   - sem nada guardado: vai ao portal sem prazo extra (o timeout de cada função continua valendo).
// Dois níveis: memória do processo (some quando o isolate reinicia) e o Cache API do Cloudflare
// (caches.default, compartilhado entre clientes no mesmo data center, grátis, sem tabela nova).
// Fora do Cloudflare (Netlify, testes) só a memória vale. Quem chama faz login e cota ANTES de chamar.

const MAX_MEMORIA = 300;
const memoria = new Map();
// Host do próprio site: o Cache API do Cloudflare só guarda chaves da zona do site.
const BASE_CHAVE = "https://licitaplena.com.br/__cache-consultas/";

function lerMemoria(chave) {
  const item = memoria.get(chave);
  if (!item) return null;
  memoria.delete(chave); // reinserir mantém os mais usados no fim (descarte pelo mais antigo)
  memoria.set(chave, item);
  return item;
}
function gravarMemoria(chave, item) {
  memoria.delete(chave);
  memoria.set(chave, item);
  if (memoria.size > MAX_MEMORIA) memoria.delete(memoria.keys().next().value);
}

const cacheCloudflare = () => globalThis.caches?.default || null;
const requisicaoDaChave = (chave) => new Request(BASE_CHAVE + encodeURIComponent(chave));

async function lerCloudflare(chave) {
  const cache = cacheCloudflare();
  if (!cache) return null;
  try {
    const r = await cache.match(requisicaoDaChave(chave));
    return r ? await r.json() : null;
  } catch {
    return null;
  }
}
async function gravarCloudflare(chave, item, guardaS) {
  const cache = cacheCloudflare();
  if (!cache) return;
  try {
    await cache.put(requisicaoDaChave(chave), new Response(JSON.stringify(item), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${guardaS}` },
    }));
  } catch { /* cache é atalho: falha ao gravar não derruba a consulta */ }
}

// Corre `buscar` até `prazoMs`; estourou, rejeita (a consulta continua e ainda grava o cache se terminar).
function comPrazo(promessa, prazoMs) {
  if (!prazoMs) return promessa;
  let relogio;
  const limite = new Promise((_, rejeitar) => { relogio = setTimeout(() => rejeitar(new Error("prazo")), prazoMs); });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(relogio));
}

// buscar() -> valor serializável em JSON, ou lança. Valor `null`/`undefined` não é guardado (resposta ruim do portal).
// Devolve { valor, origem: "ao-vivo" | "cache" | "guardado", guardadoEm (ISO) }.
async function comCache(chave, buscar, { frescoS = 600, guardaS = 7 * 86400, prazoMs = 4000, agora = Date.now } = {}) {
  let item = lerMemoria(chave);
  if (!item) {
    item = await lerCloudflare(chave);
    if (item) gravarMemoria(chave, item);
  }
  const idadeMs = item ? agora() - item.em : Infinity;
  if (item && idadeMs <= frescoS * 1000) return { valor: item.valor, origem: "cache", guardadoEm: new Date(item.em).toISOString() };
  const guardadoValido = item && idadeMs <= guardaS * 1000 ? item : null;

  const aoVivo = Promise.resolve().then(buscar).then(async (valor) => {
    if (valor === null || valor === undefined) return valor;
    const novo = { em: agora(), valor };
    gravarMemoria(chave, novo);
    await gravarCloudflare(chave, novo, guardaS);
    return valor;
  });
  if (!guardadoValido) return { valor: await aoVivo, origem: "ao-vivo", guardadoEm: new Date(agora()).toISOString() };
  aoVivo.catch(() => {}); // segue em segundo plano; o erro já foi tratado devolvendo o guardado
  try {
    const valor = await comPrazo(aoVivo, prazoMs);
    if (valor !== null && valor !== undefined) return { valor, origem: "ao-vivo", guardadoEm: new Date(agora()).toISOString() };
  } catch { /* portal fora do ar ou lento: usa o guardado */ }
  return { valor: guardadoValido.valor, origem: "guardado", guardadoEm: new Date(guardadoValido.em).toISOString() };
}

// Cabeçalhos que a tela lê para avisar "portal fora do ar, mostrando dados guardados de DD/MM".
function cabecalhosDoCache(resultado) {
  return { "X-Dados-Origem": resultado.origem, "X-Dados-Guardados-Em": resultado.guardadoEm };
}

module.exports = { comCache, cabecalhosDoCache, _limparMemoria: () => memoria.clear() };
