/* global module */
// Inteligência de Mercado (painel.html, aba "Pesquisa de mercado"), no modelo do Siga Pregão: uma busca só e quatro
// respostas — quem ganha, quanto se paga, quem compra e quanto se compra por mês. Junta quatro fontes já existentes:
// contratos e atas do PNCP (tabelas "contratos" e "mercado_atas"), resultados homologados do Compras.gov ("comprasgov_resultados") e a
// Pesquisa de Preços ao vivo (/api/comprasgov-marcas-produto). Tudo vira "venda" no mesmo formato antes de somar.
(function (global) {
  'use strict';
  const TOPO = 10;
  const TOPO_PRECOS = 15;
  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const numero = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const soDigitos = (v) => String(v || '').replace(/\D/g, '');
  const texto = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const semAcento = (v) => texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  function deContrato(c, link) {
    return { fonte: 'Contrato (PNCP)', id: '', fornecedor: texto(c.nomeFornecedor), documento: soDigitos(c.cnpjFornecedor),
      orgao: texto(c.orgao), uf: texto(c.uf).toUpperCase(), data: texto(c.dataAssinatura).slice(0, 10), item: texto(c.objeto),
      unidade: '', valorUnitario: 0, valorTotal: numero(c.valor), link: link || null };
  }
  // Resultado guardado pelo robô: não traz o nome do órgão, só a unidade; fica fora do "quem compra".
  function deResultado(r, link) {
    const item = r.item || {}, forn = r.fornecedor || {}, res = r.resultado || {}, compra = r.compra || {};
    return { fonte: 'Resultado homologado (Compras.gov)', id: texto(item.id), fornecedor: texto(forn.nome), documento: soDigitos(forn.documento),
      orgao: '', uf: texto(compra.uf).toUpperCase(), data: texto(res.data).slice(0, 10), item: texto(item.descricao || item.descricaoResumida),
      unidade: texto(item.unidadeMedida).toUpperCase(), valorUnitario: numero(res.valorUnitarioHomologado),
      valorTotal: numero(res.valorTotalHomologado) || numero(res.valorUnitarioHomologado) * numero(res.quantidadeHomologada), link: link || null };
  }
  // Ata de registro de preço (tabela "mercado_atas"): cada vencedor de cada item vira uma venda.
  function deAta(ata, link) {
    return (ata.itens || []).flatMap((item) => (item.vencedores || []).map((v) => ({
      fonte: 'Ata de registro de preço (PNCP)', id: `${ata.numeroControlePNCPAta}|${item.numeroItem}`, fornecedor: texto(v.nome), documento: soDigitos(v.cnpj),
      orgao: texto(ata.orgao), uf: texto(ata.ufOrgao).toUpperCase(), data: texto(v.data || ata.dataAssinatura || ata.vigenciaInicio).slice(0, 10),
      item: texto(item.descricao), unidade: '', valorUnitario: numero(v.valorUnitario),
      valorTotal: numero(v.valorTotal) || numero(v.valorUnitario) * numero(v.quantidade), link: link || null })));
  }
  function dePrecoAoVivo(p) {
    return { fonte: 'Pesquisa de Preços (Compras.gov)', id: texto(p.itemCompra), fornecedor: texto(p.fornecedor), documento: soDigitos(p.documentoFornecedor),
      orgao: texto(p.orgao), uf: texto(p.uf).toUpperCase(), data: texto(p.dataResultado).slice(0, 10), item: texto(p.descricaoItem || p.produtoCatalogo),
      // "EMB" sozinho mistura caixa de 10 com caixa de 500: a capacidade (EMB 500 FL) separa os preços comparáveis.
      unidade: texto([p.unidade, p.embalagem].filter(Boolean).join(' ')).toUpperCase(), valorUnitario: numero(p.valorUnitario), valorTotal: numero(p.valorUnitario) * (numero(p.quantidade) || 1), link: p.link || null };
  }

  // O mesmo item do Compras.gov pode vir da base guardada e da consulta ao vivo: o id do item da compra une os dois.
  // Sem data (fonte não informou) a venda entra mesmo fora do período, como no restante do painel.
  function juntar(listas, desdeIso) {
    const vistos = new Set();
    const saida = [];
    for (const v of listas.flat()) {
      if (desdeIso && v.data && v.data < desdeIso) continue;
      const chave = v.id ? `${v.id}|${v.documento}` : '';
      if (chave && vistos.has(chave)) continue;
      if (chave) vistos.add(chave);
      saida.push(v);
    }
    return saida;
  }

  // Quem ganha: cada contrato ou item homologado é uma vitória. Ordena por vitórias e, no empate, por valor.
  function quemGanha(vendas) {
    const mapa = new Map();
    for (const v of vendas) {
      const chave = v.documento || semAcento(v.fornecedor);
      if (!chave) continue;
      const f = mapa.get(chave) || { fornecedor: v.fornecedor || v.documento, documento: v.documento, vitorias: 0, valor: 0 };
      f.vitorias += 1;
      f.valor += v.valorTotal;
      mapa.set(chave, f);
    }
    return [...mapa.values()].sort((a, b) => b.vitorias - a.vitorias || b.valor - a.valor).slice(0, TOPO);
  }

  // Quem compra: órgãos pelo valor total comprado no período.
  function quemCompra(vendas) {
    const mapa = new Map();
    for (const v of vendas) {
      if (!v.orgao) continue;
      const chave = semAcento(v.orgao);
      const o = mapa.get(chave) || { orgao: v.orgao, uf: v.uf, compras: 0, valor: 0 };
      o.compras += 1;
      o.valor += v.valorTotal;
      mapa.set(chave, o);
    }
    return [...mapa.values()].sort((a, b) => b.valor - a.valor || b.compras - a.compras).slice(0, TOPO);
  }

  // Quanto se paga: agrupa pelo começo da descrição + unidade (descrições do mesmo produto variam no fim).
  // O link é o da compra com o MENOR preço, que é o que o licitante quer conferir primeiro.
  function quantoSePaga(vendas) {
    const mapa = new Map();
    for (const v of vendas) {
      if (!v.valorUnitario || !v.item) continue;
      const chave = `${semAcento(v.item).split(/[,;:(]/)[0].slice(0, 60).trim()}|${v.unidade}`;
      const g = mapa.get(chave) || { item: v.item.split(/[,;:(]/)[0].slice(0, 90).trim(), unidade: v.unidade, compras: 0, soma: 0, menor: Infinity, maior: 0, linkMenor: null };
      g.compras += 1;
      g.soma += v.valorUnitario;
      if (v.valorUnitario < g.menor) { g.menor = v.valorUnitario; g.linkMenor = v.link; }
      if (v.valorUnitario > g.maior) g.maior = v.valorUnitario;
      mapa.set(chave, g);
    }
    return [...mapa.values()].sort((a, b) => b.compras - a.compras)
      .slice(0, TOPO_PRECOS).map(({ soma, ...g }) => ({ ...g, medio: soma / g.compras }));
  }

  // Compras por mês, em ordem cronológica: do primeiro ao último mês com compra (no máximo 12), com os meses
  // sem compra no meio valendo zero — senão o gráfico junta Out e Nov como se fossem vizinhos de Jun.
  function porMes(vendas) {
    const mapa = new Map();
    for (const v of vendas) {
      if (!/^\d{4}-\d{2}/.test(v.data)) continue;
      const chave = v.data.slice(0, 7);
      const m = mapa.get(chave) || { chave, compras: 0, valor: 0 };
      m.compras += 1;
      m.valor += v.valorTotal;
      mapa.set(chave, m);
    }
    const chaves = [...mapa.keys()].sort();
    if (!chaves.length) return [];
    const [ultAno, ultMes] = chaves.at(-1).split('-').map(Number);
    const saida = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(ultAno, ultMes - 1 - i, 1));
      const chave = d.toISOString().slice(0, 7);
      if (chave < chaves[0]) continue;
      saida.push({ ...(mapa.get(chave) || { chave, compras: 0, valor: 0 }), rotulo: `${MESES[d.getUTCMonth()]}/${chave.slice(2, 4)}` });
    }
    return saida;
  }

  function resumo(vendas) {
    return {
      compras: vendas.length,
      valor: vendas.reduce((s, v) => s + v.valorTotal, 0),
      fornecedores: new Set(vendas.map((v) => v.documento || semAcento(v.fornecedor)).filter(Boolean)).size,
      orgaos: new Set(vendas.map((v) => semAcento(v.orgao)).filter(Boolean)).size,
    };
  }

  const api = { deContrato, deResultado, deAta, dePrecoAoVivo, juntar, quemGanha, quemCompra, quantoSePaga, porMes, resumo };
  global.MercadoPesquisa = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
