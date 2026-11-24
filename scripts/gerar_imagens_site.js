/* global document, Image -- usados só dentro de page.evaluate (roda no navegador) */
// Imagens do site público (rodada 2 do visual, 23/11): recorta e otimiza as fotos de scripts/site-publico/capas.js.
// Uso: node scripts/gerar_imagens_site.js <pasta-com-as-fotos-originais.jpg>
//   (originais geradas no Google Flow, nomes em img/CREDITOS.md; não ficam no repositório para não pesar o git)
// Saída:
//   img/topo/<foto>-800.webp e -1600.webp  fundo da primeira tela do index (< 200 KB cada)
//   img/fotos/<foto>-960.webp               fotos de seção (moldura) e da tela de entrar
//   blog/capas/<chave>.webp                 capa na tela (1200x630, só foto)
//   blog/capas/<chave>.jpg                  og:image 1200x630 com marca, categoria e título
// Rode de novo quando entrar artigo ou categoria nova. Usa o Playwright (devDependency) e o WebP do Chrome.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { CAPAS_CATEGORIA, CAPAS_ARTIGO, FOTOS_TOPO } = require("./site-publico/capas");
const { lerArtigos, CATEGORIAS } = require("./gerar_site_publico");

const RAIZ = path.join(__dirname, "..");
const LIMITE_BYTES = 200 * 1024; // pedido do dono: no máximo 200 KB por imagem
const FOTOS_SECAO = ["escritorio", "documentos", "topo-contrato", "papelaria", "construcao", "servicos"];

async function abrirNavegador() {
  try { return await chromium.launch(); } catch { return chromium.launch({ channel: "chrome" }); }
}

const dataUrl = (arquivo) => `data:image/jpeg;base64,${fs.readFileSync(arquivo).toString("base64")}`;
function gravar(rel, buffer) {
  const destino = path.join(RAIZ, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buffer);
  if (buffer.length > LIMITE_BYTES) throw new Error(`${rel}: ${Math.round(buffer.length / 1024)} KB passa de 200 KB`);
  return buffer.length;
}

// Recorte "cover" no canvas do Chrome e exportação em WebP.
async function webp(pagina, foto, largura, altura, foco, qualidade) {
  const b64 = await pagina.evaluate(async ({ src, largura, altura, foco, qualidade }) => {
    const img = new Image(); img.src = src; await img.decode();
    const [fx, fy] = foco.split(" ").map((v) => parseFloat(v) / 100);
    const escala = Math.max(largura / img.naturalWidth, altura / img.naturalHeight);
    const w = img.naturalWidth * escala, h = img.naturalHeight * escala;
    const c = document.createElement("canvas"); c.width = largura; c.height = altura;
    const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (largura - w) * fx, (altura - h) * fy, w, h);
    // Leve tom azulado: post-it, copo e luminária quentes das fotos do Flow não destoam da paleta só azul (rodada 3).
    ctx.globalCompositeOperation = "color"; ctx.globalAlpha = 0.16; ctx.fillStyle = "#1f4fd8"; ctx.fillRect(0, 0, largura, altura);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    return c.toDataURL("image/webp", qualidade).split(",")[1];
  }, { src: foto, largura, altura, foco, qualidade });
  return Buffer.from(b64, "base64");
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const LOGO = `data:image/svg+xml;base64,${fs.readFileSync(path.join(RAIZ, "logo-icone-branco.svg")).toString("base64")}`;
function htmlCapaOg(foto, foco, rotulo, titulo) {
  return `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@600;700&display=block" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:Inter,sans-serif}
.f{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${foco}}
.tom{position:absolute;inset:0;background:#1f4fd8;mix-blend-mode:color;opacity:.16}
.v{position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,27,79,.97) 0%,rgba(10,27,79,.9) 40%,rgba(10,27,79,.22) 72%,rgba(10,27,79,0) 100%)}
.l{position:absolute;left:0;right:0;bottom:0;height:8px;background:linear-gradient(90deg,#1f4fd8,#22d3ee)}
.t{position:absolute;left:72px;top:64px;width:620px;color:#fff}
.m{display:flex;align-items:center;gap:12px;font-weight:700;font-size:26px}.m img{width:40px;height:40px}
.r{margin:96px 0 18px;color:#22d3ee;font-weight:700;font-size:22px;letter-spacing:.02em}
h1{margin:0;font:600 58px/1.08 Fraunces,serif;letter-spacing:-.01em}</style></head>
<body><img class="f" src="${foto}"><div class="tom"></div><div class="v"></div><div class="l"></div><div class="t"><div class="m"><img src="${LOGO}">LicitaPlena</div><p class="r">${esc(rotulo)}</p><h1>${esc(titulo)}</h1></div></body></html>`;
}

async function main() {
  const origem = process.argv[2];
  if (!origem || !fs.existsSync(origem)) throw new Error("informe a pasta das fotos originais: node scripts/gerar_imagens_site.js <pasta>");
  const foto = (nome) => { const a = path.join(origem, `${nome}.jpg`); if (!fs.existsSync(a)) throw new Error(`falta ${a}`); return dataUrl(a); };
  const navegador = await abrirNavegador();
  const pagina = await navegador.newPage({ viewport: { width: 1200, height: 630 } });
  const relatorio = [];

  for (const [nome, foco] of FOTOS_TOPO) {
    relatorio.push([`img/topo/${nome}-1600.webp`, gravar(`img/topo/${nome}-1600.webp`, await webp(pagina, foto(nome), 1600, 1000, foco, 0.7))]);
    relatorio.push([`img/topo/${nome}-800.webp`, gravar(`img/topo/${nome}-800.webp`, await webp(pagina, foto(nome), 800, 1000, foco, 0.7))]);
  }
  for (const nome of FOTOS_SECAO) relatorio.push([`img/fotos/${nome}-960.webp`, gravar(`img/fotos/${nome}-960.webp`, await webp(pagina, foto(nome), 960, 720, "50% 50%", 0.76))]);

  const artigos = Object.fromEntries(lerArtigos().map((a) => [a.slug, a]));
  const capas = [
    ...Object.entries(CAPAS_CATEGORIA).map(([chave, c]) => [chave, c, "Blog do LicitaPlena", CATEGORIAS[chave]]),
    ...Object.entries(CAPAS_ARTIGO).map(([chave, c]) => [chave, c, CATEGORIAS[artigos[chave].categoria], artigos[chave].titulo]),
  ];
  for (const [chave, { foto: nome, foco }, rotulo, titulo] of capas) {
    relatorio.push([`blog/capas/${chave}.webp`, gravar(`blog/capas/${chave}.webp`, await webp(pagina, foto(nome), 1200, 630, foco, 0.72))]);
    await pagina.setContent(htmlCapaOg(foto(nome), foco, rotulo, titulo), { waitUntil: "networkidle" });
    await pagina.evaluate(() => document.fonts.ready);
    relatorio.push([`blog/capas/${chave}.jpg`, gravar(`blog/capas/${chave}.jpg`, await pagina.screenshot({ type: "jpeg", quality: 80 }))]);
  }
  await navegador.close();
  for (const [rel, bytes] of relatorio) console.log(`${String(Math.round(bytes / 1024)).padStart(4)} KB  ${rel}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
