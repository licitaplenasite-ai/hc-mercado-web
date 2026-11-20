/* global document, window, module -- script de navegador (module só no Node, nos testes) */
// Cartão "Documentos deste processo" (sistema.html, processo aberto): escolher documentos JÁ SALVOS em Minhas empresas e
// documentos (sem novo upload), separados por pasta, ver a validade, baixar o .zip e abrir o resumo de 1 página para
// imprimir (resumo-processo.html). Grava em operacao_processo_documentos (supabase/documentos_pastas.sql) com a sessão
// do usuário (RLS). Banco sem a tabela: o cartão some. Tudo por textContent. Aguarda aprovação do dono (visual).
(function (global) {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ---------- regras (puras, testadas em processo-documentos-ui.test.js) ----------
  // Validade na data da sessão quando ela existe (o que importa é estar válido no dia), senão hoje.
  function situacao(doc, referencia) {
    if (!doc.vencimento) return { classe: "sem-data", texto: "Sem validade informada" };
    const vence = Date.parse(`${doc.vencimento}T23:59:59-03:00`);
    const dia = referencia ? Date.parse(referencia) : Date.now();
    if (vence < dia) return { classe: "vencido", texto: `Vencido em ${doc.vencimento.split("-").reverse().join("/")}` };
    if (vence - dia <= 7 * 86400000) return { classe: "proximo", texto: `Vence em ${doc.vencimento.split("-").reverse().join("/")}` };
    return { classe: "valido", texto: `Válido até ${doc.vencimento.split("-").reverse().join("/")}` };
  }
  // O que gravar e o que apagar para a escolha nova virar a gravada.
  function diferenca(atuais, escolhidos) {
    const a = new Set(atuais), e = new Set(escolhidos);
    return { incluir: [...e].filter((id) => !a.has(id)), tirar: [...a].filter((id) => !e.has(id)) };
  }
  function agrupar(docs, pastas, semPasta) {
    const grupos = new Map();
    for (const d of docs) {
      const p = pastas.get(d.id) || semPasta;
      grupos.set(p, [...(grupos.get(p) || []), d]);
    }
    return [...grupos.entries()].sort(([a], [b]) => (a === semPasta) - (b === semPasta) || a.localeCompare(b, "pt-BR"));
  }
  const linkResumo = (empresaId, processoId) => `resumo-processo.html?empresa=${encodeURIComponent(empresaId)}&processo=${encodeURIComponent(processoId)}`;

  // ---------- tela ----------
  function criar(tag, props = {}, filhos = []) {
    const no = Object.assign(document.createElement(tag), props);
    for (const f of [].concat(filhos)) if (f != null) no.append(f);
    return no;
  }

  function montar({ alvo, contexto, cliente }) {
    let vivo = true;
    const P = global.LicitaDocumentosPastas;
    if (!alvo || !cliente || !P || !UUID.test(contexto?.empresaId || "") || !UUID.test(contexto?.processoId || "")) return { fechar() {} };
    const { empresaId, processoId } = contexto;
    let docs = [], pastas = new Map(), escolhidos = [], dataSessao = null;
    const status = criar("p", { className: "app-apoio" });
    status.setAttribute("aria-live", "polite");
    const lista = criar("ul", { className: "lp-proc-docs" });
    const escolha = criar("details", { className: "lp-proc-docs-escolha" });

    async function carregar() {
      const [d, v, p, m] = await Promise.all([
        cliente.from("operacao_documentos").select("id,organizacao_id,empresa_id,tipo,titulo,vencimento,arquivo_caminho,arquivo_nome").eq("empresa_id", empresaId).order("tipo"),
        cliente.from("operacao_processo_documentos").select("documento_id").eq("processo_id", processoId),
        cliente.from("operacao_processos").select("data_sessao").eq("id", processoId).maybeSingle(),
        P.lerPastas(cliente, empresaId)]);
      if (!vivo) return false;
      if (d.error || v.error || !m) return false; // tabela ainda não aplicada ou sem acesso: o cartão fica vazio (CSS esconde)
      docs = d.data || []; pastas = m; escolhidos = (v.data || []).map((x) => x.documento_id); dataSessao = p.data?.data_sessao || null;
      return true;
    }

    function desenharLista() {
      const meus = docs.filter((d) => escolhidos.includes(d.id));
      lista.replaceChildren(...(meus.length ? meus.map((d) => {
        const s = situacao(d, dataSessao);
        return criar("li", {}, [criar("strong", { textContent: d.tipo }), d.titulo ? ` · ${d.titulo}` : "", ` · ${pastas.get(d.id) || P.SEM_PASTA} · `,
          criar("span", { className: `lp-proc-doc-${s.classe}`, textContent: s.texto }), d.arquivo_caminho ? "" : " · sem arquivo"]);
      }) : [criar("li", { className: "app-apoio", textContent: "Nenhum documento escolhido ainda. Use “Escolher documentos salvos”." })]));
    }

    function desenharEscolha() {
      const caixas = [];
      const grupos = P && agrupar(docs, pastas, P.SEM_PASTA).map(([pasta, itens]) => criar("fieldset", {}, [criar("legend", { textContent: pasta }),
        ...itens.map((d) => {
          const caixa = criar("input", { type: "checkbox", value: d.id, checked: escolhidos.includes(d.id) });
          caixas.push(caixa);
          return criar("label", { style: "display:block" }, [caixa, ` ${d.tipo}${d.titulo ? ` · ${d.titulo}` : ""} (${situacao(d, dataSessao).texto})`]);
        })]));
      const salvar = criar("button", { type: "button", textContent: "Salvar escolha" });
      salvar.addEventListener("click", async () => {
        const { incluir, tirar } = diferenca(escolhidos, caixas.filter((c) => c.checked).map((c) => c.value));
        salvar.disabled = true;
        try {
          if (incluir.length) {
            const r = await cliente.from("operacao_processo_documentos").insert(incluir.map((documento_id) => {
              const d = docs.find((x) => x.id === documento_id);
              return { processo_id: processoId, documento_id, organizacao_id: d.organizacao_id, empresa_id: d.empresa_id };
            }));
            if (r.error) throw r.error;
          }
          if (tirar.length) {
            const r = await cliente.from("operacao_processo_documentos").delete().eq("processo_id", processoId).in("documento_id", tirar);
            if (r.error) throw r.error;
          }
          escolhidos = escolhidos.filter((id) => !tirar.includes(id)).concat(incluir);
          escolha.open = false; desenharLista();
          status.textContent = `Escolha salva: ${escolhidos.length} documento(s) neste processo.`;
        } catch { status.textContent = "Não foi possível salvar a escolha agora."; }
        finally { salvar.disabled = false; }
      });
      escolha.replaceChildren(criar("summary", { textContent: "Escolher documentos salvos" }),
        ...(docs.length ? grupos : [criar("p", { className: "app-apoio", textContent: "Esta empresa ainda não tem documentos em Minhas empresas e documentos." })]), docs.length ? salvar : null);
    }

    const zip = criar("button", { type: "button", textContent: "Baixar .zip" });
    zip.addEventListener("click", async () => {
      const alvoDocs = docs.filter((d) => escolhidos.includes(d.id));
      if (!alvoDocs.length) { status.textContent = "Escolha os documentos antes de baixar o .zip."; return; }
      zip.disabled = true; status.textContent = "Montando .zip...";
      try {
        const r = await P.baixarZip(cliente, alvoDocs, pastas, "documentos-do-processo.zip");
        status.textContent = r.incluidos ? `.zip baixado com ${r.incluidos} documento(s).${r.avisos.length ? ` ${r.avisos.join(" ")}` : ""}` : `Nenhum arquivo pôde entrar. ${r.avisos.join(" ")}`;
      } catch (e) { status.textContent = e.message || "Não foi possível montar o .zip agora."; }
      finally { zip.disabled = false; }
    });
    const resumo = criar("a", { href: linkResumo(empresaId, processoId), target: "_blank", rel: "noopener", textContent: "Resumo do processo (1 página para imprimir)" });

    carregar().then((ok) => {
      if (!ok || !vivo) return;
      desenharLista(); desenharEscolha();
      alvo.replaceChildren(criar("h2", { className: "app-subtitulo", textContent: "Documentos deste processo" }),
        criar("p", { className: "app-apoio", textContent: "Escolha os documentos já salvos da empresa. A validade é conferida na data da sessão." }),
        lista, escolha, criar("div", { className: "lp-proc-docs-acoes" }, [zip, resumo]), status);
    }).catch(() => {});
    return { fechar() { vivo = false; } };
  }

  const api = { montar, situacao, diferenca, agrupar, linkResumo };
  global.LicitaProcessoDocumentos = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
