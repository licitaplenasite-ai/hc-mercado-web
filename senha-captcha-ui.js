// Utilidades das telas de acesso (login, cadastro, convite, admin): olho da senha e captcha hCaptcha visível.
/* global module, window, HCAPTCHA_SITEKEY */
(function (raiz) {
  // Chave de teste oficial do hCaptcha: a chave de produção é recusada em localhost ("Solicitação não permitida")
  // e o Supabase local (ambiente-teste) não exige captcha, então o token de teste é ignorado lá.
  const CHAVE_TESTE = "10000000-ffff-ffff-ffff-000000000001";
  const HOSTS_LOCAIS = ["localhost", "127.0.0.1", "[::1]", "::1"];
  // Render explícito: o widget só nasce quando o script avisa (onload), no elemento que a tela reservou.
  const SCRIPT_HCAPTCHA = "https://js.hcaptcha.com/1/api.js?render=explicit&onload=licitaplenaHCaptchaPronto&hl=pt";
  const MSG_CAPTCHA = "Não conseguimos concluir a verificação de segurança. Marque a caixinha 'Sou humano' de novo. Se continuar, recarregue a página.";
  const MSG_MARCAR = "Marque a caixinha 'Sou humano' e tente de novo.";

  // A chave de produção fica só em supabase-config.js (HCAPTCHA_SITEKEY). Vazia = captcha desligado.
  function chaveConfigurada() {
    return typeof HCAPTCHA_SITEKEY === "string" ? HCAPTCHA_SITEKEY : "";
  }

  function chaveHCaptcha(hostname, chaveProducao) {
    if (HOSTS_LOCAIS.includes(String(hostname || "").toLowerCase())) return CHAVE_TESTE;
    return String(chaveProducao || "").trim();
  }

  // Erro do Supabase Auth causado pelo captcha (ex.: "captcha protection: request disallowed").
  function ehErroDeCaptcha(erro) {
    return /captcha/i.test(String((erro && erro.message) || ""));
  }

  // Monta a caixinha "Sou humano" no .captcha-widget da página e devolve { ativo, obterToken, resetar }.
  // Sem chave não carrega script nenhum e o token sai vazio: o login segue normal, porque quem cobra o
  // captcha é o Supabase (Attack Protection), e só depois que o dono liga a exigência lá.
  function montarCaptcha(doc, win, chaveProducao = chaveConfigurada()) {
    const el = doc.querySelector(".captcha-widget");
    const rotulo = doc.querySelector(".captcha-rotulo");
    const aviso = doc.querySelector(".captcha-aviso");
    const sitekey = el ? chaveHCaptcha(win.location.hostname, chaveProducao) : "";
    let widgetId = null;

    const avisar = (texto) => { if (aviso) { aviso.textContent = texto; aviso.hidden = false; } };

    const captcha = {
      ativo: Boolean(sitekey),
      // Widget visível: o token existe assim que a pessoa marca a caixinha, então não há o que esperar.
      // Sem marcar, avisa na tela e devolve vazio (a tela segue e o Supabase recusa, se exigir).
      obterToken() {
        if (!sitekey) return Promise.resolve("");
        const token = (widgetId !== null && win.hcaptcha && win.hcaptcha.getResponse(widgetId)) || "";
        if (!token) avisar(MSG_MARCAR);
        return Promise.resolve(token);
      },
      // Token é de uso único: resetar depois de cada tentativa (deu certo ou não). O aviso fica na tela
      // até a pessoa marcar a caixinha de novo (callback), senão o "Marque a caixinha" piscaria e sumiria.
      resetar() {
        if (widgetId !== null && win.hcaptcha) win.hcaptcha.reset(widgetId);
      },
    };
    if (!sitekey) { if (el) el.hidden = true; if (rotulo) rotulo.hidden = true; return captcha; }

    win.licitaplenaHCaptchaPronto = () => {
      widgetId = win.hcaptcha.render(el, {
        sitekey,
        theme: doc.documentElement.dataset.theme === "dark" ? "dark" : "light",
        callback: () => { if (aviso) aviso.hidden = true; },
        "error-callback": () => avisar(MSG_CAPTCHA),
      });
    };
    const s = doc.createElement("script");
    s.src = SCRIPT_HCAPTCHA;
    s.async = true;
    s.defer = true;
    s.onerror = () => avisar(MSG_CAPTCHA); // bloqueado por extensão/rede: avisa sem travar
    doc.head.appendChild(s);
    return captcha;
  }

  // Alterna type password/text e o estado do botão (aria-label, aria-pressed, ícone do olho).
  function alternarSenha(btn, doc) {
    const alvo = doc.getElementById(btn.dataset.alvo);
    alvo.type = alvo.type === "password" ? "text" : "password";
    const visivel = alvo.type === "text";
    btn.setAttribute("aria-pressed", String(visivel));
    btn.setAttribute("aria-label", visivel ? "Ocultar senha" : "Mostrar senha");
    btn.title = visivel ? "Ocultar senha" : "Mostrar senha";
    btn.classList.toggle("senha-visivel", visivel);
    return visivel;
  }

  function ligarOlhosDaSenha(doc) {
    doc.querySelectorAll(".btn-mostrar-senha").forEach((btn) => btn.addEventListener("click", () => alternarSenha(btn, doc)));
  }

  const api = { CHAVE_TESTE, MSG_CAPTCHA, MSG_MARCAR, SCRIPT_HCAPTCHA, chaveHCaptcha, ehErroDeCaptcha, montarCaptcha, alternarSenha, ligarOlhosDaSenha };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.SenhaCaptchaUi = api;
})(typeof window !== "undefined" ? window : globalThis);
