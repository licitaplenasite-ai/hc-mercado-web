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
//   CADASTRO_ORGAOS_LOCAL_MINUTOS (15; 0 desliga a busca de UF/cidade), CADASTRO_ORGAOS_INTERVALO_MS (3000 = 20 chamadas
//   por minuto, o que o PNCP aceita sem 429; é um teto global, vale para todas as chamadas em paralelo),
//   CADASTRO_ORGAOS_CONCORRENCIA (2; com o ritmo acima, só esconde a latência), CADASTRO_ORGAOS_TENTATIVAS_429 (3 novas
//   tentativas por órgão, esperando o Retry-After com folga aleatória; depois disso a rodada para).
//   Órgão que falha (erro que não é 404) vai para o fim da fila; com 3 falhas seguidas, só volta depois de 7 dias.
// Só grava o que mudou (a função compara antes). Estado em dados_robo/cadastro_orgaos_meta.
const { restFetch, buscarBlob, salvarBlob } = require("./supabase_dados");

const URL_CADASTRO = "https://pncp.gov.br/api/pncp/v1/orgaos?pagina=1";
const INTERVALO_DIAS = Number(process.env.CADASTRO_ORGAOS_INTERVALO_DIAS || 7);
const FORCAR = process.env.CADASTRO_ORGAOS_FORCAR === "1";
const LOTE = Math.min(Number(process.env.CADASTRO_ORGAOS_LOTE || 2000), 2000);
const PRAZO_MS = Number(process.env.CADASTRO_ORGAOS_PRAZO_S || 180) * 1000;
const LOCAL_MS = Number(process.env.CADASTRO_ORGAOS_LOCAL_MINUTOS ?? 15) * 60000;
const CONCORRENCIA = Math.max(Number(process.env.CADASTRO_ORGAOS_CONCORRENCIA || 2), 1);
const LOCAL_INTERVALO_MS = Math.max(Number(process.env.CADASTRO_ORGAOS_INTERVALO_MS || 3000), 0);
const TENTATIVAS_429 = Math.max(Number(process.env.CADASTRO_ORGAOS_TENTATIVAS_429 || 3), 0);
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

const dormirPadrao = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Ritmo global: no máximo 1 chamada ao PNCP a cada `intervaloMs`, mesmo com várias em paralelo (cada uma reserva o próximo
// horário livre). frear(ms) empurra o próximo horário (Retry-After de um 429 vale para todas).
function criarRitmo(intervaloMs, { agora = Date.now, dormir = dormirPadrao } = {}) {
  let proximo = 0;
  return {
    async esperar() {
      const vez = Math.max(proximo, agora());
      proximo = vez + intervaloMs;
      if (vez > agora()) await dormir(vez - agora());
    },
    frear(ms) { proximo = Math.max(proximo, agora() + ms); },
  };
}

// Retry-After em segundos ou data HTTP; sem cabeçalho, backoff exponencial (5 s, 10 s, 20 s...). Jitter de até 20% para as
// chamadas em paralelo não voltarem todas juntas.
function esperaDo429(retryAfter, tentativa, aleatorio = Math.random) {
  const s = Number(retryAfter);
  const data = Date.parse(retryAfter || "");
  const base = retryAfter && Number.isFinite(s) ? s * 1000 : Number.isFinite(data) ? Math.max(data - Date.now(), 0) : 5000 * 2 ** tentativa;
  return Math.min(base, 300000) * (1 + 0.2 * aleatorio());
}

// 404 = o PNCP diz que o órgão não tem unidade (marca como consultado; volta à fila em 30 dias). Outro erro = falhou: o banco
// conta as falhas e manda o órgão para o fim da fila (ver orgaos_sem_local). 429 = espera o Retry-After e tenta de novo
// (até TENTATIVAS_429 vezes); se continuar, devolve limite e a rodada para.
async function localDoOrgao(cnpj, { fetchImpl = fetch, ritmo = criarRitmo(0), dormir = dormirPadrao, total = {} } = {}) {
  for (let tentativa = 0; ; tentativa++) {
    await ritmo.esperar();
    let r;
    try {
      r = await fetchImpl(`https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/unidades`, { headers: { Accept: "application/json", "User-Agent": UA }, signal: globalThis.AbortSignal.timeout(20000) });
    } catch {
      return { cnpj, falhou: true };
    }
    if (r.status === 429) {
      total.limite429 = (total.limite429 || 0) + 1;
      if (tentativa >= TENTATIVAS_429) return { cnpj, limite: true };
      const espera = esperaDo429(r.headers?.get?.("retry-after"), tentativa);
      ritmo.frear(espera);
      await dormir(espera);
      continue;
    }
    if (r.status === 404) return { cnpj, uf: null, municipio: null };
    if (!r.ok) return { cnpj, falhou: true };
    try { return localDasUnidades(cnpj, await r.json()); } catch { return { cnpj, falhou: true }; }
  }
}

// Fila do banco (orgaos_sem_local) em lotes, no ritmo de LOCAL_INTERVALO_MS, até o prazo acabar. Falhas também são gravadas
// (para o banco contar e empurrar o órgão para o fim da fila).
async function completarLocal({ rest = restFetch, fetchImpl = fetch, prazoMs = LOCAL_MS, concorrencia = CONCORRENCIA, intervaloMs = LOCAL_INTERVALO_MS, dormir = dormirPadrao } = {}) {
  const fim = Date.now() + prazoMs;
  const total = { consultados: 0, comUf: 0, falhas: 0, limite429: 0 };
  const ritmo = criarRitmo(intervaloMs, { dormir });
  let parar = false;
  while (Date.now() < fim && !parar) {
    const fila = await (await rest("rpc/orgaos_sem_local", { method: "POST", body: JSON.stringify({ p_limite: 100 }) })).json();
    if (!Array.isArray(fila) || !fila.length) break;
    const linhas = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(concorrencia, fila.length) }, async () => {
      while (i < fila.length && Date.now() < fim && !parar) {
        const l = await localDoOrgao(fila[i++], { fetchImpl, ritmo, dormir, total });
        if (l.limite) { parar = true; break; }
        linhas.push(l);
      }
    }));
    if (linhas.length) await rest("rpc/gravar_local_orgaos", { method: "POST", body: JSON.stringify({ p_locais: linhas }) });
    const falhas = linhas.filter((l) => l.falhou).length;
    total.falhas += falhas;
    total.consultados += linhas.length - falhas;
    total.comUf += linhas.filter((l) => l.uf).length;
    // Lote inteiro falhou (PNCP fora do ar): para, em vez de gastar o prazo batendo num serviço caído.
    if (linhas.length && falhas === linhas.length) break;
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
    console.log(`Local dos órgãos: ${r.consultados} consultados (${r.comUf} com UF), ${r.falhas} falhas, ${r.limite429} respostas 429, ${Math.round((Date.now() - inicio) / 1000)} s.`);
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

module.exports = { paraLinha, baixarCadastro, carregar, localDasUnidades, localDoOrgao, completarLocal, criarRitmo, esperaDo429 };
