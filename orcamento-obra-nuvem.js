/* global window, confirm, module -- script de navegador (orcamento-obra.html); funções puras testadas no Node */
// "Meus orçamentos": o orçamento montado fica salvo na nuvem (supabase/orcamento_obra_salvos.sql), por empresa (CNPJ),
// e abre igual em qualquer computador. Salva sozinho 2 s depois de cada mudança, com controle de versão: se outra aba
// ou computador gravou antes, não sobrescreve, pede para recarregar. O localStorage continua como cópia: sem rede, o
// trabalho fica no navegador e sobe na próxima mudança (ou quando a rede voltar).
// A tela (orcamento-obra-ui.js) só chama: preparar, iniciar, mudou, novoDocumento, empresaDoOrcamento, temPendente.
(function () {
  'use strict';
  const CHAVE_META = 'licitaplena_orcamento_obra_nuvem'; // { id, versao, empresaId, pendente } do orçamento aberto
  const CHAVE_EMPRESA = 'licitaplena_empresa_operacional_id'; // mesma empresa ativa do painel, Quadros e Processos
  const ESPERA_MS = 2000, NOVA_TENTATIVA_MS = 30000;

  // Ao abrir a página: o que fazer com o orçamento que voltou do navegador, comparando com a linha da nuvem.
  // meta = o que este navegador sabe; linha = { versao } na nuvem (null = não existe mais ou perdeu o acesso).
  function decidirAoAbrir(meta, linha, temDocumento) {
    if (!temDocumento) return 'nada';
    if (!meta) return 'salvar'; // rascunho de antes da nuvem (v1): sobe como orçamento novo
    if (!meta.id) return meta.pendente === false ? 'nada' : 'salvar';
    if (!linha) return 'apagado';
    if (linha.versao > meta.versao) return meta.pendente ? 'conflito' : 'abrir_nuvem';
    return meta.pendente ? 'salvar' : 'nada';
  }

  // Erro do Supabase -> texto simples para a tela. rede = vale tentar de novo sozinho.
  function mensagemErro(e) {
    const m = String(e?.message || '');
    if (!e?.code && /fetch|network|rede|timeout|load failed/i.test(m)) return { rede: true, texto: 'Sem conexão com a nuvem agora. O orçamento está guardado neste navegador e sobe sozinho quando a conexão voltar.' };
    if (e?.code === '42501' || /row-level security/i.test(m)) return { rede: false, texto: 'Seu acesso nesta empresa é só de leitura: o orçamento não foi salvo na nuvem (continua neste navegador).' };
    if (/Limite de 200/.test(m)) return { rede: false, texto: 'Esta empresa já tem 200 orçamentos salvos. Apague os que não usa mais para salvar este.' };
    if (e?.code === '23514') return { rede: false, texto: 'Este orçamento é grande demais para salvar na nuvem (mais de 6 MB). Ele continua neste navegador.' };
    return { rede: true, texto: 'Não foi possível salvar na nuvem agora. O orçamento está guardado neste navegador; tento de novo em instantes.' };
  }

  const horaCurta = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dataCurta = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  // Igualdade de conteúdo sem a hora do salvamento: reabrir ou remontar sem mudar nada não cria versão nova.
  // Chaves em ordem: o jsonb do banco devolve o objeto com as chaves em outra ordem.
  const ordenado = (v) => (Array.isArray(v) ? v.map(ordenado) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])])) : v);
  const semData = (d) => JSON.stringify(ordenado({ ...d, salvoEm: null }));
  // Valor global da lista (centavos exatos); null = ainda não montado nesta tela, não conta como mudança.
  const centavos = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

  if (typeof module !== 'undefined' && module.exports) { module.exports = { CHAVE_META, decidirAoAbrir, mensagemErro, semData }; return; }

  // g = { sb, $, esc, reais, aviso, documentoAtual(), abrirDocumento(doc), valorGlobal(), lerLocal() }
  function criar(g) {
    const Doc = window.OrcObra.documento;
    const $ = g.$, esc = g.esc;
    let meta = null, ultimoTexto = null, orgId = null, empresas = [], empresaId = null;
    let timer = null, salvando = false, deNovo = false, travado = false, pronto = false;

    const lerMeta = () => { try { const m = JSON.parse(window.localStorage.getItem(CHAVE_META)); return m && typeof m === 'object' ? m : null; } catch { return null; } };
    const gravarMeta = () => { try { window.localStorage.setItem(CHAVE_META, JSON.stringify(meta)); } catch { /* sem espaço: a nuvem continua valendo */ } };
    const nomeEmpresa = (id) => empresas.find((e) => e.id === id)?.razao_social || 'empresa';
    function estado(html, tipo) { $('nuvem-estado').innerHTML = html; $('nuvem-estado').className = `nota${tipo ? ` nuvem-${tipo}` : ''}`; }

    // Antes de a tela devolver o rascunho: o que já está na nuvem não conta como mudança (não cria versão à toa).
    function preparar() {
      meta = lerMeta();
      const local = g.lerLocal();
      if (local && meta && meta.id && meta.pendente === false) ultimoTexto = semData(local);
    }

    function mudou(doc) {
      if (!doc || travado) return;
      const valor = centavos(g.valorGlobal());
      if (meta?.id && semData(doc) === ultimoTexto && (valor === null || valor === meta.valor)) return;
      meta = { ...(meta || { id: null, versao: 0, empresaId: null }), pendente: true };
      gravarMeta();
      if (pronto) agendar();
    }
    function agendar(ms = ESPERA_MS) { window.clearTimeout(timer); timer = window.setTimeout(() => void salvar(), ms); }

    // Orçamento novo (planilha enviada): a próxima gravação cria outra linha, na empresa escolhida agora.
    function novoDocumento() { travado = false; ultimoTexto = null; meta = { id: null, versao: 0, empresaId: null, pendente: true }; gravarMeta(); }

    async function salvar() {
      if (salvando) { deNovo = true; return; }
      const doc = g.documentoAtual();
      if (!doc || travado || !meta?.pendente) return;
      const alvo = meta.id ? meta.empresaId : empresaId;
      if (!alvo || !orgId) { estado('Para salvar na nuvem, cadastre a sua empresa em <a href="operacao.html">Minhas empresas e documentos</a>. Enquanto isso, o orçamento fica só neste navegador.', 'aviso'); return; }
      if (Doc.bytes(doc) > Doc.LIMITE_BYTES) { estado(esc(mensagemErro({ code: '23514' }).texto), 'erro'); return; }
      salvando = true;
      const texto = semData(doc), valor = centavos(g.valorGlobal());
      // Sem valor (ainda montando): a atualização não apaga o valor que já estava na lista.
      const campos = { titulo: Doc.tituloDoDocumento(doc), documento: doc, ...(valor === null && meta.id ? {} : { valor_global: valor }) };
      try {
        estado('Salvando na nuvem…');
        // Orçamento novo: o id nasce aqui e fica guardado, para a nova tentativa (resposta perdida na rede) não criar outro.
        if (!meta.id && !meta.idNovo) { meta = { ...meta, idNovo: window.crypto.randomUUID() }; gravarMeta(); }
        let r = meta.id
          ? await g.sb.from('orcamento_obra_salvos').update(campos).eq('id', meta.id).eq('versao', meta.versao).select('id,empresa_id,versao,atualizado_em,valor_global')
          : await g.sb.from('orcamento_obra_salvos').insert({ ...campos, id: meta.idNovo, organizacao_id: orgId, empresa_id: alvo }).select('id,empresa_id,versao,atualizado_em,valor_global');
        // Id já existe: a primeira tentativa chegou ao banco. Segue como atualização da versão 1.
        if (!meta.id && r.error?.code === '23505') r = await g.sb.from('orcamento_obra_salvos').update(campos).eq('id', meta.idNovo).eq('versao', 1).select('id,empresa_id,versao,atualizado_em,valor_global');
        if (r.error) {
          const m = mensagemErro(r.error);
          estado(esc(m.texto), 'erro');
          if (m.rede) agendar(NOVA_TENTATIVA_MS);
          return;
        }
        const linha = r.data?.[0];
        if (!linha) { conflito(); return; } // update com versão velha: outra aba ou computador gravou antes
        // Mudou de novo enquanto salvava: continua pendente e grava outra vez.
        const agora = centavos(g.valorGlobal());
        const igual = semData(g.documentoAtual() || doc) === texto && (agora === null || agora === valor);
        meta = { id: linha.id, versao: linha.versao, empresaId: linha.empresa_id, valor: linha.valor_global === null ? null : Number(linha.valor_global), pendente: !igual };
        ultimoTexto = texto;
        gravarMeta();
        estado(`Salvo na nuvem às ${esc(horaCurta(linha.atualizado_em))}, na empresa ${esc(nomeEmpresa(linha.empresa_id))}. Só quem tem acesso a esta empresa vê.`, 'ok');
        if (!igual) agendar();
        if (linha.empresa_id === empresaId) void carregarLista();
      } finally {
        salvando = false;
        if (deNovo) { deNovo = false; agendar(); }
      }
    }

    function conflito() {
      travado = true;
      estado('Este orçamento foi mudado em outra aba ou outro computador. Para não apagar o trabalho de ninguém, parei de salvar aqui. '
        + '<button type="button" class="btn mini" id="nuvem-recarregar">Recarregar a versão da nuvem</button>', 'erro');
      $('nuvem-recarregar').onclick = () => void abrir(meta.id, true);
    }

    async function abrir(id, semPerguntar) {
      if (!semPerguntar && meta?.pendente && meta.id !== id && !confirm('As últimas mudanças do orçamento aberto ainda não chegaram à nuvem. Abrir outro mesmo assim? Elas se perdem.')) return;
      estado('Abrindo da nuvem…');
      const { data, error } = await g.sb.from('orcamento_obra_salvos').select('id,empresa_id,versao,documento,atualizado_em,valor_global').eq('id', id).maybeSingle();
      if (error || !data) { estado(esc(error ? mensagemErro(error).texto : 'Este orçamento não existe mais na nuvem.'), 'erro'); void carregarLista(); return; }
      const doc = Doc.lerDocumento(data.documento);
      if (!doc) { estado('Não consegui abrir este orçamento: o arquivo salvo está estragado.', 'erro'); return; }
      window.clearTimeout(timer);
      travado = false;
      meta = { id: data.id, versao: data.versao, empresaId: data.empresa_id, valor: data.valor_global === null ? null : Number(data.valor_global), pendente: false };
      ultimoTexto = semData(doc);
      gravarMeta();
      g.abrirDocumento(doc);
      estado(`Aberto da nuvem: salvo às ${esc(horaCurta(data.atualizado_em))}, na empresa ${esc(nomeEmpresa(data.empresa_id))}.`, 'ok');
      void carregarLista();
    }

    async function duplicar(id) {
      const { data, error } = await g.sb.from('orcamento_obra_salvos').select('titulo,empresa_id,organizacao_id,documento,valor_global').eq('id', id).maybeSingle();
      if (error || !data) { g.aviso(error ? mensagemErro(error).texto : 'Este orçamento não existe mais na nuvem.', 'erro'); return; }
      const r = await g.sb.from('orcamento_obra_salvos').insert({ ...data, titulo: `Cópia de ${data.titulo}`.slice(0, 200) }).select('id');
      if (r.error) { g.aviso(mensagemErro(r.error).texto, 'erro'); return; }
      g.aviso(`Cópia criada: "Cópia de ${data.titulo}". Clique em Abrir para mexer nela.`, 'info');
      void carregarLista();
    }

    async function apagar(id, titulo) {
      if (!confirm(`Apagar o orçamento "${titulo}" da nuvem? Não dá para desfazer.`)) return;
      const { data, error } = await g.sb.from('orcamento_obra_salvos').delete().eq('id', id).select('id');
      if (error || !data?.length) { g.aviso(error ? mensagemErro(error).texto : 'Não foi possível apagar: seu acesso nesta empresa é só de leitura.', 'erro'); return; }
      if (meta?.id === id) { // era o aberto: a tela volta vazia (a cópia do navegador também sai)
        g.esquecerLocal();
        window.location.reload();
        return;
      }
      g.aviso(`Orçamento "${titulo}" apagado.`, 'info');
      void carregarLista();
    }

    async function carregarLista() {
      if (!empresaId) return;
      const pedida = empresaId;
      const { data, error } = await g.sb.from('orcamento_obra_salvos').select('id,titulo,valor_global,atualizado_em').eq('empresa_id', pedida).order('atualizado_em', { ascending: false }).limit(200);
      if (pedida !== empresaId) return;
      if (error) { $('nuvem-lista-wrap').hidden = true; estado(esc(mensagemErro(error).texto), 'erro'); return; }
      $('nuvem-vazia').hidden = Boolean(data.length);
      $('nuvem-lista-wrap').hidden = !data.length;
      $('nuvem-lista').innerHTML = data.map((o) => `<tr${o.id === meta?.id ? ' class="aberto"' : ''}><td data-rotulo="Orçamento" class="item">${esc(o.titulo)}${o.id === meta?.id ? '<small>aberto agora</small>' : ''}</td>`
        + `<td data-rotulo="Valor global">${esc(g.reais(o.valor_global))}</td><td data-rotulo="Salvo em">${esc(dataCurta(o.atualizado_em))}</td>`
        + `<td data-rotulo="Ações"><span class="acoes-linha"><button type="button" class="btn mini" data-nuvem-abrir="${esc(o.id)}">Abrir</button>`
        + `<button type="button" class="btn mini" data-nuvem-duplicar="${esc(o.id)}">Duplicar</button>`
        + `<button type="button" class="btn mini" data-nuvem-apagar="${esc(o.id)}" data-titulo="${esc(o.titulo)}">Apagar</button></span></td></tr>`).join('');
    }

    async function carregarEmpresas() {
      const { data, error } = await g.sb.from('operacao_empresas').select('id,razao_social,cnpj').eq('organizacao_id', orgId).eq('ativo', true).order('razao_social');
      if (error) { estado('Não foi possível carregar as suas empresas agora. O orçamento fica neste navegador.', 'erro'); return; }
      empresas = data || [];
      const fmt = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      $('nuvem-empresa').innerHTML = empresas.map((e) => `<option value="${esc(e.id)}">${esc(e.razao_social)}${e.cnpj ? ` · ${esc(fmt(e.cnpj))}` : ''}</option>`).join('');
      let preferida = ''; try { preferida = window.localStorage.getItem(CHAVE_EMPRESA) || ''; } catch { /* usa a primeira */ }
      empresaId = empresas.some((e) => e.id === meta?.empresaId) ? meta.empresaId : empresas.some((e) => e.id === preferida) ? preferida : empresas[0]?.id || null;
      $('nuvem-empresa').value = empresaId || '';
      $('nuvem-empresa-campo').hidden = !empresas.length;
    }

    // Depois do login e do rascunho do navegador já na tela.
    async function iniciar() {
      $('nuvem-empresa').addEventListener('change', (ev) => {
        empresaId = ev.target.value;
        try { window.localStorage.setItem(CHAVE_EMPRESA, empresaId); } catch { /* vale só nesta aba */ }
        void carregarLista();
      });
      $('nuvem-lista').addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        if (b.dataset.nuvemAbrir) void abrir(b.dataset.nuvemAbrir);
        else if (b.dataset.nuvemDuplicar) void duplicar(b.dataset.nuvemDuplicar);
        else if (b.dataset.nuvemApagar) void apagar(b.dataset.nuvemApagar, b.dataset.titulo);
      });
      window.addEventListener('online', () => { if (meta?.pendente) agendar(0); });
      const { data: org, error } = await g.sb.rpc('bootstrap_operacao');
      if (error || !org) { estado('Não foi possível abrir a sua organização agora. O orçamento fica neste navegador.', 'erro'); return; }
      orgId = org;
      await carregarEmpresas();
      if (!empresas.length) estado('Para salvar na nuvem, cadastre a sua empresa em <a href="operacao.html">Minhas empresas e documentos</a>. Enquanto isso, o orçamento fica só neste navegador.', 'aviso');
      await conciliar();
      pronto = true;
      if (meta?.pendente && !travado) agendar(0);
      await carregarLista();
    }

    async function conciliar() {
      const doc = g.documentoAtual();
      let linha = null;
      if (doc && meta?.id) {
        const r = await g.sb.from('orcamento_obra_salvos').select('id,versao').eq('id', meta.id).maybeSingle();
        if (r.error) { estado(esc(mensagemErro(r.error).texto), 'erro'); return; }
        linha = r.data;
      }
      const acao = decidirAoAbrir(meta, linha, Boolean(doc));
      if (acao === 'salvar') meta = { ...(meta || { id: null, versao: 0, empresaId: null }), pendente: true };
      else if (acao === 'abrir_nuvem') await abrir(meta.id, true);
      else if (acao === 'conflito') conflito();
      else if (acao === 'apagado') {
        meta = { id: null, versao: 0, empresaId: null, pendente: false }; gravarMeta();
        estado('Este orçamento foi apagado da nuvem em outro lugar. Ele continua nesta tela; se você mexer nele, ele é salvo de novo como um orçamento novo.', 'aviso');
      } else if (meta?.id) estado(`Salvo na nuvem, na empresa ${esc(nomeEmpresa(meta.empresaId))}.`, 'ok');
    }

    return {
      preparar, iniciar, mudou, novoDocumento,
      temPendente: () => Boolean(meta?.pendente),
      // Carta-proposta: a empresa do orçamento aberto; orçamento ainda não salvo usa a empresa escolhida.
      empresaDoOrcamento: () => empresas.find((e) => e.id === (meta?.id ? meta.empresaId : empresaId)) || null,
    };
  }

  window.OrcObra = Object.assign(window.OrcObra || {}, { nuvem: { CHAVE_META, criar } });
})();
