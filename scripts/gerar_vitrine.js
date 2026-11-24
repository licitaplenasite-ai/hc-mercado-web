// Telas do sistema mostradas no site público (index "Do edital publicado à proposta organizada" e /ferramentas/*).
// Fonte: prints 1280x800 do sistema novo com dados FICTÍCIOS (empresa "Horizonte Suprimentos Ltda").
// Uso: node scripts/gerar_vitrine.js <pasta com vitrine-*.png>
//      node scripts/gerar_vitrine.js --ajuda <pasta com <nome>.png>  -> prints da Central de ajuda em ajuda/<nome>.webp (1280x800)
// Recorta só a parte relevante de cada ferramenta (sem o menu lateral) e grava img/vitrine/<nome>-<largura>.webp
// em duas larguras (tela cheia e celular), cada uma abaixo de 200 KB. Na pesquisa de preços o recorte deixa de
// fora a coluna de marcas, que são marcas reais de produtos.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const RAIZ = path.join(__dirname, "..");
const LIMITE_BYTES = 200 * 1024;
// [nome, arquivo de origem, [x, y, largura, altura] do recorte no print 1280x800]
const VITRINE = [
  ["boletim", "vitrine-boletim.png", [232, 40, 840, 480]],
  ["boletim-escuro", "vitrine-boletim-escuro.png", [232, 40, 840, 480]],
  ["resumo", "vitrine-processo-resumo.png", [232, 40, 760, 520]],
  ["precos", "vitrine-pesquisa-precos.png", [470, 255, 770, 470]],
  ["documentos", "vitrine-documentos.png", [232, 48, 840, 480]],
  ["orcamento", "vitrine-orcamento-obra.png", [232, 40, 1048, 600]],
  ["resumo-edital", "vitrine-r02-gaveta-resumo.png", [200, 0, 1080, 620]],
  ["contador", "vitrine-c16-contador.png", [330, 225, 850, 520]],
  ["concorrente", "vitrine-p09-concorrente.png", [262, 60, 1010, 580]],
  ["vigia", "vitrine-vigia.png", [0, 0, 840, 640]], // palco 840x640 com o popup da extensão
];
const LARGURAS = [1048, 640]; // a maior vira a largura do recorte quando ele é menor

async function abrirNavegador() {
  try { return await chromium.launch(); } catch { return chromium.launch({ channel: "chrome" }); }
}

// Central de ajuda: cada print 1280x800 (marcações numeradas já desenhadas) vira ajuda/<nome>.webp do mesmo tamanho.
async function gerarAjuda(pagina, origem) {
  for (const arquivo of fs.readdirSync(origem).filter((f) => f.endsWith(".png") && !f.startsWith("vitrine-"))) {
    const src = `data:image/png;base64,${fs.readFileSync(path.join(origem, arquivo)).toString("base64")}`;
    const b64 = await pagina.evaluate(async (src) => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.toDataURL("image/webp", 0.82).split(",")[1];
    }, src);
    const buf = Buffer.from(b64, "base64");
    const rel = `ajuda/${arquivo.replace(/\.png$/, ".webp")}`;
    if (buf.length > LIMITE_BYTES) throw new Error(`${rel}: ${Math.round(buf.length / 1024)} KB passa de 200 KB`);
    fs.writeFileSync(path.join(RAIZ, rel), buf);
    console.log(`${String(Math.round(buf.length / 1024)).padStart(4)} KB  ${rel}`);
  }
}

async function main() {
  const ajuda = process.argv[2] === "--ajuda";
  const origem = process.argv[ajuda ? 3 : 2];
  if (!origem || !fs.existsSync(origem)) throw new Error("informe a pasta dos prints: node scripts/gerar_vitrine.js <pasta>");
  const navegador = await abrirNavegador();
  const pagina = await navegador.newPage();
  if (ajuda) { await gerarAjuda(pagina, origem); await navegador.close(); return; }
  fs.mkdirSync(path.join(RAIZ, "img", "vitrine"), { recursive: true });
  for (const [nome, arquivo, [x, y, w, h]] of VITRINE) {
    const src = `data:image/png;base64,${fs.readFileSync(path.join(origem, arquivo)).toString("base64")}`;
    for (const largura of LARGURAS) {
      const alvo = Math.min(largura, w), altura = Math.round(h * alvo / w);
      const b64 = await pagina.evaluate(async ({ src, x, y, w, h, alvo, altura }) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = document.createElement("canvas"); c.width = alvo; c.height = altura;
        const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, x, y, w, h, 0, 0, alvo, altura);
        return c.toDataURL("image/webp", 0.82).split(",")[1];
      }, { src, x, y, w, h, alvo, altura });
      const buf = Buffer.from(b64, "base64");
      const rel = `img/vitrine/${nome}-${alvo}.webp`; // nome pela largura real (vai no srcset)
      if (buf.length > LIMITE_BYTES) throw new Error(`${rel}: ${Math.round(buf.length / 1024)} KB passa de 200 KB`);
      fs.writeFileSync(path.join(RAIZ, rel), buf);
      console.log(`${String(Math.round(buf.length / 1024)).padStart(4)} KB  ${rel}  (${alvo}x${altura})`);
    }
  }
  await navegador.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
