/* global module */
// Tela do processo em abas (sistema.html): Resumo, Itens, Proposta e documentos, Licitação anterior, Disputa, Cliente e
// Agenda. Cada módulo continua montado no seu cartão de sempre (ids iguais); aqui só se escolhe qual painel aparece,
// com a aba na URL (#aba=itens) para voltar direto, e o cabeçalho fixo: órgão, número, prazo, situação, total e o que falta.
// Contador e total vêm do evento 'licita:itens-resumo' (itens-escolha-ui.js); proposta conferida, de 'licita:documentos'
// (kit-documentos-ui.js). Tudo por textContent: órgão, número e objeto vêm do banco/PNCP.
(function (global) {
  'use strict';
  const ABAS = [['resumo', 'Resumo'], ['itens', 'Itens'], ['proposta', 'Proposta e documentos'], ['anterior', 'Licitação anterior'],
    ['disputa', 'Disputa'], ['cliente', 'Cliente'], ['agenda', 'Agenda']];
  const CHAVES = ABAS.map(([k]) => k);
  const STATUS = { triagem: 'Em triagem', preparacao: 'Em preparação', proposta_enviada: 'Proposta enviada', sessao: 'Em sessão', habilitacao: 'Em habilitação',
    recurso: 'Em recurso', homologado: 'Homologado', contratado: 'Contratado', perdido: 'Perdido', arquivado: 'Arquivado' };

  // "#aba=itens" → 'itens'; qualquer outra coisa → null (a tela abre no Resumo).
  function lerAba(hash) {
    const m = /(?:^#|&)aba=([a-z]+)/.exec(String(hash || ''));
    return m && CHAVES.includes(m[1]) ? m[1] : null;
  }

  // Prazo da sessão em texto e situação (cor + texto, nunca só cor). agora em ms; dia contado no fuso de Brasília.
  function situacaoPrazo(iso, agora = Date.now()) {
    const t = Date.parse(String(iso || ''));
    if (!Number.isFinite(t)) return null;
    const dia = (ms) => Math.floor((ms - 3 * 3600e3) / 86400e3);
    const dias = dia(t) - dia(agora);
    const quando = new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
    if (t < agora) return { situacao: 'atrasado', texto: `Sessão foi em ${quando}` };
    if (dias === 0) return { situacao: 'atrasado', texto: `Sessão hoje, ${quando.slice(-5)}` };
    if (dias <= 3) return { situacao: 'atencao', texto: `Sessão em ${quando} · falta${dias === 1 ? '' : 'm'} ${dias} dia${dias === 1 ? '' : 's'}` };
    return { situacao: 'em-dia', texto: `Sessão em ${quando} · faltam ${dias} dias` };
  }

  // O que falta para a proposta ficar pronta, na ordem do trabalho. itens/documentos null = ainda não carregou.
  function proximosPassos({ itens = null, documentos = null } = {}) {
    const falta = [];
    if (itens) {
      if (!itens.total) falta.push({ aba: 'itens', texto: 'importar os itens do edital' });
      else if (!itens.marcados) falta.push({ aba: 'itens', texto: 'marcar os itens em que vai participar' });
      else if (itens.semPreco) falta.push({ aba: 'itens', texto: `preencher o preço de ${itens.semPreco} ${itens.semPreco === 1 ? 'item' : 'itens'}` });
    }
    if (documentos && !documentos.propostaConferida) falta.push({ aba: 'proposta', texto: documentos.propostas ? 'conferir a prévia da proposta' : 'gerar e conferir a proposta' });
    return falta;
  }

  function montar({ doc = global.document, area, win = global } = {}) {
    const $ = (id) => doc.getElementById(id);
    const tablist = $('processo-abas-lista');
    if (!area || !tablist) return null;
    let aberto = false, dados = {}, itens = null, documentos = null, abaAtual = 'resumo';
    const h = (tag, attrs = {}, ...filhos) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, v === true ? '' : String(v));
      }
      e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
      return e;
    };
    const botoes = () => [...tablist.querySelectorAll('[role="tab"]')];

    function ativar(aba, { focar = false, gravar = true } = {}) {
      if (!CHAVES.includes(aba)) aba = 'resumo';
      abaAtual = aba;
      for (const b of botoes()) {
        const sim = b.dataset.aba === aba;
        b.setAttribute('aria-selected', String(sim)); b.tabIndex = sim ? 0 : -1;
        if (sim) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
      for (const p of area.querySelectorAll('[data-aba-painel]')) p.toggleAttribute('data-ativa', p.dataset.abaPainel === aba);
      if (gravar && aberto && lerAba(win.location?.hash) !== aba) win.history?.replaceState?.(null, '', `${win.location.pathname}${win.location.search}#aba=${aba}`);
      if (focar) $(`aba-${aba}`)?.focus();
    }

    // Altura do topo fixo do site (muda com a largura): o cabeçalho do processo gruda logo abaixo dele.
    function medirTopo() { const t = doc.querySelector('.app-topo'); if (t) doc.documentElement.style.setProperty('--topo-altura', `${t.offsetHeight}px`); }

    function irPara(aba) { ativar(aba, { focar: true }); $('processo-topo')?.scrollIntoView?.({ block: 'start' }); }
    function linkPasso(p) { const b = h('button', { type: 'button', classe: 'proc-passo', 'data-ir-aba': p.aba, texto: p.texto }); return b; }

    function pintarCabecalho() {
      const cab = $('processo-cabecalho'); if (!cab) return;
      const prazo = situacaoPrazo(dados.prazo);
      const linha1 = h('p', { classe: 'proc-cab-titulo' }, h('strong', { texto: dados.orgao || 'Órgão não informado' }), ` · ${dados.numero ? `Nº ${dados.numero}` : 'sem número'}`);
      const selos = h('p', { classe: 'proc-cab-selos' },
        itens ? h('span', { classe: 'proc-selo proc-total', 'data-cab-total': '', texto: `Total da proposta: ${itens.soma} · ${itens.marcados} de ${itens.total} ${itens.total === 1 ? 'item selecionado' : 'itens selecionados'}` }) : null,
        prazo ? h('span', { classe: 'proc-selo', 'data-situacao': prazo.situacao, texto: prazo.texto }) : h('span', { classe: 'proc-selo', texto: 'Data da sessão não informada' }),
        dados.status ? h('span', { classe: 'proc-selo', texto: STATUS[dados.status] || dados.status }) : null);
      const falta = proximosPassos({ itens, documentos });
      const passos = h('p', { classe: 'proc-cab-falta', 'data-cab-falta': '' });
      if (falta.length) { passos.append(h('span', { classe: 'proc-falta-rotulo', texto: 'Falta:' })); for (const p of falta) passos.append(linkPasso(p)); }
      else if (itens && documentos) passos.append(h('span', { classe: 'proc-selo', 'data-situacao': 'em-dia', texto: 'Proposta pronta: confira a disputa e os prazos.' }));
      cab.replaceChildren(linha1, selos, passos);
      pintarSituacao(falta, prazo);
      medirTopo();
    }

    // Cartão "Situação" do Resumo: dados do edital e próximos passos com o caminho para cada aba.
    function pintarSituacao(falta, prazo) {
      const alvo = $('processo-situacao'); if (!alvo) return;
      const linhas = [['Órgão', dados.orgao], ['Número', dados.numero], ['Modalidade', dados.modalidade], ['Objeto', dados.objeto],
        ['Sessão', prazo ? prazo.texto : 'não informada'], ['Situação', STATUS[dados.status] || dados.status]].filter(([, v]) => v);
      const dl = h('dl', { classe: 'proc-dados' }); for (const [k, v] of linhas) dl.append(h('dt', { texto: k }), h('dd', { texto: v }));
      const lista = h('ol', { classe: 'proc-passos' });
      for (const p of falta) lista.append(h('li', {}, linkPasso(p)));
      alvo.replaceChildren(h('h2', { classe: 'app-subtitulo', texto: 'Situação do processo' }), dl, h('h3', { texto: 'Próximos passos' }),
        falta.length ? lista : h('p', { classe: 'app-apoio', texto: itens && documentos ? 'Nada pendente na proposta. Veja a Disputa e a Agenda.' : 'Carregando itens e documentos…' }));
    }

    function pintarAgenda(prazos) {
      const alvo = $('processo-agenda'); if (!alvo) return;
      const eventos = [];
      if (dados.prazo) eventos.push({ id: dados.processoId, titulo: `Sessão pública · ${dados.numero || 'processo'}`, inicio: dados.prazo });
      for (const p of Array.isArray(prazos) ? prazos : []) eventos.push({ id: p.id, titulo: String(p.titulo || 'Prazo').slice(0, 200), inicio: p.vencimento });
      const ul = h('ul', { classe: 'proc-agenda' });
      for (const ev of eventos) {
        const s = situacaoPrazo(ev.inicio);
        const li = h('li', { 'data-situacao': s?.situacao || '' }, h('strong', { texto: ev.titulo }), h('span', { texto: s ? s.texto.replace(/^Sessão /, '') : String(ev.inicio || '') }));
        const add = global.AgendaIcs?.montarBotao(doc, { id: ev.id, titulo: ev.titulo, inicio: ev.inicio, processo: dados.numero, empresa: dados.empresa, empresaId: dados.empresaId, processoId: dados.processoId });
        if (add) li.append(add);
        ul.append(li);
      }
      const todos = h('a', { href: `processos.html?empresa=${encodeURIComponent(dados.empresaId || '')}&processo=${encodeURIComponent(dados.processoId || '')}`, texto: 'Ver e cadastrar todos os prazos deste processo' });
      alvo.replaceChildren(h('h2', { classe: 'app-subtitulo', texto: 'Agenda do processo' }),
        eventos.length ? ul : h('p', { classe: 'app-apoio', texto: 'Nenhum prazo nos próximos 7 dias e sem data de sessão cadastrada.' }), h('p', {}, todos));
    }

    tablist.addEventListener('click', (ev) => { const b = ev.target.closest?.('[role="tab"]'); if (b) ativar(b.dataset.aba); });
    // Setas, Home e End entre as abas (padrão WAI-ARIA de abas com ativação automática).
    tablist.addEventListener('keydown', (ev) => {
      const lista = botoes(), i = lista.findIndex((b) => b.dataset.aba === abaAtual);
      const destino = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: lista.length - 1 }[ev.key];
      if (destino === undefined) return;
      ev.preventDefault(); ativar(lista[(destino + lista.length) % lista.length].dataset.aba, { focar: true });
    });
    area.addEventListener('click', (ev) => { const b = ev.target.closest?.('[data-ir-aba]'); if (b) irPara(b.dataset.irAba); });
    area.addEventListener('licita:itens-resumo', (ev) => { itens = ev.detail; if (aberto) pintarCabecalho(); });
    area.addEventListener('licita:documentos', (ev) => { documentos = ev.detail; if (aberto) pintarCabecalho(); });
    win.addEventListener?.('hashchange', () => { const a = lerAba(win.location.hash); if (aberto && a && a !== abaAtual) ativar(a, { gravar: false }); });
    win.addEventListener?.('resize', medirTopo);

    return {
      ativar,
      // dados: { empresaId, processoId, empresa, orgao, numero, modalidade, objeto, status, prazo }; prazos: os do Hoje deste processo.
      abrir(novos, prazos) {
        aberto = true; dados = novos || {}; itens = null; documentos = null;
        pintarCabecalho(); pintarAgenda(prazos);
        ativar(lerAba(win.location?.hash) || 'resumo', { gravar: false });
      },
      fechar() { aberto = false; dados = {}; itens = null; documentos = null; },
    };
  }

  const api = { montar, lerAba, situacaoPrazo, proximosPassos, ABAS };
  global.LicitaProcessoAbas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
