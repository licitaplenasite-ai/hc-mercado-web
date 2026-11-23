// Monta a pasta publico/ que o Cloudflare Pages publica.
//
// Por quê: publicar a raiz do repositório subiria node_modules, scripts, supabase e .github, e o
// Pages tem limite de 20.000 arquivos por deploy. Aqui entra só o que o site realmente serve:
// as páginas HTML, os JS/imagens da raiz referenciados por elas, os dados públicos e o _headers.
// O Netlify continua publicando a raiz ("publish = .") e não usa este script.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RAIZ = path.join(__dirname, "..");
const DESTINO = path.join(RAIZ, "publico");
// Pastas das páginas públicas de SEO geradas por scripts/gerar_site_publico.js.
const PASTAS_DO_SITE = ["blog", "ferramentas", "para"];

// Arquivos da raiz que nunca são servidos (configuração de ferramentas).
const IGNORADOS = new Set(["eslint.config.js", "package.json", "package-lock.json", "skills-lock.json", "biome.jsonc"]);
const EXTENSOES_SERVIDAS = new Set([".html", ".js", ".png", ".svg", ".ico", ".jpg", ".jpeg", ".webp", ".css", ".txt", ".xml", ".webmanifest"]);

function arquivosDaRaiz() {
  return fs.readdirSync(RAIZ, { withFileTypes: true })
    // Testes da raiz (*.test.js) não são do site: publicados, ficavam acessíveis e o `node --test` os achava em publico/.
    .filter((e) => e.isFile() && !IGNORADOS.has(e.name) && !e.name.endsWith(".test.js") && EXTENSOES_SERVIDAS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .concat("_headers");
}

function arquivosDeDados() {
  // O histórico por destinatário e futuros arquivos internos não pertencem ao site público.
  return ["capag-municipios.json", "convenios.json", "sistema_s_am.json", "mercado_meta.json", "contratos_meta.json", "municipios-centroides.json"];
}

function montarPublico() {
  fs.rmSync(DESTINO, { recursive: true, force: true });
  fs.mkdirSync(DESTINO, { recursive: true });
  const copiados = arquivosDaRaiz();
  for (const nome of copiados) fs.copyFileSync(path.join(RAIZ, nome), path.join(DESTINO, nome));
  fs.mkdirSync(path.join(DESTINO, "data"));
  for (const nome of arquivosDeDados()) fs.copyFileSync(path.join(RAIZ, "data", nome), path.join(DESTINO, "data", nome));
  // Páginas públicas de SEO geradas por scripts/gerar_site_publico.js (blog/, ferramentas/, para/): só os .html.
  for (const pasta of PASTAS_DO_SITE.filter((p) => fs.existsSync(path.join(RAIZ, p)))) fs.cpSync(path.join(RAIZ, pasta), path.join(DESTINO, pasta), { recursive: true, filter: (f) => fs.statSync(f).isDirectory() || f.endsWith(".html") });
  // Prints dos tutoriais da Central de ajuda "?" (ajuda-ui.js e ajuda.html): só imagens .webp de dados fictícios, e os
  // vídeos curtos dos tutoriais (ajuda/videos/*.mp4|.webm) quando existirem.
  const ajuda = path.join(RAIZ, "ajuda");
  if (fs.existsSync(ajuda)) fs.cpSync(ajuda, path.join(DESTINO, "ajuda"), { recursive: true, filter: (f) => fs.statSync(f).isDirectory() || /\.(webp|mp4|webm)$/.test(f) });
  versionarArquivos(copiados);
  return copiados;
}

// 23/11: a Cloudflare guarda .js/.css no navegador por 4 h (Browser Cache TTL da zona) e o cliente via a página
// nova com o programa velho logo depois de publicar. Cada <script src>/<link href> local ganha ?v=<hash do conteúdo>:
// mudou o arquivo, muda o endereço e o navegador busca de novo; não mudou, continua no cache.
function versionarHtml(html, hashDe) {
  return html.replace(/(\b(?:src|href)=")([A-Za-z0-9._-]+\.(?:js|css))(")/g, (todo, antes, nome, depois) => {
    const h = hashDe(nome);
    return h ? `${antes}${nome}?v=${h}${depois}` : todo;
  });
}

function versionarArquivos(copiados) {
  const hashes = {};
  for (const nome of copiados.filter((n) => /\.(js|css)$/.test(n))) {
    hashes[nome] = crypto.createHash("sha256").update(fs.readFileSync(path.join(DESTINO, nome))).digest("hex").slice(0, 10);
  }
  for (const nome of copiados.filter((n) => n.endsWith(".html"))) {
    const arq = path.join(DESTINO, nome);
    fs.writeFileSync(arq, versionarHtml(fs.readFileSync(arq, "utf8"), (n) => hashes[n]));
  }
}

// Pacote da extensão em publico/extensao/ (link "Baixar a extensão" do extensao.html). Gerado aqui, e não copiado
// de dist/ (gitignored), para o build do CI publicar sempre a versão do manifesto atual.
async function publicarExtensao() {
  const { empacotar } = await import("./empacotar-extensao.mjs");
  return empacotar({ destino: path.join(DESTINO, "extensao") });
}

if (require.main === module) {
  const copiados = montarPublico();
  publicarExtensao().then((r) => {
    console.log(`publico/: ${copiados.length} arquivos da raiz + data/ + extensao/${path.basename(r.arquivo)}`);
  }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}

module.exports = { montarPublico, arquivosDaRaiz, arquivosDeDados, publicarExtensao, PASTAS_DO_SITE, versionarHtml };
