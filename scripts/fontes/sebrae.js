// Adaptador do Canal do Fornecedor do Sistema SEBRAE (SCF), contrato em scripts/fontes/README.md. O SEBRAE é
// serviço social autônomo (Sistema S): compra pelo regulamento próprio (Resolução CDN 439/2023) e não publica
// no PNCP. Um portal só cobre as 27 unidades estaduais e o SEBRAE Nacional; entram todas as UFs (o painel e o
// boletim já filtram pela UF de cada cliente), o pedido é o mesmo.
//
// De onde vêm os dados (conferido em 25/11/2026; robots.txt "Allow: /", Content-Signal search=yes, use=reference —
// o LicitaPlena mostra o resumo e manda o fornecedor para a página oficial):
//   1. GET  https://www.scf3.sebrae.com.br/PortalCf/Licitacoes          -> formulário com __RequestVerificationToken e cookie
//   2. POST https://www.scf3.sebrae.com.br/PortalCf/Licitacoes/Filter   -> { success, aData: [licitação] }, situação "Em Andamento"
//   Página pública de cada licitação: /PortalCf/Licitacoes/Detalhe/{Id}. "Local" diz onde é a disputa (ex.: licitanet).
const { textoDoHtml, decodificar, dataBr, agoraBrasilia } = require("./html_texto");

const BASE = "https://www.scf3.sebrae.com.br/PortalCf";
const FONTE = { id: "sebrae", nome: "SEBRAE — Canal do Fornecedor (todas as UFs)", portal: "Canal do Fornecedor SEBRAE", paginaOficial: `${BASE}/Licitacoes` };
const ORGAO = { nome: "SEBRAE (unidade de cada licitação)" };
const STATUS_EM_ANDAMENTO = "5";
const UF_POR_UNIDADE = {
  ACRE: "AC", ALAGOAS: "AL", AMAPA: "AP", AMAZONAS: "AM", BAHIA: "BA", CEARA: "CE", "DISTRITO FEDERAL": "DF", NACIONAL: "DF",
  "ESPIRITO SANTO": "ES", GOIAS: "GO", MARANHAO: "MA", "MATO GROSSO DO SUL": "MS", "MATO GROSSO": "MT", "MINAS GERAIS": "MG",
  PARA: "PA", PARAIBA: "PB", PARANA: "PR", PERNAMBUCO: "PE", PIAUI: "PI", "RIO DE JANEIRO": "RJ", "RIO GRANDE DO NORTE": "RN",
  "RIO GRANDE DO SUL": "RS", RONDONIA: "RO", RORAIMA: "RR", "SANTA CATARINA": "SC", "SAO PAULO": "SP", SERGIPE: "SE", TOCANTINS: "TO",
};
const semAcento = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

// "SEBRAE MATO GROSSO DO SUL" -> "MS"; unidade desconhecida -> null (o item fica fechado, fora do painel).
function ufDaUnidade(unidade) {
  const nome = semAcento(unidade).replace(/^SEBRAE\s*/, "");
  return UF_POR_UNIDADE[nome] || null;
}

// Campos do formulário de filtro, como o navegador manda (token anti-CSRF incluso); situação "Em Andamento".
function camposDoFormulario(html) {
  const ini = String(html).indexOf('id="formFilterLicitacao"');
  if (ini < 0) return null;
  const form = html.slice(ini, html.indexOf("</form>", ini));
  const campos = {};
  for (const [tag] of form.matchAll(/<input[^>]*>/g)) {
    const nome = /name="([^"]+)"/.exec(tag);
    if (nome) campos[nome[1]] = decodificar((/value="([^"]*)"/.exec(tag) || [])[1] || "");
  }
  for (const [, nome, corpo] of form.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    campos[nome] = (/<option[^>]*selected[^>]*value="([^"]*)"/.exec(corpo) || [])[1] || "";
  }
  if (!campos.__RequestVerificationToken) return null;
  return { ...campos, StatusId: STATUS_EM_ANDAMENTO };
}

// "PE/037-SEBRAE-AM-2026" -> { numero: "037", ano: 2026 }.
function numeroDaLicitacao(numero) {
  const m = /^[A-Z]+\/0*(\d+)-.*-(\d{4})$/i.exec(String(numero || "").trim());
  return m ? { numero: m[1].padStart(3, "0"), ano: Number(m[2]) } : null;
}

// "www.licitanet.com.br" ou "https://..." -> URL do local da disputa; sala física ou reunião -> null.
function urlDoLocal(local) {
  const m = /\b(https?:\/\/[^\s,;]+|www\.[a-z0-9.-]+\.[a-z]{2,}[^\s,;]*)/i.exec(String(local || ""));
  if (!m || /teams\.microsoft|meet\.google|zoom\.us/i.test(m[1])) return null;
  return m[1].startsWith("http") ? m[1] : `https://${m[1]}`;
}

// Uma licitação do JSON -> item normalizado. Aberta = em andamento e com abertura ainda por vir
// (credenciamento fica aberto enquanto estiver em andamento: a inscrição é contínua).
function itemDaLicitacao(l, agoraIso = agoraBrasilia()) {
  const uf = ufDaUnidade(l.ZSebrae && l.ZSebrae.Descricao);
  const modalidade = (l.LicitacaoModalidade && l.LicitacaoModalidade.Descricao) || "";
  const abertura = dataBr(l.DataHoraAberturaNotAsString);
  const num = numeroDaLicitacao(l.Numero);
  const emAndamento = /andamento/i.test(l.StatusDescricao || "");
  const detalhe = `${BASE}/Licitacoes/Detalhe/${Number(l.Id)}`;
  return {
    idExterno: String(l.Numero || `ID-${l.Id}`).trim(),
    aberto: Boolean(uf) && emAndamento && (/credenciamento/i.test(modalidade) || !abertura || abertura >= agoraIso),
    objeto: textoDoHtml(l.Objeto),
    modalidade,
    processo: l.NumeroProcesso || null,
    numero: num ? num.numero : null,
    ano: num ? num.ano : null,
    srp: /R\.?\s*Pre[cç]os|registro\s+de\s+pre[cç]o/i.test(`${modalidade} ${l.Objeto}`),
    publicacao: dataBr(l.DataPublicacaoString),
    encerramento: abertura,
    orgao: { nome: textoDoHtml(l.ZSebrae && l.ZSebrae.Descricao), cnpj: null, uf: uf || "", municipio: "" },
    linkOficial: urlDoLocal(l.Local) || detalhe,
    linkEdital: detalhe,
    versao: `${l.StatusDescricao}|${l.DataHoraAberturaNotAsString}|${l.DataEncerramentoString}`,
  };
}

async function listar({ cliente, desdeIso }) {
  const campos = camposDoFormulario(await cliente.texto(`${BASE}/Licitacoes`));
  if (!campos) throw new Error("SEBRAE: formulário de filtro sem token (a estrutura mudou?)");
  const resp = await cliente.postForm(`${BASE}/Licitacoes/Filter`, campos, { "X-Requested-With": "XMLHttpRequest", Referer: `${BASE}/Licitacoes` });
  if (!resp || resp.success !== true || !Array.isArray(resp.aData)) throw new Error(`SEBRAE: filtro sem lista (${(resp && resp.aErro) || "resposta inesperada"})`);
  return resp.aData.map((l) => itemDaLicitacao(l)).filter((i) => (i.publicacao || "") >= desdeIso);
}

const detalhe = async (item) => item;
const anexos = () => [];

module.exports = { FONTE, ORGAO, listar, detalhe, anexos, ufDaUnidade, camposDoFormulario, numeroDaLicitacao, urlDoLocal, itemDaLicitacao };
