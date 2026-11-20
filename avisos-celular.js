/* global document, window, navigator, location, localStorage, Notification, fetch, atob, SUPABASE_URL, SUPABASE_ANON_KEY -- script de navegador */
// LicitaPlena no celular (item 29 da análise do Siga Pregão): instalável sem loja (PWA) e avisos no celular (Web Push)
// de mudança no edital, prazo, mensagem do pregoeiro, certidão vencendo e oportunidade nova do boletim. Quem envia é o robô scripts/avisos_celular.js.
// Incluir com <script src="avisos-celular.js" defer></script> DEPOIS de ajuda-ui.js: o botão entra ao lado do "?".
// Aqui: manifesto e ícones no <head>, registro do sw.js, botão discreto e a gaveta (instalar, ativar avisos, tipos).
// iPhone: só avisa com o site adicionado à Tela de Início e aberto pelo ícone (iOS 16.4+); a gaveta explica.
(function () {
  "use strict";
  if (window.LicitaPlenaCelular || !document.head) return;

  const TIPOS = [["edital", "Mudança no edital"], ["prazo", "Prazo vencendo"], ["pregoeiro", "Mensagem do pregoeiro"], ["certidao", "Certidão vencendo"], ["boletim", "Oportunidade nova no boletim"]];
  const ehIphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalado = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const temPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let pedidoInstalar = null;
  let fundo;

  function criar(tag, props = {}, filhos = []) {
    const no = Object.assign(document.createElement(tag), props);
    for (const f of [].concat(filhos)) if (f != null) no.append(f);
    return no;
  }

  // <head>: o manifesto entra por aqui para não mexer no <head> de cada página.
  function cabecalho() {
    const add = (tag, attrs) => { if (!document.head.querySelector(`${tag}[${Object.keys(attrs)[0]}="${Object.values(attrs)[0]}"]`)) document.head.append(Object.assign(document.createElement(tag), attrs)); };
    add("link", { rel: "manifest", href: "/manifest.webmanifest" });
    add("link", { rel: "apple-touch-icon", href: "/apple-touch-icon.png" });
    add("meta", { name: "theme-color", content: "#071b70" });
    add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-title", content: "LicitaPlena" });
  }

  // Painel expõe o cliente dele; nas outras páginas um cliente próprio lê a mesma sessão salva no navegador.
  let sbProprio = null;
  async function token() {
    if (!window.__sbClient && !sbProprio && window.supabase && typeof SUPABASE_URL !== "undefined") sbProprio = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const r = await (window.__sbClient || sbProprio)?.auth.getSession();
    return r?.data?.session?.access_token || null;
  }

  async function api(metodo, corpo) {
    if (!window.__sbClient && !window.supabase) throw new Error("Para ativar os avisos, abra este botão no Painel.");
    const t = await token();
    if (!t) throw new Error("Faça login de novo.");
    const r = await fetch("/api/avisos-celular", { method: metodo, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || "Não foi possível falar com o LicitaPlena agora.");
    return d;
  }

  const chaveBytes = (b64u) => Uint8Array.from(atob(b64u.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const nomeAparelho = () => `${ehIphone ? "iPhone/iPad" : /Android/.test(navigator.userAgent) ? "Android" : "Computador"}${instalado() ? " (instalado)" : ""}`;

  async function inscricaoAtual() {
    if (!temPush()) return null;
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function ativar(chavePublica) {
    if ((await Notification.requestPermission()) !== "granted") throw new Error("O aparelho não permitiu notificações. Libere nas configurações do navegador.");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(chavePublica) });
    await api("POST", { acao: "inscrever", inscricao: sub.toJSON(), aparelho: nomeAparelho() });
    try { localStorage.setItem("lp-avisos-celular-sinc", String(Date.now())); } catch { /* sem armazenamento: só sincroniza de novo */ }
  }

  async function desligar() {
    const sub = await inscricaoAtual();
    if (!sub) return;
    await api("POST", { acao: "cancelar", endpoint: sub.endpoint });
    await sub.unsubscribe();
  }

  function blocoInstalar() {
    const sec = criar("div", { className: "lp-cartao" }, criar("h3", { textContent: "Instalar no celular" }));
    if (instalado()) { sec.append(criar("p", { className: "lp-dica", textContent: "O LicitaPlena já está instalado neste aparelho." })); return sec; }
    if (pedidoInstalar) {
      const b = criar("button", { type: "button", className: "lp-primario", textContent: "Instalar no celular" });
      b.addEventListener("click", async () => { pedidoInstalar.prompt(); await pedidoInstalar.userChoice; pedidoInstalar = null; abrir(); });
      sec.append(criar("p", { className: "lp-dica", textContent: "Cria um ícone do LicitaPlena na tela inicial, sem loja." }), b);
      return sec;
    }
    const passos = ehIphone
      ? ["Abra o LicitaPlena no Safari.", "Toque em Compartilhar (o quadrado com a seta para cima).", "Toque em \"Adicionar à Tela de Início\" e depois em Adicionar.", "Abra pelo ícone novo e ative os avisos aqui."]
      : ["Abra o LicitaPlena no Chrome do celular.", "Toque no menu ⋮ (canto de cima).", "Toque em \"Adicionar à tela inicial\" ou na opção de instalar.", "Abra pelo ícone novo e ative os avisos aqui."];
    sec.append(criar("ol", { className: "lp-passos" }, passos.map((p) => criar("li", { textContent: p }))));
    if (ehIphone) sec.append(criar("p", { className: "lp-dica", textContent: "No iPhone os avisos só funcionam pelo ícone da Tela de Início (iOS 16.4 ou mais novo)." }));
    return sec;
  }

  async function blocoAvisos(info) {
    const sec = criar("div", { className: "lp-cartao" }, criar("h3", { textContent: "Avisos neste aparelho" }));
    const msg = criar("p", { className: "lp-dica", role: "status" });
    sec.append(msg);
    if (!temPush()) {
      msg.textContent = ehIphone && !instalado() ? "No iPhone, adicione o LicitaPlena à Tela de Início (passos acima) e abra pelo ícone para ativar os avisos."
        : "Este navegador não recebe avisos. Use o Chrome, o Edge, o Firefox ou o Safari atualizados.";
      return sec;
    }
    if (!info.chavePublica) { msg.textContent = "Os avisos no celular ainda não foram ligados no LicitaPlena."; return sec; }
    const sub = await inscricaoAtual();
    const ligado = Boolean(sub) && Notification.permission === "granted";
    msg.textContent = ligado ? "Ligados: este aparelho recebe os avisos marcados abaixo." : Notification.permission === "denied"
      ? "Notificações bloqueadas neste navegador. Libere nas configurações do site e volte aqui." : "Desligados neste aparelho.";
    const b = criar("button", { type: "button", className: ligado ? "" : "lp-primario", textContent: ligado ? "Desligar avisos neste aparelho" : "Ativar avisos neste aparelho",
      disabled: Notification.permission === "denied" });
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { if (ligado) await desligar(); else await ativar(info.chavePublica); abrir(); } catch (e) { msg.textContent = e.message; b.disabled = false; }
    });
    sec.append(b);
    return sec;
  }

  function blocoTipos(info) {
    const sec = criar("div", { className: "lp-cartao" }, [criar("h3", { textContent: "Quais avisos receber" }),
      criar("p", { className: "lp-dica", textContent: "Vale para todos os seus aparelhos." })]);
    const msg = criar("p", { className: "lp-dica", role: "status" });
    const caixas = TIPOS.map(([t, rotulo]) => {
      const c = criar("input", { type: "checkbox", checked: info.preferencias?.[t] !== false, name: t });
      sec.append(criar("label", { className: "lp-opcao" }, [c, rotulo]));
      return c;
    });
    for (const c of caixas) {
      c.addEventListener("change", async () => {
        caixas.forEach((x) => { x.disabled = true; });
        try {
          await api("POST", { acao: "preferencias", preferencias: Object.fromEntries(caixas.map((x) => [x.name, x.checked])) });
          msg.textContent = "Salvo.";
        } catch (e) { c.checked = !c.checked; msg.textContent = e.message; }
        caixas.forEach((x) => { x.disabled = false; });
      });
    }
    sec.append(msg);
    return sec;
  }

  function montar() {
    if (!document.querySelector('link[href^="gaveta-lateral.css"]')) document.head.append(criar("link", { rel: "stylesheet", href: "gaveta-lateral.css" }));
    const fechar = criar("button", { type: "button", className: "lp-gaveta-fechar", title: "Fechar", textContent: "✕" });
    fechar.setAttribute("aria-label", "Fechar");
    const gaveta = criar("aside", { className: "lp-gaveta" }, [
      criar("div", { className: "lp-gaveta-topo" }, [criar("h2", { id: "celular-titulo", textContent: "LicitaPlena no celular" }), fechar]),
      criar("div", { className: "lp-gaveta-corpo", id: "celular-corpo" }),
    ]);
    gaveta.setAttribute("role", "dialog");
    gaveta.setAttribute("aria-modal", "true");
    gaveta.setAttribute("aria-labelledby", "celular-titulo");
    fundo = criar("div", { className: "lp-gaveta-fundo", hidden: true }, gaveta);
    document.body.append(fundo);
    fechar.addEventListener("click", () => { fundo.hidden = true; });
    fundo.addEventListener("click", (e) => { if (e.target === fundo) fundo.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !fundo.hidden) fundo.hidden = true; });
  }

  async function abrir() {
    if (!fundo) montar();
    const corpo = fundo.querySelector("#celular-corpo");
    fundo.hidden = false;
    corpo.replaceChildren(blocoInstalar(), criar("p", { className: "lp-dica", textContent: "Carregando…" }));
    fundo.querySelector(".lp-gaveta-fechar").focus();
    try {
      const info = await api("GET");
      corpo.replaceChildren(blocoInstalar(), await blocoAvisos(info), blocoTipos(info));
    } catch (e) {
      corpo.replaceChildren(blocoInstalar(), criar("p", { className: "lp-aviso lp-erro", textContent: e.message }));
    }
  }

  const ICONE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>';
  function botao(classe) {
    const b = criar("button", { type: "button", id: classe.includes("flutuante") ? "celular-btn-flutuante" : "celular-btn", className: classe, title: "LicitaPlena no celular (instalar e avisos)" });
    b.setAttribute("aria-label", "LicitaPlena no celular: instalar e avisos");
    b.innerHTML = ICONE;
    b.addEventListener("click", abrir);
    return b;
  }

  // Ao lado do "?" da Central de ajuda (ajuda-ui.js), com a mesma aparência dele em cada página.
  function instalarBotao() {
    const doPainel = document.getElementById("header-ajuda-btn");
    if (doPainel) {
      doPainel.after(botao("header-icone-btn")); // no celular o "?" some do topo, mas este ícone cabe e fica
      return;
    }
    const ajuda = document.getElementById("ajuda-btn");
    if (!ajuda) return;
    ajuda.after(botao(ajuda.classList.contains("lp-ajuda-flutuante") ? "lp-ajuda-flutuante lp-celular-flutuante" : ajuda.className));
  }

  // Inscrição apagada no banco (aparelho trocado, limpeza) com o aparelho ainda inscrito: reenviar 1x por dia.
  async function sincronizar() {
    try {
      if (Notification.permission !== "granted" || Date.now() - Number(localStorage.getItem("lp-avisos-celular-sinc") || 0) < 86400000) return;
      const sub = await inscricaoAtual();
      if (!sub) return;
      await api("POST", { acao: "inscrever", inscricao: sub.toJSON(), aparelho: nomeAparelho() });
      localStorage.setItem("lp-avisos-celular-sinc", String(Date.now()));
    } catch { /* sem sessão ou sem rede: tenta na próxima página */ }
  }

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedidoInstalar = e; });
  cabecalho();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("/sw.js").catch(() => {});
  if (document.body) instalarBotao(); else document.addEventListener("DOMContentLoaded", instalarBotao);
  if (temPush()) sincronizar();
  window.LicitaPlenaCelular = { abrir };
})();
