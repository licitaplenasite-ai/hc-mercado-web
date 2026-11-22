// Peças comuns dos robôs das bases oficiais de preço de obra (supabase/bases_preco.sql):
// histórico por data-base, retenção, robots.txt, referência zerada e o "alarme" no padrão dos outros robôs
// (estado em dados_robo com saudeFonte/ultimoErro/ultimoSucessoEm + saída com erro, que o GitHub Actions avisa por e-mail).
//   const bp = require("./bases_preco");
//
// Variáveis:
//   BASES_RETENCAO_MESES   24 — meses de data-base guardados por base (o resto é apagado; no plano Free use 12)
const { restFetch, buscarBlob, salvarBlob } = require("./supabase_dados");

const UA = "LicitaPlena-robo-bases/1.0 (+coleta mensal de tabelas oficiais de preço de obra)";
const CHAVE_SAUDE = "bases_preco_saude";
const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);

// "tipo|codigo" ou "codigo" -> balde (2 primeiros caracteres do código). Igual a bases_preco_buscar no SQL.
const baldeDe = (chave) => String(chave).replace(/^.*\|/, "").slice(0, 2);

// { chave: valor } -> [{ parte: "grupo:balde", conteudo }], para gravar fatiado.
function fatiar(grupo, mapa) {
  const baldes = new Map();
  for (const [k, v] of Object.entries(mapa)) {
    const b = baldeDe(k);
    if (!/^[0-9A-Za-z_]{1,10}$/.test(b)) continue; // código estranho não vira parte inválida no banco
    if (!baldes.has(b)) baldes.set(b, {});
    baldes.get(b)[k] = v;
  }
  return [...baldes].map(([b, conteudo]) => ({ parte: `${grupo}:${b}`, conteudo }));
}

// Mês "AAAA-MM" de corte: data-base anterior a ele sai do banco.
function mesDeCorte(agora, meses) {
  const d = new Date(agora);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (meses - 1), 1)).toISOString().slice(0, 7);
}

// Arquivo "publicado sem preço" (SINAPI out/2025 saiu assim e foi retificado em 22/12/2025): fração de linhas
// sem nenhum preço acima do limiar. linhas: [{ precos: { UF: valor|null } }].
function referenciaZerada(linhas, limiar = 0.5) {
  if (!linhas.length) return true;
  const vazias = linhas.filter((l) => !Object.values(l.precos || {}).some((p) => Number(p) > 0)).length;
  return vazias / linhas.length > limiar;
}

// robots.txt: regras do grupo "User-agent: *" (o robô não tem nome próprio cadastrado). Disallow por prefixo;
// Allow mais longo vence (como o Google). Sem robots.txt (404) = tudo permitido.
function permitidoPeloRobots(textoRobots, url) {
  const caminho = (() => { try { const u = new URL(url); return u.pathname + u.search; } catch { return "/"; } })();
  const regras = [];
  let doGrupo = false, viuRegra = false;
  for (const bruta of String(textoRobots || "").split(/\r?\n/)) {
    const linha = bruta.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(linha);
    if (!m) continue;
    const campo = m[1].toLowerCase(), valor = m[2].trim();
    if (campo === "user-agent") {
      if (viuRegra) { doGrupo = false; viuRegra = false; }
      if (valor === "*") doGrupo = true;
    } else if (campo === "allow" || campo === "disallow") {
      viuRegra = true;
      if (doGrupo && valor) regras.push({ permite: campo === "allow", prefixo: valor });
    }
  }
  const casa = (p) => {
    const fim = p.endsWith("$");
    const corpo = (fim ? p.slice(0, -1) : p).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp("^" + corpo + (fim ? "$" : "")).test(caminho);
  };
  const vencedora = regras.filter((r) => casa(r.prefixo)).sort((a, b) => b.prefixo.length - a.prefixo.length || (a.permite ? -1 : 1))[0];
  return !vencedora || vencedora.permite;
}

const robotsCache = new Map();
async function conferirRobots(url) {
  const origem = new URL(url).origin;
  if (!robotsCache.has(origem)) {
    let texto = "";
    try {
      const r = await fetch(`${origem}/robots.txt`, { headers: { "user-agent": UA }, signal: globalThis.AbortSignal.timeout(20000) });
      texto = r.ok ? await r.text() : "";
    } catch { texto = ""; } // sem resposta = sem regra publicada
    robotsCache.set(origem, texto);
  }
  if (!permitidoPeloRobots(robotsCache.get(origem), url)) throw Object.assign(new Error(`robots.txt de ${origem} não permite ${url}`), { robots: true });
}

// GET educado: confere robots.txt, identifica o robô, tempo limite.
async function buscarTexto(url, timeoutMs = 60000) {
  await conferirRobots(url);
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: globalThis.AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} em ${url}`), { status: r.status });
  return r.text();
}

// ---------- banco ----------
// Grava (ou regrava, em retificação) uma versão e o conteúdo. A versão fica "catalogo" enquanto as partes sobem:
// falha no meio nunca deixa a tela usar uma versão pela metade.
async function gravarVersao(versao, partes, { tamanhoLote = 20 } = {}) {
  const linha = { ...versao, situacao: partes.length ? "catalogo" : versao.situacao, coletado_em: new Date().toISOString() };
  const r = await restFetch("bases_preco_versoes?on_conflict=base,abrangencia,data_base&select=id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify([linha]),
  });
  const [{ id }] = await r.json();
  if (!partes.length) return id;
  await restFetch(`bases_preco_partes?versao_id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  for (let i = 0; i < partes.length; i += tamanhoLote) {
    await restFetch("bases_preco_partes", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(partes.slice(i, i + tamanhoLote).map((p) => ({ versao_id: id, ...p }))),
    });
  }
  await restFetch(`bases_preco_versoes?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ situacao: versao.situacao }) });
  return id;
}

async function versoesGravadas(base) {
  const r = await restFetch(`bases_preco_versoes?base=eq.${encodeURIComponent(base)}&select=id,abrangencia,data_base,versao,arquivo,situacao&order=data_base.desc`);
  return r.json();
}

async function aplicarRetencao(agora = Date.now()) {
  const meses = Math.max(1, num(process.env.BASES_RETENCAO_MESES, 24));
  const corte = mesDeCorte(agora, meses);
  await restFetch(`bases_preco_versoes?data_base=lt.${corte}-01`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return corte;
}

// Alarme: o estado de cada base fica em dados_robo (mesmo formato do coletar_comprasgov_resultados.js).
// saudeFonte: ok | indisponivel | formato_mudou | zerada | atrasada | robots.
async function registrarSaude(base, estado) {
  const atual = (await buscarBlob("dados_robo", CHAVE_SAUDE).catch(() => null)) || {};
  atual[base] = { ...(atual[base] || {}), ...estado, atualizadoEm: new Date().toISOString() };
  await salvarBlob("dados_robo", CHAVE_SAUDE, atual);
}

module.exports = { UA, baldeDe, fatiar, mesDeCorte, referenciaZerada, permitidoPeloRobots, conferirRobots, buscarTexto, gravarVersao, versoesGravadas, aplicarRetencao, registrarSaude };
