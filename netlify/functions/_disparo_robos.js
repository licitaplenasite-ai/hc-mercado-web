// Dispara na hora os robôs do GitHub Actions (workflow_dispatch) quando há pedido de cliente esperando.
//
// Por quê (incidente 23/11): o pedido de processo do cliente (fila_dossies, origem 'interesse') dependia
// do cron do GitHub, que descarta rodadas em horário de pico, e do gatilho após a coleta, que estava
// sendo pulado; o processo ficou horas em "Na fila…". Com este disparo o gerar-dossies (que encadeia o
// esteira pelo workflow_run) sai em segundos.
//
// Config (fora do código; sem ela nada é disparado e ninguém vê erro — o cron continua valendo):
//   GITHUB_DISPARO_TOKEN  token fine-grained só deste repositório, permissão "Actions: Read and write"
//   GITHUB_DISPARO_REPO   dono/repositório (padrão licitaplenasite-ai/hc-mercado-web)
//   GITHUB_DISPARO_REF    branch (padrão main)
// Pedidos repetidos não empilham robôs: os workflows têm concurrency com cancel-in-progress false, e o
// GitHub mantém no máximo UMA execução pendente por grupo (a nova substitui a anterior na espera).
const REPO_PADRAO = "licitaplenasite-ai/hc-mercado-web";

async function dispararWorkflows(arquivos, { env = process.env, fetchFn = (...a) => fetch(...a) } = {}) {
  const token = env.GITHUB_DISPARO_TOKEN;
  if (!token) return { configurado: false, disparados: [] };
  const repo = env.GITHUB_DISPARO_REPO || REPO_PADRAO;
  const disparados = [];
  for (const arquivo of arquivos) {
    try {
      const resposta = await fetchFn(`https://api.github.com/repos/${repo}/actions/workflows/${arquivo}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json", "User-Agent": "licitaplena-site" },
        body: JSON.stringify({ ref: env.GITHUB_DISPARO_REF || "main" }),
        signal: globalThis.AbortSignal.timeout(5000),
      });
      // 204 = aceito. Outro status só vai para o log: o cron segue como rede de segurança.
      if (resposta.status === 204) disparados.push(arquivo);
      else console.warn(`disparo-robos: ${arquivo} HTTP ${resposta.status}`);
    } catch (e) {
      console.warn(`disparo-robos: ${arquivo} sem resposta (${e && e.name})`);
    }
  }
  return { configurado: true, disparados };
}

module.exports = { dispararWorkflows };
