/* Trava de sessão das telas do sistema (24/11/2026, auditoria de segurança).
   Por quê: cada tela interna checava o login só no fim da página, depois de desenhada; por um instante (ou para sempre,
   se o JS falhasse) a tela aparecia para quem não estava logado. O dono exige: nenhuma tela do sistema sem cadastro.
   Como: carregado SEM defer no <head>, logo depois do supabase-js e do supabase-config.js. Esconde a página, manda
   direto para o login quem não tem sessão guardada e só mostra a tela depois de confirmar a sessão no Supabase e o
   cadastro "aprovado". data-exige="sessao" (só a tela de pagamento) aceita conta ainda não aprovada.
   Troca de tela rápida (24/11, queixa do dono "dá uma carregada"): esperar o Supabase a cada clique do menu deixava a
   tela escondida ~0,3-0,5 s. Quem já foi confirmado "aprovado" nesta aba nos últimos 10 min (sessionStorage, preso ao
   id do usuário do token guardado) vê a tela na hora; a confirmação no Supabase roda do mesmo jeito em segundo plano e,
   se falhar, apaga a marca e manda ao login. Sem token guardado continua indo ao login na hora.
   Piscada na troca de menu (24/11, dono "fica piscando, tá pior"): a causa era esta trava escondendo a tela inteira até o
   Supabase responder (o navegador mostrava o fundo vazio ~0,5-0,8 s a cada clique). A marca passou a valer 8 h (renovada
   a cada tela) para a piscada não voltar depois de uma pausa; a conferência em segundo plano continua em toda tela.
   Os dados continuam protegidos no servidor (RLS e functions com login); esta trava cuida do que aparece na tela. */
(function () {
  "use strict";
  var raiz = document.documentElement;
  var exige = (document.currentScript && document.currentScript.dataset.exige) || "aprovado";
  var MARCA = "lp_trava_aprovado", VALIDADE = 8 * 60 * 60 * 1000;
  raiz.style.visibility = "hidden";
  // Tema e menu recolhido certos já no 1º quadro (antes: o Hoje pintava claro e só depois virava escuro; o menu
  // recolhido abria largo e encolhia quando o menu-lateral.js rodava, no fim da página).
  try {
    var tema = localStorage.getItem("licitaplena_tema") || (localStorage.getItem("licitaplena.tema") === "dark" ? "escuro" : "");
    if (tema === "escuro") { raiz.dataset.theme = "dark"; if (raiz.classList) raiz.classList.remove("tema-claro"); }
    if (localStorage.getItem("hc_sidebar_colapsada") === "1" && typeof MutationObserver === "function") {
      var vigia = new MutationObserver(function () {
        var nav = document.getElementById("menu-principal");
        if (nav) { nav.classList.add("colapsada"); vigia.disconnect(); }
      });
      vigia.observe(raiz, { childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", function () { vigia.disconnect(); });
    }
  } catch (e) { /* sem armazenamento: cada página aplica o padrão */ }
  function esquecer() { try { sessionStorage.removeItem(MARCA); } catch (e) { /* sem armazenamento */ } }
  // Com o #: o link do e-mail (painel.html?edicao=...#boletim) volta para o Boletim depois do login, não para a busca.
  // Dentro da casca (app.html) quem vai ao login é a aba inteira, voltando depois para a mesma tela dentro dela.
  var casca = null;
  try { casca = (window.parent !== window && window.parent.__casca) || null; } catch (e) { casca = null; }
  function irParaLogin() {
    esquecer();
    if (casca) { casca.irAoLogin(window); return; }
    location.replace("login.html?voltar=" + encodeURIComponent(location.pathname + location.search + location.hash));
  }
  function liberar() { raiz.style.visibility = ""; }

  var temToken = false, usuario = "";
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var chave = localStorage.key(i) || "";
      if (!/^sb-.+-auth-token$/.test(chave)) continue;
      temToken = true;
      try {
        var v = JSON.parse(localStorage.getItem(chave) || "null");
        var s = v && (v.access_token ? v : v.currentSession);
        usuario = (s && s.user && s.user.id) || "";
      } catch (e) { /* token ilegível: sem atalho, o Supabase decide abaixo */ }
      break;
    }
  } catch (e) { temToken = true; } // sem acesso ao armazenamento: deixa o Supabase decidir abaixo
  if (!temToken) { irParaLogin(); return; }

  // Atalho: aprovado confirmado há pouco, nesta aba, para este mesmo usuário (aprovado também satisfaz "sessao").
  try {
    var m = JSON.parse(sessionStorage.getItem(MARCA) || "null");
    if (usuario && m && m.usuario === usuario && typeof m.ate === "number" && Date.now() < m.ate && m.ate - Date.now() <= VALIDADE) liberar();
  } catch (e) { /* sem marca: espera a confirmação */ }

  async function conferir() {
    try {
      /* global SUPABASE_URL, SUPABASE_ANON_KEY */
      var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      var r = await sb.auth.getSession();
      var sessao = r && r.data && r.data.session;
      if (!sessao) { irParaLogin(); return; }
      if (exige === "aprovado") {
        var c = await sb.from("clientes").select("status").eq("id", sessao.user.id).maybeSingle();
        if (!c || !c.data || c.data.status !== "aprovado") { irParaLogin(); return; }
        try { sessionStorage.setItem(MARCA, JSON.stringify({ usuario: sessao.user.id, ate: Date.now() + VALIDADE })); } catch (e) { /* segue sem atalho */ }
      }
      liberar();
    } catch (e) { irParaLogin(); }
  }
  if (window.supabase && typeof SUPABASE_URL !== "undefined") conferir();
  else document.addEventListener("DOMContentLoaded", conferir);
  // Voltar do navegador depois de Sair pode devolver a página guardada inteira na memória (bfcache), com os dados de
  // quem saiu (na casca, todas as telas vivas). Volta assim: esconde e confere de novo; sem token guardado vai ao login.
  if (typeof window.addEventListener === "function") window.addEventListener("pageshow", function (ev) {
    if (!ev.persisted) return;
    var ainda = false;
    try {
      for (var j = 0; j < localStorage.length; j++) if (/^sb-.+-auth-token$/.test(localStorage.key(j) || "")) { ainda = true; break; }
    } catch (e) { ainda = true; }
    raiz.style.visibility = "hidden";
    if (!ainda) { irParaLogin(); return; }
    conferir();
  });
})();

/* Navegação do menu (24/11): pré-busca o HTML da tela ao passar o mouse no item do menu (Speculation Rules; navegadores
   sem suporte só ignoram). Fica aqui porque este é o único arquivo que todas as telas internas já carregam no <head>.
   Sem prerender e sem @view-transition (revisão do mesmo dia): o prerender rodava a tela escondida antes do clique e lia
   o estado guardado da tela anterior antes de ela gravá-lo (pagehide), e a transição esmaecia a tela a cada clique. */
(function () {
  "use strict";
  var cabeca = document.head;
  if (!cabeca || typeof document.createElement !== "function") return;
  try { if (window.parent !== window && window.parent.__casca) return; } catch (e) { /* segue como página sozinha */ }
  // Conexão com o Supabase aberta já no <head> (na 1ª tela poupa DNS+TLS antes da primeira consulta).
  if (typeof SUPABASE_URL === "string" && /^https?:\/\//.test(SUPABASE_URL)) {
    var pre = document.createElement("link");
    pre.rel = "preconnect"; pre.href = SUPABASE_URL; pre.crossOrigin = "anonymous";
    cabeca.appendChild(pre);
  }
  var MENU = "#menu-principal a[href], .abas-obra a[href]";
  // No Pages "processos.html" é um 308 para "/processos", e pré-busca não aceita desvio (PrefetchFailedIneligibleRedirect).
  // Se esta tela já abriu pela URL limpa, o link do menu passa a apontar direto para a URL limpa quando o mouse/dedo
  // chega nele (o HTML continua com .html: hosts sem URL limpa e os testes seguem iguais).
  if (!/\.html$/i.test(location.pathname)) {
    var limpar = function (ev) {
      var a = ev.target && ev.target.closest && ev.target.closest(MENU);
      var m = a && /^([a-z0-9-]+)\.html([?#].*)?$/i.exec(a.getAttribute("href") || "");
      if (m && m[1] !== "index") a.setAttribute("href", m[1] + (m[2] || ""));
    };
    ["pointerover", "focusin", "touchstart", "click"].forEach(function (t) { document.addEventListener(t, limpar, { capture: true, passive: true }); });
  }
  if (!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules"))) return;
  var onde = { and: [{ selector_matches: MENU }, { href_matches: "/*" },
    { not: { selector_matches: "[target=_blank], [download]" } }] };
  var regras = document.createElement("script");
  regras.type = "speculationrules";
  regras.textContent = JSON.stringify({
    prefetch: [{ source: "document", where: onde, eagerness: "moderate" }],
  });
  cabeca.appendChild(regras);
})();

/* Casca única (25/11, casca.js). Dentro da casca: a tela avisa quando está pronta, quando o endereço muda e quando grava
   dados; navegação para outra tela (menu, "Abrir no Funil", ficha do órgão) vira troca de iframe na casca, e saída do
   sistema (login, termos, outro site) leva a aba inteira. Tema e menu recolhido seguem as outras telas vivas.
   Sozinha (link direto, e-mail): continua igual, e o 1º clique no menu entra na casca já na tela escolhida. */
(function () {
  "use strict";
  var casca = null;
  try { casca = (window.parent !== window && window.parent.__casca) || null; } catch (e) { casca = null; }
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  if (!casca) {
    if (/^\/app(\.html)?$/.test(location.pathname)) return;
    document.addEventListener("click", function (ev) {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var a = ev.target && ev.target.closest && ev.target.closest("#menu-principal a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      var u = new URL(a.href, location.href);
      var tela = /^\/([a-z0-9-]+?)(?:\.html)?$/i.exec(u.pathname);
      if (u.origin !== location.origin || !tela) return;
      ev.preventDefault();
      location.assign("/app#/" + tela[1] + u.search + u.hash);
    });
    return;
  }
  var raiz = document.documentElement;
  // Menu único (25/11): na casca o menu lateral é o dela (app.html), fixo. Aqui some o menu da tela, a margem dele e o
  // logo do topo (o conteúdo ocupa a área à direita); no celular o botão "Menu" do topo abre a gaveta da casca.
  raiz.classList.add("lp-na-casca");
  var estilo = document.createElement("style");
  estilo.textContent = ".lp-na-casca #menu-principal,.lp-na-casca #nav-gaveta-fundo{display:none!important}"
    + "@media (min-width:769px){.lp-na-casca #nav-gaveta-btn,.lp-na-casca header .header-marca,.lp-na-casca header .app-marca,.lp-na-casca header .topo-marca-linha>.marca{display:none!important}}";
  (document.head || raiz).appendChild(estilo);
  document.addEventListener("click", function (ev) {
    if (!(ev.target && ev.target.closest && ev.target.closest("#nav-gaveta-btn"))) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    casca.gaveta();
  }, true);
  ["pushState", "replaceState"].forEach(function (m) {
    var original = history[m];
    history[m] = function () { var r = original.apply(this, arguments); casca.urlMudou(window); return r; };
  });
  window.addEventListener("hashchange", function () { casca.urlMudou(window); });
  window.addEventListener("popstate", function () { casca.urlMudou(window); });
  if (window.navigation && typeof window.navigation.addEventListener === "function") {
    window.navigation.addEventListener("navigate", function (ev) {
      if (!ev.cancelable || ev.hashChange || ev.downloadRequest || ev.navigationType === "traverse" || ev.navigationType === "reload") return;
      if (casca.desviar(window, ev.destination.url)) ev.preventDefault();
    });
  } else {
    // Sem Navigation API: só links; navegação por script cai no aoCarregar da casca.
    window.addEventListener("click", function (ev) {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var a = ev.target && ev.target.closest && ev.target.closest("a[href]");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      if (casca.desviar(window, a.href)) ev.preventDefault();
    });
  }
  // Escrita no Supabase (tabela ou arquivo; rpc fica de fora, quase todas só leem): as outras telas vivas ganham o aviso.
  var buscar = window.fetch;
  if (typeof buscar === "function") {
    window.fetch = function (recurso, opcoes) {
      try {
        var metodo = String((opcoes && opcoes.method) || (recurso && recurso.method) || "GET").toUpperCase();
        var url = String((recurso && recurso.url) || recurso);
        if (metodo !== "GET" && metodo !== "HEAD" && /\/(rest\/v1\/(?!rpc\/)|storage\/v1\/object\/)/.test(url)) casca.dadosMudaram(window);
      } catch (e) { /* segue sem aviso */ }
      return buscar.apply(this, arguments);
    };
  }
  window.addEventListener("storage", function (ev) {
    if (ev.key === "licitaplena_tema") {
      var escuro = ev.newValue === "escuro";
      if ((raiz.dataset.theme === "dark") === escuro) return;
      var botao = document.querySelector("#header-tema-btn, #btn-tema, #tema");
      if (botao) { botao.click(); return; }
      raiz.dataset.theme = escuro ? "dark" : "light";
      raiz.classList.toggle("tema-claro", !escuro);
    } else if (ev.key === "licitaplena_empresa_operacional_id") {
      // 1ª escolha automática (sem valor antes, ex.: gravarPreferencia ao carregar) não conta. O painel grava a empresa
      // que escolheu ao carregar (carregarEmpresasAcompanhamentoAgora), então a troca feita depois já tem valor antigo.
      if (ev.oldValue && ev.newValue !== ev.oldValue) casca.empresaMudou(window);
    } else if (ev.key === "hc_sidebar_colapsada") {
      var nav = document.getElementById("menu-principal"), recolher = document.getElementById("nav-colapsar-btn");
      if (nav && recolher && nav.classList.contains("colapsada") !== (ev.newValue === "1")) recolher.click();
    }
  });
  // Ctrl+P com o foco na tela imprime só ela (sem a casca em volta).
  window.addEventListener("keydown", function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key).toLowerCase() === "p") { ev.preventDefault(); window.print(); }
  });
  function avisarPronta() {
    if (raiz.style.visibility === "hidden") { requestAnimationFrame(avisarPronta); return; }
    casca.pronta(window);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avisarPronta); else avisarPronta();
})();
