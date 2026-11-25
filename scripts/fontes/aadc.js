// Adaptador da Agência Amazonense de Desenvolvimento Cultural (AADC), primeiro da arquitetura de
// "fontes fora do PNCP" (contrato em scripts/fontes/README.md; quem roda é scripts/coletar_fontes_extras.js).
//
// Por que existe: a AADC (serviço social autônomo, regulamento de compras próprio) faz pregão PRESENCIAL e publica
// só no próprio site. Está cadastrada no PNCP (CNPJ 13.659.617/0001-65) mas, em 25/11/2026, sem nenhum edital lá.
//
// De onde vêm os dados (conferido em 25/11/2026, robots.txt liberando as duas páginas):
//   https://www.agenciacultural.org.br/licitacoes/ é só um iframe do SISTP (Diretório Digital):
//   1. GET  /client-page/aadc/licitacoes                    -> grade de subcategorias (= modalidades), links /subcategoria/{id}
//   2. GET  /transparencia/aadc/licitacoes/subcategoria/{id} -> _token CSRF, cookie de sessão e "var entity = '21'"
//   3. POST /transparencia/editions                          -> JSON do DataTables: { recordsFiltered, data: [publicação] }
//      publicação = { id, description, created_at, PDF (caminho no bucket), link, subcategory_id, name }
//   O PDF abre sem assinatura em https://space-dd1.sfo2.digitaloceanspaces.com/{PDF} (a tela usa link assinado de 1 h).
//   Cada linha é uma PUBLICAÇÃO (aviso, nova data, homologação...), não um processo: o adaptador agrupa por processo.
//   Data da sessão e modalidade exata só existem dentro do PDF; parte dos avisos é imagem escaneada (sem texto).
const { limparEspacos } = require("./comum");

const BASE = "https://transparencia.diretoriodigital.inf.br";
const SLUG = "aadc";
const URL_LISTA = `${BASE}/client-page/${SLUG}/licitacoes`;
const URL_PUBLICACOES = `${BASE}/transparencia/editions`;
const URL_ARQUIVOS = "https://space-dd1.sfo2.digitaloceanspaces.com/";
const urlSubcategoria = (id) => `${BASE}/transparencia/${SLUG}/licitacoes/subcategoria/${id}`;

const FONTE = {
  id: "aadc",
  nome: "AADC — Agência Amazonense de Desenvolvimento Cultural",
  portal: "Site da AADC",
  paginaOficial: "https://www.agenciacultural.org.br/licitacoes/",
};
const ORGAO = { nome: "AGENCIA AMAZONENSE DE DESENVOLVIMENTO CULTURAL", cnpj: "13659617000165", uf: "AM", municipio: "Manaus" };
// Sorteio público (escolha de comissão) e inexigibilidade (contratação direta) não são disputa aberta a fornecedor.
const SUBCATEGORIAS_IGNORADAS = /sorteio|inexigibilidade/i;
const POR_PAGINA = 100;

// Prefixo do número do processo na descrição ("PP 014/2026 - ...", "Credenciamento 01/2024 - ...").
const PROCESSO = /^\s*(PP|PE|CC|Preg[aã]o(?:\s+(?:Presencial|Eletr[oô]nico))?|Concorr[eê]ncia(?:\s+P[uú]blica)?|Convite|Credenciamento|Chamamento\s+P[uú]blico|Dispensa(?:\s+de\s+Licita[cç][aã]o)?|Tomada\s+de\s+Pre[cç]os)\s*(?:n[ºo°.]*\s*)?(\d{1,4})\s*\/\s*(\d{4})\s*[-–—_:]*\s*/i;
const COTACAO = /^\s*(?:aviso\s+de\s+)?convoca[cç][aã]o\s+para\s+cota[cç][aã]o\s*[-–—_:]*\s*/i;
// Publicação que só informa resultado ou fim do processo: não é oportunidade (e encerra o processo, se for a mais nova).
const RESULTADO_NO_INICIO = /^\s*(homologa|resultado|adjudica|recurso|contrarraz|ata\b|extrato|contrato|revoga|anula|cancela|julgamento|parecer|decis)/i;
const RESULTADO_APOS_TRACO = /[-–—]\s*(resultado|recurso|homologa\w*|adjudica\w*|julgamento|revoga\w*|anula\w*|cancela\w*)\b/i;

const SIGLAS = [
  [/^pp$|^preg[aã]o/i, "PP", "Pregão"], [/^pe$/i, "PE", "Pregão - Eletrônico"], [/^cc$|^concorr/i, "CC", "Concorrência"],
  [/^convite/i, "CONVITE", "Convite"], [/^credenc/i, "CRED", "Credenciamento"], [/^chamamento/i, "CHAM", "Chamamento público"],
  [/^dispensa/i, "DISP", "Dispensa"], [/^tomada/i, "TP", "Tomada de preços"],
];

const textoDoHtml = (html) => limparEspacos(String(html || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " "));

// Grade de subcategorias da página de licitações -> [{ id, nome }].
function subcategoriasDaPagina(html) {
  const saida = [];
  const re = /<a\s+href="[^"]*\/licitacoes\/subcategoria\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const alt = /alt="([^"]*)"/i.exec(m[2]);
    saida.push({ id: m[1], nome: limparEspacos(alt ? alt[1] : textoDoHtml(m[2])) });
  }
  return saida;
}

function sessaoDaPagina(html) {
  const token = /name="_token"\s+value="([^"]+)"/i.exec(html);
  const entidade = /var\s+entity\s*=\s*'(\d+)'/.exec(html);
  return token && entidade ? { token: token[1], entidade: entidade[1] } : null;
}

const ehResultado = (descricao, resto) => RESULTADO_NO_INICIO.test(descricao) || RESULTADO_NO_INICIO.test(resto) || RESULTADO_APOS_TRACO.test(descricao);

// Uma publicação -> de qual processo ela é, o objeto limpo e se é aviso (oportunidade) ou resultado.
function lerDescricao(descricao, publicacaoId, subcategoriaNome) {
  const texto = limparEspacos(descricao);
  const p = PROCESSO.exec(texto);
  if (p) {
    const [, rotulo, numero, ano] = p;
    const [, sigla, modalidade] = SIGLAS.find(([re]) => re.test(rotulo)) || [null, rotulo.toUpperCase(), subcategoriaNome];
    const num = String(Number(numero)).padStart(3, "0");
    const resto = texto.slice(p[0].length);
    return { idExterno: `${sigla}-${num}/${ano}`, processo: `${rotulo} ${numero}/${ano}`, numero: num, ano: Number(ano), modalidade, objeto: resto || texto, resultado: ehResultado(texto, resto) };
  }
  const c = COTACAO.exec(texto);
  const resto = c ? texto.slice(c[0].length) : texto;
  // Sem número de processo (cotação, aviso avulso): cada publicação é um item.
  return { idExterno: `PUB-${publicacaoId}`, processo: null, numero: null, ano: null, modalidade: c ? "Convocação para cotação (pesquisa de preços)" : subcategoriaNome, objeto: resto || texto, resultado: ehResultado(texto, resto) };
}

const urlArquivo = (caminho) => (caminho && /^[\w\-./]+\.\w{2,5}$/.test(caminho) && !caminho.includes("..") ? URL_ARQUIVOS + caminho : null);
const quando = (criadoEm) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(criadoEm || "") ? criadoEm.replace(" ", "T") : null);

// Publicações (já com a subcategoria) -> itens normalizados, um por processo. A publicação mais nova manda:
// se for resultado, o processo sai como encerrado (aberto: false) para o coletor tirar do painel.
function agruparPorProcesso(publicacoes) {
  const grupos = new Map();
  for (const pub of publicacoes) {
    const lida = lerDescricao(pub.description, pub.id, pub.subcategoria.nome);
    const publicacao = quando(pub.created_at);
    if (!publicacao) continue;
    const grupo = grupos.get(lida.idExterno) || [];
    grupo.push({ pub, lida, publicacao });
    grupos.set(lida.idExterno, grupo);
  }
  const itens = [];
  for (const [idExterno, grupo] of grupos) {
    grupo.sort((a, b) => b.publicacao.localeCompare(a.publicacao));
    const aviso = grupo.find((g) => !g.lida.resultado);
    const aberto = Boolean(aviso) && !grupo[0].lida.resultado;
    const base = aviso || grupo[0];
    itens.push({
      idExterno,
      aberto,
      objeto: base.lida.objeto,
      modalidade: base.lida.modalidade,
      processo: base.lida.processo,
      numero: base.lida.numero,
      ano: base.lida.ano,
      srp: /\bSRP\b|registro\s+de\s+pre[cç]o/i.test(base.lida.objeto),
      publicacao: base.publicacao,
      encerramento: null,
      orgao: ORGAO,
      linkOficial: urlSubcategoria(base.pub.subcategoria.id),
      linkEdital: urlArquivo(base.pub.PDF) || base.pub.link || null,
      // Muda quando sai publicação nova do processo: o coletor só relê o PDF nesse caso.
      versao: String(base.pub.id),
      anexos: grupo.map((g) => ({ nome: limparEspacos(g.pub.description).slice(0, 160), url: urlArquivo(g.pub.PDF) || g.pub.link || null, publicadoEm: g.publicacao })).filter((a) => a.url),
    });
  }
  return itens;
}

// "Data da Sessão: 13/11/2026 / Horário: 09:00 horas" ou "Data limite para envio ...: 26/11/2026 / Horário: 15:00".
const DATA_SESSAO = /(?:data\s+da\s+sess[aã]o|data\s+de\s+abertura|abertura\s+da\s+sess[aã]o|data\s+limite[^:\n]{0,80}|realiza[cç][aã]o\s+da\s+sess[aã]o)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})(?:[\s\S]{0,60}?hor[aá]rio\s*:?\s*(\d{1,2})\s*[:h]\s*(\d{2}))?/i;
function dataSessaoDoTexto(texto) {
  const m = DATA_SESSAO.exec(String(texto || ""));
  if (!m) return null;
  const [, d, mes, a, h = "00", min = "00"] = m;
  const data = new Date(Date.UTC(+a, +mes - 1, +d));
  if (data.getUTCDate() !== +d || +h > 23 || +min > 59) return null;
  return `${a}-${mes}-${d}T${h.padStart(2, "0")}:${min}:00`;
}
function modalidadeDoTexto(texto, atual) {
  if (/preg[aã]o\s+presencial/i.test(texto)) return "Pregão - Presencial";
  if (/preg[aã]o\s+eletr[oô]nico/i.test(texto)) return "Pregão - Eletrônico";
  return atual;
}

// ---- Contrato do adaptador ----

async function listar({ cliente, desdeIso, tempoRestanteMs = () => Infinity, maxPaginas = 5 }) {
  const subcategorias = subcategoriasDaPagina(await cliente.texto(URL_LISTA)).filter((s) => !SUBCATEGORIAS_IGNORADAS.test(s.nome));
  if (!subcategorias.length) throw new Error("AADC: nenhuma modalidade na página de licitações (a estrutura mudou?)");
  const sessao = sessaoDaPagina(await cliente.texto(urlSubcategoria(subcategorias[0].id)));
  if (!sessao) throw new Error("AADC: token da sessão não encontrado na página da modalidade (a estrutura mudou?)");

  const publicacoes = [];
  for (const sub of subcategorias) {
    for (let pagina = 0; pagina < maxPaginas && tempoRestanteMs() > 20000; pagina++) {
      const resp = await cliente.postForm(URL_PUBLICACOES, {
        draw: pagina + 1, start: pagina * POR_PAGINA, length: POR_PAGINA, _token: sessao.token,
        entity_id: sessao.entidade, subcategory_id: sub.id, data_ini: "", data_end: "", exercise_from: "", exercise_to: "",
      }, { "X-CSRF-TOKEN": sessao.token, "X-Requested-With": "XMLHttpRequest", Referer: urlSubcategoria(sub.id) });
      if (!resp || !Array.isArray(resp.data)) throw new Error(`AADC: resposta sem lista na modalidade ${sub.nome}`);
      publicacoes.push(...resp.data.map((p) => ({ ...p, subcategoria: sub })));
      const recentes = resp.data.filter((p) => (quando(p.created_at) || "") >= desdeIso);
      // A lista vem da mais nova para a mais antiga: página sem nada dentro da janela encerra a modalidade.
      if (recentes.length < resp.data.length || (pagina + 1) * POR_PAGINA >= Number(resp.recordsFiltered || 0)) break;
    }
  }
  return agruparPorProcesso(publicacoes.filter((p) => (quando(p.created_at) || "") >= desdeIso));
}

// Lê o PDF do aviso: data da sessão (ou prazo da cotação) e modalidade exata. PDF escaneado: marca e segue.
async function detalhe(item, { cliente, textoDoPdf }) {
  if (!item.linkEdital || !/\.pdf$/i.test(item.linkEdital)) return item;
  const texto = await textoDoPdf(await cliente.bytes(item.linkEdital));
  if (limparEspacos(texto).length < 50) return { ...item, pdfSemTexto: true };
  return { ...item, encerramento: dataSessaoDoTexto(texto) || item.encerramento, modalidade: modalidadeDoTexto(texto, item.modalidade), pdfSemTexto: false };
}

const anexos = (item) => item.anexos || [];

module.exports = {
  FONTE, ORGAO, listar, detalhe, anexos,
  // Peças puras, exportadas para o teste com a página salva (scripts/fontes/aadc.test.js).
  subcategoriasDaPagina, sessaoDaPagina, lerDescricao, agruparPorProcesso, dataSessaoDoTexto, modalidadeDoTexto,
};
