/* global module, URL, Blob, setTimeout */
// Baixa concorrência por nº de licitantes (Inteligência de Mercado > Baixa Concorrência): abas Desertos / 1 / 2 / 3
// licitantes, como o Siga Pregão. Fonte: historico_itens + historico_participacoes (PNCP, Pesquisa de Preços e arquivo
// semanal de propostas do Compras.gov, gravados pelo robô), lidos pelo navegador com a RLS de cliente aprovado.
// Só conta licitantes quando o item tem a lista de propostas (classificação ou valor de proposta): sem ela a fonte só
// mostra o vencedor, e "1 licitante" seria falso. Visual novo (20/11/2026): aguarda aprovação.
(function (global) {
  'use strict';
  const ABAS = [['desertos', 'Desertos ou fracassados'], ['1', '1 licitante'], ['2', '2 licitantes'], ['3', '3 licitantes']];
  const SEM_VENCEDOR = /desert|fracass/i;
  const LIMITE = 1000;

  // Itens (com historico_compras e historico_participacoes embutidos) -> grupos por nº de licitantes.
  function classificarItens(itens) {
    const grupos = { desertos: [], 1: [], 2: [], 3: [] };
    let semLista = 0;
    for (const it of itens || []) {
      const parts = Array.isArray(it.historico_participacoes) ? it.historico_participacoes : [];
      if (SEM_VENCEDOR.test(it.situacao_item || '')) { grupos.desertos.push({ ...it, licitantes: null }); continue; }
      const temLista = parts.some((p) => p.classificacao != null || p.valor_proposta != null);
      if (!temLista) { semLista += 1; continue; }
      const n = new Set(parts.map((p) => p.fornecedor_chave).filter(Boolean)).size;
      if (n >= 1 && n <= 3) grupos[n].push({ ...it, licitantes: n });
    }
    const recente = (a, b) => String(b.historico_compras?.data_publicacao || '').localeCompare(String(a.historico_compras?.data_publicacao || ''));
    for (const k of Object.keys(grupos)) grupos[k].sort(recente);
    return { grupos, semLista };
  }

  // Palavra do usuário vira filtro ilike do PostgREST: só letras, números e espaço (vírgula e parêntese quebram o or=).
  const palavraSegura = (p) => String(p || '').normalize('NFC').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const filtroOu = (palavras) => [...new Set((palavras || []).map(palavraSegura).filter((p) => p.length >= 3))].slice(0, 8).map((p) => `descricao.ilike.*${p}*`).join(',');

  const brl = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const dataBr = (d) => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? d.slice(0, 10).split('-').reverse().join('/') : '—');
  const HOSTS = ['pncp.gov.br', 'dadosabertos.compras.gov.br', 'cnetmobile.estaleiro.serpro.gov.br', 'comprasnet.gov.br', 'www.comprasnet.gov.br'];
  function linkOficial(u) {
    try { const url = new URL(String(u || '')); return url.protocol === 'https:' && HOSTS.includes(url.hostname) ? url.href : null; } catch { return null; }
  }
  const celulaSegura = (v) => { const t = v === null || v === undefined ? '' : String(v); return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; };
  function linhasPlanilha(grupos) {
    const rot = Object.fromEntries(ABAS);
    return [['Grupo', 'Data', 'Órgão', 'UASG', 'Compra', 'Item', 'Descrição', 'Quantidade', 'Unidade', 'Valor estimado (R$)', 'Situação', 'Link'],
      ...ABAS.flatMap(([k]) => (grupos[k] || []).map((it) => {
        const c = it.historico_compras || {};
        return [rot[k], dataBr(c.data_publicacao), c.unidade_nome || c.orgao_nome, c.uasg, `${c.modalidade || ''} ${c.numero || ''}`.trim(), it.numero_item, it.descricao,
          Number(it.quantidade) || '', it.unidade, Number.isFinite(Number(it.valor_estimado)) && it.valor_estimado !== null ? Number(it.valor_estimado) : '', it.situacao_item,
          linkOficial(c.link_origem) || linkOficial(c.link_pncp) || ''].map((x) => (typeof x === 'number' ? x : celulaSegura(x)));
      }))];
  }

  function montar({ alvo, cliente, palavras, doc = global.document, hoje = () => new Date().toISOString().slice(0, 10) }) {
    const h = (tag, attrs = {}, ...filhos) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, String(v)); }
      e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
      return e;
    };
    const estado = { aba: 'desertos', grupos: null, semLista: 0 };
    const status = h('p', { classe: 'dica-clique', role: 'status', 'aria-live': 'polite', texto: 'Contando licitantes no histórico de pregões…' });
    const corpo = h('div');
    alvo.replaceChildren(h('h2', { texto: 'Por número de licitantes' }), status, corpo);

    function desenhar() {
      const g = estado.grupos;
      const abas = h('div', { classe: 'bc-abas', role: 'tablist', 'aria-label': 'Grupos por número de licitantes' }, ...ABAS.map(([k, t]) => h('button', {
        type: 'button', role: 'tab', classe: 'btn-subaba bc-aba', 'data-bc-aba': k, 'aria-selected': String(k === estado.aba), texto: `${t} (${g[k].length})` })));
      const linhas = g[estado.aba];
      const tabela = linhas.length ? h('div', { classe: 'tabela-rolavel' }, h('table', { classe: 'bc-tabela' },
        h('thead', {}, h('tr', {}, ...['Item', 'Órgão', 'Data', 'Qtd.', 'Valor estimado', estado.aba === 'desertos' ? 'Situação' : 'Licitantes', ''].map((t) => h('th', { scope: 'col', texto: t })))),
        h('tbody', {}, ...linhas.slice(0, 200).map((it) => {
          const c = it.historico_compras || {};
          const link = linkOficial(c.link_origem) || linkOficial(c.link_pncp);
          return h('tr', {}, h('td', { 'data-rotulo': 'Item' }, h('strong', { texto: `Item ${it.numero_item}` }), ` ${String(it.descricao || '').slice(0, 140)}`),
            h('td', { 'data-rotulo': 'Órgão', texto: `${c.unidade_nome || c.orgao_nome || '—'}${c.uasg ? ` · UASG ${c.uasg}` : ''}` }),
            h('td', { 'data-rotulo': 'Data', texto: dataBr(c.data_publicacao) }),
            h('td', { 'data-rotulo': 'Qtd.', texto: `${it.quantidade ?? '—'} ${it.unidade || ''}`.trim() }),
            h('td', { 'data-rotulo': 'Valor estimado', texto: brl(it.valor_estimado) }),
            h('td', { 'data-rotulo': estado.aba === 'desertos' ? 'Situação' : 'Licitantes', texto: estado.aba === 'desertos' ? it.situacao_item || '—' : String(it.licitantes) }),
            h('td', {}, link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', texto: 'Abrir compra' }) : null));
        })))) : h('p', { classe: 'dica-clique', texto: 'Nenhum item neste grupo no histórico que já temos.' });
      const total = ABAS.reduce((n, [k]) => n + g[k].length, 0);
      corpo.replaceChildren(...[abas, tabela,
        linhas.length > 200 ? h('p', { classe: 'dica-clique', texto: `Mostrando 200 de ${linhas.length}. A planilha leva todos.` }) : null,
        total ? h('button', { type: 'button', classe: 'btn-imprimir', 'data-bc-planilha': '1', texto: 'Baixar todos (planilha)' }) : null].filter(Boolean));
    }
    function baixar() {
      const linhas = linhasPlanilha(estado.grupos), nome = `licitaplena-baixa-concorrencia-${hoje()}`;
      if (global.XLSX) {
        const livro = global.XLSX.utils.book_new(); global.XLSX.utils.book_append_sheet(livro, global.XLSX.utils.aoa_to_sheet(linhas), 'Baixa concorrência');
        global.XLSX.writeFile(livro, `${nome}.xlsx`); return;
      }
      const celula = (c) => { const t = typeof c === 'number' ? String(c).replace('.', ',') : String(c); return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const url = URL.createObjectURL(new Blob([`${String.fromCharCode(0xfeff)}${linhas.map((l) => l.map(celula).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(doc.createElement('a'), { href: url, download: `${nome}.csv` }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    corpo.addEventListener('click', (ev) => {
      const aba = ev.target?.closest?.('[data-bc-aba]');
      if (aba) { estado.aba = aba.dataset.bcAba; desenhar(); return; }
      if (ev.target?.closest?.('[data-bc-planilha]')) baixar();
    });

    async function carregar() {
      const ou = filtroOu(palavras);
      if (!ou) { status.textContent = 'Use palavras com 3 letras ou mais no diagnóstico para contar licitantes.'; return; }
      if (!cliente) { status.textContent = 'Entre de novo para ver o histórico de licitantes.'; return; }
      const { data, error } = await cliente.from('historico_itens')
        .select('id_compra,numero_item,descricao,quantidade,unidade,valor_estimado,situacao_item,historico_compras(uasg,orgao_nome,unidade_nome,modalidade,numero,data_publicacao,link_origem,link_pncp),historico_participacoes(fornecedor_chave,classificacao,valor_proposta)')
        .or(ou).order('atualizado_em', { ascending: false }).limit(LIMITE);
      if (error) { status.textContent = 'Não foi possível ler o histórico de licitantes agora.'; return; }
      const r = classificarItens(data);
      estado.grupos = r.grupos; estado.semLista = r.semLista;
      status.textContent = `${(data || []).length} item(ns) do histórico com essas palavras${(data || []).length >= LIMITE ? ' (os 1.000 mais recentes)' : ''}. ` +
        `${r.semLista} sem a lista de propostas ficaram de fora da contagem: nesses a fonte só mostra o vencedor. A cobertura cresce conforme o robô lê o arquivo de propostas do Compras.gov.`;
      desenhar();
    }
    const pronto = carregar().catch(() => { status.textContent = 'Não foi possível ler o histórico de licitantes agora.'; });
    return { pronto, estado };
  }

  const api = { classificarItens, filtroOu, palavraSegura, linhasPlanilha, montar, ABAS };
  global.BaixaConcorrencia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
