// Trava de tela pelo plano da conta (meu_plano, supabase/planos_e_recursos.sql). A garantia é do servidor (rotas /api,
// triggers e RLS); aqui só fica o aviso fixo no lugar da tela, sem pop-up. Três casos:
//   - teste encerrado (plano.bloqueado): trava o <main> inteiro; só o boletim por e-mail continua;
//   - parte fora do plano (ex.: Essencial sem Mercado): trava cada elemento com data-recurso="<codigo do recurso>";
//   - botão que só levaria a uma recusa (ex.: Chat com IA): data-recurso-esconder="<codigo>" some da tela.
// Elementos montados depois (dossiê do processo, botão do chat) entram pelo MutationObserver.
// Nada é apagado: os dados voltam quando a conta assina. Sem SQL aplicado (meu_plano ausente) não trava nada.
(function () {
  "use strict";
  const PLANOS = "assinar.html"; // tela de planos de quem já tem conta: escolhe, pede e paga por Pix

  function tokenDaSessao() {
    try {
      for (const chave of Object.keys(localStorage)) {
        if (!/^sb-.+-auth-token$/.test(chave)) continue;
        const v = JSON.parse(localStorage.getItem(chave) || "null");
        const t = v && (v.access_token || (v.currentSession && v.currentSession.access_token));
        if (t) return t;
      }
    } catch (_) { /* sem armazenamento: não trava (o servidor continua barrando) */ }
    return null;
  }

  async function lerPlano() {
    if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined") return null;
    const token = tokenDaSessao();
    if (!token) return null;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/meu_plano`, { method: "POST", body: "{}",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" } });
      return r.ok ? await r.json() : null;
    } catch (_) { return null; }
  }

  function estilo() {
    if (document.getElementById("trava-plano-estilo")) return;
    const s = document.createElement("style");
    s.id = "trava-plano-estilo";
    s.textContent = "[data-travado] > :not(.trava-plano) { display: none !important; }"
      + ".trava-plano { max-width: 560px; margin: 32px auto; padding: 24px; box-sizing: border-box; border-radius: 12px;"
      + " border: 1px solid var(--border-default, #d0d5dd); background: var(--surface-default, #fff); color: var(--text-primary, #1d2939); }"
      + ".trava-plano h2 { margin: 0 0 8px; font-size: 20px; line-height: 28px; }"
      + ".trava-plano p { margin: 0 0 16px; line-height: 1.5; overflow-wrap: anywhere; }"
      + ".trava-plano a { display: inline-block; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;"
      + " background: var(--action-strong, #1849a9); color: #fff; }"
      + "@media (max-width: 480px) { .trava-plano { margin: 16px 0; padding: 16px; } .trava-plano a { display: block; text-align: center; } }";
    document.head.append(s);
  }

  function travar(el, titulo, texto, botao) {
    // A tela pode trocar o conteúdo depois (replaceChildren): sem o aviso, ele volta.
    if (!el || [...el.children].some((f) => f.classList.contains("trava-plano"))) return;
    estilo();
    const caixa = document.createElement("div");
    caixa.className = "trava-plano";
    caixa.setAttribute("role", "status");
    const h = document.createElement("h2"); h.textContent = titulo;
    const p = document.createElement("p"); p.textContent = texto;
    const a = document.createElement("a"); a.href = PLANOS; a.textContent = botao;
    caixa.append(h, p, a);
    el.prepend(caixa);
    el.setAttribute("data-travado", "");
  }

  function aplicar(plano) {
    if (!plano || typeof plano !== "object") return;
    // Selo do topo do painel: o plano que vale hoje (assinatura), não o campo antigo clientes.plano.
    const selo = document.getElementById("header-badge-plano");
    const nomeSelo = plano.bloqueado === true ? (plano.situacao === "teste" || plano.situacao === "sem_assinatura" ? "Teste encerrado" : "Assinatura vencida")
      : plano.nome ? plano.nome + (plano.em_teste === true ? " (teste)" : "") : "";
    if (nomeSelo) { window.__nomePlanoConta = nomeSelo; if (selo && selo.textContent !== nomeSelo) selo.textContent = nomeSelo; }
    const recursos = plano.recursos || {};
    document.querySelectorAll("[data-recurso-esconder]").forEach((el) => {
      const r = recursos[el.getAttribute("data-recurso-esconder")];
      if (plano.bloqueado === true || (r && r.permitido === false)) el.style.setProperty("display", "none", "important");
    });
    if (plano.bloqueado === true) {
      // Assinatura vencida e não renovada fica igual ao teste vencido (só o boletim), com "Renovar" no lugar de "Assinar".
      if (plano.situacao === "teste" || plano.situacao === "sem_assinatura") travar(document.querySelector("main"), "Seu teste grátis terminou",
        "Você continua recebendo o boletim por e-mail. Para voltar a usar as outras telas, assine um plano. O que você salvou continua guardado.", "Assinar");
      else travar(document.querySelector("main"), "Sua assinatura venceu",
        "Você continua recebendo o boletim por e-mail. Para voltar a usar as outras telas, renove a assinatura. O que você salvou continua guardado.", "Renovar");
      return;
    }
    document.querySelectorAll("[data-recurso]").forEach((el) => {
      const r = recursos[el.getAttribute("data-recurso")];
      if (r && r.permitido === false) {
        travar(el, "Esta parte não está no seu plano",
          `${r.nome || "Esta ferramenta"} não faz parte do plano ${plano.nome || "atual"}. Para usar, mude de plano. O resto continua funcionando normalmente.`, "Ver planos");
      }
    });
  }

  async function iniciar() {
    let plano = await lerPlano();
    // Sessão vencida no armazenamento: a página renova o token logo depois; tenta de novo uma vez.
    if (!plano) { await new Promise((ok) => setTimeout(ok, 3000)); plano = await lerPlano(); }
    aplicar(plano);
    if (!plano) return;
    let agendado = false;
    new MutationObserver(() => {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => { agendado = false; aplicar(plano); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
