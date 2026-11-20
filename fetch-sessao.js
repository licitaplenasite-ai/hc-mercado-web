/* global SUPABASE_URL, module, URL, window */
// fetchComSessao(url, opcoes): fetch que leva o token da sessão do Supabase no cabeçalho Authorization.
// Desde 20/11 os proxies do governo (/api/pncp-*, /api/comprasgov-*) exigem login aprovado (netlify/functions/_auth.js).
// Carregar depois de supabase-config.js, nas páginas com login (painel, sistema, operação, processos).
// shortcut: lê o token que o supabase-js guarda no localStorage (chave padrão sb-<projeto>-auth-token), sem
// depender do cliente de cada página; token vencido com a aba parada vira 401 e a tela mostra o erro. Se uma
// página passar a usar storage próprio no supabase-js, trocar por cliente.auth.getSession().
(function (global) {
  function tokenSessao() {
    try {
      const projeto = new URL(SUPABASE_URL).hostname.split('.')[0];
      const sessao = JSON.parse(global.localStorage.getItem(`sb-${projeto}-auth-token`) || 'null');
      return typeof sessao?.access_token === 'string' ? sessao.access_token : '';
    } catch {
      return '';
    }
  }
  function fetchComSessao(url, opcoes = {}) {
    const token = tokenSessao();
    const headers = { ...(opcoes.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return global.fetch(url, { ...opcoes, headers });
  }
  global.fetchComSessao = fetchComSessao;
  if (typeof module !== 'undefined') module.exports = { fetchComSessao, tokenSessao };
})(typeof window !== 'undefined' ? window : globalThis);
