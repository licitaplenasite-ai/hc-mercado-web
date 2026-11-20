/* global module */
// Funil v3 — tarefas avançadas no cartão (modelo Siga Pregão "Ultra", WoOKgKKDMMM 43:30–49:30) e monitor por item.
// Seções com nome livre; cada tarefa com data e hora (vai para a agenda e para o .ics), responsável, e tarefa que só fecha
// com documento anexado ou com resposta escrita; prazos automáticos da Lei 14.133 a partir das datas do processo; selo de
// atrasada; troca de modelo (padrão, nenhuma ou modelo salvo da empresa).
// Sem rede: o painel.html lê/grava operacao_processos.tarefas_card e monitor_itens (supabase/funil_v3.sql) e chama estas
// funções. O banco repete as regras (CHECK + gatilho), então a tela só evita o erro antes de mandar.
// Visual novo (20/11/2026): aguarda aprovação do dono.
(function (global) {
  'use strict';
  const ID = /^[a-z0-9-]{1,40}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const DIA = /^\d{4}-\d{2}-\d{2}$/;
  // Mesmo padrão do banco (pregoes_gravados.sql / funil_v3.sql): número com cara de CPF não é guardado.
  const CPF = /(^|[^0-9])[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}($|[^0-9])/;
  const EXIGE = ['documento', 'resposta'];
  const MAX_SECOES = 12, MAX_TAREFAS = 60, MAX_ITENS = 10, MAX_ARQUIVO = 10 * 1024 * 1024;
  const ARQUIVOS = /\.(pdf|docx?|png|jpe?g)$/i;

  // Lei 14.133: art. 164 (esclarecimento e impugnação até 3 dias úteis antes da abertura), art. 165 (recurso em 3 dias úteis
  // da ata/intimação; contrarrazão em 3 dias úteis da divulgação do recurso). Hora: a da abertura nos prazos "antes";
  // 17h nos prazos "depois" (mais cedo que o fim do dia, para sobrar margem).
  const REGRAS = {
    esclarecimento: { base: 'abertura', dias: -3, texto: 'Prazo automático: 3 dias úteis antes da abertura (Lei 14.133, art. 164)' },
    impugnacao: { base: 'abertura', dias: -3, texto: 'Prazo automático: 3 dias úteis antes da abertura (Lei 14.133, art. 164)' },
    disputa: { base: 'abertura', dias: 0, texto: 'Prazo automático: data da abertura da disputa' },
    recurso: { base: 'ata', dias: 3, hora: '17:00', texto: 'Prazo automático: 3 dias úteis da ata ou intimação (Lei 14.133, art. 165)' },
    contrarrazao: { base: 'aviso_recurso', dias: 3, hora: '17:00', texto: 'Prazo automático: 3 dias úteis do aviso de recurso (Lei 14.133, art. 165, § 4º)' },
  };
  const FALTA_BASE = { abertura: 'Falta a data de abertura', ata: 'Informe a data da ata', aviso_recurso: 'Informe a data do aviso de recurso' };

  const MODELO_PADRAO = [
    { id: 'prazos', nome: 'Prazos do edital (Lei 14.133)', tarefas: [
      { id: 'esclarecimento', titulo: 'Pedir esclarecimento, se precisar', auto: 'esclarecimento' },
      { id: 'impugnacao', titulo: 'Impugnar o edital, se precisar', auto: 'impugnacao' },
      { id: 'disputa', titulo: 'Participar da disputa', auto: 'disputa' },
      { id: 'recurso', titulo: 'Enviar as razões do recurso (se manifestou intenção)', auto: 'recurso' },
      { id: 'contrarrazao', titulo: 'Enviar contrarrazão (se outro licitante recorreu)', auto: 'contrarrazao' },
    ] },
    { id: 'leitura', nome: 'Leitura do edital', tarefas: [
      { id: 'baixar-edital', titulo: 'Baixar o edital e os anexos' },
      { id: 'ler-edital', titulo: 'Ler o edital inteiro' },
      { id: 'anotar-edital', titulo: 'Anotar prazo de entrega, garantia e amostra', exige: 'resposta' },
    ] },
    { id: 'proposta', nome: 'Proposta', tarefas: [{ id: 'proposta-assinada', titulo: 'Anexar a proposta assinada', exige: 'documento' }] },
  ];

  // ---------- dias úteis (feriados nacionais fixos + Sexta-feira Santa) ----------
  // shortcut: sem feriados estaduais/municipais nem ponto facultativo (Carnaval, Corpus Christi); o edital é a fonte final.
  const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return Date.UTC(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  }
  const diaDe = (ms) => new Date(ms).toISOString().slice(0, 10);
  function feriado(dia) {
    return FIXOS.includes(dia.slice(5)) || dia === diaDe(pascoa(Number(dia.slice(0, 4))) - 2 * 864e5);
  }
  function diaUtil(dia) {
    const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    return semana !== 0 && semana !== 6 && !feriado(dia);
  }
  // n > 0: n dias úteis depois (exclui o dia inicial); n < 0: antes; 0: o próprio dia.
  function somarDiasUteis(dia, n) {
    let t = Date.parse(`${dia}T12:00:00Z`);
    for (let falta = Math.abs(n); falta > 0;) {
      t += Math.sign(n) * 864e5;
      if (diaUtil(diaDe(t))) falta -= 1;
    }
    return diaDe(t);
  }

  // ---------- datas ----------
  // Qualquer data do banco -> "AAAA-MM-DDTHH:MM" no horário de Brasília (UTC-3 fixo). Só data = 09:00.
  function paraLocal(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    if (DIA.test(s)) return `${s}T09:00`;
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return s.replace(' ', 'T').slice(0, 16);
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : new Date(ms - 3 * 36e5).toISOString().slice(0, 16);
  }
  const instante = (local) => Date.parse(`${local}:00-03:00`);
  // processo: { abertura, ata } (do banco); card.datas: o que a pessoa informou (ata, aviso de recurso).
  function datasDoCard(card, processo = {}) {
    const d = card?.datas || {};
    return {
      abertura: paraLocal(processo.abertura),
      ata: d.ata ? `${d.ata}T09:00` : paraLocal(processo.ata),
      aviso_recurso: d.aviso_recurso ? `${d.aviso_recurso}T09:00` : null,
    };
  }
  function prazoAuto(auto, datas) {
    const r = REGRAS[auto];
    const base = r && datas?.[r.base];
    if (!base) return null;
    return `${somarDiasUteis(base.slice(0, 10), r.dias)}T${r.hora || base.slice(11, 16)}`;
  }
  const quandoDa = (t, datas) => t.quando || (t.auto ? prazoAuto(t.auto, datas) : null);
  function atrasada(t, datas, agora = Date.now()) {
    const q = quandoDa(t, datas);
    return !t.feita_em && Boolean(q) && instante(q) < agora;
  }

  // ---------- estrutura ----------
  // null = nunca mexeram: vale o modelo padrão (mesma convenção do checklist da etapa).
  const secoesDo = (card) => (card && Array.isArray(card.secoes) ? card.secoes : MODELO_PADRAO);
  const limpo = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  function normalizarTarefa(t) {
    const titulo = limpo(t?.titulo, 160);
    if (!ID.test(t?.id || '') || !titulo) return null;
    const n = { id: t.id, titulo };
    if (EXIGE.includes(t.exige)) n.exige = t.exige;
    if (REGRAS[t.auto]) n.auto = t.auto;
    if (LOCAL.test(t.quando || '')) n.quando = t.quando;
    const resp = limpo(t.responsavel, 80);
    if (resp) n.responsavel = resp;
    const resposta = typeof t.resposta === 'string' ? t.resposta.trim().slice(0, 2000) : '';
    if (resposta) n.resposta = resposta;
    if (UUID.test(t.anexo_id || '')) n.anexo_id = t.anexo_id;
    if (/^\d{4}-\d{2}-\d{2}T/.test(t.feita_em || '') && !motivoParaNaoFechar(n)) n.feita_em = t.feita_em;
    return n;
  }
  function normalizarSecoes(lista) {
    const vistos = new Set();
    let total = 0;
    return (Array.isArray(lista) ? lista : []).slice(0, MAX_SECOES).flatMap((s) => {
      const nome = limpo(s?.nome, 80);
      if (!ID.test(s?.id || '') || !nome || vistos.has(s.id)) return [];
      vistos.add(s.id);
      const tarefas = (Array.isArray(s.tarefas) ? s.tarefas : []).map(normalizarTarefa)
        .filter((t) => t && !vistos.has(t.id) && vistos.add(t.id) && ++total <= MAX_TAREFAS);
      return [{ id: s.id, nome, tarefas }];
    });
  }
  function normalizarCard(card) {
    const saida = { secoes: normalizarSecoes(secoesDo(card)) };
    const datas = {};
    for (const k of ['ata', 'aviso_recurso']) if (DIA.test(card?.datas?.[k] || '')) datas[k] = card.datas[k];
    if (Object.keys(datas).length) saida.datas = datas;
    return saida;
  }
  // Modelo = só a estrutura (o banco recusa modelo com marcação, resposta ou anexo).
  const SO_ESTRUTURA = ['id', 'titulo', 'exige', 'auto', 'quando', 'responsavel'];
  const paraModelo = (secoes) => normalizarSecoes(secoes).map((s) => ({ ...s,
    tarefas: s.tarefas.map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => SO_ESTRUTURA.includes(k)))) }));
  // escolha: 'padrao' | 'nenhum' | id de modelo salvo.
  function cardDoModelo(escolha, modelos) {
    if (escolha === 'nenhum') return { secoes: [] };
    const m = (modelos || []).find((x) => x.id === escolha);
    return { secoes: paraModelo(m ? m.secoes : MODELO_PADRAO) };
  }
  function motivoParaNaoFechar(t) {
    if (t.exige === 'resposta' && !String(t.resposta || '').trim()) return 'Esta tarefa só fecha com uma resposta escrita.';
    if (t.exige === 'documento' && !UUID.test(t.anexo_id || '')) return 'Esta tarefa só fecha com o documento anexado.';
    return null;
  }
  function validarResposta(texto) {
    const s = String(texto || '').trim();
    if (!s) return 'Escreva a resposta para concluir a tarefa.';
    if (s.length > 2000) return 'A resposta pode ter até 2.000 caracteres.';
    if (CPF.test(s)) return 'Não escreva CPF aqui. O sistema não guarda CPF.';
    return null;
  }
  function validarArquivo(arquivo) {
    if (!arquivo) return 'Escolha o arquivo.';
    if (!ARQUIVOS.test(arquivo.name || '')) return 'Use PDF, Word, PNG ou JPG.';
    if (arquivo.size > MAX_ARQUIVO) return 'O arquivo passa de 10 MB.';
    return null;
  }

  function contar(card, datas, agora = Date.now()) {
    const tarefas = secoesDo(card).flatMap((s) => s.tarefas || []);
    return { feitas: tarefas.filter((t) => t.feita_em).length, total: tarefas.length, atrasadas: tarefas.filter((t) => atrasada(t, datas, agora)).length };
  }
  // "1, 3 e 7" -> [1, 3, 7]; null se algo não for número de item válido ou passar de 10.
  function itensDoTexto(texto) {
    const partes = String(texto || '').split(/[\s,;e]+/).filter(Boolean);
    if (!partes.every((p) => /^\d{1,5}$/.test(p) && Number(p) > 0)) return null;
    const itens = [...new Set(partes.map(Number))].sort((a, b) => a - b);
    return itens.length <= MAX_ITENS ? itens : null;
  }
  // Agenda: tarefas abertas com data. processos = [{ id, objeto, empresaId, tarefas_card, abertura, ata }].
  function eventosAgenda(processos) {
    return (processos || []).flatMap((p) => {
      const datas = datasDoCard(p.tarefas_card, p);
      return secoesDo(p.tarefas_card).flatMap((s) => (s.tarefas || []).map((t) => ({ t, quando: quandoDa(t, datas) }))
        .filter(({ t, quando }) => quando && !t.feita_em)
        .map(({ t, quando }) => ({ id: `${p.id}:${t.id}`, titulo: t.titulo, inicio: quando, processo: p.objeto || '', processoId: p.id,
          empresaId: p.empresaId, responsavel: t.responsavel || '' })));
    }).sort((a, b) => a.inicio.localeCompare(b.inicio));
  }
  const novoId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // ---------- HTML ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dataBr = (local) => `${local.slice(8, 10)}/${local.slice(5, 7)} · ${local.slice(11, 16)}`;
  // Botão do cartão + selos (atrasada, sugerida pelo Prospecta).
  function htmlCard(id, c, sugeridaNota) {
    const tudo = c.total > 0 && c.feitas === c.total;
    const atraso = c.atrasadas ? `<span class="ft-selo ft-selo-atrasada">${c.atrasadas === 1 ? '1 tarefa atrasada' : `${c.atrasadas} tarefas atrasadas`}</span>` : '';
    const sugerida = Number.isInteger(sugeridaNota) ? `<span class="ft-sugerida"><span class="ft-selo ft-selo-sugerida" title="O Prospecta pôs esta licitação no Funil a partir do boletim">Sugerida · nota ${sugeridaNota}</span>
      <button type="button" class="funil-link" data-funil-aceitar="${esc(id)}">Manter</button><button type="button" class="funil-link" data-funil-dispensar="${esc(id)}">Dispensar</button></span>` : '';
    return `<button type="button" class="funil-contador ft-botao${tudo ? ' completo' : ''}" data-funil-tarefas="${esc(id)}" aria-label="Tarefas: ${c.feitas} de ${c.total} concluídas. Abrir tarefas">▤ Tarefas ${c.feitas} de ${c.total}</button>${atraso}${sugerida}`;
  }
  function htmlTarefa(t, ctxTela) {
    const { datas, secoes, editando, concluindo, agora } = ctxTela;
    const q = quandoDa(t, datas);
    const atraso = atrasada(t, datas, agora);
    const chips = [
      q ? `<span class="ft-chip${atraso ? ' ft-chip-atrasada' : ''}">📅 ${esc(dataBr(q))}${atraso ? ' · atrasada' : ''}</span>` : '',
      t.auto ? `<span class="ft-chip" title="${esc(REGRAS[t.auto].texto)}">${q ? 'Prazo automático' : esc(FALTA_BASE[REGRAS[t.auto].base])}</span>` : '',
      t.exige === 'documento' ? `<span class="ft-chip">${t.anexo_id ? 'Documento anexado' : 'Exige documento'}</span>` : '',
      t.exige === 'resposta' ? '<span class="ft-chip">Exige resposta</span>' : '',
      t.responsavel ? `<span class="ft-chip">Responsável: ${esc(t.responsavel)}</span>` : '',
    ].join('');
    let extra = '';
    if (concluindo === t.id && t.exige === 'resposta') {
      extra = `<form class="ft-prova" data-ft-resposta="${esc(t.id)}"><label>Sua resposta<textarea maxlength="2000" rows="3">${esc(t.resposta || '')}</textarea></label>
        <div class="ft-acoes"><button type="submit" class="btn-imprimir">Concluir</button><button type="button" class="funil-link" data-ft-cancelar>Cancelar</button></div></form>`;
    } else if (concluindo === t.id && t.exige === 'documento') {
      extra = `<form class="ft-prova" data-ft-anexo="${esc(t.id)}"><label>Documento (PDF, Word ou imagem, até 10 MB)<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"></label>
        <div class="ft-acoes"><button type="submit" class="btn-imprimir">Anexar e concluir</button><button type="button" class="funil-link" data-ft-cancelar>Cancelar</button></div></form>`;
    } else if (editando === t.id) {
      const opcoesSecao = secoes.map((s) => `<option value="${esc(s.id)}" ${s.tarefas.some((x) => x.id === t.id) ? 'selected' : ''}>${esc(s.nome)}</option>`).join('');
      extra = `<form class="ft-edicao" data-ft-edicao="${esc(t.id)}">
        <label>Tarefa<input name="titulo" maxlength="160" required value="${esc(t.titulo)}"></label>
        <label>Data e hora<input name="quando" type="datetime-local" value="${esc(t.quando || '')}"></label>
        <label>Responsável<input name="responsavel" maxlength="80" value="${esc(t.responsavel || '')}" placeholder="Nome de quem faz"></label>
        <label>Só fecha com<select name="exige"><option value="">Nada (marcar basta)</option><option value="documento" ${t.exige === 'documento' ? 'selected' : ''}>Documento anexado</option><option value="resposta" ${t.exige === 'resposta' ? 'selected' : ''}>Resposta escrita</option></select></label>
        <label>Seção<select name="secao">${opcoesSecao}</select></label>
        <div class="ft-acoes"><button type="submit" class="btn-imprimir">Salvar</button><button type="button" class="funil-link" data-ft-cancelar>Cancelar</button></div></form>`;
    }
    const resposta = t.feita_em && t.resposta ? `<p class="ft-resposta">${esc(t.resposta)}</p>` : '';
    return `<li class="ft-tarefa${t.feita_em ? ' feita' : ''}${atraso ? ' atrasada' : ''}" data-tarefa="${esc(t.id)}">
      <div class="ft-linha"><label class="ft-marcar"><input type="checkbox" data-ft-marcar="${esc(t.id)}" ${t.feita_em ? 'checked' : ''}> <span>${esc(t.titulo)}</span></label>
        <span class="ft-menu"><button type="button" class="funil-link" data-ft-editar="${esc(t.id)}">Editar</button><button type="button" class="funil-link" data-ft-remover="${esc(t.id)}" aria-label="Remover a tarefa ${esc(t.titulo)}">Remover</button></span></div>
      <div class="ft-chips">${chips}<span data-ft-agenda="${esc(t.id)}"></span></div>${resposta}${extra}</li>`;
  }

  // ---------- diálogo ----------
  // ctx: { titulo, card (tarefas_card ou null), processo {abertura, ata}, modelos [{id,nome,secoes}], monitorItens [int],
  //        salvar(card), anexar(arquivo, tarefa) -> id do anexo, salvarModelo(nome, secoes) -> modelo, salvarItens(itens), empresaId, processoId }
  function abrirTarefas(dialogo, ctx) {
    let card = ctx.card ? normalizarCard(ctx.card) : null;
    let modelos = ctx.modelos || [];
    let itens = ctx.monitorItens || [];
    let editando = null, concluindo = null, ocupado = false, mensagem = '';
    const atual = () => card || { secoes: paraModelo(MODELO_PADRAO) };

    function desenhar() {
      const secoes = secoesDo(atual());
      const datas = datasDoCard(atual(), ctx.processo);
      const agora = Date.now();
      const c = contar(atual(), datas, agora);
      const pct = c.total ? Math.round((c.feitas / c.total) * 100) : 0;
      const tela = { datas, secoes, editando, concluindo, agora };
      const htmlSecoes = secoes.map((s) => {
        const feitas = s.tarefas.filter((t) => t.feita_em).length;
        return `<div class="ft-secao"><div class="ft-secao-topo">
            <input class="ft-secao-nome" maxlength="80" value="${esc(s.nome)}" data-ft-nome-secao="${esc(s.id)}" aria-label="Nome da seção">
            <span class="funil-fraco">${feitas}/${s.tarefas.length}</span>
            <button type="button" class="funil-link" data-ft-remover-secao="${esc(s.id)}">Remover seção</button></div>
          <div class="funil-barra" aria-hidden="true"><span style="width:${s.tarefas.length ? Math.round((feitas / s.tarefas.length) * 100) : 0}%"></span></div>
          <ul class="ft-tarefas">${s.tarefas.map((t) => htmlTarefa(t, tela)).join('') || '<li class="funil-fraco">Sem tarefas nesta seção.</li>'}</ul>
          <form class="ft-nova" data-ft-nova="${esc(s.id)}"><input maxlength="160" placeholder="Descreva a tarefa e pressione Enter" aria-label="Nova tarefa em ${esc(s.nome)}"><button type="submit" class="btn-imprimir">Adicionar</button></form>
        </div>`;
      }).join('');
      const opcoesModelo = [['padrao', 'Padrão do LicitaPlena'], ['nenhum', 'Nenhuma tarefa'], ...modelos.map((m) => [m.id, m.nome])]
        .map(([v, r]) => `<option value="${esc(v)}">${esc(r)}</option>`).join('');
      dialogo.innerHTML = `
        <div class="etapas-dialogo-topo"><h3 id="funil-tarefas-titulo">Tarefas · ${c.feitas} de ${c.total} concluídas (${pct}%)</h3>
          <div class="funil-topo-acoes"><button type="button" class="btn-imprimir" data-ft-fechar>Fechar</button></div></div>
        <p class="etapas-ajuda">${esc(ctx.titulo)}</p>
        ${c.atrasadas ? `<p class="ft-alerta">${c.atrasadas === 1 ? '1 tarefa atrasada' : `${c.atrasadas} tarefas atrasadas`}.</p>` : ''}
        <p class="erro-campo" role="alert" data-ft-aviso ${mensagem ? '' : 'hidden'}>${esc(mensagem)}</p>
        <div class="ft-datas">
          <span>Abertura: <strong>${datas.abertura ? esc(dataBr(datas.abertura)) : 'não informada'}</strong></span>
          <label>Data da ata (resultado)<input type="date" data-ft-data="ata" value="${esc(atual().datas?.ata || (datas.ata || '').slice(0, 10))}"></label>
          <label>Aviso de recurso<input type="date" data-ft-data="aviso_recurso" value="${esc(atual().datas?.aviso_recurso || '')}"></label>
        </div>
        <p class="funil-fraco ft-ajuda">Os prazos automáticos seguem a Lei 14.133 e contam só feriados nacionais. Confira sempre no edital.</p>
        ${htmlSecoes || '<p class="funil-fraco">Nenhuma tarefa. Crie uma seção ou escolha um modelo.</p>'}
        <form class="ft-nova ft-nova-secao" data-ft-nova-secao><input maxlength="80" placeholder="Nova seção (ex.: Leitura do edital)" aria-label="Nome da nova seção"><button type="submit" class="btn-imprimir">+ Seção</button></form>
        <details class="ft-modelos"><summary>Modelos de tarefas</summary>
          <div class="ft-acoes"><label>Trocar as tarefas por<select data-ft-modelo>${opcoesModelo}</select></label><button type="button" class="btn-imprimir" data-ft-aplicar-modelo>Aplicar</button></div>
          <form class="ft-acoes" data-ft-salvar-modelo><label>Salvar estas tarefas como modelo<input maxlength="60" placeholder="Nome do modelo (ex.: Dispensa)"></label><button type="submit" class="btn-imprimir">Salvar modelo</button></form>
        </details>
        <div class="ft-monitor"><h4>Monitor do pregão</h4>
          <p class="funil-fraco">O robô confere esta licitação no PNCP e lê as mensagens do chat que a extensão "Acompanhar chat" gravou. Quando o pregoeiro citar o CNPJ da sua empresa, você recebe aviso no celular e por e-mail.</p>
          <form class="ft-acoes" data-ft-itens><label>Itens para acompanhar (até 10)<input inputmode="numeric" placeholder="Ex.: 1, 3, 7" value="${esc(itens.join(', '))}"></label><button type="submit" class="btn-imprimir">Salvar itens</button></form>
          <p class="funil-fraco">${itens.length ? `Acompanhando os itens ${esc(itens.join(', '))}: só mudanças e mensagens desses itens (e as que citam sua empresa) geram aviso.` : 'Sem itens escolhidos: toda mudança gera aviso.'}</p>
        </div>`;
      if (global.AgendaIcs) {
        for (const t of secoes.flatMap((s) => s.tarefas)) {
          const q = quandoDa(t, datas);
          const alvo = !t.feita_em && q && dialogo.querySelector(`[data-ft-agenda="${t.id}"]`);
          const botao = alvo && global.AgendaIcs.montarBotao(global.document, { id: `${ctx.processoId}-${t.id}`, titulo: t.titulo, inicio: q,
            processo: ctx.titulo, empresaId: ctx.empresaId, processoId: ctx.processoId });
          if (botao) alvo.append(botao);
        }
      }
    }
    const aviso = (texto) => { mensagem = texto || ''; desenhar(); };
    async function salvar(novo) {
      if (ocupado) return false;
      ocupado = true;
      try { const n = normalizarCard(novo); await ctx.salvar(n); card = n; mensagem = ''; editando = null; concluindo = null; desenhar(); return true; }
      catch (erro) { aviso(erro.message || 'Não foi possível salvar as tarefas.'); return false; }
      finally { ocupado = false; }
    }
    const mudarTarefa = (id, f) => ({ ...atual(), secoes: secoesDo(atual()).map((s) => ({ ...s, tarefas: s.tarefas.map((t) => (t.id === id ? f({ ...t }) : t)) })) });
    const acharTarefa = (id) => secoesDo(atual()).flatMap((s) => s.tarefas).find((t) => t.id === id);

    dialogo.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b || ocupado) return;
      if (b.hasAttribute('data-ft-fechar')) dialogo.close();
      else if (b.hasAttribute('data-ft-cancelar')) { editando = null; concluindo = null; desenhar(); }
      else if (b.dataset.ftEditar) { editando = b.dataset.ftEditar; concluindo = null; desenhar(); }
      else if (b.dataset.ftRemover) void salvar({ ...atual(), secoes: secoesDo(atual()).map((s) => ({ ...s, tarefas: s.tarefas.filter((t) => t.id !== b.dataset.ftRemover) })) });
      else if (b.dataset.ftRemoverSecao) void salvar({ ...atual(), secoes: secoesDo(atual()).filter((s) => s.id !== b.dataset.ftRemoverSecao) });
      else if (b.hasAttribute('data-ft-aplicar-modelo')) {
        const escolha = dialogo.querySelector('[data-ft-modelo]').value;
        const temFeita = contar(atual(), {}).feitas > 0;
        if (temFeita && !global.confirm('Trocar as tarefas apaga as marcações deste cartão. Continuar?')) return;
        void salvar({ ...cardDoModelo(escolha, modelos), datas: atual().datas });
      }
    };
    dialogo.onchange = (ev) => {
      const el = ev.target;
      if (ocupado) return;
      if (el.dataset.ftMarcar) {
        const t = acharTarefa(el.dataset.ftMarcar);
        if (!t) return;
        if (!el.checked) { void salvar(mudarTarefa(t.id, (x) => { delete x.feita_em; return x; })); return; }
        if (t.exige) { el.checked = false; concluindo = t.id; editando = null; mensagem = ''; desenhar(); return; }
        void salvar(mudarTarefa(t.id, (x) => ({ ...x, feita_em: new Date().toISOString() })));
      } else if (el.dataset.ftNomeSecao) {
        const nome = limpo(el.value, 80);
        if (!nome) { aviso('O nome da seção não pode ficar vazio.'); return; }
        void salvar({ ...atual(), secoes: secoesDo(atual()).map((s) => (s.id === el.dataset.ftNomeSecao ? { ...s, nome } : s)) });
      } else if (el.dataset.ftData) {
        const datas = { ...(atual().datas || {}) };
        if (DIA.test(el.value)) datas[el.dataset.ftData] = el.value; else delete datas[el.dataset.ftData];
        void salvar({ ...atual(), datas });
      }
    };
    dialogo.onsubmit = async (ev) => {
      const form = ev.target.closest('form');
      if (!form) return;
      ev.preventDefault();
      if (ocupado) return;
      const campo = form.querySelector('input:not([type=file]),textarea');
      if (form.dataset.ftNova) {
        const titulo = limpo(campo.value, 160);
        if (!titulo) return;
        if (contar(atual(), {}).total >= MAX_TAREFAS) { aviso(`Cada cartão aceita até ${MAX_TAREFAS} tarefas.`); return; }
        await salvar({ ...atual(), secoes: secoesDo(atual()).map((s) => (s.id === form.dataset.ftNova ? { ...s, tarefas: [...s.tarefas, { id: novoId('t'), titulo }] } : s)) });
      } else if (form.hasAttribute('data-ft-nova-secao')) {
        const nome = limpo(campo.value, 80);
        if (!nome) return;
        if (secoesDo(atual()).length >= MAX_SECOES) { aviso(`Cada cartão aceita até ${MAX_SECOES} seções.`); return; }
        await salvar({ ...atual(), secoes: [...secoesDo(atual()), { id: novoId('s'), nome, tarefas: [] }] });
      } else if (form.dataset.ftEdicao) {
        const f = new global.FormData(form);
        const id = form.dataset.ftEdicao;
        const titulo = limpo(f.get('titulo'), 160);
        if (!titulo) { aviso('A tarefa precisa de um nome.'); return; }
        if (CPF.test(`${titulo} ${f.get('responsavel')}`)) { aviso('Não escreva CPF aqui. O sistema não guarda CPF.'); return; }
        const t = { ...acharTarefa(id), titulo, responsavel: f.get('responsavel'), exige: f.get('exige') || undefined, quando: f.get('quando') || undefined };
        if (!t.quando) delete t.quando;
        if (t.feita_em && motivoParaNaoFechar(t)) delete t.feita_em;
        const destino = f.get('secao');
        await salvar({ ...atual(), secoes: secoesDo(atual()).map((s) => {
          const sem = s.tarefas.filter((x) => x.id !== id);
          return s.id === destino ? { ...s, tarefas: s.tarefas.some((x) => x.id === id) ? s.tarefas.map((x) => (x.id === id ? t : x)) : [...sem, t] } : { ...s, tarefas: sem };
        }) });
      } else if (form.dataset.ftResposta) {
        const erro = validarResposta(campo.value);
        if (erro) { aviso(erro); return; }
        await salvar(mudarTarefa(form.dataset.ftResposta, (x) => ({ ...x, resposta: campo.value.trim(), feita_em: new Date().toISOString() })));
      } else if (form.dataset.ftAnexo) {
        const arquivo = form.querySelector('input[type=file]').files[0];
        const erro = validarArquivo(arquivo);
        if (erro) { aviso(erro); return; }
        const t = acharTarefa(form.dataset.ftAnexo);
        ocupado = true;
        let anexoId;
        try { anexoId = await ctx.anexar(arquivo, t); } catch (e) { ocupado = false; aviso(e.message || 'Não foi possível enviar o documento.'); return; }
        ocupado = false;
        await salvar(mudarTarefa(t.id, (x) => ({ ...x, anexo_id: anexoId, feita_em: new Date().toISOString() })));
      } else if (form.hasAttribute('data-ft-salvar-modelo')) {
        const nome = limpo(campo.value, 60);
        if (!nome) { aviso('Dê um nome ao modelo.'); return; }
        ocupado = true;
        try { const m = await ctx.salvarModelo(nome, paraModelo(secoesDo(atual()))); modelos = [...modelos, m]; mensagem = ''; desenhar(); }
        catch (e) { aviso(e.message || 'Não foi possível salvar o modelo.'); }
        finally { ocupado = false; }
      } else if (form.hasAttribute('data-ft-itens')) {
        const novos = itensDoTexto(campo.value);
        if (!novos) { aviso('Informe até 10 números de item, separados por vírgula.'); return; }
        ocupado = true;
        try { await ctx.salvarItens(novos); itens = novos; mensagem = ''; desenhar(); }
        catch (e) { aviso(e.message || 'Não foi possível salvar os itens.'); }
        finally { ocupado = false; }
      }
    };
    desenhar();
    if (!dialogo.open) dialogo.showModal();
  }

  const api = { MODELO_PADRAO, REGRAS, feriado, diaUtil, somarDiasUteis, paraLocal, datasDoCard, prazoAuto, atrasada, normalizarCard,
    paraModelo, cardDoModelo, motivoParaNaoFechar, validarResposta, validarArquivo, contar, itensDoTexto, eventosAgenda, htmlCard, abrirTarefas };
  global.LicitaFunilTarefas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
