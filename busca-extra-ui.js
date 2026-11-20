/* global document, window, fetch, URLSearchParams */
// Telas da busca v2 do painel (Encontrar Licitações e Início): sugestão de palavras, "Já tenho o número",
// filtro "sem ninguém participando", Órgãos compradores e a faixa "publicadas hoje / novidades".
// As regras ficam em busca-extra.js (testado); aqui só DOM e consultas ao Supabase (RLS de cliente aprovado).
(function () {
  "use strict";
  const BX = window.BuscaExtra;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
  const hojeBrasilia = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  const sb = async () => {
    if (window.__clientePronto) await window.__clientePronto;
    if (!window.__sbClient) throw new Error("Sessão não iniciada.");
    return window.__sbClient;
  };
  const opcoes = (lista) => lista.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  $("op-portal").insertAdjacentHTML("beforeend", opcoes(BX.PORTAIS));
  $("op-orgaos-portal").insertAdjacentHTML("beforeend", opcoes(BX.PORTAIS));
  $("op-orgaos-uf").insertAdjacentHTML("beforeend", opcoes(UFS));

  // --- Sugestão de palavras enquanto digita ---
  const caixaSug = $("op-sugestoes"), campoPalavras = $("op-palavras");
  campoPalavras.addEventListener("input", () => {
    const sugestoes = BX.sugerirPalavras(campoPalavras.value);
    caixaSug.hidden = !sugestoes.length;
    caixaSug.innerHTML = sugestoes.map((t) => `<button type="button" class="op-sugestao" data-termo="${esc(t)}">${esc(t)}</button>`).join("");
  });
  caixaSug.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-termo]");
    if (!b) return;
    campoPalavras.value = BX.aplicarSugestao(campoPalavras.value, b.dataset.termo);
    caixaSug.hidden = true;
    campoPalavras.focus();
  });

  // --- "Sem ninguém participando": histórico de pregões anteriores (historico_compras/itens/participacoes) ---
  async function sinaisDoHistorico(resultados) {
    const uasgs = [...new Set(resultados.map((r) => String(r.codigoUnidade || "").replace(/^0+/, "")).filter((u) => /^\d{1,8}$/.test(u)))].slice(0, 100);
    if (!uasgs.length) return new Map();
    const { data, error } = await (await sb()).from("historico_compras")
      .select("uasg, historico_itens(situacao_item, valor_estimado, historico_participacoes(valor_lance, valor_negociado))")
      .in("uasg", [...new Set(uasgs.flatMap((u) => [u, u.padStart(6, "0")]))]).limit(300);
    return error ? new Map() : BX.sinaisPorUasg(data);
  }
  async function filtrarSemDisputa(resultados) {
    const caixa = $("op-sem-disputa"), rotulo = $("op-sem-disputa-rotulo");
    let sinais = new Map();
    try { sinais = await sinaisDoHistorico(resultados); } catch { /* sem histórico: o filtro fica escondido */ }
    const comSinal = (r) => BX.temSinal(sinais.get(String(r.codigoUnidade || "").replace(/^0+/, "")));
    const n = resultados.filter(comSinal).length;
    rotulo.hidden = !n && !caixa.checked;
    rotulo.lastChild.textContent = ` Só órgãos com itens desertos, fracassados ou com lance acima do estimado (${n} nesta busca, pelo histórico que já temos)`;
    return caixa.checked ? resultados.filter(comSinal) : resultados;
  }
  $("op-sem-disputa").addEventListener("change", () => $("op-buscar").click());

  // --- Produto ou serviço e valor do item: lê os itens no PNCP (/api/pncp-itens) das primeiras licitações ---
  // shortcut: confere só as 40 primeiras da lista (4 por vez, cache na sessão); o resto fica de fora e a tela avisa.
  const MAX_CONFERIR = 40;
  const cacheItens = new Map();
  async function itensDe(r) {
    const k = r.numeroControlePNCP, partes = BX.partesControle(k);
    if (!partes) return null;
    if (cacheItens.has(k)) return cacheItens.get(k);
    let salvo = null;
    try { salvo = JSON.parse(window.sessionStorage.getItem(`lp-itens-${k}`) || "null"); } catch { /* sem storage */ }
    if (salvo) { cacheItens.set(k, salvo); return salvo; }
    const resp = await (window.fetchComSessao || fetch)(`/api/pncp-itens?${new URLSearchParams({ cnpj: partes.cnpj, ano: String(partes.ano), sequencial: String(partes.sequencial) })}`);
    const j = resp.ok ? await resp.json().catch(() => null) : null;
    if (!j || j.erro || !Array.isArray(j.itens)) return null;
    const enxuto = j.itens.map((i) => ({ materialOuServico: i.materialOuServico, valorUnitarioEstimado: i.valorUnitarioEstimado }));
    cacheItens.set(k, enxuto);
    try { window.sessionStorage.setItem(`lp-itens-${k}`, JSON.stringify(enxuto)); } catch { /* cheio: só a memória */ }
    return enxuto;
  }
  async function filtrarPorItens(resultados, f) {
    const nota = $("op-itens-nota");
    if (!BX.temFiltroDeItem(f)) { if (nota) nota.hidden = true; return resultados; }
    const lote = resultados.slice(0, MAX_CONFERIR), ok = new Array(lote.length).fill(false);
    let falhas = 0, proximo = 0;
    const trabalhar = async () => {
      while (proximo < lote.length) {
        const i = proximo++;
        try { const itens = await itensDe(lote[i]); if (itens) ok[i] = BX.itensConferem(itens, f); else falhas += 1; } catch { falhas += 1; }
      }
    };
    await Promise.all([1, 2, 3, 4].map(trabalhar));
    const saida = lote.filter((_, i) => ok[i]);
    if (nota) {
      nota.hidden = false;
      nota.textContent = `Filtro por item: conferimos os itens das ${lote.length} primeiras licitações da lista no PNCP; ${saida.length} têm item que confere.` +
        (resultados.length > lote.length ? ` As outras ${resultados.length - lote.length} ficaram de fora: refine as palavras para conferir menos.` : "") +
        (falhas ? ` ${falhas} não responderam e ficaram de fora.` : "");
    }
    return saida;
  }

  // --- "Já tenho o número" (UASG + pregão) ---
  $("op-numero-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const uasg = $("op-numero-uasg").value.trim(), numero = $("op-numero-num").value.trim(), status = $("op-numero-status");
    const id = BX.idCompraGov(uasg, $("op-numero-mod").value, numero);
    if (!id) { status.textContent = "Confira: UASG só com números (até 6) e número no formato 90012/2026."; return; }
    const link = BX.linkComprasGov(id);
    const botao = $("op-numero-buscar");
    botao.disabled = true;
    status.textContent = "Procurando...";
    try {
      const n = BX.lerNumero(numero);
      const cliente = await sb();
      const { data } = await cliente.from("oportunidades_abertas").select("dado").eq("dado->>codigoUnidade", uasg.replace(/^0+/, "")).limit(200);
      let achados = (data || []).map((l) => l.dado).filter((r) => BX.mesmoNumero(r, uasg, numero));
      if (!achados.length) {
        const q = new URLSearchParams({ tipos_documento: "edital", q: `${Number(n.numero)}/${n.ano}`, status: "todos", ordenacao: "-data", tam_pagina: "50", pagina: "1" });
        const resp = await (window.fetchComSessao || fetch)(`/api/pncp-proxy?url=${encodeURIComponent(`https://pncp.gov.br/api/search?${q}`)}`);
        const dados = resp.ok ? await resp.json().catch(() => null) : null;
        achados = ((dados && dados.items) || []).map(BX.editalDaBusca).filter((r) => BX.mesmoNumero(r, uasg, numero))
          .map((r) => ({ ...r, link: r.numeroControlePNCP ? `https://pncp.gov.br/app/editais/${r.numeroControlePNCP.replace(/^(\d{14})-\d+-0*(\d+)\/(\d{4})$/, "$1/$3/$2")}` : null }));
      }
      const aviso = `<div class="aviso">Compra ${esc(id)}: <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">abrir "Acompanhar contratação" no Compras.gov.br</a>.</div>`;
      if (achados.length && window.__buscaPainel) {
        window.__buscaPainel.renderizar($("op-resultado"), achados, aviso);
        status.textContent = `Achamos ${achados.length === 1 ? "a licitação" : `${achados.length} registros`} desse número. Veja abaixo.`;
      } else {
        status.innerHTML = `Não achamos esse número no PNCP. <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Abrir direto no Compras.gov.br</a>.`;
      }
    } catch {
      status.innerHTML = `Não deu para procurar agora. <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Abrir direto no Compras.gov.br</a>.`;
    } finally {
      botao.disabled = false;
    }
  });

  // --- Órgãos compradores por UF/portal, com CAPAG (só prefeituras) ---
  let capagBase = null;
  $("op-orgaos-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const uf = $("op-orgaos-uf").value, portal = $("op-orgaos-portal").value, texto = BX.norm($("op-orgaos-texto").value);
    const status = $("op-orgaos-status"), alvo = $("op-orgaos-resultado");
    if (!uf) { status.textContent = "Escolha um estado."; return; }
    status.textContent = "Carregando órgãos...";
    try {
      const cliente = await sb();
      const linhas = [];
      // shortcut: até 5.000 licitações abertas por UF (5 páginas de 1.000); subir se algum estado passar disso.
      for (let i = 0; i < 5000; i += 1000) {
        const { data, error } = await cliente.from("oportunidades_abertas")
          .select("uf, orgao:dado->>orgao, municipio:dado->>municipio, codigoUnidade:dado->>codigoUnidade, usuarioNome:dado->>usuarioNome, esferaId:dado->>esferaId")
          .eq("uf", uf).order("chave").range(i, i + 999);
        if (error) throw error;
        linhas.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      capagBase = capagBase || await fetch("data/capag-municipios.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const capag = (g) => (window.Capag ? window.Capag.consultarCapag(capagBase, { orgao: g.orgao, municipio: g.municipio, uf: g.uf, esferaId: g.esferaId }) : null);
      const orgaos = BX.agruparOrgaos(linhas, capag)
        .filter((g) => (!portal || g.portais.includes(portal)) && (!texto || BX.norm(g.orgao).includes(texto) || g.uasgs.some((u) => u.includes(texto))));
      status.textContent = `${orgaos.length} órgão(s) com licitação aberta em ${uf}${portal ? ` no ${portal}` : ""}. Estimativa de dias para pagar: ainda não temos base pública suficiente; mostramos só a CAPAG.`;
      alvo.innerHTML = orgaos.length ? `<div class="tabela-rolavel"><table><tr><th>Órgão</th><th>Município</th><th>UASG</th><th>Portal</th><th>Abertas</th><th>CAPAG</th></tr>${orgaos.slice(0, 200).map((g) => `<tr>
        <td>${esc(g.orgao)}</td><td>${esc(g.municipio)}</td><td>${esc(g.uasgs.join(", ") || "-")}</td><td>${esc(g.portais.join(", ") || "-")}</td><td>${g.abertas}</td>
        <td>${g.capag ? `<span class="badge-modalidade">${esc(g.capag)}</span>` : '<span class="dica-clique">não se aplica</span>'}</td></tr>`).join("")}</table></div>${orgaos.length > 200 ? '<p class="dica-clique">Mostrando os 200 com mais licitações abertas. Use o nome ou a UASG para achar outro.</p>' : ""}` : "";
    } catch {
      status.textContent = "Não foi possível carregar os órgãos agora. Tente de novo.";
    }
  });

  // --- Início: faixa "publicadas hoje" + última novidade ---
  const novidade = (window.__muralNovidades || [])[0];
  if (novidade) $("dash-faixa-novidade").innerHTML = `<span class="mural-tag mural-tag-${esc(novidade.tag)}">Novidade</span> ${esc(novidade.titulo)} <a href="#mural-novidades">ver todas</a>`;
  sb().then((cliente) => cliente.from("oportunidades_abertas").select("chave", { count: "exact", head: true }).eq("publicacao", hojeBrasilia()))
    .then(({ count, error }) => { if (!error && typeof count === "number") $("dash-faixa-publicadas").textContent = count.toLocaleString("pt-BR"); })
    .catch(() => { /* faixa fica com "–" */ });

  window.BuscaExtraUI = { filtrarSemDisputa, filtrarPorItens };
})();
