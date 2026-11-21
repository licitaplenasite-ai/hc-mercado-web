/* global module, window */
(function (raiz) {
  function totalPorQuantidade(quantidade, valorUnitario) {
    if (quantidade === "" || quantidade == null || valorUnitario === "" || valorUnitario == null) return null;
    const qtd = Number(quantidade), unitario = Number(valorUnitario);
    if (!Number.isFinite(qtd) || qtd <= 0 || !Number.isFinite(unitario) || unitario < 0) return null;
    const total = Number((qtd * unitario).toFixed(2));
    return Number.isFinite(total) && total <= 9999999999999.99 ? total : null;
  }

  function apurarItens(itens) {
    if (!itens.length) return null;
    const ganhos = itens.filter(item => item.situacao === "ganho");
    const pendentes = itens.filter(item => item.situacao === "pendente");
    const resolvidos = itens.filter(item => item.situacao !== "pendente");
    const situacao = pendentes.length ? "em_disputa"
      : ganhos.length === itens.length ? "vitoria_total"
      : ganhos.length ? "vitoria_parcial"
      : resolvidos.every(item => item.situacao === "nao_disputado") ? "nao_participou"
      : resolvidos.every(item => item.situacao === "cancelado") ? "revogado_anulado"
      : "sem_vitoria";
    const valorCompleto = ganhos.every(item => item.valor_homologado !== null && item.valor_homologado !== undefined);
    const valor = ganhos.length && valorCompleto
      ? Number(ganhos.reduce((soma, item) => soma + Number(item.valor_homologado), 0).toFixed(2))
      : null;
    return { situacao, valor, ganhos: ganhos.length, total: itens.length, valorCompleto };
  }

  function resultadoEfetivo(processo, itens) {
    const apurado = apurarItens(itens);
    return apurado || {
      situacao: processo.situacao_resultado || "nao_apurado",
      valor: processo.valor_homologado == null ? null : Number(processo.valor_homologado),
      ganhos: 0,
      total: 0,
      valorCompleto: processo.valor_homologado != null,
    };
  }

  // Andamento do item ganho (supabase/operacao_itens_entrega.sql). Passo sem valor gravado = aguardando compra.
  // Avançar grava hoje nos passos ainda sem data (mantém a já gravada); voltar apaga a data dos passos seguintes.
  const PASSOS_ENTREGA = ["aguardando_compra", "comprado", "enviado", "entregue"];
  const DATA_DO_PASSO = { comprado: "comprado_em", enviado: "enviado_em", entregue: "entregue_em" };
  function andamentoItem(item, passo, hoje, rastreio) {
    const indice = PASSOS_ENTREGA.indexOf(passo);
    if (indice < 0) return { erro: "Escolha um passo do andamento." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje || "")) return { erro: "Data de hoje inválida." };
    const r = String(rastreio ?? "").trim();
    if (r.length > 500) return { erro: "O rastreio ou link pode ter até 500 caracteres." };
    const dados = { entrega_situacao: passo, rastreio: r || null };
    PASSOS_ENTREGA.slice(1).forEach((p, k) => { dados[DATA_DO_PASSO[p]] = k + 1 <= indice ? (item?.[DATA_DO_PASSO[p]] || hoje) : null; });
    return { dados };
  }
  // Contador do resumo: só itens ganhos, por passo.
  function contarAndamento(itens) {
    const c = { aguardando_compra: 0, comprado: 0, enviado: 0, entregue: 0, total: 0 };
    for (const item of itens || []) {
      if (item.situacao !== "ganho") continue;
      c[PASSOS_ENTREGA.includes(item.entrega_situacao) ? item.entrega_situacao : "aguardando_compra"] += 1;
      c.total += 1;
    }
    return c;
  }

  const api = { apurarItens, resultadoEfetivo, totalPorQuantidade, PASSOS_ENTREGA, andamentoItem, contarAndamento };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.LicitaAcompanhamento = api;
})(typeof window !== "undefined" ? window : globalThis);
