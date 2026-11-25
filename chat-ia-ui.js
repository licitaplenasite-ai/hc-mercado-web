/* global document, window, localStorage, sessionStorage, crypto, fetch, AbortController, setTimeout, clearTimeout, module, SUPABASE_URL, SUPABASE_ANON_KEY -- script de navegador (funções puras testadas no Node) */
// Plena, a IA do LicitaPlena (25/11, nome dado pelo dono; antes "IA · BETA"). Botão "Plena" no canto de baixo à direita
// de todas as telas logadas e botão "Plena" em cada licitação (Boletim, Encontrar licitações, Funil, dossiê do processo).
// - Conversa geral: /api/chat-ia (lei, tutoriais e dados da conta lidos com o token do usuário), com a tela atual.
// - No contexto de um edital (LicitaPlenaChatIa.abrirEdital(registro)): cartão curto de 10 campos (dossiê ou dados já
//   coletados), "Ver resumo completo" (o resumo de 19 seções existente), chips de perguntas e "Salvar pergunta". As
//   perguntas vão a /api/ia-edital modo "pergunta" (trechos literais) e a citação (arquivo, página, link oficial) é a
//   que o servidor monta. Sem dossiê: entra na fila do robô e mostra os arquivos do PNCP com a situação real de cada um.
// - Memória: a conversa fica no sessionStorage do usuário; na casca (app.html) as telas são iframes da mesma origem e
//   da mesma aba, então a conversa continua ao trocar de tela.
// - Só lê e responde: nenhuma ação grava nada no lugar da pessoa (fase 3). Texto da IA entra sempre como textContent.
// Incluir com <script src="chat-ia-ui.js" defer></script> depois do ajuda-ui.js.
(function (global) {
  "use strict";

  const SUGESTOES_GERAIS = ["O que vence hoje?", "Qual o prazo para apresentar recurso?", "Onde fica a Pesquisa de Preços?"];
  const SUGESTOES_EDITAL = [
    ["Prazo de impugnação", "Qual o prazo para impugnar o edital e pedir esclarecimentos?"],
    ["Habilitação técnica", "Quais atestados e documentos de qualificação técnica são exigidos?"],
    ["Entrega", "Qual o prazo, o local e as condições de entrega ou execução?"],
    ["Penalidades", "Quais são as multas e penalidades previstas?"],
    ["Disputa de preço", "Como é a disputa: modo de disputa, intervalo entre lances e critério de julgamento?"],
    ["Garantia", "O edital exige garantia de proposta ou contratual? De quanto?"],
    ["Pagamento", "Qual o prazo e as condições de pagamento?"],
    ["Amostra", "O edital exige amostra, catálogo ou prova de conceito?"],
  ];
  // Fixas do rodapé enquanto a pessoa não salvou nenhuma (as salvas tomam o lugar delas).
  const FIXAS_PADRAO = ["Objeto", "Datas e prazos", "Documentos de habilitação", "Validade da proposta", "Local de entrega"];
  const MAX_MSGS = 40;
  const TEMPO_CHAT_MS = 30000;
  const TEMPO_EDITAL_MS = 55000; // a cadeia de provedores do ia-edital tem orçamento de 48 s
  const ESPERA_DOSSIE_MS = 15000;
  const MAX_ESPERAS_DOSSIE = 40; // ~10 min; depois disso a pessoa pode tentar de novo

  const texto = (v, max = 300) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim().slice(0, max));
  const vazio = (v) => !texto(v) || /^n[aã]o informad[oa]\.?$/i.test(texto(v));

  // Registro de qualquer tela (cartão do Boletim/Encontrar, cartão do Funil, processo do CRM) -> edital da Plena.
  function editalDoRegistro(r, extra = {}) {
    if (!r || typeof r !== "object") return null;
    // "030/2026" já traz o ano (Licitações-e); só "30" ganha o "/2026".
    const numero = r.numeroCompra && r.anoCompra ? (String(r.numeroCompra).includes("/") ? texto(r.numeroCompra, 60) : `${r.numeroCompra}/${r.anoCompra}`) : texto(r.numero, 60);
    const controle = [r.numeroControlePNCP, r.origem_externa_id, extra.numeroControlePNCP].find((v) => typeof v === "string" && /^\d{14}-\d+-\d+\/\d{4}$/.test(v)) || null;
    const srp = r.srp === true ? "Sim" : r.srp === false ? "Não" : "";
    const valor = Number(r.valorTotalEstimado ?? r.valor_estimado); // numeric do Supabase pode chegar como texto
    return {
      numeroControlePNCP: controle,
      numero,
      objeto: texto(r.objeto, 600),
      orgao: texto(r.orgao || r.orgaoNome, 200),
      uf: texto(r.uf, 2).toUpperCase(),
      municipio: texto(r.municipio, 80),
      modalidade: texto(r.modalidadeNome || r.modalidade, 80),
      srp,
      encerramento: texto(r.encerramento || r.dataEncerramentoProposta || r.data_sessao, 40),
      valor: Number.isFinite(valor) && valor > 0 ? valor : null,
      portal: texto(extra.portal || r.sistema || r.portal, 80),
      situacao: texto(r.situacaoCompraNome || r.situacao, 60),
      link: /^https:\/\//i.test(String(r.link || r.url_origem || "")) ? String(r.link || r.url_origem) : "",
    };
  }

  const moeda = (n) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "");
  function dataHora(v) {
    // Sem fuso ("2026-12-03T09:45:00", como o PNCP manda) já é hora de Brasília: só reformata, não converte.
    const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(v || ""));
    if (local) return `${local[3]}/${local[2]}/${local[1]} ${local[4]}:${local[5]}`;
    const d = new Date(v);
    if (!v || Number.isNaN(d.getTime())) return texto(v, 40);
    return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  // Situação: a do PNCP quando veio; senão só o que dá para afirmar pela data de fim das propostas.
  function situacaoDe(edital, agora) {
    if (edital.situacao) return edital.situacao;
    const e = String(edital.encerramento || "");
    const fim = Date.parse(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(e) ? `${e}-03:00` : e); // sem fuso = Brasília
    if (Number.isNaN(fim)) return "";
    return fim < agora ? "Prazo de propostas encerrado" : "Recebendo propostas";
  }

  // Cartão curto (como a Aimê): 10 campos. O dossiê (estrutura do resumo) tem preferência; o que faltar vem dos dados
  // já coletados do cartão. Campo sem fonte mostra "Não informado" (nunca um valor deduzido).
  function montarCartao(estrutura, edital, agora = Date.now()) {
    const e = estrutura && typeof estrutura === "object" ? estrutura : {};
    const id = e.identificacao || {}, det = e.detalhes || {}, prazos = e.prazos || {}, sessao = e.sessaoPublica || {};
    const ed = edital || {};
    const primeiro = (...vs) => vs.map((v) => texto(v, 400)).find((v) => !vazio(v)) || "";
    const regTexto = [id.contratacao, id.regulamentacao, prazos.tipoFornecimento].map((v) => texto(v, 400)).join(" ");
    const srp = ed.srp || (/registro de pre[çc]os?/i.test(regTexto) ? "Sim" : "");
    const local = [ed.municipio, ed.uf].filter(Boolean).join("/");
    const prazoDossie = primeiro(prazos.limiteEnvioPropostas, [sessao.data, sessao.horario].filter((v) => !vazio(v)).join(" "));
    const legivel = (v) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? dataHora(v) : v); // data ISO da ficha básica
    // Ficha básica do dossiê às vezes guarda o link do portal: na tela vale o nome (do cartão) ou o domínio.
    const portalDossie = primeiro(id.portalRealizacao);
    const portal = /^https?:\/\//i.test(portalDossie) ? (ed.portal || portalDossie.replace(/^https?:\/\/([^/]+).*$/i, "$1")) : primeiro(portalDossie, ed.portal);
    const campos = [
      ["Órgão", [primeiro(e.orgao?.nome, ed.orgao), local].filter(Boolean).join(" · ")],
      ["Número", primeiro(id.numero, ed.numero).replace(/(\/\d{4})\1\b/, "$1")], // "030/2026/2026" da ficha básica
      ["Modalidade", primeiro(id.modalidade, ed.modalidade)],
      ["Critério de julgamento", primeiro(det.criterioJulgamento)],
      ["Registro de preço", srp],
      ["Prazo da proposta", legivel(prazoDossie) || (ed.encerramento ? dataHora(ed.encerramento) : "")],
      ["Valor estimado", primeiro(det.valorEstimado, moeda(ed.valor))],
      ["Portal", portal],
      ["Objeto", primeiro(id.objeto, ed.objeto)],
      ["Situação", situacaoDe(ed, agora)],
    ];
    return campos.map(([rotulo, valor]) => ({ rotulo, valor: texto(valor, 400) || "Não informado" }));
  }

  // Chips do edital: 8 prontas + as salvas da pessoa (ou as fixas padrão enquanto ela não salvou nenhuma).
  function chipsDoEdital(salvas) {
    const proprias = (Array.isArray(salvas) ? salvas : []).filter((p) => p && typeof p.texto === "string" && p.texto.trim())
      .map((p) => ({ id: p.id || null, rotulo: p.texto.trim(), pergunta: p.texto.trim(), salva: true }));
    return {
      sugeridas: SUGESTOES_EDITAL.map(([rotulo, pergunta]) => ({ rotulo, pergunta })),
      fixas: proprias.length ? proprias : FIXAS_PADRAO.map((t) => ({ id: null, rotulo: t, pergunta: `${t}: o que diz o edital?`, salva: false })),
    };
  }

  // Citação mostrada na tela: rótulo e link vêm do servidor; aqui só confere que o link é oficial (gov.br).
  const linkOficial = (u) => typeof u === "string" && /^https:\/\/(www\.)?([a-z0-9-]+\.)*gov\.br\//i.test(u);
  function citacao(ev) {
    if (!ev || typeof ev.trecho !== "string" || !ev.trecho.trim()) return null;
    const rotulo = [texto(ev.documento, 160) || "Documento oficial", ev.pagina ? `página ${texto(ev.pagina, 10)}` : "", ev.clausula ? `cláusula ${texto(ev.clausula, 20)}` : ""].filter(Boolean).join(" · ");
    return { trecho: ev.trecho.trim().slice(0, 3500), rotulo, url: linkOficial(ev.url) ? ev.url : null };
  }

  // Erro de rede/servidor -> frase para leigo (nunca código ou nome de variável).
  function mensagemDeErro(status, erro, emEdital) {
    if (status === "tempo") return "A Plena demorou demais para responder. Tente de novo em instantes ou faça uma pergunta mais curta.";
    if (status === "cancelado") return "Pergunta cancelada.";
    if (status === "rede") return "Sem conexão com a Plena agora. Confira a internet e tente de novo.";
    if (status === 401) return "Sua sessão expirou. Entre de novo para usar a Plena.";
    if (status === 403) return "A Plena não está incluída no seu plano atual.";
    if (status === 429) return texto(erro, 300) || "Você chegou ao limite de perguntas de hoje. Amanhã libera de novo.";
    if (status === 409 && emEdital) return "Os documentos deste edital ainda estão sendo preparados. Aguarde a leitura terminar e pergunte de novo.";
    if (status >= 500 || !status) return "A Plena está indisponível agora. Tente de novo em alguns minutos.";
    return texto(erro, 300) || "Não consegui responder agora. Tente de novo.";
  }

  // Tela atual (dentro da casca é a do iframe): só rótulos, para a Plena entender "aqui" e "esta tela".
  function contextoTela(loc, titulo) {
    const caminho = String(loc?.pathname || "").replace(/^\/+/, "").replace(/\.html$/i, "") || "painel";
    return { tela: caminho.slice(0, 40), titulo: texto(String(titulo || "").replace(/\s*[—-]\s*LicitaPlena.*$/i, ""), 120), secao: texto(String(loc?.hash || "").replace(/^#/, ""), 60) };
  }

  // Situação de cada arquivo do PNCP: só o que a leitura do robô informou (coberturaLeitura), nada deduzido.
  function situacaoArquivos(arquivos, cobertura, pronto) {
    const lidos = (cobertura?.documentosLidos || []).map(String), naoLidos = (cobertura?.documentosNaoLidos || []).map(String);
    return (Array.isArray(arquivos) ? arquivos : []).map((a) => {
      const marca = `(#${a.sequencialDocumento})`;
      const lido = lidos.some((l) => l.includes(marca)), falha = naoLidos.find((l) => l.includes(marca));
      const situacao = !pronto ? "Na fila de leitura" : lido ? "Lido" : falha ? `Não lido: ${texto(falha.split(":").slice(1).join(":"), 80) || "ver no PNCP"}` : "Fora da leitura";
      return { titulo: texto(a.titulo, 120) || "Documento", situacao, lido };
    });
  }

  // Marca no sessionStorage de quem está consultando a leitura de um edital: na casca cada tela é um iframe com a
  // própria Plena, e só uma deve consultar o servidor. Marca de outro dono vale por `janela` ms; depois, quem chegar assume.
  function marcaLivre(marca, dono, agora, janela) {
    return !marca || marca.dono === dono || !(agora - marca.em < janela);
  }

  const Regras = { SUGESTOES_EDITAL, marcaLivre, FIXAS_PADRAO, editalDoRegistro, montarCartao, chipsDoEdital, citacao, mensagemDeErro, contextoTela, situacaoArquivos };
  if (typeof module !== "undefined" && module.exports) module.exports = Regras;
  if (typeof document === "undefined" || global.LicitaPlenaChatIa || !document.body || document.body.dataset.semChatIa !== undefined) return;

  // ---------------------------------------------------------------- navegador
  const CHAVE_SALVAR = "licitaplena_chat_ia_salvar";
  const CHAVE_EMPRESA = "licitaplena_empresa_operacional_id"; // mesma empresa ativa do painel, Processos e Minhas empresas
  const estado = { conversaId: crypto.randomUUID ? crypto.randomUUID() : null, historico: [], msgs: [], edital: null, alvo: "edital", resumo: null, hashFonte: null, pronto: false };
  let fundo, lista, campo, enviar, cancelar, salvar, zonaChips, barraEdital, pendente = null, salvas = [], usuario = null, esperaDossie = null, versaoVista = 0;
  const INSTANCIA = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  // Só consulta a leitura com a gaveta aberta, a aba visível e esta tela à mostra na casca (iframe escondido = pausa).
  function podeConsultar(controle) {
    if (!fundo || fundo.hidden || document.hidden) return false;
    try { if (window.frameElement && !window.frameElement.getClientRects().length) return false; } catch { /* fora da casca */ }
    const k = `licitaplena_plena_consulta:${controle}`;
    try {
      if (!marcaLivre(JSON.parse(sessionStorage.getItem(k) || "null"), INSTANCIA, Date.now(), ESPERA_DOSSIE_MS * 2)) return false;
      sessionStorage.setItem(k, JSON.stringify({ dono: INSTANCIA, em: Date.now() }));
    } catch { /* sem sessionStorage: consulta mesmo assim */ }
    return true;
  }
  // Retoma a leitura pendente ao abrir a gaveta ou voltar à aba (recomeça a contagem de tentativas).
  function retomarLeitura() {
    if (!estado.edital?.numeroControlePNCP || estado.pronto) return;
    clearTimeout(esperaDossie);
    carregarDossie(estado.edital);
  }

  const criar = (tag, props = {}, filhos = []) => {
    const no = Object.assign(document.createElement(tag), props);
    for (const f of [].concat(filhos)) if (f != null) no.append(f);
    return no;
  };
  const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem localStorage: só não lembra */ } };

  // Ícone próprio da Plena: brilho de 4 pontas em ciano sobre o degradê da marca (SVG, sem arquivo extra).
  function icone(classe) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", classe);
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z");
    const q = document.createElementNS(ns, "path");
    q.setAttribute("d", "M18.5 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3Z");
    q.setAttribute("opacity", ".75");
    svg.append(p, q);
    return svg;
  }

  // Painel expõe o cliente dele; nas outras páginas um cliente próprio lê a mesma sessão salva no navegador.
  let sbProprio = null;
  async function sessao() {
    if (!window.__sbClient && !sbProprio && window.supabase && typeof SUPABASE_URL !== "undefined") sbProprio = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const r = await (window.__sbClient || sbProprio)?.auth.getSession();
    return r?.data?.session || null;
  }

  // POST com tempo-limite real e cancelamento pela tela. Erro sempre vira {status, erro} amigável.
  async function postar(rota, corpo, { tempo = TEMPO_CHAT_MS, emEdital = false, cancelavel = true } = {}) {
    const s = await sessao();
    if (!s?.access_token) throw Object.assign(new Error(mensagemDeErro(401)), { status: 401 });
    const ctrl = new AbortController();
    let motivo = null;
    const relogio = setTimeout(() => { motivo = "tempo"; ctrl.abort(); }, tempo);
    if (cancelavel) pendente = () => { motivo = "cancelado"; ctrl.abort(); };
    try {
      const r = await fetch(rota, { method: "POST", signal: ctrl.signal, headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 202) throw Object.assign(new Error(mensagemDeErro(r.status, d.erro, emEdital)), { status: r.status });
      return d;
    } catch (e) {
      if (e.status) throw e;
      throw Object.assign(new Error(mensagemDeErro(motivo || "rede", null, emEdital)), { status: motivo || "rede" });
    } finally {
      clearTimeout(relogio);
      if (cancelavel) pendente = null;
    }
  }

  // ---- memória da conversa (sessionStorage por usuário; vale para todas as telas da mesma aba)
  const chaveConversa = () => (usuario ? `licitaplena_plena_conversa:${usuario}` : null);
  function persistir() {
    const k = chaveConversa();
    if (!k) return;
    versaoVista = Date.now();
    const { conversaId, historico, msgs, edital, alvo, resumo, hashFonte, pronto } = estado;
    try { sessionStorage.setItem(k, JSON.stringify({ versao: versaoVista, conversaId, historico: historico.slice(-6), msgs: msgs.slice(-MAX_MSGS), edital, alvo, resumo, hashFonte, pronto })); } catch { /* cheio ou bloqueado: só não lembra */ }
  }
  function restaurar() {
    const k = chaveConversa();
    let salvo = null;
    try { salvo = k && JSON.parse(sessionStorage.getItem(k) || "null"); } catch { salvo = null; }
    if (!salvo || salvo.versao <= versaoVista) return false;
    versaoVista = salvo.versao;
    Object.assign(estado, { conversaId: salvo.conversaId || estado.conversaId, historico: salvo.historico || [], msgs: [], edital: salvo.edital || null, alvo: salvo.alvo || "edital", resumo: salvo.resumo || null, hashFonte: salvo.hashFonte || null, pronto: salvo.pronto === true });
    lista.replaceChildren();
    for (const m of salvo.msgs || []) desenhar(m);
    estado.msgs = (salvo.msgs || []).slice();
    atualizarModo();
    return true;
  }

  // ---- mensagens (registro serializável + desenho)
  function registrar(m) {
    estado.msgs.push(m);
    if (estado.msgs.length > MAX_MSGS) estado.msgs.shift();
    persistir();
    return desenhar(m);
  }

  function desenharCitacoes(caixa, evidencias) {
    for (const c of (evidencias || []).map(citacao).filter(Boolean)) {
      const fonte = criar("p", { className: "lp-plena-fonte" }, [criar("span", { textContent: c.rotulo })]);
      if (c.url) fonte.append(" · ", criar("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", textContent: "Abrir documento" }));
      caixa.append(criar("figure", { className: "lp-plena-citacao" }, [criar("blockquote", { textContent: c.trecho }), criar("figcaption", {}, fonte)]));
    }
  }

  function desenhar(m) {
    if (m.papel === "cartao") return desenharCartao(m);
    const caixa = criar("div", { className: `lp-chat-msg lp-chat-${m.papel}` });
    if (m.texto) caixa.append(criar("p", { textContent: m.texto }));
    for (const a of m.avisos || []) caixa.append(criar("p", { className: "lp-dica", textContent: a }));
    desenharCitacoes(caixa, m.evidencias);
    if (m.fontes?.length) {
      caixa.append(criar("p", { className: "lp-chat-fontes-titulo", textContent: "Fontes:" }), criar("ul", { className: "lp-chat-fontes" }, m.fontes.map((f) => {
        const rotulo = `${f.titulo}${f.detalhe ? ` — ${f.detalhe}` : ""}`;
        return criar("li", {}, linkOficial(f.url) ? criar("a", { href: f.url, target: "_blank", rel: "noopener noreferrer", textContent: rotulo }) : rotulo);
      })));
    }
    if (m.modo === "base") caixa.append(criar("p", { className: "lp-dica", textContent: "A IA está indisponível agora: esta resposta veio dos guias e dos dados do LicitaPlena." }));
    if (m.aviso) caixa.append(criar("p", { className: "lp-dica", textContent: m.aviso }));
    if (m.naoSei) caixa.append(acoesNaoSei(m.pergunta));
    lista.append(caixa);
    caixa.scrollIntoView({ block: "end" });
    return caixa;
  }

  // "Não sei": oferece mandar a dúvida à equipe (enviar-duvida.js) e, se houver edital aberto, perguntar a ele.
  function acoesNaoSei(pergunta) {
    const linha = criar("div", { className: "lp-plena-acoes" });
    const equipe = criar("button", { type: "button", textContent: "Enviar dúvida à equipe" });
    equipe.addEventListener("click", () => formularioDuvida(linha, pergunta));
    linha.append(equipe);
    if (estado.edital?.numeroControlePNCP) {
      const edital = criar("button", { type: "button", textContent: "Perguntar ao edital" });
      edital.addEventListener("click", () => { estado.alvo = "edital"; atualizarModo(); perguntar(pergunta); });
      linha.append(edital);
    } else {
      linha.append(criar("p", { className: "lp-dica", textContent: "Para perguntar a um edital, toque em Plena no cartão da licitação." }));
    }
    return linha;
  }

  function formularioDuvida(alvo, pergunta) {
    const msg = criar("textarea", { rows: 3, maxLength: 2000, value: pergunta || "" });
    msg.setAttribute("aria-label", "Sua dúvida para a equipe");
    const ir = criar("button", { type: "submit", className: "lp-primario", textContent: "Enviar à equipe" });
    const status = criar("p", { className: "lp-dica", role: "status" });
    const form = criar("form", { className: "lp-plena-duvida" }, [criar("p", { className: "lp-dica", textContent: "A equipe responde no seu e-mail de cadastro. Não escreva CPF." }), msg, ir, status]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      ir.disabled = true;
      status.textContent = "Enviando…";
      try {
        const s = await sessao();
        const contexto = estado.edital ? `\n\n[Plena · edital ${estado.edital.numero || estado.edital.numeroControlePNCP || ""}: ${estado.edital.objeto || ""}]` : "";
        await postar("/api/enviar-duvida", { nome: s?.user?.user_metadata?.nome || s?.user?.email || "Cliente", email: s?.user?.email || "", mensagem: `${msg.value.trim()}${contexto}` }, { cancelavel: false });
        status.textContent = "Dúvida enviada. A equipe responde no seu e-mail.";
        msg.disabled = true;
      } catch (err) { status.textContent = err.message; ir.disabled = false; }
    });
    alvo.replaceWith(form);
    msg.focus();
  }

  // ---- cartão do edital
  function desenharCartao(m) {
    // div e não section: o painel esconde toda <section> que não é a tela ativa.
    const caixa = criar("div", { className: "lp-plena-cartao", role: "region" });
    caixa.setAttribute("aria-label", "Resumo curto do edital");
    caixa.append(criar("h3", {}, [icone("lp-plena-icone-mini"), "Resumo do edital"]));
    caixa.append(criar("dl", {}, m.campos.flatMap((c) => [criar("dt", { textContent: c.rotulo }), criar("dd", { textContent: c.valor, className: c.rotulo === "Objeto" ? "lp-plena-objeto" : "" })])));
    if (m.arquivos?.length) {
      caixa.append(criar("p", { className: "lp-chat-fontes-titulo", textContent: "Arquivos do edital no PNCP:" }),
        criar("ul", { className: "lp-plena-arquivos" }, m.arquivos.map((a) => criar("li", { className: a.lido ? "lido" : "" }, [criar("span", { textContent: a.titulo }), criar("small", { textContent: a.situacao })]))));
    }
    if (m.status) caixa.append(criar("p", { className: "lp-dica lp-plena-status", textContent: m.status }));
    const acoes = criar("div", { className: "lp-plena-acoes" });
    if (m.pronto || estado.resumo) {
      const completo = criar("button", { type: "button", className: "lp-primario", textContent: "Ver resumo completo" });
      completo.addEventListener("click", verResumoCompleto);
      acoes.append(completo);
    }
    if (m.link) acoes.append(criar("a", { className: "lp-botao", href: m.link, target: "_blank", rel: "noopener noreferrer", textContent: "Edital oficial" }));
    if (acoes.childNodes.length) caixa.append(acoes);
    caixa.append(criar("p", { className: "lp-dica", textContent: "Respostas geradas por IA a partir dos documentos: confira sempre o edital." }));
    lista.append(caixa);
    caixa.scrollIntoView({ block: "end" });
    return caixa;
  }

  function atualizarCartao(dados) {
    const i = estado.msgs.map((m) => m.papel).lastIndexOf("cartao");
    if (i < 0) return;
    estado.msgs[i] = { ...estado.msgs[i], ...dados };
    persistir();
    const caixas = lista.querySelectorAll(".lp-plena-cartao");
    caixas[caixas.length - 1]?.replaceWith(desenharCartao(estado.msgs[i]));
  }

  function verResumoCompleto() {
    // No painel abre o modal do Resumo do edital (19 seções, com Pergunte ao Edital); fora dele, o mesmo texto aqui.
    if (typeof global.LicitaPlenaChatIa.abrirResumo === "function" && estado.edital?.registro) {
      fundo.hidden = true;
      global.LicitaPlenaChatIa.abrirResumo(estado.edital.registro);
      return;
    }
    if (estado.resumo) registrar({ papel: "ia", texto: estado.resumo });
  }

  // ---- dossiê: lê o pronto; sem ele, entra na fila do robô e acompanha os arquivos
  const partesPncp = (c) => { const m = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(c || ""); return m ? { cnpj: m[1], sequencial: Number(m[2]), ano: m[3] } : null; };
  async function arquivosPncp(controle) {
    const p = partesPncp(controle);
    const s = await sessao();
    if (!p || !s?.access_token) return [];
    try {
      const r = await fetch(`/api/pncp-arquivos?cnpj=${p.cnpj}&ano=${p.ano}&sequencial=${p.sequencial}`, { headers: { Authorization: `Bearer ${s.access_token}` } });
      const d = await r.json();
      return Array.isArray(d.arquivos) ? d.arquivos : [];
    } catch { return []; }
  }

  async function carregarDossie(edital, tentativa = 0, arquivos = null) {
    if (estado.edital?.numeroControlePNCP !== edital.numeroControlePNCP) return; // trocou de edital
    if (!podeConsultar(edital.numeroControlePNCP)) return; // pausa; retomarLeitura() volta ao abrir ou mostrar
    let d;
    try {
      d = await postar("/api/ia-edital", { modo: "resumo", edital: { numeroControlePNCP: edital.numeroControlePNCP } }, { tempo: TEMPO_EDITAL_MS, emEdital: true, cancelavel: false });
    } catch (e) {
      atualizarCartao({ status: e.message });
      return;
    }
    if (estado.edital?.numeroControlePNCP !== edital.numeroControlePNCP) return;
    const pronto = Boolean(d.estrutura && d.fonteLida && !d.modoDegradado && !d.dossieEmPreparacao);
    const arqs = arquivos || await arquivosPncp(edital.numeroControlePNCP);
    estado.resumo = pronto ? texto(d.resposta, 60000) : null;
    estado.hashFonte = d.hashFonte || null;
    estado.pronto = pronto;
    const campos = montarCartao(d.fonteLida ? d.estrutura : null, edital);
    if (pronto) {
      atualizarCartao({ campos, pronto: true, arquivos: situacaoArquivos(arqs, d.estrutura.coberturaLeitura, true), status: d.estrutura.coberturaLeitura?.parcial ? "Leitura parcial: alguns arquivos não foram lidos. Confira-os no PNCP." : "Documentos lidos. Pergunte o que quiser sobre este edital." });
      atualizarModo();
      return;
    }
    if (tentativa === 0) postar("/api/acelerar-esteira", {}, { cancelavel: false }).catch(() => { /* sem disparo: o robô agendado lê do mesmo jeito */ });
    if (tentativa >= MAX_ESPERAS_DOSSIE) {
      atualizarCartao({ campos, arquivos: situacaoArquivos(arqs, null, false), status: "A leitura ainda não terminou. Feche e abra a Plena neste edital mais tarde; ela continua na fila." });
      return;
    }
    atualizarCartao({ campos, arquivos: situacaoArquivos(arqs, null, false), status: `Lendo os documentos do edital (${arqs.length || "nenhum"} arquivo(s) no PNCP). Leva alguns minutos; pode continuar usando o sistema.` });
    clearTimeout(esperaDossie);
    esperaDossie = setTimeout(() => carregarDossie(edital, tentativa + 1, arqs), ESPERA_DOSSIE_MS);
  }

  // ---- perguntas
  async function perguntarAoEdital(pergunta) {
    const d = await postar("/api/ia-edital", { modo: "pergunta", edital: { numeroControlePNCP: estado.edital.numeroControlePNCP }, pergunta, ...(estado.hashFonte ? { hashFonte: estado.hashFonte } : {}) }, { tempo: TEMPO_EDITAL_MS, emEdital: true });
    const evidencias = Array.isArray(d.evidencias) ? d.evidencias : [];
    const naoAchou = !evidencias.length && /^N[aã]o encontrei/i.test(String(d.resposta || "").split("\n\n").pop());
    return evidencias.length
      ? { papel: "ia", texto: "Encontrei isto no edital:", avisos: Array.isArray(d.avisos) ? d.avisos : [], evidencias }
      : { papel: "ia", texto: texto(d.resposta, 8000) || "Não encontrei no edital a resposta para esta pergunta.", naoSei: naoAchou, pergunta };
  }

  async function perguntarGeral(pergunta) {
    const contexto = { ...contextoTela(document.location, document.title) };
    if (estado.edital) contexto.edital = { numero: estado.edital.numero, objeto: estado.edital.objeto, orgao: estado.edital.orgao, uf: estado.edital.uf };
    const d = await postar("/api/chat-ia", { acao: "perguntar", pergunta, historico: estado.historico.slice(-6), empresaId: ler(CHAVE_EMPRESA) || null, salvar: salvar.checked, conversaId: estado.conversaId, contexto });
    return { papel: "ia", texto: d.resposta, fontes: d.fontes, modo: d.modo, naoSei: d.naoSei === true, pergunta };
  }

  async function perguntar(textoPergunta) {
    const pergunta = String(textoPergunta || "").trim();
    if (!pergunta || pendente || enviar.disabled) return;
    registrar({ papel: "usuario", texto: pergunta });
    campo.value = "";
    ocupado(true);
    const pensando = criar("div", { className: "lp-chat-msg lp-chat-ia lp-plena-pensando" }, [icone("lp-plena-icone-mini"), criar("p", { textContent: "A Plena está lendo…" })]);
    lista.append(pensando);
    pensando.scrollIntoView({ block: "end" });
    try {
      const noEdital = estado.alvo === "edital" && estado.edital?.numeroControlePNCP;
      const m = noEdital ? await perguntarAoEdital(pergunta) : await perguntarGeral(pergunta);
      pensando.remove();
      registrar(m);
      estado.historico.push({ papel: "usuario", texto: pergunta }, { papel: "ia", texto: String(m.texto || "").slice(0, 600) });
      persistir();
    } catch (e) {
      pensando.remove();
      registrar({ papel: "erro", texto: e.message });
    } finally {
      ocupado(false);
      campo.focus();
    }
  }

  function ocupado(sim) {
    enviar.disabled = sim;
    enviar.hidden = sim;
    cancelar.hidden = !sim;
  }

  // ---- perguntas salvas e chips
  async function carregarSalvas() {
    try { salvas = (await postar("/api/chat-ia", { acao: "perguntas" }, { cancelavel: false })).perguntas || []; } catch { salvas = []; }
    desenharChips();
  }
  async function salvarPergunta() {
    const textoSalvar = campo.value.trim() || [...estado.msgs].reverse().find((m) => m.papel === "usuario")?.texto || "";
    if (textoSalvar.length < 3) { registrar({ papel: "erro", texto: "Escreva a pergunta no campo e toque em Salvar pergunta." }); return; }
    try {
      salvas = (await postar("/api/chat-ia", { acao: "salvar_pergunta", texto: textoSalvar }, { cancelavel: false })).perguntas || salvas;
      desenharChips();
      registrar({ papel: "ia", texto: `Pergunta salva: "${textoSalvar.slice(0, 120)}". Ela aparece nos atalhos de qualquer edital.` });
    } catch (e) { registrar({ papel: "erro", texto: e.message }); }
  }
  async function apagarSalva(id) {
    try { salvas = (await postar("/api/chat-ia", { acao: "apagar_pergunta", id }, { cancelavel: false })).perguntas || []; desenharChips(); } catch (e) { registrar({ papel: "erro", texto: e.message }); }
  }

  function chip(rotulo, pergunta, extra) {
    const b = criar("button", { type: "button", className: "lp-chat-sugestao", textContent: rotulo, title: pergunta });
    b.addEventListener("click", () => perguntar(pergunta));
    return extra ? criar("span", { className: "lp-plena-chip-salva" }, [b, extra]) : b;
  }

  function desenharChips() {
    if (!zonaChips) return;
    zonaChips.replaceChildren();
    if (!(estado.edital?.numeroControlePNCP && estado.alvo === "edital")) {
      zonaChips.append(criar("div", { className: "lp-chat-sugestoes" }, SUGESTOES_GERAIS.map((s) => chip(s, s))));
      return;
    }
    const { sugeridas, fixas } = chipsDoEdital(salvas);
    const desligado = !estado.pronto;
    zonaChips.append(criar("p", { className: "lp-chat-fontes-titulo", textContent: desligado ? "Perguntas prontas (liberam quando a leitura terminar):" : "Perguntas prontas:" }),
      criar("div", { className: "lp-chat-sugestoes" }, sugeridas.map((s) => chip(s.rotulo, s.pergunta))),
      criar("p", { className: "lp-chat-fontes-titulo", textContent: salvas.length ? "Minhas perguntas:" : "Atalhos:" }),
      criar("div", { className: "lp-chat-sugestoes" }, fixas.map((f) => {
        if (!f.salva || !f.id) return chip(f.rotulo, f.pergunta);
        const x = criar("button", { type: "button", className: "lp-plena-apagar", textContent: "✕", title: "Apagar esta pergunta salva" });
        x.setAttribute("aria-label", `Apagar a pergunta salva ${f.rotulo}`);
        x.addEventListener("click", () => apagarSalva(f.id));
        return chip(f.rotulo, f.pergunta, x);
      })));
    if (desligado) zonaChips.querySelectorAll("button.lp-chat-sugestao").forEach((b) => { b.disabled = true; });
  }

  function atualizarModo() {
    const e = estado.edital;
    barraEdital.hidden = !e;
    if (e) {
      barraEdital.querySelector("[data-plena-objeto]").textContent = e.objeto || e.numero || "Licitação";
      for (const b of barraEdital.querySelectorAll("[data-alvo]")) b.setAttribute("aria-pressed", String(b.dataset.alvo === estado.alvo));
      barraEdital.querySelector('[data-alvo="edital"]').disabled = !e.numeroControlePNCP;
    }
    campo.placeholder = e && estado.alvo === "edital" && e.numeroControlePNCP ? "Pergunte sobre este edital (prazos, documentos, entrega, multas…)" : "Pergunte sobre licitação, seus processos e prazos, ou onde fica algo no LicitaPlena";
    desenharChips();
  }

  async function verHistorico() {
    try {
      const d = await postar("/api/chat-ia", { acao: "historico" }, { cancelavel: false });
      if (!d.mensagens.length) { registrar({ papel: "ia", texto: "Nenhuma conversa salva. Ligue \"Salvar histórico\" para guardar as próximas." }); return; }
      const antigas = [...d.mensagens].reverse();
      registrar({ papel: "ia", texto: `Histórico salvo (${antigas.length} pergunta(s)). Pode continuar a conversa daqui.` });
      for (const m of antigas) { registrar({ papel: "usuario", texto: m.pergunta }); registrar({ papel: "ia", texto: m.resposta, fontes: m.fontes }); }
      // Restaura o contexto: as últimas trocas do histórico viram a memória da conversa atual.
      estado.historico = antigas.slice(-3).flatMap((m) => [{ papel: "usuario", texto: m.pergunta }, { papel: "ia", texto: String(m.resposta).slice(0, 600) }]);
      const ultima = antigas[antigas.length - 1];
      if (ultima?.conversa_id) estado.conversaId = ultima.conversa_id;
      persistir();
    } catch (e) { registrar({ papel: "erro", texto: e.message }); }
  }

  async function apagarHistorico() {
    if (!window.confirm("Apagar todo o histórico salvo da Plena? Isso não pode ser desfeito.")) return;
    try { await postar("/api/chat-ia", { acao: "apagar" }, { cancelavel: false }); registrar({ papel: "ia", texto: "Histórico salvo apagado." }); } catch (e) { registrar({ papel: "erro", texto: e.message }); }
  }

  function novaConversa() {
    clearTimeout(esperaDossie);
    Object.assign(estado, { conversaId: crypto.randomUUID ? crypto.randomUUID() : null, historico: [], msgs: [], edital: null, alvo: "edital", resumo: null, hashFonte: null, pronto: false });
    lista.replaceChildren();
    boasVindas();
    atualizarModo();
  }
  const boasVindas = () => registrar({ papel: "ia", texto: "Olá, eu sou a Plena. Tiro dúvidas sobre licitação (Lei 14.133 e outras), mostro seus processos, prazos, tarefas e certidões, e digo onde fica cada coisa no LicitaPlena. Para ler um edital, toque em Plena no cartão da licitação." });

  function montar() {
    // ?v= força o CSS novo: em 25/11 o cache (4 h) mostrou o ícone da Plena gigante com o CSS antigo.
    for (const href of ["gaveta-lateral.css", "chat-ia-ui.css"]) if (!document.querySelector(`link[href^="${href}"]`)) document.head.append(criar("link", { rel: "stylesheet", href: href + "?v=20261125" }));
    const fechar = criar("button", { type: "button", className: "lp-gaveta-fechar", title: "Fechar", textContent: "✕" });
    fechar.setAttribute("aria-label", "Fechar a Plena");
    const nova = criar("button", { type: "button", className: "lp-plena-nova", textContent: "Nova conversa" });
    nova.addEventListener("click", novaConversa);
    lista = criar("div", { className: "lp-chat-lista" });
    lista.setAttribute("role", "log");
    lista.setAttribute("aria-live", "polite");
    campo = criar("textarea", { id: "lp-chat-campo", maxLength: 1000, rows: 2 });
    campo.setAttribute("aria-label", "Sua pergunta para a Plena");
    enviar = criar("button", { type: "submit", className: "lp-primario", textContent: "Enviar" });
    cancelar = criar("button", { type: "button", className: "lp-plena-cancelar", textContent: "Cancelar", hidden: true });
    cancelar.addEventListener("click", () => pendente?.());
    salvar = criar("input", { type: "checkbox", id: "lp-chat-salvar", checked: ler(CHAVE_SALVAR) === "1" });
    salvar.addEventListener("change", () => gravar(CHAVE_SALVAR, salvar.checked ? "1" : "0"));
    const form = criar("form", { className: "lp-chat-form" }, [campo, enviar, cancelar]);
    form.addEventListener("submit", (e) => { e.preventDefault(); perguntar(campo.value); });
    campo.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(campo.value); } });
    zonaChips = criar("div", { className: "lp-plena-chips" });
    const botaoSalvarPergunta = criar("button", { type: "button", textContent: "Salvar pergunta", title: "Guarda a pergunta do campo para usar em qualquer edital" });
    botaoSalvarPergunta.addEventListener("click", salvarPergunta);
    const botaoHist = criar("button", { type: "button", textContent: "Ver histórico" });
    botaoHist.addEventListener("click", verHistorico);
    const botaoApagar = criar("button", { type: "button", textContent: "Apagar histórico" });
    botaoApagar.addEventListener("click", apagarHistorico);
    const alvoBotao = (alvo, rotulo) => {
      const b = criar("button", { type: "button", textContent: rotulo });
      b.dataset.alvo = alvo;
      b.addEventListener("click", () => { estado.alvo = alvo; persistir(); atualizarModo(); });
      return b;
    };
    const sairEdital = criar("button", { type: "button", className: "lp-plena-sair", textContent: "✕", title: "Sair deste edital" });
    sairEdital.setAttribute("aria-label", "Sair do edital e voltar à conversa geral");
    sairEdital.addEventListener("click", () => { clearTimeout(esperaDossie); estado.edital = null; estado.resumo = null; estado.pronto = false; persistir(); atualizarModo(); });
    const objetoCurto = criar("span", { className: "lp-plena-objeto-curto" });
    objetoCurto.dataset.plenaObjeto = "";
    const grupoAlvo = criar("div", { className: "lp-plena-alvo", role: "group" }, [alvoBotao("edital", "Este edital"), alvoBotao("geral", "Geral")]);
    grupoAlvo.setAttribute("aria-label", "Perguntar a");
    barraEdital = criar("div", { className: "lp-plena-barra", hidden: true }, [criar("p", {}, [criar("span", { className: "lp-dica", textContent: "Falando sobre " }), objetoCurto]), grupoAlvo, sairEdital]);
    const titulo = criar("h2", { id: "lp-chat-titulo" }, [criar("span", { className: "lp-plena-avatar" }, icone("lp-plena-icone")), "Plena ", criar("span", { className: "lp-chat-beta", textContent: "Beta" })]);
    const gaveta = criar("aside", { className: "lp-gaveta lp-chat lp-plena" }, [
      criar("div", { className: "lp-gaveta-topo" }, [titulo, nova, fechar]),
      barraEdital,
      criar("p", { className: "lp-chat-aviso", textContent: "A Plena é uma IA e pode errar: ela mostra de onde tirou cada resposta; confira o edital e a lei. Não informe CPF." }),
      criar("div", { className: "lp-gaveta-corpo" }, [lista, zonaChips]),
      criar("div", { className: "lp-gaveta-rodape" }, [form,
        criar("div", { className: "lp-chat-opcoes" }, [botaoSalvarPergunta, criar("label", { className: "lp-opcao", htmlFor: "lp-chat-salvar" }, [salvar, "Salvar histórico"]), botaoHist, botaoApagar])]),
    ]);
    gaveta.setAttribute("role", "dialog");
    gaveta.setAttribute("aria-modal", "true");
    gaveta.setAttribute("aria-labelledby", "lp-chat-titulo");
    fundo = criar("div", { className: "lp-gaveta-fundo", hidden: true }, gaveta);
    document.body.append(fundo);
    fechar.addEventListener("click", () => { fundo.hidden = true; });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !fundo.hidden) retomarLeitura(); });
    fundo.addEventListener("click", (e) => { if (e.target === fundo) fundo.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !fundo.hidden) fundo.hidden = true; });
    atualizarModo();
  }

  // Abre a gaveta. A memória é por usuário: só depois de saber quem está logado dá para restaurar a conversa.
  async function abrir() {
    if (!fundo) montar();
    fundo.hidden = false;
    campo.focus();
    if (!usuario) usuario = (await sessao())?.user?.id || null;
    const restaurou = restaurar();
    if (!restaurou && !estado.msgs.length) boasVindas();
    // Leitura do edital ainda em andamento (desta tela ou de outra): continua acompanhando daqui.
    retomarLeitura();
    if (!salvas.length) carregarSalvas();
  }

  // Botão "Plena" de uma licitação: abre no contexto daquele edital.
  async function abrirEdital(registro, extra = {}) {
    const edital = editalDoRegistro(registro, extra);
    if (!edital) return;
    await abrir();
    clearTimeout(esperaDossie);
    estado.edital = { ...edital, registro: extra.manterRegistro === false ? null : registro };
    estado.alvo = edital.numeroControlePNCP ? "edital" : "geral";
    estado.resumo = null;
    estado.hashFonte = null;
    estado.pronto = false;
    atualizarModo();
    registrar({ papel: "cartao", campos: montarCartao(null, edital), link: edital.link, status: edital.numeroControlePNCP ? "Buscando a leitura dos documentos…" : "Esta licitação não está no PNCP: a Plena não consegue ler os documentos dela. Abra o edital oficial; aqui você pode tirar dúvidas gerais." });
    if (edital.numeroControlePNCP) carregarDossie(estado.edital);
  }

  function instalarBotao() {
    if (!document.querySelector('link[href^="chat-ia-ui.css"]')) document.head.append(criar("link", { rel: "stylesheet", href: "chat-ia-ui.css?v=20261125" }));
    const botao = criar("button", { type: "button", id: "chat-ia-btn", className: "lp-chat-flutuante", title: "Plena, a IA do LicitaPlena (beta)" }, [criar("span", { className: "lp-plena-avatar" }, icone("lp-plena-icone")), "Plena"]);
    botao.setAttribute("aria-label", "Abrir a Plena, a IA do LicitaPlena");
    // Fora do plano (Essencial) ou teste encerrado: plano-trava.js esconde o botão, para não levar a uma recusa.
    botao.setAttribute("data-recurso-esconder", "chat_ia");
    botao.addEventListener("click", () => { abrir(); });
    document.body.classList.add("lp-com-chat-ia");
    document.body.append(botao);
  }

  // abrirResumo: o painel registra o modal do Resumo do edital para o "Ver resumo completo".
  global.LicitaPlenaChatIa = { abrir, abrirEdital, abrirResumo: null, ...Regras };
  instalarBotao();
})(typeof window !== "undefined" ? window : globalThis);
