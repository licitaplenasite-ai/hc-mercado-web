/* global document, window, fetch -- script de navegador */
// Painel lateral "Prospecção de fornecedores" (Encontrar fornecedor com IA). Chama /api/fornecedor-ia, que devolve
// até 3 empresas por vez que já assinaram contrato público parecido. Abre por window.abrirFornecedorIA(texto?) ou
// por qualquer botão com data-abrir-fornecedor-ia. Tudo é escrito com textContent (dado de fora nunca vira HTML).
(function () {
  "use strict";
  if (window.abrirFornecedorIA) return;
  let fundo, corpo, campo, botaoBuscar, botaoMais, usoTexto, usoBarra;
  let mostrados = [];
  let descricaoAtual = "";
  let carregando = false;

  function criar(tag, props = {}, filhos = []) {
    const no = Object.assign(document.createElement(tag), props);
    for (const f of [].concat(filhos)) if (f != null) no.append(f);
    return no;
  }
  const moeda = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function montar() {
    if (!document.querySelector('link[href^="gaveta-lateral.css"]')) document.head.append(criar("link", { rel: "stylesheet", href: "gaveta-lateral.css" }));
    const fechar = criar("button", { type: "button", className: "lp-gaveta-fechar", title: "Fechar", textContent: "✕" });
    fechar.setAttribute("aria-label", "Fechar Encontrar fornecedor com IA");
    usoTexto = criar("p", { className: "lp-dica", textContent: "Limite: 20 perguntas por dia." });
    usoBarra = criar("span", { style: "width:0%" });
    corpo = criar("div", { className: "lp-gaveta-corpo" }, [
      criar("p", { className: "lp-aviso", textContent: "A IA pode errar. Os fornecedores vêm de contratos públicos já assinados; o contato vem do cadastro público da Receita. Confira antes de negociar." }),
      criar("p", { className: "lp-dica", textContent: "Descreva o produto (ex.: papel sulfite A4 branco 75g). Não escreva nome, telefone ou e-mail." }),
    ]);
    corpo.setAttribute("aria-live", "polite");
    campo = criar("textarea", { id: "fornecedor-ia-descricao", placeholder: "Digite a descrição do produto que você quer achar fornecedor...", maxLength: 300 });
    campo.setAttribute("aria-label", "Descrição do produto");
    botaoBuscar = criar("button", { type: "button", className: "lp-primario", textContent: "Encontrar fornecedores" });
    botaoMais = criar("button", { type: "button", textContent: "Trazer mais três", hidden: true });
    const gaveta = criar("aside", { className: "lp-gaveta" }, [
      criar("div", { className: "lp-gaveta-topo" }, [criar("h2", { id: "fornecedor-ia-titulo", textContent: "Encontrar fornecedor com IA" }), fechar]),
      criar("div", { className: "lp-uso" }, [usoTexto, criar("div", { className: "lp-uso-barra" }, usoBarra)]),
      corpo,
      criar("div", { className: "lp-gaveta-rodape" }, [campo, criar("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [botaoBuscar, botaoMais])]),
    ]);
    gaveta.setAttribute("role", "dialog");
    gaveta.setAttribute("aria-modal", "true");
    gaveta.setAttribute("aria-labelledby", "fornecedor-ia-titulo");
    fundo = criar("div", { className: "lp-gaveta-fundo", hidden: true }, gaveta);
    document.body.append(fundo);
    fechar.addEventListener("click", fecharGaveta);
    fundo.addEventListener("click", (e) => { if (e.target === fundo) fecharGaveta(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !fundo.hidden) fecharGaveta(); });
    botaoBuscar.addEventListener("click", () => buscar(false));
    botaoMais.addEventListener("click", () => buscar(true));
    campo.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); buscar(false); } });
  }

  function fecharGaveta() { fundo.hidden = true; }

  function mostrarUso(uso) {
    if (!uso) return;
    const restantes = Math.max(0, uso.limite - uso.usadas);
    usoTexto.textContent = `Você usou ${uso.usadas} de ${uso.limite} perguntas diárias. ${restantes} restantes.`;
    usoBarra.style.width = `${Math.min(100, (100 * uso.usadas) / uso.limite)}%`;
  }

  function linha(rotulo, valor) { return [criar("dt", { textContent: rotulo }), criar("dd", {}, valor)]; }

  // Site provável (domínio do e-mail da Receita) com a origem dita; sem ele, busca no Google pelo nome da empresa.
  function siteCelula(f) {
    const site = /^https:\/\/[a-z0-9.-]+$/.test(f.contato.site || "") ? f.contato.site : null;
    if (site) return [criar("a", { href: site, target: "_blank", rel: "noopener noreferrer", textContent: site.replace("https://", "") }), " (provável: domínio do e-mail na Receita)"];
    return ["Não localizado · ", criar("a", { href: `https://www.google.com/search?q=${encodeURIComponent(`${f.nome} site oficial`)}`, target: "_blank", rel: "noopener noreferrer", textContent: "Procurar no Google" })];
  }

  function cartao(f) {
    const contato = f.contato.mei
      ? "Não exibido (MEI: o contato da Receita é o da pessoa)"
      : [f.contato.telefone ? `Telefone ${f.contato.telefone}` : "Telefone não localizado", f.contato.email ? `E-mail ${f.contato.email}` : "E-mail não localizado"].join(" · ");
    const local = [f.municipio, f.uf].filter(Boolean).join(" / ") || "Não localizada";
    const chip = criar("span", { className: `lp-chip${f.aderencia < 70 ? " medio" : ""}`, textContent: `Aderência ${f.aderencia}%` });
    const dl = criar("dl", {}, [
      ...linha("Por quê", `${f.porque}${f.analisePor === "dados" ? " (pelos dados, sem IA)" : ""}`),
      ...linha("Contratos", `${f.contratos} contrato(s) parecido(s), ${moeda(f.valorTotal)}${f.ufsAtuacao.length ? ` · ${f.ufsAtuacao.join(", ")}` : ""}`),
      ...linha("Contato", contato),
      ...linha("Site", siteCelula(f)),
      ...linha("Localização", `${local}${f.situacao && f.situacao !== "ATIVA" ? ` · situação na Receita: ${f.situacao}` : ""}`),
    ]);
    const filhos = [criar("h3", {}, [criar("span", { textContent: f.nome }), chip]), criar("p", { className: "lp-dica", textContent: `CNPJ ${f.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}` }), dl];
    // No painel, reaproveita a "Analisar concorrente" que já existe (mesmo caminho do "Abrir dossiê").
    if (document.getElementById("emp-cnpj")) {
      const analisar = criar("button", { type: "button", textContent: "Analisar empresa", style: "margin-top:12px" });
      analisar.addEventListener("click", () => {
        fecharGaveta();
        document.getElementById("emp-cnpj").value = f.cnpj; // antes do menu: a tela não restaura a última empresa por cima
        document.querySelector('nav button[data-alvo="empresa"]')?.click();
        document.getElementById("emp-buscar")?.click();
      });
      filhos.push(analisar);
    }
    return criar("article", { className: "lp-cartao" }, filhos);
  }

  async function token() {
    const r = await window.__sbClient?.auth.getSession();
    return r?.data?.session?.access_token || null;
  }

  async function buscar(mais) {
    if (carregando) return;
    const descricao = mais ? descricaoAtual : campo.value.trim();
    if (!descricao) { campo.focus(); return; }
    if (!mais) { mostrados = []; descricaoAtual = descricao; corpo.querySelectorAll(".lp-cartao, .lp-resultado").forEach((n) => n.remove()); }
    carregando = true;
    botaoBuscar.disabled = botaoMais.disabled = true;
    const espera = criar("p", { className: "lp-dica lp-resultado", textContent: "Procurando empresas que já forneceram ao governo..." });
    corpo.append(espera);
    try {
      const t = await token();
      if (!t) throw new Error("Sessão expirada. Entre de novo.");
      const r = await fetch("/api/fornecedor-ia", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ descricao, pular: mostrados }) });
      const d = await r.json().catch(() => ({}));
      mostrarUso(d.uso);
      if (!r.ok) throw new Error(d.erro || "Não deu para buscar agora.");
      espera.remove();
      if (!d.fornecedores.length) corpo.append(criar("p", { className: "lp-aviso lp-resultado", textContent: mais ? "Não há mais fornecedores para essa descrição na nossa base." : "Não achei empresas com contrato público parecido. Tente outras palavras (ex.: o nome comum do produto)." }));
      for (const f of d.fornecedores) { mostrados.push(f.cnpj); corpo.append(cartao(f)); }
      if (d.fornecedores.length) corpo.append(criar("p", { className: "lp-dica lp-resultado", textContent: d.maisDisponiveis ? "Se quiser mais opções, posso trazer outras três." : "Esses são todos os fornecedores que achei na base." }));
      botaoMais.hidden = !d.maisDisponiveis;
    } catch (e) {
      espera.className = "lp-aviso lp-erro lp-resultado";
      espera.textContent = e.message || "Não deu para buscar agora.";
    } finally {
      carregando = false;
      botaoBuscar.disabled = botaoMais.disabled = false;
    }
  }

  window.abrirFornecedorIA = function (texto) {
    if (!fundo) montar();
    fundo.hidden = false;
    if (texto) campo.value = String(texto).slice(0, 300);
    campo.focus();
  };
  document.addEventListener("click", (e) => {
    const alvo = e.target.closest?.("[data-abrir-fornecedor-ia]");
    if (alvo) window.abrirFornecedorIA(alvo.dataset.abrirFornecedorIa || "");
  });
})();
