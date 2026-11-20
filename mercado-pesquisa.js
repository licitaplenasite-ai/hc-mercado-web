/* global module */
// Inteligência de Mercado (painel.html, aba "Pesquisa de mercado"), no modelo do Siga Pregão: uma busca só e as mesmas
// 7 visões, na mesma ordem — Correspondências, Catálogo, Estados, Órgãos, Empresas, Marcas e Contratação futura (PCA). Junta quatro fontes já existentes:
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
      unidade: '', quantidade: 0, valorUnitario: 0, valorTotal: numero(c.valor), marca: '', catalogo: '', catalogoNome: '', link: link || null };
  }
  // Resultado guardado pelo robô: não traz o nome do órgão, só a unidade; fica fora do "quem compra".
  function deResultado(r, link) {
    const item = r.item || {}, forn = r.fornecedor || {}, res = r.resultado || {}, compra = r.compra || {};
    return { fonte: 'Resultado homologado (Compras.gov)', id: texto(item.id), fornecedor: texto(forn.nome), documento: soDigitos(forn.documento),
      orgao: '', uf: texto(compra.uf).toUpperCase(), data: texto(res.data).slice(0, 10), item: texto(item.descricao || item.descricaoResumida),
      unidade: texto(item.unidadeMedida).toUpperCase(), quantidade: numero(res.quantidadeHomologada), valorUnitario: numero(res.valorUnitarioHomologado),
      valorTotal: numero(res.valorTotalHomologado) || numero(res.valorUnitarioHomologado) * numero(res.quantidadeHomologada),
      marca: texto(item.marca), catalogo: soDigitos(item.catalogoCodigo), catalogoNome: '', link: link || null };
  }
  // Ata de registro de preço (tabela "mercado_atas"): cada vencedor de cada item vira uma venda.
  function deAta(ata, link) {
    return (ata.itens || []).flatMap((item) => (item.vencedores || []).map((v) => ({
      fonte: 'Ata de registro de preço (PNCP)', id: `${ata.numeroControlePNCPAta}|${item.numeroItem}`, fornecedor: texto(v.nome), documento: soDigitos(v.cnpj),
      orgao: texto(ata.orgao), uf: texto(ata.ufOrgao).toUpperCase(), data: texto(v.data || ata.dataAssinatura || ata.vigenciaInicio).slice(0, 10),
      item: texto(item.descricao), unidade: '', quantidade: numero(v.quantidade), valorUnitario: numero(v.valorUnitario),
      valorTotal: numero(v.valorTotal) || numero(v.valorUnitario) * numero(v.quantidade),
      marca: texto(v.marca), catalogo: soDigitos(item.catalogoCodigoItem), catalogoNome: '', link: link || null })));
  }
  function dePrecoAoVivo(p) {
    return { fonte: 'Pesquisa de Preços (Compras.gov)', id: texto(p.itemCompra), fornecedor: texto(p.fornecedor), documento: soDigitos(p.documentoFornecedor),
      orgao: texto(p.orgao), uf: texto(p.uf).toUpperCase(), data: texto(p.dataResultado).slice(0, 10), item: texto(p.descricaoItem || p.produtoCatalogo),
      // "EMB" sozinho mistura caixa de 10 com caixa de 500: a capacidade (EMB 500 FL) separa os preços comparáveis.
      unidade: texto([p.unidade, p.embalagem].filter(Boolean).join(' ')).toUpperCase(), quantidade: numero(p.quantidade), valorUnitario: numero(p.valorUnitario), valorTotal: numero(p.valorUnitario) * (numero(p.quantidade) || 1),
      marca: texto(p.marca), catalogo: soDigitos(p.catalogoCodigo), catalogoNome: texto(p.produtoCatalogo), link: p.link || null };
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
  // Participação = parte das vitórias com empresa identificada (o "market share" do Siga).
  function quemGanha(vendas, limite = TOPO) {
    const mapa = new Map();
    let total = 0;
    for (const v of vendas) {
      const chave = v.documento || semAcento(v.fornecedor);
      if (!chave) continue;
      total += 1;
      const f = mapa.get(chave) || { fornecedor: v.fornecedor || v.documento, documento: v.documento, vitorias: 0, valor: 0 };
      f.vitorias += 1;
      f.valor += v.valorTotal;
      mapa.set(chave, f);
    }
    return [...mapa.values()].sort((a, b) => b.vitorias - a.vitorias || b.valor - a.valor).slice(0, limite)
      .map((f) => ({ ...f, participacao: f.vitorias / total }));
  }

  // Quem compra: órgãos pelo valor total comprado no período, com quantas empresas venderam e a última compra.
  function quemCompra(vendas, limite = TOPO) {
    const mapa = new Map();
    for (const v of vendas) {
      if (!v.orgao) continue;
      const chave = semAcento(v.orgao);
      const o = mapa.get(chave) || { orgao: v.orgao, uf: v.uf, compras: 0, valor: 0, ultima: '', empresas: new Set() };
      o.compras += 1;
      o.valor += v.valorTotal;
      if (v.data > o.ultima) o.ultima = v.data;
      if (v.documento || v.fornecedor) o.empresas.add(v.documento || semAcento(v.fornecedor));
      mapa.set(chave, o);
    }
    return [...mapa.values()].sort((a, b) => b.valor - a.valor || b.compras - a.compras).slice(0, limite)
      .map(({ empresas, ...o }) => ({ ...o, empresas: empresas.size }));
  }

  // Correspondências: cada compra encontrada, da mais nova para a mais antiga. O filtro vem do clique no Catálogo
  // ({ campo: 'catalogo', valor: '461380' }) ou nas Marcas ({ campo: 'marca', valor: 'CHAMEX' }).
  function correspondencias(vendas, filtro) {
    const chave = filtro && semAcento(filtro.valor);
    return vendas.filter((v) => !filtro || semAcento(v[filtro.campo]) === chave)
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  }

  // Preço médio só na unidade mais comum do grupo: "papel A4" mistura folha, resma e caixa, e a média delas não diz nada.
  function precoNaUnidadeMaisComum(lista) {
    const unidades = new Map();
    for (const v of lista) {
      if (!v.valorUnitario) continue;
      const u = unidades.get(v.unidade) || { unidade: v.unidade, n: 0, soma: 0 };
      u.n += 1;
      u.soma += v.valorUnitario;
      unidades.set(v.unidade, u);
    }
    const u = [...unidades.values()].sort((a, b) => b.n - a.n)[0];
    return u ? { unidade: u.unidade, medio: u.soma / u.n } : { unidade: '', medio: 0 };
  }

  function agrupar(vendas, chaveDe) {
    const mapa = new Map();
    for (const v of vendas) {
      const chave = chaveDe(v);
      if (!chave) continue;
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(v);
    }
    return [...mapa.entries()];
  }
  const nomes = (lista, campo) => [...new Map(lista.filter((v) => v[campo]).map((v) => [semAcento(v[campo]), v[campo]])).values()];

  // Estados: compras, valor e preço médio (na unidade mais comum) por UF.
  function porEstado(vendas) {
    return agrupar(vendas, (v) => v.uf).map(([uf, lista]) => ({ uf, compras: lista.length, valor: lista.reduce((s, v) => s + v.valorTotal, 0), ...precoNaUnidadeMaisComum(lista) }))
      .sort((a, b) => b.valor - a.valor || b.compras - a.compras);
  }

  // Catálogo: códigos CATMAT/CATSER das compras, com nº de compras e preço médio. Contrato não traz código: fica fora.
  function porCatalogo(vendas) {
    return agrupar(vendas, (v) => v.catalogo).map(([codigo, lista]) => ({
      // A descrição do item diferencia os códigos (gramatura, cor, tipo); o nome do PDM é igual para todos ("Papel para impressão formatado").
      codigo, nome: lista[0].item.slice(0, 140) || lista.find((v) => v.catalogoNome)?.catalogoNome || '',
      compras: lista.length, ...precoNaUnidadeMaisComum(lista) })).sort((a, b) => b.compras - a.compras);
  }

  // Marcas: só as declaradas pela fonte (a Pesquisa de Preços e o robô já descartam "conforme edital", medidas etc.).
  // Vezes = itens ganhos com a marca; órgãos = quem aceitou a marca; empresas = quem vendeu.
  function porMarca(vendas) {
    return agrupar(vendas, (v) => semAcento(v.marca)).map(([, lista]) => {
      const orgaos = nomes(lista, 'orgao');
      return { marca: lista[0].marca, vezes: lista.length, valor: lista.reduce((s, v) => s + v.valorTotal, 0), ...precoNaUnidadeMaisComum(lista),
        orgaos: orgaos.length, orgaosNomes: orgaos.slice(0, 3), empresas: nomes(lista, 'fornecedor').length };
    }).sort((a, b) => b.vezes - a.vezes || b.valor - a.valor);
  }

  // Contratação futura: a busca do PCA usa uma palavra só (o banco procura texto corrido); aqui ficam só as linhas
  // que têm TODAS as palavras do termo ("papel" + "a4"), sem acento e sem diferença de maiúscula.
  function todasAsPalavras(linhas, termo, campos) {
    const palavras = semAcento(termo).split(/[^A-Z0-9]+/).filter((p) => p.length >= 2);
    return linhas.filter((l) => {
      const t = ` ${semAcento(campos.map((c) => l[c]).join(' ')).replace(/[^A-Z0-9]+/g, ' ')} `;
      // Palavra curta ("A4") tem de vir inteira (A40 é outra coisa); a longa aceita plural ("caneta" acha "canetas").
      return palavras.every((p) => t.includes(p.length < 4 ? ` ${p} ` : ` ${p}`));
    });
  }

  // Gráfico de barras horizontais (chave Tabela/Gráfico): os maiores primeiro, tamanho em % do maior.
  function barras(itens, rotuloDe, valorDe, limite = 20) {
    const lista = itens.map((i) => ({ rotulo: rotuloDe(i), valor: Number(valorDe(i)) || 0 })).filter((b) => b.valor > 0)
      .sort((a, b) => b.valor - a.valor).slice(0, limite);
    const maior = lista[0]?.valor || 1;
    return lista.map((b) => ({ ...b, pct: Math.max(1, Math.round((b.valor / maior) * 100)) }));
  }

  // Botão "G": busca no Google pela marca (ou empresa) + o produto, para achar o fabricante ou o contato.
  const linkGoogle = (nome, termo) => `https://www.google.com/search?q=${encodeURIComponent(texto(`${nome || ''} ${termo || ''}`))}`;

  // "Trazer mais" da Pesquisa de Preços: uma página (200 compras) por clique, do produto do catálogo mais comprado
  // para o seguinte. Depois de ler a página `pagina` (de `paginas`) do catálogo `indice`, devolve a próxima ou null.
  function proximaPagina(atual, paginas, totalCatalogos) {
    if (!atual) return null;
    if (paginas && atual.pagina < paginas) return { indice: atual.indice, pagina: atual.pagina + 1 };
    return atual.indice + 1 < totalCatalogos ? { indice: atual.indice + 1, pagina: 1 } : null;
  }

  // CSV para o Excel brasileiro: ponto e vírgula, aspas quando precisa, número com vírgula decimal.
  function paraCsv(cabecalho, linhas) {
    const celula = (v) => {
      const t = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    return [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
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

  const api = { deContrato, deResultado, deAta, dePrecoAoVivo, juntar, quemGanha, quemCompra, quantoSePaga, porMes, resumo,
    correspondencias, porEstado, porCatalogo, porMarca, todasAsPalavras, paraCsv, barras, linkGoogle, proximaPagina };
  global.MercadoPesquisa = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
