// Adaptador do Diário Oficial da União, Seção 3 (avisos de licitação, editais, resultados), via INLABS da
// Imprensa Nacional. Contrato de adaptador: scripts/fontes/README.md; quem roda é scripts/coletar_diarios_oficiais.js.
//
// Por que INLABS (avaliado em 25/11/2026):
//   - É a via oficial de download automático: https://github.com/Imprensa-Nacional/inlabs publica os scripts de
//     login + download. XML integral de cada matéria, grátis desde 2020, últimos 4 meses. Exige cadastro gratuito.
//   - www.in.gov.br (leiturajornal, página de cada ato) tem robots.txt "Disallow: /": robô não deve ler lá.
//   - Dados abertos mensais do DOU (in.gov.br/acesso-a-informacao/dados-abertos) saem só depois do fim do mês.
//
// Fluxo: POST /logar.php (email + password, cabeçalho "origem") -> cookie inlabs_session_cookie;
//        GET /index.php?p=AAAA-MM-DD&dl=AAAA-MM-DD-DO3.zip (e DO3E, edição extra) -> zip com um XML por matéria.
//        Dia sem edição (fim de semana, feriado) responde 404.
// Formato do XML conferido no repositório oficial e em leitores públicos; a fixture segue esse formato.
// shortcut: o atributo exato do link de cada matéria só será confirmado no primeiro zip real (INLABS em manutenção
// em 25/11/2026); se o zip trouxer outro nome, ajustar artigosDoXml().
const AdmZip = require("adm-zip");
const { limparEspacos } = require("./comum");
const T = require("./avisos_texto");

const BASE = "https://inlabs.in.gov.br";
// Valor fixo usado pelos scripts oficiais do INLABS (identifica download automatizado).
const ORIGEM = "736372697074";
const SECOES = ["DO3", "DO3E"];
const LIMITE_ZIP_BYTES = 200 * 1024 * 1024;

const FONTE = {
  id: "dou",
  nome: "Diário Oficial da União — Seção 3",
  portal: "Diário Oficial da União",
  rotulo: "Diário Oficial da União",
  paginaOficial: "https://www.in.gov.br/leiturajornal?secao=do3",
};

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodificar(txt) {
  return String(txt || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (t, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (t, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (t, n) => ENTIDADES[n]);
}
const semTags = (html) => limparEspacos(decodificar(html).replace(/<\/(p|div|br|tr|li|h\d)>/gi, " \n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));

function atributos(abertura) {
  const saida = {};
  const re = /([\w:-]+)="([^"]*)"/g;
  for (let m = re.exec(abertura); m; m = re.exec(abertura)) saida[m[1]] = decodificar(m[2]);
  return saida;
}
const campo = (xml, nome) => {
  const m = new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`, "i").exec(xml);
  return m ? m[1] : "";
};

// XML de uma matéria do INLABS -> [{ id, titulo, tipo, categoria, data, link, texto }].
function artigosDoXml(bruto) {
  const saida = [];
  const xml = String(bruto).replace(/<!--[\s\S]*?-->/g, "");
  const re = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const a = atributos(m[1]);
    const [d, mes, ano] = String(a.pubDate || "").split("/");
    saida.push({
      id: a.idMateria || a.id,
      secao: a.pubName || "",
      titulo: semTags(campo(m[2], "Identifica")) || a.name || "",
      tipo: a.artType || "",
      categoria: a.artCategory || "",
      data: ano && mes && d ? `${ano}-${mes}-${d}` : null,
      link: a.pdfPage || null,
      texto: semTags(campo(m[2], "Texto")),
    });
  }
  return saida;
}

// "Prefeituras/Estado do Tocantins/Prefeitura Municipal de Sucupira" -> órgão, UF e município.
function orgaoDoArtigo(art) {
  const partes = art.categoria.split("/").map(limparEspacos).filter(Boolean);
  const nome = partes[partes.length - 1] || "Órgão não informado";
  if (/^(prefeituras|governo do estado)$/i.test(partes[0] || "")) {
    const uf = T.ufDoNomeDoEstado(partes[1]);
    const municipal = /^prefeituras$/i.test(partes[0]);
    return { nome, uf, municipio: municipal ? T.nomeDeCidade(nome) : "" };
  }
  const local = T.cidadeUfNoTexto(art.texto);
  return { nome: partes.length > 1 ? `${partes[partes.length - 1]} (${partes[0]})` : nome, uf: local ? local.uf : null, municipio: local ? local.municipio : "" };
}

// Matéria -> itens no contrato do adaptador (uma matéria "AVISOS DE LICITAÇÃO" pode trazer vários avisos).
function itensDoArtigo(art, hojeIso) {
  const tipo = T.classificar(`${art.titulo} ${art.tipo}`, art.texto);
  if (tipo === "ignorar") return [];
  const orgao = orgaoDoArtigo(art);
  const avisos = T.avisosDoTexto(art.texto, art.data);
  return avisos.map((av, i) => ({
    idExterno: avisos.length > 1 ? `${art.id}-${i + 1}` : String(art.id),
    tipo,
    aberto: tipo === "oportunidade" && (!av.encerramento || av.encerramento.slice(0, 10) >= hojeIso),
    objeto: av.objeto || limparEspacos(art.texto).slice(0, 300),
    orgao,
    uasg: av.uasg,
    modalidade: av.modalidade,
    numero: av.numero,
    ano: av.ano,
    publicacao: art.data,
    encerramento: av.encerramento,
    linkOficial: art.link || FONTE.paginaOficial,
    linkEdital: art.link || null,
    versao: String(art.id),
    trecho: av.trecho,
    titulo: art.titulo,
    precisaIa: !av.objeto || !av.encerramento,
  }));
}

// Lê um zip do INLABS (Buffer) -> matérias da Seção 3.
function artigosDoZip(bytes) {
  const zip = new AdmZip(bytes);
  return zip.getEntries().filter((e) => /\.xml$/i.test(e.entryName)).flatMap((e) => artigosDoXml(e.getData().toString("utf8")));
}

async function entrar(fetchImpl, email, senha) {
  const resp = await fetchImpl(`${BASE}/logar.php`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", origem: ORIGEM },
    body: new URLSearchParams({ email, password: senha }),
    signal: globalThis.AbortSignal.timeout(30000),
  });
  const brutos = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
  const cookie = brutos.map((c) => c.split(";")[0]).find((c) => c.startsWith("inlabs_session_cookie="));
  if (!cookie) throw new Error(`INLABS recusou o login (HTTP ${resp.status}). Conferir INLABS_EMAIL/INLABS_SENHA ou se o INLABS está em manutenção.`);
  return cookie;
}

async function baixarZip(fetchImpl, cookie, diaIso, secao) {
  const resp = await fetchImpl(`${BASE}/index.php?p=${diaIso}&dl=${diaIso}-${secao}.zip`, {
    headers: { Cookie: cookie, origem: ORIGEM },
    signal: globalThis.AbortSignal.timeout(120000),
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`INLABS respondeu HTTP ${resp.status} para ${diaIso}-${secao}.zip`);
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (bytes.length > LIMITE_ZIP_BYTES) throw new Error(`zip ${diaIso}-${secao} maior que ${LIMITE_ZIP_BYTES} bytes`);
  // Sessão vencida ou manutenção devolvem página HTML com 200.
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") return null;
  return bytes;
}

// ---- Contrato do adaptador ----
// ctx: { dias: ["AAAA-MM-DD"...], hojeIso, relatorio, fetchImpl?, arquivoLocal? (zip ou xml, para teste sem conta) }
async function listar(ctx) {
  const fetchImpl = ctx.fetchImpl || fetch;
  let artigos = [];
  if (ctx.arquivoLocal) {
    const fs = require("node:fs");
    const bytes = fs.readFileSync(ctx.arquivoLocal);
    artigos = /\.zip$/i.test(ctx.arquivoLocal) ? artigosDoZip(bytes) : artigosDoXml(bytes.toString("utf8"));
  } else {
    const email = process.env.INLABS_EMAIL;
    const senha = process.env.INLABS_SENHA;
    if (!email || !senha) {
      const e = new Error("INLABS_EMAIL e INLABS_SENHA não configurados (cadastro grátis em https://inlabs.in.gov.br; no GitHub: Settings > Secrets and variables > Actions).");
      e.semCadastro = true;
      throw e;
    }
    const cookie = await entrar(fetchImpl, email, senha);
    for (const dia of ctx.dias) {
      for (const secao of SECOES) {
        const bytes = await baixarZip(fetchImpl, cookie, dia, secao);
        if (bytes) artigos.push(...artigosDoZip(bytes));
      }
    }
  }
  const secao3 = artigos.filter((a) => /^DO3/i.test(a.secao || "DO3"));
  if (ctx.relatorio) ctx.relatorio.atosLidos = secao3.length;
  return secao3.flatMap((a) => itensDoArtigo(a, ctx.hojeIso));
}

module.exports = { FONTE, listar, artigosDoXml, artigosDoZip, itensDoArtigo, orgaoDoArtigo };
