// Cadastro de órgãos do PNCP -> catálogo de órgãos (supabase/orgaos_catalogo.sql), 1 vez por semana.
// Por quê: a ficha do órgão (orgao.html) só achava órgão com licitação aberta ou contrato já coletado. O PNCP devolve o
// cadastro inteiro (~98 mil órgãos: CNPJ, razão social, esfera, poder) numa chamada só (~46 MB, ~30 s; medido em
// 24/11/2026: a API ignora a paginação e manda tudo). Com isso todo órgão do PNCP aparece na busca, mesmo sem compra recente.
// O resto do catálogo (UF, cidade, UASGs, contagens) é recalculado pelo pg_cron (atualizar_orgaos_catalogo).
// O cadastro não traz UF nem cidade: sem elas o órgão não aparece na lista por estado (supabase/orgaos_navegacao.sql).
// Por isso, depois do cadastro, o robô consulta as unidades de cada órgão sem UF no PNCP (1 chamada por CNPJ, ~0,5 s),
// por tempo limitado, e grava a UF e a cidade mais comuns entre as unidades. Continua de onde parou na rodada seguinte.
//   node scripts/atualizar_cadastro_orgaos.js
// Env obrigatória: SUPABASE_SERVICE_ROLE_KEY.
// Opcionais: CADASTRO_ORGAOS_INTERVALO_DIAS (7; rodada mais cedo que isso sai sem baixar), CADASTRO_ORGAOS_FORCAR (=1 baixa
//   mesmo assim), CADASTRO_ORGAOS_LOTE (2000, o máximo da carregar_cadastro_orgaos), CADASTRO_ORGAOS_PRAZO_S (180),
//   CADASTRO_ORGAOS_LOCAL_MINUTOS (15; 0 desliga a busca de UF/cidade), CADASTRO_ORGAOS_CONCORRENCIA (6 chamadas ao PNCP
//   ao mesmo tempo).
// Só grava o que mudou (a função compara antes). Estado em dados_robo/cadastro_orgaos_meta.
const { restFetch, buscarBlob, salvarBlob } = require("./supabase_dados");

const URL_CADASTRO = "https://pncp.gov.br/api/pncp/v1/orgaos?pagina=1";
const INTERVALO_DIAS = Number(process.env.CADASTRO_ORGAOS_INTERVALO_DIAS || 7);
const FORCAR = process.env.CADASTRO_ORGAOS_FORCAR === "1";
const LOTE = Math.min(Number(process.env.CADASTRO_ORGAOS_LOTE || 2000), 2000);
const PRAZO_MS = Number(process.env.CADASTRO_ORGAOS_PRAZO_S || 180) * 1000;
const LOCAL_MS = Number(process.env.CADASTRO_ORGAOS_LOCAL_MINUTOS ?? 15) * 60000;
const CONCORRENCIA = Math.max(Number(process.env.CADASTRO_ORGAOS_CONCORRENCIA || 6), 1);
const CHAVE_META = "cadastro_orgaos_meta";
// Mesmo User-Agent dos outros robôs do PNCP: sem ele alguns endpoints resetam a conexão.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Registro do PNCP -> linha da carregar_cadastro_orgaos. Sem CNPJ/nome fica fora; inativo (statusAtivo=false) vai
// marcado, para sair da busca mesmo que já estivesse no catálogo.
function paraLinha(o) {
  const cnpj = String(o?.cnpj || "");
  const nome = String(o?.razaoSocial || "").replace(/\s+/g, " ").trim();
  if (!/^\d{14}$/.test(cnpj) || nome.length < 2) return null;
  return { cnpj, nome: nome.slice(0, 300), esfera: /^[A-Z]$/.test(o.esferaId || "") ? o.esferaId : null, poder: /^[A-Z]$/.test(o.poderId || "") ? o.poderId : null, ativo: o.statusAtivo !== false, natureza: /^\d{4}$/.test(o.codigoNaturezaJuridica || "") ? o.codigoNaturezaJuridica : null };
}

// Unidades do órgão no PNCP -> UF e cidade mais comuns entre as ativas (órgão estadual com unidades no interior fica com a
// UF certa e a cidade da maioria, quase sempre a capital). Sem unidade válida: uf null.
function localDasUnidades(cnpj, unidades) {
  const contar = (lista) => { const m = new Map(); for (const v of lista) m.set(v, (m.get(v) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  const validas = (Array.isArray(unidades) ? unidades : []).filter((u) => u?.statusAtivo !== false && /^[A-Z]{2}$/.test(u?.municipio?.uf?.siglaUF || ""));
  const uf = contar(validas.map((u) => u.municipio.uf.siglaUF));
  const municipio = uf ? contar(validas.filter((u) => u.municipio.uf.siglaUF === uf).map((u) => String(u.municipio.nome || "").trim()).filter(Boolean)) : null;
  return { cnpj, uf, municipio: municipio ? municipio.slice(0, 120) : null };
}

// 404 = o PNCP diz que o órgão não tem unidade (marca como consultado); outra falha = tenta na próxima rodada.
async function localDoOrgao(cnpj, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/unidades`, { headers: { Accept: "application/json", "User-Agent": UA }, signal: globalThis.AbortSignal.timeout(20000) });
    if (r.status === 404) return { cnpj, uf: null, municipio: null };
    if (!r.ok) return null;
    return localDasUnidades(cnpj, await r.json());
  } catch {
    return null;
  }
}

// Fila do banco (orgaos_sem_local) em lotes de 300, várias chamadas ao PNCP ao mesmo tempo, até o prazo acabar.
async function completarLocal({ rest = restFetch, fetchImpl = fetch, prazoMs = LOCAL_MS, concorrencia = CONCORRENCIA } = {}) {
  const fim = Date.now() + prazoMs;
  const total = { consultados: 0, comUf: 0, falhas: 0 };
  while (Date.now() < fim) {
    const fila = await (await rest("rpc/orgaos_sem_local", { method: "POST", body: JSON.stringify({ p_limite: 300 }) })).json();
    if (!Array.isArray(fila) || !fila.length) break;
    const linhas = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(concorrencia, fila.length) }, async () => {
      while (i < fila.length && Date.now() < fim) {
        const l = await localDoOrgao(fila[i++], fetchImpl);
        if (l) linhas.push(l); else total.falhas++;
      }
    }));
    if (linhas.length) await rest("rpc/gravar_local_orgaos", { method: "POST", body: JSON.stringify({ p_locais: linhas }) });
    total.consultados += linhas.length;
    total.comUf += linhas.filter((l) => l.uf).length;
    // Lote inteiro falhou (PNCP fora do ar): para, em vez de bater de novo nos mesmos CNPJs até o prazo.
    if (!linhas.length) break;
  }
  return total;
}

async function baixarCadastro(fetchImpl = fetch) {
  const r = await fetchImpl(URL_CADASTRO, { headers: { Accept: "application/json", "User-Agent": UA }, signal: globalThis.AbortSignal.timeout(PRAZO_MS) });
  if (!r.ok) throw new Error(`PNCP cadastro de órgãos HTTP ${r.status}`);
  const lista = await r.json();
  if (!Array.isArray(lista)) throw new Error("PNCP cadastro de órgãos: resposta não é uma lista");
  return lista.map(paraLinha).filter(Boolean);
}

async function carregar(linhas, rest = restFetch) {
  let gravados = 0;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const resp = await rest("rpc/carregar_cadastro_orgaos", { method: "POST", body: JSON.stringify({ p_orgaos: linhas.slice(i, i + LOTE) }) });
    gravados += Number(await resp.json()) || 0;
  }
  return gravados;
}

// orgaos_navegacao.sql aplicado? Sem ele a carga ignora a natureza jurídica e não há fila de UF/cidade.
async function temNavegacao(rest = restFetch) {
  try { await rest("rpc/orgaos_sem_local", { method: "POST", body: JSON.stringify({ p_limite: 1 }) }); return true; } catch { return false; }
}

async function main() {
  const navegacao = await temNavegacao();
  if (!navegacao) console.log("supabase/orgaos_navegacao.sql ainda não aplicado: sem natureza jurídica e sem busca de UF/cidade.");
  await atualizarCadastro(navegacao);
  if (navegacao && LOCAL_MS > 0) {
    const inicio = Date.now();
    const r = await completarLocal();
    console.log(`Local dos órgãos: ${r.consultados} consultados no PNCP (${r.comUf} com UF), ${r.falhas} falhas, ${Math.round((Date.now() - inicio) / 1000)} s.`);
  }
}

async function atualizarCadastro(navegacao) {
  const meta = await buscarBlob("dados_robo", CHAVE_META).catch(() => null);
  const idadeDias = meta?.atualizadoEm ? (Date.now() - Date.parse(meta.atualizadoEm)) / 864e5 : Infinity;
  // Carga antiga sem natureza jurídica: recarrega uma vez assim que o SQL novo estiver aplicado.
  if (!FORCAR && idadeDias < INTERVALO_DIAS && (meta?.natureza || !navegacao)) {
    console.log(`Cadastro de órgãos carregado há ${idadeDias.toFixed(1)} dias (intervalo ${INTERVALO_DIAS}): nada a fazer.`);
    return;
  }
  const inicio = Date.now();
  const linhas = await baixarCadastro();
  // Resposta muito menor que a última: PNCP com problema. Não grava por cima (a carga só acrescenta/atualiza, mas
  // registrar a data faria a próxima semana pular).
  if (meta?.total && linhas.length < meta.total * 0.8) throw new Error(`PNCP devolveu ${linhas.length} órgãos (antes ${meta.total}): carga adiada`);
  const gravados = await carregar(linhas);
  await salvarBlob("dados_robo", CHAVE_META, { atualizadoEm: new Date().toISOString(), total: linhas.length, gravados, natureza: navegacao });
  console.log(`Cadastro de órgãos: ${linhas.length} do PNCP, ${gravados} novos ou mudados, ${Math.round((Date.now() - inicio) / 1000)} s.`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`Cadastro de órgãos: ${e.message}`); process.exitCode = 1; });
}

module.exports = { paraLinha, baixarCadastro, carregar, localDasUnidades, localDoOrgao, completarLocal };
