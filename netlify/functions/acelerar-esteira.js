// Pede que os robôs da esteira rodem agora (dossiê do edital + itens/exigências), em vez de esperar o cron.
//   POST /api/acelerar-esteira  (Authorization: Bearer <sessão>)
// Resposta: { ok: true, disparados: [...] } — vazio quando GITHUB_DISPARO_TOKEN não está configurado.
// Chamado pelo checklist do processo (checklist-esteira-ui.js) quando uma etapa está na fila. Não lê nem
// grava dado do cliente: só dispara workflows (ver _disparo_robos.js). Login aprovado e ritmo por conta
// (2 por minuto) porque cada disparo consome minutos do Actions.
const { cabecalhosPadrao, exigirUsuarioAprovado, limitarContaPorMinuto } = require("./_auth");
const { dispararWorkflows } = require("./_disparo_robos");

const WORKFLOWS = ["gerar-dossies.yml", "esteira.yml"];

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const resposta = (status, body) => ({ statusCode: status, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return resposta(204, {});
  if (event.httpMethod !== "POST") return resposta(405, { erro: "Método não permitido." });
  const usuario = await exigirUsuarioAprovado(event);
  if (!usuario.ok) return resposta(usuario.status, { erro: usuario.erro });
  const ritmo = await limitarContaPorMinuto(usuario.userId, "acelerar-esteira", 2);
  if (!ritmo.ok) return resposta(ritmo.status, { erro: ritmo.erro });
  const { disparados } = await dispararWorkflows(WORKFLOWS);
  return resposta(200, { ok: true, disparados });
};
