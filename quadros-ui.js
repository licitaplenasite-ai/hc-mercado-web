/* global module, document, localStorage, location, confirm, window, SUPABASE_URL, SUPABASE_ANON_KEY */
// Quadros: kanbans livres por empresa (CNPJ), com colunas próprias e cartões que podem apontar para um processo.
// Referência: "Negócios > Quadros" do Siga Pregão. Banco: supabase/funil_quadros.sql (RLS por empresa).
// Funções puras no topo (testadas em quadros-ui.test.js); o controlador da página (iniciarQuadros) só roda em quadros.html.
(function (global) {
  'use strict';
  const COLUNAS_PADRAO = ['A fazer', 'Fazendo', 'Feito'];
  const LIMITES = { quadro: 60, coluna: 40, cartao: 200, descricao: 4000 }; // mesmos checks de funil_quadros.sql
  const CHAVE_EMPRESA = 'licitaplena_empresa_operacional_id';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function normalizarNome(texto, max) {
    return String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  }

  // Ordem fracionária: o cartão movido recebe a média dos vizinhos (1 update, sem renumerar a coluna).
  function ordemEntre(antes, depois) {
    if (antes == null && depois == null) return 1;
    if (antes == null) return depois - 1;
    if (depois == null) return antes + 1;
    return (antes + depois) / 2;
  }
  // lista = itens da coluna de destino já ordenados; indice = posição final do movido (o próprio é ignorado).
  function ordemNaPosicao(lista, indice, idMovido) {
    const outros = lista.filter((x) => x.id !== idMovido);
    const i = Math.max(0, Math.min(indice, outros.length));
    return ordemEntre(outros[i - 1]?.ordem ?? null, outros[i]?.ordem ?? null);
  }

  const porOrdem = (a, b) => a.ordem - b.ordem || String(a.criado_em).localeCompare(String(b.criado_em)) || String(a.id).localeCompare(String(b.id));
  function agruparCartoes(colunas, cartoes) {
    const mapa = new Map(colunas.map((c) => [c.id, []]));
    for (const k of cartoes) mapa.get(k.coluna_id)?.push(k);
    for (const lista of mapa.values()) lista.sort(porOrdem);
    return mapa;
  }

  // Erros do PostgREST/gatilho em português para quem usa.
  function mensagemErro(erro, contexto) {
    const msg = String(erro?.message || '');
    if (erro?.code === '23503' && contexto === 'apagar-coluna') return 'Mova ou apague os cartões desta coluna antes de excluí-la.';
    if (erro?.code === '23503' && /Processo/.test(msg)) return 'O processo escolhido é de outra empresa.';
    if (/Limite de (\d+)/.test(msg)) return `Limite atingido: até ${msg.match(/Limite de (\d+)/)[1]} neste quadro ou empresa.`;
    if (erro?.code === '42501' || erro?.semPermissao) return 'Seu acesso a esta empresa é só de leitura.';
    return 'Não foi possível salvar: ' + (msg || 'erro desconhecido') + '.';
  }

  function vencido(prazo, hoje) {
    return Boolean(prazo) && prazo < hoje;
  }

  function htmlCartao(k, processo, hoje) {
    const prazo = k.prazo ? `<span class="q-tag${vencido(k.prazo, hoje) ? ' q-vencido' : ''}">Prazo ${esc(k.prazo.split('-').reverse().join('/'))}</span>` : '';
    const proc = processo ? `<a class="q-tag q-processo" href="processos.html?processo=${encodeURIComponent(processo.id)}">${esc(processo.numero || 'Processo')}: ${esc(processo.objeto)}</a>` : '';
    return `<article class="q-cartao" draggable="true" data-cartao="${esc(k.id)}" tabindex="0" aria-label="${esc(k.titulo)}">
<button type="button" class="q-cartao-titulo" data-editar-cartao="${esc(k.id)}">${esc(k.titulo)}</button>
${k.descricao ? `<p>${esc(k.descricao.slice(0, 140))}${k.descricao.length > 140 ? '…' : ''}</p>` : ''}
${prazo || proc ? `<div class="q-tags">${prazo}${proc}</div>` : ''}</article>`;
  }

  function htmlQuadro(colunas, cartoes, processos, hoje) {
    const grupos = agruparCartoes(colunas, cartoes);
    const porId = new Map(processos.map((p) => [p.id, p]));
    if (!colunas.length) return '<p class="vazio">Este quadro ainda não tem colunas. Use “+ Coluna”.</p>';
    return colunas.map((c, i) => {
      const lista = grupos.get(c.id) || [];
      return `<section class="q-coluna" data-coluna="${esc(c.id)}" aria-label="${esc(c.nome)}">
<header class="q-coluna-topo"><span class="q-ponto" style="background:${/^#[0-9a-f]{6}$/i.test(c.cor) ? c.cor : '#64748b'}"></span><h3>${esc(c.nome)}</h3><span class="q-conta">${lista.length}</span>
<span class="q-coluna-acoes"><button type="button" class="q-mini" data-coluna-esq="${esc(c.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Mover coluna ${esc(c.nome)} para a esquerda">‹</button><button type="button" class="q-mini" data-coluna-dir="${esc(c.id)}" ${i === colunas.length - 1 ? 'disabled' : ''} aria-label="Mover coluna ${esc(c.nome)} para a direita">›</button><button type="button" class="q-mini" data-renomear-coluna="${esc(c.id)}" aria-label="Renomear coluna ${esc(c.nome)}">✎</button><button type="button" class="q-mini" data-apagar-coluna="${esc(c.id)}" aria-label="Excluir coluna ${esc(c.nome)}">×</button></span></header>
<div class="q-lista" data-lista="${esc(c.id)}">${lista.map((k) => htmlCartao(k, porId.get(k.processo_id), hoje)).join('')}</div>
<button type="button" class="q-novo-cartao" data-novo-cartao="${esc(c.id)}">+ Cartão</button></section>`;
    }).join('');
  }

  // ---------- Controlador da página (rede + DOM) ----------
  function iniciarQuadros(sb) {
    const $ = (id) => document.getElementById(id);
    const estado = { orgId: null, empresaId: null, quadros: [], quadroId: null, colunas: [], cartoes: [], processos: [], arrastando: null };
    const hoje = () => new Date().toLocaleDateString('sv-SE');
    // Erro cru do banco/rede (inglês, nome de tabela) não chega ao usuário: mesmo filtro do processos.html.
  const TECNICO = /\.sql\b|supabase|row-level|violates|permission denied|JWT|PGRST|schema cache|relation |column |does not exist|duplicate key|null value|Failed to fetch|NetworkError|Load failed/i;
  function legivel(texto) {
    if (!TECNICO.test(texto)) return texto;
    console.warn(texto);
    const base = /^[^:]+:\s/.test(texto) ? String(texto).split(/:\s/)[0] : 'Não foi possível concluir';
    const motivo = /row-level|permission denied/i.test(texto) ? 'seu acesso a esta empresa é só de leitura' : /fetch|NetworkError|Load failed/i.test(texto) ? 'sem conexão com a internet. Confira e tente de novo' : 'tente de novo em instantes. Se continuar, fale com o suporte';
    return `${base}: ${motivo}.`;
  }
  function aviso(texto, tipo = 'info') { const e = $('aviso'); e.textContent = legivel(texto); e.className = texto ? `aviso ${tipo}` : 'aviso'; }

    async function autenticar() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { location.replace('login.html?voltar=/quadros'); return false; }
      const { data: cliente } = await sb.from('clientes').select('status').eq('id', session.user.id).maybeSingle();
      if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/quadros'); return false; }
      return true;
    }
    // Update/delete barrado pela RLS volta sem erro e sem linhas: vira erro de permissão.
    async function gravar(consulta, contexto) {
      const { data, error } = await consulta.select('id');
      if (error || !data?.length) { aviso(mensagemErro(error || { semPermissao: true }, contexto), 'erro'); return null; }
      aviso('');
      return data;
    }
    const escopo = () => ({ organizacao_id: estado.orgId, empresa_id: estado.empresaId });

    async function carregarEmpresas() {
      const { data, error } = await sb.from('operacao_empresas').select('id,razao_social,cnpj').eq('organizacao_id', estado.orgId).eq('ativo', true).order('razao_social');
      if (error) { aviso('Não foi possível carregar as empresas: ' + error.message, 'erro'); return; }
      $('empresa-atual').innerHTML = (data || []).map((e) => `<option value="${esc(e.id)}">${esc(e.razao_social)}${e.cnpj ? ` · ${esc(String(e.cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'))}` : ''}</option>`).join('');
      let preferida = ''; try { preferida = localStorage.getItem(CHAVE_EMPRESA) || ''; } catch { /* sem armazenamento: usa a primeira */ }
      estado.empresaId = (data || []).some((e) => e.id === preferida) ? preferida : data?.[0]?.id || null;
      $('empresa-atual').value = estado.empresaId || '';
      if (!estado.empresaId) { aviso('Cadastre uma empresa em “Minhas empresas e documentos” para usar os quadros.', 'info'); return; }
      await carregarQuadros();
    }
    async function carregarQuadros(escolher) {
      const empresa = estado.empresaId;
      const [q, p] = await Promise.all([
        sb.from('operacao_quadros').select('id,nome').eq('empresa_id', empresa).order('criado_em').order('id'),
        sb.from('operacao_processos').select('id,numero,objeto').eq('empresa_id', empresa).neq('status', 'arquivado').order('criado_em', { ascending: false }).limit(300),
      ]);
      if (empresa !== estado.empresaId) return;
      if (q.error) { aviso('Não foi possível abrir os quadros: ' + q.error.message, 'erro'); return; }
      estado.quadros = q.data || []; estado.processos = p.data || [];
      estado.quadroId = [escolher, estado.quadroId].find((id) => estado.quadros.some((x) => x.id === id)) || estado.quadros[0]?.id || null;
      $('quadro-atual').innerHTML = estado.quadros.map((x) => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('');
      $('quadro-atual').value = estado.quadroId || '';
      await carregarQuadro();
    }
    async function carregarQuadro() {
      const id = estado.quadroId;
      for (const b of ['btn-renomear-quadro', 'btn-apagar-quadro', 'btn-nova-coluna', 'quadro-atual']) $(b).disabled = !id;
      if (!id) { estado.colunas = []; estado.cartoes = []; desenhar(); return; }
      const [c, k] = await Promise.all([
        sb.from('operacao_quadros_colunas').select('*').eq('quadro_id', id).order('ordem').order('criado_em'),
        sb.from('operacao_quadros_cartoes').select('*').eq('quadro_id', id).order('ordem'),
      ]);
      if (id !== estado.quadroId) return;
      if (c.error || k.error) { aviso('Não foi possível abrir o quadro: ' + (c.error || k.error).message, 'erro'); return; }
      estado.colunas = c.data || []; estado.cartoes = k.data || [];
      desenhar();
    }
    function desenhar() {
      $('quadro').innerHTML = estado.quadroId
        ? htmlQuadro(estado.colunas, estado.cartoes, estado.processos, hoje())
        : '<div class="vazio"><p>Nenhum quadro nesta empresa. Crie um para organizar tarefas além do funil: cotações, documentos, entregas.</p><button type="button" class="btn primario" data-novo-quadro>Criar primeiro quadro</button></div>';
    }

    // Diálogo de nome (quadro e coluna): devolve o texto ou null.
    function pedirNome(titulo, valor, max) {
      const dlg = $('dlg-nome');
      $('dlg-nome-titulo').textContent = titulo;
      const campo = $('dlg-nome-campo'); campo.value = valor || ''; campo.maxLength = max;
      dlg.returnValue = ""; dlg.showModal(); campo.select();
      return new Promise((ok) => dlg.addEventListener('close', () => ok(dlg.returnValue === 'ok' ? normalizarNome(campo.value, max) || null : null), { once: true }));
    }

    async function novoQuadro() {
      const nome = await pedirNome('Novo quadro', '', LIMITES.quadro);
      if (!nome) return;
      const { data, error } = await sb.from('operacao_quadros').insert({ ...escopo(), nome }).select('id').single();
      if (error) { aviso(mensagemErro(error), 'erro'); return; }
      const colunas = COLUNAS_PADRAO.map((n, i) => ({ ...escopo(), quadro_id: data.id, nome: n, ordem: i + 1 }));
      const r = await sb.from('operacao_quadros_colunas').insert(colunas);
      if (r.error) aviso('Quadro criado sem as colunas padrão: ' + r.error.message, 'erro');
      await carregarQuadros(data.id);
    }
    async function renomearQuadro() {
      const atual = estado.quadros.find((x) => x.id === estado.quadroId);
      const nome = await pedirNome('Renomear quadro', atual?.nome, LIMITES.quadro);
      if (nome && await gravar(sb.from('operacao_quadros').update({ nome }).eq('id', estado.quadroId))) await carregarQuadros();
    }
    async function apagarQuadro() {
      const atual = estado.quadros.find((x) => x.id === estado.quadroId);
      if (!atual || !confirm(`Excluir o quadro “${atual.nome}” com ${estado.colunas.length} colunas e ${estado.cartoes.length} cartões? Não dá para desfazer. Os processos ligados não são apagados.`)) return;
      if (await gravar(sb.from('operacao_quadros').delete().eq('id', atual.id))) { estado.quadroId = null; await carregarQuadros(); }
    }
    async function novaColuna() {
      const nome = await pedirNome('Nova coluna', '', LIMITES.coluna);
      if (!nome) return;
      const ultima = estado.colunas[estado.colunas.length - 1];
      const { error } = await sb.from('operacao_quadros_colunas').insert({ ...escopo(), quadro_id: estado.quadroId, nome, ordem: ordemEntre(ultima?.ordem ?? null, null) });
      if (error) aviso(mensagemErro(error), 'erro'); else aviso('');
      await carregarQuadro();
    }
    async function moverColuna(id, passo) {
      const i = estado.colunas.findIndex((c) => c.id === id);
      const destino = i + passo;
      if (i < 0 || destino < 0 || destino >= estado.colunas.length) return;
      const ordem = ordemNaPosicao(estado.colunas, destino, id);
      if (await gravar(sb.from('operacao_quadros_colunas').update({ ordem }).eq('id', id))) await carregarQuadro();
    }
    async function renomearColuna(id) {
      const col = estado.colunas.find((c) => c.id === id);
      const nome = await pedirNome('Renomear coluna', col?.nome, LIMITES.coluna);
      if (nome && await gravar(sb.from('operacao_quadros_colunas').update({ nome }).eq('id', id))) await carregarQuadro();
    }
    async function apagarColuna(id) {
      const col = estado.colunas.find((c) => c.id === id);
      if (!col) return;
      if (estado.cartoes.some((k) => k.coluna_id === id)) { aviso(mensagemErro({ code: '23503' }, 'apagar-coluna'), 'erro'); return; }
      if (!confirm(`Excluir a coluna “${col.nome}”?`)) return;
      if (await gravar(sb.from('operacao_quadros_colunas').delete().eq('id', id), 'apagar-coluna')) await carregarQuadro();
    }
    async function moverCartao(id, colunaId, indice) {
      const lista = estado.cartoes.filter((k) => k.coluna_id === colunaId).sort(porOrdem);
      const ordem = ordemNaPosicao(lista, indice, id);
      const k = estado.cartoes.find((x) => x.id === id);
      if (!k || (k.coluna_id === colunaId && k.ordem === ordem)) return;
      const antes = { coluna_id: k.coluna_id, ordem: k.ordem };
      Object.assign(k, { coluna_id: colunaId, ordem }); desenhar(); // otimista; volta se o banco recusar
      if (!await gravar(sb.from('operacao_quadros_cartoes').update({ coluna_id: colunaId, ordem }).eq('id', id))) { Object.assign(k, antes); desenhar(); }
    }

    // Diálogo do cartão (novo e editar).
    function abrirCartao(id, colunaId) {
      const k = estado.cartoes.find((x) => x.id === id) || { coluna_id: colunaId };
      const f = $('form-cartao');
      f.reset();
      f.elements.id.value = k.id || '';
      f.elements.titulo.value = k.titulo || '';
      f.elements.descricao.value = k.descricao || '';
      f.elements.prazo.value = k.prazo || '';
      f.elements.coluna_id.innerHTML = estado.colunas.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
      f.elements.coluna_id.value = k.coluna_id;
      f.elements.processo_id.innerHTML = '<option value="">Nenhum</option>' + estado.processos.map((p) => `<option value="${esc(p.id)}">${esc((p.numero ? p.numero + ' · ' : '') + p.objeto).slice(0, 90)}</option>`).join('');
      f.elements.processo_id.value = k.processo_id || '';
      $('dlg-cartao-titulo').textContent = k.id ? 'Editar cartão' : 'Novo cartão';
      $('btn-apagar-cartao').hidden = !k.id;
      $('dlg-cartao').showModal();
      f.elements.titulo.focus();
    }
    async function salvarCartao(f) {
      const titulo = normalizarNome(f.elements.titulo.value, LIMITES.cartao);
      if (!titulo) { f.elements.titulo.focus(); return; }
      const id = f.elements.id.value, colunaId = f.elements.coluna_id.value;
      const campos = { titulo, descricao: f.elements.descricao.value.trim().slice(0, LIMITES.descricao) || null, prazo: f.elements.prazo.value || null, processo_id: f.elements.processo_id.value || null, coluna_id: colunaId };
      const atual = estado.cartoes.find((k) => k.id === id);
      if (!atual || atual.coluna_id !== colunaId) campos.ordem = ordemNaPosicao(estado.cartoes.filter((k) => k.coluna_id === colunaId).sort(porOrdem), Infinity, id);
      const ok = id
        ? await gravar(sb.from('operacao_quadros_cartoes').update(campos).eq('id', id))
        : await gravar(sb.from('operacao_quadros_cartoes').insert({ ...escopo(), quadro_id: estado.quadroId, ...campos }));
      if (ok) { $('dlg-cartao').close(); await carregarQuadro(); }
    }
    async function apagarCartao() {
      const id = $('form-cartao').elements.id.value;
      if (!id || !confirm('Excluir este cartão?')) return;
      if (await gravar(sb.from('operacao_quadros_cartoes').delete().eq('id', id))) { $('dlg-cartao').close(); await carregarQuadro(); }
    }

    // Arrastar e soltar (mouse). No celular e no teclado, o cartão muda de coluna pelo diálogo ("Coluna").
    function indiceNaLista(lista, y) {
      const cartoes = [...lista.querySelectorAll('.q-cartao:not(.q-arrastando)')];
      const i = cartoes.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
      return i < 0 ? cartoes.length : i;
    }
    const quadro = $('quadro');
    quadro.addEventListener('dragstart', (ev) => {
      const el = ev.target.closest?.('.q-cartao'); if (!el) return;
      estado.arrastando = el.dataset.cartao; el.classList.add('q-arrastando');
      ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', el.dataset.cartao);
    });
    quadro.addEventListener('dragend', () => { estado.arrastando = null; quadro.querySelectorAll('.q-arrastando,.q-alvo').forEach((e) => e.classList.remove('q-arrastando', 'q-alvo')); });
    quadro.addEventListener('dragover', (ev) => {
      const col = ev.target.closest?.('.q-coluna'); if (!col || !estado.arrastando) return;
      ev.preventDefault(); quadro.querySelectorAll('.q-alvo').forEach((e) => e !== col && e.classList.remove('q-alvo')); col.classList.add('q-alvo');
    });
    quadro.addEventListener('drop', (ev) => {
      const col = ev.target.closest?.('.q-coluna'); if (!col || !estado.arrastando) return;
      ev.preventDefault();
      const id = estado.arrastando; estado.arrastando = null;
      void moverCartao(id, col.dataset.coluna, indiceNaLista(col.querySelector('.q-lista'), ev.clientY));
    });
    quadro.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const d = b.dataset;
      if ('novoQuadro' in d) void novoQuadro();
      else if (d.novoCartao) abrirCartao(null, d.novoCartao);
      else if (d.editarCartao) abrirCartao(d.editarCartao);
      else if (d.colunaEsq) void moverColuna(d.colunaEsq, -1);
      else if (d.colunaDir) void moverColuna(d.colunaDir, 1);
      else if (d.renomearColuna) void renomearColuna(d.renomearColuna);
      else if (d.apagarColuna) void apagarColuna(d.apagarColuna);
    });
    $('btn-novo-quadro').addEventListener('click', () => void novoQuadro());
    $('btn-renomear-quadro').addEventListener('click', () => void renomearQuadro());
    $('btn-apagar-quadro').addEventListener('click', () => void apagarQuadro());
    $('btn-nova-coluna').addEventListener('click', () => void novaColuna());
    $('btn-apagar-cartao').addEventListener('click', () => void apagarCartao());
    $('form-cartao').addEventListener('submit', (ev) => { if (ev.submitter?.value === 'cancelar') return; ev.preventDefault(); void salvarCartao(ev.target); });
    $('quadro-atual').addEventListener('change', (ev) => { estado.quadroId = ev.target.value; void carregarQuadro(); });
    $('empresa-atual').addEventListener('change', (ev) => {
      estado.empresaId = ev.target.value; estado.quadroId = null;
      try { localStorage.setItem(CHAVE_EMPRESA, ev.target.value); } catch { /* sem armazenamento: vale só nesta aba */ }
      void carregarQuadros();
    });

    (async () => {
      if (!await autenticar()) return;
      const { data: orgId, error } = await sb.rpc('bootstrap_operacao');
      if (error) { aviso('Não foi possível abrir a sua organização: ' + error.message, 'erro'); return; }
      estado.orgId = orgId;
      await carregarEmpresas();
    })();
  }

  const api = { COLUNAS_PADRAO, LIMITES, normalizarNome, ordemEntre, ordemNaPosicao, agruparCartoes, mensagemErro, vencido, htmlCartao, htmlQuadro, iniciarQuadros };
  global.LicitaQuadros = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && document.getElementById('quadro') && window.supabase) {
    // supabase-config.js declara as chaves com const: não viram propriedade de globalThis.
    iniciarQuadros(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
})(globalThis);
