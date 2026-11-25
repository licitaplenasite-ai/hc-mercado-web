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
  function irParaLogin() { esquecer(); location.replace("login.html?voltar=" + encodeURIComponent(location.pathname + location.search + location.hash)); }
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
})();

/* Navegação do menu (24/11): pré-busca o HTML da tela ao passar o mouse no item do menu (Speculation Rules; navegadores
   sem suporte só ignoram). Fica aqui porque este é o único arquivo que todas as telas internas já carregam no <head>.
   Sem prerender e sem @view-transition (revisão do mesmo dia): o prerender rodava a tela escondida antes do clique e lia
   o estado guardado da tela anterior antes de ela gravá-lo (pagehide), e a transição esmaecia a tela a cada clique. */
(function () {
  "use strict";
  var cabeca = document.head;
  if (!cabeca || typeof document.createElement !== "function") return;
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
