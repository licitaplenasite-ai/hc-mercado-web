// Robô mensal do SINAPI: baixa a referência mais recente da CAIXA e grava (supabase/sinapi_todas_ufs.sql)
// sinapi_itens (insumos e composições, uma vez), sinapi_custos (preço por UF, desonerado e não desonerado)
// e sinapi_composicao_itens (composições analíticas: itens e coeficientes).
//   node scripts/coletar_sinapi.js
//
// Fonte: página de downloads da CAIXA (caixa.gov.br/sinapi -> Relatórios Mensais -> "Relatórios a partir de 2025").
// Grátis, sem cadastro, sem login, sem captcha; robots.txt da CAIXA só bloqueia /_layouts, /_vti_bin e formulários.
// Um ZIP por mês com todas as UFs:
//   https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/SINAPI-AAAA-MM-formato-xlsx.zip  (~16 MB)
// Retificação sai com sufixo "_Retificacao01", "_Retificacao02"... Mês ainda não publicado responde 404.
// O site da CAIXA responde ao primeiro pedido com 302 para a mesma URL e um cookie; como um navegador, o robô
// guarda o cookie e repete o pedido.
// Dentro do ZIP, SINAPI_Referência_AAAA_MM.xlsx tem as abas ISD/ICD (insumos sem/com desoneração), CSD/CCD
// (composições sem/com desoneração), cada UF numa coluna (linha 4 do cabeçalho), e "Analítico" (itens de cada
// composição com coeficiente, igual para todas as UFs). ISE/CSE (sem encargos) ficam de fora.
// O xlsx é lido direto do XML (adm-zip, já dependência): sem biblioteca nova.
//
// Rodar de novo é seguro: upsert pelas chaves; depois apaga o que ficou com referência anterior (só a vigente fica
// no banco). Preço em branco (sem coleta no mês para a UF) fica null; sem preço nos dois regimes, não é gravado.
//
// Variáveis:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória para gravar (scripts/supabase_dados.js)
//   SINAPI_UFS                 todas as 27 (lista separada por vírgula, ex.: "AC,PB")
//   SINAPI_MESES_ATRAS         6 — quantos meses voltar procurando a última referência publicada
//   SINAPI_REFERENCIA          opcional "AAAA-MM" — força um mês (sem sondar)
//   TAMANHO_LOTE_BANCO         1000
const AdmZip = require("adm-zip");
const { restFetch, upsertEmLotes } = require("./supabase_dados");

const BASE = "https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TODAS_UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");
const UFS = new Set(TODAS_UFS);
// Aba -> o que ela é. Nomes fixos do arquivo da CAIXA desde 2025.
const ABAS = { ISD: { tipo: "insumo", desonerado: false }, ICD: { tipo: "insumo", desonerado: true }, CSD: { tipo: "composicao", desonerado: false }, CCD: { tipo: "composicao", desonerado: true } };
const ABA_ANALITICO = "Analítico";
const PRIMEIRA_LINHA_DADOS = 11;

const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);
const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const xmlTexto = (s) => String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m);
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const centavos = (v) => (Number(v) > 0 ? (Math.round(Number(v) * 100) / 100).toFixed(2) : null);

// "AAAA-MM" dos últimos n meses, do mais recente para o mais antigo (mês atual primeiro).
function mesesParaTras(agora, n) {
  const d = new Date(agora), out = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}
// Nomes a sondar para um mês: retificação mais alta primeiro (ela substitui a original).
const nomesDoMes = (mes) => [3, 2, 1].map((r) => `SINAPI-${mes}-formato-xlsx_Retificacao0${r}.zip`).concat(`SINAPI-${mes}-formato-xlsx.zip`);

// Cookie que o site da CAIXA entrega no 302 para a mesma URL (ver cabeçalho).
let cookies = "";
async function pedir(url, metodo, timeoutMs) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const r = await fetch(url, { method: metodo, redirect: "manual", headers: { "user-agent": UA, ...(cookies ? { cookie: cookies } : {}) }, signal: globalThis.AbortSignal.timeout(timeoutMs) });
    const novos = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
    if (!(r.status >= 300 && r.status < 400 && new URL(r.headers.get("location") || "", url).href === url && novos.length)) return r;
    cookies = [...new Set([...cookies.split("; ").filter(Boolean), ...novos])].join("; ");
  }
  throw new Error(`CAIXA repetiu o redirecionamento para ${url}. O site mudou?`);
}
const existe = async (url) => (await pedir(url, "HEAD", 30000)).status === 200;
async function acharReferencia(agora = Date.now()) {
  const forcado = process.env.SINAPI_REFERENCIA;
  if (forcado) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(forcado)) throw new Error("SINAPI_REFERENCIA deve ser AAAA-MM.");
    for (const nome of nomesDoMes(forcado)) if (await existe(BASE + nome)) return { mes: forcado, url: BASE + nome };
    throw new Error(`SINAPI ${forcado} não encontrado na CAIXA.`);
  }
  for (const mes of mesesParaTras(agora, num(process.env.SINAPI_MESES_ATRAS, 6))) {
    for (const nome of nomesDoMes(mes)) if (await existe(BASE + nome)) return { mes, url: BASE + nome };
  }
  throw new Error("Nenhuma referência SINAPI encontrada nos últimos meses. Confira a página de downloads da CAIXA.");
}

// ---------- leitura do xlsx (XML) ----------
function textosCompartilhados(xml) {
  return [...String(xml || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlTexto([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
}
// Nome da aba -> caminho do XML dentro do xlsx (workbook.xml + rels).
// Atributos em qualquer ordem: o Excel grava Id antes de Target, o openpyxl (e outros) grava depois.
const atributo = (tag, nome) => new RegExp(`\\s${nome}="([^"]*)"`).exec(tag)?.[1];
function mapaAbas(workbookXml, relsXml) {
  const alvo = Object.fromEntries([...relsXml.matchAll(/<Relationship\s[^>]*>/g)].map((m) => [atributo(m[0], "Id"), String(atributo(m[0], "Target") || "").replace(/^\/?(xl\/)?/, "xl/")]));
  return Object.fromEntries([...workbookXml.matchAll(/<sheet\s[^>]*>/g)].map((m) => [xmlTexto(atributo(m[0], "name") || ""), alvo[atributo(m[0], "r:id")]]));
}
const coluna = (ref) => ref.replace(/[0-9]+$/, "");
// Linhas da aba: [{ n, celulas: { A: "...", B: "..." } }]. Código de composição vem numa fórmula HYPERLINK(...,104658)
// com valor em cache 0: nesse caso o código sai do último argumento da fórmula.
function* linhasDaAba(xml, compartilhados) {
  for (const r of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas = {};
    for (const c of r[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attr, corpo = ""] = c;
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let valor = v === undefined ? "" : xmlTexto(v);
      if (/t="s"/.test(attr) && v !== undefined) valor = compartilhados[Number(v)] ?? "";
      else if (/t="inlineStr"/.test(attr)) valor = xmlTexto([...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      const f = /<f>HYPERLINK\([\s\S]*,\s*(\d+)\)<\/f>/.exec(corpo);
      if (f) valor = f[1];
      if (valor !== "") celulas[coluna(ref)] = valor;
    }
    yield { n: Number(r[1]), celulas };
  }
}
// Linhas de uma aba de preços com o preço de cada UF pedida. Insumo: A classificação, B código, C descrição,
// D unidade, E origem, coluna da UF = preço. Composição: A grupo, B código, C descrição, D unidade, coluna da UF = custo.
// A coluna de cada UF vem da linha 4.
function lerTabela(xml, compartilhados, aba, ufs) {
  const { tipo } = ABAS[aba];
  let colunas = null;
  const out = [];
  for (const { n, celulas } of linhasDaAba(xml, compartilhados)) {
    if (n === 4) colunas = Object.fromEntries(Object.keys(celulas).map((k) => [celulas[k].trim(), k]));
    if (n < PRIMEIRA_LINHA_DADOS) continue;
    const falta = ufs.find((uf) => !colunas?.[uf]);
    if (falta) throw new Error(`Aba ${aba}: coluna da UF ${falta} não encontrada no cabeçalho (linha 4). O layout da CAIXA mudou?`);
    const codigo = String(celulas.B || "").trim();
    const descricao = String(celulas.C || "").trim().slice(0, 2000);
    if (!/^[0-9]{1,10}$/.test(codigo) || !descricao) continue;
    out.push({
      tipo, codigo, descricao,
      unidade: String(celulas.D || "").trim().slice(0, 30) || null,
      grupo: String(celulas.A || "").trim().slice(0, 200) || null,
      origem: tipo === "insumo" ? String(celulas.E || "").trim().slice(0, 10) || null : null,
      precos: Object.fromEntries(ufs.map((uf) => [uf, centavos(celulas[colunas[uf]])])),
    });
  }
  return out;
}
// Aba Analítico: linha da composição (sem Tipo Item) seguida dos itens (C = COMPOSICAO/INSUMO, D código, G coeficiente).
function lerAnalitico(xml, compartilhados, referencia) {
  const itens = new Map();
  for (const { n, celulas } of linhasDaAba(xml, compartilhados)) {
    if (n < PRIMEIRA_LINHA_DADOS) continue;
    const itemTipo = { COMPOSICAO: "composicao", INSUMO: "insumo" }[String(celulas.C || "").trim().toUpperCase()];
    const composicao = String(celulas.B || "").trim(), itemCodigo = String(celulas.D || "").trim();
    const coeficiente = Number(celulas.G);
    const descricao = String(celulas.E || "").trim().slice(0, 2000);
    if (!itemTipo || !/^[0-9]{1,10}$/.test(composicao) || !/^[0-9]{1,10}$/.test(itemCodigo) || !descricao || !(coeficiente >= 0)) continue;
    const chave = `${composicao}|${itemTipo}|${itemCodigo}`;
    // Mesmo item duas vezes na composição: soma o coeficiente (a chave do banco é composição + item).
    const antes = itens.get(chave);
    if (antes) { antes.coeficiente = String(Number(antes.coeficiente) + coeficiente); continue; }
    itens.set(chave, {
      composicao, item_tipo: itemTipo, item_codigo: itemCodigo, descricao,
      unidade: String(celulas.F || "").trim().slice(0, 30) || null,
      coeficiente: String(coeficiente), situacao: String(celulas.H || "").trim().slice(0, 30) || null,
      referencia: `${referencia}-01`,
    });
  }
  return [...itens.values()];
}
// Abas sem e com desoneração -> linhas de sinapi_itens e de sinapi_custos (um par de preços por UF).
function montarLinhas(semDeson, comDeson, ufs, referencia) {
  const ref = `${referencia}-01`;
  const cd = new Map(comDeson.map((l) => [l.codigo, l.precos]));
  const itens = [], custos = [];
  for (const l of semDeson) {
    itens.push({ tipo: l.tipo, codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, grupo: l.grupo, origem: l.origem, referencia: ref, busca: semAcento(l.descricao).slice(0, 2000) });
    for (const uf of ufs) {
      const precoSd = l.precos[uf], precoCd = cd.get(l.codigo)?.[uf] ?? null;
      if (precoSd || precoCd) custos.push({ uf, tipo: l.tipo, codigo: l.codigo, preco_sd: precoSd, preco_cd: precoCd, referencia: ref });
    }
  }
  return { itens, custos };
}
function abrirReferencia(zipBuffer) {
  const entrada = new AdmZip(zipBuffer).getEntries().find((e) => /^SINAPI_Refer.*\.xlsx$/i.test(e.entryName.split("/").pop()));
  if (!entrada) throw new Error("ZIP do SINAPI sem o arquivo SINAPI_Referência_*.xlsx. O formato da CAIXA mudou?");
  const xlsx = new AdmZip(entrada.getData());
  const ler = (caminho) => xlsx.getEntry(caminho)?.getData().toString("utf8") ?? null;
  const abas = mapaAbas(ler("xl/workbook.xml") || "", ler("xl/_rels/workbook.xml.rels") || "");
  for (const a of [...Object.keys(ABAS), ABA_ANALITICO]) if (!abas[a]) throw new Error(`Aba ${a} não encontrada no SINAPI_Referência. O formato da CAIXA mudou?`);
  return { compartilhados: textosCompartilhados(ler("xl/sharedStrings.xml")), lerAba: (a) => ler(abas[a]) };
}

async function main() {
  const ufs = String(process.env.SINAPI_UFS || TODAS_UFS.join(",")).split(",").map((u) => u.trim().toUpperCase()).filter(Boolean);
  for (const uf of ufs) if (!UFS.has(uf)) throw new Error(`UF inválida em SINAPI_UFS: ${uf}`);
  const lote = num(process.env.TAMANHO_LOTE_BANCO, 1000);
  const ref = await acharReferencia();
  console.log(`SINAPI ${ref.mes}: ${ref.url}`);
  const r = await pedir(ref.url, "GET", 300000);
  if (!r.ok) throw new Error(`Download do SINAPI falhou: HTTP ${r.status}`);
  const pacote = abrirReferencia(Buffer.from(await r.arrayBuffer()));
  const tabela = (aba) => lerTabela(pacote.lerAba(aba), pacote.compartilhados, aba, ufs);
  let itens = [], custos = [];
  for (const [sd, cd] of [["ISD", "ICD"], ["CSD", "CCD"]]) {
    const m = montarLinhas(tabela(sd), tabela(cd), ufs, ref.mes);
    if (!m.itens.length) throw new Error(`Aba ${sd} sem linhas: nada gravado.`);
    // concat, não push(...): ~330 mil preços estouram a pilha como argumentos.
    itens = itens.concat(m.itens); custos = custos.concat(m.custos);
  }
  const analitico = lerAnalitico(pacote.lerAba(ABA_ANALITICO), pacote.compartilhados, ref.mes);
  if (!analitico.length) throw new Error("Aba Analítico sem linhas: nada gravado.");
  // Itens antes dos custos (chave estrangeira). Limpeza só depois de gravar tudo: falha no meio não apaga a referência anterior.
  await upsertEmLotes("sinapi_itens", itens, "tipo,codigo", lote);
  await upsertEmLotes("sinapi_custos", custos, "uf,tipo,codigo", lote);
  await upsertEmLotes("sinapi_composicao_itens", analitico, "composicao,item_tipo,item_codigo", lote);
  const antes = `referencia=lt.${ref.mes}-01`;
  await restFetch(`sinapi_custos?uf=in.(${ufs.join(",")})&${antes}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await restFetch(`sinapi_composicao_itens?${antes}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  // Código que saiu do SINAPI: apaga o item e (cascade) os preços dele em todas as UFs.
  await restFetch(`sinapi_itens?${antes}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  console.log(`Referência ${ref.mes}: ${itens.length} insumos/composições, ${custos.length} preços em ${ufs.length} UF(s) (${ufs.join(",")}), ${analitico.length} itens de composição analítica.`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { mesesParaTras, nomesDoMes, textosCompartilhados, mapaAbas, linhasDaAba, lerTabela, lerAnalitico, montarLinhas, semAcento, xmlTexto, abrirReferencia };
