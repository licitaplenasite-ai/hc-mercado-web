// Robô semanal das outras bases oficiais de preço de obra (além do SINAPI, que tem robô próprio):
// descobre a versão mais nova de cada base na página oficial, grava no catálogo bases_preco_versoes
// (supabase/bases_preco.sql) e, quando o arquivo é aberto por robô, grava os preços por data-base.
//   node scripts/coletar_bases_oficiais.js
//
// Bases e o que o robô faz com cada uma (pesquisa de 22/11/2026; ver _historico/orcamentista/FASE2-20261122.md):
//   SICRO (DNIT)  trimestral (jan/abr/jul/out), um .7z por UF (~26 MB) com xlsx e pdf. Lê o "Relatório Sintético de
//                 Composições de Custos" e o "de Materiais" (xlsx). Arredonda (NBR 5891). Página gov.br, sem login;
//                 robots.txt do gov.br não bloqueia /dnit. Precisa do programa 7z (já vem no runner ubuntu do GitHub).
//   SEINFRA-CE    sem calendário (028 sem e 028.1 com desoneração, de out/2023). Só catálogo: a tabela é consulta HTML
//                 em sin.seinfra.ce.gov.br; o robô avisa quando aparecer versão nova.
//   ORSE (SE)     mensal, só no programa ORSE (arquivo .ORSE próprio). Só catálogo: avisa o mês novo.
//   EMOP (RJ), SETOP/SEINFRA-MG: sem página oficial de download localizada (EMOP pode ser por assinatura). Sem robô,
//                 não forçado: preço digitado com a fonte, como na fase 1.
// Ninguém é coletado contra o robots.txt (scripts/bases_preco.js). Falha de acesso ou de formato: estado em dados_robo
// "bases_preco_saude" e saída com erro no fim (o GitHub Actions avisa). Base atrasada só fica marcada (sem erro).
//
// Variáveis:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória
//   BASES                      todas — lista separada por vírgula (ex.: "SICRO,ORSE")
//   SICRO_UFS                  todas as 27
//   SICRO_BAIXAR               "1" — baixa e lê o .7z da versão nova ("0" = só catálogo)
//   LIMITE_MINUTOS             40 — orçamento da execução; UF que não couber fica para a próxima semana
//   BASES_RETENCAO_MESES       24 — ver scripts/bases_preco.js
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const bp = require("./bases_preco");
const { lerXlsx } = require("./xlsx_simples");

const inicio = Date.now();
const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);
const LIMITE_MS = num(process.env.LIMITE_MINUTOS, 40) * 60000;
const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ---------- SICRO ----------
const SICRO_RAIZ = "https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro/relatorios/relatorios-sicro";
const SICRO_REGIOES = ["norte", "nordeste", "centro-oeste", "sudeste", "sul"];
const SICRO_UF = {
  acre: "AC", amapa: "AP", amazonas: "AM", para: "PA", rondonia: "RO", roraima: "RR", tocantins: "TO",
  alagoas: "AL", bahia: "BA", ceara: "CE", maranhao: "MA", paraiba: "PB", pernambuco: "PE", piaui: "PI", "rio-grande-do-norte": "RN", sergipe: "SE",
  "distrito-federal": "DF", goias: "GO", "mato-grosso": "MT", "mato-grosso-do-sul": "MS",
  "espirito-santo": "ES", "minas-gerais": "MG", "rio-de-janeiro": "RJ", "sao-paulo": "SP",
  parana: "PR", "rio-grande-do-sul": "RS", "santa-catarina": "SC",
};
// Página da região -> mês mais novo de cada UF: { AM: { mes: "2026-07", url, revisado } }. A página lista os links
// ".../<regiao>/<uf>/<ano>/<pasta>/<mes>-<ano>[-revisado]" (no Acre a pasta às vezes é "abril-2026").
function sicroMesesDaRegiao(html, regiao) {
  const out = {};
  const re = new RegExp(`href="(${SICRO_RAIZ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${regiao}/([a-z-]+)/(\\d{4})/[a-z0-9-]+/([a-z]+)-(\\d{4})(-revisad[oa][a-z0-9-]*)?)"`, "g");
  for (const m of String(html).matchAll(re)) {
    const [, url, slug, , nomeMes, ano, revisado] = m;
    const uf = SICRO_UF[slug], mm = MESES[nomeMes];
    if (!uf || !mm) continue;
    const mes = `${ano}-${String(mm).padStart(2, "0")}`;
    const atual = out[uf];
    if (!atual || mes > atual.mes || (mes === atual.mes && revisado && !atual.revisado)) out[uf] = { mes, url, revisado: Boolean(revisado) };
  }
  return out;
}
const sicroArquivo = (html) => /href="(https:\/\/www\.gov\.br\/dnit\/[^"]+\.7z)"/i.exec(String(html))?.[1] || null;

// Linhas de uma planilha de relatório -> [{ codigo, descricao, unidade, preco, precoDesonerado }]. O cabeçalho é
// achado pelo nome das colunas (Código, Descrição, Unidade, Custo/Preço unitário); sem cabeçalho = formato mudou.
function lerTabelaPorCabecalho(linhas) {
  for (let h = 0; h < Math.min(linhas.length, 40); h++) {
    const cab = (linhas[h] || []).map(semAcento);
    const iCod = cab.findIndex((c) => /^cod/.test(c)), iDesc = cab.findIndex((c) => /^descri/.test(c));
    if (iCod < 0 || iDesc < 0) continue;
    const iUn = cab.findIndex((c) => /^unid/.test(c));
    const precos = cab.map((c, i) => ({ c, i })).filter(({ c }) => /(custo|preco).*(unit|total|horario)|^(custo|preco)/.test(c) && !/improdutiv/.test(c));
    const comDeson = precos.find(({ c }) => /com desonera/.test(c));
    const sem = precos.filter((p) => p !== comDeson);
    const iPreco = (sem.find(({ c }) => /unit/.test(c)) || sem[sem.length - 1])?.i;
    if (iPreco === undefined) continue;
    const out = [];
    for (const l of linhas.slice(h + 1)) {
      const codigo = String(l[iCod] ?? "").trim(), descricao = String(l[iDesc] ?? "").trim();
      const preco = Number(l[iPreco]), deson = comDeson ? Number(l[comDeson.i]) : null;
      if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(codigo) || !descricao || !(preco > 0)) continue;
      out.push({ codigo, descricao: descricao.slice(0, 2000), unidade: iUn >= 0 ? String(l[iUn] ?? "").trim().slice(0, 30) || null : null, preco, precoDesonerado: deson > 0 ? deson : null });
    }
    if (out.length) return { linhas: out, temDesonerado: Boolean(comDeson) };
  }
  return { linhas: [], temDesonerado: false };
}

// Composições e materiais lidos -> partes do histórico (mesmo formato do SINAPI: [sem, com desoneração]).
function partesSicro(uf, composicoes, materiais) {
  const precos = {}, itens = {};
  for (const [tipo, lista] of [["composicao", composicoes], ["insumo", materiais]]) {
    for (const l of lista) {
      precos[`${tipo}|${l.codigo}`] = [l.preco, l.precoDesonerado];
      itens[`${tipo}|${l.codigo}`] = [l.descricao, l.unidade];
    }
  }
  return [...bp.fatiar(`precos:${uf}`, precos), ...bp.fatiar("itens", itens)];
}

function versaoSicro(uf, mes, url, situacao, itens, desonerado, obs) {
  return {
    base: "SICRO", abrangencia: uf, data_base: `${mes}-01`, versao: `${mes.slice(5)}/${mes.slice(0, 4)}`, desonerado,
    arredondamento: "arredondar", casas_decimais: 4, fonte: "DNIT — SICRO, relatórios sintéticos por UF", fonte_url: url,
    arquivo: url ? url.split("/").pop() : null, situacao, itens,
    observacao: obs || "SICRO arredonda pela NBR 5891: 5 casas na quantidade, 4 no custo e preço unitário, 2 no total (Manual de Custos, vol. 1, 3.7). O edital manda.",
  };
}

async function baixarSicro(url) {
  await bp.conferirRobots(url);
  const r = await fetch(url, { headers: { "user-agent": bp.UA }, signal: globalThis.AbortSignal.timeout(600000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.slice(0, 6).toString("hex") !== "377abcaf271c") throw Object.assign(new Error(`${url} não é um arquivo 7z. O DNIT mudou o formato?`), { formato: true });
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "sicro-"));
  const arquivo = path.join(pasta, "a.7z");
  fs.writeFileSync(arquivo, b);
  // Só os dois xlsx usados; execFile sem shell, nomes fixos.
  execFileSync("7z", ["e", "-y", `-o${pasta}`, arquivo, "*Sint*tico de Composi*.xlsx", "*Sint*tico de Materiais.xlsx", "-r"], { stdio: "ignore" });
  const ler = (re) => {
    const nome = fs.readdirSync(pasta).find((n) => re.test(semAcento(n)));
    if (!nome) throw Object.assign(new Error(`${url}: arquivo "${re.source}" não encontrado no 7z. O DNIT mudou os relatórios?`), { formato: true });
    return lerTabelaPorCabecalho(lerXlsx(fs.readFileSync(path.join(pasta, nome))).flatMap((a) => a.linhas));
  };
  try {
    return { composicoes: ler(/sintetico de composicoes/), materiais: ler(/sintetico de materiais/) };
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
}

async function coletarSicro(gravadas) {
  const ufs = new Set(String(process.env.SICRO_UFS || Object.values(SICRO_UF).join(",")).split(",").map((u) => u.trim().toUpperCase()));
  const baixar = process.env.SICRO_BAIXAR !== "0";
  const ultimos = {};
  for (const reg of SICRO_REGIOES) Object.assign(ultimos, sicroMesesDaRegiao(await bp.buscarTexto(`${SICRO_RAIZ}/${reg}/${reg}`), reg));
  if (!Object.keys(ultimos).length) throw Object.assign(new Error("SICRO: nenhuma UF/mês nas páginas das regiões. O DNIT mudou a página?"), { formato: true });
  const feitas = [];
  for (const uf of [...ufs].sort()) {
    const u = ultimos[uf];
    if (!u) continue;
    const g = gravadas.find((v) => v.abrangencia === uf && String(v.data_base).slice(0, 7) === u.mes);
    if (g && (g.situacao === "precos" || !baixar)) continue;
    if (Date.now() - inicio > LIMITE_MS) { console.log(`SICRO: tempo acabou; ${uf} ${u.mes} fica para a próxima execução.`); break; }
    const url7z = sicroArquivo(await bp.buscarTexto(u.url));
    if (!url7z) throw Object.assign(new Error(`SICRO ${uf} ${u.mes}: página sem o arquivo .7z (${u.url}). O DNIT mudou a página?`), { formato: true });
    if (!baixar) { await bp.gravarVersao(versaoSicro(uf, u.mes, url7z, "catalogo", 0, "nao_informado"), []); feitas.push(`${uf} ${u.mes} (catálogo)`); continue; }
    const { composicoes, materiais } = await baixarSicro(url7z);
    if (!composicoes.linhas.length) throw Object.assign(new Error(`SICRO ${uf} ${u.mes}: não achei código/descrição/custo no relatório sintético de composições. O formato mudou?`), { formato: true });
    const deson = composicoes.temDesonerado ? "ambos" : "nao_informado";
    await bp.gravarVersao(versaoSicro(uf, u.mes, url7z, "precos", composicoes.linhas.length + materiais.linhas.length, deson), partesSicro(uf, composicoes.linhas, materiais.linhas));
    feitas.push(`${uf} ${u.mes} (${composicoes.linhas.length} composições, ${materiais.linhas.length} materiais)`);
  }
  return { ultimaDataBase: Object.values(ultimos).map((x) => x.mes).sort().pop(), feitas };
}

// ---------- só catálogo ----------
// SEINFRA-CE: "Tabela 028 Sem Desoneração" / "Tabela 028.1 Com Desoneração" na página da secretaria.
function seinfraVersoes(html) {
  return [...String(html).matchAll(/Tabela\s+(\d{3}(?:\.\d)?)\s+(Sem|Com)\s+Desonera/gi)].map((m) => ({ versao: m[1], desonerado: /com/i.test(m[2]) }));
}
// ORSE: arquivo da base mensal "AAAAMM01-NN.ORSE" na página de downloads.
function orseUltimoMes(html) {
  const meses = [...String(html).matchAll(/(20\d{2})(0[1-9]|1[0-2])01-\d{2}\.ORSE/gi)].map((m) => `${m[1]}-${m[2]}`);
  return meses.sort().pop() || null;
}
const mesAtual = () => new Date().toISOString().slice(0, 7);

async function coletarSeinfraCe(gravadas) {
  const url = "https://www.ce.gov.br/seinfra/tabela-de-custos/";
  const v = seinfraVersoes(await bp.buscarTexto(url));
  if (!v.length) throw Object.assign(new Error("SEINFRA-CE: a página não mostra mais \"Tabela NNN Sem/Com Desoneração\". O formato mudou?"), { formato: true });
  const nome = v.map((x) => x.versao).sort().join(" / ");
  if (gravadas.some((g) => g.versao === nome)) return { ultimaDataBase: String(gravadas[0].data_base).slice(0, 7), feitas: [] };
  await bp.gravarVersao({
    base: "SEINFRA-CE", abrangencia: "CE", data_base: `${mesAtual()}-01`, versao: nome, desonerado: v.length > 1 ? "ambos" : v[0].desonerado ? "sim" : "nao",
    arredondamento: "edital", casas_decimais: null, fonte: "SEINFRA-CE — Tabela de Custos", fonte_url: url, arquivo: null, situacao: "catalogo", itens: 0,
    observacao: "Versão nova vista na página (data-base = mês em que o robô viu). Consulta em sin.seinfra.ce.gov.br (HTML); preço digitado com a versão.",
  }, []);
  return { ultimaDataBase: mesAtual(), feitas: [`versão ${nome}`] };
}

async function coletarOrse(gravadas) {
  const url = "http://orse.cehop.se.gov.br/downloads.asp";
  const mes = orseUltimoMes(await bp.buscarTexto(url));
  if (!mes) throw Object.assign(new Error("ORSE: a página de downloads não mostra arquivo AAAAMM01-NN.ORSE. O formato mudou?"), { formato: true });
  if (gravadas.some((g) => String(g.data_base).slice(0, 7) === mes)) return { ultimaDataBase: mes, feitas: [] };
  await bp.gravarVersao({
    base: "ORSE", abrangencia: "SE", data_base: `${mes}-01`, versao: mes, desonerado: "nao_informado", arredondamento: "edital", casas_decimais: null,
    fonte: "CEHOP-SE — ORSE", fonte_url: url, arquivo: null, situacao: "catalogo", itens: 0,
    observacao: "Base só no programa ORSE (formato próprio .ORSE): o robô não abre. Preço digitado com o mês.",
  }, []);
  return { ultimaDataBase: mes, feitas: [`mês ${mes}`] };
}

// Meses sem versão nova além do esperado (frequência + 2 de tolerância): "atrasada".
const FREQUENCIA_MESES = { SICRO: 3, ORSE: 1, "SEINFRA-CE": null };
function atrasada(base, ultimaDataBase, agora = Date.now()) {
  const f = FREQUENCIA_MESES[base];
  if (!f || !ultimaDataBase) return false;
  const d = new Date(agora), [a, m] = ultimaDataBase.split("-").map(Number);
  return (d.getUTCFullYear() - a) * 12 + (d.getUTCMonth() + 1 - m) > f + 2;
}

const COLETORES = { SICRO: coletarSicro, "SEINFRA-CE": coletarSeinfraCe, ORSE: coletarOrse };

async function main() {
  const pedidas = String(process.env.BASES || Object.keys(COLETORES).join(",")).split(",").map((b) => b.trim().toUpperCase()).filter(Boolean);
  const falhas = [];
  for (const base of pedidas) {
    if (!COLETORES[base]) throw new Error(`Base sem robô: ${base}. Use ${Object.keys(COLETORES).join(", ")}.`);
    try {
      const r = await COLETORES[base](await bp.versoesGravadas(base));
      const saudeFonte = atrasada(base, r.ultimaDataBase) ? "atrasada" : "ok";
      await bp.registrarSaude(base, { saudeFonte, ultimoSucessoEm: new Date().toISOString(), ultimaDataBase: r.ultimaDataBase, ultimoErro: null });
      console.log(`${base}: ${r.feitas.length ? r.feitas.join("; ") : "nada novo"} (mais nova: ${r.ultimaDataBase || "?"}${saudeFonte === "atrasada" ? ", ATRASADA" : ""}).`);
    } catch (e) {
      const saudeFonte = e.robots ? "robots" : e.formato ? "formato_mudou" : "indisponivel";
      await bp.registrarSaude(base, { saudeFonte, ultimoErro: String(e.message).slice(0, 500) }).catch(() => {});
      console.error(`${base}: ${saudeFonte}: ${e.message}`);
      falhas.push(base);
    }
  }
  console.log(`Histórico: data-base desde ${await bp.aplicarRetencao()} (BASES_RETENCAO_MESES).`);
  if (falhas.length) throw new Error(`Falharam: ${falhas.join(", ")}. Veja o log acima e dados_robo "bases_preco_saude".`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { sicroMesesDaRegiao, sicroArquivo, lerTabelaPorCabecalho, partesSicro, versaoSicro, seinfraVersoes, orseUltimoMes, atrasada, SICRO_RAIZ };
