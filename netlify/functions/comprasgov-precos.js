// Proxy (login aprovado) para a Pesquisa de Preços do Compras.gov.
//
// O Catálogo e a Pesquisa de Preços são fontes públicas, mas o navegador pode
// bloquear chamadas diretas por CORS/instabilidade de origem. Centralizar as
// três etapas aqui dá à tela o mesmo caminho resiliente já usado por Marcas.

const CATALOGO = "https://cnbs.estaleiro.serpro.gov.br/cnbs-api/material/v1";
const PESQUISA = "https://pesqpreco.estaleiro.serpro.gov.br/pesquisa-precos-backend-semlogin/api/itens-compra/buscar";
const { origemPermitida, exigirAprovadoComLimite } = require("./_auth");
const { comCache, cabecalhosDoCache } = require("./_cache_publico");
// A tela chama na mesma origem; CORS fica só no domínio canônico (teste de ataque 19/11, M5).
const CABECALHOS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": origemPermitida({}) };

function texto(valor, limite = 160) {
  return String(valor || "").trim().replace(/\s+/g, " ").slice(0, limite);
}

function numeroInteiro(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function resposta(statusCode, corpo, extras = {}) {
  return { statusCode, headers: { ...CABECALHOS, ...extras }, body: JSON.stringify(corpo) };
}

// Catálogo e preços públicos mudam no máximo 1 vez por dia: guardados por URL da fonte (cache compartilhado entre
// clientes, _cache_publico.js); com a fonte fora do ar, a tela recebe o último resultado e a data dele.
async function obterJsonGuardado(url, signal) {
  return comCache(`comprasgov-precos|${url}`, () => obterJson(url, signal), { frescoS: 6 * 3600 });
}

async function obterJson(url, signal) {
  const respostaFonte = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!respostaFonte.ok) throw new Error(`fonte-${respostaFonte.status}`);
  return respostaFonte.json();
}

exports.handler = async (event) => {
  const limite = await exigirAprovadoComLimite(event, "comprasgov-precos");
  if (!limite.ok) return resposta(limite.status, { ok: false, erro: limite.erro });
  const parametros = event.queryStringParameters || {};
  const acao = texto(parametros.acao, 24);
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 18000);

  try {
    if (acao === "categorias") {
      const termo = texto(parametros.termo, 100);
      if (termo.length < 2) return resposta(400, { ok: false, erro: "Informe ao menos 2 caracteres." });
      const r = await obterJsonGuardado(`${CATALOGO}/palavra?${new URLSearchParams({ palavra: termo })}`, controlador.signal);
      return resposta(200, { ok: true, itens: Array.isArray(r.valor) ? r.valor.slice(0, 120) : [] }, cabecalhosDoCache(r));
    }

    if (acao === "itens") {
      const codigoPdm = numeroInteiro(parametros.codigoPdm);
      if (!codigoPdm) return resposta(400, { ok: false, erro: "Categoria inválida." });
      const [itens, unidades] = await Promise.all([
        obterJsonGuardado(`${CATALOGO}/materialCaracteristcaValorporPDM?${new URLSearchParams({ codigo_pdm: String(codigoPdm) })}`, controlador.signal),
        obterJsonGuardado(`${CATALOGO}/unidadeFornecimentoPorCodigoPdm?${new URLSearchParams({ codigo_pdm: String(codigoPdm) })}`, controlador.signal).catch(() => ({ valor: [] })),
      ]);
      return resposta(200, { ok: true, itens: Array.isArray(itens.valor) ? itens.valor.slice(0, 500) : [], unidades: Array.isArray(unidades.valor) ? unidades.valor : [] }, cabecalhosDoCache(itens));
    }

    if (acao === "precos") {
      const codigoItemCatalogo = numeroInteiro(parametros.codigoItemCatalogo);
      const siglaUnidadeFornecimento = texto(parametros.siglaUnidadeFornecimento, 20).toUpperCase();
      if (!codigoItemCatalogo || !siglaUnidadeFornecimento) return resposta(400, { ok: false, erro: "Item ou unidade inválidos." });
      const consulta = new URLSearchParams({
        codigoItemCatalogo: String(codigoItemCatalogo),
        tipoItem: "M",
        siglaUnidadeFornecimento,
      });
      const capacidade = Number(parametros.capacidadeUnidadeFornecimento);
      if (Number.isFinite(capacidade) && capacidade > 0) consulta.set("capacidadeUnidadeFornecimento", String(capacidade));
      const siglaMedida = texto(parametros.siglaUnidadeMedida, 20).toUpperCase();
      if (siglaMedida) consulta.set("siglaUnidadeMedida", siglaMedida);
      const r = await obterJsonGuardado(`${PESQUISA}?${consulta}`, controlador.signal);
      return resposta(200, { ok: true, dados: r.valor }, cabecalhosDoCache(r));
    }

    return resposta(400, { ok: false, erro: "Ação inválida." });
  } catch (erro) {
    return resposta(502, { ok: false, erro: "A fonte pública de preços não respondeu agora. Tente novamente em instantes." });
  } finally {
    clearTimeout(timeout);
  }
};
