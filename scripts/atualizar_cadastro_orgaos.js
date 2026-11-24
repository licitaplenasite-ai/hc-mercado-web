// Cadastro de órgãos do PNCP -> catálogo de órgãos (supabase/orgaos_catalogo.sql), 1 vez por semana.
// Por quê: a ficha do órgão (orgao.html) só achava órgão com licitação aberta ou contrato já coletado. O PNCP devolve o
// cadastro inteiro (~98 mil órgãos: CNPJ, razão social, esfera, poder) numa chamada só (~46 MB, ~30 s; medido em
// 24/11/2026: a API ignora a paginação e manda tudo). Com isso todo órgão do PNCP aparece na busca, mesmo sem compra recente.
// O resto do catálogo (UF, cidade, UASGs, contagens) é recalculado pelo pg_cron (atualizar_orgaos_catalogo).
//   node scripts/atualizar_cadastro_orgaos.js
// Env obrigatória: SUPABASE_SERVICE_ROLE_KEY.
// Opcionais: CADASTRO_ORGAOS_INTERVALO_DIAS (7; rodada mais cedo que isso sai sem baixar), CADASTRO_ORGAOS_FORCAR (=1 baixa
//   mesmo assim), CADASTRO_ORGAOS_LOTE (2000, o máximo da carregar_cadastro_orgaos), CADASTRO_ORGAOS_PRAZO_S (180).
// Só grava o que mudou (a função compara antes). Estado em dados_robo/cadastro_orgaos_meta.
const { restFetch, buscarBlob, salvarBlob } = require("./supabase_dados");

const URL_CADASTRO = "https://pncp.gov.br/api/pncp/v1/orgaos?pagina=1";
const INTERVALO_DIAS = Number(process.env.CADASTRO_ORGAOS_INTERVALO_DIAS || 7);
const FORCAR = process.env.CADASTRO_ORGAOS_FORCAR === "1";
const LOTE = Math.min(Number(process.env.CADASTRO_ORGAOS_LOTE || 2000), 2000);
const PRAZO_MS = Number(process.env.CADASTRO_ORGAOS_PRAZO_S || 180) * 1000;
const CHAVE_META = "cadastro_orgaos_meta";
// Mesmo User-Agent dos outros robôs do PNCP: sem ele alguns endpoints resetam a conexão.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Registro do PNCP -> linha da carregar_cadastro_orgaos. Sem CNPJ/nome fica fora; inativo (statusAtivo=false) vai
// marcado, para sair da busca mesmo que já estivesse no catálogo.
function paraLinha(o) {
  const cnpj = String(o?.cnpj || "");
  const nome = String(o?.razaoSocial || "").replace(/\s+/g, " ").trim();
  if (!/^\d{14}$/.test(cnpj) || nome.length < 2) return null;
  return { cnpj, nome: nome.slice(0, 300), esfera: /^[A-Z]$/.test(o.esferaId || "") ? o.esferaId : null, poder: /^[A-Z]$/.test(o.poderId || "") ? o.poderId : null, ativo: o.statusAtivo !== false };
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

async function main() {
  const meta = await buscarBlob("dados_robo", CHAVE_META).catch(() => null);
  const idadeDias = meta?.atualizadoEm ? (Date.now() - Date.parse(meta.atualizadoEm)) / 864e5 : Infinity;
  if (!FORCAR && idadeDias < INTERVALO_DIAS) {
    console.log(`Cadastro de órgãos carregado há ${idadeDias.toFixed(1)} dias (intervalo ${INTERVALO_DIAS}): nada a fazer.`);
    return;
  }
  const inicio = Date.now();
  const linhas = await baixarCadastro();
  // Resposta muito menor que a última: PNCP com problema. Não grava por cima (a carga só acrescenta/atualiza, mas
  // registrar a data faria a próxima semana pular).
  if (meta?.total && linhas.length < meta.total * 0.8) throw new Error(`PNCP devolveu ${linhas.length} órgãos (antes ${meta.total}): carga adiada`);
  const gravados = await carregar(linhas);
  await salvarBlob("dados_robo", CHAVE_META, { atualizadoEm: new Date().toISOString(), total: linhas.length, gravados });
  console.log(`Cadastro de órgãos: ${linhas.length} do PNCP, ${gravados} novos ou mudados, ${Math.round((Date.now() - inicio) / 1000)} s.`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`Cadastro de órgãos: ${e.message}`); process.exitCode = 1; });
}

module.exports = { paraLinha, baixarCadastro, carregar };
