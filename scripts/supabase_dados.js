// Helper compartilhado pra falar com o Supabase a partir dos robôs Node
// (scripts/atualizar_dados.js e scripts/migrar_dados_supabase.js).
//
// Usa SUPABASE_SERVICE_ROLE_KEY (segredo, só existe no ambiente do GitHub
// Actions / execução local do robô — nunca no navegador) porque as tabelas
// "contratos" e "mercado_atas" têm RLS restringindo escrita, e a service_role
// key ignora RLS. Ver supabase/schema_dados_mercado.sql.

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";

function chaveServico() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não configurada. Defina essa variável de ambiente " +
      "(no GitHub Actions: Settings > Secrets and variables > Actions > New repository secret) " +
      "com a Service Role Key do projeto no Supabase (Project Settings > API)."
    );
  }
  return k;
}

async function restFetch(caminho, opcoes = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...opcoes,
    signal: opcoes.signal ? globalThis.AbortSignal.any([opcoes.signal, globalThis.AbortSignal.timeout(30000)]) : globalThis.AbortSignal.timeout(30000),
    headers: {
      apikey: chaveServico(),
      Authorization: `Bearer ${chaveServico()}`,
      "Content-Type": "application/json",
      ...(opcoes.headers || {}),
    },
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`Supabase REST ${caminho} -> HTTP ${resp.status}: ${texto.slice(0, 500)}`);
  }
  return resp;
}

// Upsert em lotes (o Postgrest aceita um array grande de uma vez, mas manter lotes
// menores evita estourar timeout/tamanho de requisição em tabelas grandes).
async function upsertEmLotes(tabela, linhas, chaveConflito, tamanhoLote = 500) {
  let enviadas = 0;
  for (let i = 0; i < linhas.length; i += tamanhoLote) {
    enviadas += await enviarLote(tabela, linhas.slice(i, i + tamanhoLote), chaveConflito);
  }
  return enviadas;
}

// 20-22/11: lotes de 500 em "contratos" (índice GIN trigram em objeto) e em
// "comprasgov_resultados" estouravam o statement timeout do banco (57014) e derrubavam o
// robô inteiro. Upsert é idempotente: em timeout, divide o lote ao meio e reenvia, até
// LOTE_MINIMO linhas — abaixo disso o problema não é tamanho de lote e o erro sobe.
const LOTE_MINIMO = 25;
function ehTimeout(e) {
  return (e && e.name === "TimeoutError") || /57014|statement timeout/.test(String(e && e.message));
}
async function enviarLote(tabela, lote, chaveConflito) {
  try {
    await restFetch(`${tabela}?on_conflict=${chaveConflito}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(lote),
    });
    return lote.length;
  } catch (e) {
    if (lote.length <= LOTE_MINIMO || !ehTimeout(e)) throw e;
    const meio = Math.ceil(lote.length / 2);
    console.warn(`[supabase] ${tabela}: timeout num lote de ${lote.length}; reenviando em 2 lotes de até ${meio}.`);
    return (await enviarLote(tabela, lote.slice(0, meio), chaveConflito)) + (await enviarLote(tabela, lote.slice(meio), chaveConflito));
  }
}

// Baixa todas as linhas de uma tabela em páginas (Postgrest limita a 1000 linhas
// por padrão). Usado pra reconstruir o array completo que o algoritmo incremental
// do robô espera (antes ele lia isso de um arquivo local comitado no git).
async function baixarTodasAsLinhas(tabela, selecao = "*", ordenarPor = null) {
  const linhas = [];
  const tamanhoPagina = 1000;
  let inicio = 0;
  for (;;) {
    let caminho = `${tabela}?select=${encodeURIComponent(selecao)}`;
    if (ordenarPor) caminho += `&order=${encodeURIComponent(ordenarPor)}`;
    const resp = await restFetch(caminho, {
      headers: { Range: `${inicio}-${inicio + tamanhoPagina - 1}` },
    });
    const pagina = await resp.json();
    linhas.push(...pagina);
    if (pagina.length < tamanhoPagina) break;
    inicio += tamanhoPagina;
  }
  return linhas;
}

// Remove da tabela tudo que ficou mais velho que a data de corte (mesma lógica
// de retenção de 730 dias que o robô já aplicava no JSON local).
async function removerMaisAntigosQue(tabela, colunaData, dataLimiteIso) {
  await restFetch(`${tabela}?${colunaData}=lt.${dataLimiteIso}`, { method: "DELETE" });
}


// Helpers genericos "chave -> blob json" pra arquivos pequenos que antes eram
// commitados direto no git (convenios.json, sistema_s_am.json, editais_vistos.json).
// Guarda tudo na tabela public.dados_robo (chave text primary key, dado jsonb).
// Isso evita que o robo precise commitar/dar push no repositorio a cada execucao —
// e cada commit desses disparava uma publicacao completa do site no Netlify.
async function buscarBlob(tabela, chave) {
  const resp = await restFetch(`${tabela}?chave=eq.${encodeURIComponent(chave)}&select=dado`);
  const linhas = await resp.json();
  return linhas.length > 0 ? linhas[0].dado : null;
}

async function salvarBlob(tabela, chave, dado) {
  await restFetch(`${tabela}?on_conflict=chave`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ chave, dado, atualizado_em: new Date().toISOString() }]),
  });
}

module.exports = { restFetch, upsertEmLotes, baixarTodasAsLinhas, removerMaisAntigosQue, chaveServico, buscarBlob, salvarBlob };
