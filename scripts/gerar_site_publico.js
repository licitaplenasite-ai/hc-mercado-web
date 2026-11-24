// Gera as páginas públicas de SEO do LicitaPlena (ferramentas, públicos, blog, glossário, sobre, contato, assessoria HC,
// 404), o sitemap.xml, o robots.txt e os blocos marcados do index.html (cabeçalho de SEO, "Do blog" e mapa do site).
//
//   node scripts/gerar_site_publico.js
//
// Por quê um gerador: são ~35 páginas com o mesmo topo, rodapé, schema.org e canonical. À mão, uma página nova
// esquecida fora do sitemap ou um rodapé diferente passariam. A saída é HTML estático commitado (o site continua sem
// build: Netlify publica a raiz e scripts/montar_publico.js copia as pastas para o Cloudflare Pages).
// Conteúdo: scripts/site-publico/paginas.js e scripts/site-publico/artigos/*.html. Sem env vars.
// scripts/site-publico.test.js confere que o que está commitado é igual ao que este script gera.

const fs = require("node:fs");
const path = require("node:path");
const { FERRAMENTAS, PUBLICOS, GLOSSARIO } = require("./site-publico/paginas");
const { ICONES } = require("./site-publico/icones");

const RAIZ = path.join(__dirname, "..");
const SITE = "https://licitaplena.com.br";
// Data fixa (e não a do dia) para a saída ser sempre a mesma: troque ao publicar conteúdo novo.
const DATA_ATUALIZACAO = "2026-11-22";
const EMAIL = "licitaplena.site@gmail.com";
const WHATSAPP = "5592981937781";
const HC_SITE = "https://www.hclicitacoes.com";
const ZAP_HC = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Olá! Vim pelo site do LicitaPlena e quero ajuda da HC Licitações com licitações.")}`;
const ZAP_SUPORTE = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Olá! Tenho uma dúvida sobre o LicitaPlena.")}`;

const CATEGORIAS = {
  "primeiros-passos": "Primeiros passos",
  "documentos-e-habilitacao": "Documentos e habilitação",
  "obras-e-engenharia": "Obras e engenharia",
  "impostos-e-precos": "Impostos e preços",
  "pregao-e-disputa": "Pregão e disputa",
  novidades: "Novidades",
};

// Páginas do sistema logado e telas internas: fora do sitemap e bloqueadas no robots.txt.
const PRIVADAS = ["/painel", "/bdi", "/normas-obra", "/admin", "/operacao", "/processos", "/sistema", "/quadros", "/cliente", "/convite",
  "/responder-oportunidade", "/resumo-processo", "/prospeccao", "/orcamento-obra", "/assinar", "/sinapi", "/mao-de-obra", "/hc", "/api/", "/data/"];
// Páginas públicas que já existiam (feitas à mão) e entram no sitemap. SINAPI e Mão de obra pedem login: ficam de fora.
const PUBLICAS_EXISTENTES = ["index.html", "cadastro.html", "extensao.html",
  "termos-de-uso.html", "politica-privacidade.html", "politica-cookies.html"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const urlDe = (arquivo) => "/" + arquivo.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
const jsonld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const dataBr = (iso) => iso.split("-").reverse().join("/");

function lerArtigos() {
  const pasta = path.join(__dirname, "site-publico", "artigos");
  return fs.readdirSync(pasta).filter((n) => n.endsWith(".html")).map((nome) => {
    const texto = fs.readFileSync(path.join(pasta, nome), "utf8");
    const m = texto.match(/^<!--meta\s*([\s\S]*?)-->\s*/);
    if (!m) throw new Error(`${nome}: falta o bloco <!--meta {...} -->`);
    const meta = JSON.parse(m[1]);
    const corpo = texto.slice(m[0].length).trim();
    if (meta.slug + ".html" !== nome) throw new Error(`${nome}: slug do meta diferente do nome do arquivo`);
    if (!CATEGORIAS[meta.categoria]) throw new Error(`${nome}: categoria desconhecida ${meta.categoria}`);
    if (/<(script|style|h1|img|iframe)\b|\son\w+=/i.test(corpo)) throw new Error(`${nome}: corpo com tag proibida`);
    const palavras = corpo.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    return { ...meta, data: meta.data || DATA_ATUALIZACAO, corpo, minutos: Math.max(1, Math.round(palavras / 200)) };
  }).sort((a, b) => b.data.localeCompare(a.data) || b.ordem - a.ordem);
}

// ---------- Peças comuns ----------
const ORGANIZACAO = {
  "@type": "Organization", "@id": `${SITE}/#organizacao`, name: "LicitaPlena", legalName: "HCM LTDA",
  taxID: "28.786.260/0001-53", url: `${SITE}/`, logo: `${SITE}/logo.png`, email: EMAIL,
  address: { "@type": "PostalAddress", addressLocality: "Manaus", addressRegion: "AM", addressCountry: "BR" },
  contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: EMAIL, telephone: `+${WHATSAPP}`, availableLanguage: "pt-BR" },
  sameAs: [HC_SITE],
};
const SOFTWARE = {
  "@type": "SoftwareApplication", "@id": `${SITE}/#sistema`, name: "LicitaPlena", applicationCategory: "BusinessApplication",
  operatingSystem: "Web", url: `${SITE}/`, inLanguage: "pt-BR", publisher: { "@id": `${SITE}/#organizacao` },
  description: "Sistema web para encontrar, entender e acompanhar licitações públicas: boletim diário do PNCP, resumo de edital com IA, pesquisa de preços, concorrentes e documentos de habilitação.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "BRL", description: "Teste grátis de 14 dias, sem cartão de crédito." },
};
const faqSchema = (pares) => ({ "@type": "FAQPage", mainEntity: pares.map(([q, r]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: r } })) });
const migalhasSchema = (itens) => ({ "@type": "BreadcrumbList", itemListElement: itens.map(([nome, url], i) => ({ "@type": "ListItem", position: i + 1, name: nome, item: SITE + url })) });

// Rodapé, rodada 3 (23/11): três cartões de contato com ícone em círculo de destaque que gira ao passar o mouse
// (técnica do rodapé do site da HC, que veio do kit Construção da pasta de modelos), antes do mapa do site.
const ICO = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const ICO_CHAT = ICO('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.9-.9L3 20.5l1.6-4.6A8.4 8.4 0 1 1 21 11.5z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>');
const ICO_EMAIL = ICO('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5 12 13l8.5-6.5"/>');
const ICO_LOCAL = ICO('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.6"/>');
function contatosRodape() {
  const cartao = (tag, attrs, ico, rotulo, texto) => `<${tag} class="rc"${attrs}><span class="rc-ico">${ico}</span><small>${rotulo}</small><strong>${texto}</strong></${tag}>`;
  return `<div class="rodape-contatos">${cartao("a", ` href="${ZAP_SUPORTE}" target="_blank" rel="noopener"`, ICO_CHAT, "WhatsApp", "(92) 98193-7781")}${cartao("a", ` href="mailto:${EMAIL}"`, ICO_EMAIL, "E-mail", EMAIL)}${cartao("div", "", ICO_LOCAL, "Base", "Manaus/AM, atendimento em todo o Brasil")}</div>`;
}

function mapaDoSite() {
  const col = (titulo, links) => `<div><p class="mapa-titulo">${titulo}</p><ul>${links.map(([h, t]) => `<li><a href="${h}">${esc(t)}</a></li>`).join("")}</ul></div>`;
  return `${contatosRodape()}
<nav class="mapa-site" aria-label="Mapa do site">
${col("Ferramentas", FERRAMENTAS.map((f) => [`/ferramentas/${f.slug}`, f.curto]))}
${col("Para quem é", PUBLICOS.map((p) => [`/para/${p.slug}`, p.nome]).concat([["/#planos", "Planos e preços"]]))}
${col("Conteúdo", [["/blog/", "Blog"], ...Object.entries(CATEGORIAS).map(([s, n]) => [`/blog/categoria/${s}`, n]), ["/glossario", "Glossário de licitação"]])}
${col("LicitaPlena", [["/sobre", "Sobre"], ["/contato", "Contato"], ["/assessoria-hc", "Assessoria HC Licitações"], ["/extensao", "Extensão do navegador"], ["/termos-de-uso", "Termos de uso"], ["/politica-privacidade", "Privacidade"], ["/politica-cookies", "Cookies"]])}
</nav>`;
}

const CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:var(--text-body);font-family:var(--font-sans);color:var(--text-primary);background:var(--surface-page);overflow-wrap:break-word}
a{color:var(--action-text);text-underline-offset:3px}:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.c{max-width:1080px;margin:0 auto;padding:0 32px}.estreito{max-width:760px}
.pular{position:absolute;left:-9999px}.pular:focus{left:16px;top:8px;z-index:100;background:var(--surface-raised);padding:8px 12px}
.topo{position:sticky;top:0;z-index:50;background:var(--surface-default);border-bottom:1px solid var(--border-default)}
.topo .c{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:60px;flex-wrap:wrap}
.marca{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:16px;color:var(--text-primary);text-decoration:none}
.placa{display:inline-grid;place-content:center;width:32px;height:32px;border-radius:var(--radius-control);background:none;border:0}.placa img{width:24px;height:24px;display:block}
.menu{display:flex;gap:2px;flex-wrap:wrap}.menu a{text-decoration:none;color:var(--text-secondary);font-weight:500;padding:6px 10px;border-radius:var(--radius-control)}.menu a:hover{color:var(--text-primary);background:var(--surface-sunken)}
.acoes{display:flex;gap:8px;flex-wrap:wrap}
.btn{min-height:36px;padding:0 16px;border-radius:var(--radius-control);border:1px solid transparent;display:inline-flex;align-items:center;justify-content:center;font-weight:500;font-size:14px;text-decoration:none;cursor:pointer;text-align:center}
.btn-pri{background:var(--action-strong);color:var(--action-on)}.btn-pri:hover{background:var(--action-strong-hover)}
.btn-sec{background:var(--surface-default);color:var(--text-primary);border-color:var(--border-strong)}.btn-sec:hover{background:var(--surface-sunken)}
.btn-g{min-height:44px;padding:0 20px;font-size:16px}
.migalhas{font:var(--text-label);color:var(--text-secondary);margin:24px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:4px}.migalhas li+li::before{content:"/";margin-right:4px}.migalhas a{color:var(--text-secondary)}
main{padding:8px 0 64px}
h1{font-size:34px;line-height:42px;font-weight:600;letter-spacing:-.01em;margin:16px 0 12px}
h2{font-size:22px;line-height:30px;font-weight:600;margin:40px 0 12px}h3{font-size:17px;line-height:26px;font-weight:600;margin:24px 0 8px}
.lead{font-size:18px;line-height:28px;color:var(--text-secondary);margin:0 0 24px;max-width:62ch}
.meta-artigo{font:var(--text-label);color:var(--text-secondary);margin:0 0 24px}
.texto{font-size:16px;line-height:27px}.texto p,.texto li{max-width:70ch}.texto li{margin-bottom:6px}
.texto table{border-collapse:collapse;width:100%;display:block;overflow-x:auto;font-size:14px;margin:16px 0}.texto th,.texto td{border:1px solid var(--border-default);padding:8px 10px;text-align:left;vertical-align:top}.texto th{background:var(--surface-sunken)}
.texto blockquote{margin:16px 0;padding:12px 16px;border-left:3px solid var(--brand-blue);background:var(--surface-default)}
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin:24px 0;padding:0;list-style:none}
.cartao{background:var(--surface-default);border:1px solid var(--border-default);border-radius:var(--radius-card);padding:20px;display:flex;flex-direction:column;gap:8px}
.cartao h2,.cartao h3{margin:0;font-size:17px;line-height:24px}.cartao p{margin:0;color:var(--text-secondary)}.cartao a.ir{margin-top:auto;font-weight:600}
.rotulo{font:var(--text-label);color:var(--text-secondary);text-transform:uppercase;letter-spacing:.02em;margin:0}
figure{margin:24px 0}figure img{width:100%;height:auto;border:1px solid var(--border-default);border-radius:var(--radius-card);display:block}figcaption{font:var(--text-label);color:var(--text-secondary);margin-top:8px}
.aviso{background:var(--attention-bg);border:1px solid var(--attention-border);color:var(--text-primary);border-radius:var(--radius-card);padding:12px 16px;margin:16px 0}
.faq details{border-bottom:1px solid var(--border-default)}.faq summary{cursor:pointer;padding:16px 0;font-weight:600}.faq details p{margin:0 0 16px;color:var(--text-secondary)}
.chamada{margin:48px 0 0;padding:28px;background:var(--surface-default);border:1px solid var(--border-default);border-radius:var(--radius-card);display:grid;gap:12px}
.chamada h2{margin:0}.chamada p{margin:0;color:var(--text-secondary)}.chamada .acoes{margin-top:4px}
.categorias{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0;padding:0;list-style:none}.categorias a{display:inline-flex;min-height:32px;align-items:center;padding:0 12px;border:1px solid var(--border-default);border-radius:var(--radius-control);background:var(--surface-default);text-decoration:none;color:var(--text-primary);font-size:14px}.categorias a[aria-current]{border-color:var(--action-strong);color:var(--action-text)}
dl.glossario dt{font-weight:600;margin-top:20px}dl.glossario dd{margin:4px 0 0;color:var(--text-secondary);max-width:70ch}
footer{border-top:1px solid var(--border-default);background:var(--surface-default);padding:40px 0 32px}
.mapa-site{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px}.mapa-site ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}.mapa-site a{color:var(--text-secondary);text-decoration:none;font-size:14px}.mapa-site a:hover{color:var(--action-text);text-decoration:underline}
.mapa-titulo{font-weight:600;margin:0 0 10px}
.direitos{font:var(--text-label);color:var(--text-secondary);margin:32px 0 0;max-width:720px}
@media (max-width:760px){.c{padding:0 16px}h1{font-size:27px;line-height:35px}.mapa-site{grid-template-columns:1fr 1fr}.menu{order:3;width:100%;margin:0 -10px 6px}.topo .c{padding-top:8px}.acoes .btn{flex:1 1 auto}.chamada{padding:20px}}
@media (max-width:420px){.acoes{width:100%}.chamada .btn{width:100%}}`;

function pagina({ arquivo, titulo, descricao, corpo, schemas = [], migalhas = [], tipoOg = "website", indexar = true, imagem = "/logo.png" }) {
  const url = SITE + urlDe(arquivo);
  const grafo = { "@context": "https://schema.org", "@graph": [ORGANIZACAO, ...schemas, ...(migalhas.length ? [migalhasSchema(migalhas)] : [])] };
  const trilha = migalhas.length ? `<ol class="migalhas">${migalhas.map(([n, u], i) => (i === migalhas.length - 1 ? `<li aria-current="page">${esc(n)}</li>` : `<li><a href="${u}">${esc(n)}</a></li>`)).join("")}</ol>` : "";
  return `<!DOCTYPE html>
<html lang="pt-BR" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">
${indexar ? `<link rel="canonical" href="${url}">` : '<meta name="robots" content="noindex">'}
<meta property="og:type" content="${tipoOg}">
<meta property="og:site_name" content="LicitaPlena">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descricao)}">
${indexar ? `<meta property="og:url" content="${url}">\n` : ""}<meta property="og:image" content="${SITE}${imagem}">
<meta name="twitter:card" content="${imagem === "/logo.png" ? "summary" : "summary_large_image"}">
<link rel="icon" type="image/png" href="/favicon.png?v=3">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/ds-tokens.css">
<script>(function(){var t=null;try{t=localStorage.getItem("licitaplena_tema");}catch(e){}document.documentElement.dataset.theme=t==="escuro"?"dark":"light";})();</script>
${indexar ? jsonld(grafo) + "\n" : ""}<style>${CSS}</style>
<link rel="stylesheet" href="/marca.css">
<script src="/revelar.js" defer></script>
</head>
<body>
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
<header class="topo"><div class="c">
<a href="/" class="marca"><span class="placa"><img src="/logo-icone.svg" alt="" width="24" height="24"></span>LicitaPlena</a>
<nav class="menu" aria-label="Principal"><a href="/ferramentas/">Ferramentas</a><a href="/para/">Para quem é</a><a href="/blog/">Blog</a><a href="/assessoria-hc">Assessoria HC</a><a href="/#planos">Planos</a></nav>
<div class="acoes"><a href="/login" class="btn btn-sec">Entrar</a><a href="/cadastro" class="btn btn-pri">Testar grátis</a></div>
</div></header>
<main id="conteudo"><div class="c">
${trilha}
${corpo}
</div></main>
<footer><div class="c">
${mapaDoSite()}
<p class="direitos">LicitaPlena: inteligência, gestão e automação em licitações. Uma solução HC Licitações, desenvolvida e operada pela HCM LTDA, CNPJ nº 28.786.260/0001-53, Manaus/AM. Contato: <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>
</div></footer>
</body>
</html>
`;
}

const chamada = (titulo = "Teste grátis por 14 dias", texto = "Sem cartão de crédito. Cada conta é liberada pela nossa equipe, e a resposta chega por e-mail.") =>
  `<section class="chamada" aria-label="Teste grátis"><h2>${titulo}</h2><p>${texto}</p><div class="acoes"><a href="/cadastro" class="btn btn-pri btn-g">Teste grátis 14 dias</a><a href="/assessoria-hc" class="btn btn-sec btn-g">Precisa de quem faça por você?</a></div></section>`;
const faqHtml = (pares) => `<h2>Perguntas frequentes</h2><div class="faq">${pares.map(([q, r]) => `<details><summary>${esc(q)}</summary><p>${esc(r)}</p></details>`).join("")}</div>`;
// Capa: foto .webp na tela e .jpg com título no og:image (scripts/gerar_imagens_site.js).
const capaDe = (chave) => `/blog/capas/${chave}.webp`;
const imgCapa = (chave, classe, preguica = true) => `<img class="${classe}" src="${capaDe(chave)}" alt="" width="1200" height="630"${preguica ? ' loading="lazy"' : ""}>`;
const cartaoArtigo = (a, nivel = "h3", extra = "") => `<li class="cartao cartao-artigo${extra}">${imgCapa(a.slug, "cartao-capa")}<div class="cartao-corpo"><p class="rotulo">${esc(CATEGORIAS[a.categoria])}</p><${nivel}><a href="/blog/${a.slug}">${esc(a.titulo)}</a></${nivel}><p>${esc(a.resumo)}</p><p class="cartao-meta">${a.minutos} min de leitura</p></div></li>`;
const idTitulo = (t) => t.replace(/<[^>]+>/g, "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Sumário: âncora em cada <h2> do corpo do artigo.
function comSumario(corpo) {
  const itens = [];
  const html = corpo.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, t) => { const id = idTitulo(t); itens.push([id, t.replace(/<[^>]+>/g, "")]); return `<h2 id="${id}">${t}</h2>`; });
  return { html, itens };
}
const ferramentaPorSlug = (s) => FERRAMENTAS.find((f) => f.slug === s);
// Tela do sistema novo (prints com dados fictícios, scripts/gerar_vitrine.js); sem ela, fica o print da Central de ajuda.
const telaVitrine = ([nome, largura, altura], alt) => `<img src="/img/vitrine/${nome}-${largura}.webp" srcset="/img/vitrine/${nome}-640.webp 640w, /img/vitrine/${nome}-${largura}.webp ${largura}w" sizes="(max-width: 800px) 92vw, 720px" alt="${esc(alt)}" width="${largura}" height="${altura}" loading="lazy" decoding="async">`;
// Cartão ilustrado (index e /ferramentas/): mini-tela da ferramenta em cima e detalhe azul-escuro embaixo (marca.css).
const cartaoFerramenta = (f, nivel = "h3") => `<li class="ferr"><span class="ferr-arte">${ICONES[f.slug]}</span><${nivel}><a href="/ferramentas/${f.slug}">${esc(f.nome)}</a></${nivel}><p>${esc(f.descricao)}</p><span class="ferr-mais" aria-hidden="true">Conhecer a ferramenta</span></li>`;

// ---------- Páginas ----------
function paginasFerramentas(artigos) {
  const porSlug = Object.fromEntries(artigos.map((a) => [a.slug, a]));
  const indice = pagina({
    arquivo: "ferramentas/index.html",
    titulo: "Ferramentas para licitação: busca, edital, preços e obras",
    descricao: "Conheça as ferramentas do LicitaPlena: boletim de licitações, resumo de edital com IA, vigia do chat, orçamento de obras, CBS/IBS, preços e documentos.",
    migalhas: [["Início", "/"], ["Ferramentas", "/ferramentas/"]],
    schemas: [SOFTWARE],
    corpo: `<h1>Ferramentas do LicitaPlena</h1><p class="lead">Cada ferramenta cuida de uma parte da licitação, do edital publicado à proposta. Todas usam dados públicos oficiais.</p>
<ul class="ferr-grade">${FERRAMENTAS.map((f) => cartaoFerramenta(f, "h2")).join("")}</ul>${chamada()}`,
  });
  const paginas = FERRAMENTAS.map((f) => [`ferramentas/${f.slug}.html`, pagina({
    arquivo: `ferramentas/${f.slug}.html`, titulo: f.titulo, descricao: f.descricao,
    migalhas: [["Início", "/"], ["Ferramentas", "/ferramentas/"], [f.curto, `/ferramentas/${f.slug}`]],
    schemas: [{ "@type": "WebPage", name: f.titulo, description: f.descricao, url: `${SITE}/ferramentas/${f.slug}`, about: { "@id": `${SITE}/#sistema` }, inLanguage: "pt-BR" }, SOFTWARE, faqSchema(f.faq)],
    corpo: `<div class="estreito"><p class="rotulo">Agente ${esc(f.agente)}</p><h1>${esc(f.h1)}</h1><p class="lead">${esc(f.dor)}</p>
<h2>O que a ferramenta faz hoje</h2><ul class="texto">${f.faz.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<h2>Como usar</h2><ol class="texto">${f.passos.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
<figure>${f.vitrine ? telaVitrine(f.vitrine, f.printAlt) : `<img src="/ajuda/${f.print}.webp" alt="${esc(f.printAlt)}" width="1280" height="800" loading="lazy">`}<figcaption>${esc(f.printAlt)}.</figcaption></figure>
<p class="aviso"><strong>Importante:</strong> ${esc(f.cuidado)}</p>
<p class="texto"><strong>Plano:</strong> ${esc(f.plano)} <a href="/#planos">Ver planos e preços</a>.${f.extra ? ` <a href="${f.extra.href}">${esc(f.extra.texto)}</a>.` : ""}</p>
${faqHtml(f.faq)}
<h2>Leia também</h2><ul class="grade">${f.artigos.map((s) => cartaoArtigo(porSlug[s])).join("")}</ul>
${chamada()}</div>`,
  })]);
  return [["ferramentas/index.html", indice], ...paginas];
}

function paginasPublicos(artigos) {
  const porSlug = Object.fromEntries(artigos.map((a) => [a.slug, a]));
  const indice = pagina({
    arquivo: "para/index.html",
    titulo: "Para quem é o LicitaPlena: MEI, obras e assessorias",
    descricao: "O LicitaPlena atende MEI e pequenas empresas, empresas de engenharia e obras e assessorias de licitação. Veja o que cada uma ganha no sistema.",
    migalhas: [["Início", "/"], ["Para quem é", "/para/"]],
    corpo: `<h1>Para quem é o LicitaPlena</h1><p class="lead">Para quem vende ou quer vender ao governo, de qualquer porte, e para quem cuida das licitações de várias empresas.</p>
<ul class="grade">${PUBLICOS.map((p) => `<li class="cartao"><h2><a href="/para/${p.slug}">${esc(p.nome)}</a></h2><p>${esc(p.descricao)}</p></li>`).join("")}</ul>${chamada()}`,
  });
  const paginas = PUBLICOS.map((p) => [`para/${p.slug}.html`, pagina({
    arquivo: `para/${p.slug}.html`, titulo: p.titulo, descricao: p.descricao,
    migalhas: [["Início", "/"], ["Para quem é", "/para/"], [p.nome, `/para/${p.slug}`]],
    schemas: [{ "@type": "WebPage", name: p.titulo, description: p.descricao, url: `${SITE}/para/${p.slug}`, about: { "@id": `${SITE}/#sistema` }, inLanguage: "pt-BR" }],
    corpo: `<div class="estreito"><h1>${esc(p.h1)}</h1><p class="lead">${esc(p.intro)}</p>
<h2>O que resolve no seu dia a dia</h2>${p.dores.map(([d, r]) => `<h3>${esc(d)}</h3><p class="texto">${esc(r)}</p>`).join("")}
<p class="aviso">${esc(p.nota)}</p>
<h2>Ferramentas mais usadas</h2><ul class="grade">${p.ferramentas.map((s) => { const f = ferramentaPorSlug(s); return `<li class="cartao"><h3><a href="/ferramentas/${f.slug}">${esc(f.nome)}</a></h3><p>${esc(f.descricao)}</p></li>`; }).join("")}</ul>
<h2>Leia também</h2><ul class="grade">${p.artigos.map((s) => cartaoArtigo(porSlug[s])).join("")}</ul>
${chamada()}</div>`,
  })]);
  return [["para/index.html", indice], ...paginas];
}

function paginasBlog(artigos) {
  const navCat = (atual) => `<ul class="categorias">${Object.entries(CATEGORIAS).map(([s, n]) => `<li><a href="/blog/categoria/${s}"${s === atual ? ' aria-current="page"' : ""}>${esc(n)}</a></li>`).join("")}</ul>`;
  // O primeiro da lista vira o destaque (cartão largo).
  const lista = (itens) => `<ul class="grade grade-artigos">${itens.map((a, i) => cartaoArtigo(a, "h2", i === 0 && itens.length > 2 ? " destaque" : "")).join("")}</ul>`;
  const blogSchema = { "@type": "Blog", "@id": `${SITE}/blog/#blog`, name: "Blog do LicitaPlena", url: `${SITE}/blog/`, inLanguage: "pt-BR", publisher: { "@id": `${SITE}/#organizacao` } };
  const saida = [["blog/index.html", pagina({
    arquivo: "blog/index.html",
    titulo: "Blog do LicitaPlena: licitação explicada em português simples",
    descricao: "Artigos práticos sobre licitação: como achar editais, documentos de habilitação, obras, CBS e IBS, pregão, recurso e novidades, com a lei e a fonte oficial.",
    migalhas: [["Início", "/"], ["Blog", "/blog/"]],
    schemas: [blogSchema],
    corpo: `<div class="cat-cab">${imgCapa("novidades", "cat-capa", false)}<div class="cat-texto"><p class="rotulo">Blog do LicitaPlena</p><h1>Licitação explicada em português simples</h1><p class="lead">Com a lei e a fonte oficial de cada regra, para quem vende ou quer vender ao governo.</p></div></div>${navCat()}${lista(artigos)}${chamada()}`,
  })]];
  for (const [s, n] of Object.entries(CATEGORIAS)) {
    const itens = artigos.filter((a) => a.categoria === s);
    saida.push([`blog/categoria/${s}.html`, pagina({
      arquivo: `blog/categoria/${s}.html`,
      titulo: `${n}: artigos sobre licitação | LicitaPlena`,
      descricao: `Artigos do LicitaPlena sobre ${n.toLowerCase()} em licitações públicas, em português simples e com a fonte oficial de cada regra.`,
      migalhas: [["Início", "/"], ["Blog", "/blog/"], [n, `/blog/categoria/${s}`]],
      schemas: [{ "@type": "CollectionPage", name: n, url: `${SITE}/blog/categoria/${s}`, isPartOf: { "@id": `${SITE}/blog/#blog` }, image: `${SITE}/blog/capas/${s}.jpg` }],
      imagem: `/blog/capas/${s}.jpg`,
      corpo: `<div class="cat-cab">${imgCapa(s, "cat-capa", false)}<div class="cat-texto"><p class="rotulo">Categoria do blog</p><h1>${esc(n)}</h1><p class="lead">${itens.length} ${itens.length === 1 ? "artigo" : "artigos"} nesta categoria, em português simples e com a fonte oficial de cada regra.</p></div></div>${navCat(s)}${itens.length ? lista(itens) : '<p class="texto">Os primeiros artigos desta categoria saem em breve. Enquanto isso, veja <a href="/blog/">todos os artigos</a>.</p>'}${chamada()}`,
    })]);
  }
  for (const a of artigos) {
    const f = a.ferramenta;
    const outros = artigos.filter((b) => b.slug !== a.slug).sort((x, y) => (y.categoria === a.categoria) - (x.categoria === a.categoria)).slice(0, 3);
    const { html: corpo, itens: sumario } = comSumario(a.corpo);
    saida.push([`blog/${a.slug}.html`, pagina({
      arquivo: `blog/${a.slug}.html`, titulo: a.titulo, descricao: a.descricao, tipoOg: "article", imagem: `/blog/capas/${a.slug}.jpg`,
      migalhas: [["Início", "/"], ["Blog", "/blog/"], [CATEGORIAS[a.categoria], `/blog/categoria/${a.categoria}`], [a.titulo, `/blog/${a.slug}`]],
      schemas: [{
        "@type": "Article", headline: a.titulo, description: a.descricao, datePublished: a.data, dateModified: a.data, inLanguage: "pt-BR",
        author: { "@type": "Organization", name: "Equipe LicitaPlena", url: `${SITE}/sobre` }, publisher: { "@id": `${SITE}/#organizacao` },
        mainEntityOfPage: `${SITE}/blog/${a.slug}`, image: `${SITE}/blog/capas/${a.slug}.jpg`, articleSection: CATEGORIAS[a.categoria], isPartOf: { "@id": `${SITE}/blog/#blog` },
      }],
      corpo: `<article class="artigo"><header class="artigo-cab"><a class="selo-cat" href="/blog/categoria/${a.categoria}">${esc(CATEGORIAS[a.categoria])}</a><h1>${esc(a.titulo)}</h1><p class="lead">${esc(a.descricao)}</p>
<p class="meta-artigo"><span>Por Equipe LicitaPlena</span><span><time datetime="${a.data}">${dataBr(a.data)}</time></span><span>${a.minutos} min de leitura</span></p></header>
<figure class="artigo-capa">${imgCapa(a.slug, "capa", false)}</figure>
<div class="artigo-grade">${sumario.length > 1 ? `<nav class="sumario" aria-label="Neste artigo"><p class="sumario-titulo">Neste artigo</p><ol>${sumario.map(([id, t]) => `<li><a href="#${id}">${esc(t)}</a></li>`).join("")}</ol></nav>` : ""}
<div class="texto">${corpo}
<section class="chamada chamada-ferramenta" aria-label="Ferramenta relacionada"><p class="rotulo">Ferramenta relacionada</p><h2><a href="${f}">${esc(a.ferramentaNome)}</a></h2><p>Veja como o LicitaPlena ajuda nesta etapa.</p></section>
${chamada()}</div></div>
<h2 class="relacionados-titulo">Continue lendo</h2><ul class="grade grade-artigos">${outros.map((b) => cartaoArtigo(b)).join("")}</ul></article>`,
    })]);
  }
  return saida;
}

function paginasInstitucionais() {
  const glossario = pagina({
    arquivo: "glossario.html",
    titulo: "Glossário de licitação: termos explicados em português simples",
    descricao: "O que é PNCP, pregão, habilitação, BDI, SICAF, empate ficto, impugnação, recurso e outros termos de licitação, explicados com a base na lei.",
    migalhas: [["Início", "/"], ["Glossário", "/glossario"]],
    schemas: [{ "@type": "DefinedTermSet", name: "Glossário de licitação", url: `${SITE}/glossario`, hasDefinedTerm: GLOSSARIO.map(([t, d]) => ({ "@type": "DefinedTerm", name: t, description: d })) }],
    corpo: `<div class="estreito"><h1>Glossário de licitação</h1><p class="lead">Os termos que mais aparecem em edital e pregão, em poucas palavras. Os artigos citados são da Lei 14.133/2021, salvo quando indicado.</p>
<dl class="glossario">${GLOSSARIO.map(([t, d]) => `<dt id="${t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}">${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>
<p class="texto">Leia a lei completa no <a href="https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm" target="_blank" rel="noopener">site do Planalto</a>.</p>${chamada()}</div>`,
  });
  const sobre = pagina({
    arquivo: "sobre.html",
    titulo: "Sobre o LicitaPlena: quem somos e como trabalhamos",
    descricao: "O LicitaPlena é um sistema de licitações da HCM LTDA, de Manaus/AM, parceiro da HC Licitações. Dados oficiais, preço público e nenhuma promessa de vitória.",
    migalhas: [["Início", "/"], ["Sobre", "/sobre"]],
    schemas: [{ "@type": "AboutPage", name: "Sobre o LicitaPlena", url: `${SITE}/sobre`, about: { "@id": `${SITE}/#organizacao` } }, SOFTWARE],
    corpo: `<div class="estreito texto"><h1>Sobre o LicitaPlena</h1><p class="lead">Um sistema para empresas e assessorias que vendem ao governo encontrarem, entenderem e acompanharem licitações públicas.</p>
<h2>Quem somos</h2><p>O LicitaPlena é desenvolvido e operado pela HCM LTDA, CNPJ nº 28.786.260/0001-53, com sede em Manaus/AM. É uma solução da HC Licitações, assessoria parceira que acompanha empresas em licitações.</p>
<h2>De onde vêm os dados</h2><ul><li>Licitações, atas e contratos: PNCP (Portal Nacional de Contratações Públicas).</li><li>Preços praticados: Compras.gov.</li><li>Convênios, emendas, despesas e sanções: Portal da Transparência.</li><li>Dados de empresas: cadastros públicos da Receita Federal.</li></ul><p>São dados públicos e oficiais, coletados automaticamente todos os dias.</p>
<h2>Como trabalhamos</h2><ul><li>Sem promessa de vitória: ninguém pode garantir que você vai ganhar uma licitação.</li><li>Preço público, na página de planos, sem precisar falar com vendedor.</li><li>Teste grátis de 14 dias, sem cartão de crédito.</li><li>Nenhum agente envia proposta, dá lance ou protocola nada sem o seu OK.</li><li>A IA é um apoio de leitura: confira sempre o edital original.</li></ul>
<h2>Fale com a gente</h2><p>Veja a página de <a href="/contato">contato</a>. Quer que alguém cuide da licitação por você? Conheça a <a href="/assessoria-hc">assessoria HC Licitações</a>.</p>${chamada()}</div>`,
  });
  const contato = pagina({
    arquivo: "contato.html",
    titulo: "Contato do LicitaPlena: e-mail e WhatsApp",
    descricao: "Fale com o LicitaPlena por e-mail ou WhatsApp. Dúvidas sobre o sistema, planos, teste grátis de 14 dias ou cancelamento.",
    migalhas: [["Início", "/"], ["Contato", "/contato"]],
    schemas: [{ "@type": "ContactPage", name: "Contato do LicitaPlena", url: `${SITE}/contato`, about: { "@id": `${SITE}/#organizacao` } }],
    corpo: `<div class="estreito texto"><h1>Contato</h1><p class="lead">Dúvida sobre o sistema, os planos ou o teste grátis? Fale com a gente.</p>
<ul class="grade"><li class="cartao"><h2>E-mail</h2><p>Para dúvidas, pedidos e cancelamento (a partir do e-mail cadastrado).</p><a class="ir" href="mailto:${EMAIL}">${EMAIL}</a></li>
<li class="cartao"><h2>WhatsApp</h2><p>Atendimento em horário comercial de Manaus/AM.</p><a class="ir" href="${ZAP_SUPORTE}" target="_blank" rel="noopener">Falar no WhatsApp</a></li></ul>
<h2>Empresa</h2><p>HCM LTDA, CNPJ nº 28.786.260/0001-53, Manaus/AM.</p><p>Quer que alguém faça a licitação por você? Veja a <a href="/assessoria-hc">assessoria HC Licitações</a>.</p>${chamada()}</div>`,
  });
  const hc = pagina({
    arquivo: "assessoria-hc.html",
    titulo: "Assessoria em licitações HC Licitações | LicitaPlena",
    descricao: "Precisa de quem faça por você? A HC Licitações, parceira do LicitaPlena, acompanha o processo: edital, proposta, documentos, lances e recursos.",
    migalhas: [["Início", "/"], ["Assessoria HC", "/assessoria-hc"]],
    schemas: [{ "@type": "WebPage", name: "Assessoria HC Licitações", url: `${SITE}/assessoria-hc`, about: { "@type": "Organization", name: "HC Licitações", url: HC_SITE } }],
    corpo: `<div class="estreito texto"><h1>Precisa de quem faça por você?</h1><p class="lead">O LicitaPlena ajuda você a achar e organizar as licitações. Quando você quer alguém acompanhando de perto, a HC Licitações, empresa parceira do LicitaPlena, faz junto com você.</p>
<h2>Assessoria em licitações</h2><p>Acompanhamento do processo, do edital à entrega: análise do edital, proposta, documentos de habilitação, lances e recursos.</p>
<h2>Cursos e treinamento</h2><p>Para quem está começando e para quem quer perder menos licitações: do cadastro no Compras.gov até a proposta e o lance.</p>
<h2>Suporte jurídico</h2><p>Desclassificação, recurso, impugnação ou contrato: orientação com apoio jurídico especializado em licitações.</p>
<div class="acoes" style="margin-top:24px"><a class="btn btn-pri btn-g" href="${ZAP_HC}" target="_blank" rel="noopener">Falar com a HC no WhatsApp</a><a class="btn btn-sec btn-g" href="${HC_SITE}" target="_blank" rel="noopener">Conhecer o site da HC</a></div>
<p>A HC Licitações é uma empresa independente do sistema: contratar a assessoria é opcional e não muda o seu plano do LicitaPlena.</p>
<section class="chamada" aria-label="Teste grátis"><h2>Prefere fazer você mesmo?</h2><p>Teste o LicitaPlena por 14 dias, sem cartão de crédito.</p><div class="acoes"><a href="/cadastro" class="btn btn-pri btn-g">Teste grátis 14 dias</a></div></section></div>`,
  });
  const naoEncontrada = pagina({
    arquivo: "404.html", indexar: false,
    titulo: "Página não encontrada | LicitaPlena",
    descricao: "Esta página não existe ou mudou de endereço.",
    corpo: `<div class="estreito texto"><h1>Página não encontrada</h1><p class="lead">O endereço que você abriu não existe ou mudou de lugar.</p>
<h2>Talvez você procure</h2><ul><li><a href="/">Página inicial</a></li><li><a href="/login">Entrar no sistema</a></li><li><a href="/cadastro">Teste grátis de 14 dias</a></li><li><a href="/ferramentas/">Ferramentas</a></li><li><a href="/blog/">Blog</a></li><li><a href="/contato">Contato</a></li></ul></div>`,
  });
  return [["glossario.html", glossario], ["sobre.html", sobre], ["contato.html", contato], ["assessoria-hc.html", hc], ["404.html", naoEncontrada]];
}

// ---------- index.html: blocos marcados ----------
function trocarBloco(html, nome, conteudo) {
  const re = new RegExp(`(<!-- gerado:${nome} -->)[\\s\\S]*?(<!-- /gerado:${nome} -->)`);
  if (!re.test(html)) throw new Error(`index.html: faltam os marcadores <!-- gerado:${nome} --> e <!-- /gerado:${nome} -->`);
  return html.replace(re, (_, a, b) => `${a}\n${conteudo}\n${b}`);
}

// O FAQPage do index sai das próprias perguntas da seção #perguntas, para o schema nunca divergir do que aparece.
function faqDoIndex(html) {
  const secao = html.slice(html.indexOf('id="perguntas"'), html.indexOf("</section>", html.indexOf('id="perguntas"')));
  const texto = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return [...secao.matchAll(/<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map(([, q, r]) => [texto(q), texto(r)]);
}

function montarIndex(html, artigos) {
  const titulo = html.match(/<title>([^<]*)<\/title>/)[1];
  const descricao = html.match(/<meta name="description" content="([^"]*)"/)[1];
  const cabeca = [`<link rel="canonical" href="${SITE}/">`, '<meta property="og:type" content="website">', '<meta property="og:site_name" content="LicitaPlena">',
    '<meta property="og:locale" content="pt_BR">', `<meta property="og:title" content="${titulo}">`, `<meta property="og:description" content="${descricao}">`,
    `<meta property="og:url" content="${SITE}/">`, `<meta property="og:image" content="${SITE}/logo.png">`, '<meta name="twitter:card" content="summary">',
    jsonld({ "@context": "https://schema.org", "@graph": [ORGANIZACAO, { "@type": "WebSite", "@id": `${SITE}/#site`, name: "LicitaPlena", url: `${SITE}/`, inLanguage: "pt-BR", publisher: { "@id": `${SITE}/#organizacao` } }, SOFTWARE, faqSchema(faqDoIndex(html))] })].join("\n");
  const blog = `<ul class="grade-blog">${artigos.slice(0, 3).map((a) => `<li>${imgCapa(a.slug, "grade-blog-capa")}<p class="sobretitulo">${esc(CATEGORIAS[a.categoria])}</p><h3><a href="/blog/${a.slug}">${esc(a.titulo)}</a></h3><p>${esc(a.resumo)}</p></li>`).join("")}</ul>`;
  let saida = trocarBloco(html, "seo-cabeca", cabeca);
  saida = trocarBloco(saida, "do-blog", blog);
  saida = trocarBloco(saida, "ferramentas", `<ul class="ferr-grade">${FERRAMENTAS.map((f) => cartaoFerramenta(f)).join("")}</ul>`);
  return trocarBloco(saida, "mapa-do-site", mapaDoSite());
}

// ---------- sitemap e robots ----------
function sitemap(arquivosGerados, artigos) {
  const datas = Object.fromEntries(artigos.map((a) => [`blog/${a.slug}.html`, a.data]));
  const todos = [...PUBLICAS_EXISTENTES, ...arquivosGerados.filter((a) => a.endsWith(".html") && a !== "404.html")];
  const urls = todos.map((a) => `  <url><loc>${SITE}${urlDe(a)}</loc><lastmod>${datas[a] || DATA_ATUALIZACAO}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

const robots = () => `# Robôs de busca e de IA podem ler o site público. As telas do sistema logado ficam de fora.
User-agent: *
${PRIVADAS.map((p) => `Disallow: ${p}`).join("\n")}
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

// Devolve { caminhoRelativo: conteúdo } sem gravar nada (o teste compara com o que está no disco).
function gerar() {
  const artigos = lerArtigos();
  const paginas = [...paginasFerramentas(artigos), ...paginasPublicos(artigos), ...paginasBlog(artigos), ...paginasInstitucionais()];
  const saida = Object.fromEntries(paginas);
  saida["sitemap.xml"] = sitemap(Object.keys(saida), artigos);
  saida["robots.txt"] = robots();
  saida["index.html"] = montarIndex(fs.readFileSync(path.join(RAIZ, "index.html"), "utf8"), artigos);
  return saida;
}

if (require.main === module) {
  const saida = gerar();
  for (const [rel, conteudo] of Object.entries(saida)) {
    fs.mkdirSync(path.dirname(path.join(RAIZ, rel)), { recursive: true });
    fs.writeFileSync(path.join(RAIZ, rel), conteudo);
  }
  console.log(`${Object.keys(saida).length} arquivos gerados`);
}

module.exports = { gerar, urlDe, lerArtigos, CATEGORIAS, SITE, PRIVADAS, PUBLICAS_EXISTENTES };
