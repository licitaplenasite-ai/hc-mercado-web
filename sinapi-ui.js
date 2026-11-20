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
      + `<td data-rotulo="Ação"><button type="button" class="btn" data-usar="${i}">Usar este preço</button>`
      + `${l.tipo === 'composicao' ? `<button type="button" class="btn" data-itens="${i}" aria-expanded="false">Ver itens</button>` : ''}</td></tr>`;
  }
  // Itens da composição analítica + preços da UF ([{tipo,codigo,preco_sd,preco_cd}]) → HTML com custo parcial e soma.
  // Item sem preço na UF (ou "SEM PREÇO" na CAIXA) aparece com "—" e não entra na soma; o aviso diz quantos.
  function analiticoHtml(itens, precos, desonerado) {
    if (!itens.length) return '<p class="nota">A CAIXA não publicou os itens desta composição.</p>';
    const mapa = new Map((precos || []).map((p) => [`${p.tipo}|${p.codigo}`, p[coluna(desonerado)]]));
    let soma = 0, semPreco = 0;
    const linhas = itens.map((it) => {
      const preco = mapa.get(`${it.item_tipo}|${it.item_codigo}`);
      const parcial = preco ? Math.round(Number(preco) * Number(it.coeficiente) * 100) / 100 : null;
      if (parcial === null) semPreco++; else soma += parcial;
      return `<tr><td data-rotulo="Tipo">${it.item_tipo === 'composicao' ? 'Composição' : 'Insumo'}</td><td data-rotulo="Código">${esc(it.item_codigo)}</td>`
        + `<td data-rotulo="Descrição" class="item">${esc(it.descricao)}</td><td data-rotulo="Unidade">${esc(it.unidade || '—')}</td>`
        + `<td data-rotulo="Coeficiente">${esc(Number(it.coeficiente).toLocaleString('pt-BR', { maximumFractionDigits: 8 }))}</td>`
        + `<td data-rotulo="Preço unitário">${preco ? esc(reais(preco)) : '—'}</td><td data-rotulo="Custo parcial">${parcial === null ? '—' : esc(reais(parcial))}</td></tr>`;
    }).join('');
    return '<table class="tabela analitico"><thead><tr><th>Tipo</th><th>Código</th><th>Descrição</th><th>Unidade</th><th>Coeficiente</th><th>Preço unitário</th><th>Custo parcial</th></tr></thead>'
      + `<tbody>${linhas}</tbody></table><p class="nota">Soma dos itens: <b>${esc(reais(Math.round(soma * 100) / 100))}</b>`
      + `${semPreco ? ` · ${semPreco} item(ns) sem preço nesta UF, fora da soma` : ''}. Pode diferir alguns centavos do custo da CAIXA por arredondamento.</p>`;
  }
  // O que vai para o navegador: só os campos que itens-processo-ui.js valida e mostra.
  const guardado = (l) => JSON.stringify({ codigo: l.codigo, preco: Number(l.preco).toFixed(2), uf: l.uf, referencia: l.referencia, tipo: l.tipo, desonerado: l.desonerado === true });

  if (typeof module !== 'undefined' && module.exports) module.exports = { filtroBusca, linhaHtml, linhaPreco, analiticoHtml, guardado, termo, esc };
  if (typeof document === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // eslint-disable-line no-undef -- globais de supabase-config.js
  let linhas = [], carga = 0;
  function aviso(texto, tipo) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? `aviso ${tipo || 'info'}` : 'aviso'; }

  async function autenticar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('login.html?voltar=/sinapi'); return null; }
    const { data: cliente } = await sb.from('clientes').select('status,boletim_filtro').eq('id', session.user.id).maybeSingle();
    if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/sinapi'); return null; }
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
    det.firstElementChild.innerHTML = erro ? '<p class="nota">Não foi possível carregar os itens agora. Tente de novo.</p>'
      : `<p class="nota"><b>Composição analítica ${esc(l.codigo)}</b> · ${esc(l.uf)} · ${l.desonerado ? 'desonerado' : 'não desonerado'}: quantidade de cada item para 1 ${esc(l.unidade || 'unidade')}.</p>${analiticoHtml(itens || [], precos, l.desonerado)}`;
  }

  $('form-busca').addEventListener('submit', (ev) => { ev.preventDefault(); void buscar(); });
  $('tabela-corpo').addEventListener('click', async (ev) => {
    const bi = ev.target.closest('[data-itens]');
    if (bi) { const li = linhas[Number(bi.dataset.itens)]; if (li) void alternarItens(bi, li); return; }
    const b = ev.target.closest('[data-usar]');
    const l = b ? linhas[Number(b.dataset.usar)] : null;
    if (!l) return;
    const valor = Number(l.preco).toFixed(2);
    try { localStorage.setItem(CHAVE_SINAPI, guardado(l)); } catch { /* sem armazenamento: fica só a cópia */ }
    let copiou = false;
    try { await navigator.clipboard.writeText(valor.replace('.', ',')); copiou = true; } catch { /* navegador sem permissão de cópia */ }
    aviso(`${copiou ? 'Valor R$ ' + valor.replace('.', ',') + ' copiado. ' : ''}No processo, abra Editar no item e use "Usar no valor unitário" (ou cole o valor).`, 'info');
  });
  $('btn-tema').addEventListener('click', () => {
    const claro = document.documentElement.classList.toggle('tema-claro');
    document.documentElement.dataset.theme = claro ? 'light' : 'dark';
    try { localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
  });

  autenticar().then((cliente) => {
    if (!cliente) return;
    const uf = cliente.boletim_filtro?.ufs?.[0];
    if (uf && [...$('f-uf').options].some((o) => o.value === uf)) $('f-uf').value = uf;
    void mostrarDataBase();
    $('f-busca').focus();
  }).catch(() => aviso('Não foi possível validar a sessão. Recarregue a página.', 'erro'));
})();
