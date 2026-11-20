/* global document, window, module -- script de navegador (module só no Node, nos testes) */
// "Ler aqui": abre o PDF do edital (ou de outro documento do PNCP) dentro da tela, sem baixar. O arquivo passa pela
// função /api/pncp-baixar com ver=1 (inline, só para PDF, emoldurável só pelo próprio site) e o navegador mostra no
// leitor de PDF dele. Nada é guardado no servidor. Qualquer botão com data-ler-pdf="<link do /api/pncp-baixar>" abre.
// Também: window.LicitaVisualizadorPdf.abrir(link, titulo). Aguarda aprovação do dono (visual).
(function (global) {
  "use strict";
  if (global.LicitaVisualizadorPdf) return;

  // Só o proxy do próprio site (endereço relativo): nada de abrir URL de fora dentro da moldura.
  function linkParaVer(link) {
    const s = String(link || "");
    if (!/^\/api\/pncp-baixar\?/.test(s)) return null;
    return /[?&]ver=1(&|$)/.test(s) ? s : `${s}&ver=1`;
  }
  // Título que já diz outro formato (planilha, zip, Word) não ganha "Ler aqui": esses só baixam.
  const pareceNaoPdf = (titulo) => /\.(zip|rar|7z|docx?|xlsx?|odt|ods|csv|txt)$/i.test(String(titulo || "").trim());

  let fundo, moldura, tituloEl, baixar;
  function montar() {
    const d = document;
    fundo = d.createElement("div");
    fundo.className = "lp-pdf-fundo";
    fundo.hidden = true;
    fundo.innerHTML = '<div class="lp-pdf-caixa" role="dialog" aria-modal="true" aria-labelledby="lp-pdf-titulo">' +
      '<div class="lp-pdf-topo"><h2 id="lp-pdf-titulo"></h2><a class="lp-pdf-baixar" target="_blank" rel="noopener">Baixar</a>' +
      '<button type="button" class="lp-pdf-fechar" aria-label="Fechar leitura do documento">✕</button></div>' +
      '<iframe class="lp-pdf-moldura" title="Documento"></iframe>' +
      '<p class="lp-pdf-nota">Se o documento não aparecer (arquivo que não é PDF), use Baixar. A cópia oficial é a do PNCP.</p></div>';
    d.body.append(fundo);
    moldura = fundo.querySelector("iframe");
    tituloEl = fundo.querySelector("h2");
    baixar = fundo.querySelector(".lp-pdf-baixar");
    fundo.querySelector(".lp-pdf-fechar").addEventListener("click", fechar);
    fundo.addEventListener("click", (e) => { if (e.target === fundo) fechar(); });
    d.addEventListener("keydown", (e) => { if (e.key === "Escape" && !fundo.hidden) fechar(); });
    if (!d.querySelector('link[href^="visualizador-pdf.css"]')) d.head.append(Object.assign(d.createElement("link"), { rel: "stylesheet", href: "visualizador-pdf.css" }));
  }
  function fechar() { fundo.hidden = true; moldura.src = "about:blank"; }
  function abrir(link, titulo) {
    const ver = linkParaVer(link);
    if (!ver) return false;
    if (!fundo) montar();
    tituloEl.textContent = String(titulo || "Documento").slice(0, 200);
    baixar.href = ver.replace(/&ver=1(?=&|$)/, "");
    moldura.src = ver;
    fundo.hidden = false;
    fundo.querySelector(".lp-pdf-fechar").focus();
    return true;
  }

  global.LicitaVisualizadorPdf = { abrir, linkParaVer, pareceNaoPdf };
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const alvo = e.target.closest?.("[data-ler-pdf]");
      if (!alvo) return;
      e.preventDefault();
      e.stopPropagation();
      abrir(alvo.dataset.lerPdf, alvo.dataset.titulo);
    });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = global.LicitaVisualizadorPdf;
})(typeof window !== "undefined" ? window : globalThis);
