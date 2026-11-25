// Adaptador da BLL Compras (Bolsa de Licitações e Leilões), contrato em scripts/fontes/README.md. Portal
// privado usado por prefeituras, Sistema S, fundações de apoio e associações; aqui entram só os promotores
// do AM que compram por regulamento próprio (fora da Lei 14.133, logo fora do PNCP).
//
// De onde vêm os dados (conferido em 25/11/2026):
//   1. GET https://bllcompras.com/Process/ProcessSearchPublic?param1=1
//      Vitrine pública, sem login: os 100 processos mais novos em "Recepção de propostas", do Brasil todo
//      (em 24/11/2026 cobriam ~11 h de publicação). Colunas: promotor, nº, modalidade, cidade-UF, situação,
//      publicação, disputa, e o link "/Process/ProcessView?param1=...".
//   2. GET do link do processo (público): objeto, regulamento, fim do recebimento de propostas, início da disputa.
//   A busca com filtro (UF, datas, páginas seguintes) exige reCAPTCHA: NÃO é usada. Por isso a cobertura é só
//   o que estiver na vitrine em cada rodada (o workflow roda a cada ~6 h).
// Fora daqui de propósito:
//   - Processo pela Lei 14.133: o órgão é obrigado a publicar no PNCP e o robô do PNCP já traz.
//   - FAEPI: vem do site dela (faepi.js), com o edital em PDF.
//   - Condutor, autoridade, telefone e e-mail do processo: não são lidos.
// shortcut: a vitrine não tem CNPJ; a duplicata com o PNCP é evitada pelo regulamento. Se a BLL abrir uma API, trocar.
const { textoDoHtml, decodificar, dataBr } = require("./html_texto");

const BASE = "https://bllcompras.com";
const URL_VITRINE = `${BASE}/Process/ProcessSearchPublic?param1=1`;
const FONTE = { id: "bll", nome: "BLL Compras — processos do AM fora do PNCP", portal: "BLL Compras", paginaOficial: "https://bll.org.br/" };
const ORGAO = { nome: "Vários (promotor de cada processo)", uf: "AM" };
const UFS = new Set(["AM"]);
const PROMOTOR_COBERTO_EM_OUTRA_FONTE = /FAEPI|INTERIORIZA[CÇ][AÃ]O DO IFAM/i;
const REGULAMENTO_PNCP = /14\.133/;
const SITUACOES_ABERTAS = /RECEP[CÇ][AÃ]O DE PROPOSTAS|PUBLICADO|AGUARDANDO DISPUTA/i;

const slug = (txt) => String(txt).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// Vitrine -> [{ promotor, numero, modalidade, municipio, uf, situacao, publicacao, disputa, link }].
function linhasDaVitrine(html) {
  const i = String(html).indexOf('id="tableProcessDataBody"');
  if (i < 0) return null;
  const corpo = html.slice(i, html.indexOf("</tbody>", i));
  const saida = [];
  for (const [, tr] of corpo.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const link = /href="(\/Process\/ProcessView\?param1=[^"]+)"/.exec(tr);
    if (tds.length < 8 || !link) continue;
    const [cidade, uf] = textoDoHtml(tds[4]).split(/-(?=[A-Z]{2}$)/);
    saida.push({
      promotor: textoDoHtml(tds[1]), numero: textoDoHtml(tds[2]), modalidade: textoDoHtml(tds[3]),
      municipio: cidade || "", uf: uf || "", situacao: textoDoHtml(tds[5]),
      publicacao: dataBr(textoDoHtml(tds[6])), disputa: dataBr(textoDoHtml(tds[7])), link: BASE + decodificar(link[1]),
    });
  }
  return saida;
}

// Página do processo -> { objeto, regulamento, fimPropostas, inicioDisputa, publicacao }.
function lerProcesso(html) {
  const valor = (id) => {
    const m = new RegExp(`id="${id}"[^>]*value="([^"]*)"`).exec(html);
    return m ? textoDoHtml(m[1]) : "";
  };
  const objeto = /id="ProductOrService"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
  return {
    objeto: objeto ? textoDoHtml(objeto[1]) : "",
    regulamento: valor("Regulation"),
    fimPropostas: dataBr(valor("ProposalAnalysisStart")),
    inicioDisputa: dataBr(valor("DisputeStart")),
    publicacao: dataBr(valor("PublicationTime")),
  };
}

function idDaLinha(l) {
  return `${slug(l.promotor)}-${slug(l.numero)}`;
}

function itemDaLinha(l, proc) {
  const n = /^0*(\d+)\s*\/\s*(\d{4})$/.exec(l.numero);
  return {
    idExterno: idDaLinha(l),
    aberto: SITUACOES_ABERTAS.test(l.situacao),
    objeto: proc.objeto,
    modalidade: l.modalidade,
    numero: n ? n[1].padStart(3, "0") : l.numero,
    ano: n ? Number(n[2]) : null,
    srp: /registro\s+de\s+pre[cç]o/i.test(proc.objeto),
    publicacao: proc.publicacao || l.publicacao,
    encerramento: proc.inicioDisputa || l.disputa,
    orgao: { nome: l.promotor, cnpj: null, uf: l.uf, municipio: l.municipio },
    linkOficial: l.link,
    linkEdital: null,
    versao: `${l.situacao}|${l.publicacao}`,
    regulamento: proc.regulamento,
  };
}

// Linhas fora do alvo voltam com aberto: false (só para a chave); assim "publicadas" mede a vitrine lida
// e o robô não acusa estrutura mudada numa rodada normal sem processo do AM.
const fechado = (l) => ({ idExterno: idDaLinha(l), aberto: false });

async function listar({ cliente, desdeIso, tempoRestanteMs = () => Infinity }) {
  const linhas = linhasDaVitrine(await cliente.texto(URL_VITRINE));
  if (!linhas) throw new Error("BLL: tabela da vitrine pública não encontrada (a estrutura mudou?)");
  const itens = [];
  for (const l of linhas) {
    const alvo = UFS.has(l.uf) && !PROMOTOR_COBERTO_EM_OUTRA_FONTE.test(l.promotor) && (l.publicacao || "") >= desdeIso;
    if (!alvo) { itens.push(fechado(l)); continue; }
    // Sem tempo: não devolve nada (devolver "fechado" apagaria do banco um processo ainda aberto).
    if (tempoRestanteMs() < 20000) continue;
    const proc = lerProcesso(await cliente.texto(l.link));
    if (!proc.objeto || REGULAMENTO_PNCP.test(proc.regulamento)) { itens.push(fechado(l)); continue; }
    itens.push(itemDaLinha(l, proc));
  }
  return itens;
}

const detalhe = async (item) => item;
const anexos = () => [];

module.exports = { FONTE, ORGAO, listar, detalhe, anexos, linhasDaVitrine, lerProcesso, itemDaLinha, idDaLinha };
