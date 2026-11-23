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
// nas tabelas sinapi_*, que a busca da tela usa). Preço em branco (sem coleta no mês para a UF) fica null; sem preço
// nos dois regimes, não é gravado.
// Histórico por data-base (supabase/bases_preco.sql): cada mês coletado também vira uma versão "SINAPI BR AAAA-MM"
// em bases_preco_versoes/_partes (preços das UFs, descrições e analítico), guardada por BASES_RETENCAO_MESES (24).
// Assim o orçamento usa a data-base do edital, não só o mês atual.
// Referência zerada: a CAIXA já publicou mês sem preço (out/2025, retificado em 22/12/2025). Se mais da metade das
// linhas vier sem preço em todas as UFs, nada é gravado nas tabelas vigentes, a versão fica "zerada" no catálogo e o
// robô sai com erro (alarme). Retificação: a cada execução confere os SINAPI_MESES_REVISAR meses anteriores; se a CAIXA
// publicou "_RetificacaoNN" mais nova que a gravada (ou o mês estava zerado ou faltando), regrava o histórico do mês.
// Alarme no padrão dos robôs: estado em dados_robo "bases_preco_saude" (saudeFonte, ultimoErro, ultimoSucessoEm) e saída
// com erro, que o GitHub Actions avisa por e-mail.
// Rota reserva (23/11/2026: o WAF da CAIXA barra o robô com 429/403 e as tabelas ficaram vazias): uma pessoa baixa no
// navegador o MESMO ZIP oficial (SINAPI-AAAA-MM-formato-xlsx[_RetificacaoNN].zip), anexa a um Release do repositório
// e roda o workflow sinapi.yml com arquivo_release=<tag>. O job baixa o anexo e passa SINAPI_ARQUIVO: o robô não fala
// com a CAIXA, confere que o nome do arquivo é o oficial e bate com SINAPI_REFERENCIA (vazia = mês do nome) e segue o
// fluxo normal (upsert, histórico, checagem de zerada, saúde). Nada roda na máquina do dono.
// Falha nunca apaga o que está gravado: download, leitura e conferência vêm antes de qualquer escrita; a referência
// anterior só é apagada depois que a nova subiu inteira; mês mais velho que o vigente só entra como histórico (não
// rebaixa a vigente); arquivo zerado não marca como "zerada" um mês que já está gravado com preço.
//
// Variáveis:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória para gravar (scripts/supabase_dados.js)
//   SINAPI_UFS                 todas as 27 (lista separada por vírgula, ex.: "AC,PB")
//   SINAPI_MESES_ATRAS         6 — quantos meses voltar procurando a última referência publicada
//   SINAPI_REFERENCIA          opcional "AAAA-MM" — força um mês (sem sondar)
//   SINAPI_ARQUIVO             opcional — caminho de um ZIP oficial já baixado (rota reserva, ver abaixo)
//   SINAPI_SO_HISTORICO        "1" — grava só o histórico daquele mês (carregar meses antigos sem trocar a vigente)
//   SINAPI_MESES_REVISAR       3 — meses anteriores conferidos à procura de retificação
//   SINAPI_PAUSA_MS            3000 — espera entre sondagens na CAIXA (o limitador anti-robô dela barra rajadas)
//   SINAPI_LIMIAR_ZERADA       0.5 — fração de linhas sem preço que marca a referência como zerada
//   BASES_RETENCAO_MESES       24 — ver scripts/bases_preco.js
//   TAMANHO_LOTE_BANCO         1000
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { restFetch, upsertEmLotes } = require("./supabase_dados");
const bp = require("./bases_preco");

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
// Só 404 quer dizer "mês não publicado". A CAIXA (WAF Azion) responde 429 e depois 403 a pedidos em rajada: em
// 23/11/2026 o robô contou isso como "não existe" e concluiu que nenhum mês estava publicado. Agora o robô espera
// entre sondagens, repete com espera maior (Retry-After, se vier) e, se o bloqueio continuar, falha dizendo o motivo.
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const bloqueio = (status) => status === 429 || status === 403;
async function existe(url, pedirFn = pedir, pausaMs = num(process.env.SINAPI_PAUSA_MS, 3000)) {
  let status;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const r = await pedirFn(url, "HEAD", 30000);
    status = r.status;
    // Arquivo inexistente: a CAIXA não dá 404, redireciona (302) para outra página. O 302 para a MESMA URL (cookie)
    // já foi tratado em pedir(); aqui sobra só o redirecionamento para fora, que significa "não publicado".
    if (status === 200 || status === 404 || (status >= 300 && status < 400)) {
      await esperar(pausaMs);
      return status === 200;
    }
    const retry = Number(r.headers?.get?.("retry-after"));
    await esperar(Number.isFinite(retry) && retry > 0 ? Math.min(retry, 300) * 1000 : pausaMs * 10 * (tentativa + 1));
  }
  throw Object.assign(new Error(`CAIXA respondeu HTTP ${status} para ${url.split("/").pop()} (${bloqueio(status) ? "limite/bloqueio anti-robô" : "erro do site"}). Tente mais tarde; não é falta de publicação.`), { indisponivel: bloqueio(status) });
}
// Rota reserva: ZIP local. O nome tem que ser o oficial (é o que vai para fonte_url/arquivo no catálogo e para a
// conferência de retificação) e o mês tem que bater com SINAPI_REFERENCIA, para não gravar um mês no lugar de outro.
function referenciaDoArquivo(caminho, forcado = process.env.SINAPI_REFERENCIA) {
  const nome = path.basename(caminho);
  const mes = /^SINAPI-(\d{4}-(?:0[1-9]|1[0-2]))-formato-xlsx(?:_Retificacao\d{2})?\.zip$/.exec(nome)?.[1];
  if (!mes) throw new Error(`SINAPI_ARQUIVO "${nome}" não tem o nome oficial da CAIXA (SINAPI-AAAA-MM-formato-xlsx.zip ou _RetificacaoNN.zip). Anexe o arquivo como veio do site, sem renomear.`);
  if (forcado && forcado !== mes) throw new Error(`SINAPI_ARQUIVO é de ${mes}, mas SINAPI_REFERENCIA pede ${forcado}. Confira o arquivo anexado.`);
  return { mes, url: BASE + nome, arquivo: caminho };
}
async function acharReferencia(agora = Date.now()) {
  if (process.env.SINAPI_ARQUIVO) return referenciaDoArquivo(process.env.SINAPI_ARQUIVO);
  const forcado = process.env.SINAPI_REFERENCIA;
  if (forcado) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(forcado)) throw new Error("SINAPI_REFERENCIA deve ser AAAA-MM.");
    for (const nome of nomesDoMes(forcado)) if (await existe(BASE + nome)) return { mes: forcado, url: BASE + nome };
    throw Object.assign(new Error(`SINAPI ${forcado} não encontrado na CAIXA.`), { indisponivel: true });
  }
  for (const mes of mesesParaTras(agora, num(process.env.SINAPI_MESES_ATRAS, 6))) {
    for (const nome of nomesDoMes(mes)) if (await existe(BASE + nome)) return { mes, url: BASE + nome };
  }
  throw Object.assign(new Error("Nenhuma referência SINAPI encontrada nos últimos meses. Confira a página de downloads da CAIXA."), { indisponivel: true });
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

// Linhas lidas do mês -> partes do histórico (bases_preco_partes): preços por UF, descrições e analítico.
// Preço em texto "12.34" vira número; vazio vira null. Chave "tipo|codigo"; analítico pela composição.
function partesSinapi(itens, custos, analitico) {
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  const precosPorUf = {};
  for (const c of custos) (precosPorUf[c.uf] ||= {})[`${c.tipo}|${c.codigo}`] = [n(c.preco_sd), n(c.preco_cd)];
  const descricoes = Object.fromEntries(itens.map((i) => [`${i.tipo}|${i.codigo}`, [i.descricao, i.unidade]]));
  const composicoes = {};
  for (const a of analitico) (composicoes[a.composicao] ||= []).push([a.item_tipo, a.item_codigo, Number(a.coeficiente)]);
  return [
    ...Object.entries(precosPorUf).flatMap(([uf, m]) => bp.fatiar(`precos:${uf}`, m)),
    ...bp.fatiar("itens", descricoes),
    ...bp.fatiar("analitico", composicoes),
  ];
}
function versaoSinapi(mes, url, situacao, itens, zerados) {
  const retificacao = /_Retificacao(\d{2})\.zip$/.exec(url)?.[1];
  return {
    base: "SINAPI", abrangencia: "BR", data_base: `${mes}-01`, versao: retificacao ? `${mes} Retificação ${retificacao}` : mes,
    desonerado: "ambos", arredondamento: "edital", casas_decimais: 2,
    fonte: "CAIXA/IBGE — SINAPI, preço mediano da capital por UF", fonte_url: url, arquivo: url.split("/").pop(),
    situacao, itens, zerados,
    observacao: "Custo sem BDI. A CAIXA não manda truncar nem arredondar: siga o edital (órgãos com SINAPI costumam truncar em 2 casas).",
  };
}

// Baixa e lê um mês. zerada: arquivo publicado sem preço (ver cabeçalho).
async function baixarZip(ref) {
  if (ref.arquivo) return fs.readFileSync(ref.arquivo);
  const r = await pedir(ref.url, "GET", 300000);
  if (!r.ok) throw Object.assign(new Error(`Download do SINAPI falhou: HTTP ${r.status}`), { indisponivel: bloqueio(r.status) });
  return Buffer.from(await r.arrayBuffer());
}
async function lerMes(ref, ufs) {
  const pacote = abrirReferencia(await baixarZip(ref));
  const tabela = (aba) => lerTabela(pacote.lerAba(aba), pacote.compartilhados, aba, ufs);
  let itens = [], custos = [], lidas = [];
  for (const [sd, cd] of [["ISD", "ICD"], ["CSD", "CCD"]]) {
    const semDeson = tabela(sd), comDeson = tabela(cd);
    lidas = lidas.concat(semDeson, comDeson);
    const m = montarLinhas(semDeson, comDeson, ufs, ref.mes);
    if (!m.itens.length) throw Object.assign(new Error(`Aba ${sd} sem linhas: nada gravado.`), { formato: true });
    // concat, não push(...): ~330 mil preços estouram a pilha como argumentos.
    itens = itens.concat(m.itens); custos = custos.concat(m.custos);
  }
  const analitico = lerAnalitico(pacote.lerAba(ABA_ANALITICO), pacote.compartilhados, ref.mes);
  if (!analitico.length) throw Object.assign(new Error("Aba Analítico sem linhas: nada gravado."), { formato: true });
  const zerados = lidas.filter((l) => !Object.values(l.precos).some(Boolean)).length;
  return { itens, custos, analitico, zerados, zerada: bp.referenciaZerada(lidas, num(process.env.SINAPI_LIMIAR_ZERADA, 0.5)) };
}

async function gravarVigente(ref, ufs, { itens, custos, analitico }, lote) {
  // Mês mais velho que o vigente (ex.: ZIP errado na rota reserva) misturaria preço antigo com o atual: recusa.
  const [atual] = await (await restFetch("sinapi_itens?select=referencia&order=referencia.desc&limit=1")).json();
  if (atual && String(atual.referencia).slice(0, 7) > ref.mes) throw new Error(`SINAPI ${ref.mes} é mais antigo que a referência vigente (${String(atual.referencia).slice(0, 7)}): nada trocado. Para guardar só no histórico, use so_historico=1.`);
  // Itens antes dos custos (chave estrangeira). Limpeza só depois de gravar tudo: falha no meio não apaga a referência anterior.
  await upsertEmLotes("sinapi_itens", itens, "tipo,codigo", lote);
  await upsertEmLotes("sinapi_custos", custos, "uf,tipo,codigo", lote);
  await upsertEmLotes("sinapi_composicao_itens", analitico, "composicao,item_tipo,item_codigo", lote);
  const antes = `referencia=lt.${ref.mes}-01`;
  await restFetch(`sinapi_custos?uf=in.(${ufs.join(",")})&${antes}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await restFetch(`sinapi_composicao_itens?${antes}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  // Código que saiu do SINAPI: apaga o item e (cascade) os preços dele em todas as UFs.
  await restFetch(`sinapi_itens?${antes}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}

// Lê, confere se veio zerado e grava o histórico (e a vigente, se pedido).
async function coletarMes(ref, ufs, { vigente, lote }) {
  const lido = await lerMes(ref, ufs);
  const todas = ufs.length === TODAS_UFS.length;
  if (lido.zerada) {
    // Não esconde um mês que já está gravado com preço (ex.: reenvio do arquivo original depois da retificação).
    const comPreco = todas && (await bp.versoesGravadas("SINAPI")).some((v) => String(v.data_base).slice(0, 7) === ref.mes && v.situacao === "precos");
    if (todas && !comPreco) await bp.gravarVersao(versaoSinapi(ref.mes, ref.url, "zerada", lido.itens.length, lido.zerados), []);
    throw Object.assign(new Error(`SINAPI ${ref.mes} (${ref.url.split("/").pop()}) veio sem preço em ${lido.zerados} linhas: referência zerada, nada trocado. Aguardando a retificação da CAIXA.`), { zerada: true });
  }
  if (vigente) await gravarVigente(ref, ufs, lido, lote);
  // Histórico só com as 27 UFs: uma versão "BR" com parte das UFs enganaria quem orça em outra UF.
  if (todas) await bp.gravarVersao(versaoSinapi(ref.mes, ref.url, "precos", lido.itens.length, lido.zerados), partesSinapi(lido.itens, lido.custos, lido.analitico));
  return lido;
}

// Meses anteriores com retificação nova, gravados zerados ou faltando: referências a regravar no histórico.
async function retificacoesPendentes(mesVigente, gravadas, agora = Date.now(), existeFn = existe) {
  const meses = mesesParaTras(agora, num(process.env.SINAPI_MESES_REVISAR, 3) + 1).filter((m) => m < mesVigente);
  const out = [];
  for (const mes of meses) {
    const g = gravadas.find((v) => String(v.data_base).slice(0, 7) === mes);
    for (const nome of nomesDoMes(mes)) {
      if (!(await existeFn(BASE + nome))) continue;
      if (!g || g.situacao === "zerada" || g.arquivo !== nome) out.push({ mes, url: BASE + nome });
      break;
    }
  }
  return out;
}

async function main() {
  const ufs = String(process.env.SINAPI_UFS || TODAS_UFS.join(",")).split(",").map((u) => u.trim().toUpperCase()).filter(Boolean);
  for (const uf of ufs) if (!UFS.has(uf)) throw new Error(`UF inválida em SINAPI_UFS: ${uf}`);
  const lote = num(process.env.TAMANHO_LOTE_BANCO, 1000);
  const soHistorico = process.env.SINAPI_SO_HISTORICO === "1";
  if (soHistorico && ufs.length !== TODAS_UFS.length) throw new Error("SINAPI_SO_HISTORICO precisa das 27 UFs (deixe SINAPI_UFS vazio).");
  const ref = await acharReferencia();
  console.log(`SINAPI ${ref.mes}: ${ref.url}${soHistorico ? " (só histórico)" : ""}`);
  const lido = await coletarMes(ref, ufs, { vigente: !soHistorico, lote });
  console.log(`Referência ${ref.mes}: ${lido.itens.length} insumos/composições, ${lido.custos.length} preços em ${ufs.length} UF(s) (${ufs.join(",")}), ${lido.analitico.length} itens de composição analítica.`);
  // Com mês forçado ou arquivo da rota reserva não sonda a CAIXA atrás de retificação (o bloqueio derrubaria a execução).
  if (ufs.length === TODAS_UFS.length && !process.env.SINAPI_REFERENCIA && !process.env.SINAPI_ARQUIVO) {
    for (const r of await retificacoesPendentes(ref.mes, await bp.versoesGravadas("SINAPI"))) {
      console.log(`Histórico: regravando ${r.url} (retificação, mês zerado ou faltando).`);
      await coletarMes(r, ufs, { vigente: false, lote });
    }
    console.log(`Histórico: data-base desde ${await bp.aplicarRetencao()} (BASES_RETENCAO_MESES).`);
  }
  if (!soHistorico) await bp.registrarSaude("SINAPI", { saudeFonte: "ok", ultimoSucessoEm: new Date().toISOString(), ultimaDataBase: ref.mes, ultimoErro: null });
}

// Alarme: guarda o motivo em dados_robo e sai com erro (o GitHub Actions avisa por e-mail).
// Mês não publicado ou WAF da CAIXA barrando o runner (e.indisponivel) é o esperado: aviso, a referência gravada
// continua valendo e o job sai com sucesso (sem batimento no admin; a rota reserva é o Release com arquivo_release).
async function falhar(e, sair = process.exit) {
  const saudeFonte = e.zerada ? "zerada" : e.formato || /formato da CAIXA mudou|layout da CAIXA mudou|O site mudou/.test(e.message) ? "formato_mudou" : "indisponivel";
  await bp.registrarSaude("SINAPI", { saudeFonte, ultimoErro: String(e.message).slice(0, 500) }).catch(() => {});
  if (e.indisponivel) {
    console.log(`::warning::${e.message} A referência gravada continua valendo. Rota reserva: Release sinapi-AAAA-MM + arquivo_release.`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "indisponivel=1\n");
    return sair(0);
  }
  console.error(e);
  return sair(1);
}

if (require.main === module) main().catch(falhar);

module.exports = { falhar, pedir, existe, acharReferencia, referenciaDoArquivo, coletarMes, partesSinapi, versaoSinapi, retificacoesPendentes, mesesParaTras, nomesDoMes, textosCompartilhados, mapaAbas, linhasDaAba, lerTabela, lerAnalitico, montarLinhas, semAcento, xmlTexto, abrirReferencia };
