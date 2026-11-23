// Movimento do site público (rodada 2 do visual, 23/11; referência: site da HC Licitações).
// 1) Fotos da primeira tela se alternam devagar; as demais só baixam 2,5 s depois do carregamento (não atrasam a página).
// 2) Blocos aparecem subindo de leve ao entrar na tela.
// Com "reduzir movimento" ou sem JavaScript, tudo fica visível e parado (o CSS só esconde com a classe "mov" no <html>).
(function () {
  var raiz = document.documentElement;
  var reduzir = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  var fotos = [].slice.call(document.querySelectorAll(".topo-fotos img"));
  if (fotos.length > 1 && !reduzir) {
    window.addEventListener("load", function () {
      setTimeout(function () {
        fotos.forEach(function (img) {
          if (img.dataset.srcset) img.srcset = img.dataset.srcset;
          if (img.dataset.src) img.src = img.dataset.src;
        });
        var atual = 0;
        setInterval(function () {
          fotos[atual].classList.remove("ativa");
          atual = (atual + 1) % fotos.length;
          fotos[atual].classList.add("ativa");
        }, 6500);
      }, 2500);
    });
  }

  if (reduzir || !("IntersectionObserver" in window)) return;
  var SELETOR = ".cabeca-secao, .ferr, .rota, .etapa, .dif, .agente, .plano, .passos3 li, .publicos li, .grade-blog li," +
    " .faixa-ia, .cta-final, .cartao, .chamada, .faq, .moldura-foto, .numeros, .fatos-site, .email, .cv-lista, .boletim-lado";
  var alvos = [].slice.call(document.querySelectorAll(SELETOR)).filter(function (el) { return !el.closest(".hero"); });
  if (!alvos.length) return;
  var obs = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add("visto");
      obs.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
  alvos.forEach(function (el) {
    var pos = el.parentElement ? [].indexOf.call(el.parentElement.children, el) : 0;
    el.style.setProperty("--atraso", (pos % 4) * 80 + "ms");
    el.classList.add("rv");
    obs.observe(el);
  });
  raiz.classList.add("mov");
})();
