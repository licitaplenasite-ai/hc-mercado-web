// Estudo contínuo de quem ganha e quem perde em obra (Orçamentista, fase 2). Robô semanal:
//   node scripts/estudo_obras.js                 coleta dos dados abertos e recalcula as estatísticas
//   node scripts/estudo_obras.js --semente scripts/sementes/amostra-obras-20261122.csv
//     carrega a amostra do estudo de 22/11 (carga inicial, uma vez; na nuvem: workflow estudo-obras.yml, semente=1).
//     O CSV do repositório é o de _historico/orcamentista sem órgão, município, número PNCP e vencedor (repo público).
//
// Fonte (pública, sem login; robots.txt de repositorio.dados.gov.br só bloqueia o Googlebot em /segrt/):
//   repositorio.dados.gov.br/seges/comprasgov/propostas/AAAA/MM/propostas-AAAA-MM.csv.zip  todas as propostas de cada
//     item homologado (mês de inclusão do item), com situacao_proposta e classificacao (1 = vencedora). Atualiza aos domingos.
//   repositorio.dados.gov.br/seges/comprasgov/pncp/AAAA/MM/compra_AAAA_MM.csv.zip  compras publicadas no PNCP pelo
//     Compras.gov: modalidade, objeto, UF do órgão e valor estimado.
// Metodologia = a do estudo de 22/11 (_historico/orcamentista/PADROES-QUEM-GANHA-QUEM-PERDE.md): concorrência da
// Lei 14.133, objeto de obra/engenharia, compra de 1 item, valor estimado publicado, vencedora entre 30% e 110% da
// referência. Desconto = 1 − valor final da vencedora ÷ estimado. "Recusada" = situacao_proposta 2 (o MGI não publica
// dicionário; conferido no estudo: sempre mais barata que a vencedora e sem posição). Valor final de cada proposta =
// negociado, senão lance, senão proposta (LEIAME do repositório).
// Grava SEM CNPJ e SEM nome (orcamento_estudo_disputas) e as estatísticas por UF, região, tipo de obra e faixa de valor
// (orcamento_estudo_estatisticas). Só baixa de novo quando algum arquivo mudou (Last-Modified guardado em dados_robo).
// Também coleta os motivos de recusa do chat, se o dono ligou e quem gravou aceitou (ver supabase/orcamento_estudo.sql).
// Alarme: estado em dados_robo "estudo_obras_estado" (saudeFonte, ultimoErro, ultimoSucessoEm) e saída com erro.
//
// Variáveis:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória
//   ESTUDO_MESES               18 — meses de propostas/compras relidos a cada execução (concorrência demora a homologar)
//   LIMITE_MINUTOS             25
const fs = require("node:fs");
const AdmZip = require("adm-zip");
const { restFetch, upsertEmLotes, baixarTodasAsLinhas, buscarBlob, salvarBlob } = require("./supabase_dados");
const bp = require("./bases_preco");

const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);
const REPO = "https://repositorio.dados.gov.br/seges/comprasgov";
const CHAVE_ESTADO = "estudo_obras_estado";
const inicio = Date.now();
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ---------- classificação (a mesma da tela: orcamento-obra-estudo.js) ----------
const { tipoDeObra, faixaDeValor, regiaoDe } = require("../orcamento-obra-estudo.js");
function faixaDeDesconto(d) {
  if (d < 10) return "0a10";
  if (d < 20) return "10a20";
  if (d < 25) return "20a25";
  if (d === 25) return "25";
  if (d <= 30) return "25a30";
  return "acima_30";
}

// ---------- CSV (; e aspas, UTF-8 com BOM) ----------
function* linhasCsv(texto) {
  const s = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      if (c === '"') { if (s[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.length > 1 || linha[0] !== "") yield linha;
      linha = [];
    } else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); yield linha; }
}
function* registrosCsv(texto) {
  let cab = null;
  for (const l of linhasCsv(texto)) {
    if (!cab) { cab = l.map((c) => c.trim()); continue; }
    yield Object.fromEntries(cab.map((c, i) => [c, l[i] ?? ""]));
  }
}
const COLUNAS_PROPOSTAS = ["id_compra", "numero_item", "identificacao_participante", "porte_empresa_participante", "valor_proposta_calculado", "valor_lance_calculado", "valor_negociado_julgamento_calculado", "situacao_proposta", "classificacao", "homologado", "data_hora_alteracao_homologacao"];
const COLUNAS_COMPRAS = ["id_compra", "modalidade_nome", "valor_total_estimado", "unidade_orgao_uf_sigla", "objeto_compra", "modo_disputa_nome_pncp", "ind_atual", "contratacao_excluida"];
function conferirColunas(texto, colunas, nome) {
  const primeira = (texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto).slice(0, 5000).split(/\r?\n/)[0];
  const falta = colunas.filter((c) => !primeira.includes(`"${c}"`) && !primeira.split(";").includes(c));
  if (falta.length) throw Object.assign(new Error(`${nome}: faltam as colunas ${falta.join(", ")}. O formato do repositório mudou?`), { formato: true });
}

// Compra do PNCP -> só concorrência de obra com valor estimado. null = fora do estudo.
function compraDoEstudo(c) {
  if (c.ind_atual && !/^true$/i.test(c.ind_atual)) return null;
  if (/^true$/i.test(c.contratacao_excluida)) return null;
  if (!/concorr/i.test(c.modalidade_nome)) return null;
  const valor = Number(c.valor_total_estimado), tipo = tipoDeObra(c.objeto_compra);
  if (!(valor > 0) || !tipo || !/^[0-9]{17}$/.test(c.id_compra)) return null;
  return { id_compra: c.id_compra, uf: /^[A-Z]{2}$/.test(c.unidade_orgao_uf_sigla) ? c.unidade_orgao_uf_sigla : null, tipo_obra: tipo, valor_estimado: valor, modo_disputa: c.modo_disputa_nome_pncp || null };
}

const valorFinal = (p) => [p.valor_negociado_julgamento_calculado, p.valor_lance_calculado, p.valor_proposta_calculado].map(Number).find((v) => v > 0) || null;
const r2 = (v) => Math.round(v * 100) / 100;

// Propostas de uma compra -> uma disputa (sem CNPJ nem nome), ou null se fora do recorte.
function disputaDe(compra, propostas) {
  const itens = new Set(propostas.map((p) => p.numero_item));
  if (itens.size !== 1) return null;
  const venc = propostas.find((p) => String(p.classificacao).trim() === "1");
  const vFinal = venc && valorFinal(venc);
  if (!vFinal || !/^s/i.test(venc.homologado || "S")) return null;
  const fator = vFinal / compra.valor_estimado;
  if (fator < 0.3 || fator > 1.1) return null;
  const desconto = (p) => r2((1 - valorFinal(p) / compra.valor_estimado) * 100);
  const recusadas = propostas.filter((p) => String(p.situacao_proposta).trim() === "2" && valorFinal(p) && valorFinal(p) < vFinal);
  const porFaixa = {}, situacoes = {};
  for (const p of propostas) {
    const s = String(p.situacao_proposta || "").trim() || "vazio";
    situacoes[s] = (situacoes[s] || 0) + 1;
    if (!valorFinal(p)) continue;
    const f = faixaDeDesconto(desconto(p));
    porFaixa[f] ||= [0, 0];
    porFaixa[f][0]++;
    if (s === "2") porFaixa[f][1]++;
  }
  return {
    ...compra, faixa_valor: faixaDeValor(compra.valor_estimado), valor_estimado: r2(compra.valor_estimado),
    participantes: new Set(propostas.map((p) => p.identificacao_participante)).size,
    vencedor_me_epp: venc.porte_empresa_participante ? String(venc.porte_empresa_participante).trim() === "1" : null,
    desconto_vencedor: desconto(venc), recusadas_mais_baratas: recusadas.length, descontos_recusadas: recusadas.map(desconto),
    propostas_por_faixa: porFaixa, situacoes,
    data_resultado: /^\d{4}-\d{2}-\d{2}/.test(venc.data_hora_alteracao_homologacao || "") ? venc.data_hora_alteracao_homologacao.slice(0, 10) : null,
    fonte: "comprasgov",
  };
}

// ---------- estatísticas ----------
function quantil(ordenados, q) {
  if (!ordenados.length) return null;
  const pos = (ordenados.length - 1) * q, b = Math.floor(pos);
  return r2(ordenados[b] + (ordenados[Math.min(b + 1, ordenados.length - 1)] - ordenados[b]) * (pos - b));
}
function resumo(ds) {
  const descontos = ds.map((d) => Number(d.desconto_vencedor)).sort((a, b) => a - b);
  const part = ds.map((d) => d.participantes).sort((a, b) => a - b);
  const comMe = ds.filter((d) => d.vencedor_me_epp !== null && d.vencedor_me_epp !== undefined);
  const faixas = {};
  for (const d of ds) for (const [f, [t, r]] of Object.entries(d.propostas_por_faixa || {})) { faixas[f] ||= [0, 0]; faixas[f][0] += t; faixas[f][1] += r; }
  const datas = ds.map((d) => d.data_resultado).filter(Boolean).sort();
  return {
    n: ds.length,
    dados: {
      desconto_mediana: quantil(descontos, 0.5), desconto_p25: quantil(descontos, 0.25), desconto_p75: quantil(descontos, 0.75),
      pct_com_recusa_mais_barata: r2((ds.filter((d) => d.recusadas_mais_baratas > 0).length / ds.length) * 100),
      recusadas_media: r2(ds.reduce((a, d) => a + d.recusadas_mais_baratas, 0) / ds.length),
      participantes_mediana: quantil(part, 0.5),
      pct_vencedor_me_epp: comMe.length ? r2((comMe.filter((d) => d.vencedor_me_epp).length / comMe.length) * 100) : null,
      pct_exatamente_25: r2((ds.filter((d) => Number(d.desconto_vencedor) === 25).length / ds.length) * 100),
      // Taxa de recusa por faixa de desconto, só onde há o detalhe por proposta (robô; a amostra antiga não tem).
      recusa_por_faixa: Object.fromEntries(Object.entries(faixas).filter(([, [t]]) => t >= 20).map(([f, [t, r]]) => [f, { propostas: t, pct_recusadas: r2((r / t) * 100) }])),
    },
    periodo_inicio: datas[0] || null, periodo_fim: datas[datas.length - 1] || null,
  };
}
// Todos os recortes: escopo (BR, região, UF) × tipo (todos ou um) × faixa (todas ou uma).
function estatisticas(disputas) {
  const grupos = new Map();
  const somar = (k, d) => { if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(d); };
  for (const d of disputas) {
    const escopos = ["BR", ...(d.uf ? [`regiao:${regiaoDe(d.uf)}`, `uf:${d.uf}`] : [])].filter((e) => !e.endsWith(":null"));
    for (const e of escopos) for (const t of ["*", d.tipo_obra]) for (const f of ["*", d.faixa_valor]) somar(`${e}|${t}|${f}`, d);
  }
  return [...grupos].map(([recorte, ds]) => ({ recorte, ...resumo(ds) }));
}

// Amostra do estudo de 22/11 (CSV ;, uma linha por disputa, sem CNPJ) -> disputas.
function disputasDaAmostra(texto) {
  const out = [];
  for (const l of registrosCsv(texto)) {
    // A amostra já foi filtrada como obra (com o objeto inteiro); o CSV traz o objeto cortado: tipo não achado = outra_obra.
    const valor = Number(l.valor_estimado), tipo = tipoDeObra(l.objeto) || "outra_obra", desconto = Number(l.desconto_vencedor_pct);
    if (!/^[0-9]{17}$/.test(l.id_compra) || !(valor > 0) || !tipo || !Number.isFinite(desconto)) continue;
    out.push({
      id_compra: l.id_compra, uf: /^[A-Z]{2}$/.test(l.uf) ? l.uf : null, tipo_obra: tipo, faixa_valor: faixaDeValor(valor), valor_estimado: r2(valor),
      participantes: Math.max(1, Number(l.participantes) || 1), vencedor_me_epp: l["porte_vencedor(1=ME/EPP)"] === "" ? null : l["porte_vencedor(1=ME/EPP)"] === "1",
      desconto_vencedor: r2(desconto), recusadas_mais_baratas: Number(l.recusadas_mais_baratas) || 0,
      descontos_recusadas: String(l.descontos_das_recusadas || "").split(/[|,]/).map(Number).filter(Number.isFinite).map(r2),
      propostas_por_faixa: {}, situacoes: {}, modo_disputa: l.modo_disputa || null, data_resultado: null, fonte: "amostra_20261122",
    });
  }
  return out;
}

// ---------- motivos de recusa (só com a coleta ligada e o aceite de quem gravou: a função do banco filtra) ----------
// Tira CNPJ, CPF, e-mail, telefone, link e os nomes de empresa da compra. Nome de pessoa depois de "Sr.", "Sra.",
// "pregoeiro(a)" ou "agente de contratação" também sai. shortcut: nome de pessoa solto no meio do texto não é
// reconhecido; se a amostra mostrar casos, trocar por lista de nomes próprios.
function anonimizarMotivo(texto, nomesEmpresas = []) {
  let s = String(texto || "").replace(/\s+/g, " ").trim();
  s = s.replace(/\b\d{2}\.?\d{3}\.?\d{3}\s*\/?\s*\d{4}\s*-?\s*\d{2}\b/g, "[CNPJ]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}\s*-?\s*\d{2}\b/g, "[CPF]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-mail]")
    .replace(/\bhttps?:\/\/\S+/gi, "[link]")
    .replace(/(\(?\b\d{2}\)?\s*)?\b9?\d{4}[-\s]?\d{4}\b/g, "[telefone]");
  for (const nome of [...nomesEmpresas].filter((n) => String(n || "").trim().length >= 4).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(String(nome).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    s = s.replace(re, "[empresa]");
  }
  const P = "[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+";
  s = s.replace(new RegExp(`\\b(Sra?\\.?|Senhora?|pregoeir[oa]|agente de contrata[çc][ãa]o)\\s+${P}(?:\\s+(?:d[aeo]s?\\s+|e\\s+)?${P}){0,4}`, "g"), "$1 [nome]");
  return s.replace(/@/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000);
}
const CATEGORIAS = [
  ["prazo", /prazo|nao (enviou|encaminhou|apresentou)|intempestiv|fora do prazo|nao anexou/],
  ["inexequivel", /inexequ|75\s*%/],
  ["cpu", /composic|cpu|analitic/],
  ["encargos", /encargos|desonera/],
  ["bdi", /\bbdi\b|bonificac/],
  ["preco_acima", /acima d[oa] (valor|preco)|superior ao (valor|preco|orcad|estimad)|sobrepreco|acima do estimado|acima do orcado/],
  ["habilitacao", /atestado|capacidade tecnica|\bcat\b|crea|cau|balanc|qualificacao|certid|habilita/],
  ["documento", /declarac|assinatura|assinad|documento/],
  ["planilha", /planilha|cronograma|quantitativ|unitari/],
];
const categoriaDoMotivo = (texto) => (CATEGORIAS.find(([, re]) => re.test(semAcento(texto))) || ["outro"])[0];

async function coletarMotivos() {
  const r = await restFetch("rpc/orcamento_motivos_para_coletar", { method: "POST", body: JSON.stringify({ p_limite: 1000 }) });
  const linhas = await r.json();
  const motivos = [];
  for (const l of linhas) {
    const tipoObra = tipoDeObra(l.descricao_item);
    if (!tipoObra) continue;
    const motivo = anonimizarMotivo(l.motivo || l.texto, l.nomes || []);
    if (motivo.length < 5) continue;
    motivos.push({ chave: l.chave, tipo: l.tipo, categoria: categoriaDoMotivo(motivo), motivo, tipo_obra: tipoObra, data: l.data_hora ? String(l.data_hora).slice(0, 10) : null });
  }
  if (motivos.length) await upsertEmLotes("orcamento_motivos_recusa", motivos, "chave", 200);
  return motivos.length;
}

// ---------- coleta ----------
function mesesParaTras(agora, n) {
  const d = new Date(agora), out = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}
const urlPropostas = (mes) => `${REPO}/propostas/${mes.slice(0, 4)}/${mes.slice(5)}/propostas-${mes}.csv.zip`;
const urlCompras = (mes) => `${REPO}/pncp/${mes.slice(0, 4)}/${mes.slice(5)}/compra_${mes.replace("-", "_")}.csv.zip`;

async function assinatura(url) {
  await bp.conferirRobots(url);
  const r = await fetch(url, { method: "HEAD", headers: { "user-agent": bp.UA }, signal: globalThis.AbortSignal.timeout(30000) });
  if (r.status === 404) return null; // mês sem arquivo ainda
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return `${r.headers.get("last-modified") || ""}|${r.headers.get("content-length") || ""}`;
}
async function baixarCsv(url) {
  await bp.conferirRobots(url);
  const r = await fetch(url, { headers: { "user-agent": bp.UA }, signal: globalThis.AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  const entrada = new AdmZip(Buffer.from(await r.arrayBuffer())).getEntries().find((e) => /\.csv$/i.test(e.entryName));
  if (!entrada) throw Object.assign(new Error(`${url}: ZIP sem CSV. O formato do repositório mudou?`), { formato: true });
  return entrada.getData().toString("utf8");
}

async function coletar(estado) {
  const meses = mesesParaTras(Date.now(), num(process.env.ESTUDO_MESES, 18));
  const arquivos = {};
  for (const mes of meses) for (const url of [urlPropostas(mes), urlCompras(mes)]) arquivos[url] = await assinatura(url);
  const mudou = Object.entries(arquivos).some(([u, a]) => a && estado.arquivos?.[u] !== a);
  if (!mudou) return { disputas: null, arquivos };
  const compras = new Map();
  for (const mes of meses) {
    if (!arquivos[urlCompras(mes)]) continue;
    const texto = await baixarCsv(urlCompras(mes));
    conferirColunas(texto, COLUNAS_COMPRAS, `compra_${mes}`);
    for (const c of registrosCsv(texto)) { const x = compraDoEstudo(c); if (x) compras.set(x.id_compra, x); }
  }
  const porCompra = new Map();
  for (const mes of meses) {
    if (!arquivos[urlPropostas(mes)]) continue;
    if (Date.now() - inicio > num(process.env.LIMITE_MINUTOS, 25) * 60000) throw new Error("Tempo acabou antes de ler todas as propostas; nada gravado.");
    const texto = await baixarCsv(urlPropostas(mes));
    conferirColunas(texto, COLUNAS_PROPOSTAS, `propostas-${mes}`);
    for (const p of registrosCsv(texto)) {
      if (!compras.has(p.id_compra)) continue;
      if (!porCompra.has(p.id_compra)) porCompra.set(p.id_compra, []);
      porCompra.get(p.id_compra).push(Object.fromEntries(COLUNAS_PROPOSTAS.map((c) => [c, p[c]])));
    }
  }
  const disputas = [...porCompra].map(([id, ps]) => disputaDe(compras.get(id), ps)).filter(Boolean);
  if (compras.size > 50 && !disputas.length) throw Object.assign(new Error(`${compras.size} concorrências de obra e nenhuma disputa montada. O formato das propostas mudou?`), { formato: true });
  return { disputas, arquivos };
}

async function recalcular() {
  const todas = await baixarTodasAsLinhas("orcamento_estudo_disputas", "uf,tipo_obra,faixa_valor,participantes,vencedor_me_epp,desconto_vencedor,recusadas_mais_baratas,propostas_por_faixa,data_resultado");
  const agora = new Date().toISOString();
  const linhas = estatisticas(todas).map((e) => ({ ...e, atualizado_em: agora }));
  await upsertEmLotes("orcamento_estudo_estatisticas", linhas, "recorte", 500);
  await restFetch(`orcamento_estudo_estatisticas?atualizado_em=lt.${encodeURIComponent(agora)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return { disputas: todas.length, recortes: linhas.length };
}

async function main() {
  const i = process.argv.indexOf("--semente");
  if (i > 0) {
    const ds = disputasDaAmostra(fs.readFileSync(process.argv[i + 1], "utf8"));
    // ignore-duplicates: a semente nunca sobrescreve disputa já coletada pelo robô.
    await restFetch("orcamento_estudo_disputas?on_conflict=id_compra", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(ds) });
    console.log(`Semente: ${ds.length} disputas da amostra. ${JSON.stringify(await recalcular())}`);
    return;
  }
  const estado = (await buscarBlob("dados_robo", CHAVE_ESTADO)) || {};
  try {
    const { disputas, arquivos } = await coletar(estado);
    if (disputas) await upsertEmLotes("orcamento_estudo_disputas", disputas, "id_compra", 500);
    const r = disputas ? await recalcular() : { nadaNovo: true };
    const motivos = await coletarMotivos();
    await salvarBlob("dados_robo", CHAVE_ESTADO, { arquivos, saudeFonte: "ok", ultimoSucessoEm: new Date().toISOString(), ultimoErro: null, disputasNestaColeta: disputas ? disputas.length : 0, motivos });
    console.log(`Estudo de obras: ${disputas ? `${disputas.length} disputas coletadas; ${JSON.stringify(r)}` : "nenhum arquivo mudou"}; ${motivos} motivo(s) de recusa.`);
  } catch (e) {
    await salvarBlob("dados_robo", CHAVE_ESTADO, { ...estado, saudeFonte: e.robots ? "robots" : e.formato ? "formato_mudou" : "indisponivel", ultimoErro: String(e.message).slice(0, 500) }).catch(() => {});
    throw e;
  }
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { tipoDeObra, faixaDeValor, faixaDeDesconto, regiaoDe, linhasCsv, registrosCsv, compraDoEstudo, disputaDe, resumo, estatisticas, disputasDaAmostra, anonimizarMotivo, categoriaDoMotivo, conferirColunas, urlPropostas, urlCompras };
