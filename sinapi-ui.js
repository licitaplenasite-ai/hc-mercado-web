/* global document, window, location, localStorage, navigator, module -- script de navegador (e funções puras testadas no Node) */
// Tela SINAPI (sinapi.html): busca por código ou descrição em sinapi_itens com o preço da UF em sinapi_custos
// (robô mensal scripts/coletar_sinapi.js). Composição mostra os itens da composição analítica (sinapi_composicao_itens).
// Lê direto pelo PostgREST com a sessão do usuário; a RLS (cliente_aprovado) é a barreira.
// "Usar este preço" copia o valor e o guarda no navegador; no item do processo (sistema.html), o formulário oferece
// "Usar no valor unitário" (itens-processo-ui.js lê a mesma chave).
(function () {
  'use strict';
  const CHAVE_SINAPI = 'licitaplena_sinapi_preco';
  const LIMITE = 100;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Mesma normalização do robô (coluna busca): minúsculo, sem acento; só letras/dígitos/espaço, sem curinga do ILIKE.
  const termo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Texto digitado → { codigo } (só dígitos), { palavras } (até 6, com 2+ letras) ou { erro }.
  function filtroBusca(texto) {
    const t = termo(String(texto || '').slice(0, 200));
    if (/^[0-9]{1,10}$/.test(t)) return { codigo: t };
    const palavras = [...new Set(t.split(' ').filter((p) => p.length >= 2))].slice(0, 6);
    return palavras.length ? { palavras } : { erro: 'Digite o código ou parte da descrição. Ex.: 104658 ou areia media' };
  }
  const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const mesBr = (d) => (/^\d{4}-\d{2}/.test(String(d || '')) ? `${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '—');
  const coluna = (desonerado) => (desonerado ? 'preco_cd' : 'preco_sd');
  // Item de sinapi_itens com o embed sinapi_custos (uma UF) → linha da tabela com o preço do regime escolhido.
  function linhaPreco(item, desonerado) {
    const c = (item.sinapi_custos || [])[0] || {};
    return { uf: c.uf, tipo: item.tipo, desonerado, codigo: item.codigo, descricao: item.descricao, unidade: item.unidade, grupo: item.grupo,
      origem: item.origem, preco: c[coluna(desonerado)], referencia: c.referencia || item.referencia };
  }
  function linhaHtml(l, i) {
    return `<tr><td data-rotulo="Código"><b>${esc(l.codigo)}</b>${l.grupo ? `<small>${esc(l.grupo)}</small>` : ''}</td>`
      + `<td data-rotulo="Descrição" class="item">${esc(l.descricao)}${l.origem ? `<small>Origem do preço: ${esc(l.origem)}</small>` : ''}</td>`
      + `<td data-rotulo="Unidade">${esc(l.unidade || '—')}</td><td data-rotulo="Preço">${esc(reais(l.preco))}</td>`
      + `<td data-rotulo="Ação"><button type="button" class="btn" data-usar="${i}">Usar este preço</button><button type="button" class="btn" data-lista="${i}">+ Adicionar à minha lista</button>`
      + `${l.tipo === 'composicao' ? `<button type="button" class="btn" data-itens="${i}" aria-expanded="false">Ver itens</button>` : ''}</td></tr>`;
  }
  // Centavos: arredonda meio-centavo para cima como o Excel (toPrecision tira o ruído binário: 13,5 × 2,55 = 34,425 → 34,43).
  const centavos = (n) => Number(`${Math.round(Number(`${Number(n).toPrecision(12)}e2`))}e-2`);
  // Itens da composição analítica + preços da UF ([{tipo,codigo,preco_sd,preco_cd}]) → linhas com custo parcial
  // (null se sem preço), soma e quantos itens ficaram sem preço.
  function analiticoCalc(itens, precos, desonerado) {
    const mapa = new Map((precos || []).map((p) => [`${p.tipo}|${p.codigo}`, p[coluna(desonerado)]]));
    let soma = 0, semPreco = 0;
    const linhas = itens.map((it) => {
      const preco = mapa.get(`${it.item_tipo}|${it.item_codigo}`) || null;
      const parcial = preco ? centavos(Number(preco) * Number(it.coeficiente)) : null;
      if (parcial === null) semPreco++; else soma += parcial;
      return { ...it, preco, parcial };
    });
    return { linhas, soma: centavos(soma), semPreco };
  }
  // Item sem preço na UF (ou "SEM PREÇO" na CAIXA) aparece com "—" e não entra na soma; o aviso diz quantos.
  function analiticoHtml(itens, precos, desonerado) {
    if (!itens.length) return '<p class="nota">A CAIXA não publicou os itens desta composição.</p>';
    const { linhas, soma, semPreco } = analiticoCalc(itens, precos, desonerado);
    const corpo = linhas.map((it) => `<tr><td data-rotulo="Tipo">${it.item_tipo === 'composicao' ? 'Composição' : 'Insumo'}</td><td data-rotulo="Código">${esc(it.item_codigo)}</td>`
        + `<td data-rotulo="Descrição" class="item">${esc(it.descricao)}</td><td data-rotulo="Unidade">${esc(it.unidade || '—')}</td>`
        + `<td data-rotulo="Coeficiente">${esc(Number(it.coeficiente).toLocaleString('pt-BR', { maximumFractionDigits: 8 }))}</td>`
        + `<td data-rotulo="Preço unitário">${it.preco ? esc(reais(it.preco)) : '—'}</td><td data-rotulo="Custo parcial">${it.parcial === null ? '—' : esc(reais(it.parcial))}</td></tr>`).join('');
    return '<table class="tabela analitico"><thead><tr><th>Tipo</th><th>Código</th><th>Descrição</th><th>Unidade</th><th>Coeficiente</th><th>Preço unitário</th><th>Custo parcial</th></tr></thead>'
      + `<tbody>${corpo}</tbody></table><p class="nota">Soma dos itens: <b>${esc(reais(soma))}</b>`
      + `${semPreco ? ` · ${semPreco} item(ns) sem preço nesta UF, fora da soma` : ''}. Pode diferir alguns centavos do custo da CAIXA por arredondamento.</p>`;
  }

  // ---- Planilha: CSV para o Excel brasileiro (";" entre colunas, BOM UTF-8, vírgula decimal). Toda célula é texto já formatado. ----
  const dinheiro = (v) => centavos(v).toFixed(2).replace('.', ',');
  const decimal = (n) => Number(n).toFixed(8).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  // Texto que começa com = + - @ viraria fórmula no Excel: ganha apóstrofo na frente.
  const celula = (v) => {
    let t = String(v ?? '').replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t]/.test(t)) t = `'${t}`;
    return /[";]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = (linhas) => `﻿${linhas.map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`;
  const regime = (d) => (d ? 'Desonerado' : 'Não desonerado');
  const rotuloTipo = (t) => (t === 'composicao' ? 'Composição' : 'Insumo');
  const FONTE = 'SINAPI/CAIXA';
  function csvResultados(linhas) {
    return csv([['Código', 'Descrição', 'Unidade', 'Tipo', 'UF', 'Regime', 'Preço (R$)', 'Data-base', 'Fonte'],
      ...linhas.map((l) => [l.codigo, l.descricao, l.unidade || '', rotuloTipo(l.tipo), l.uf, regime(l.desonerado), dinheiro(l.preco), mesBr(l.referencia), FONTE])]);
  }
  function csvAnalitico(l, itens, precos) {
    const { linhas, soma, semPreco } = analiticoCalc(itens, precos, l.desonerado);
    return csv([['Composição analítica', l.codigo, l.descricao], ['UF', l.uf, regime(l.desonerado), 'Data-base', mesBr(l.referencia), FONTE], [],
      ['Tipo', 'Código', 'Descrição', 'Unidade', 'Coeficiente', 'Preço unitário (R$)', 'Custo parcial (R$)'],
      ...linhas.map((i) => [rotuloTipo(i.item_tipo), i.item_codigo, i.descricao, i.unidade || '', decimal(i.coeficiente),
        i.preco ? dinheiro(i.preco) : 'sem preço', i.parcial === null ? '' : dinheiro(i.parcial)]),
      [], ['', '', '', '', '', 'Soma dos itens (R$)', dinheiro(soma)],
      ...(semPreco ? [[`Atenção: ${semPreco} item(ns) sem preço nesta UF ficaram fora da soma.`]] : [])]);
  }

  // ---- Minha lista de orçamento (guardada no navegador, uma por conta) ----
  const chaveLista = (uid) => `hc_sinapi_lista_${uid}`;
  const idLista = (l) => `${l.tipo}|${l.codigo}|${l.uf}|${l.desonerado ? 'cd' : 'sd'}`;
  const positivo = (s, max) => { const n = Number(String(s ?? '').trim().replace(',', '.')); return Number.isFinite(n) && n > 0 && n <= max ? n : 0; };
  const qtdNum = (s) => positivo(s, 1e9);
  const bdiNum = (s) => positivo(s, 1000);
  // Soma uma linha de resultado à lista; se já estiver lá, não duplica. Quantidade começa em 1.
  function adicionarLista(lista, l) {
    if (lista.some((x) => x.id === idLista(l))) return lista;
    return [...lista, { id: idLista(l), tipo: l.tipo, codigo: l.codigo, descricao: l.descricao, unidade: l.unidade || '', uf: l.uf,
      desonerado: l.desonerado === true, referencia: l.referencia, preco: Number(l.preco), qtd: 1 }];
  }
  // Total da linha = quantidade × preço (centavos); com BDI = total × (1 + BDI/100) arredondado por linha. O total geral soma as
  // linhas já arredondadas, igual ao que o Excel soma na planilha baixada.
  function calcularLista(lista, bdi) {
    const b = bdiNum(bdi);
    const linhas = lista.map((x) => { const total = centavos(x.preco * x.qtd); return { ...x, total, totalBdi: centavos(total * (1 + b / 100)) }; });
    return { linhas, bdi: b, semBdi: centavos(linhas.reduce((a, x) => a + x.total, 0)), comBdi: centavos(linhas.reduce((a, x) => a + x.totalBdi, 0)) };
  }
  // Lê o que está no navegador sem confiar nele: descarta o que não for uma linha válida.
  function lerLista(texto) {
    try {
      const v = JSON.parse(texto || '[]');
      return Array.isArray(v) ? v.filter((x) => x && x.id && x.codigo && Number.isFinite(Number(x.preco))).map((x) => ({ ...x, preco: Number(x.preco), qtd: qtdNum(x.qtd) || 1 })) : [];
    } catch { return []; }
  }
  function csvLista(lista, bdi) {
    const r = calcularLista(lista, bdi);
    return csv([['Item', 'Código', 'Descrição', 'Unidade', 'Tipo', 'UF', 'Regime', 'Data-base', 'Quantidade', 'Preço unitário (R$)', 'Total sem BDI (R$)', `Total com BDI ${decimal(r.bdi) || '0'}% (R$)`, 'Fonte'],
      ...r.linhas.map((x, i) => [String(i + 1), x.codigo, x.descricao, x.unidade, rotuloTipo(x.tipo), x.uf, regime(x.desonerado), mesBr(x.referencia),
        decimal(x.qtd), dinheiro(x.preco), dinheiro(x.total), dinheiro(x.totalBdi), FONTE]),
      [], ['', '', '', '', '', '', '', '', '', 'Total geral', dinheiro(r.semBdi), dinheiro(r.comBdi)]]);
  }
  // O que vai para o navegador: só os campos que itens-processo-ui.js valida e mostra.
  const guardado = (l) => JSON.stringify({ codigo: l.codigo, preco: Number(l.preco).toFixed(2), uf: l.uf, referencia: l.referencia, tipo: l.tipo, desonerado: l.desonerado === true });

  if (typeof module !== 'undefined' && module.exports) module.exports = { filtroBusca, linhaHtml, linhaPreco, analiticoHtml, analiticoCalc, guardado, termo, esc, csvResultados, csvAnalitico, csvLista, centavos, adicionarLista, calcularLista, lerLista, qtdNum, bdiNum, chaveLista, mesBr };
  if (typeof document === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // eslint-disable-line no-undef -- globais de supabase-config.js
  let linhas = [], carga = 0, lista = [], uid = null, bdi = '';
  const analiticos = new Map(); // composição aberta → { l, itens, precos }, para baixar a planilha dela
  function aviso(texto, tipo) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? `aviso ${tipo || 'info'}` : 'aviso'; }

  async function autenticar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('login.html?voltar=/sinapi'); return null; }
    const { data: cliente } = await sb.from('clientes').select('status,boletim_filtro').eq('id', session.user.id).maybeSingle();
    if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/sinapi'); return null; }
    uid = session.user.id;
    return cliente;
  }

  async function mostrarDataBase() {
    const { data } = await sb.from('sinapi_itens').select('referencia').order('referencia', { ascending: false }).limit(1);
    $('data-base').textContent = data?.[0] ? mesBr(data[0].referencia) : 'ainda não carregada';
  }

  async function buscar() {
    const f = filtroBusca($('f-busca').value);
    if (f.erro) { aviso(f.erro, 'erro'); return; }
    const minha = ++carga, desonerado = $('f-deson').value === 'sim';
    $('tabela-corpo').innerHTML = '<tr><td colspan="5" class="vazio">Buscando…</td></tr>';
    let q = sb.from('sinapi_itens').select('tipo,codigo,descricao,unidade,grupo,origem,referencia,sinapi_custos!inner(uf,preco_sd,preco_cd,referencia)')
      .eq('tipo', $('f-tipo').value).eq('sinapi_custos.uf', $('f-uf').value).not(`sinapi_custos.${coluna(desonerado)}`, 'is', null);
    if (f.codigo) q = q.eq('codigo', f.codigo);
    else for (const p of f.palavras) q = q.ilike('busca', `%${p}%`);
    const { data, error } = await q.order('descricao').limit(LIMITE + 1);
    if (minha !== carga) return;
    if (error) { $('tabela-corpo').innerHTML = '<tr><td colspan="5" class="vazio">Sem resultado.</td></tr>'; aviso('Não foi possível consultar o SINAPI agora. Tente de novo.', 'erro'); return; }
    linhas = (data || []).slice(0, LIMITE).map((i) => linhaPreco(i, desonerado));
    $('tabela-corpo').innerHTML = linhas.length ? linhas.map(linhaHtml).join('') : '<tr><td colspan="5" class="vazio">Nada encontrado nesta UF e tabela. Confira o código ou tente menos palavras.</td></tr>';
    $('contador').textContent = linhas.length ? `${linhas.length}${data.length > LIMITE ? '+ (refine a busca)' : ''} resultado${linhas.length === 1 ? '' : 's'} · ${linhas[0].uf} · ${desonerado ? 'desonerado' : 'não desonerado'} · data-base ${mesBr(linhas[0].referencia)}` : '';
    $('btn-baixar').hidden = !linhas.length;
    aviso('');
  }

  // Abre/fecha, logo abaixo da composição, a tabela dos itens com o preço de cada um na mesma UF e regime.
  async function alternarItens(b, l) {
    const tr = b.closest('tr'), aberta = tr.nextElementSibling?.classList.contains('linha-analitico');
    if (aberta) { tr.nextElementSibling.remove(); b.setAttribute('aria-expanded', 'false'); b.textContent = 'Ver itens'; return; }
    const det = document.createElement('tr');
    det.className = 'linha-analitico';
    det.innerHTML = '<td colspan="5"><p class="nota">Carregando itens…</p></td>';
    tr.after(det); b.setAttribute('aria-expanded', 'true'); b.textContent = 'Fechar itens';
    const { data: itens, error } = await sb.from('sinapi_composicao_itens').select('item_tipo,item_codigo,descricao,unidade,coeficiente')
      .eq('composicao', l.codigo).order('item_tipo').order('descricao');
    let precos = [], erro = error;
    if (!erro && itens?.length) {
      const r = await sb.from('sinapi_custos').select('tipo,codigo,preco_sd,preco_cd').eq('uf', l.uf).in('codigo', [...new Set(itens.map((i) => i.item_codigo))]);
      precos = r.data || []; erro = r.error;
    }
    if (!erro) analiticos.set(l.codigo, { l, itens: itens || [], precos });
    det.firstElementChild.innerHTML = erro ? '<p class="nota">Não foi possível carregar os itens agora. Tente de novo.</p>'
      : `<p class="nota"><b>Composição analítica ${esc(l.codigo)}</b> · ${esc(l.uf)} · ${l.desonerado ? 'desonerado' : 'não desonerado'}: quantidade de cada item para 1 ${esc(l.unidade || 'unidade')}.</p>${analiticoHtml(itens || [], precos, l.desonerado)}${erro || !itens?.length ? '' : `<p><button type="button" class="btn" data-baixar-analitico="${esc(l.codigo)}">Baixar planilha desta composição (Excel)</button></p>`}`;
  }

  $('form-busca').addEventListener('submit', (ev) => { ev.preventDefault(); void buscar(); });
  $('tabela-corpo').addEventListener('click', async (ev) => {
    const bi = ev.target.closest('[data-itens]');
    if (bi) { const li = linhas[Number(bi.dataset.itens)]; if (li) void alternarItens(bi, li); return; }
    const ba = ev.target.closest('[data-baixar-analitico]');
    if (ba) { const a = analiticos.get(ba.dataset.baixarAnalitico); if (a) baixar(`sinapi-composicao-${a.l.codigo}-${a.l.uf}.csv`, csvAnalitico(a.l, a.itens, a.precos)); return; }
    const bl = ev.target.closest('[data-lista]');
    if (bl) { const li = linhas[Number(bl.dataset.lista)]; if (li) { adicionarLista0(li); aviso(`${li.codigo} adicionado à sua lista de orçamento (abaixo).`, 'info'); } return; }
    const b = ev.target.closest('[data-usar]');
    const l = b ? linhas[Number(b.dataset.usar)] : null;
    if (!l) return;
    const valor = Number(l.preco).toFixed(2);
    try { localStorage.setItem(CHAVE_SINAPI, guardado(l)); } catch { /* sem armazenamento: fica só a cópia */ }
    let copiou = false;
    try { await navigator.clipboard.writeText(valor.replace('.', ',')); copiou = true; } catch { /* navegador sem permissão de cópia */ }
    aviso(`${copiou ? 'Valor R$ ' + valor.replace('.', ',') + ' copiado. ' : ''}No processo, abra Editar no item e use "Usar no valor unitário" (ou cole o valor).`, 'info');
  });
  // Baixa um texto como arquivo (CSV com BOM abre certo no Excel BR).
  function baixar(nome, texto) {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function salvarLista() { try { localStorage.setItem(chaveLista(uid), JSON.stringify({ lista, bdi })); } catch { /* sem armazenamento: vale só nesta visita */ } }
  function carregarLista() {
    try { const v = JSON.parse(localStorage.getItem(chaveLista(uid)) || '{}'); lista = lerLista(JSON.stringify(v.lista || [])); bdi = String(v.bdi || ''); } catch { lista = []; }
    $('l-bdi').value = bdi; desenharLista();
  }
  function adicionarLista0(l) { lista = adicionarLista(lista, l); salvarLista(); desenharLista(); }
  function desenharLista() {
    $('lista').hidden = !lista.length;
    const r = calcularLista(lista, bdi);
    $('lista-corpo').innerHTML = r.linhas.map((x, i) => `<tr><td data-rotulo="Código"><b>${esc(x.codigo)}</b></td><td data-rotulo="Descrição" class="item">${esc(x.descricao)}</td>`
      + `<td data-rotulo="Unidade">${esc(x.unidade || '—')}</td><td data-rotulo="UF · regime">${esc(x.uf)} · ${x.desonerado ? 'desonerado' : 'não desonerado'}</td>`
      + `<td data-rotulo="Preço unitário">${esc(reais(x.preco))}</td><td data-rotulo="Quantidade"><input class="qtd" inputmode="decimal" data-qtd="${i}" value="${esc(String(x.qtd).replace('.', ','))}" aria-label="Quantidade de ${esc(x.codigo)}"></td>`
      + `<td data-rotulo="Total">${esc(reais(x.total))}</td><td data-rotulo="Ação"><button type="button" class="btn" data-tirar="${i}">Tirar</button></td></tr>`).join('');
    $('lista-totais').innerHTML = `Total sem BDI: <b>${esc(reais(r.semBdi))}</b>${r.bdi ? ` · Total com BDI de ${esc(String(r.bdi).replace('.', ','))}%: <b>${esc(reais(r.comBdi))}</b>` : ''}`;
  }
  $('lista-corpo').addEventListener('change', (ev) => {
    const q = ev.target.closest('[data-qtd]'); if (!q) return;
    const x = lista[Number(q.dataset.qtd)]; const n = qtdNum(q.value);
    if (!x) return;
    if (n) x.qtd = n; else aviso('Quantidade inválida: use um número maior que zero.', 'erro');
    salvarLista(); desenharLista();
  });
  $('lista-corpo').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tirar]'); if (!t) return;
    lista = lista.filter((_, i) => i !== Number(t.dataset.tirar)); salvarLista(); desenharLista();
  });
  $('l-bdi').addEventListener('input', () => { bdi = $('l-bdi').value; salvarLista(); desenharLista(); });
  $('btn-limpar-lista').addEventListener('click', () => { lista = []; salvarLista(); desenharLista(); });
  $('btn-baixar-lista').addEventListener('click', () => baixar('sinapi-minha-lista.csv', csvLista(lista, bdi)));
  $('btn-baixar').addEventListener('click', () => baixar(`sinapi-${linhas[0].uf}-${$('f-tipo').value}.csv`, csvResultados(linhas)));
  $('btn-tema').addEventListener('click', () => {
    const claro = document.documentElement.classList.toggle('tema-claro');
    document.documentElement.dataset.theme = claro ? 'light' : 'dark';
    try { localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
  });

  autenticar().then((cliente) => {
    if (!cliente) return;
    const uf = cliente.boletim_filtro?.ufs?.[0];
    if (uf && [...$('f-uf').options].some((o) => o.value === uf)) $('f-uf').value = uf;
    void mostrarDataBase(); carregarLista();
    $('f-busca').focus();
  }).catch(() => aviso('Não foi possível validar a sessão. Recarregue a página.', 'erro'));
})();
