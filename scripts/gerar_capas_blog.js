// Converte as capas do blog (blog/capas/*.svg, feitas por scripts/gerar_site_publico.js) em .jpg 1200x630
// para o og:image: WhatsApp, Facebook e LinkedIn não mostram SVG na prévia do link.
// Uso: node scripts/gerar_site_publico.js && node scripts/gerar_capas_blog.js
// Rode de novo só quando uma capa mudar (novo artigo ou categoria). Usa o Playwright (devDependency);
// se o Chromium do Playwright não estiver baixado, tenta o Chrome instalado na máquina.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const PASTA = path.join(__dirname, "..", "blog", "capas");
const LIMITE_BYTES = 120 * 1024; // pedido do dono: imagem do blog abaixo de 120 KB

async function abrirNavegador() {
  try { return await chromium.launch(); } catch { return chromium.launch({ channel: "chrome" }); }
}

async function main() {
  const svgs = fs.readdirSync(PASTA).filter((n) => n.endsWith(".svg"));
  const navegador = await abrirNavegador();
  const pagina = await navegador.newPage({ viewport: { width: 1200, height: 630 } });
  for (const nome of svgs) {
    const svg = fs.readFileSync(path.join(PASTA, nome), "utf8");
    await pagina.setContent(`<body style="margin:0">${svg}</body>`);
    const destino = path.join(PASTA, nome.replace(/\.svg$/, ".jpg"));
    await pagina.screenshot({ path: destino, type: "jpeg", quality: 82, clip: { x: 0, y: 0, width: 1200, height: 630 } });
    const tamanho = fs.statSync(destino).size;
    if (tamanho > LIMITE_BYTES) throw new Error(`${nome}: ${Math.round(tamanho / 1024)} KB passa do limite de 120 KB`);
  }
  await navegador.close();
  console.log(`${svgs.length} capas .jpg em blog/capas/`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
