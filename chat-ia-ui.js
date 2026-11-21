/* global document, window, localStorage, crypto, fetch, SUPABASE_URL, SUPABASE_ANON_KEY -- script de navegador */
// Chat com IA do LicitaPlena (equivalente ao "B2G Talk" do Siga Pregão): botão "IA · BETA" no canto de baixo à direita
// de todas as telas logadas, que abre uma gaveta de conversa. Fala só com /api/chat-ia (netlify/functions/chat-ia.js).
// Incluir com <script src="chat-ia-ui.js" defer></script> depois do ajuda-ui.js; nada mais muda na página.
// Visual: aguarda aprovação do dono. Texto da IA entra sempre como textContent (nunca HTML).
(function () {
  "use strict";
  if (window.LicitaPlenaChatIa || !document.body || document.body.dataset.semChatIa !== undefined) return;

  const CHAVE_SALVAR = "licitaplena_chat_ia_salvar";
  const CHAVE_EMPRESA = "licitaplena_empresa_operacional_id"; // mesma empresa ativa do painel, Processos e Minhas empresas
  const SUGESTOES = ["Qual o prazo para apresentar recurso?", "Quais são meus prazos desta semana?", "Onde fica a Pesquisa de Preços?"];
  const conversaId = crypto.randomUUID ? crypto.randomUUID() : null;
  const historico = [];
  let fundo, lista, campo, enviar, salvar;

  const criar = (tag, props = {}, filhos = []) => {
    const no = Object.assign(document.createElement(tag), props);
    for (const f of [].concat(filhos)) if (f != null) no.append(f);
    return no;
  };
  const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem localStorage: só não lembra */ } };
  const linkOficial = (u) => typeof u === "string" && /^https:\/\/(www\.)?([a-z0-9-]+\.)*gov\.br\//i.test(u);

  // Painel expõe o cliente dele; nas outras páginas um cliente próprio lê a mesma sessão salva no navegador.
  let sbProprio = null;
  async function token() {
    if (!window.__sbClient && !sbProprio && window.supabase && typeof SUPABASE_URL !== "undefined") sbProprio = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const r = await (window.__sbClient || sbProprio)?.auth.getSession();
    return r?.data?.session?.access_token || null;
  }

  async function api(corpo) {
    const t = await token();
    if (!t) throw new Error("Faça login de novo para usar o chat.");
    const r = await fetch("/api/chat-ia", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || "O chat não está disponível agora.");
    return d;
  }

  function mensagem(papel, texto, extra = {}) {
    const caixa = criar("div", { className: `lp-chat-msg lp-chat-${papel}` }, criar("p", { textContent: texto }));
    if (extra.fontes?.length) {
      caixa.append(criar("p", { className: "lp-chat-fontes-titulo", textContent: "Fontes:" }), criar("ul", { className: "lp-chat-fontes" }, extra.fontes.map((f) => {
        const rotulo = `${f.titulo}${f.detalhe ? ` — ${f.detalhe}` : ""}`;
        return criar("li", {}, linkOficial(f.url) ? criar("a", { href: f.url, target: "_blank", rel: "noopener noreferrer", textContent: rotulo }) : rotulo);
      })));
    }
    if (extra.modo === "base") caixa.append(criar("p", { className: "lp-dica", textContent: "A IA está indisponível agora: esta resposta veio dos guias e dos dados do LicitaPlena." }));
    lista.append(caixa);
    caixa.scrollIntoView({ block: "end" });
    return caixa;
  }

  async function perguntar(texto) {
    const pergunta = String(texto || "").trim();
    if (!pergunta || enviar.disabled) return;
    mensagem("usuario", pergunta);
    campo.value = "";
    enviar.disabled = true;
    const pensando = mensagem("ia", "Pensando…");
    try {
      const d = await api({ acao: "perguntar", pergunta, historico: historico.slice(-6), empresaId: ler(CHAVE_EMPRESA) || null, salvar: salvar.checked, conversaId });
      pensando.remove();
      mensagem("ia", d.resposta, d);
      historico.push({ papel: "usuario", texto: pergunta }, { papel: "ia", texto: d.resposta });
    } catch (e) {
      pensando.remove();
      mensagem("erro", e.message);
    } finally {
      enviar.disabled = false;
      campo.focus();
    }
  }

  async function verHistorico() {
    try {
      const d = await api({ acao: "historico" });
      lista.replaceChildren();
      if (!d.mensagens.length) { mensagem("ia", "Nenhuma conversa salva. Ligue \"Salvar histórico\" para guardar as próximas."); return; }
      for (const m of [...d.mensagens].reverse()) { mensagem("usuario", m.pergunta); mensagem("ia", m.resposta, { fontes: m.fontes }); }
    } catch (e) { mensagem("erro", e.message); }
  }

  async function apagarHistorico() {
    if (!window.confirm("Apagar todo o histórico salvo do chat? Isso não pode ser desfeito.")) return;
    try { await api({ acao: "apagar" }); mensagem("ia", "Histórico salvo apagado."); } catch (e) { mensagem("erro", e.message); }
  }

  function montar() {
    for (const href of ["gaveta-lateral.css", "chat-ia-ui.css"]) if (!document.querySelector(`link[href^="${href}"]`)) document.head.append(criar("link", { rel: "stylesheet", href }));
    const fechar = criar("button", { type: "button", className: "lp-gaveta-fechar", title: "Fechar", textContent: "✕" });
    fechar.setAttribute("aria-label", "Fechar chat com IA");
    lista = criar("div", { className: "lp-chat-lista" });
    lista.setAttribute("role", "log");
    lista.setAttribute("aria-live", "polite");
    campo = criar("textarea", { id: "lp-chat-campo", maxLength: 1000, rows: 2, placeholder: "Pergunte sobre licitação, seus processos e prazos, ou onde fica algo no LicitaPlena" });
    campo.setAttribute("aria-label", "Sua pergunta");
    enviar = criar("button", { type: "submit", className: "lp-primario", textContent: "Enviar" });
    salvar = criar("input", { type: "checkbox", id: "lp-chat-salvar", checked: ler(CHAVE_SALVAR) === "1" });
    salvar.addEventListener("change", () => gravar(CHAVE_SALVAR, salvar.checked ? "1" : "0"));
    const form = criar("form", { className: "lp-chat-form" }, [campo, enviar]);
    form.addEventListener("submit", (e) => { e.preventDefault(); perguntar(campo.value); });
    campo.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(campo.value); } });
    const sugestoes = criar("div", { className: "lp-chat-sugestoes" }, SUGESTOES.map((s) => {
      const b = criar("button", { type: "button", className: "lp-chat-sugestao", textContent: s });
      b.addEventListener("click", () => perguntar(s));
      return b;
    }));
    const botaoHist = criar("button", { type: "button", textContent: "Ver histórico salvo" });
    botaoHist.addEventListener("click", verHistorico);
    const botaoApagar = criar("button", { type: "button", textContent: "Apagar histórico" });
    botaoApagar.addEventListener("click", apagarHistorico);
    const gaveta = criar("aside", { className: "lp-gaveta lp-chat" }, [
      criar("div", { className: "lp-gaveta-topo" }, [criar("h2", { id: "lp-chat-titulo" }, ["Assistente IA ", criar("span", { className: "lp-chat-beta", textContent: "BETA" })]), fechar]),
      criar("p", { className: "lp-aviso lp-chat-aviso", textContent: "É uma IA e pode errar. Responde com os guias e os dados do LicitaPlena e cita a fonte; confira sempre o edital e a lei. Não informe CPF." }),
      criar("div", { className: "lp-gaveta-corpo" }, [lista, sugestoes]),
      criar("div", { className: "lp-gaveta-rodape" }, [form,
        criar("div", { className: "lp-chat-opcoes" }, [criar("label", { className: "lp-opcao", htmlFor: "lp-chat-salvar" }, [salvar, "Salvar histórico"]), botaoHist, botaoApagar])]),
    ]);
    gaveta.setAttribute("role", "dialog");
    gaveta.setAttribute("aria-modal", "true");
    gaveta.setAttribute("aria-labelledby", "lp-chat-titulo");
    fundo = criar("div", { className: "lp-gaveta-fundo", hidden: true }, gaveta);
    document.body.append(fundo);
    mensagem("ia", "Olá! Posso tirar dúvidas sobre licitação (Lei 14.133 e outras), mostrar seus processos, prazos e certidões, e dizer onde fica cada coisa no LicitaPlena.");
    fechar.addEventListener("click", () => { fundo.hidden = true; });
    fundo.addEventListener("click", (e) => { if (e.target === fundo) fundo.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !fundo.hidden) fundo.hidden = true; });
  }

  function abrir() {
    if (!fundo) montar();
    fundo.hidden = false;
    campo.focus();
  }

  function instalarBotao() {
    if (!document.querySelector('link[href^="chat-ia-ui.css"]')) document.head.append(criar("link", { rel: "stylesheet", href: "chat-ia-ui.css" }));
    const botao = criar("button", { type: "button", id: "chat-ia-btn", className: "lp-chat-flutuante", title: "Chat com IA (beta)" }, ["IA", criar("span", { className: "lp-chat-beta", textContent: "BETA" })]);
    botao.setAttribute("aria-label", "Abrir chat com IA (beta)");
    botao.addEventListener("click", abrir);
    document.body.classList.add("lp-com-chat-ia");
    document.body.append(botao);
  }

  window.LicitaPlenaChatIa = { abrir };
  instalarBotao();
})();
