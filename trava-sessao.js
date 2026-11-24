/* Trava de sessão das telas do sistema (24/11/2026, auditoria de segurança).
   Por quê: cada tela interna checava o login só no fim da página, depois de desenhada; por um instante (ou para sempre,
   se o JS falhasse) a tela aparecia para quem não estava logado. O dono exige: nenhuma tela do sistema sem cadastro.
   Como: carregado SEM defer no <head>, logo depois do supabase-js e do supabase-config.js. Esconde a página, manda
   direto para o login quem não tem sessão guardada e só mostra a tela depois de confirmar a sessão no Supabase e o
   cadastro "aprovado". data-exige="sessao" (só a tela de pagamento) aceita conta ainda não aprovada.
   Os dados continuam protegidos no servidor (RLS e functions com login); esta trava cuida do que aparece na tela. */
(function () {
  "use strict";
  var raiz = document.documentElement;
  var exige = (document.currentScript && document.currentScript.dataset.exige) || "aprovado";
  raiz.style.visibility = "hidden";
  // Com o #: o link do e-mail (painel.html?edicao=...#boletim) volta para o Boletim depois do login, não para a busca.
  function irParaLogin() { location.replace("login.html?voltar=" + encodeURIComponent(location.pathname + location.search + location.hash)); }
  function liberar() { raiz.style.visibility = ""; }

  var temToken = false;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      if (/^sb-.+-auth-token$/.test(localStorage.key(i) || "")) { temToken = true; break; }
    }
  } catch (e) { temToken = true; } // sem acesso ao armazenamento: deixa o Supabase decidir abaixo
  if (!temToken) { irParaLogin(); return; }

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
      }
      liberar();
    } catch (e) { irParaLogin(); }
  }
  if (window.supabase && typeof SUPABASE_URL !== "undefined") conferir();
  else document.addEventListener("DOMContentLoaded", conferir);
})();
