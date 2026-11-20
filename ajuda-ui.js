/* global document, window, location, module -- script de navegador (module só no Node, ver o fim) */
// Central de ajuda "?" (item 28 da análise do Siga Pregão): botão "?" no topo de todas as páginas logadas, com
// WhatsApp do suporte, link para o Guia de uso (ajuda.html) e tutoriais curtos por tela (texto + print de dados fictícios).
// Vídeos: lugar pronto em cada tutorial (VIDEOS abaixo); enquanto vazio aparece "vídeo em breve". Incluir com <script src="ajuda-ui.js" defer></script>; nada mais precisa mudar na página.
// No painel reaproveita o "?" que já existe (#header-ajuda-btn); nas outras páginas entra no topo (.acoes /
// .app-controles) ou, sem topo, como botão flutuante.
// window = globalThis no Node: o chat com IA (netlify/functions/_chat_ia.js) lê TUTORIAIS por require.
(function (window) {
  "use strict";
  if (window.LicitaPlenaAjuda) return;

  // Número do WhatsApp do suporte: vem da configuração do site (LICITAPLENA_WHATSAPP_SUPORTE em supabase-config.js),
  // só dígitos com DDI 55 (12 ou 13 dígitos). Lido na hora de abrir, não no carregamento: a ordem dos <script> não
  // importa. Vazio ou inválido: o botão fica desligado e a ajuda aponta para o formulário de dúvidas.
  function numeroWhatsApp() {
    const n = String(window.LICITAPLENA_WHATSAPP_SUPORTE || "").replace(/\D/g, "");
    return /^55\d{10,11}$/.test(n) ? n : "";
  }

  // Vídeo curto de cada tutorial: id do tutorial -> arquivo em ajuda/videos/ (.mp4 ou .webm, servido pelo próprio
  // site, sem YouTube: a CSP não libera outro domínio). Os vídeos ainda não foram gravados.
  const VIDEOS = {};
  function videoDoTutorial(t) {
    const src = String((t && VIDEOS[t.id]) || "");
    return /^ajuda\/videos\/[a-z0-9-]+\.(mp4|webm)$/.test(src) ? src : null;
  }

  // telas: trecho do endereço (página e, no painel, a âncora) que mostra este tutorial primeiro.
  const TUTORIAIS = [
    { id: "painel", titulo: "Painel e menu", telas: ["painel.html"], print: "p01-painel-menu",
      passos: ["Todas as ferramentas ficam no menu da esquerda.", "Sua conta, lembretes e planos ficam no botão com suas iniciais, em cima à direita.", "No celular, o menu abre no botão Menu."] },
    { id: "busca", titulo: "Encontrar Licitações", telas: ["#oportunidades"], print: "p04-busca",
      passos: ["Menu → Encontrar Licitações.", "Digite o produto ou serviço e escolha os estados.", "Clique em Buscar. Em cada cartão: Resumir edital, favoritar ou mandar para o Funil."] },
    { id: "resumo", titulo: "Resumo do Edital e Pergunte ao Edital", telas: ["#oportunidades", "#boletim", "#kanban"], print: "r02-gaveta-resumo",
      passos: ["No cartão, clique em Resumir edital: abre a gaveta do lado direito.", "Clique em Pergunte ao Edital e escreva sua dúvida. A resposta vem só do edital, com o trecho e a página.", "Se a resposta não estiver no edital, aparece \"Não encontrei no edital\". Confira sempre os documentos oficiais."] },
    { id: "boletim", titulo: "Boletim", telas: ["#boletim"], print: "p02-boletim",
      passos: ["Menu → Boletim: as licitações novas do seu filtro, todo dia.", "Em Configurar, escolha estados e palavras.", "O mesmo boletim chega por e-mail."] },
    { id: "calendario", titulo: "Calendário", telas: ["#calendario"], print: "p03-calendario",
      passos: ["Menu → Calendário.", "Clique num dia para ver as licitações daquele dia."] },
    { id: "funil", titulo: "Funil", telas: ["#kanban"], print: "p05-funil",
      passos: ["Menu → Funil.", "Arraste o cartão entre as colunas (Tenho interesse, Participando, Ganhei...).", "No cartão, Abrir no sistema leva o processo para o CRM."] },
    { id: "precos", titulo: "Pesquisa de Preços", telas: ["#precos"], print: "p06-precos",
      passos: ["Menu → Pesquisa de Preços.", "Digite o item e veja os preços que o governo já pagou, com a marca quando informada."] },
    { id: "inteligencia", titulo: "Inteligência de Mercado e fornecedor com IA", telas: ["#diagnostico"], print: "p07-inteligencia",
      passos: ["Menu → Inteligência de Mercado: Visão Geral, Baixa Concorrência, Histórico de Compras, Licitação Anterior e Prospecção de Fornecedores (IA).", "Em Prospecção de Fornecedores (IA), clique em Encontrar fornecedor com IA e descreva o produto: vêm 3 empresas por vez, com aderência e contato público.", "Use Trazer mais três para ver outras. A IA pode errar: confira antes de negociar."] },
    { id: "licitacao-anterior", titulo: "Licitação anterior", telas: ["#licitacao-anterior"], print: "p08-licitacao-anterior",
      passos: ["Busque o órgão, informe o produto e clique em Consultar licitações anteriores.", "Mostra quem ganhou, preços, marcas e quem foi desclassificado."] },
    { id: "prospeccao", titulo: "Prospecção (antes do edital)", telas: ["prospeccao.html"], print: "p13-prospeccao",
      passos: ["Menu → Prospecção: compras antes do edital sair.", "Abas: planos de contratação (PCA), IRP abertas, atas para adesão e contratos vencendo."] },
    { id: "concorrente", titulo: "Analisar concorrente", telas: ["#empresa"], print: "p09-concorrente",
      passos: ["Menu → Analisar concorrente.", "Cole o CNPJ e clique em Analisar: mostra o que a empresa ganhou, onde e por quanto."] },
    { id: "juridico", titulo: "Jurídico & Dúvidas", telas: ["#juridico"], print: "p10-juridico",
      passos: ["Menu → Jurídico & Dúvidas: artigos e formulário para mandar dúvida à equipe."] },
    { id: "hoje", titulo: "Hoje (CRM)", telas: ["/sistema", "sistema.html"], print: "c01-hoje",
      passos: ["A tela Hoje mostra o que vence e os alertas.", "No topo, escolha a empresa e o processo.", "O processo aberto é uma página só: empresa, checklist do edital, itens e preços, robô de lances e documentos."] },
    { id: "processos", titulo: "Processos", telas: ["processos.html"], print: "c13-processos",
      passos: ["Menu → Processos: lista de processos, contratos e empenhos.", "Use + Processo para cadastrar um novo."] },
    { id: "empresas", titulo: "Minhas empresas e documentos", telas: ["operacao.html"], print: "c15-perfil-empresa",
      passos: ["Cadastre a empresa e os documentos com a validade.", "Verde, amarelo e vermelho mostram o que está válido, vencendo ou vencido.", "Baixar PDF único junta os documentos marcados."] },
    { id: "extensao", titulo: "Extensão do navegador", telas: ["extensao.html"], print: "e01-pagina-extensao",
      passos: ["Instale a extensão no Chrome ou Edge pela página Extensão.", "Ela lê pregões, ajuda a preencher a proposta no Compras.gov e vigia o chat."] },
    { id: "bdi", titulo: "Calculadora de BDI", telas: ["bdi.html"], print: "p14-bdi",
      passos: ["Preencha os percentuais e veja o BDI da obra."] },
    { id: "sinapi", titulo: "Preços SINAPI", telas: ["sinapi.html"], print: "p15-sinapi",
      passos: ["Escolha o estado e a tabela e digite o serviço.", "Usar este preço leva o valor para o item do processo."] },
  ];

  function criar(tag, props = {}, filhos = []) {
    const no = Object.assign(document.createElement(tag), props);
    for (const f of [].concat(filhos)) if (f != null) no.append(f);
    return no;
  }

  // Tutoriais da tela atual primeiro (âncora do painel vale mais que a página), depois os demais na ordem.
  function ordenarPorTela(endereco) {
    const pontos = (t) => Math.max(0, ...t.telas.map((tela) => (endereco.includes(tela) ? (tela.startsWith("#") ? 2 : 1) : 0)));
    return TUTORIAIS.map((t, i) => ({ t, p: pontos(t), i })).sort((a, b) => b.p - a.p || a.i - b.i).map((x) => x.t);
  }

  function linkWhatsApp() {
    const numero = numeroWhatsApp();
    return numero ? `https://wa.me/${numero}?text=${encodeURIComponent("Olá! Preciso de ajuda com o LicitaPlena.")}` : null;
  }

  function listaTutoriais(endereco, abrirPrimeiro) {
    const lista = criar("ul", { className: "lp-lista-tutoriais" });
    ordenarPorTela(endereco).forEach((t, i) => {
      const detalhe = criar("details", { id: `tutorial-${t.id}`, open: abrirPrimeiro && i === 0 }, [
        criar("summary", { textContent: t.titulo }),
        criar("div", { className: "lp-tutorial" }, [
          criar("ol", {}, t.passos.map((p) => criar("li", { textContent: p }))),
          criar("img", { src: `ajuda/${t.print}.webp`, alt: `Tela: ${t.titulo}`, loading: abrirPrimeiro && i === 0 ? "eager" : "lazy", width: 1280, height: 800 }),
          videoDoTutorial(t)
            ? criar("video", { src: videoDoTutorial(t), controls: true, preload: "none", className: "lp-tutorial-video", title: `Vídeo: ${t.titulo}` })
            : criar("p", { className: "lp-dica lp-tutorial-video-vazio", textContent: "Vídeo deste tutorial: em breve." }),
        ]),
      ]);
      lista.append(criar("li", {}, detalhe));
    });
    return lista;
  }

  let fundo;
  function montar() {
    if (!document.querySelector('link[href^="gaveta-lateral.css"]')) document.head.append(criar("link", { rel: "stylesheet", href: "gaveta-lateral.css" }));
    const fechar = criar("button", { type: "button", className: "lp-gaveta-fechar", title: "Fechar", textContent: "✕" });
    fechar.setAttribute("aria-label", "Fechar central de ajuda");
    const zap = linkWhatsApp();
    const botaoZap = zap
      ? criar("a", { className: "lp-botao lp-primario", href: zap, target: "_blank", rel: "noopener", textContent: "Falar no WhatsApp" })
      : criar("button", { type: "button", disabled: true, title: "WhatsApp do suporte ainda não configurado", textContent: "WhatsApp (em breve)" });
    const duvida = criar("a", { className: "lp-botao", href: "painel.html#juridico", textContent: "Mandar dúvida à equipe" });
    duvida.addEventListener("click", (e) => {
      const nav = document.querySelector('nav button[data-alvo="juridico"]');
      if (nav) { e.preventDefault(); fundo.hidden = true; nav.click(); }
    });
    const corpo = criar("div", { className: "lp-gaveta-corpo" }, [
      criar("div", { className: "lp-acoes-ajuda" }, [botaoZap, duvida]),
      criar("p", { style: "margin:0 0 16px" }, [criar("a", { href: "ajuda.html", target: "_blank", rel: "noopener", textContent: "Abrir o Guia de uso completo" })]),
      criar("h3", { textContent: "Tutoriais por tela", style: "margin:0 0 8px;font:600 16px/24px var(--font-sans)" }),
      criar("p", { className: "lp-dica", textContent: "Os da tela onde você está aparecem primeiro. Cada um terá um vídeo curto.", style: "margin-bottom:12px" }),
    ]);
    corpo.dataset.ajudaCorpo = "";
    const gaveta = criar("aside", { className: "lp-gaveta" }, [
      criar("div", { className: "lp-gaveta-topo" }, [criar("h2", { id: "ajuda-titulo", textContent: "Central de ajuda" }), fechar]),
      corpo,
    ]);
    gaveta.setAttribute("role", "dialog");
    gaveta.setAttribute("aria-modal", "true");
    gaveta.setAttribute("aria-labelledby", "ajuda-titulo");
    fundo = criar("div", { className: "lp-gaveta-fundo", hidden: true }, gaveta);
    document.body.append(fundo);
    fechar.addEventListener("click", () => { fundo.hidden = true; });
    fundo.addEventListener("click", (e) => { if (e.target === fundo) fundo.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && fundo && !fundo.hidden) fundo.hidden = true; });
  }

  function abrirAjuda() {
    if (!fundo) montar();
    const corpo = fundo.querySelector("[data-ajuda-corpo]");
    corpo.querySelector(".lp-lista-tutoriais")?.remove();
    corpo.append(listaTutoriais(location.pathname + location.hash, true));
    fundo.hidden = false;
    fundo.querySelector(".lp-gaveta-fechar").focus();
  }

  function instalarBotao() {
    if (document.body.dataset.semAjuda !== undefined) return;
    // Painel: o "?" do topo já chama abrirAjuda, mas o painel o esconde no celular; ali entra o flutuante só no celular.
    const doPainel = Boolean(document.getElementById("header-ajuda-btn"));
    const topo = doPainel ? null : document.querySelector("header .acoes, header .app-controles");
    const botao = criar("button", { type: "button", id: "ajuda-btn", title: "Ajuda", textContent: "?" });
    botao.setAttribute("aria-label", "Abrir central de ajuda");
    if (topo) {
      if (topo.classList.contains("acoes")) botao.className = "btn tema-icone";
      topo.prepend(botao);
    } else {
      if (!document.querySelector('link[href^="gaveta-lateral.css"]')) document.head.append(criar("link", { rel: "stylesheet", href: "gaveta-lateral.css" }));
      botao.className = doPainel ? "lp-ajuda-flutuante so-celular" : "lp-ajuda-flutuante";
      document.body.append(botao);
    }
    botao.addEventListener("click", abrirAjuda);
  }

  window.LicitaPlenaAjuda = { abrir: abrirAjuda, listaTutoriais, ordenarPorTela, TUTORIAIS, VIDEOS, videoDoTutorial, linkWhatsApp };
  if (typeof document !== "undefined" && document.body) instalarBotao();
  else if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", instalarBotao);
  if (typeof module !== "undefined" && module.exports) module.exports = window.LicitaPlenaAjuda;
})(typeof window !== "undefined" ? window : globalThis);
