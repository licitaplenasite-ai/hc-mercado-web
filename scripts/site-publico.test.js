// SEO do site público: o que está commitado é o que o gerador produz, sitemap e robots corretos, cada página com
// title/description/canonical/JSON-LD válidos, links internos sem 404, página 404 de verdade e CSP do Web Analytics.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { gerar, SITE, PRIVADAS } = require("./gerar_site_publico");
const { arquivosDaRaiz, PASTAS_DO_SITE } = require("./montar_publico");

const RAIZ = path.join(__dirname, "..");
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), "utf8");
const saida = gerar();
const locs = [...ler("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const caminho = (loc) => loc.slice(SITE.length);

// Como o Cloudflare Pages resolve um endereço limpo: /x -> x.html, /x/ -> x/index.html, / -> index.html.
function arquivoDoEndereco(endereco) {
  const p = decodeURIComponent(endereco.split(/[?#]/)[0]).replace(/^\//, "");
  for (const c of [p, p + ".html", path.posix.join(p, "index.html")]) {
    if (c && fs.existsSync(path.join(RAIZ, c)) && fs.statSync(path.join(RAIZ, c)).isFile()) return c;
  }
  return p === "" ? "index.html" : null;
}

test("os arquivos commitados são iguais aos que scripts/gerar_site_publico.js gera", () => {
  const diferentes = Object.entries(saida).filter(([rel, conteudo]) => !fs.existsSync(path.join(RAIZ, rel)) || ler(rel) !== conteudo).map(([rel]) => rel);
  assert.deepEqual(diferentes, [], "rode: node scripts/gerar_site_publico.js");
});

test("sitemap.xml é válido, sem repetição e aponta só para páginas públicas que existem", () => {
  const xml = ler("sitemap.xml");
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
  assert.equal(new Set(locs).size, locs.length, "URL repetida no sitemap");
  for (const l of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) assert.match(l[1], /^\d{4}-\d{2}-\d{2}$/);
  for (const loc of locs) {
    assert.ok(loc.startsWith(SITE + "/"), loc);
    assert.ok(arquivoDoEndereco(caminho(loc)), `sitemap aponta para página que não existe: ${loc}`);
    assert.ok(!PRIVADAS.some((p) => caminho(loc).startsWith(p)), `página privada no sitemap: ${loc}`);
  }
  for (const esperado of ["/", "/blog/", "/ferramentas/", "/glossario", "/sobre", "/contato", "/assessoria-hc", "/para/mei-e-pequena-empresa", "/blog/mei-em-licitacao"]) {
    assert.ok(locs.includes(SITE + esperado), `faltou ${esperado} no sitemap`);
  }
  assert.ok(!locs.some((l) => /404/.test(l)), "a página 404 não entra no sitemap");
});

test("robots.txt libera as páginas públicas, bloqueia as do sistema e indica o sitemap", () => {
  const robots = ler("robots.txt");
  const bloqueios = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1]);
  for (const privada of ["/painel", "/admin", "/sistema", "/operacao", "/processos", "/api/"]) assert.ok(bloqueios.includes(privada), `robots sem ${privada}`);
  for (const loc of locs) assert.ok(!bloqueios.some((b) => caminho(loc).startsWith(b)), `robots bloqueia página pública ${loc}`);
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap.xml$`, "m"));
});

test("toda página do sitemap tem title e description únicos, canonical igual ao endereço e JSON-LD válido", () => {
  const titulos = new Map();
  const descricoes = new Map();
  for (const loc of locs) {
    const html = ler(arquivoDoEndereco(caminho(loc)));
    const titulo = (html.match(/<title>([^<]+)<\/title>/) || [])[1];
    const descricao = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1];
    assert.ok(titulo, `sem title: ${loc}`);
    assert.ok(descricao && descricao.length >= 50 && descricao.length <= 170, `description ausente ou fora do tamanho (${descricao && descricao.length}): ${loc}`);
    assert.equal((html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1], loc, `canonical errado: ${loc}`);
    assert.ok(!titulos.has(titulo), `title repetido em ${loc} e ${titulos.get(titulo)}`);
    assert.ok(!descricoes.has(descricao), `description repetida em ${loc} e ${descricoes.get(descricao)}`);
    titulos.set(titulo, loc);
    descricoes.set(descricao, loc);
    for (const [, bloco] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const dado = JSON.parse(bloco);
      assert.equal(dado["@context"], "https://schema.org", loc);
    }
  }
});

test("schema.org: Organization com o CNPJ, FAQPage no index e Article com autor Equipe LicitaPlena em cada artigo", () => {
  const grafo = (rel) => JSON.parse(ler(rel).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
  const index = grafo("index.html");
  const org = index.find((n) => n["@type"] === "Organization");
  assert.equal(org.taxID, "28.786.260/0001-53");
  assert.equal(org.address.addressLocality, "Manaus");
  const faq = index.find((n) => n["@type"] === "FAQPage");
  assert.ok(faq.mainEntity.length >= 5 && faq.mainEntity.every((q) => q.name && q.acceptedAnswer.text));
  assert.ok(index.some((n) => n["@type"] === "SoftwareApplication"));
  const artigos = locs.filter((l) => /\/blog\/(?!categoria\/)[^/]+$/.test(l));
  assert.ok(artigos.length >= 8 && artigos.length <= 12, `artigos no blog: ${artigos.length}`);
  for (const loc of artigos) {
    const artigo = grafo(arquivoDoEndereco(caminho(loc))).find((n) => n["@type"] === "Article");
    assert.ok(artigo && artigo.headline && artigo.datePublished, loc);
    assert.equal(artigo.author.name, "Equipe LicitaPlena");
    const html = ler(arquivoDoEndereco(caminho(loc)));
    assert.match(html, /href="\/cadastro"/, `artigo sem chamada para o teste: ${loc}`);
    assert.match(html, /href="\/ferramentas\/|href="\/para\/|href="\/assessoria-hc"/, `artigo sem link para a ferramenta: ${loc}`);
  }
});

test("links e imagens internos das páginas públicas e da 404 existem (sem 404)", () => {
  const paginas = [...new Set(locs.map((l) => arquivoDoEndereco(caminho(l))))].concat("404.html");
  const quebrados = [];
  for (const rel of paginas) {
    const html = ler(rel).replace(/<script[\s\S]*?<\/script>/g, "");
    for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|mailto:|tel:|#|data:)/.test(ref)) continue;
      if (/^\/?extensao\/[^/]+\.zip$/.test(ref)) continue; // pacote montado no build (scripts/montar_publico.js)
      // Relativo (páginas antigas na raiz usam "cadastro.html"): resolve a partir da pasta da página.
      const absoluto = ref.startsWith("/") ? ref : "/" + path.posix.join(path.posix.dirname(rel), ref);
      if (absoluto.split("#")[0] === "/" || arquivoDoEndereco(absoluto)) continue;
      quebrados.push(`${rel} -> ${ref}`);
    }
  }
  assert.deepEqual(quebrados, []);
});

test("404.html de verdade: publicado, fora do índice e as rotas reais do sistema continuam existindo", () => {
  const publicados = arquivosDaRaiz();
  assert.ok(publicados.includes("404.html"), "404.html precisa ir para o publico/ (o Pages só devolve 404 se ela existir)");
  const html = ler("404.html");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /Página não encontrada/);
  assert.ok(!/rel="canonical"/.test(html), "404 não tem canonical");
  // Sem regra "/* /index.html 200": ela devolveria a home com 200 para qualquer endereço (soft 404).
  assert.ok(!fs.existsSync(path.join(RAIZ, "_redirects")) || !/^\/\*\s+\/index\.html/m.test(ler("_redirects")));
  for (const rota of ["/login", "/cadastro", "/painel", "/sistema", "/admin", "/operacao", "/processos", "/cliente", "/assinar", "/extensao", "/bdi", "/sinapi", "/mao-de-obra"]) {
    const arq = arquivoDoEndereco(rota);
    assert.ok(arq && publicados.includes(arq), `rota real ${rota} deixaria de funcionar`);
  }
  for (const pasta of PASTAS_DO_SITE) assert.ok(fs.existsSync(path.join(RAIZ, pasta, "index.html")), `${pasta}/index.html`);
});

test("CSP libera o Web Analytics da Cloudflare (script e envio) no _headers e no netlify.toml", () => {
  for (const arq of ["_headers", "netlify.toml"]) {
    const csp = ler(arq).match(/Content-Security-Policy\s*[:=]\s*"?(default-src 'self';[^"\n]*)/)[1];
    assert.match(csp, /script-src [^;]*https:\/\/static\.cloudflareinsights\.com/, arq);
    assert.match(csp, /connect-src [^;]*https:\/\/cloudflareinsights\.com/, arq);
  }
});

test("og:image de cada página gerada existe; artigos e categorias do blog usam a própria capa .jpg (< 120 KB)", () => {
  for (const loc of locs.filter((l) => saida[arquivoDoEndereco(caminho(l))])) {
    const html = ler(arquivoDoEndereco(caminho(loc)));
    const img = (html.match(/<meta property="og:image" content="([^"]+)">/) || [])[1];
    assert.ok(img && img.startsWith(SITE + "/"), `og:image ausente: ${loc}`);
    const arquivo = arquivoDoEndereco(caminho(img));
    assert.ok(arquivo, `og:image aponta para arquivo que não existe: ${img}`);
    if (/\/blog\/(?!$)/.test(caminho(loc))) {
      assert.match(img, /\/blog\/capas\/[a-z0-9-]+\.jpg$/, `blog sem capa no og:image: ${loc}`);
      assert.ok(fs.statSync(path.join(RAIZ, arquivo)).size < 120 * 1024, `capa grande demais: ${img}`);
    }
  }
});