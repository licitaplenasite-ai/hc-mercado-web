/* global document, window, localStorage -- script de navegador */
// Menu lateral do CRM (sistema.html, operacao.html, processos.html): mesmo comportamento do menu do painel.html.
// Recolher no computador (mesma chave hc_sidebar_colapsada do painel) e gaveta no celular (até 768px), que abre pelo
// botão "Menu" do topo e fecha com Esc, com clique fora e ao escolher um item.
(function () {
  'use strict';
  const nav = document.getElementById('menu-principal');
  if (!nav) return;

  // A nav gruda logo abaixo do topo, que também é sticky: mede a altura real do topo (muda entre larguras).
  const topo = document.querySelector('header');
  function medir() { if (topo) document.documentElement.style.setProperty('--altura-header', topo.offsetHeight + 'px'); }
  medir();
  window.addEventListener('resize', medir);
  montarTopo();
  topoCelular();

  const recolher = document.getElementById('nav-colapsar-btn');
  if (recolher) {
    const CHAVE = 'hc_sidebar_colapsada';
    const aplicar = (colapsada) => {
      nav.classList.toggle('colapsada', colapsada);
      recolher.title = colapsada ? 'Expandir menu' : 'Recolher menu';
      recolher.setAttribute('aria-expanded', colapsada ? 'false' : 'true');
      const rotulo = recolher.querySelector('.nav-label');
      if (rotulo) rotulo.textContent = colapsada ? 'Expandir' : 'Recolher';
    };
    let colapsada = false;
    try { colapsada = localStorage.getItem(CHAVE) === '1'; } catch { /* localStorage indisponível */ }
    aplicar(colapsada);
    recolher.addEventListener('click', () => {
      colapsada = !colapsada;
      aplicar(colapsada);
      try { localStorage.setItem(CHAVE, colapsada ? '1' : '0'); } catch { /* segue sem persistir */ }
    });
  }

  const btn = document.getElementById('nav-gaveta-btn');
  const fundo = document.getElementById('nav-gaveta-fundo');
  if (!btn || !fundo) return;
  const celular = window.matchMedia('(max-width: 768px)');
  function definir(aberta) {
    nav.classList.toggle('gaveta-aberta', aberta);
    fundo.hidden = !aberta;
    btn.setAttribute('aria-expanded', aberta ? 'true' : 'false');
    if (aberta) (nav.querySelector('a.ativo') || nav.querySelector('a'))?.focus();
  }
  btn.addEventListener('click', () => definir(!nav.classList.contains('gaveta-aberta')));
  fundo.addEventListener('click', () => definir(false));
  nav.addEventListener('click', (ev) => { if (celular.matches && ev.target.closest('a')) definir(false); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && nav.classList.contains('gaveta-aberta')) { definir(false); btn.focus(); }
  });
  celular.addEventListener('change', () => definir(false));

  // Topo igual ao do painel (23/11): empresa, plano, nome e Sair, com o mesmo ícone de tema (lua/sol).
  function montarTopo() {
    const acoes = topo && topo.querySelector('.acoes, .app-controles');
    if (!acoes) return;
    const tema = document.getElementById('btn-tema') || document.getElementById('tema');
    const conta = document.createElement('span');
    conta.className = 'topo-conta';
    // header-badge-plano: plano-trava.js preenche com o plano vigente (o selo vazio fica escondido por CSS).
    conta.innerHTML = '<span class="header-badge" id="topo-empresa"></span><span class="header-badge header-badge-plano" id="header-badge-plano"></span><span class="header-usuario-nome" id="topo-usuario"></span>';
    acoes.insertBefore(conta, tema || acoes.firstChild);
    // sistema.html já tem o próprio Sair, ligado ao controlador (só aparece com a sessão carregada).
    if (!document.getElementById('sair')) {
      const sair = document.createElement('button');
      sair.type = 'button'; sair.className = 'header-sair'; sair.textContent = 'Sair';
      sair.addEventListener('click', sairDaConta);
      acoes.append(sair);
    }
    if (tema) {
      tema.classList.add('header-icone-btn');
      const desenhar = () => {
        const escuro = document.documentElement.dataset.theme === 'dark';
        tema.innerHTML = `<svg class="icone-ph" aria-hidden="true"><use href="menu-icones.svg#${escuro ? 'ph-moon' : 'ph-sun'}"></use></svg>`;
        tema.title = escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro';
        tema.setAttribute('aria-label', 'Alternar tema claro ou escuro');
      };
      desenhar();
      // O clique de cada página troca o tema e reescreve o botão; o observador redesenha depois dele.
      new MutationObserver(desenhar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    }
    preencherConta();
  }

  // Topo do celular numa linha só (25/11, dono: "Menu à esquerda, logo, e embaixo ?, celular, tema e Sair — bagunçado"):
  // ícone de menu, logo e um único botão de conta à direita. Até 768px as ações do topo (ajuda, celular, tema, Sair,
  // empresa ativa...) MUDAM de lugar para o menu da conta, com os mesmos botões e cliques; no computador voltam ao topo.
  function topoCelular() {
    const acoes = topo && topo.querySelector('.acoes, .app-controles');
    const menuBtn = document.getElementById('nav-gaveta-btn');
    if (!acoes) return;
    if (menuBtn) {
      menuBtn.innerHTML = '<svg class="icone-ph" viewBox="0 0 256 256" aria-hidden="true"><path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z"/></svg>';
      menuBtn.setAttribute('aria-label', 'Menu');
      menuBtn.title = 'Menu';
    }
    topo.classList.add('topo-1linha');
    const conta = document.createElement('button');
    conta.type = 'button'; conta.id = 'topo-conta-btn'; conta.className = 'header-icone-btn';
    conta.title = 'Conta e opções'; conta.setAttribute('aria-label', 'Conta e opções');
    conta.setAttribute('aria-haspopup', 'true'); conta.setAttribute('aria-expanded', 'false'); conta.setAttribute('aria-controls', 'topo-conta-menu');
    conta.innerHTML = '<svg class="icone-ph" viewBox="0 0 256 256" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM74.08,197.5a64,64,0,0,1,107.84,0,87.83,87.83,0,0,1-107.84,0ZM96,120a32,32,0,1,1,32,32A32,32,0,0,1,96,120Zm97.76,66.41a79.66,79.66,0,0,0-36.06-28.75,48,48,0,1,0-59.4,0,79.66,79.66,0,0,0-36.06,28.75,88,88,0,1,1,131.52,0Z"/></svg>';
    const caixa = document.createElement('div');
    caixa.id = 'topo-conta-menu'; caixa.className = 'topo-conta-menu'; caixa.hidden = true;
    acoes.append(conta);
    topo.append(caixa);
    const celular = window.matchMedia('(max-width: 768px)');
    // Rótulo visível para os botões só de ícone; ordem pedida pelo dono: conta, ajuda, celular, tema, sino, Sair.
    const ROTULOS = { 'btn-tema': 'Tema claro/escuro', tema: 'Tema claro/escuro', 'ajuda-btn': 'Ajuda', 'celular-btn': 'LicitaPlena no celular' };
    const ORDEM = ['topo-conta', 'app-empresa', 'ajuda-btn', 'celular-btn', 'btn-tema', 'tema'];
    const posicao = (el) => { const i = ORDEM.findIndex((k) => el.id === k || el.classList.contains(k)); return i < 0 ? (/sair/i.test(el.className + el.id) ? 99 : 50) : i; };
    const rotular = (el) => {
      if (el.nodeType !== 1 || el.dataset.rotulo !== undefined) return;
      const texto = (el.textContent || '').trim();
      el.dataset.rotulo = ROTULOS[el.id] || (texto.length > 2 && !/^[☾☀]/.test(texto) ? '' : (el.getAttribute('aria-label') || el.title || ''));
      if (ROTULOS[el.id]) el.setAttribute('aria-label', ROTULOS[el.id]);
    };
    function arrumar() {
      if (celular.matches) {
        for (const el of [...acoes.children]) if (el !== conta) caixa.append(el);
        const itens = [...caixa.children];
        itens.forEach(rotular);
        itens.sort((x, y) => posicao(x) - posicao(y)).forEach((el) => caixa.append(el));
      } else {
        for (const el of [...caixa.children]) acoes.insertBefore(el, conta);
        abrir(false);
      }
    }
    function abrir(sim) {
      caixa.hidden = !sim;
      conta.setAttribute('aria-expanded', sim ? 'true' : 'false');
      if (sim) caixa.style.top = Math.round(conta.getBoundingClientRect().bottom + 6) + 'px';
    }
    // Ajuda e celular entram no topo depois (ajuda-ui.js, avisos-celular.js): no celular vão direto para o menu da conta.
    new MutationObserver(() => { if (celular.matches && [...acoes.children].some((el) => el !== conta)) arrumar(); }).observe(acoes, { childList: true });
    // O botão do celular entra ao lado da ajuda, que no celular já está no menu da conta.
    new MutationObserver(() => { if (celular.matches && [...caixa.children].some((el) => el.dataset.rotulo === undefined)) arrumar(); }).observe(caixa, { childList: true });
    celular.addEventListener('change', arrumar);
    arrumar();
    conta.addEventListener('click', (ev) => { ev.stopPropagation(); abrir(caixa.hidden); });
    // Clique num item faz a ação dele e fecha o menu; select da empresa ativa fica aberto para escolher.
    caixa.addEventListener('click', (ev) => { if (ev.target.closest('button, a')) abrir(false); });
    document.addEventListener('click', (ev) => { if (!caixa.hidden && !caixa.contains(ev.target)) abrir(false); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !caixa.hidden) { abrir(false); conta.focus(); } });
  }

  function sessaoGuardada() {
    try {
      for (const chave of Object.keys(localStorage)) {
        if (!/^sb-.+-auth-token$/.test(chave)) continue;
        const v = JSON.parse(localStorage.getItem(chave) || 'null');
        const s = v && (v.access_token ? v : v.currentSession);
        if (s && s.access_token) return s;
      }
    } catch { /* sem armazenamento: o topo fica sem nome */ }
    return null;
  }

  async function preencherConta() {
    const s = sessaoGuardada();
    const email = (s && s.user && s.user.email) || '';
    const nomeEmail = email ? email.split('@')[0].split(/[._-]/)[0] : '';
    const escrever = (nome, empresa) => {
      const n = document.getElementById('topo-usuario');
      if (n) n.textContent = nome || (nomeEmail ? nomeEmail.charAt(0).toUpperCase() + nomeEmail.slice(1).toLowerCase() : '');
      const e = document.getElementById('topo-empresa');
      if (e) { e.textContent = empresa || ''; e.title = empresa || ''; }
    };
    // Troca de tela sem o topo "piscar" vazio (24/11): nome/empresa da última tela desta aba aparecem na hora e a
    // consulta abaixo confirma/atualiza. Preso ao id do usuário; sessionStorage some ao fechar a aba.
    const CHAVE_TOPO = 'lp_topo_' + ((s && s.user && s.user.id) || '');
    let guardado = null;
    try { guardado = JSON.parse(sessionStorage.getItem(CHAVE_TOPO) || 'null'); } catch { /* sem armazenamento */ }
    escrever(guardado ? guardado.nome : '', guardado ? guardado.empresa : '');
    /* global SUPABASE_URL, SUPABASE_ANON_KEY */
    if (!s || !s.user || typeof SUPABASE_URL === 'undefined') return;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes?select=nome,empresa&id=eq.${encodeURIComponent(s.user.id)}`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + s.access_token },
      });
      const c = r.ok ? (await r.json())[0] : null;
      if (c) {
        const atual = { nome: String(c.nome || '').trim(), empresa: String(c.empresa || '').trim() };
        escrever(atual.nome, atual.empresa);
        try { sessionStorage.setItem(CHAVE_TOPO, JSON.stringify(atual)); } catch { /* segue sem guardar */ }
      }
    } catch (e) { console.warn('Topo: não foi possível ler o cadastro', e); }
  }

  async function sairDaConta() {
    try {
      await window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY).auth.signOut();
    } catch (e) {
      console.warn('Sair: falha ao encerrar no servidor; limpando a sessão deste navegador', e);
    }
    // Garante a saída mesmo sem rede: sem o token guardado, a trava de sessão manda para o login.
    try { Object.keys(localStorage).filter((k) => /^sb-.+-auth-token$/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* segue */ }
    window.EstadoTela?.limparTudo(); // a tela de login limpa de novo; aqui cobre quem fecha antes de ela abrir
    window.top.location.href = 'login.html'; // dentro da casca (app.html), sai a aba inteira
  }
})();
