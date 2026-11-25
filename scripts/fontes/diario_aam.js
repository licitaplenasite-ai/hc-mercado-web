// Adaptador do Diário Oficial dos Municípios do Amazonas (AAM), plataforma SIGPub (Vox Tecnologia).
// Quem roda: scripts/coletar_diarios_am.js. A mesma plataforma serve outras associações (/agm, /ama, /bahia...):
// trocar SLUG cobre outra UF sem código novo.
//
// De onde vêm os dados (conferido em 25/11/2026; robots.txt de diariomunicipal.com.br libera tudo, sem login nem captcha):
//   GET /aam/pesquisar?busca_avancada[titulo]=<termo>&busca_avancada[dataInicio]=AAAA-MM-DD&busca_avancada[dataFim]=...
//       &busca_avancada[pagina]=N  -> HTML com cartões <li class="materia-card"> (25 por página): título, entidade,
//       órgão, data de circulação, edição e código identificador (8 hex).
//       A busca por título casa palavra inteira SEM acento ("licitacao", "pregao"); "licitação" e "preg" voltam vazio.
//       Sem termo nenhum a busca não devolve nada, por isso vários termos (o mesmo cartão vem em mais de um termo).
//   GET /aam/download/materia/<código> -> HTML só da matéria (texto do aviso). Link público: /aam/materia/<código>.
//   GET /aam/download/edicao/<código>  -> PDF assinado da edição inteira (não usado: a matéria em HTML já basta).
const { classificar, textoDoHtml, decodificarEntidades, municipioNoTexto, TIPOS_OPORTUNIDADE } = require("./diario_extracao");
const { limparEspacos } = require("./comum");

const SLUG = "aam";
const BASE = "https://www.diariomunicipal.com.br";
const TERMOS = ["aviso", "licitacao", "pregao", "dispensa", "inexigibilidade", "chamamento", "concorrencia", "cotacao", "edital", "credenciamento", "homologacao", "adjudicacao", "resultado", "extrato"];
const POR_PAGINA = 25;
const MAX_PAGINAS_TERMO = 8;

const FONTE = {
  id: "diario-aam",
  nome: "Diário Oficial dos Municípios do Amazonas (AAM)",
  rotulo: "Diário AAM",
  portal: "Diário Oficial dos Municípios do Amazonas (AAM)",
  paginaOficial: `${BASE}/${SLUG}/`,
};

function urlBusca(termo, desde, ate, pagina) {
  const p = new URLSearchParams({
    "busca_avancada[titulo]": termo, "busca_avancada[dataInicio]": desde, "busca_avancada[dataFim]": ate,
    "busca_avancada[ordenacao]": "recente", "busca_avancada[pagina]": String(pagina),
  });
  return `${BASE}/${SLUG}/pesquisar?${p}`;
}

const dataBr = (txt) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const campo = (html, classe) => {
  const m = new RegExp(`class="${classe}"[^>]*>([\\s\\S]*?)</`, "i").exec(html);
  return m ? limparEspacos(decodificarEntidades(m[1].replace(/<[^>]+>/g, " "))) : "";
};

// HTML da busca -> { cartoes, total }.
function lerBusca(html) {
  const total = /de\s*<strong>\s*(\d+)\s*<\/strong>\s*mat/i.exec(html);
  const cartoes = [];
  for (const parte of String(html).split(/<li class="materia-card">/).slice(1)) {
    const codigo = /\/materia\/([0-9A-F]{6,12})"/i.exec(parte);
    const titulo = /class="materia-card__titulo">\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(parte);
    const dds = [...parte.matchAll(/<dd>([\s\S]*?)<\/dd>/gi)].map((m) => limparEspacos(m[1].replace(/<[^>]+>/g, " ")));
    if (!codigo || !titulo) continue;
    cartoes.push({
      codigo: codigo[1].toUpperCase(),
      titulo: limparEspacos(decodificarEntidades(titulo[1].replace(/<[^>]+>/g, " "))),
      entidade: campo(parte, "materia-card__entidade"),
      orgaoInterno: campo(parte, "materia-card__orgao"),
      publicacao: dataBr(dds[0]),
      edicao: dds[1] || null,
    });
  }
  return { cartoes, total: total ? Number(total[1]) : cartoes.length };
}

// ctx: { cliente, desde, ate, lidos (Set de códigos já lidos), tempoRestanteMs }.
async function listar(ctx) {
  const porCodigo = new Map();
  for (const termo of TERMOS) {
    for (let pagina = 1; pagina <= MAX_PAGINAS_TERMO; pagina++) {
      if (ctx.tempoRestanteMs() < 60000) break;
      const { cartoes, total } = lerBusca(await ctx.cliente.texto(urlBusca(termo, ctx.desde, ctx.ate, pagina)));
      for (const c of cartoes) porCodigo.set(c.codigo, c);
      if (pagina * POR_PAGINA >= total || !cartoes.length) break;
    }
  }
  const publicacoes = [];
  const lidas = [];
  for (const c of porCodigo.values()) {
    const tipo = classificar(c.titulo);
    if (!tipo) continue;
    const base = {
      idExterno: c.codigo, titulo: c.titulo, tipo, publicacao: c.publicacao, edicao: c.edicao, pagina: null,
      orgao: { nome: c.entidade || "Município do Amazonas", municipio: municipioNoTexto(c.entidade), uf: "AM", esfera: "M", setor: c.orgaoInterno },
      linkOficial: `${BASE}/${SLUG}/materia/${c.codigo}`,
      linkEdicao: `${BASE}/${SLUG}/download/edicao/${c.codigo}`,
      texto: null,
    };
    // Só a oportunidade precisa do texto; resultado/extrato basta o título (fecha o aviso pelo número).
    if (!TIPOS_OPORTUNIDADE.has(tipo) || ctx.lidos.has(c.codigo)) { publicacoes.push({ ...base, jaLida: ctx.lidos.has(c.codigo) }); continue; }
    if (ctx.tempoRestanteMs() < 30000) break;
    try {
      // O rodapé ("Publicado por: <nome do servidor>", código, edição) não é do aviso: fica fora do texto (LGPD e tokens da IA).
      const texto = textoDoHtml(await ctx.cliente.texto(`${BASE}/${SLUG}/download/materia/${c.codigo}`)).split(/\nPublicado por:/)[0];
      publicacoes.push({ ...base, texto });
      lidas.push(c.codigo);
    } catch (e) {
      console.log(`[${FONTE.id}] Matéria ${c.codigo} não abriu (${e.message}); fica para a próxima rodada.`);
    }
  }
  return { publicacoes, lidas };
}

module.exports = { FONTE, listar, lerBusca, urlBusca };
