// Prospecção (Inteligência de Mercado): PCA/PGC, IRP aberta, ata com saldo para adesão e contrato vencendo,
// lidos da tabela prospeccao_itens (carga diária do robô scripts/coletar_prospeccao.js).
//   GET /api/prospeccao?tipo=pca|irp|ata|contrato&uf=AM&palavras=limpeza,papel&catmat=269941&dias=180
//   (Authorization: Bearer <sessão>)
// Resposta: { tipo, linhas:[...], limite, truncado, coletadoEm, cobertura: { UF: { concluidaEm, emAndamento, linhas } } | null }.
// Até quatro subrequisições por chamada (três níveis da busca + cobertura; a tela pede uma aba por vez): cabe folgado nos 50 do Cloudflare, e o
// trabalho pesado (varrer PNCP/Compras.gov) já foi feito pelo robô. Lê com o token do PRÓPRIO usuário,
// e a RLS (authenticated) é a barreira. Sem verificarLimiteDiario: a mesma leitura já é possível direto
// pelo PostgREST com a sessão (mesmo raciocínio de sancoes-cnpj.js).
const { cabecalhosPadrao, exigirUsuarioAprovado } = require("./_auth");

const URL_SB = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const ANON = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";
const LIMITE = 200;
const TIPOS = new Set(["pca", "irp", "ata", "contrato"]);
const DIAS = new Set([30, 90, 180, 365]);
const COLUNAS = "id,tipo,fonte,plataforma,uf,orgao_cnpj,orgao_nome,unidade_nome,municipio,objeto,descricao,catmat,quantidade,valor_unitario,valor_total,data_inicio,data_ref,fornecedor_cnpj,fornecedor_nome,saldo,maximo_adesao,adesoes_usadas,adesoes_em,link,coletado_em";
const UFS = new Set("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" "));
// Brasília é UTC-3 fixo (mesma conta de contextos-operacao).
const hojeBrasilia = (agora = Date.now(), dias = 0) => new Date(agora - 3 * 36e5 + dias * 864e5).toISOString().slice(0, 10);

// Mesma normalização do robô (coluna busca): minúsculo, sem acento; e só letras/dígitos/espaço, para o
// termo não carregar sintaxe do PostgREST (vírgula, parêntese, ponto, asterisco) para dentro do or=().
const termo = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// Cada frase vira palavras soltas (em qualquer ordem: "limpeza material" acha "material de limpeza"), sem as palavras
// de ligação e reduzidas a um radical simples de plural/singular: "construção"/"construções" -> "construc",
// "papel"/"papéis" -> "pape", "materiais" -> "materia", "computadores" -> "computador". O ILIKE é por trecho.
const LIGACAO = new Set("a o as os e de da do das dos em no na nos nas para por com um uma ao".split(" "));
function radical(p) {
  if (p.length < 5 || /^\d+$/.test(p)) return p;
  const r = p.replace(/(coes|cao)$/, "c").replace(/(oes|aes|aos|ao)$/, "").replace(/ais$/, "a").replace(/eis$/, "e").replace(/ois$/, "o")
    .replace(/([rzl])es$/, "$1").replace(/s$/, "").replace(/l$/, "");
  return r.length >= 3 ? r : p;
}
const palavrasDaFrase = (frase) => [...new Set(frase.split(" ").filter((w) => w.length >= 2 && !LIGACAO.has(w)).map(radical))].slice(0, 5);

function validar(q = {}) {
  const tipo = String(q.tipo || "");
  if (!TIPOS.has(tipo)) return { erro: "Escolha o tipo: pca, irp, ata ou contrato." };
  const uf = String(q.uf || "").toUpperCase();
  if (uf && !UFS.has(uf)) return { erro: "UF inválida." };
  const palavras = [...new Set(String(q.palavras || "").slice(0, 300).split(",").map(termo).filter((p) => p.length >= 3))].slice(0, 8);
  const catmat = String(q.catmat || "").trim();
  if (catmat && !/^\d{1,12}$/.test(catmat)) return { erro: "CATMAT/CATSER deve ter só dígitos." };
  const dias = Number(q.dias || 180);
  if (!DIAS.has(dias)) return { erro: "Período: 30, 90, 180 ou 365 dias." };
  const frases = palavras.map(palavrasDaFrase).filter((ws) => ws.length);
  return { tipo, uf: uf || null, palavras, frases, catmat: catmat || null, dias };
}

// Janela por data_ref: o que vence/acontece de hoje até hoje+dias. Ata é diferente: para adesão interessa a
// ata ainda vigente por pelo menos 30 dias (carona leva tempo), sem teto.
//
// Com palavras, a busca é em três níveis (cada um é uma consulta, na ordem; os de baixo só entram se sobrar lugar):
//   inicio  o nome do item (busca_nome = começo da descrição/objeto) começa com o termo
//   nome    o termo aparece em outro ponto do nome
//   espec   o termo só aparece no resto do texto (especificação): a tela recolhe esse grupo ("papel a4" dentro da ficha da impressora)
// Uma frase casa quando TODAS as palavras dela aparecem (and); frases diferentes somam (or). "inicio" = o nome começa
// pela primeira palavra e tem as demais.
const NIVEIS = ["inicio", "nome", "espec"];
function casar(frases, coluna, inicio = false) {
  return frases.map((ws) => {
    const c = ws.map((w, i) => `${coluna}.ilike.${inicio && i === 0 ? "" : "*"}${w}*`);
    return c.length === 1 ? c[0] : `and(${c.join(",")})`;
  }).join(",");
}
function filtroTexto(frases, nivel) {
  if (nivel === "inicio") return ["or", `(${casar(frases, "busca_nome", true)})`];
  if (nivel === "nome") return ["and", `(or(${casar(frases, "busca_nome")}),not.or(${casar(frases, "busca_nome", true)}))`];
  return ["and", `(or(${casar(frases, "busca")}),not.or(${casar(frases, "busca_nome")}))`];
}

function montarConsulta(f, agora = Date.now(), nivel = null, limite = LIMITE + 1) {
  const p = new URLSearchParams({ select: COLUNAS, tipo: `eq.${f.tipo}`, order: "data_ref.asc,valor_total.desc.nullslast", limit: String(limite) });
  if (f.uf) p.set("uf", `eq.${f.uf}`);
  if (f.catmat) p.set("catmat", `eq.${f.catmat}`);
  if (f.frases.length && !nivel) p.set("or", `(${casar(f.frases, "busca")})`);
  else if (f.frases.length) p.set(...filtroTexto(f.frases, nivel));
  if (f.tipo === "ata") p.append("data_ref", `gte.${hojeBrasilia(agora, 30)}`);
  else {
    p.append("data_ref", `gte.${hojeBrasilia(agora)}`);
    p.append("data_ref", `lte.${hojeBrasilia(agora, f.dias)}`);
  }
  return `${URL_SB}/rest/v1/prospeccao_itens?${p}`;
}

// Cobertura da coleta (o robô grava um resumo por grupo de UFs em dados_robo, chaves prospeccao_cobertura_<grupo>):
// para o tipo pedido, quando cada UF fechou a última coleta completa e se há uma em andamento. A IRP é nacional.
function coberturaDoTipo(blobs, tipo) {
  const porUf = {};
  for (const b of blobs || []) {
    for (const [chave, e] of Object.entries(b?.dado?.etapas || {})) {
      const [uf, t] = chave === "irp" ? ["BR", "irp"] : chave.split(":");
      if (t === tipo && (UFS.has(uf) || uf === "BR")) porUf[uf] = { concluidaEm: e.concluidaEm || null, emAndamento: Boolean(e.emAndamento), linhas: e.linhas ?? null };
    }
  }
  return porUf;
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "private, max-age=600" };
  const resposta = (status, body) => ({ statusCode: status, headers: status === 200 ? headers : { ...headers, "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return resposta(204, {});
  if (event.httpMethod !== "GET") return resposta(405, { erro: "Método não permitido." });
  const auth = await exigirUsuarioAprovado(event);
  if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
  const filtro = validar(event.queryStringParameters || {});
  if (filtro.erro) return resposta(400, { erro: filtro.erro });
  try {
    const consultar = async (nivel, limite) => {
      const r = await fetch(montarConsulta(filtro, Date.now(), nivel, limite), {
        headers: { apikey: ANON, Authorization: event.headers?.authorization || event.headers?.Authorization, Accept: "application/json" },
        signal: globalThis.AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lote = await r.json();
      if (!Array.isArray(lote)) throw new Error("resposta inválida");
      return nivel === "espec" ? lote.map((l) => ({ ...l, so_especificacao: true })) : lote;
    };
    // Sem palavras é uma consulta só. Com palavras, nome primeiro e especificação por último (no máximo 3 subrequisições).
    const linhas = [];
    for (const nivel of filtro.frases.length ? NIVEIS : [null]) {
      if (linhas.length > LIMITE) break;
      linhas.push(...(await consultar(nivel, LIMITE + 1 - linhas.length)));
    }
    const coletadoEm = linhas.reduce((m, l) => (l.coletado_em > m ? l.coletado_em : m), "") || null;
    // Sem a cobertura a tela ainda funciona (só não explica o vazio por UF): falha aqui não derruba a busca.
    const cobertura = await fetch(`${URL_SB}/rest/v1/dados_robo?select=dado&chave=like.prospeccao_cobertura_*`, {
      headers: { apikey: ANON, Authorization: event.headers?.authorization || event.headers?.Authorization, Accept: "application/json" },
      signal: globalThis.AbortSignal.timeout(5000),
    }).then((r) => (r.ok ? r.json() : null)).then((b) => (Array.isArray(b) ? coberturaDoTipo(b, filtro.tipo) : null)).catch(() => null);
    return resposta(200, { tipo: filtro.tipo, linhas: linhas.slice(0, LIMITE), limite: LIMITE, truncado: linhas.length > LIMITE, coletadoEm, cobertura });
  } catch (e) {
    console.warn("prospeccao:", e.message);
    return resposta(503, { erro: "Não foi possível consultar a prospecção agora. Tente de novo em instantes." });
  }
};
exports.validar = validar;
exports.montarConsulta = montarConsulta;
exports.coberturaDoTipo = coberturaDoTipo;
