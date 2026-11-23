/* global module */
// Funil: checklist padrão por etapa (modelo Siga Pregão, rud7dAHuaq4), contador "11 de 15" no cartão,
// filtros (nome, portal, modalidade, período, favoritas), visão em lista e aba Arquivados.
// Sem rede: o painel.html lê e grava no banco (operacao_funil_etapas.tarefas e
// operacao_processos.checklist_funil/favorito, supabase/operacao_funil_checklist.sql) e chama estas funções.
// Tarefas que a esteira automática já faz (operacao_esteira_tarefas) aparecem marcadas por ela, sem tarefa repetida.
(function (global) {
  'use strict';
  const LIMITE_TAREFAS = 30; // mesmo teto do check em operacao_funil_checklist.sql
  const LINKS = { defesa: 'Abrir a Central de Defesa', juridico: 'Preparar recurso ou contrarrazão' };
  const ETAPAS_ESTEIRA = ['itens', 'exigencias', 'cruzamento', 'historico', 'resultado', 'contrato'];

  // As 5 etapas do Siga Pregão. "esteira" = etapa do robô que, pronta, conclui a tarefa.
  const GRUPOS = {
    oportunidade: [
      { id: 'analisar-edital', titulo: 'Analisar o edital', esteira: 'exigencias' },
      { id: 'documentos-habilitacao', titulo: 'Providenciar documentos de habilitação e qualificação' },
      { id: 'esclarecimento-impugnacao', titulo: 'Pedir esclarecimento ou impugnar, se necessário', link: 'defesa' },
    ],
    qualificacao: [
      { id: 'analisar-mercado', titulo: 'Analisar o mercado' },
      { id: 'analisar-concorrentes', titulo: 'Analisar os concorrentes', esteira: 'historico' },
      { id: 'definir-produto', titulo: 'Definir o produto ou serviço, com cotação de fornecedores' },
    ],
    disputa: [
      { id: 'cadastrar-proposta', titulo: 'Cadastrar a proposta no portal com antecedência' },
      { id: 'composicao-precos', titulo: 'Fazer a composição de preços antes da sessão' },
      { id: 'estrategia-preco', titulo: 'Definir a estratégia de preço com base no histórico' },
      { id: 'participar-disputa', titulo: 'Participar da disputa' },
    ],
    classificacao: [
      { id: 'habilitacao-concorrentes', titulo: 'Analisar a habilitação dos concorrentes' },
      { id: 'produtos-concorrentes', titulo: 'Analisar se os produtos dos concorrentes atendem ao edital' },
      { id: 'recurso-contrarrazao', titulo: 'Enviar recurso ou contrarrazão', link: 'juridico' },
      { id: 'proposta-atualizada', titulo: 'Enviar a proposta atualizada, se for convocado' },
    ],
    contrato: [{ id: 'assinar-contrato', titulo: 'Assinar o contrato', esteira: 'contrato' }],
  };
  // Nossas etapas são editáveis: o padrão vem do estágio ("conta como") de cada uma.
  const GRUPOS_POR_ESTAGIO = {
    triagem: ['oportunidade', 'qualificacao'], preparacao: ['disputa'], proposta_enviada: ['disputa'], sessao: ['disputa'],
    habilitacao: ['classificacao'], recurso: ['classificacao'], homologado: ['classificacao', 'contrato'],
    contratado: ['contrato'], perdido: ['classificacao'],
  };
  const VITORIA = ['homologado', 'contratado'];

  function tarefasPadrao(estagio) {
    return (GRUPOS_POR_ESTAGIO[estagio] || []).flatMap((g) => GRUPOS[g].map((t) => ({ ...t })));
  }
  // null/ausente = a empresa ainda não mexeu nesta etapa: vale o padrão do estágio.
  function tarefasDaEtapa(etapa) {
    return Array.isArray(etapa?.tarefas) ? normalizarTarefas(etapa.tarefas) : tarefasPadrao(etapa?.status_sistema);
  }
  // O que vai ao banco: id e título válidos, link/esteira só dos conhecidos, sem id repetido.
  function normalizarTarefas(lista) {
    const vistos = new Set();
    const saida = [];
    for (const t of Array.isArray(lista) ? lista : []) {
      const id = typeof t?.id === 'string' ? t.id : '';
      const titulo = typeof t?.titulo === 'string' ? t.titulo.replace(/\s+/g, ' ').trim() : '';
      if (!/^[a-z0-9-]{1,40}$/.test(id) || !titulo || titulo.length > 120 || vistos.has(id)) continue;
      vistos.add(id);
      const limpa = { id, titulo };
      if (LINKS[t.link]) limpa.link = t.link;
      if (ETAPAS_ESTEIRA.includes(t.esteira)) limpa.esteira = t.esteira;
      saida.push(limpa);
      if (saida.length === LIMITE_TAREFAS) break;
    }
    return saida;
  }
  function novoIdTarefa() {
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  // Caminho do cartão: etapas em andamento + a final do lado dele (quem perdeu não conta "Assinar o contrato").
  function etapasDoCaminho(etapas, etapaAtual) {
    const perdeu = etapaAtual?.status_sistema === 'perdido';
    return [...(etapas || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).filter((e) => e.id === etapaAtual?.id
      || (perdeu ? !VITORIA.includes(e.status_sistema) : e.status_sistema !== 'perdido'));
  }
  // Grupos para o diálogo; a mesma tarefa (id) em duas etapas aparece só na primeira.
  function gruposDoCaminho(etapas, etapaAtual) {
    const vistos = new Set();
    return etapasDoCaminho(etapas, etapaAtual).map((etapa) => ({
      etapa,
      tarefas: tarefasDaEtapa(etapa).filter((t) => !vistos.has(t.id) && vistos.add(t.id)),
    }));
  }
  function tarefaFeita(tarefa, marcas, esteira) {
    return Boolean(marcas?.[tarefa.id]) || Boolean(tarefa.esteira && esteira?.[tarefa.esteira] === 'feito');
  }
  function contarChecklist(etapas, etapaAtual, marcas, esteira) {
    const tarefas = gruposDoCaminho(etapas, etapaAtual).flatMap((g) => g.tarefas);
    return { feitas: tarefas.filter((t) => tarefaFeita(t, marcas, esteira)).length, total: tarefas.length };
  }

  // ---- Filtros ----
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const diaDe = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 10) : null);
  // itens: [{ id, edital, portal, favorito }]; período = data da abertura (prazo de propostas ou sessão).
  function filtrarCards(itens, f = {}) {
    const termo = norm(f.texto).trim();
    return (itens || []).filter(({ edital = {}, portal, favorito }) => {
      if (f.favoritas && !favorito) return false;
      if (f.portal && portal !== f.portal) return false;
      if (f.modalidade && (edital.modalidade || '') !== f.modalidade) return false;
      if (termo && !norm([edital.objeto, edital.orgao, edital.municipio, edital.uf, edital.numeroCompra, edital.numeroControlePNCP].join(' ')).includes(termo)) return false;
      if (f.de || f.ate) {
        const dia = diaDe(edital.encerramento || edital.dataSessao);
        if (!dia || (f.de && dia < f.de) || (f.ate && dia > f.ate)) return false;
      }
      return true;
    });
  }
  function opcoesFiltro(itens) {
    const unicos = (lista) => [...new Set(lista.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { portais: unicos((itens || []).map((i) => i.portal)), modalidades: unicos((itens || []).map((i) => i.edital?.modalidade)) };
  }
  function filtroAtivo(f) {
    return Boolean(f && (f.texto || f.portal || f.modalidade || f.de || f.ate || f.favoritas));
  }

  // ---- HTML ----
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const opcoes = (lista, atual, vazio) => [`<option value="">${vazio}</option>`]
    .concat(lista.map((v) => `<option value="${esc(v)}" ${v === atual ? 'selected' : ''}>${esc(v)}</option>`)).join('');

  function htmlFiltros(f, op) {
    const visao = f.visao || 'quadro';
    const aba = (v, rotulo) => `<button type="button" class="funil-aba" data-funil-visao="${v}" aria-pressed="${visao === v}">${rotulo}</button>`;
    return `
      <div class="funil-abas" role="group" aria-label="Como ver o Funil">${aba('quadro', 'Quadro')}${aba('lista', 'Lista')}${aba('arquivados', 'Arquivados')}</div>
      <div class="funil-campos" ${visao === 'arquivados' ? 'hidden' : ''}>
        <label class="funil-campo funil-campo-texto">Nome ou órgão<input type="search" data-funil-filtro="texto" value="${esc(f.texto)}" placeholder="Ex.: material de limpeza"></label>
        <label class="funil-campo">Portal<select data-funil-filtro="portal">${opcoes(op.portais, f.portal, 'Todos')}</select></label>
        <label class="funil-campo">Modalidade<select data-funil-filtro="modalidade">${opcoes(op.modalidades, f.modalidade, 'Todas')}</select></label>
        <label class="funil-campo">Abertura de<input type="date" data-funil-filtro="de" value="${esc(f.de)}"></label>
        <label class="funil-campo">até<input type="date" data-funil-filtro="ate" value="${esc(f.ate)}"></label>
        <button type="button" class="funil-favoritas" data-funil-favoritas aria-pressed="${Boolean(f.favoritas)}">★ Só favoritas</button>
        ${filtroAtivo(f) ? '<button type="button" class="funil-limpar" data-funil-limpar>Limpar filtros</button>' : ''}
      </div>`;
  }
  function htmlEstrela(id, favorito) {
    return `<button type="button" class="funil-estrela" data-funil-favorito="${esc(id)}" aria-pressed="${Boolean(favorito)}" title="${favorito ? 'Tirar das favoritas' : 'Marcar como favorita'}" aria-label="${favorito ? 'Tirar das favoritas' : 'Marcar como favorita'}">${favorito ? '★' : '☆'}</button>`;
  }
  function htmlContador(id, c) {
    const tudo = c.total > 0 && c.feitas === c.total;
    return `<button type="button" class="funil-contador${tudo ? ' completo' : ''}" data-funil-checklist="${esc(id)}" aria-label="Checklist: ${c.feitas} de ${c.total} tarefas feitas. Abrir checklist">☑ ${c.feitas} de ${c.total}</button>`;
  }
  // linhas: [{ id, edital, etapaNome, prazoTexto, portal, contagem, favorito }]
  function htmlLista(linhas) {
    if (!linhas.length) return '<div class="kanban-vazio">Nenhuma licitação com esses filtros.</div>';
    return `<table class="funil-tabela"><thead><tr><th scope="col"><span class="visualmente-oculto">Favorita</span></th><th scope="col">Licitação</th><th scope="col">Etapa</th><th scope="col">Abertura</th><th scope="col">Portal</th><th scope="col">Checklist</th></tr></thead><tbody>${
      linhas.map((l) => `<tr data-id="${esc(l.id)}">
        <td>${htmlEstrela(l.id, l.favorito)}</td>
        <td data-rotulo="Licitação"><strong>${esc(l.edital.objeto || 'Licitação sem título')}</strong><br><span class="funil-fraco">${esc(l.edital.orgao || 'Órgão não informado')}</span></td>
        <td data-rotulo="Etapa">${esc(l.etapaNome)}</td>
        <td data-rotulo="Abertura">${esc(l.prazoTexto || '—')}</td>
        <td data-rotulo="Portal">${esc(l.portal || '—')}</td>
        <td data-rotulo="Checklist">${htmlContador(l.id, l.contagem)}</td></tr>`).join('')}</tbody></table>`;
  }
  const brl = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Não informado');
  const dataBr = (iso) => (diaDe(iso) ? diaDe(iso).split('-').reverse().join('/') : '—');
  // processos: linhas de operacao_processos com status 'arquivado'. linkEdital(p) devolve URL segura ou null.
  function htmlArquivados(processos, linkEdital) {
    if (!processos.length) return '<div class="kanban-vazio">Nada arquivado nesta empresa. Ao tirar uma licitação do Funil, ela vem para cá com edital, itens e preços guardados.</div>';
    return `<p class="funil-fraco funil-arquivados-ajuda">Licitações tiradas do Funil. Abra o dossiê para rever itens, preços e proposta, ou o edital oficial.</p>
      <ul class="funil-arquivados">${processos.map((p) => {
        const url = linkEdital(p);
        return `<li class="funil-arquivado">
          <p class="kanban-card-objeto">${esc(p.objeto || 'Licitação sem título')}</p>
          <p class="funil-fraco">${esc(p.orgao || 'Órgão não informado')}${p.modalidade ? ` · ${esc(p.modalidade)}` : ''}</p>
          <p class="funil-fraco">Valor estimado: ${esc(brl(p.valor_estimado))} · Arquivada em ${esc(dataBr(p.atualizado_em))}</p>
          <div class="funil-arquivado-acoes">
            <a class="btn-imprimir" href="processos?origem=${encodeURIComponent(p.origem_externa_id || '')}">Abrir dossiê (itens e preços)</a>
            ${url ? `<a class="btn-imprimir" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ver edital</a>` : ''}
            <button type="button" class="btn-imprimir" data-funil-restaurar="${esc(p.id)}">Voltar ao Funil</button>
          </div></li>`;
      }).join('')}</ul>`;
  }

  // ---- Diálogo do checklist ----
  // ctx: { titulo, etapas, etapaAtual, marcas, esteira, podeEditar, marcar(marcas), salvarTarefas(etapa, tarefas), abrirLink(tipo) }
  function abrirChecklist(dialogo, ctx) {
    let editando = false;
    let ocupado = false;
    let marcas = { ...(ctx.marcas || {}) };
    let etapas = ctx.etapas;
    const aviso = (texto) => { const el = dialogo.querySelector('[data-funil-aviso]'); if (el) { el.textContent = texto || ''; el.hidden = !texto; } };

    function desenhar(mensagem) {
      const atual = etapas.find((e) => e.id === ctx.etapaAtual?.id) || ctx.etapaAtual;
      const c = contarChecklist(etapas, atual, marcas, ctx.esteira);
      const grupos = gruposDoCaminho(etapas, atual).map(({ etapa, tarefas }) => {
        const feitas = tarefas.filter((t) => tarefaFeita(t, marcas, ctx.esteira)).length;
        const pct = tarefas.length ? Math.round((feitas / tarefas.length) * 100) : 0;
        const itens = tarefas.map((t) => {
          const auto = Boolean(t.esteira && ctx.esteira?.[t.esteira] === 'feito');
          const feita = tarefaFeita(t, marcas, ctx.esteira);
          const link = t.link ? `<button type="button" class="funil-link" data-funil-link="${t.link}">${LINKS[t.link]}</button>` : '';
          if (editando) {
            return `<li class="funil-tarefa"><input type="text" class="funil-tarefa-nome" maxlength="120" value="${esc(t.titulo)}" data-funil-renomear="${esc(etapa.id)}" data-tarefa="${esc(t.id)}" aria-label="Nome da tarefa">
              <button type="button" class="funil-remover" data-funil-remover="${esc(etapa.id)}" data-tarefa="${esc(t.id)}" aria-label="Remover a tarefa ${esc(t.titulo)}">Remover</button></li>`;
          }
          return `<li class="funil-tarefa${feita ? ' feita' : ''}"><label><input type="checkbox" data-funil-marcar="${esc(t.id)}" ${feita ? 'checked' : ''} ${auto ? 'disabled' : ''}> ${esc(t.titulo)}</label>
            ${auto ? '<span class="funil-auto">Feito pela esteira automática</span>' : ''}${link}</li>`;
        }).join('');
        const editar = editando ? `<form class="funil-nova" data-funil-nova="${esc(etapa.id)}"><input type="text" maxlength="120" placeholder="Nova tarefa" aria-label="Nova tarefa em ${esc(etapa.nome)}"><button type="submit" class="btn-imprimir">Adicionar</button>
            ${Array.isArray(etapa.tarefas) ? `<button type="button" class="funil-link" data-funil-padrao="${esc(etapa.id)}">Voltar ao padrão</button>` : ''}</form>` : '';
        return `<div class="funil-grupo"><h4>${esc(etapa.nome)} <span class="funil-fraco">${pct}%</span></h4>
          <div class="funil-barra" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <ul class="funil-tarefas">${itens || '<li class="funil-fraco">Sem tarefas nesta etapa.</li>'}</ul>${editar}</div>`;
      }).join('');
      dialogo.innerHTML = `
        <div class="etapas-dialogo-topo"><h3 id="funil-checklist-titulo">Checklist · ${c.feitas} de ${c.total}</h3>
          <div class="funil-topo-acoes">${ctx.podeEditar ? `<button type="button" class="btn-imprimir" data-funil-editar aria-pressed="${editando}">${editando ? 'Concluir edição' : 'Editar tarefas'}</button>` : ''}
          <button type="button" class="btn-imprimir" data-funil-fechar>Fechar</button></div></div>
        <p class="etapas-ajuda">${esc(ctx.titulo)}</p>
        ${editando ? '<p class="etapas-ajuda">As tarefas valem para todas as licitações desta etapa, em todas as empresas da conta. Renomear não apaga o que já foi marcado.</p>' : ''}
        <p class="erro-campo" role="alert" data-funil-aviso hidden></p>
        ${grupos || '<p class="funil-fraco">Este Funil ainda não tem etapas com tarefas.</p>'}`;
      aviso(mensagem);
    }

    async function marcar(id, valor) {
      const novas = { ...marcas };
      if (valor) novas[id] = new Date().toISOString(); else delete novas[id];
      ocupado = true;
      try { await ctx.marcar(novas); marcas = novas; desenhar(); }
      catch (erro) { desenhar(erro.message || 'Não foi possível salvar a tarefa.'); }
      finally { ocupado = false; }
    }
    async function trocarTarefas(etapaId, mudar) {
      const etapa = etapas.find((e) => e.id === etapaId);
      if (!etapa) return;
      const tarefas = mudar === null ? null : normalizarTarefas(mudar(tarefasDaEtapa(etapa)));
      ocupado = true;
      try {
        const salva = await ctx.salvarTarefas(etapa, tarefas);
        etapas = etapas.map((e) => (e.id === etapaId ? salva : e));
        desenhar();
      } catch (erro) { desenhar(erro.message || 'Não foi possível salvar as tarefas.'); }
      finally { ocupado = false; }
    }

    dialogo.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b || ocupado) return;
      if (b.hasAttribute('data-funil-fechar')) dialogo.close();
      else if (b.hasAttribute('data-funil-editar')) { editando = !editando; desenhar(); }
      else if (b.dataset.funilLink) { dialogo.close(); ctx.abrirLink(b.dataset.funilLink); }
      else if (b.dataset.funilRemover) void trocarTarefas(b.dataset.funilRemover, (l) => l.filter((t) => t.id !== b.dataset.tarefa));
      else if (b.dataset.funilPadrao) void trocarTarefas(b.dataset.funilPadrao, null);
    };
    dialogo.onchange = (ev) => {
      const el = ev.target;
      if (ocupado) { desenhar(); return; }
      if (el.dataset.funilMarcar) void marcar(el.dataset.funilMarcar, el.checked);
      else if (el.dataset.funilRenomear) {
        const titulo = el.value.trim();
        if (!titulo) { desenhar('O nome da tarefa não pode ficar vazio.'); return; }
        void trocarTarefas(el.dataset.funilRenomear, (l) => l.map((t) => (t.id === el.dataset.tarefa ? { ...t, titulo } : t)));
      }
    };
    dialogo.onsubmit = (ev) => {
      const form = ev.target.closest('[data-funil-nova]');
      if (!form) return;
      ev.preventDefault();
      const titulo = form.querySelector('input').value.trim();
      if (!titulo || ocupado) return;
      const etapa = etapas.find((e) => e.id === form.dataset.funilNova);
      if (etapa && tarefasDaEtapa(etapa).length >= LIMITE_TAREFAS) { aviso(`Cada etapa aceita até ${LIMITE_TAREFAS} tarefas.`); return; }
      void trocarTarefas(form.dataset.funilNova, (l) => [...l, { id: novoIdTarefa(), titulo }]);
    };
    desenhar();
    if (!dialogo.open) dialogo.showModal();
  }

  const api = { GRUPOS, GRUPOS_POR_ESTAGIO, LIMITE_TAREFAS, tarefasPadrao, tarefasDaEtapa, normalizarTarefas, novoIdTarefa,
    etapasDoCaminho, gruposDoCaminho, tarefaFeita, contarChecklist, filtrarCards, opcoesFiltro, filtroAtivo,
    htmlFiltros, htmlEstrela, htmlContador, htmlLista, htmlArquivados, abrirChecklist };
  global.LicitaFunil = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
