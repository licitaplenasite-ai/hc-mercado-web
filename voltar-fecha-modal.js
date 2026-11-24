// "Voltar" do celular (gesto do iPhone, botão do Android) fecha o modal/gaveta aberto em vez de sair da tela (24/11, dono:
// no Resumo do edital o voltar caía no login). Cada janela aberta ganha uma entrada no histórico com a mesma URL; o voltar
// a consome e fecha a janela pelo próprio botão dela; fechar pelo ✕/Esc/fundo tira a entrada para não sobrar voltar extra.
(function (raiz) {
  "use strict";
  // itens: [{ el, aberto: () => bool, fechar: () => void }]. Mudança de classe/hidden/open no el = abriu ou fechou.
  function criarPilhaVoltar(win, itens) {
    const pilha = [];
    function mudou(item) {
      const i = pilha.indexOf(item);
      if (item.aberto() && i < 0) {
        pilha.push(item);
        win.history.pushState({ voltarFecha: pilha.length }, "", win.location.href);
      } else if (!item.aberto() && i >= 0) {
        pilha.splice(i, 1);
        // Só desfaz a entrada se ela ainda está no topo (fechou pelo ✕); se veio do voltar, ela já saiu.
        const nivel = (win.history.state && win.history.state.voltarFecha) || 0;
        if (nivel > pilha.length) win.history.back();
      }
    }
    function aoVoltar() {
      const nivel = (win.history.state && win.history.state.voltarFecha) || 0;
      pilha.slice(nivel).reverse().forEach((item) => { pilha.splice(pilha.indexOf(item), 1); item.fechar(); });
    }
    win.addEventListener("popstate", aoVoltar);
    if (typeof win.MutationObserver === "function") {
      for (const item of itens) {
        new win.MutationObserver(() => mudou(item)).observe(item.el, { attributes: true, attributeFilter: ["class", "hidden", "open"] });
      }
    }
    return { mudou, aoVoltar, pilha };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { criarPilhaVoltar };
  else raiz.criarPilhaVoltar = criarPilhaVoltar;
})(typeof window !== "undefined" ? window : globalThis);
