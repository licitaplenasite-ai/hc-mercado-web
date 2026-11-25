// Adaptador do Diário Oficial do Estado do Amazonas (DOE-AM, Imprensa Oficial do Estado).
// Quem roda: scripts/coletar_diarios_am.js.
//
// De onde vêm os dados (conferido em 25/11/2026; diario.imprensaoficial.am.gov.br, sem login nem captcha;
// o robots.txt responde 404, ou seja, sem restrição declarada):
//   GET /apifront/portal/edicoes/ultimas_edicoes.json      -> { itens: [{ id, data "dd/mm/aaaa", numero, tipo_edicao_nome, suplemento }] }
//       (em 25/11 a mais nova listada era a de 19/11: o portal publica com atraso, por isso a janela é de dias, não só hoje)
//   GET /portal/visualizacoes/view_html_diario/<id>        -> sumário em árvore (<span class="folder"> = órgão/seção,
//       <a class="linkMateria" identificador="N"> = matéria). Parte dos nomes vem com acento quebrado (UTF-8 lido como Latin-1).
//   GET /apifront/portal/edicoes/publicacoes_ver_conteudo/<identificador> -> HTML só da matéria.
//   Link público da matéria: /portal/visualizacoes/html/<id>/#e:<id>/m:<identificador> (a página abre a matéria pelo "m:").
// O DOE-AM também traz avisos de prefeituras (seção MUNICIPALIDADES > PREFEITURAS > <município>).
const { classificar, textoDoHtml, decodificarEntidades, corrigirMojibake, municipioNoTexto, TIPOS_OPORTUNIDADE } = require("./diario_extracao");
const { limparEspacos } = require("./comum");

const BASE = "https://diario.imprensaoficial.am.gov.br";
const FONTE = {
  id: "diario-doe-am",
  nome: "Diário Oficial do Estado do Amazonas (Imprensa Oficial)",
  rotulo: "DOE-AM",
  portal: "Diário Oficial do Estado do Amazonas",
  paginaOficial: `${BASE}/`,
};

// Pastas que são seção, não órgão: o órgão é a pasta mais funda que não está aqui.
const PASTA_GENERICA = /^(atos|outros|licita[cç][oõ]es|avisos?|extratos?( de contratos)?|portarias|termos aditivos|erratas|despachos|resolu[cç][oõ]es|notifica[cç][oõ]es|ordens de servi[cç]o|decretos.*|editais|contratos|atas|instru[cç][oõ]es normativas|administra[cç][aã]o (direta|indireta)|autarquias|funda[cç][oõ]es p[uú]blicas|secretarias de estado|poder (executivo|legislativo|judici[aá]rio)|municipalidades|prefeituras|c[aâ]maras municipais|publica[cç][oõ]es diversas|empresas privadas|hospitais|sociedade de economia mista|servi[cç]os sociais aut[oô]nomos|noticioso|governadoria)$/i;

// Sumário -> [{ identificador, titulo, pastas }].
function lerSumario(html) {
  const saida = [];
  const pilha = [];
  const re = /<li>\s*<span class="folder">([^<]*)<\/span>|identificador="(\d+)"[^>]*>([^<]*)<\/a>|<\/ul>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1] !== undefined) pilha.push(limparEspacos(corrigirMojibake(decodificarEntidades(m[1]))));
    else if (m[2]) saida.push({ identificador: m[2], titulo: limparEspacos(corrigirMojibake(decodificarEntidades(m[3]))).replace(/^#\d+\s*-\s*/, ""), pastas: [...pilha] });
    else pilha.pop();
  }
  return saida;
}

// Primeira linha do texto que nomeia o órgão ("PREFEITURA MUNICIPAL DE CAREIRO").
const ORGAO_NO_TEXTO = /^(PREFEITURA|C[AÂ]MARA\s+MUNICIPAL|MUNIC[IÍ]PIO\s+DE|SERVI[CÇ]O\s+AUT[OÔ]NOMO|SAAE|FUNDO\s+MUNICIPAL|INSTITUTO\s+MUNICIPAL|CONS[OÓ]RCIO)[^\n]{3,120}/im;

// Pastas (e, se elas não dizem, o começo do texto) -> órgão. Prefeitura também publica em
// "PUBLICAÇÕES DIVERSAS > Empresas Privadas" (visto em 18/11/2026: aviso da Prefeitura de Careiro).
function orgaoDasPastas(pastas, texto = "") {
  const i = pastas.findIndex((p) => /^prefeituras$/i.test(p));
  if (i >= 0 && pastas[i + 1]) return { nome: `Prefeitura Municipal de ${pastas[i + 1]}`, municipio: municipioNoTexto(pastas[i + 1]) || pastas[i + 1], esfera: "M" };
  if (!pastas.some((p) => /^publica[cç][oõ]es diversas$|^municipalidades$/i.test(p))) {
    const nome = [...pastas].reverse().find((p) => !PASTA_GENERICA.test(p)) || "Governo do Estado do Amazonas";
    return { nome, municipio: null, esfera: "E" };
  }
  const linha = ORGAO_NO_TEXTO.exec(texto);
  const municipio = municipioNoTexto(linha ? linha[0] : String(texto).slice(0, 300));
  return { nome: linha ? limparEspacos(linha[0]) : "Publicação diversa no DOE-AM", municipio, esfera: municipio ? "M" : null };
}

const dataIso = (br) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// ctx: { cliente, desde, ate, lidos (Set de ids de edição já lidas), tempoRestanteMs }.
async function listar(ctx) {
  const { itens = [] } = await ctx.cliente.json(`${BASE}/apifront/portal/edicoes/ultimas_edicoes.json`);
  const edicoes = itens.map((e) => ({ ...e, dia: dataIso(e.data) })).filter((e) => e.dia && e.dia >= ctx.desde && e.dia <= ctx.ate && !ctx.lidos.has(String(e.id)));
  const publicacoes = [];
  const lidas = [];
  for (const ed of edicoes) {
    if (ctx.tempoRestanteMs() < 60000) break;
    const materias = lerSumario(await ctx.cliente.texto(`${BASE}/portal/visualizacoes/view_html_diario/${ed.id}`));
    let completa = true;
    for (const mat of materias) {
      // O CSC (central de compras do Estado) publica vários avisos numa "RESENHA" dentro da pasta Licitações.
      const tipo = classificar(mat.titulo) || (/licita/i.test(mat.pastas.join(" ")) && /resenha|aviso/i.test(mat.titulo) ? "aviso" : null);
      if (!tipo) continue;
      const orgao = orgaoDasPastas(mat.pastas);
      const base = {
        idExterno: mat.identificador, titulo: mat.titulo, tipo, publicacao: ed.dia, edicao: String(ed.numero), pagina: null,
        orgao: { nome: orgao.nome, municipio: orgao.municipio, uf: "AM", esfera: orgao.esfera },
        linkOficial: `${BASE}/portal/visualizacoes/html/${ed.id}/#e:${ed.id}/m:${mat.identificador}`,
        linkEdicao: `${BASE}/portal/edicoes/download/${ed.id}`,
        texto: null,
      };
      if (!TIPOS_OPORTUNIDADE.has(tipo)) { publicacoes.push(base); continue; }
      if (ctx.tempoRestanteMs() < 30000) { completa = false; break; }
      try {
        const texto = textoDoHtml(await ctx.cliente.texto(`${BASE}/apifront/portal/edicoes/publicacoes_ver_conteudo/${mat.identificador}`));
        const doTexto = orgaoDasPastas(mat.pastas, texto);
        // Órgão estadual sem município no texto: Manaus (sede). Para o dedup do estadual vale o nome, não o município.
        publicacoes.push({ ...base, texto, orgao: { nome: doTexto.nome, municipio: doTexto.municipio || municipioNoTexto(texto.slice(0, 400)) || "Manaus", uf: "AM", esfera: doTexto.esfera } });
      } catch (e) {
        completa = false;
        console.log(`[${FONTE.id}] Matéria ${mat.identificador} não abriu (${e.message}); a edição será relida.`);
      }
    }
    if (completa) lidas.push(String(ed.id));
  }
  return { publicacoes, lidas };
}

module.exports = { FONTE, listar, lerSumario, orgaoDasPastas };
