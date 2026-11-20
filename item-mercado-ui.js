/* global module, require, URLSearchParams */
// "Ver mercado deste item": atalho dentro de cada item do edital (painel) e do processo (CRM) com 4 abas,
// como o Siga Pregão faz no item do edital: Histórico, Concorrência, Marcas relevantes e Preços praticados.
// Dados: /api/comprasgov-marcas-produto (Pesquisa de Preços do Compras.gov). Com o CATMAT do item
// (catalogoCodigoItem do PNCP) é 1 chamada exata; sem ele, o termo da descrição (2 chamadas: catálogo + 200 compras).
// As contas (mediana, marcas, vencedores) são as de mercado-comprasgov.js; aqui só há a montagem das abas.
// Visual novo (20/11/2026): aguarda aprovação.
(function (global) {
  'use strict';
  const MC = global.MercadoComprasGov || (typeof require === 'function' ? require('./mercado-comprasgov.js') : null);
  const URL_API = '/api/comprasgov-marcas-produto';
  const CHAVE_ANALISAR = 'lp-analisar-cnpj';
  const LINHAS = 15;
  const ABAS = [['historico', 'Histórico'], ['concorrencia', 'Concorrência'], ['marcas', 'Marcas relevantes'], ['precos', 'Preços praticados']];

  // CATMAT só com dígitos (o PNCP manda texto, às vezes vazio); termo limpo da descrição ("(ID…)" sai).
  function consultaDoItem(item = {}) {
    const catmat = /^\d{1,12}$/.test(String(item.codigoCatalogo ?? '').trim()) ? String(item.codigoCatalogo).trim() : '';
    return { termo: MC.termoDoItem(item.descricao), catmat };
  }

  async function pedir(requisitar, q) {
    const r = await requisitar(`${URL_API}?${new URLSearchParams(q)}`, { method: 'GET' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.erro || 'A fonte pública não respondeu agora.');
    return j;
  }
  const comprasDe = (j) => (Array.isArray(j?.itens) ? j.itens.filter(Boolean) : []).map(MC.marcaModelo);

  // CATMAT primeiro (item exato); sem compras por ele, cai no termo. Nunca mais de 2 chamadas por clique.
  async function carregar(item, requisitar) {
    const { termo, catmat } = consultaDoItem(item);
    let erro = null;
    if (catmat) {
      try {
        const itens = comprasDe(await pedir(requisitar, { termo: termo.length >= 2 ? termo : 'item', codigoItem: catmat, produto: termo }));
        if (itens.length) return { itens, origem: 'catmat', catmat, termo };
      } catch (e) { erro = e; }
    }
    if (termo.length < 2) return { itens: [], origem: '', termo, erro: erro?.message || 'A descrição do item é curta demais para buscar.' };
    try {
      const j = await pedir(requisitar, { termo });
      const pdm = Array.isArray(j.catalogos) ? j.catalogos[0] : null;
      if (!pdm) return { itens: [], origem: 'termo', termo };
      const amostra = comprasDe(j).filter((i) => String(i.codigoPdm) === String(pdm.codigo));
      // Página de 200 compras do produto principal; falhando, fica a amostra da 1ª resposta.
      const pagina = await pedir(requisitar, { termo, codigoPdm: String(pdm.codigo), pagina: '1', produto: pdm.descricao || '' }).then(comprasDe).catch(() => null);
      return { itens: pagina?.length ? pagina : amostra, origem: 'termo', termo, produto: pdm.descricao || '', parcial: !pagina };
    } catch (e) {
      return { itens: [], origem: '', termo, erro: e.message };
    }
  }

  // Preço só se compara dentro da mesma unidade: a aba de preços usa a unidade mais comprada.
  function abas(itens) {
    const base = MC.porEspecificacao(itens || []).base;
    const historico = [...base].sort((a, b) => String(b.dataResultado).localeCompare(String(a.dataResultado)));
    const contagem = new Map();
    for (const i of base) if (i.unidade) contagem.set(i.unidade, (contagem.get(i.unidade) || 0) + 1);
    const unidades = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    const unidade = unidades[0]?.[0] || '';
    const naUnidade = unidade ? MC.filtrar(historico, { unidade }) : historico;
    const resumo = MC.resumoPrecos(naUnidade);
    return { historico, concorrencia: MC.resumoFornecedores(base), marcas: MC.resumoMarcas(base),
      precos: { unidade, unidades: unidades.length, resumo, ultimo: naUnidade[0] || null,
        foraDaCurva: naUnidade.filter((i) => MC.foraDaCurva(i.valorUnitarioCentavos, resumo.mediana)).length } };
  }

  // Leva para "Analisar concorrente" do painel; em outra página, guarda o CNPJ e abre o painel nessa tela.
  function analisarConcorrente(doc, cnpj, origem) {
    if (!/^\d{14}$/.test(cnpj)) return;
    const campo = doc.getElementById('emp-cnpj');
    if (campo) {
      origem?.closest?.('.modal-ia-fundo.aberto')?.querySelector('#modal-ia-fechar')?.click();
      doc.querySelector('nav button[data-alvo="empresa"]')?.click();
      campo.value = cnpj;
      doc.getElementById('emp-buscar')?.click();
      return;
    }
    try { global.sessionStorage.setItem(CHAVE_ANALISAR, cnpj); } catch { /* sem storage: abre a tela vazia */ }
    global.location.href = 'painel.html#empresa';
  }
  function retomarAnalise(doc) {
    let cnpj = null;
    try { cnpj = global.sessionStorage.getItem(CHAVE_ANALISAR); global.sessionStorage.removeItem(CHAVE_ANALISAR); } catch { return; }
    if (cnpj && doc.getElementById('emp-cnpj')) analisarConcorrente(doc, cnpj);
  }

  // item: { descricao, codigoCatalogo }. aoUsarPreco(centavos, resumo, unidade): só no CRM (preço do item).
  function montar({ alvo, item, doc = global.document, requisitar = (...a) => (global.fetchComSessao || global.fetch)(...a), aoUsarPreco = null }) {
    const h = (tag, attrs = {}, ...filhos) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, v === true ? '' : String(v)); }
      e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
      return e;
    };
    const id = `item-mercado-${Math.random().toString(36).slice(2, 8)}`;
    const td = (rotulo, ...filhos) => h('td', { 'data-rotulo': rotulo }, ...filhos);
    const tabela = (cabecalho, linhas) => h('div', { classe: 'mercado-tabela' }, h('table', { classe: 'mercado-marcas' },
      h('thead', {}, h('tr', {}, ...cabecalho.map((t) => h('th', { scope: 'col', texto: t })))), h('tbody', {}, ...linhas)));
    const local = (i) => `${i.orgao || 'Órgão não informado'}${i.uf ? `/${i.uf}` : ''}`;
    const status = h('p', { classe: 'nota', role: 'status', 'aria-live': 'polite', texto: 'Buscando compras deste item no Compras.gov…' });
    const lista = h('div', { classe: 'item-mercado-abas', role: 'tablist', 'aria-label': 'Mercado deste item', hidden: true });
    const paineis = {};
    const botoes = ABAS.map(([chave, rotulo], k) => {
      paineis[chave] = h('div', { id: `${id}-${chave}`, role: 'tabpanel', 'aria-labelledby': `${id}-aba-${chave}`, tabindex: 0, hidden: k > 0 });
      return h('button', { type: 'button', role: 'tab', id: `${id}-aba-${chave}`, classe: 'item-mercado-aba', 'aria-controls': paineis[chave].id, 'aria-selected': String(!k), tabindex: k ? -1 : 0, 'data-aba': chave, texto: rotulo });
    });
    lista.append(...botoes);
    alvo.replaceChildren(status, lista, ...Object.values(paineis));
    function escolher(chave, foco) {
      for (const b of botoes) { const sim = b.dataset.aba === chave; b.setAttribute('aria-selected', String(sim)); b.tabIndex = sim ? 0 : -1; paineis[b.dataset.aba].hidden = !sim; if (sim && foco) b.focus(); }
    }
    lista.addEventListener('click', (ev) => { const b = ev.target?.closest?.('[data-aba]'); if (b) escolher(b.dataset.aba); });
    lista.addEventListener('keydown', (ev) => {
      if (!['ArrowRight', 'ArrowLeft'].includes(ev.key)) return;
      const k = botoes.findIndex((b) => b.getAttribute('aria-selected') === 'true');
      escolher(botoes[(k + (ev.key === 'ArrowRight' ? 1 : botoes.length - 1)) % botoes.length].dataset.aba, true);
    });

    function desenhar(r) {
      const a = abas(r.itens);
      paineis.historico.replaceChildren(h('p', { classe: 'nota', texto: `Compras homologadas mais recentes${r.produto ? ` de ${r.produto}` : ''}. Mostrando ${Math.min(LINHAS, a.historico.length)} de ${a.historico.length}.` }),
        tabela(['Data', 'Órgão', 'Qtd.', 'Valor unitário', 'Vencedor'], a.historico.slice(0, LINHAS).map((i) => h('tr', {},
          td('Data', MC.dataBr(i.dataResultado), i.link ? h('a', { classe: 'mercado-desc', href: i.link, target: '_blank', rel: 'noopener noreferrer', texto: 'Ver compra' }) : null),
          td('Órgão', local(i)), td('Qtd.', `${i.quantidade ?? '—'} ${i.unidade || ''}`),
          td('Valor unitário', h('strong', { texto: MC.brl(i.valorUnitarioCentavos) })),
          td('Vencedor', i.fornecedor || 'Não informado', i.marca ? h('span', { classe: 'mercado-desc', texto: `Marca: ${String(i.marca).toLocaleUpperCase('pt-BR')}` }) : null)))));
      paineis.concorrencia.replaceChildren(h('p', { classe: 'nota', texto: 'Empresas que ganharam este item, por número de vitórias. A Pesquisa de Preços só traz o vencedor de cada compra.' }),
        tabela(['Empresa', 'Vitórias', 'Marcas', 'Mediana', 'Última vitória', ''], a.concorrencia.slice(0, LINHAS).map((v) => {
          const doc14 = String(v.ultimo.documentoFornecedor || '').replace(/\D/g, '');
          return h('tr', {},
            td('Empresa', h('strong', { texto: v.nome }), doc14 ? h('span', { classe: 'mercado-desc', texto: MC.cnpj(doc14) }) : null),
            td('Vitórias', String(v.quantidade)), td('Marcas', v.marcas.join('; ') || '—'),
            td('Mediana', `${MC.brl(v.resumo.mediana)}${v.unidade ? ` / ${v.unidade}` : ''}`),
            td('Última vitória', `${MC.dataBr(v.ultimo.dataResultado)} · ${local(v.ultimo)}`),
            td('', doc14.length === 14 ? h('button', { type: 'button', classe: 'btn', 'data-analisar-cnpj': doc14, texto: 'Analisar concorrente' }) : null));
        })));
      paineis.marcas.replaceChildren(h('p', { classe: 'nota', texto: 'Marcas que o vencedor declarou, por número de compras ganhas.' }),
        tabela(['Marca', 'Compras', 'Mediana', 'Faixa (mín–máx)', 'Último preço'], a.marcas.slice(0, LINHAS).map((m) => h('tr', {},
          td('Marca', h('strong', { texto: m.nome })), td('Compras', String(m.quantidade)),
          td('Mediana', `${MC.brl(m.resumo.mediana)}${m.unidade ? ` / ${m.unidade}` : ''}`),
          td('Faixa', m.resumo.quantidade > 1 ? `${MC.brl(m.resumo.minimo)} – ${MC.brl(m.resumo.maximo)}` : '—'),
          td('Último preço', m.representante ? `${MC.brl(m.representante.valorUnitarioCentavos)} em ${MC.dataBr(m.representante.dataResultado)}` : '—')))));
      const p = a.precos, rs = p.resumo;
      paineis.precos.replaceChildren(
        h('p', { texto: `${rs.quantidade} compra(s)${p.unidade ? ` por ${p.unidade}` : ''}:` }),
        h('dl', { classe: 'mercado-numeros' }, ...[['Mediana (referência)', rs.mediana, 'destaque'], ['Mínimo', rs.minimo], ['Máximo', rs.maximo], ['Média', rs.media], ['Último preço', p.ultimo?.valorUnitarioCentavos]]
          .map(([t, c, classe]) => h('div', { classe }, h('dt', { texto: t }), h('dd', { texto: MC.brl(c) })))),
        p.foraDaCurva ? h('p', { classe: 'nota', texto: `${p.foraDaCurva} compra(s) fora da curva (mais de 3× ou menos de 1/3 da mediana): use a mediana, não a média.` }) : null,
        p.unidades > 1 ? h('p', { classe: 'nota', texto: `Há compras em outras unidades; as contas usam só ${p.unidade}. Confira se é a unidade do edital.` }) : null,
        typeof aoUsarPreco === 'function' && rs.mediana ? h('div', { classe: 'mercado-acoes' }, h('button', { type: 'button', classe: 'btn primario', 'data-usar-preco': '1', texto: `Usar preço (${MC.brl(rs.mediana)})` })) : null,
        h('p', { classe: 'nota', texto: 'Preço homologado pago pelo órgão: é referência do mercado, não o seu custo.' }));
      paineis.precos.querySelector('[data-usar-preco]')?.addEventListener('click', () => aoUsarPreco(rs.mediana, rs, p.unidade));
      alvo.addEventListener('click', (ev) => { const b = ev.target?.closest?.('[data-analisar-cnpj]'); if (b) analisarConcorrente(doc, b.dataset.analisarCnpj, b); });
    }

    const pronto = carregar(item, requisitar).then((r) => {
      if (!r.itens.length) { status.textContent = r.erro || `Nenhuma compra encontrada para "${r.termo}" no Compras.gov.`; return r; }
      const fonte = r.origem === 'catmat' ? `pelo código CATMAT ${r.catmat} (item exato)` : `pelo termo "${r.termo}" (sem código CATMAT no item)`;
      status.textContent = `${r.itens.length} compra(s) encontradas ${fonte}.${r.parcial ? ' Parte da fonte não respondeu: resultado parcial.' : ''}`;
      lista.hidden = false;
      desenhar(r);
      return r;
    });
    return { pronto };
  }

  // Botão do item (painel: lista de itens do PNCP e Resumo do Edital). O painel abre logo abaixo, uma busca por item.
  function botao(doc, item) {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'btn item-mercado-botao'; b.textContent = 'Ver mercado deste item';
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => {
      let caixa = b.nextElementSibling;
      if (!caixa?.classList.contains('item-mercado')) { caixa = doc.createElement('div'); caixa.className = 'item-mercado'; caixa.hidden = true; b.after(caixa); }
      caixa.hidden = !caixa.hidden; b.setAttribute('aria-expanded', String(!caixa.hidden));
      if (!caixa.hidden && !caixa.childElementCount) montar({ alvo: caixa, item, doc });
    });
    return b;
  }
  // Painel: liga os botões dos itens já desenhados (HTML) em um contêiner. itens: lista do PNCP com numero/descricao/codigoCatalogo.
  function ligarItens(container, itens) {
    const porNumero = new Map((itens || []).map((i) => [String(i.numero ?? i.numeroItem ?? ''), i]));
    for (const alvo of container.querySelectorAll('[data-item-mercado]')) {
      const item = porNumero.get(alvo.dataset.itemMercado);
      if (item && !alvo.childElementCount) alvo.append(botao(container.ownerDocument, item));
    }
  }
  // Resumo do Edital: cada linha da lista começa com o número do item ("12. CANETA…").
  function noResumo(li, itens) {
    const numero = /^(\d+)\./.exec(li.textContent || '')?.[1];
    const item = numero && (itens || []).find((i) => String(i.numero ?? i.numeroItem) === numero);
    if (item) li.append(' ', botao(li.ownerDocument, item));
  }

  if (global.document && global.addEventListener) global.addEventListener('load', () => retomarAnalise(global.document));
  const api = { consultaDoItem, carregar, abas, montar, botao, ligarItens, noResumo, analisarConcorrente };
  global.LicitaItemMercado = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
