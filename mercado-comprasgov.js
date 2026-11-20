/* global module, URLSearchParams, URL, Blob, setTimeout */
// "Buscar no mercado (Compras.gov)": produtos já licitados com marca declarada, preço homologado, órgão e data.
// Fonte: /api/comprasgov-marcas-produto (Catálogo CATMAT + Pesquisa de Preços, dados abertos, sem login).
// Usado no Catálogo de produtos (operacao.html, "Adicionar ao catálogo") e no preço por item (sistema.html, "Usar esta marca").
// O preço daqui é REFERÊNCIA do que o governo pagou; nunca é o custo do fornecedor do usuário.
(function (global) {
  'use strict';
  const MOSTRAR = 40;
  const MARCAS_INICIAIS = 10;

  // Descrição de edital é longa ("CANETA ESFEROGRÁFICA, MATERIAL: PLÁSTICO, ..."): o catálogo público acha pelo nome curto.
  function termoDoItem(descricao) {
    // Código do órgão na frente ("(ID126662) FONTE, ..."): sem tirar, o termo saía vazio e a busca não rodava.
    const limpo = String(descricao ?? '').replace(/^(\s*[([][^)\]\n]{0,40}[)\]])+/, '');
    const primeiro = limpo.split(/[,;:(\n–]| - /)[0].replace(/\s+/g, ' ').trim();
    return primeiro.split(' ').slice(0, 6).join(' ').slice(0, 100);
  }

  // Centavos inteiros (o servidor já converteu sem float). Média e mediana arredondam meio centavo para cima, em BigInt.
  function resumoPrecos(itens) {
    const v = (itens || []).map((i) => i.valorUnitarioCentavos).filter((c) => Number.isSafeInteger(c) && c > 0).sort((a, b) => a - b);
    if (!v.length) return { quantidade: 0, minimo: null, mediana: null, media: null, maximo: null };
    const n = BigInt(v.length), soma = v.reduce((s, c) => s + BigInt(c), 0n);
    const meio = v.length >> 1;
    const mediana = v.length % 2 ? v[meio] : Number((BigInt(v[meio - 1]) + BigInt(v[meio]) + 1n) / 2n);
    return { quantidade: v.length, minimo: v[0], mediana, media: Number((soma * 2n + n) / (2n * n)), maximo: v[v.length - 1] };
  }

  const contar = (itens, chave) => {
    const m = new Map();
    for (const i of itens) if (i[chave]) m.set(i[chave], (m.get(i[chave]) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR'));
  };
  // Marca agrupada sem diferença de maiúscula, acento, espaço ou barra ("bic" = "BIC" = "Bic "); exibe em maiúsculas.
  // Compra sem marca aproveitável (o servidor descartou "sm", "Conforme TR"…) fica no grupo SEM_MARCA, nunca some.
  const SEM_MARCA = '-';
  const chaveMarca = (m) => String(m || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+&]+/g, ' ').trim() || SEM_MARCA;
  function marcasDe(itens) {
    const grupos = new Map();
    for (const i of itens) {
      const k = chaveMarca(i.marca);
      const g = grupos.get(k) || { chave: k, grafias: new Map(), quantidade: 0 };
      g.quantidade += 1; g.grafias.set(i.marca, (g.grafias.get(i.marca) || 0) + 1); grupos.set(k, g);
    }
    const nome = (g) => (g.chave === SEM_MARCA ? 'Marca não informada' : String([...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0]).trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR'));
    return [...grupos.values()].map((g) => ({ chave: g.chave, nome: nome(g), quantidade: g.quantidade }))
      .sort((a, b) => (a.chave === SEM_MARCA) - (b.chave === SEM_MARCA) || b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  // Filtros em cascata: produto do catálogo > unidade > marca. Preço só se compara dentro da mesma unidade (UN ≠ CX).
  function filtrar(itens, { produto = '', unidade = '', marca = '' } = {}) {
    return (itens || []).filter((i) => (!produto || String(i.codigoPdm) === String(produto)) && (!unidade || i.unidade === unidade) && (!marca || chaveMarca(i.marca) === marca));
  }
  // O servidor marca cada compra: especificacao false = a descrição não tem o atributo do termo (A4, 500 ml, azul).
  // Havendo compras que conferem, só elas entram nas contas; as demais ficam recolhidas. Nenhuma confere: valem todas.
  function porEspecificacao(itens) {
    const confere = itens.filter((i) => i.especificacao !== false), diferente = itens.filter((i) => i.especificacao === false);
    return confere.length ? { base: confere, diferente } : { base: itens, diferente: [] };
  }
  // Fora da curva: mais de 3× a mediana ou menos de um terço dela (R$ 45 numa caneta de R$ 0,81). Só marca, não tira.
  function foraDaCurva(centavos, mediana) {
    if (!Number.isSafeInteger(centavos) || !Number.isSafeInteger(mediana) || centavos <= 0 || mediana <= 0) return null;
    const c = BigInt(centavos), m = BigInt(mediana);
    if (c > 3n * m) return 'acima';
    return 3n * c < m ? 'abaixo' : null;
  }
  const medianasPorUnidade = (itens) => new Map(contar(itens, 'unidade').map(([u]) => [u, resumoPrecos(filtrar(itens, { unidade: u })).mediana]));
  // Uma linha por marca: vitórias, mediana na unidade em que a marca mais vendeu, faixa, últimos órgãos e data.
  function resumoMarcas(itens) {
    return marcasDe(itens).map((m) => {
      const daMarca = filtrar(itens, { marca: m.chave }).sort((a, b) => String(b.dataResultado).localeCompare(String(a.dataResultado)));
      const unidade = contar(daMarca, 'unidade')[0]?.[0] || '';
      const naUnidade = unidade ? filtrar(daMarca, { unidade }) : daMarca;
      const locais = [...new Set(daMarca.map((i) => [i.orgao, i.uf].filter(Boolean).join('/')).filter(Boolean))].slice(0, 2);
      return { ...m, unidade, resumo: resumoPrecos(naUnidade), locais, ultimaData: daMarca[0]?.dataResultado || '', representante: naUnidade[0] || daMarca[0] };
    });
  }

  const reais = (c) => (c === null || c === undefined ? null : `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`);
  function brl(c) {
    if (c === null || c === undefined) return '—';
    const [i, f] = reais(c).split('.');
    return `R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${f}`;
  }
  const dataBr = (d) => (/^(\d{4})-(\d{2})-(\d{2})/.test(d || '') ? d.slice(0, 10).split('-').reverse().join('/') : '—');

  // Rascunho de produto do catálogo a partir de um resultado + resumo do filtro em tela (mediana = preço de referência).
  // Data local (Brasília à noite já é amanhã em UTC; toISOString gravaria o dia errado).
  const hojeLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function produtoParaCatalogo(item, resumo, hoje = hojeLocal()) {
    const ref = resumo && resumo.mediana ? reais(resumo.mediana) : null;
    return {
      nome: String(item.produtoCatalogo || item.descricaoItem || '').slice(0, 300),
      descricao: String(item.descricaoItem || '').slice(0, 5000) || null,
      marca: item.marca ? String(item.marca).slice(0, 200) : null,
      modelo: item.modelo ? String(item.modelo).slice(0, 200) : null,
      fabricante: item.fabricante ? String(item.fabricante).slice(0, 500) : null,
      unidade: (item.unidadeNome || item.unidade) ? String(item.unidadeNome || item.unidade).slice(0, 100) : null,
      preco_referencia: ref,
      referencia_fonte: ref ? `Compras.gov (Pesquisa de Preços): mediana de ${resumo.quantidade} compra(s)${item.unidade ? ` por ${item.unidade}` : ''}${resumo.marca ? `, marca ${resumo.marca}` : ''}` : null,
      referencia_em: ref ? hoje : null,
    };
  }

  // A fonte tem um campo só de marca ("VAIO FE16", "THINKPAD P16V GEN2"). Com número depois da 1ª palavra, o resto é
  // modelo; sem número ("Melitta do Brasil", "REPORT / SUZANO") é tudo marca. Modelo rotulado pela fonte prevalece.
  function marcaModelo(item) {
    if (!item || !item.marca || item.modelo) return item;
    const marca = String(item.marca).trim().replace(/\s+/g, ' ');
    const [primeira, ...resto] = marca.split(' ');
    if (!resto.length || marca.includes('/') || !/\d/.test(resto.join(' '))) return item;
    return { ...item, marca: primeira, modelo: resto.join(' ').slice(0, 60) };
  }
  // Período em meses contado de hoje (data local), esfera F/E/M e faixa de quantidade. Vazio = sem filtro.
  function filtrarCompras(itens, { meses = '', esfera = '', qtdMin = '', qtdMax = '' } = {}, hoje = hojeLocal()) {
    let corte = '';
    if (Number(meses) > 0) {
      const [a, m, d] = hoje.split('-').map(Number);
      const alvo = new Date(a, m - 1 - Number(meses), d);
      corte = hojeLocal(alvo);
    }
    const min = qtdMin === '' ? null : Number(qtdMin), max = qtdMax === '' ? null : Number(qtdMax);
    return (itens || []).filter((i) => (!corte || String(i.dataResultado || '') >= corte) && (!esfera || i.esfera === esfera)
      && (min === null || !Number.isFinite(min) || (Number(i.quantidade) || 0) >= min) && (max === null || !Number.isFinite(max) || (Number(i.quantidade) || 0) <= max));
  }
  // Agrupa por uma chave e resume preço (unidade dominante do grupo) e último preço. Base das tabelas de modelo e vencedor.
  function agrupar(itens, chave, nome) {
    const grupos = new Map();
    for (const i of itens) { const k = chave(i); if (!k) continue; (grupos.get(k) || grupos.set(k, []).get(k)).push(i); }
    return [...grupos.entries()].map(([k, lista]) => {
      lista.sort((a, b) => String(b.dataResultado).localeCompare(String(a.dataResultado)));
      const unidade = contar(lista, 'unidade')[0]?.[0] || '';
      return { chave: k, nome: nome(lista[0]), quantidade: lista.length, unidade, resumo: resumoPrecos(unidade ? filtrar(lista, { unidade }) : lista), ultimo: lista[0], itens: lista };
    }).sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  const resumoModelos = (itens) => agrupar(itens.filter((i) => i.marca && i.modelo), (i) => `${chaveMarca(i.marca)}|${chaveMarca(i.modelo)}`, (i) => `${String(i.marca).toLocaleUpperCase('pt-BR')} ${i.modelo}`);
  // Vencedor = fornecedor que ganhou o item (a Pesquisa de Preços só traz preço homologado). CNPJ junta grafias do nome.
  const resumoFornecedores = (itens) => agrupar(itens, (i) => String(i.documentoFornecedor || i.fornecedor || '').replace(/\D/g, '') || String(i.fornecedor || '').trim(), (i) => i.fornecedor || i.documentoFornecedor || 'Não informado')
    .map((g) => ({ ...g, marcas: marcasDe(g.itens).filter((m) => m.chave !== SEM_MARCA).slice(0, 3).map((m) => m.nome) }));
  const cnpj = (d) => (/^\d{14}$/.test(String(d || '')) ? String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(d || ''));
  // Total da compra em centavos sem float: quantidade inteira vai em BigInt; fracionária (kg, litro) arredonda o produto.
  function totalCentavos(i) {
    const c = i.valorUnitarioCentavos, q = Number(i.quantidade);
    if (!Number.isSafeInteger(c) || !(q > 0)) return null;
    const t = Number.isInteger(q) ? BigInt(c) * BigInt(q) : BigInt(Math.round(c * q));
    return t <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(t) : null;
  }
  const ESFERAS = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };
  // Célula de texto que começa com = + - @ vira texto no Excel (injeção de fórmula).
  const celulaSegura = (v) => { const t = v === null || v === undefined ? '' : String(v); return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; };
  // Planilha das compras na tela: valores em reais como número (Excel soma), vindo de centavos inteiros.
  function linhasPlanilha(itens) {
    const reaisNum = (c) => (c === null || c === undefined ? '' : Number(reais(c)));
    return [['Data', 'Órgão', 'UF', 'Município', 'Esfera', 'Produto do catálogo', 'Descrição', 'Marca', 'Modelo', 'Fornecedor vencedor', 'CNPJ', 'Quantidade', 'Unidade', 'Valor unitário (R$)', 'Valor total (R$)', 'Link da compra'],
      ...(itens || []).map((i) => [dataBr(i.dataResultado), i.orgao, i.uf, i.municipio, ESFERAS[i.esfera] || '', i.produtoCatalogo, i.descricaoItem, i.marca, i.modelo, i.fornecedor, cnpj(i.documentoFornecedor),
        Number(i.quantidade) || '', i.unidadeNome || i.unidade, reaisNum(i.valorUnitarioCentavos), reaisNum(totalCentavos(i)), i.link].map((c) => (typeof c === 'number' ? c : celulaSegura(c))))];
  }

  // Zero compras com consulta que falhou não é "nenhuma compra": a fonte não respondeu (visto no E2E de 19/11/2026).
  function mensagemBusca(total, comMarca, falhas) {
    if (total) return `${total} compra(s) encontradas, ${comMarca} com marca declarada.${falhas ? ' Parte da fonte não respondeu: resultado parcial.' : ''}`;
    return falhas ? 'A fonte pública não respondeu agora. Tente de novo em instantes.' : 'Nenhuma compra para este termo. Tente um nome mais curto (ex.: "detergente").';
  }

  const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
  // Páginas de 200 compras carregadas sozinhas ao escolher o produto (a fonte devolve da mais recente para a mais antiga).
  const PAGINAS_INICIAIS = 3;
  const milhar = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Uma caixa de busca: termo -> produtos do catálogo (chips, o mais provável já escolhido) -> marcas, modelos,
  // vencedores e compras. alvo: elemento vazio. aoUsar(item, resumo) recebe o resultado escolhido e o resumo do filtro atual.
  function montar({ alvo, doc = global.document, requisitar = (...a) => global.fetch(...a), termo = '', rotuloUsar = 'Usar', aoUsar, hoje = hojeLocal }) {
    const estado = { termo: '', uf: '', catalogos: [], pdm: '', porPdm: new Map(), atributos: [], cartoes: [], mostrar: MOSTRAR,
      filtro: { unidade: '', marca: '', meses: '', esfera: '', qtdMin: '', qtdMax: '' }, buscando: false, geracao: 0, falhas: 0 };
    Object.defineProperty(estado, 'itens', { get: () => estado.porPdm.get(estado.pdm)?.itens || [] });
    const h = (tag, attrs = {}, ...filhos) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, v === true ? '' : String(v)); }
      e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
      return e;
    };
    const id = `mercado-${Math.random().toString(36).slice(2, 8)}`;
    const campo = h('input', { type: 'search', id: `${id}-termo`, maxlength: 100, autocomplete: 'off', placeholder: 'Ex.: notebook, papel A4, cadeira giratória, café, pneu' });
    campo.value = termo;
    const botao = h('button', { type: 'submit', classe: 'btn primario', texto: 'Buscar' });
    const status = h('p', { classe: 'nota', role: 'status', 'aria-live': 'polite' });
    const chipsEl = h('div', { classe: 'mercado-chips', role: 'group', 'aria-label': 'Produto do catálogo', hidden: true });
    const filtros = h('div', { classe: 'mercado-filtros', hidden: true });
    const resumoEl = h('div', { classe: 'mercado-resumo', 'aria-live': 'polite' });
    const marcasEl = h('div', { classe: 'mercado-marcas-caixa' });
    const lista = h('div', { classe: 'mercado-compras' });
    const form = h('form', { classe: 'mercado-busca', role: 'search' }, h('label', { for: campo.id, texto: 'Produto' }), h('div', { classe: 'mercado-linha' }, campo, botao));
    alvo.replaceChildren(form, status, chipsEl, filtros, resumoEl, marcasEl, lista,
      h('p', { classe: 'nota', texto: 'Fonte: Pesquisa de Preços e Catálogo do Compras.gov (dados abertos): compras homologadas no Compras.gov, principalmente de órgãos federais e dos estaduais e municipais que usam o sistema. Preço homologado pago pelo órgão: serve de referência, não é o seu custo. Marca e modelo são o que o fornecedor vencedor declarou.' }));

    const pdmAtual = () => estado.catalogos.find((c) => String(c.codigo) === estado.pdm);
    const unidadePrincipal = () => contar(porEspecificacao(estado.itens).base, 'unidade')[0]?.[0] || '';
    function select(nome, rotulo, opcoes) {
      const s = h('select', { id: `${id}-${nome}`, 'data-filtro': nome });
      const atual = nome === 'uf' ? estado.uf : estado.filtro[nome];
      for (const [valor, texto] of opcoes) { const o = h('option', { value: valor, texto }); if (valor === atual) o.selected = true; s.append(o); }
      return h('div', { classe: 'mercado-campo' }, h('label', { for: s.id, texto: rotulo }), s);
    }
    function numero(nome, rotulo) {
      const e = h('input', { id: `${id}-${nome}`, type: 'number', min: 0, inputmode: 'numeric', 'data-filtro': nome });
      e.value = estado.filtro[nome];
      return h('div', { classe: 'mercado-campo' }, h('label', { for: e.id, texto: rotulo }), e);
    }
    const td = (rotulo, ...filhos) => h('td', { 'data-rotulo': rotulo }, ...filhos);
    const tabela = (classe, cabecalho, linhas) => h('div', { classe: 'mercado-tabela' }, h('table', { classe: `mercado-marcas ${classe}`.trim() },
      h('thead', {}, h('tr', {}, ...cabecalho.map((t) => h('th', { scope: 'col', texto: t })))), h('tbody', {}, ...linhas)));
    const marcaTexto = (i) => (i.marca ? [String(i.marca).toLocaleUpperCase('pt-BR'), i.modelo].filter(Boolean).join(' · ') : 'Marca não informada');
    const vencedorTexto = (i) => [i.fornecedor || 'Não informado', i.documentoFornecedor ? cnpj(i.documentoFornecedor) : ''].filter(Boolean).join(' · ');
    const ultimoTexto = (i) => (i ? `${brl(i.valorUnitarioCentavos)} em ${dataBr(i.dataResultado)}` : '—');

    // Uma compra: quem ganhou, onde, quando, quanto. mediana = da unidade da compra, para o selo "fora da curva" (null nas recolhidas).
    function linhaCompra(i, mediana) {
      const k = estado.cartoes.push(i) - 1;
      const curva = foraDaCurva(i.valorUnitarioCentavos, mediana);
      const total = totalCentavos(i);
      return h('tr', {},
        // Link na célula da data: sem coluna só para ele, a tabela cabe nos 1280 px do painel.
        td('Data', dataBr(i.dataResultado), i.link ? h('a', { classe: 'mercado-desc', href: i.link, target: '_blank', rel: 'noopener noreferrer', texto: 'Ver compra' }) : null),
        td('Órgão', `${i.orgao || 'Órgão não informado'}${i.uf ? `/${i.uf}` : ''}`, i.esfera ? h('span', { classe: 'mercado-desc', texto: ESFERAS[i.esfera] || i.esfera }) : null),
        td('Marca e modelo', h('strong', { texto: marcaTexto(i) }), h('span', { classe: 'mercado-desc', texto: String(i.descricaoItem || '').slice(0, 110) })),
        td('Vencedor', vencedorTexto(i)),
        td('Qtd.', `${i.quantidade ? milhar(i.quantidade) : '—'} ${i.unidade || ''}${i.embalagem ? ` (${i.embalagem})` : ''}`),
        td('Valor unitário', h('strong', { texto: brl(i.valorUnitarioCentavos) }), curva ? h('span', { classe: 'mercado-selo', texto: curva === 'acima' ? 'Fora da curva: mais de 3× a mediana' : 'Fora da curva: menos de 1/3 da mediana' }) : null),
        td('Total', total === null ? '—' : brl(total)),
        typeof aoUsar === 'function' ? td('', i.marca ? h('button', { type: 'button', classe: 'btn', 'data-mercado-usar': String(k), texto: rotuloUsar }) : null) : null);
    }
    const tabelaCompras = (itens, medianas) => tabela('mercado-compras-tabela', ['Data', 'Órgão', 'Marca e modelo', 'Vencedor', 'Qtd.', 'Valor unitário', 'Total', ...(typeof aoUsar === 'function' ? [''] : [])],
      itens.map((i) => linhaCompra(i, medianas ? medianas.get(i.unidade) : null)));

    // Marcas (clique filtra; o botão usa a mediana da marca), modelos e empresas vencedoras das compras filtradas.
    function tabelasResumo(marcas, base) {
      const mostrar = estado.todasMarcas ? marcas : [...marcas.filter((m) => m.chave !== SEM_MARCA).slice(0, MARCAS_INICIAIS), ...marcas.filter((m) => m.chave === SEM_MARCA)];
      estado.marcas = marcas;
      const modelos = resumoModelos(base), vencedores = resumoFornecedores(base);
      const linhas = mostrar.map((m) => {
        const mods = modelos.filter((x) => x.chave.startsWith(`${m.chave}|`)).slice(0, 3).map((x) => x.itens[0].modelo);
        const venc = resumoFornecedores(filtrar(base, { marca: m.chave })).slice(0, 2).map((v) => `${v.nome} (${v.quantidade})`);
        return h('tr', { classe: m.chave === estado.filtro.marca ? 'ativa' : null },
          td('Marca', h('button', { type: 'button', classe: 'mercado-marca-nome', 'data-mercado-marca': m.chave, 'aria-pressed': String(m.chave === estado.filtro.marca), texto: m.nome })),
          td('Compras', String(m.quantidade)),
          td('Mediana', h('strong', { texto: brl(m.resumo.mediana) }), m.unidade ? ` / ${m.unidade}` : ''),
          td('Faixa', m.resumo.quantidade > 1 ? `${brl(m.resumo.minimo)} – ${brl(m.resumo.maximo)}` : '—'),
          td('Último preço', ultimoTexto(m.representante)),
          td('Modelos', mods.join('; ') || '—'),
          td('Quem ganhou', venc.join('; ') || '—'),
          typeof aoUsar !== 'function' ? null : td('', m.chave !== SEM_MARCA ? h('button', { type: 'button', classe: 'btn', 'data-mercado-marca-usar': String(marcas.indexOf(m)), texto: rotuloUsar }) : null));
      });
      const escondidas = marcas.length - mostrar.length;
      const blocos = [h('h3', { classe: 'mercado-subtitulo', texto: 'Marcas que ganharam' }),
        h('p', { classe: 'nota', texto: 'Ordenado pelo número de compras ganhas. Clique na marca para ver só as compras dela.' }),
        tabela('', ['Marca', 'Compras', 'Mediana', 'Faixa (mín–máx)', 'Último preço', 'Modelos', 'Quem ganhou (vitórias)', ...(typeof aoUsar === 'function' ? [''] : [])], linhas),
        escondidas > 0 || estado.todasMarcas ? h('button', { type: 'button', classe: 'btn', 'data-mercado-todas': '1', texto: estado.todasMarcas ? 'Mostrar só as principais' : `Ver todas as marcas (+${escondidas})` }) : null];
      if (modelos.length) blocos.push(h('h3', { classe: 'mercado-subtitulo', texto: 'Modelos mais vendidos' }),
        tabela('', ['Marca e modelo', 'Compras', 'Mediana', 'Último preço'], modelos.slice(0, 10).map((x) => h('tr', {},
          td('Marca e modelo', h('strong', { texto: x.nome })), td('Compras', String(x.quantidade)),
          td('Mediana', `${brl(x.resumo.mediana)}${x.unidade ? ` / ${x.unidade}` : ''}`), td('Último preço', ultimoTexto(x.ultimo))))));
      if (vencedores.length) blocos.push(h('h3', { classe: 'mercado-subtitulo', texto: 'Empresas vencedoras' }),
        tabela('', ['Empresa', 'Vitórias', 'Marcas', 'Mediana', 'Última vitória'], vencedores.slice(0, 10).map((v) => h('tr', {},
          td('Empresa', h('strong', { texto: v.nome }), v.ultimo.documentoFornecedor ? h('span', { classe: 'mercado-desc', texto: cnpj(v.ultimo.documentoFornecedor) }) : null),
          td('Vitórias', String(v.quantidade)), td('Marcas', v.marcas.join('; ') || '—'),
          td('Mediana', `${brl(v.resumo.mediana)}${v.unidade ? ` / ${v.unidade}` : ''}`),
          td('Última vitória', `${dataBr(v.ultimo.dataResultado)} · ${v.ultimo.orgao || ''}${v.ultimo.uf ? `/${v.ultimo.uf}` : ''}`)))));
      return blocos.filter(Boolean);
    }

    function desenharChips() {
      chipsEl.hidden = !estado.catalogos.length;
      chipsEl.replaceChildren(h('span', { classe: 'mercado-chips-rotulo', texto: 'Produto do catálogo (nº de compras):' }), ...estado.catalogos.map((c) => h('button', {
        type: 'button', classe: 'mercado-chip', 'data-mercado-pdm': String(c.codigo), 'aria-pressed': String(String(c.codigo) === estado.pdm),
        texto: `${c.descricao}${Number.isSafeInteger(c.total) ? ` · ${milhar(c.total)}` : ''}` })));
    }
    function desenharResumo(grupo, base, diferente, visiveis, unidades, marcas, medianas) {
      const r = resumoPrecos(visiveis);
      const marcaNome = estado.filtro.marca && estado.filtro.marca !== SEM_MARCA ? marcas.find((m) => m.chave === estado.filtro.marca)?.nome : '';
      estado.resumo = { ...r, marca: marcaNome || '' };
      const pdm = pdmAtual();
      const datas = estado.itens.map((i) => i.dataResultado).filter(Boolean).sort();
      resumoEl.append(h('p', { classe: 'nota', texto: `${milhar(estado.itens.length)} compra(s) mais recentes carregadas${pdm && Number.isSafeInteger(pdm.total) ? ` de ${milhar(pdm.total)} no Compras.gov` : ''}${estado.uf ? ` em ${estado.uf}` : ''}${datas.length ? `, de ${dataBr(datas[0])} a ${dataBr(datas.at(-1))}` : ''}.` }));
      const atributos = estado.atributos.join(', ');
      if (atributos) resumoEl.append(h('p', { classe: 'nota mercado-especificacao', texto: diferente.length || base.some((i) => i.especificacao)
        ? `Especificação do termo: ${atributos}. Contas e marcas usam só as compras cuja descrição tem isso; ${diferente.length} com especificação diferente estão recolhidas no fim.`
        : `Nenhuma compra traz "${atributos}" na descrição: as contas usam todas. Confira a especificação antes de usar o preço.` }));
      resumoEl.append(h('p', { texto: r.quantidade ? `${r.quantidade} compra(s)${estado.filtro.unidade ? ` por ${estado.filtro.unidade}` : ''}${marcaNome ? ` da marca ${marcaNome}` : ''}:` : 'Nenhuma compra com estes filtros.' }));
      if (r.quantidade) resumoEl.append(h('dl', { classe: 'mercado-numeros' }, ...[['Mediana (referência)', r.mediana, 'destaque'], ['Mínimo', r.minimo], ['Máximo', r.maximo], ['Média', r.media], ['Último preço', visiveis[0]?.valorUnitarioCentavos]]
        .map(([t, c, classe]) => h('div', { classe }, h('dt', { texto: t }), h('dd', { texto: brl(c) })))));
      const fora = visiveis.filter((i) => foraDaCurva(i.valorUnitarioCentavos, medianas.get(i.unidade))).length;
      if (fora) resumoEl.append(h('p', { classe: 'nota', texto: `${fora} compra(s) fora da curva (mais de 3× ou menos de 1/3 da mediana) estão marcadas na lista e distorcem a média: use a mediana.` }));
      if (!estado.filtro.unidade && unidades.length > 1) resumoEl.append(h('p', { classe: 'nota', texto: 'Há unidades diferentes (unidade, caixa, pacote…). Escolha uma unidade para comparar preço com preço.' }));
    }
    function desenhar() {
      desenharChips();
      const grupo = estado.porPdm.get(estado.pdm);
      const { base: baseEsp, diferente: difEsp } = porEspecificacao(filtrarCompras(estado.itens, estado.filtro, hoje()));
      const base = filtrar(baseEsp, { unidade: estado.filtro.unidade }), diferente = filtrar(difEsp, { unidade: estado.filtro.unidade });
      const visiveis = filtrar(base, { marca: estado.filtro.marca });
      const recolhidas = filtrar(diferente, { marca: estado.filtro.marca });
      const unidades = contar(baseEsp, 'unidade').map(([u, n]) => [u, `${u} (${n})`]);
      const marcas = resumoMarcas(base);
      const medianas = medianasPorUnidade(base);
      estado.visiveis = visiveis;
      filtros.hidden = !estado.catalogos.length;
      filtros.replaceChildren(
        select('uf', 'UF', [['', 'Todas'], ...UFS.map((u) => [u, u])]),
        select('meses', 'Período', [['', 'Tudo'], ['12', 'Últimos 12 meses'], ['24', 'Últimos 24 meses']]),
        select('esfera', 'Esfera', [['', 'Todas'], ['F', 'Federal'], ['E', 'Estadual'], ['M', 'Municipal']]),
        select('unidade', 'Unidade', [['', 'Todas'], ...unidades]),
        select('marca', 'Marca', [['', 'Todas as marcas'], ...marcas.map((m) => [m.chave, `${m.nome} (${m.quantidade})`])]),
        numero('qtdMin', 'Quantidade mínima'), numero('qtdMax', 'Quantidade máxima'));
      resumoEl.replaceChildren(); marcasEl.replaceChildren(); lista.replaceChildren(); estado.cartoes = [];
      if (!grupo) return;
      desenharResumo(grupo, base, diferente, visiveis, unidades, marcas, medianas);
      if (marcas.length) marcasEl.append(...tabelasResumo(marcas, base));
      lista.append(h('div', { classe: 'mercado-lista-topo' }, h('h3', { classe: 'mercado-subtitulo', texto: 'Compras: quem ganhou, onde e por quanto' }),
        visiveis.length ? h('button', { type: 'button', classe: 'btn', 'data-mercado-planilha': '1', texto: 'Baixar planilha (Excel)' }) : null));
      if (visiveis.length) lista.append(tabelaCompras(visiveis.slice(0, estado.mostrar), medianas));
      if (visiveis.length > estado.mostrar) lista.append(h('button', { type: 'button', classe: 'btn', 'data-mercado-mais-linhas': '1', texto: `Mostrar mais compras (${estado.mostrar} de ${visiveis.length})` }));
      if (grupo.paginas && grupo.carregadas < grupo.paginas && !grupo.carregando) lista.append(h('button', { type: 'button', classe: 'btn', 'data-mercado-mais': '1', texto: 'Buscar mais 200 compras antigas na fonte' }));
      if (recolhidas.length) lista.append(h('details', { classe: 'mercado-diferentes' }, h('summary', { texto: `Especificação diferente (${recolhidas.length}): descrição sem ${estado.atributos.join(', ')}` }),
        tabelaCompras(recolhidas.slice(0, MOSTRAR), null)));
    }

    // 200 compras de um produto por chamada (1 subrequisição na fonte). geracao: uma busca nova descarta respostas antigas.
    async function carregarPagina(codigo, geracao) {
      const grupo = estado.porPdm.get(codigo); const pdm = estado.catalogos.find((c) => String(c.codigo) === codigo);
      if (!grupo || grupo.carregando || (grupo.paginas && grupo.carregadas >= grupo.paginas)) return false;
      grupo.carregando = true;
      try {
        const q = new URLSearchParams({ termo: estado.termo, codigoPdm: codigo, pagina: String(grupo.carregadas + 1), produto: pdm?.descricao || '' });
        if (estado.uf) q.set('uf', estado.uf);
        const r = await requisitar(`/api/comprasgov-marcas-produto?${q}`, { method: 'GET' });
        const j = await r.json().catch(() => null);
        if (geracao !== estado.geracao) return false;
        if (!r.ok || !j?.ok) throw new Error(j?.erro || 'A fonte pública não respondeu agora.');
        const novos = (Array.isArray(j.itens) ? j.itens.filter(Boolean) : []).map(marcaModelo);
        // A 1ª página troca a amostra da busca inicial (as mesmas compras mais recentes, agora 200).
        grupo.itens = grupo.carregadas ? [...grupo.itens, ...novos] : novos;
        grupo.carregadas += 1; grupo.paginas = j.paginas || grupo.carregadas;
        return novos.length > 0;
      } catch {
        if (geracao === estado.geracao) estado.falhas += 1;
        return false;
      } finally { grupo.carregando = false; }
    }
    async function carregarProduto(codigo, paginas = PAGINAS_INICIAIS) {
      const geracao = estado.geracao;
      for (let k = 0; k < paginas; k += 1) {
        status.textContent = `Carregando compras de ${pdmAtual()?.descricao || 'produto'}… ${milhar(estado.itens.length)} até agora.`;
        desenhar();
        if (!(await carregarPagina(codigo, geracao)) || geracao !== estado.geracao || codigo !== estado.pdm) break;
      }
      if (geracao !== estado.geracao || codigo !== estado.pdm) return;
      if (!estado.filtro.unidade) estado.filtro.unidade = unidadePrincipal();
      status.textContent = mensagemBusca(estado.itens.length, estado.itens.filter((i) => i.marca).length, estado.falhas);
      desenhar();
    }
    function escolherProduto(codigo) {
      estado.pdm = String(codigo); estado.todasMarcas = false; estado.mostrar = MOSTRAR;
      estado.filtro = { ...estado.filtro, unidade: '', marca: '' };
      estado.filtro.unidade = unidadePrincipal();
      return carregarProduto(estado.pdm);
    }
    async function buscar(t) {
      const termoBusca = String(t || '').trim();
      if (termoBusca.length < 2) { status.textContent = 'Digite ao menos 2 letras do produto.'; return; }
      if (estado.buscando) return;
      estado.buscando = true; botao.disabled = true; estado.geracao += 1; status.textContent = 'Buscando no Compras.gov… pode levar alguns segundos.';
      try {
        const q = new URLSearchParams({ termo: termoBusca });
        if (estado.uf) q.set('uf', estado.uf);
        const r = await requisitar(`/api/comprasgov-marcas-produto?${q}`, { method: 'GET' });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.erro || 'A fonte pública não respondeu agora. Tente de novo em instantes.');
        const itens = (Array.isArray(j.itens) ? j.itens.filter(Boolean) : []).map(marcaModelo);
        // Resposta sem "catalogos": os produtos saem das próprias compras.
        const catalogos = Array.isArray(j.catalogos) && j.catalogos.length ? j.catalogos
          : contar(itens, 'codigoPdm').map(([c, n]) => ({ codigo: c, descricao: itens.find((i) => i.codigoPdm === c).produtoCatalogo, total: n }));
        estado.termo = termoBusca; estado.catalogos = catalogos; estado.falhas = j.consultasComFalha || 0;
        estado.atributos = Array.isArray(j.atributos) ? j.atributos.map(String) : [];
        estado.porPdm = new Map(catalogos.map((c) => [String(c.codigo), { itens: itens.filter((i) => String(i.codigoPdm) === String(c.codigo)), carregadas: 0, paginas: null }]));
        if (!catalogos.length) { estado.pdm = ''; status.textContent = mensagemBusca(0, 0, estado.falhas); desenhar(); return; }
        estado.buscando = false; botao.disabled = false;
        await escolherProduto(catalogos[0].codigo); // o servidor já põe primeiro o produto principal mais comprado
      } catch (e) {
        status.textContent = e.message || 'Não foi possível buscar agora.';
      } finally { estado.buscando = false; botao.disabled = false; }
    }
    function baixarPlanilha() {
      const linhas = linhasPlanilha(estado.visiveis || []);
      const nome = `licitaplena-precos-${String(estado.termo).normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase().slice(0, 40)}-${hoje()}`;
      if (global.XLSX) {
        const planilha = global.XLSX.utils.book_new(); const folha = global.XLSX.utils.aoa_to_sheet(linhas);
        folha['!cols'] = [11, 40, 4, 18, 10, 26, 60, 18, 22, 40, 20, 10, 12, 14, 14, 50].map((wch) => ({ wch }));
        global.XLSX.utils.book_append_sheet(planilha, folha, 'Compras'); global.XLSX.writeFile(planilha, `${nome}.xlsx`); return;
      }
      // Sem o SheetJS (catálogo, preço por item): CSV com BOM e ";" abre direto no Excel em pt-BR.
      const celula = (c) => { const t = typeof c === 'number' ? String(c).replace('.', ',') : String(c); return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const url = URL.createObjectURL(new Blob([`${String.fromCharCode(0xfeff)}${linhas.map((l) => l.map(celula).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(doc.createElement('a'), { href: url, download: `${nome}.csv` }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    form.addEventListener('submit', (ev) => { ev.preventDefault(); void buscar(campo.value); });
    chipsEl.addEventListener('click', (ev) => {
      const b = ev.target?.closest?.('[data-mercado-pdm]');
      if (b && b.dataset.mercadoPdm !== estado.pdm) void escolherProduto(b.dataset.mercadoPdm);
    });
    filtros.addEventListener('change', (ev) => {
      const nome = ev.target?.dataset?.filtro; if (!nome) return;
      // UF vai para a fonte: com o estado filtrado lá, as 600 compras carregadas alcançam datas mais antigas.
      if (nome === 'uf') { estado.uf = ev.target.value; void buscar(estado.termo); return; }
      estado.filtro[nome] = ev.target.value; estado.mostrar = MOSTRAR;
      if (nome === 'unidade') estado.filtro.marca = '';
      desenhar();
    });
    lista.addEventListener('click', (ev) => {
      if (ev.target?.closest?.('[data-mercado-planilha]')) { baixarPlanilha(); return; }
      if (ev.target?.closest?.('[data-mercado-mais-linhas]')) { estado.mostrar += MOSTRAR; desenhar(); return; }
      if (ev.target?.closest?.('[data-mercado-mais]')) { void carregarProduto(estado.pdm, 1); return; }
      const b = ev.target?.closest?.('[data-mercado-usar]'); if (!b) return;
      const item = estado.cartoes?.[Number(b.dataset.mercadoUsar)];
      if (item) aoUsar(item, estado.resumo);
    });
    marcasEl.addEventListener('click', (ev) => {
      const filtro = ev.target?.closest?.('[data-mercado-marca]');
      if (filtro) { estado.filtro.marca = estado.filtro.marca === filtro.dataset.mercadoMarca ? '' : filtro.dataset.mercadoMarca; desenhar(); return; }
      if (ev.target?.closest?.('[data-mercado-todas]')) { estado.todasMarcas = !estado.todasMarcas; desenhar(); return; }
      const usar = ev.target?.closest?.('[data-mercado-marca-usar]');
      const m = usar && estado.marcas?.[Number(usar.dataset.mercadoMarcaUsar)];
      // Linha da marca: a referência é a mediana da marca na unidade dela; modelo fica de fora (a marca vende vários).
      if (m) aoUsar({ ...m.representante, marca: m.nome, modelo: null }, { ...m.resumo, marca: m.nome });
    });
    return { buscar, campo, estado };
  }

  const api = { termoDoItem, mensagemBusca, resumoPrecos, marcasDe, filtrar, porEspecificacao, foraDaCurva, resumoMarcas, SEM_MARCA, produtoParaCatalogo, brl, montar,
    marcaModelo, filtrarCompras, resumoModelos, resumoFornecedores, totalCentavos, linhasPlanilha, reais, dataBr, cnpj };
  global.MercadoComprasGov = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
