/* global window, document, location, module, requestAnimationFrame -- script de navegador (funções puras testadas no Node) */
// Estado de cada tela nesta aba (24/11, dono: "trocar de tela tem que continuar do jeito que tá; se eu voltar, continua.
// Só muda se eu atualizar ou buscar outra coisa"). Guarda filtros e o resultado da última busca de cada tela e a rolagem,
// para a volta desenhar na hora, sem consultar de novo. sessionStorage: some ao fechar a aba; a chave leva o usuário do
// token e a empresa ativa, então outra conta ou outra empresa nunca vê o resultado guardado de quem veio antes.
(function (global) {
  'use strict';
  const PREFIXO = 'lp_tela:';
  const LIMITE = 1500000; // caracteres por tela; o navegador dá uns 5 milhões por site e o resto do sistema também usa
  const VELHO_MS = 15 * 60 * 1000; // passou disso: mostra o guardado e confere de novo em segundo plano
  const VALIDADE_MS = 12 * 60 * 60 * 1000;

  const sessao = () => { try { return global.sessionStorage || null; } catch { return null; } };
  function dono() {
    let usuario = '', empresa = '';
    try {
      const ls = global.localStorage;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i) || '';
        if (!/^sb-.+-auth-token$/.test(k)) continue;
        const v = JSON.parse(ls.getItem(k) || 'null');
        const s = v && (v.access_token ? v : v.currentSession);
        usuario = (s && s.user && s.user.id) || '';
        break;
      }
      empresa = ls.getItem('licitaplena_empresa_operacional_id') || '';
    } catch { /* sem armazenamento: sem dono, nada é guardado */ }
    return usuario ? `${usuario}:${empresa}` : '';
  }
  const chave = (nome) => { const d = dono(); return d ? `${PREFIXO}${d}:${nome}` : ''; };

  function guardar(nome, dado, agora = Date.now()) {
    const s = sessao(), k = chave(nome);
    if (!s || !k) return false;
    let texto;
    try { texto = JSON.stringify({ em: agora, dado }); } catch { return false; }
    if (texto.length > LIMITE) { try { s.removeItem(k); } catch { /* segue */ } return false; }
    try { s.setItem(k, texto); return true; } catch {
      // Cheio: abre espaço apagando as outras telas guardadas e tenta uma vez.
      try {
        for (let i = s.length - 1; i >= 0; i--) { const x = s.key(i); if (x && x.startsWith(PREFIXO) && x !== k) s.removeItem(x); }
        s.setItem(k, texto); return true;
      } catch { return false; }
    }
  }
  // { dado, em, velho } ou null. "velho": a tela mostra o guardado e confere de novo sem apagar o que está na tela.
  function ler(nome, agora = Date.now()) {
    const s = sessao(), k = chave(nome);
    if (!s || !k) return null;
    try {
      const g = JSON.parse(s.getItem(k) || 'null');
      if (!g || typeof g.em !== 'number' || agora - g.em > VALIDADE_MS || g.em > agora + 60000) return null;
      return { dado: g.dado, em: g.em, velho: agora - g.em > VELHO_MS };
    } catch { return null; }
  }
  function esquecer(nome) { const s = sessao(), k = chave(nome); if (s && k) try { s.removeItem(k); } catch { /* segue */ } }

  // Rolagem por tela (e por seção do painel, que fica no #). Volta para onde estava quando a tela já tem altura.
  const chaveRolagem = (onde) => 'rolagem:' + String(onde || '').replace(/\.html(?=#|$)/, '');
  const aqui = () => location.pathname + (location.hash || '');
  function guardarRolagem(onde = aqui()) {
    if (global.scrollY > 0) guardar(chaveRolagem(onde), Math.round(global.scrollY)); else esquecer(chaveRolagem(onde));
  }
  let tentativa = 0;
  function restaurarRolagem(onde = aqui()) {
    const g = ler(chaveRolagem(onde));
    const alvo = g && Number(g.dado);
    const minha = ++tentativa;
    if (!alvo) return;
    const inicio = Date.now();
    const passo = () => {
      if (minha !== tentativa) return; // outra tela/seção pediu depois, ou a pessoa rolou
      const cabe = document.documentElement.scrollHeight - global.innerHeight >= alvo;
      if (cabe || Date.now() - inicio > 4000) { global.scrollTo(0, alvo); return; }
      requestAnimationFrame(passo);
    };
    passo();
  }

  const api = { guardar, ler, esquecer, guardarRolagem, restaurarRolagem, VELHO_MS, LIMITE };
  global.EstadoTela = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined' || typeof global.addEventListener !== 'function') return;
  // A pessoa mexeu: a volta automática para a rolagem guardada não briga com ela. Sem ouvinte de toque: no Safari do
  // iPhone ele fazia o "voltar" que fecha o resumo devolver a página ao topo (e2e-voltar-iphone, 24/11).
  ['wheel', 'keydown'].forEach((t) => global.addEventListener(t, () => { tentativa++; }, { passive: true }));
  global.addEventListener('pagehide', () => guardarRolagem());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => restaurarRolagem());
  else restaurarRolagem();
})(typeof window !== 'undefined' ? window : globalThis);
