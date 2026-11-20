// Gera o par de chaves VAPID do aviso no celular e grava num arquivo FORA do repositório.
//   node scripts/gerar_chaves_vapid.js [arquivo]   (padrão: %USERPROFILE%\.licitaplena-segredos\vapid.txt)
// Não imprime chave nenhuma: o dono abre o arquivo e cola cada valor no lugar indicado nele.
// Não sobrescreve um arquivo existente (trocar a chave invalida todos os celulares inscritos).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { gerarChaves } = require("./web_push");

const REPO = path.resolve(__dirname, "..");
const destino = path.resolve(process.argv[2] || path.join(os.homedir(), ".licitaplena-segredos", "vapid.txt"));
if (destino === REPO || destino.startsWith(REPO + path.sep)) {
  console.error("Recusado: o arquivo de chaves não pode ficar dentro do repositório.");
  process.exit(1);
}
if (fs.existsSync(destino)) {
  console.error(`Já existe ${destino}. Apague à mão só se quiser trocar as chaves (os celulares terão de ativar de novo).`);
  process.exit(1);
}
const { publica, privada } = gerarChaves();
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, [
  "# Chaves do aviso no celular (Web Push / VAPID) do LicitaPlena. NÃO colocar no repositório nem mandar por chat.",
  "# GitHub > Settings > Secrets and variables > Actions > New repository secret: as duas linhas abaixo.",
  "# Cloudflare Pages > Settings > Variables and Secrets (Production): só VAPID_CHAVE_PUBLICA (a privada não vai ao site).",
  `VAPID_CHAVE_PUBLICA=${publica}`,
  `VAPID_CHAVE_PRIVADA=${privada}`,
  "",
].join("\n"), { mode: 0o600 });
console.log(`Chaves gravadas em ${destino}`);
