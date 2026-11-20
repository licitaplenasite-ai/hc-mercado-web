/* global document, window, module, MutationObserver, URL, Blob, setTimeout, SUPABASE_URL, SUPABASE_ANON_KEY -- navegador (module só no Node) */
// Pastas dos documentos e "Baixar .zip" (Central de documentos, operacao.html). As pastas ficam em
// operacao_documento_pastas (supabase/documentos_pastas.sql), separadas do documento: mudar a pasta não mexe na
// identificação confirmada. O .zip é montado no navegador (zip-simples.js) com os arquivos baixados com a sessão do
// usuário; nada é enviado. Na Central entra sozinho: observa a tabela #lista-documentos e acrescenta o campo de pasta
// em cada linha, o filtro por pasta e o botão. Também usado pelo cartão do processo (processo-documentos-ui.js).
// Tudo por textContent/value. Aguarda aprovação do dono (visual).
(function (global) {
  "use strict";
  const SEM_PASTA = "Sem pasta";
  const BUCKET = "operacao-documentos";

  // ---------- regras (puras, testadas em documentos-pastas-ui.test.js) ----------
  const extensao = (nome) => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(nome || "")); return m ? `.${m[1].toLowerCase()}` : ""; };
  function nomeNoZip(doc, pasta) {
    const base = [doc.tipo, doc.titulo].filter(Boolean).join(" - ") || "documento";
    return `${pasta || SEM_PASTA}/${base}${extensao(doc.arquivo_nome || doc.arquivo_caminho)}`;
  }
  const pastasDe = (mapa) => [...new Set([...mapa.values()].filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const limparPasta = (v) => String(v || "").replace(/[/\\<>]/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
  const passaNoFiltro = (pasta, filtro) => !filtro || (filtro === SEM_PASTA ? !pasta : pasta === filtro);

  // ---------- banco e arquivos ----------
  async function lerPastas(cliente, empresaId) {
    const { data, error } = await cliente.from("operacao_documento_pastas").select("documento_id,pasta").eq("empresa_id", empresaId);
    return error ? null : new Map((data || []).map((r) => [r.documento_id, r.pasta]));
  }
  async function salvarPasta(cliente, doc, valor) {
    const pasta = limparPasta(valor);
    const r = pasta
      ? await cliente.from("operacao_documento_pastas").upsert({ documento_id: doc.id, organizacao_id: doc.organizacao_id, empresa_id: doc.empresa_id, pasta }, { onConflict: "documento_id" })
      : await cliente.from("operacao_documento_pastas").delete().eq("documento_id", doc.id);
    if (r.error) throw new Error("Não foi possível salvar a pasta agora.");
    return pasta;
  }
  // Baixa os arquivos com a sessão do usuário e entrega o .zip; arquivo que falhar vira aviso e não derruba os outros.
  async function baixarZip(cliente, docs, pastas, nomeZip) {
    const arquivos = [], avisos = [];
    for (const d of docs) {
      if (!d.arquivo_caminho) { avisos.push(`${d.tipo}: sem arquivo anexado.`); continue; }
      const { data, error } = await cliente.storage.from(BUCKET).download(d.arquivo_caminho);
      if (error || !data) { avisos.push(`${d.tipo}: não foi possível baixar.`); continue; }
      arquivos.push({ nome: nomeNoZip(d, pastas.get(d.id)), bytes: new Uint8Array(await data.arrayBuffer()) });
    }
    if (!arquivos.length) return { incluidos: 0, avisos };
    const url = URL.createObjectURL(new Blob([global.LicitaZip.montarZip(arquivos)], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url; a.download = nomeZip || "documentos.zip"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { incluidos: arquivos.length, avisos };
  }

  // ---------- Central de documentos (operacao.html) ----------
  function criar(tag, props = {}, filhos = []) {
    const no = Object.assign(document.createElement(tag), props);
    for (const f of [].concat(filhos)) if (f != null) no.append(f);
    return no;
  }
  function instalarCentral() {
    const corpo = document.getElementById("lista-documentos");
    const empresaSel = document.getElementById("empresa-atual");
    if (!corpo || !empresaSel || !global.supabase || typeof SUPABASE_URL === "undefined") return;
    const cliente = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    let docs = new Map(), pastas = new Map(), filtro = "", geracao = 0;

    const lista = criar("datalist", { id: "lp-pastas-lista" });
    const seletor = criar("select", { id: "lp-pasta-filtro" });
    seletor.setAttribute("aria-label", "Mostrar documentos da pasta");
    const botaoZip = criar("button", { type: "button", className: "btn", textContent: "Baixar .zip" });
    botaoZip.title = "Os marcados na coluna PDF, ou todos da pasta escolhida, separados em pastas";
    const status = criar("p", { className: "nota", id: "lp-zip-status" });
    status.setAttribute("aria-live", "polite");
    const barra = criar("div", { className: "lp-pastas-barra", style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 10px" }, [criar("label", { className: "nota" }, ["Pasta ", seletor]), botaoZip, lista]);
    const wrap = corpo.closest(".tabela-wrap");
    wrap?.before(barra);
    wrap?.after(status);

    function aplicarFiltro() {
      for (const tr of corpo.querySelectorAll("tr")) {
        const id = tr.querySelector("input[type=checkbox][data-id]")?.dataset.id;
        if (id) tr.hidden = !passaNoFiltro(pastas.get(id), filtro);
      }
    }
    function montarSeletor() {
      const nomes = pastasDe(pastas);
      seletor.replaceChildren(criar("option", { value: "", textContent: "Todas" }), ...nomes.map((n) => criar("option", { value: n, textContent: n })), criar("option", { value: SEM_PASTA, textContent: SEM_PASTA }));
      if (filtro && filtro !== SEM_PASTA && !nomes.includes(filtro)) filtro = "";
      seletor.value = filtro;
      lista.replaceChildren(...nomes.map((n) => criar("option", { value: n })));
    }
    async function decorar() {
      const minha = ++geracao, empresaId = empresaSel.value;
      if (!empresaId) return;
      const [r, mapa] = await Promise.all([
        cliente.from("operacao_documentos").select("id,organizacao_id,empresa_id,tipo,titulo,arquivo_caminho,arquivo_nome").eq("empresa_id", empresaId),
        lerPastas(cliente, empresaId)]);
      if (minha !== geracao) return;
      barra.hidden = !mapa; // SQL ainda não aplicado: nada de pasta nem .zip
      if (!mapa || r.error) return;
      docs = new Map((r.data || []).map((d) => [d.id, d])); pastas = mapa;
      montarSeletor();
      for (const caixa of corpo.querySelectorAll("input[type=checkbox][data-id]")) {
        const doc = docs.get(caixa.dataset.id), celula = caixa.closest("tr")?.children[1];
        if (!doc || !celula || celula.querySelector(".lp-pasta-campo")) continue;
        const campo = criar("input", { className: "lp-pasta-campo", value: pastas.get(doc.id) || "", placeholder: SEM_PASTA, maxLength: 60, style: "max-width:170px;font-size:12px;padding:2px 6px" });
        campo.setAttribute("list", "lp-pastas-lista");
        campo.setAttribute("aria-label", `Pasta de ${doc.tipo}`);
        campo.addEventListener("change", async () => {
          try {
            const pasta = await salvarPasta(cliente, doc, campo.value);
            campo.value = pasta;
            if (pasta) pastas.set(doc.id, pasta); else pastas.delete(doc.id);
            montarSeletor(); aplicarFiltro();
            status.textContent = pasta ? `${doc.tipo} foi para a pasta ${pasta}.` : `${doc.tipo} ficou sem pasta.`;
          } catch (e) { status.textContent = e.message; }
        });
        celula.append(criar("br"), criar("label", { className: "nota lp-pasta-rotulo" }, ["Pasta ", campo]));
      }
      aplicarFiltro();
    }
    seletor.addEventListener("change", () => { filtro = seletor.value; aplicarFiltro(); });
    botaoZip.addEventListener("click", async () => {
      const marcados = [...corpo.querySelectorAll("input[type=checkbox][data-id]:checked")].map((c) => docs.get(c.dataset.id)).filter(Boolean);
      const alvo = marcados.length ? marcados : [...docs.values()].filter((d) => d.arquivo_caminho && passaNoFiltro(pastas.get(d.id), filtro));
      if (!alvo.length) { status.textContent = "Nenhum documento com arquivo para o .zip."; return; }
      botaoZip.disabled = true; status.textContent = `Montando .zip com ${alvo.length} documento(s)...`;
      try {
        const r = await baixarZip(cliente, alvo, pastas, "documentos-empresa.zip");
        status.textContent = r.incluidos ? `.zip baixado com ${r.incluidos} documento(s).${r.avisos.length ? ` ${r.avisos.join(" ")}` : ""}` : `Nenhum arquivo pôde entrar no .zip. ${r.avisos.join(" ")}`;
      } catch (e) { status.textContent = e.message || "Não foi possível montar o .zip agora."; }
      finally { botaoZip.disabled = false; }
    });
    new MutationObserver(() => { decorar().catch(() => {}); }).observe(corpo, { childList: true });
    decorar().catch(() => {});
  }

  const api = { nomeNoZip, pastasDe, limparPasta, passaNoFiltro, lerPastas, salvarPasta, baixarZip, SEM_PASTA };
  global.LicitaDocumentosPastas = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", instalarCentral); else instalarCentral();
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
