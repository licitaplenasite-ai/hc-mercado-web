/* global window, document, location, history, module, setTimeout, clearTimeout, CSS -- script de navegador (funções puras testadas no Node) */
// Casca única (25/11, dono aprovou): app.html abre cada tela do sistema num iframe da mesma origem e mantém vivas as já
// visitadas (só esconde/mostra). Clicar no menu de novo numa tela visitada não pede nada ao servidor e volta exatamente
// como estava (filtros, resultado, rolagem, aba, item aberto), porque a página nunca saiu da memória.
// - Endereço: /app#/<tela>?<parâmetros>#<seção>, ex.: /app#/painel?edicao=2026-11-24#boletim. Hash e não caminho:
//   funciona no Cloudflare Pages sem regra de reescrita e não muda nenhum link antigo (/painel.html?... continua
//   abrindo a tela sozinha, como hoje; o 1º clique no menu dessa tela já entra na casca, ver trava-sessao.js).
// - Menu: UM só menu lateral, o da casca (app.html, 25/11, dono: "menu FIXO, parado, igual ao Effecti"). Ele é
//   desenhado uma vez e nunca redesenhado nem rolado: trocar de tela só move a classe "ativo" de um item para outro.
//   Dentro da casca cada tela esconde o próprio menu (trava-sessao.js, classe lp-na-casca); sozinha continua com ele.
// - Topo: cada tela continua com o próprio topo (ele tem ações da tela: "+ Processo", sino, conta, empresa ativa),
//   sem o logo, que fica no menu. No celular o botão "Menu" do topo da tela abre a gaveta da casca.
// - Histórico: cada troca de tela é uma entrada (pushState) da casca; modais das telas continuam com as entradas
//   próprias (voltar-fecha-modal.js), no mesmo histórico conjunto do navegador.
// - Memória: no máximo MAX_VIVAS telas vivas; passou disso, descarta a usada há mais tempo (volta a carregar se
//   for aberta de novo, com o estado guardado por estado-tela.js).
// - Dados de uma tela que mudam outra: a tela que grava avisa (fetch de escrita no Supabase); ao mostrar outra
//   tela já viva, a casca só avisa com um botão "Atualizar" (nunca recarrega sozinha apagando o que a pessoa fez).
(function (global) {
  'use strict';
  const TELAS = new Set(['painel', 'sistema', 'processos', 'operacao', 'quadros', 'prospeccao', 'orcamento-obra', 'sinapi',
    'bdi', 'mao-de-obra', 'orgao', 'normas-obra', 'ajuda', 'resumo-processo']);
  const NOMES = { painel: 'Painel', sistema: 'Hoje', processos: 'Processos', operacao: 'Minhas empresas e documentos', quadros: 'Quadros',
    prospeccao: 'Prospecção', 'orcamento-obra': 'Orçamento de obra', sinapi: 'Preços SINAPI', bdi: 'Calculadora de BDI',
    'mao-de-obra': 'Mão de obra', orgao: 'Órgãos', 'normas-obra': 'Normas de obra', ajuda: 'Central de Ajuda', 'resumo-processo': 'Resumo do processo' };
  const MAX_VIVAS = 8;
  // Telas fora do menu marcam o item de onde se chega a elas; seções-atalho do painel marcam a seção que as contém.
  const ITEM_DE = { sinapi: 'orcamento-obra', bdi: 'orcamento-obra', 'mao-de-obra': 'orcamento-obra', 'normas-obra': 'orcamento-obra', 'resumo-processo': 'processos' };
  const SECAO_DE = { calendario: 'boletim', 'licitacao-anterior': 'diagnostico' };
  const ESPERA_MAX_MS = 10000;

  // "/painel.html" e "/painel" -> "painel"; "/" -> "index"; caminho com pasta -> "" (não é tela).
  function telaDe(caminho) {
    const m = /^\/([a-z0-9-]*?)(?:\.html)?$/i.exec(String(caminho || ''));
    return m ? (m[1] || 'index').toLowerCase() : '';
  }
  // Parte do endereço da casca depois de "#/": "painel?x=1#boletim".
  function rotaDe(u) { return telaDe(u.pathname) + u.search + u.hash; }
  // Rota (do endereço da casca, do histórico ou de um link) -> URL da tela no mesmo site, ou null se não for tela.
  // Barras iniciais saem antes: "#//outro.site" nunca vira endereço de outro domínio.
  function urlDaRota(rota, origem) {
    const r = String(rota || '').replace(/^[#/\\]+/, '');
    let u;
    try { u = new URL('/' + r, origem); } catch { return null; }
    return u.origin === origem && TELAS.has(telaDe(u.pathname)) ? u : null;
  }
  // Para onde vai a aba inteira quando a tela sai do sistema (login, termos, outro site). O ?voltar= do login aponta
  // para a casca, para quem entrar de novo voltar à mesma tela dentro dela.
  function saidaDe(u, origem) {
    if (u.origin !== origem || telaDe(u.pathname) !== 'login') return u.href;
    const voltar = u.searchParams.get('voltar');
    const tela = voltar && /^\/(?![/\\])/.test(voltar) ? urlDaRota(voltar, origem) : null;
    if (tela) u.searchParams.set('voltar', '/app#/' + rotaDe(tela));
    return u.href;
  }
  // Navegação dentro de uma tela: 'tela' (abrir outra tela na casca), 'sair' (a aba inteira vai) ou null (segue no
  // iframe: mesma tela, arquivo para baixar, /api/).
  function destinoDe(u, telaAtual, origem) {
    if (!/^https?:$/.test(u.protocol)) return null;
    if (u.origin !== origem) return 'sair';
    const ultimo = u.pathname.split('/').pop();
    if (/^\/api\//.test(u.pathname) || (ultimo.includes('.') && !/\.html$/i.test(ultimo))) return null;
    const tela = telaDe(u.pathname);
    if (tela && tela === telaAtual) return null;
    return TELAS.has(tela) ? 'tela' : 'sair';
  }
  // Qual tela viva descartar para caber a nova: a usada há mais tempo, nunca a visível, a pedida agora nem uma com
  // alteração não salva (tirar o iframe não dispara beforeunload: o que foi digitado sumiria sem aviso). Sem
  // candidata, devolve null e a casca fica com mais de MAX_VIVAS telas.
  function maisAntiga(vivas, protegidas, temAlteracoes = () => false) {
    let velha = null;
    for (const t of vivas) if (!protegidas.includes(t) && !temAlteracoes(t) && (!velha || t.usadaEm < velha.usadaEm)) velha = t;
    return velha;
  }

  // Item do menu (data-rota) da tela: "orgao", "painel#boletim". secao: id da seção visível do painel ou o #hash.
  function itemDoMenu(tela, secao) {
    if (tela !== 'painel') return ITEM_DE[tela] || tela;
    let s = String(secao || '').replace(/^#/, '');
    try { s = decodeURIComponent(s); } catch { s = ''; }
    return 'painel#' + (SECAO_DE[s] || s || 'dashboard');
  }

  const puras = { TELAS, MAX_VIVAS, telaDe, rotaDe, urlDaRota, saidaDe, destinoDe, maisAntiga, itemDoMenu };
  if (typeof module !== 'undefined' && module.exports) { module.exports = puras; return; }

  const doc = document, origem = location.origin;
  const vivas = new Map(); // tela -> { tela, frame, usadaEm, pronta, esperando, vistaEm, carregadaEm, empresaMudou }
  let ativa = null, pedida = null, mudanca = null;
  const $ = (id) => doc.getElementById(id);
  const donaDe = (win) => { for (const t of vivas.values()) if (t.frame.contentWindow === win) return t; return null; };
  const urlDa = (t) => { try { return new URL(t.frame.contentWindow.location.href); } catch { return null; } };

  function criar(tela, destino) {
    const frame = doc.createElement('iframe');
    frame.className = 'casca-tela';
    frame.title = NOMES[tela] || tela;
    frame.inert = true;
    frame.setAttribute('allow', 'fullscreen; clipboard-read; clipboard-write');
    frame.src = destino; // src antes de entrar na página: a 1ª carga não cria entrada no histórico
    const t = { tela, frame, usadaEm: Date.now(), pronta: false, esperando: [], vistaEm: 0, carregadaEm: 0, empresaMudou: false };
    frame.addEventListener('load', () => aoCarregar(t));
    vivas.set(tela, t);
    $('casca-telas').append(frame);
    return t;
  }

  // Recarga de uma tela viva. Se ela for cancelada (a tela perguntou "sair sem salvar?" e a pessoa ficou), o documento
  // antigo continua lá e nunca avisa "pronta": depois de 1,5 s com o mesmo documento, a casca segue com ele, sem
  // deixar a barra de carregando 10 s na tela. Carga lenta que só troca depois disso aparece no lugar quando chegar.
  function recarregar(t, ir) {
    const antes = t.frame.contentDocument, inicio = Date.now();
    t.pronta = false;
    ir(t.frame.contentWindow);
    const conferir = () => {
      if (t.pronta) return;
      let mesmo = false;
      try { mesmo = t.frame.contentDocument === antes; } catch { /* outro documento */ }
      if (!mesmo) return;
      if (Date.now() - inicio >= 1500) marcarPronta(t); else setTimeout(conferir, 250);
    };
    setTimeout(conferir, 250);
  }
  function quandoPronta(t, fn) {
    if (t.pronta) { fn(); return; }
    $('casca-carregando').hidden = false;
    t.esperando.push(fn);
    clearTimeout(t.relogio);
    t.relogio = setTimeout(() => marcarPronta(t), ESPERA_MAX_MS); // tela que não avisou (erro de rede): mostra assim mesmo
  }
  function marcarPronta(t) {
    clearTimeout(t.relogio);
    if (!t.pronta) { t.pronta = true; t.carregadaEm = Date.now(); t.empresaMudou = false; }
    const fila = t.esperando.splice(0);
    fila.forEach((fn) => fn());
    if (!pedida || pedida.pronta) $('casca-carregando').hidden = true;
  }

  // Abre (ou só mostra) a tela do endereço. historico: 'push' (clique), 'replace' (endereço inicial) ou 'nenhum' (voltar).
  function abrir(href, historico = 'push') {
    const u = urlDaRota(rotaDe(new URL(href, location.href)), origem);
    if (!u) return;
    const tela = telaDe(u.pathname), destino = '/' + tela + u.search + u.hash;
    let t = vivas.get(tela);
    if (!t) t = criar(tela, destino);
    else if (t.empresaMudou && semAlteracoesConfirmado(t)) {
      // A empresa ativa mudou em outra tela: a tela que garante não ter nada digitado (__lpTemAlteracoes() === false)
      // abre de novo já na empresa nova. As outras ficam como estão e o aviso pede para atualizar (avisarMudanca):
      // recarregar sozinha perderia em silêncio o que a pessoa digitou (palavras do Boletim, anotação, pergunta à Plena).
      recarregar(t, (w) => {
        // Mesmo endereço com # (/painel#boletim) não recarrega com replace: só rolaria até a seção.
        if (w.location.pathname + w.location.search === u.pathname + u.search) { w.history.replaceState(w.history.state, '', destino); w.location.reload(); } else w.location.replace(destino);
      });
    } else {
      const atual = urlDa(t);
      if (!atual || (u.search && u.search !== atual.search)) {
        // Parâmetros novos (link "Abrir no Funil", ficha de outro órgão): só esta tela carrega de novo; a casca não.
        recarregar(t, (w) => w.location.replace(destino));
      } else if (u.hash && u.hash !== atual.hash) {
        // Só a seção (#boletim, #kanban): navegação dentro da mesma página, sem recarregar nem criar entrada.
        // O popstate/hashchange que a troca de # dispara na tela (trava-sessao.js -> urlMudou) não pode reescrever o
        // endereço da casca antes do pushState abaixo: o voltar perderia a seção anterior (Analisar concorrente -> Boletim).
        // Seção com botão no menu (escondido) da tela: o clique dele troca a seção na hora (sem quadro da seção antiga) e
        // sem o navegador rolar até a <section> de mesmo id. Atalhos (#calendario) seguem pelo # (hashchange da tela).
        t.trocandoSecao = true;
        try {
          const botao = t.frame.contentDocument.querySelector(`#menu-principal button[data-alvo="${CSS.escape(decodeURIComponent(u.hash.slice(1)))}"]`);
          if (botao) botao.click(); else t.frame.contentWindow.location.replace(atual.pathname + atual.search + u.hash);
        } catch { t.frame.contentWindow.location.replace(atual.pathname + atual.search + u.hash); } finally { t.trocandoSecao = false; }
      }
    }
    pedida = t;
    marcarMenu(itemDoMenu(tela, u.hash || (tela === 'painel' && u.searchParams.has('edicao') ? 'boletim' : '')));
    quandoPronta(t, () => { if (pedida === t) exibir(t, historico, u.hash ? rotaDe(u) : ''); });
  }

  // Só troca a classe de dois itens: nada é redesenhado, nada rola, nada muda de tamanho.
  let marcado = null;
  function marcarMenu(chave) {
    const item = $('casca-menu').querySelector(`a[data-rota="${chave}"]:not(.casca-marca)`);
    if (item === marcado) return;
    if (marcado) { marcado.classList.remove('ativo'); marcado.removeAttribute('aria-current'); }
    if (item) { item.classList.add('ativo'); item.setAttribute('aria-current', 'page'); }
    marcado = item;
  }
  function marcarDaTela(t) {
    let secao = '';
    if (t.tela === 'painel') {
      // O #hash primeiro: a seção do painel só troca no hashchange, depois desta marca. Sem hash (?edicao=), a seção visível.
      try { secao = t.frame.contentWindow.location.hash || (t.frame.contentDocument.querySelector('main section.ativa') || {}).id; } catch { /* entre documentos */ }
    }
    marcarMenu(itemDoMenu(t.tela, secao));
  }

  function exibir(t, historico, pedidaRota) {
    const antes = ativa;
    if (antes && antes !== t) {
      antes.frame.classList.remove('ativa');
      antes.frame.inert = true;
      antes.vistaEm = Date.now();
    }
    t.frame.classList.add('ativa');
    t.frame.inert = false;
    t.usadaEm = Date.now();
    ativa = t;
    const atual = urlDa(t);
    // A rota pedida, não a do iframe: a troca de seção do painel (location.replace do #) ainda não aparece no endereço do
    // iframe neste instante, e a troca de Analisar concorrente para Boletim virava replace (o voltar pulava a seção).
    // Sem # pedido vale o endereço do iframe (guarda ?cnpj= da ficha aberta e afins).
    const rota = pedidaRota || (atual ? rotaDe(atual) : t.tela);
    if (historico === 'push' && ('#/' + rota) !== location.hash) {
      history.pushState({ rota }, '', '#/' + rota);
      casca.trocas++;
    } else if (historico !== 'nenhum' || ('#/' + rota) !== location.hash) history.replaceState({ rota }, '', '#/' + rota);
    atualizarTitulo();
    if (pedidaRota) marcarMenu(itemDoMenu(t.tela, pedidaRota.split('#')[1])); else marcarDaTela(t);
    if (antes !== t) {
      $('casca-anuncio').textContent = 'Tela: ' + (NOMES[t.tela] || t.tela);
      focar(t);
      avisarMudanca(t);
    }
    descartarSobras();
  }

  function atualizarTitulo() {
    try { doc.title = (ativa && ativa.frame.contentDocument.title) || 'LicitaPlena'; } catch { doc.title = 'LicitaPlena'; }
  }
  // Quem clicou no menu da casca continua nele (teclado segue no menu); troca vinda de dentro da tela ou do voltar põe o
  // foco no conteúdo da tela nova.
  function focar(t) {
    if ($('casca-menu').contains(doc.activeElement)) return;
    try {
      const d = t.frame.contentDocument;
      const alvo = d.querySelector('main') || d.body;
      if (alvo === d.querySelector('main') && !alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1');
      t.frame.contentWindow.focus();
      alvo.focus({ preventScroll: true });
    } catch { /* tela ainda sem corpo: fica o foco do navegador */ }
  }

  // Telas com formulário expõem window.__lpTemAlteracoes(); se não der para perguntar, a tela fica (não perde nada).
  function comAlteracoes(t) {
    try { const f = t.frame.contentWindow.__lpTemAlteracoes; return typeof f === 'function' && f() === true; } catch { return true; }
  }
  function semAlteracoesConfirmado(t) {
    try { const f = t.frame.contentWindow.__lpTemAlteracoes; return typeof f === 'function' && f() === false; } catch { return false; }
  }
  function descartarSobras() {
    while (vivas.size > MAX_VIVAS) {
      const velha = maisAntiga(vivas.values(), [ativa, pedida], comAlteracoes);
      if (!velha) return;
      vivas.delete(velha.tela);
      velha.frame.remove();
    }
  }

  // Mudanças de outra tela ou de empresa ativa: aviso com botão, a pessoa decide quando atualizar.
  function avisarMudanca(t) {
    const caixa = $('casca-aviso');
    const empresaMudou = t.empresaMudou;
    const dadosMudaram = !!mudanca && mudanca.tela !== t.tela && mudanca.em > Math.max(t.vistaEm, t.carregadaEm);
    if (!empresaMudou && !dadosMudaram) { caixa.hidden = true; return; }
    try { t.frame.contentWindow.dispatchEvent(new t.frame.contentWindow.CustomEvent('lp:dados-mudaram', { detail: { empresaMudou } })); } catch { /* segue com o aviso */ }
    $('casca-aviso-texto').textContent = empresaMudou
      ? 'A empresa ativa mudou em outra tela. Atualize esta tela para ver a empresa certa.'
      : 'Houve mudanças em outra tela. Atualize esta tela para ver os dados novos.';
    caixa.dataset.empresa = empresaMudou ? '1' : '';
    caixa.hidden = false;
  }
  function atualizarAtiva() {
    const t = ativa;
    $('casca-aviso').hidden = true;
    if (!t) return;
    const w = t.frame.contentWindow;
    t.vistaEm = Date.now();
    // Tela que sabe se atualizar sem recarregar (mantém filtros e o que foi digitado) usa o próprio caminho.
    if (!$('casca-aviso').dataset.empresa && typeof w.__lpAtualizar === 'function') { w.__lpAtualizar(); return; }
    pedida = t;
    recarregar(t, (w) => w.location.reload());
    quandoPronta(t, () => {});
  }

  function aoCarregar(t) {
    let u = null;
    try { u = new URL(t.frame.contentWindow.location.href); } catch { /* bloqueada: o relógio de quandoPronta mostra */ }
    if (u && u.href !== 'about:blank') {
      const tela = telaDe(u.pathname);
      if (!TELAS.has(tela)) { location.replace(saidaDe(u, origem)); return; } // login/termos dentro da tela: a aba inteira vai
      if (tela !== t.tela) {
        // A tela navegou sozinha para outra (navegador sem Navigation API): passa a ser a outra.
        const outra = vivas.get(tela);
        if (outra && outra !== t) { vivas.delete(tela); outra.frame.remove(); }
        vivas.delete(t.tela);
        t.tela = tela;
        t.frame.title = NOMES[tela] || tela;
        vivas.set(tela, t);
      }
    }
    marcarPronta(t);
    if (t === ativa) { urlMudou(t.frame.contentWindow); atualizarTitulo(); }
  }

  // Chamadas pelas telas (trava-sessao.js), sempre da mesma origem.
  function desviar(win, href) {
    const t = donaDe(win);
    let u;
    try { u = new URL(href, win.location.href); } catch { return false; }
    const d = destinoDe(u, t && t.tela, origem);
    if (d === 'tela') { depoisDaVolta(win, () => abrir(u.href)); return true; }
    if (d === 'sair') { location.assign(saidaDe(u, origem)); return true; }
    return false;
  }
  // Link clicado na gaveta do menu (celular): a gaveta fecha e voltar-fecha-modal.js tira a entrada dela com
  // history.back(). Empilhar a tela nova antes dessa volta terminar faria a volta desfazer a troca de tela.
  function depoisDaVolta(win, fn) {
    if (!win.__lpVoltaPendente) { fn(); return; }
    let feito = false;
    const ir = () => { if (!feito) { feito = true; fn(); } };
    win.addEventListener('popstate', ir, { once: true });
    setTimeout(ir, 500);
  }
  function urlMudou(win) {
    const t = donaDe(win);
    if (!t || t !== ativa || t.trocandoSecao) return;
    const u = urlDa(t);
    if (u && TELAS.has(telaDe(u.pathname))) history.replaceState({ rota: rotaDe(u) }, '', '#/' + rotaDe(u));
    atualizarTitulo();
    marcarDaTela(t);
  }
  // A tela recebeu o evento "storage" da empresa ativa: foi outra tela que trocou (quem grava não recebe o evento).
  function empresaMudou(win) { const t = donaDe(win); if (t && t !== ativa) t.empresaMudou = true; }
  function dadosMudaram(win) { const t = donaDe(win); mudanca = { em: Date.now(), tela: t ? t.tela : '' }; }
  function pronta(win) { const t = donaDe(win); if (t && t.frame.contentWindow.location.href !== 'about:blank') marcarPronta(t); }
  function irAoLogin(win) {
    const t = donaDe(win);
    const u = t && urlDa(t);
    location.replace('login.html?voltar=' + encodeURIComponent('/app#/' + (u ? rotaDe(u) : 'painel')));
  }

  // Menu da casca: clique simples troca de tela aqui; Ctrl/meio-clique abre /app#/... em outra aba pelo próprio link.
  const menuEl = $('casca-menu'), fundo = $('casca-gaveta-fundo'), recolher = $('casca-recolher');
  const celular = global.matchMedia('(max-width: 768px)');
  function gaveta(aberta) {
    // Reabrir logo depois de fechar: a volta que tira a entrada da gaveta anterior ainda não terminou e fecharia esta.
    if (aberta && global.__lpVoltaPendente) { depoisDaVolta(global, () => gaveta(true)); return; }
    menuEl.classList.toggle('gaveta-aberta', aberta);
    fundo.hidden = !aberta;
    // A gaveta abre sempre do mesmo jeito: do topo, sem rolar até o item ativo.
    if (aberta) { menuEl.scrollTop = 0; (marcado || menuEl.querySelector('a[data-rota]')).focus({ preventScroll: true }); }
  }
  menuEl.addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    const aberta = menuEl.classList.contains('gaveta-aberta');
    if (!a || !a.dataset.rota || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) { if (a && aberta) gaveta(false); return; }
    ev.preventDefault();
    const ir = () => abrir('/' + a.dataset.rota);
    if (!aberta) { ir(); return; }
    marcarMenu(a.dataset.rota);
    gaveta(false);
    // A gaveta fechada tira a entrada dela do histórico (history.back(), voltar-fecha-modal.js, no observador logo após
    // este clique): a tela nova só entra depois dessa volta, senão a volta a desfaria.
    Promise.resolve().then(() => depoisDaVolta(global, ir));
  });
  fundo.addEventListener('click', () => gaveta(false));
  global.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && menuEl.classList.contains('gaveta-aberta')) gaveta(false); });
  celular.addEventListener('change', () => gaveta(false));
  if (typeof global.criarPilhaVoltar === 'function') {
    global.criarPilhaVoltar(global, [{ el: menuEl, aberto: () => menuEl.classList.contains('gaveta-aberta'), fechar: () => gaveta(false) }]);
  }
  function aplicarRecolhido(sim) {
    doc.documentElement.classList.toggle('menu-recolhido', sim);
    recolher.title = sim ? 'Expandir menu' : 'Recolher menu';
    recolher.setAttribute('aria-expanded', sim ? 'false' : 'true');
    recolher.querySelector('.nav-label').textContent = sim ? 'Expandir' : 'Recolher';
  }
  aplicarRecolhido(doc.documentElement.classList.contains('menu-recolhido'));
  recolher.addEventListener('click', () => {
    const sim = !doc.documentElement.classList.contains('menu-recolhido');
    aplicarRecolhido(sim);
    try { global.localStorage.setItem('hc_sidebar_colapsada', sim ? '1' : '0'); } catch { /* segue sem lembrar */ }
  });
  // Tema e menu recolhido mudados em outra aba (ou o tema numa tela): a casca acompanha.
  global.addEventListener('storage', (ev) => {
    if (ev.key === 'licitaplena_tema') doc.documentElement.dataset.theme = ev.newValue === 'escuro' ? 'dark' : 'light';
    else if (ev.key === 'hc_sidebar_colapsada') aplicarRecolhido(ev.newValue === '1');
  });

  const casca = global.__casca = { trocas: 0, abrir, desviar, urlMudou, dadosMudaram, empresaMudou, pronta, irAoLogin, vivas, gaveta: () => gaveta(!menuEl.classList.contains('gaveta-aberta')) };

  global.addEventListener('popstate', (ev) => {
    const rota = (ev.state && ev.state.rota) || location.hash.replace(/^#\/?/, '');
    if (urlDaRota(rota, origem)) abrir('/' + rota.replace(/^[#/\\]+/, ''), 'nenhum');
  });
  // Ctrl+P na casca imprime só a tela visível (a própria tela faz o mesmo quando o foco está nela).
  global.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key).toLowerCase() === 'p' && ativa) {
      ev.preventDefault();
      ativa.frame.contentWindow.print();
    }
  });
  $('casca-aviso-atualizar').addEventListener('click', atualizarAtiva);
  $('casca-aviso-fechar').addEventListener('click', () => { $('casca-aviso').hidden = true; if (ativa) ativa.vistaEm = Date.now(); });

  const inicial = urlDaRota(location.hash.replace(/^#\/?/, ''), origem) || urlDaRota('painel', origem);
  abrir(inicial.href, 'replace');
})(typeof window !== 'undefined' ? window : globalThis);
