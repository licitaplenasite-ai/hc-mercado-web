// Último passo dos workflows (só quando tudo deu certo): grava "este robô rodou bem agora" em
// public.robos_batimento (supabase/admin_painel.sql), que a aba "Saúde do sistema" do admin lê.
//   node scripts/registrar_robo.js <robo>      robo: pncp, ufs, mercado, prospeccao, sancoes, boletim, lembretes,
//                                              cobranca, bases_obra, vigia_normas
// Env: SUPABASE_SERVICE_ROLE_KEY. Falhar aqui não derruba o robô (o trabalho dele já foi feito): só avisa no log,
// e o admin acaba mostrando o robô como atrasado, que é o sinal certo para olhar.
const { restFetch } = require("./supabase_dados");

const ROBOS = ["pncp", "ufs", "mercado", "prospeccao", "sancoes", "boletim", "lembretes", "cobranca", "bases_obra", "vigia_normas"];

async function registrar(robo, fetchRest = restFetch) {
  if (!ROBOS.includes(robo)) throw new Error(`robô desconhecido: ${robo}`);
  const resp = await fetchRest("rpc/robo_registrar_sucesso", { method: "POST", body: JSON.stringify({ p_robo: robo }) });
  return resp.json();
}

if (require.main === module) {
  registrar(process.argv[2])
    .then((r) => console.log(`Batimento gravado: ${JSON.stringify(r)}`))
    .catch((e) => console.warn(`AVISO: batimento não gravado (${e.message}).`));
}

module.exports = { registrar, ROBOS };
