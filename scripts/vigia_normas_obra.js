// Vigia de normas do Orçamentista: robô semanal que procura em fonte oficial o que mexe em orçamento de obra e grava
// como "novidade para revisar" em orcamento_normas_novidades (supabase/orcamento_normas.sql), com o link.
// NÃO muda regra do Auditor: quem decide é o dono, na tela normas-obra.html; depois alguém altera
// orcamento-obra-regras.js com versão nova e "vale desde".
//   node scripts/vigia_normas_obra.js
//
// Fontes (todas públicas, sem login, robots.txt conferido):
//   TCU   API de dados abertos (dados-abertos.apps.tcu.gov.br/api/acordao/recupera-acordaos): acórdãos mais novos
//         primeiro; separa os que falam de BDI, sobrepreço, inexequibilidade, SINAPI, SICRO, encargos, planilha.
//         A API limita a taxa (HTTP 429): uma página a cada VIGIA_PAUSA_MS e uma nova tentativa depois de 30 s.
//   CAIXA página do SINAPI: PDFs de notas, metodologia e encargos (Notas_SINAPI.pdf etc.). Novidade quando aparece
//         link novo ou quando o PDF muda (Last-Modified/tamanho), ex.: nota de mudança de encargos ou de desoneração.
//   SEGES gov.br/compras: instruções normativas e decretos vigentes (Lei 14.133). Novidade = item novo na lista.
// Na primeira execução (sem estado) só entra o que tiver até VIGIA_DIAS_INICIAIS dias; o resto vira "já visto".
// Alarme no padrão dos robôs: estado em dados_robo "vigia_normas_estado" (saudeFonte por fonte, ultimoErro,
// ultimoSucessoEm) e saída com erro quando uma fonte falha ou muda de formato.
//
// Variáveis:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória
//   VIGIA_DIAS_INICIAIS        90
//   VIGIA_TCU_PAGINAS          20 (50 acórdãos por página; o TCU julga ~150 por sessão do Plenário)
//   VIGIA_PAUSA_MS             2000
const { restFetch, buscarBlob, salvarBlob } = require("./supabase_dados");
const bp = require("./bases_preco");
const { pedir } = require("./coletar_sinapi");

const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);
const DIAS_INICIAIS = num(process.env.VIGIA_DIAS_INICIAIS, 90);
const TCU_PAGINAS = num(process.env.VIGIA_TCU_PAGINAS, 20);
const PAUSA_MS = num(process.env.VIGIA_PAUSA_MS, 2000);
const CHAVE_ESTADO = "vigia_normas_estado";
const TCU_API = "https://dados-abertos.apps.tcu.gov.br/api/acordao/recupera-acordaos";
const CAIXA_SINAPI = "https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/Paginas/default.aspx";
const SEGES = {
  "SEGES-IN": "https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas",
  "SEGES-DECRETO": "https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/decretos-vigentes",
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Termo -> padrão (sem acento). "fortes" bastam sozinhos; "de obra" só contam com obra/engenharia no texto.
const TERMOS_FORTES = [["BDI", /\bbdi\b/], ["SINAPI", /\bsinapi\b/], ["SICRO", /\bsicro\b/], ["jogo de planilha", /jogo de planilha/],
  ["encargos sociais", /encargos sociais/], ["desoneração", /desonera/], ["composição de custo", /composic(ao|oes) de custo/],
  ["planilha orçamentária", /planilha orcamentaria/], ["Decreto 7.983", /7\.?983/]];
const TERMOS_DE_OBRA = [["sobrepreço", /sobrepreco/], ["superfaturamento", /superfaturamento/], ["inexequibilidade", /inexequ/],
  ["preço de referência", /preco(s)? de referencia/], ["reajuste", /reajust/], ["aditivo", /aditivo/], ["critério de aceitabilidade", /aceitabilidade/]];
const OBRA = /\bobra|engenharia|construc|reforma|paviment|rodovi/;

function termosDe(texto) {
  const s = semAcento(texto);
  const fortes = TERMOS_FORTES.filter(([, re]) => re.test(s)).map(([n]) => n);
  const deObra = OBRA.test(s) ? TERMOS_DE_OBRA.filter(([, re]) => re.test(s)).map(([n]) => n) : [];
  return [...fortes, ...deObra];
}
// "18/11/2026" ou "13 DE ABRIL DE 2026" -> "2026-11-18"; sem data -> null.
const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
function dataDe(texto) {
  const s = semAcento(texto);
  let m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/.exec(s);
  if (m && MESES[m[2]]) return `${m[3]}-${String(MESES[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
const diasAtras = (dias, agora = Date.now()) => new Date(agora - dias * 86400000).toISOString().slice(0, 10);

// ---------- TCU ----------
// Acórdão da API -> novidade (ou null se não fala de orçamento de obra). Link: página do acórdão no portal.
function novidadeTcu(a) {
  const texto = `${a.titulo || ""} ${a.sumario || ""}`;
  const termos = termosDe(texto);
  const link = [a.urlAcordao, a.urlArquivoPdf].find((u) => /^https:\/\//.test(String(u || "")));
  if (!termos.length || !link) return null;
  return { fonte: "TCU", titulo: String(a.titulo || `Acórdão ${a.numeroAcordao}/${a.anoAcordao}`).slice(0, 500), link: String(link).slice(0, 600),
    publicado_em: dataDe(a.dataSessao), termos, resumo: String(a.sumario || "").replace(/\s+/g, " ").trim().slice(0, 4000) || null };
}

async function tcuPagina(inicio) {
  const url = `${TCU_API}?inicio=${inicio}&quantidade=50`;
  await bp.conferirRobots(url);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await fetch(url, { headers: { "user-agent": bp.UA, accept: "application/json" }, signal: globalThis.AbortSignal.timeout(60000) });
    if (r.status === 429 && tentativa === 0) { await dormir(30000); continue; }
    if (!r.ok) throw new Error(`TCU: HTTP ${r.status}`);
    const dados = await r.json().catch(() => null);
    if (!Array.isArray(dados)) throw Object.assign(new Error("TCU: a API não devolveu uma lista de acórdãos. O formato mudou?"), { formato: true });
    return dados;
  }
  throw new Error("TCU: HTTP 429 (limite de pedidos) duas vezes.");
}

async function vigiarTcu(estado) {
  const desde = estado.tcuDesde || diasAtras(DIAS_INICIAIS);
  const novas = [];
  let maisNova = desde;
  for (let p = 0; p < TCU_PAGINAS; p++) {
    if (p) await dormir(PAUSA_MS);
    const lista = await tcuPagina(p * 50);
    if (p === 0 && lista.length && !lista.some((a) => a.titulo && a.dataSessao)) throw Object.assign(new Error("TCU: acórdãos sem titulo/dataSessao. O formato mudou?"), { formato: true });
    let antigos = 0;
    for (const a of lista) {
      const d = dataDe(a.dataSessao);
      if (d && d < desde) { antigos++; continue; }
      if (d && d > maisNova) maisNova = d;
      const n = novidadeTcu(a);
      if (n) novas.push(n);
    }
    if (lista.length < 50 || antigos === lista.length) break;
  }
  // Folga de 7 dias: acórdão publicado com atraso ainda entra (o link único evita duplicar).
  return { novas, estado: { tcuDesde: maisNova > desde ? diasAtras(7, Date.parse(maisNova)) : desde } };
}

// ---------- CAIXA ----------
// Links de PDF do SINAPI na página (notas, metodologia, encargos), com o texto do link.
function linksCaixa(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/<a\s[^>]*href="(\/Downloads\/sinapi-[^"]+\.pdf)"[^>]*>([^<]{3,200})/gi)) {
    const url = `https://www.caixa.gov.br${m[1]}`;
    if (!out.has(url)) out.set(url, m[2].replace(/\s+/g, " ").trim());
  }
  return [...out].map(([url, titulo]) => ({ url, titulo }));
}
// Assinatura do PDF sem baixar: Last-Modified + tamanho. Mudou = a CAIXA republicou (nota nova no mesmo arquivo).
async function assinaturaCaixa(url) {
  await bp.conferirRobots(url);
  const r = await pedir(url, "HEAD", 30000);
  if (r.status !== 200) return null;
  return `${r.headers.get("last-modified") || ""}|${r.headers.get("content-length") || ""}`;
}

async function vigiarCaixa(estado) {
  await bp.conferirRobots(CAIXA_SINAPI);
  const r = await pedir(CAIXA_SINAPI, "GET", 60000);
  if (!r.ok) throw new Error(`CAIXA: HTTP ${r.status} na página do SINAPI`);
  const links = linksCaixa(await r.text());
  if (!links.length) throw Object.assign(new Error("CAIXA: a página do SINAPI não tem mais os PDFs /Downloads/sinapi-*. O formato mudou?"), { formato: true });
  const antes = estado.caixa || null, depois = {}, novas = [];
  for (const l of links) {
    const assinatura = await assinaturaCaixa(l.url);
    depois[l.url] = assinatura;
    // Primeira execução só guarda a assinatura; depois, link novo ou PDF republicado vira novidade.
    if (antes && assinatura && antes[l.url] !== assinatura) {
      const arquivo = l.url.split("/").pop();
      novas.push({ fonte: "CAIXA-SINAPI", titulo: `${antes[l.url] ? "CAIXA atualizou" : "CAIXA publicou"}: ${l.titulo} (${arquivo})`.slice(0, 500),
        // O link precisa ser único por versão: a data entra como âncora.
        link: `${l.url}#${encodeURIComponent(assinatura.split("|")[0] || new Date().toISOString().slice(0, 10))}`.slice(0, 600),
        publicado_em: assinatura.split("|")[0] ? new Date(assinatura.split("|")[0]).toISOString().slice(0, 10) : null,
        termos: termosDe(`${l.titulo} sinapi`), resumo: "Abra o PDF e confira o que mudou (encargos, desoneração, metodologia, retificação). Notas do SINAPI ficam acumuladas no mesmo arquivo." });
    }
  }
  return { novas, estado: { caixa: depois } };
}

// ---------- SEGES (gov.br/compras) ----------
// Página de INs: <a class="summary url" href="gov.br/compras/...">INSTRUÇÃO NORMATIVA ...; de decretos: link para o
// Planalto com o texto "DECRETO Nº ...". Só o que começa com o nome do ato (menu e rodapé ficam de fora).
function itensSeges(html) {
  const vistos = new Set();
  return [...String(html).matchAll(/<a\s[^>]*href="(https:\/\/(?:www\.gov\.br\/compras|www\.planalto\.gov\.br)\/[^"#]+)[^"]*"[^>]*>\s*((?:INSTRUÇÃO NORMATIVA|DECRETO|PORTARIA)[^<]{0,40}N[º°o][^<]{3,400})/g)]
    .map((m) => ({ link: m[1], titulo: m[2].replace(/\s+/g, " ").trim() }))
    .filter((i) => !vistos.has(i.link) && vistos.add(i.link));
}

async function vigiarSeges(estado) {
  const vistos = new Set(estado.seges || []), primeira = !estado.seges, corte = diasAtras(DIAS_INICIAIS), novas = [];
  for (const [fonte, url] of Object.entries(SEGES)) {
    const itens = itensSeges(await bp.buscarTexto(url));
    if (!itens.length) throw Object.assign(new Error(`${fonte}: a lista de ${url} veio vazia. O formato da página mudou?`), { formato: true });
    for (const i of itens) {
      if (vistos.has(i.link)) continue;
      vistos.add(i.link);
      const publicado = dataDe(i.titulo);
      if (primeira && !(publicado && publicado >= corte)) continue;
      novas.push({ fonte, titulo: i.titulo.slice(0, 500), link: i.link, publicado_em: publicado, termos: termosDe(i.titulo), resumo: "Norma nova do gov.br/compras (Lei 14.133). Confira se mexe em obra, preço de referência, BDI, reajuste ou julgamento." });
    }
  }
  return { novas, estado: { seges: [...vistos].slice(-2000) } };
}

async function gravarNovidades(novas) {
  if (!novas.length) return;
  await restFetch("orcamento_normas_novidades?on_conflict=link", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(novas),
  });
}

const FONTES = { TCU: vigiarTcu, "CAIXA-SINAPI": vigiarCaixa, SEGES: vigiarSeges };

async function main() {
  const estado = (await buscarBlob("dados_robo", CHAVE_ESTADO)) || {};
  estado.saude ||= {};
  const falhas = [];
  for (const [nome, vigiar] of Object.entries(FONTES)) {
    try {
      const r = await vigiar(estado);
      await gravarNovidades(r.novas);
      Object.assign(estado, r.estado);
      estado.saude[nome] = { saudeFonte: "ok", ultimoSucessoEm: new Date().toISOString(), ultimoErro: null, novidades: r.novas.length };
      console.log(`${nome}: ${r.novas.length} novidade(s) para revisar.`);
    } catch (e) {
      estado.saude[nome] = { ...(estado.saude[nome] || {}), saudeFonte: e.robots ? "robots" : e.formato ? "formato_mudou" : "indisponivel", ultimoErro: String(e.message).slice(0, 500) };
      console.error(`${nome}: ${e.message}`);
      falhas.push(nome);
    }
  }
  await salvarBlob("dados_robo", CHAVE_ESTADO, { ...estado, atualizadoEm: new Date().toISOString() });
  if (falhas.length) throw new Error(`Fontes com falha: ${falhas.join(", ")}.`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { termosDe, dataDe, novidadeTcu, linksCaixa, itensSeges };
