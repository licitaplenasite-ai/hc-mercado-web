/* global document, window, location, module, URLSearchParams, SUPABASE_URL, SUPABASE_ANON_KEY -- navegador (module só no Node, nos testes) */
// Resumo do processo em 1 página para imprimir (resumo-processo.html?empresa=<uuid>&processo=<uuid>), o "canvas do
// licitante": órgão, objeto, datas, preço (estimado, mínimo e proposta), prazos, itens, documentos escolhidos e
// anotações. Lê com a sessão do usuário (RLS: só processo de empresa que ele acessa). Tudo por textContent.
// Aguarda aprovação do dono (visual).
(function (global) {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX_ITENS = 25; // cabe numa folha A4 com o resto; o que passar vira "e mais N itens"
  const STATUS = { triagem: "Triagem", preparacao: "Preparação", proposta_enviada: "Proposta enviada", sessao: "Sessão", habilitacao: "Habilitação",
    recurso: "Recurso", homologado: "Homologado", contratado: "Contratado", perdido: "Perdido", arquivado: "Arquivado" };

  const moeda = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  const dataBr = (v, comHora) => {
    if (!v) return "—";
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00-03:00` : v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("pt-BR", comHora ? { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" } : { dateStyle: "short", timeZone: "America/Sao_Paulo" });
  };
  // Descrição de item de edital chega a 800 caracteres: corta para caber na folha (o texto inteiro está no sistema).
  const curto = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  const cnpjBr = (c) => (/^\d{14}$/.test(c || "") ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c || "—");

  // dados: { processo, empresa, prazos, itens, documentos } -> blocos prontos para desenhar (testado).
  function montarResumo({ processo: p, empresa: e, prazos = [], itens = [], documentos = [] }) {
    const ficha = [
      ["Empresa", `${e?.razao_social || "—"} · CNPJ ${cnpjBr(e?.cnpj)}`],
      ["Órgão", p.orgao || "—"], ["Número", p.numero || "—"], ["Modalidade", p.modalidade || "—"],
      ["Situação", STATUS[p.status] || p.status || "—"], ["Responsável", p.responsavel || "—"],
      ["Publicação", dataBr(p.data_publicacao)], ["Sessão", dataBr(p.data_sessao, true)],
    ];
    const preco = [["Valor estimado", moeda(p.valor_estimado)], ["Custo direto", moeda(p.custo_direto)], ["Frete", moeda(p.frete)],
      ["Preço mínimo", moeda(p.preco_minimo)], ["Preço da proposta", moeda(p.preco_proposta)],
      ["Margem", p.margem_percentual === null || p.margem_percentual === undefined ? "—" : `${Number(p.margem_percentual).toLocaleString("pt-BR")}%`]];
    const abertos = prazos.filter((z) => !z.concluido_em).sort((a, b) => Date.parse(a.vencimento) - Date.parse(b.vencimento));
    return {
      titulo: p.objeto || "Processo",
      ficha, preco,
      prazos: abertos.map((z) => [dataBr(z.vencimento, true), z.titulo]),
      itens: itens.slice(0, MAX_ITENS).map((i) => [i.identificador, curto(i.descricao, 160) || "—", i.quantidade ?? "—", moeda(i.valor_proposta ?? (i.valor_unitario_proposta == null || i.quantidade == null ? null : Math.round(Number(i.quantidade) * Number(i.valor_unitario_proposta) * 100) / 100))]),
      itensRestantes: Math.max(0, itens.length - MAX_ITENS),
      documentos: documentos.map((d) => [d.tipo, d.titulo || "", d.vencimento ? `Válido até ${dataBr(d.vencimento)}` : "Sem validade"]),
      exigidos: Array.isArray(p.documentos_exigidos) ? p.documentos_exigidos.filter(Boolean) : [],
      observacoes: p.observacoes || "",
      link: /^https:\/\//.test(p.url_origem || "") ? p.url_origem : null,
    };
  }

  // ---------- página ----------
  function criar(tag, props = {}, filhos = []) {
    const no = Object.assign(document.createElement(tag), props);
    for (const f of [].concat(filhos)) if (f != null) no.append(f);
    return no;
  }
  const tabela = (cabecalho, linhas) => criar("table", {}, [criar("thead", {}, criar("tr", {}, cabecalho.map((c) => criar("th", { textContent: c })))),
    criar("tbody", {}, linhas.map((l) => criar("tr", {}, l.map((c) => criar("td", { textContent: String(c) })))))]);
  const pares = (linhas) => criar("dl", {}, linhas.flatMap(([r, v]) => [criar("dt", { textContent: r }), criar("dd", { textContent: v })]));
  const bloco = (titulo, conteudo) => criar("section", {}, [criar("h2", { textContent: titulo }), conteudo]);

  function desenhar(alvo, r) {
    const vazio = (t) => criar("p", { className: "vazio", textContent: t });
    alvo.replaceChildren(
      criar("header", {}, [criar("h1", { textContent: r.titulo }), criar("p", { className: "gerado", textContent: `Resumo gerado em ${dataBr(new Date().toISOString(), true)} pelo LicitaPlena` })]),
      criar("div", { className: "duas" }, [bloco("Ficha", pares(r.ficha)), bloco("Preço", pares(r.preco))]),
      bloco("Prazos em aberto", r.prazos.length ? tabela(["Quando", "O quê"], r.prazos) : vazio("Nenhum prazo em aberto.")),
      bloco("Itens", r.itens.length ? criar("div", {}, [tabela(["Item", "Descrição", "Qtd.", "Proposta"], r.itens), r.itensRestantes ? vazio(`E mais ${r.itensRestantes} item(ns) no sistema.`) : null]) : vazio("Nenhum item cadastrado.")),
      criar("div", { className: "duas" }, [
        bloco("Documentos escolhidos", r.documentos.length ? tabela(["Documento", "Descrição", "Validade"], r.documentos) : vazio("Nenhum documento escolhido.")),
        bloco("Documentos exigidos", r.exigidos.length ? criar("ul", {}, r.exigidos.map((t) => criar("li", { textContent: t }))) : vazio("Não informados."))]),
      bloco("Anotações", r.observacoes ? criar("p", { className: "notas", textContent: r.observacoes }) : vazio("Sem anotações.")),
      r.link ? criar("p", { className: "gerado" }, ["Edital: ", criar("a", { href: r.link, textContent: r.link, rel: "noopener noreferrer" })]) : null);
  }

  async function iniciar() {
    const alvo = document.getElementById("resumo");
    const q = new URLSearchParams(location.search);
    const empresaId = q.get("empresa") || "", processoId = q.get("processo") || "";
    // Sem resumo não há o que imprimir: o botão fica desligado junto com a mensagem.
    const falhar = (t) => { alvo.replaceChildren(criar("p", { className: "vazio", textContent: t })); const b = document.getElementById("imprimir"); if (b) b.disabled = true; };
    if (!UUID.test(empresaId) || !UUID.test(processoId)) return falhar("Link incompleto. Abra o resumo pelo processo no sistema.");
    const voltar = document.getElementById("voltar"); // volta ao mesmo processo, não à tela inicial do sistema
    if (voltar) voltar.href = `sistema?empresa=${encodeURIComponent(empresaId)}&processo=${encodeURIComponent(processoId)}`;
    const sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace(`login.html?voltar=${encodeURIComponent(location.pathname + location.search)}`); return; }
    // Mesma porta das outras telas logadas: cadastro não aprovado não vê nada.
    const { data: cad } = await sb.from("clientes").select("status").eq("id", session.user.id).maybeSingle();
    if (cad?.status !== "aprovado") { await sb.auth.signOut(); location.replace("login.html"); return; }
    const [p, e, z, i, v] = await Promise.all([
      sb.from("operacao_processos").select("*").eq("id", processoId).eq("empresa_id", empresaId).maybeSingle(),
      sb.from("operacao_empresas").select("razao_social,cnpj").eq("id", empresaId).maybeSingle(),
      sb.from("operacao_prazos_processo").select("titulo,vencimento,concluido_em").eq("processo_id", processoId).order("vencimento"),
      sb.from("operacao_itens_resultado").select("identificador,descricao,quantidade,valor_proposta,valor_unitario_proposta").eq("processo_id", processoId).order("identificador").limit(200),
      sb.from("operacao_processo_documentos").select("documento_id").eq("processo_id", processoId)]);
    if (p.error || !p.data) return falhar("Processo não encontrado ou sem acesso.");
    const ids = (v.data || []).map((x) => x.documento_id);
    const docs = ids.length ? await sb.from("operacao_documentos").select("tipo,titulo,vencimento").in("id", ids).order("tipo") : { data: [] };
    const r = montarResumo({ processo: p.data, empresa: e.data, prazos: z.data || [], itens: i.data || [], documentos: docs.data || [] });
    document.title = `Resumo: ${r.titulo.slice(0, 60)} — LicitaPlena`;
    desenhar(alvo, r);
  }

  const api = { montarResumo, MAX_ITENS };
  global.LicitaResumoProcesso = api;
  if (typeof document !== "undefined" && document.getElementById?.("resumo")) {
    document.getElementById("imprimir")?.addEventListener("click", () => global.print());
    iniciar().catch(() => { document.getElementById("resumo").textContent = "Não foi possível montar o resumo agora."; const b = document.getElementById("imprimir"); if (b) b.disabled = true; });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
