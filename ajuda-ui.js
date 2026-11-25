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
  // Também aceita YouTube não listado: "youtube:ID_DO_VIDEO" (11 caracteres); entra como player sem cookies.
  const VIDEOS = {};
  function videoDoTutorial(t) {
    const src = String((t && VIDEOS[t.id]) || "");
    const yt = src.match(/^youtube:([A-Za-z0-9_-]{11})$/);
    if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
    return /^ajuda\/videos\/[a-z0-9-]+\.(mp4|webm)$/.test(src) ? src : null;
  }

  // HC Licitações (parceira): endereços vêm da configuração do site (supabase-config.js). Vazio = chamada e botões somem.
  function contatosHC() {
    const zap = String(window.LICITAPLENA_HC_WHATSAPP || "").replace(/\D/g, "");
    const site = String(window.LICITAPLENA_HC_SITE || "");
    return {
      whatsapp: /^55\d{10,11}$/.test(zap) ? `https://wa.me/${zap}?text=${encodeURIComponent("Olá! Sou cliente do LicitaPlena e preciso de ajuda com licitações.")}` : null,
      site: /^https:\/\/[^\s]+$/.test(site) ? site : null,
    };
  }

  // telas: trecho do endereço (página e, no painel, a âncora) que mostra este tutorial primeiro.
  const TUTORIAIS = [
    { id: "painel", titulo: "Painel e menu", telas: ["painel.html"], print: "p01-painel-menu",
      passos: ["Todas as ferramentas ficam no menu da esquerda.", "Sua conta, lembretes e planos ficam no botão com suas iniciais, em cima à direita.", "No celular, o menu abre no botão Menu."] },
    { id: "busca", titulo: "Caçador · Encontrar Licitações", telas: ["#oportunidades"], print: "p04-busca",
      passos: ["Menu → Encontrar Licitações.", "Digite o produto ou serviço e escolha os estados.", "Clique em Buscar. Em cada cartão: Resumir edital, favoritar ou mandar para o Funil."] },
    { id: "resumo", titulo: "Leitor · Resumo do Edital e Pergunte ao Edital", telas: ["#oportunidades", "#boletim", "#kanban"], print: "r02-gaveta-resumo",
      passos: ["No cartão, clique em Resumir edital: abre a gaveta do lado direito.", "Clique em Pergunte ao Edital e escreva sua dúvida. A resposta vem só do edital, com o trecho e a página.", "Se a resposta não estiver no edital, aparece \"Não encontrei no edital\". Confira sempre os documentos oficiais."] },
    { id: "boletim", titulo: "Caçador · Boletim", telas: ["#boletim"], print: "p02-boletim",
      passos: ["Menu → Boletim: as licitações novas do seu filtro, todo dia.", "Em Configurar, escolha estados e palavras.", "Quando chegam licitações novas, você recebe um aviso por e-mail com o botão Acessar o boletim, que abre esta mesma lista."] },
    { id: "calendario", titulo: "Calendário", telas: ["#calendario"], print: "p03-calendario",
      passos: ["Menu → Boletim: o calendário fica dentro da tela do Boletim.", "Clique num dia para ver as licitações daquele dia."] },
    { id: "funil", titulo: "Funil", telas: ["#kanban"], print: "p05-funil",
      passos: ["Menu → Funil.", "Arraste o cartão entre as colunas (Tenho interesse, Participando, Ganhei...).", "No cartão, Abrir no sistema leva o processo para o CRM."] },
    { id: "precos", titulo: "Cotação · Pesquisa de Preços", telas: ["#precos"], print: "p06-precos",
      passos: ["Menu → Pesquisa de Preços.", "Digite o produto (ex.: notebook) e clique em Buscar. O sistema escolhe o produto do catálogo mais comprado; troque nos botões se quiser outro.", "Veja as marcas e modelos que ganharam, quem venceu, o órgão, a data, a quantidade e o preço pago. Clique numa marca para ver só as compras dela.", "Clique no nome de uma empresa vencedora para ver todas as vitórias dela (órgãos, valores, datas e links) e abrir o raio-X em Analisar concorrente. Clique num órgão para ver só as compras dele.", "Cada compra mostra o nº do item: em Ver compra, procure esse item na página do Compras.gov."] },
    { id: "inteligencia", titulo: "Cotação · Inteligência de Mercado e fornecedor com IA", telas: ["#diagnostico"], print: "p07-inteligencia",
      passos: ["Menu → Inteligência de Mercado → Pesquisa de mercado: escreva o produto ou serviço (ex.: papel A4), escolha estado e período se quiser e clique em Pesquisar.", "Veja as 7 abas, cada uma com a quantidade no nome: Correspondências (cada compra, com preço, marca, vencedor e link), Catálogo (códigos CATMAT/CATSER e preço por unidade), Estados, Órgãos (quem compra), Empresas (quem ganha, com Analisar empresa), Marcas (marca vencedora, quantas vezes, preço médio e órgãos que aceitaram) e Contratação futura (o que os órgãos planejam comprar no PCA).", "Clique numa marca, num código do catálogo ou num estado do mapa para ver só as compras dele. A chave Tabela / Gráfico mostra barras; o botão G busca a marca ou a empresa no Google. Trazer mais 200 compras lê mais da Pesquisa de Preços (até 1.000). Baixar planilha (CSV) leva a aba aberta para o Excel.", "Em Empresas, Encontrar fornecedor com IA traz 3 empresas por vez. A IA pode errar: confira antes de negociar.", "A aba Baixa concorrência usa o mesmo produto pesquisado. A aba Licitação anterior tem a própria busca, por órgão e produto."] },
    { id: "licitacao-anterior", titulo: "Cotação · Licitação anterior", telas: ["#licitacao-anterior", "#diagnostico"], print: "p08-licitacao-anterior", hc: true,
      passos: ["Menu → Inteligência de Mercado → aba Licitação anterior (ela fica dentro da Inteligência de Mercado, não no menu lateral).","Digite parte do nome do órgão, o código UASG ou o CNPJ: as unidades aparecem sozinhas. Não sabe o nome? Abra \"Não sabe o nome nem o código?\", escolha estado, cidade, esfera e tipo de órgão, clique em Listar órgãos e depois em Usar UASG.", "Informe o produto (palavras do edital ou código CATMAT) e clique em Consultar licitações anteriores.", "Mostra quem ganhou, preços, marcas e quem foi desclassificado, com o link de cada fonte."] },
    { id: "prospeccao", titulo: "Caçador · Prospecção (antes do edital)", telas: ["prospeccao.html"], print: "p13-prospeccao",
      passos: ["Menu → Prospecção: compras antes do edital sair.", "Abas: planos de contratação (PCA), IRP abertas, atas para adesão e contratos vencendo."] },
    { id: "concorrente", titulo: "Analisar concorrente", telas: ["#empresa"], print: "p09-concorrente",
      passos: ["Menu → Analisar concorrente.", "Digite o CNPJ ou parte do nome e clique em Analisar empresa. Pelo nome, escolha a empresa na lista.", "Aparecem, nesta ordem: dados da empresa, alertas, desempenho em licitações, contratos com o governo, quanto já recebeu do governo federal e onde atua."] },
    { id: "juridico", titulo: "Jurídico & Dúvidas", telas: ["#juridico"], print: "p10-juridico", hc: true,
      passos: ["Menu → Jurídico & Dúvidas: artigos e formulário para mandar dúvida à equipe."] },
    { id: "hoje", titulo: "Chefe · Hoje (CRM)", telas: ["/sistema", "sistema.html"], print: "c01-hoje",
      passos: ["A tela Hoje mostra o que vence e os alertas.", "No topo, escolha a empresa e o processo.", "O processo aberto é uma página só: empresa, checklist do edital, itens e preços, robô de lances e documentos."] },
    { id: "processos", titulo: "Processos", telas: ["processos.html"], print: "c13-processos",
      passos: ["Menu → Processos: lista de processos, contratos e empenhos.", "Use + Processo para cadastrar um novo."] },
    { id: "empresas", titulo: "Habilitação · Minhas empresas e documentos", telas: ["operacao.html"], print: "c15-perfil-empresa",
      passos: ["Cadastre a empresa e os documentos com a validade.", "Verde, amarelo e vermelho mostram o que está válido, vencendo ou vencido.", "Baixar PDF único junta os documentos marcados."] },
    { id: "certidoes", titulo: "Habilitação · Certidões e documentos vencendo", telas: ["#certidoes"], print: "c15-perfil-empresa", hc: true,
      passos: ["Em Minhas empresas, cada documento mostra a validade: verde vale, amarelo vence logo, vermelho venceu.", "Certidão vencida? Peça a nova no site do órgão emissor e anexe aqui com a nova validade.", "Sem certidão válida a empresa pode ser inabilitada na hora de habilitar."] },
    { id: "lance", titulo: "Vigia do pregão · Lance e acompanhamento", telas: ["#lance"], print: "e01-pagina-extensao",
      passos: ["Com a extensão instalada, abra o pregão no Compras.gov.", "A extensão vigia o chat e avisa quando o pregoeiro escrever.", "Em Lance com 1 clique, a extensão sugere o próximo lance a partir do valor mínimo que você cadastrou e só envia quando você clica.", "Confira o valor mínimo antes de qualquer lance: a decisão final é sempre sua."] },
    { id: "extensao", titulo: "Extensão do navegador", telas: ["extensao.html"], print: "e01-pagina-extensao",
      passos: ["Instale a extensão no Chrome ou Edge pela página Extensão.", "Ela lê pregões, ajuda a preencher a proposta no Compras.gov e vigia o chat."] },
    { id: "bdi", titulo: "Calculadora de BDI", telas: ["bdi.html"], print: "p14-bdi",
      passos: ["Preencha os percentuais e veja o BDI da obra."] },
    { id: "sinapi", titulo: "Preços SINAPI", telas: ["sinapi.html"], print: "p15-sinapi",
      passos: ["Escolha o estado e a tabela e digite o serviço.", "Usar este preço leva o valor para o item do processo."] },
    { id: "contador", titulo: "Contador · Preço com impostos", telas: ["sistema.html", "/sistema"], print: "c16-contador",
      passos: ["Abra o processo, vá em Itens do processo e abra o item: o Contador fica embaixo dele.", "O regime vem pelo CNPJ da empresa: confira, clique em Confirmar regime e informe o ICMS da sua UF.", "Preencha a planilha de custos (frete, embalagem, garantia...) e clique em Calcular: aparecem o preço mínimo, o preço com a margem e se vale a pena.", "Salvar no item para a proposta guarda o resumo. É uma estimativa para formar preço: confirme com o seu contador."] },
    { id: "orcamento-obra", titulo: "Orçamentista · Orçamento de obra", telas: ["orcamento-obra.html"], print: "p16-orcamento-obra",
      passos: ["Em Preços SINAPI, clique em Montar o orçamento inteiro a partir da planilha do edital.", "Envie a planilha orçamentária do edital (.xlsx) e clique em Ler a planilha; confira o que o Leitor entendeu.", "Monte o orçamento: a tela mostra a data-base de cada tabela usada. Veja os Alertas do Auditor antes de baixar as planilhas.", "Revisão e assinatura de engenheiro ou arquiteto responsável são obrigatórias."] },
    // Sem tela própria (telas vazia): a Plena está em todas, então o tutorial fica no fim da lista em qualquer tela.
    { id: "plena", titulo: "Plena · a IA do LicitaPlena", telas: [], print: "r02-gaveta-resumo",
      passos: ["Clique em Plena no canto de baixo à direita para tirar dúvidas de licitação, ver o que vence hoje, seus processos, tarefas e certidões, ou perguntar onde fica algo no sistema.", "Para ler um edital, clique em Plena no cartão da licitação (Boletim, Encontrar licitações, Funil ou dossiê do processo): aparece o resumo curto e as perguntas prontas, como Prazo de impugnação, Habilitação técnica e Entrega.", "A resposta do edital vem com o trecho literal, o arquivo, a página e o link do documento oficial. Ver resumo completo abre as 19 seções.", "Salvar pergunta guarda a pergunta do campo para usar em qualquer edital. A conversa continua quando você troca de tela.", "A Plena é uma IA e pode errar: confira sempre o edital. Se ela não souber, use Enviar dúvida à equipe."] },
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

  // Chamada discreta "Precisa de ajuda? Fale com a HC Licitações": só aparece se houver WhatsApp ou site configurado.
  function chamadaHC() {
    const c = contatosHC();
    const destino = c.whatsapp || c.site;
    if (!destino) return null;
    return criar("p", { className: "lp-dica lp-chamada-hc" }, ["Precisa de ajuda? ", criar("a", { href: destino, target: "_blank", rel: "noopener", textContent: "Fale com a HC Licitações" }), " ou veja ", criar("a", { href: "hc.html", textContent: "assessoria e cursos" }), "."]);
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
            ? (videoDoTutorial(t).startsWith("https://")
              ? criar("iframe", { src: videoDoTutorial(t), loading: "lazy", allowFullscreen: true, className: "lp-tutorial-video", title: `Vídeo: ${t.titulo}`, style: "width:100%;aspect-ratio:16/9;border:0" })
              : criar("video", { src: videoDoTutorial(t), controls: true, preload: "none", className: "lp-tutorial-video", title: `Vídeo: ${t.titulo}` }))
            : null,
          t.hc ? chamadaHC() : null,
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
    // Sem número configurado não mostra botão desativado "em breve" (parecia quebrado): fica só "Mandar dúvida".
    const botaoZap = zap ? criar("a", { className: "lp-botao lp-primario", href: zap, target: "_blank", rel: "noopener", textContent: "Falar no WhatsApp" }) : null;
    const duvida = criar("a", { className: "lp-botao", href: "painel.html#juridico", textContent: "Mandar dúvida à equipe" });
    duvida.addEventListener("click", (e) => {
      const nav = document.querySelector('nav button[data-alvo="juridico"]');
      if (nav) { e.preventDefault(); fundo.hidden = true; nav.click(); }
    });
    const corpo = criar("div", { className: "lp-gaveta-corpo" }, [
      criar("div", { className: "lp-acoes-ajuda" }, [botaoZap, duvida].filter(Boolean)),
      criar("p", { style: "margin:0 0 16px" }, [criar("a", { href: "ajuda.html", target: "_blank", rel: "noopener", textContent: "Abrir a Central de Ajuda completa" }), " · ", criar("a", { href: "hc.html", textContent: "Assessoria e cursos (HC Licitações)" })]),
      criar("h3", { textContent: "Tutoriais por tela", style: "margin:0 0 8px;font:600 16px/24px var(--font-sans)" }),
      criar("p", { className: "lp-dica", textContent: "Os da tela onde você está aparecem primeiro.", style: "margin-bottom:12px" }),
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

  // Item "Consultoria" do menu lateral (a[data-hc-site]): abre direto o site da HC quando configurado; vazio = hc.html.
  function ligarConsultoria() {
    const site = contatosHC().site;
    if (site) document.querySelectorAll("a[data-hc-site]").forEach((a) => { a.href = site; });
  }

  function instalarBotao() {
    ligarConsultoria();
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

  window.LicitaPlenaAjuda = { abrir: abrirAjuda, listaTutoriais, ordenarPorTela, TUTORIAIS, VIDEOS, videoDoTutorial, linkWhatsApp, contatosHC, chamadaHC, ligarConsultoria };
  if (typeof document !== "undefined" && document.body) instalarBotao();
  else if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", instalarBotao);
  if (typeof module !== "undefined" && module.exports) module.exports = window.LicitaPlenaAjuda;
})(typeof window !== "undefined" ? window : globalThis);
