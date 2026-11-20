// Proxies do governo exigem login aprovado desde 20/11 (_auth.js, exigirAprovadoComLimite).
// comLogin(fetchDoTeste) responde sozinho às 2 consultas do Supabase (sessão e cadastro) e repassa o resto,
// para o teste continuar vendo só as chamadas ao PNCP/Compras.gov. logado(evento) põe o token no evento;
// comoLogado(handler) junta os dois.
const SUPABASE = "https://lsqjamqvmrcyrvowndiu.supabase.co";

function comLogin(fetchDoTeste, status = "aprovado") {
  return async (url, op) => {
    const u = String(url);
    if (u.startsWith(`${SUPABASE}/auth/v1/user`)) return new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000001" }));
    if (u.startsWith(`${SUPABASE}/rest/v1/clientes?`)) return new Response(JSON.stringify([{ status }]));
    return fetchDoTeste(url, op);
  };
}

const logado = (evento = {}) => ({ ...evento, headers: { ...(evento.headers || {}), authorization: "Bearer teste" } });

// Handler chamado como usuário aprovado, sem mudar o fetch falso que cada teste monta.
const comoLogado = (handler) => async (evento) => {
  const fetchDoTeste = global.fetch;
  global.fetch = comLogin(fetchDoTeste);
  try { return await handler(logado(evento)); } finally { global.fetch = fetchDoTeste; }
};

module.exports = { comLogin, logado, comoLogado };
