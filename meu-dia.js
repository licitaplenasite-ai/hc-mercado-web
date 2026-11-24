/* global module */
// Meu dia (topo da tela Hoje do sistema.html): uma lista só do que pede atenção, em Atrasado, Hoje e Próximos 7 dias,
// mais "Mais adiante" recolhido (certidão que vence em até 30 dias). Tudo vem do catálogo /api/contextos-operacao:
//  - prazos e agenda abertos (inclui os automáticos do art. 164 de supabase/prazos_legais.sql);
//  - sessões de disputa (data da sessão do processo), com o aviso de que a intenção de recurso é na hora;
//  - certidões vencidas ou vencendo; tarefas com data do cartão do Funil; cartões parados no Funil (funil_crm.sql).
// Bloco que o servidor não leu chega null e vira aviso; bloco ausente (SQL não aplicado) só não aparece.
// Texto do banco entra sempre por textContent. O cálculo (montarItens/agrupar) não toca DOM e é testado no Node.
(function (global) {
  'use strict';
  const MS_DIA = 864e5, FUSO_BR = -3 * 36e5, ADIANTE = 7;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const diaBrasilia = (ms) => Math.floor((ms + FUSO_BR) / MS_DIA);
  const isoDoDia = (d) => new Date(d * MS_DIA).toISOString().slice(0, 10);
  const dataBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const horaBr = (ms) => new Date(ms + FUSO_BR).toISOString().slice(11, 16);

  const CATEGORIAS = {
    esclarecimento: 'Esclarecimento', impugnacao: 'Impugnação', proposta: 'Proposta', sessao: 'Sessão', diligencia: 'Diligência',
    recurso: 'Recurso', assinatura: 'Assinatura do contrato', entrega: 'Entrega', renovacao: 'Renovação', outro: 'Prazo',
  };
  // Base legal mostrada no item (texto conferido no Planalto em 24/11/2026). O edital prevalece.
  const BASE_LEGAL = { esclarecimento: 'Lei 14.133, art. 164', impugnacao: 'Lei 14.133, art. 164', recurso: 'Lei 14.133, art. 165' };
  const DIREITOS = ['esclarecimento', 'impugnacao'];
  const FINAIS = ['perdido', 'contratado', 'arquivado'];
  const GRUPOS = [
    { chave: 'atrasado', titulo: 'Atrasado', vazio: '' },
    { chave: 'hoje', titulo: 'Hoje', vazio: '' },
    { chave: 'proximos', titulo: 'Próximos 7 dias', vazio: '' },
    { chave: 'depois', titulo: 'Mais adiante', vazio: '' },
  ];

  function selo(dias) {
    if (dias < 0) return 'Atrasado há ' + plural(-dias, 'dia', 'dias');
    if (dias === 0) return 'Hoje';
    if (dias === 1) return 'Amanhã';
    return 'Em ' + plural(dias, 'dia', 'dias');
  }
  const situacao = (dias) => (dias < 0 ? 'atrasado' : dias <= 1 ? 'atencao' : 'em-dia');
  const grupoDe = (dias) => (dias < 0 ? 'atrasado' : dias === 0 ? 'hoje' : dias <= ADIANTE ? 'proximos' : 'depois');

  // dados: catálogo normalizado ({ prazos, certidoes, tarefas, parados } e contextos); agora em ms; calc = JuridicoPrazos.
  // Devolve itens sem DOM: { chave, tipo, dias, ordem, titulo, detalhes[], empresaId, processoId, acao }.
  function montarItens(dados, agora, calc) {
    const hoje = diaBrasilia(agora);
    const contextos = Array.isArray(dados?.contextos) ? dados.contextos : [];
    const porProcesso = new Map(contextos.map((c) => [c.processoId, c]));
    const rotuloDe = (c) => (c ? [txt(c.processoRotulo, 80), txt(c.objeto, 140)].filter(Boolean).join(' · ') : '');
    const rotuloProcesso = (id) => rotuloDe(porProcesso.get(id));
    const abrirProcesso = (empresaId, processoId) => ({ tipo: 'processo', empresaId, processoId, texto: 'Abrir processo' });
    const lista = (v) => (Array.isArray(v) ? v : []);
    // Processo perdido, contratado ou arquivado não pede mais nada: some do Meu dia (o arquivado nem vem no catálogo).
    const encerrado = (processoId) => Boolean(processoId) && FINAIS.includes(porProcesso.get(processoId)?.status);
    const comEmpresa = (empresaId) => (UUID.test(empresaId || '') ? 'empresa=' + empresaId : '');
    // shortcut: o painel.html ainda não abre um cartão do Funil pela URL; o link leva só ao Funil.
    const abrirFunil = { tipo: 'link', href: 'painel.html#kanban', texto: 'Abrir no Funil' };
    const itens = [];

    // Sessões de hoje até 7 dias. A intenção de recurso é imediata (art. 165, § 1º, I); as razões, 3 dias úteis da ata.
    const comSessao = new Set();
    for (const c of contextos) {
      if (encerrado(c.processoId)) continue;
      const ms = Date.parse(c.prazo || '');
      if (!Number.isFinite(ms)) continue;
      comSessao.add(c.processoId);
      const dias = diaBrasilia(ms) - hoje;
      if (dias < 0 || dias > ADIANTE) continue;
      const diaSessao = isoDoDia(diaBrasilia(ms));
      const razoes = calc?.somarDiasUteis ? calc.somarDiasUteis(diaSessao, 3) : null;
      itens.push({ chave: 'sessao:' + c.processoId, tipo: 'sessao', rotuloTipo: 'Sessão de disputa', dias, ordem: ms,
        titulo: (rotuloDe(c) || 'Processo') + ' · às ' + horaBr(ms) + ' (horário de Brasília)',
        detalhes: ['Intenção de recurso: na hora, durante a sessão, ou perde o direito (Lei 14.133, art. 165, § 1º, I).'
          + (razoes ? ' Se manifestar, as razões vão até ' + dataBr(razoes) + ' (3 dias úteis, se a ata sair no dia; confira no portal).' : '')],
        empresaId: c.empresaId, processoId: c.processoId, acao: abrirProcesso(c.empresaId, c.processoId) });
    }

    for (const p of lista(dados?.prazos)) {
      if (!Number.isInteger(p?.dias)) continue;
      // O prazo "Sessão" gravado por processos.html repete a sessão acima.
      if (p.categoria === 'sessao' && p.processoId && comSessao.has(p.processoId)) continue;
      if (encerrado(p.processoId)) continue;
      // Esclarecer e impugnar são direitos, não obrigações: passado o prazo, não há o que fazer e não é "atrasado".
      if (p.dias < 0 && DIREITOS.includes(p.categoria)) continue;
      const ms = Date.parse(p.vencimento || '');
      const base = BASE_LEGAL[p.categoria];
      const quando = Number.isFinite(ms) ? dataBr(isoDoDia(diaBrasilia(ms))) + ' às ' + horaBr(ms) + ' (horário de Brasília)' : '';
      // Prazo "antes da abertura" depois da sessão: alguém corrigiu à mão e a sessão mudou depois.
      const sessao = Date.parse(porProcesso.get(p.processoId)?.prazo || '');
      const depoisDaSessao = DIREITOS.includes(p.categoria) && Number.isFinite(ms) && Number.isFinite(sessao) && ms > sessao;
      itens.push({ chave: 'prazo:' + p.id, tipo: 'prazo', rotuloTipo: base ? 'Prazo legal' : CATEGORIAS[p.categoria] || 'Prazo', dias: p.dias, ordem: ms,
        titulo: txt(p.titulo, 200) || CATEGORIAS[p.categoria] || 'Prazo',
        detalhes: [depoisDaSessao ? 'Confira esta data: a sessão mudou e este prazo ficou depois dela' : '',
          p.processoId ? rotuloProcesso(p.processoId) : 'Agenda', quando, base ? base + ' · o prazo do edital prevalece' : ''],
        situacao: depoisDaSessao ? 'atencao' : undefined,
        empresaId: p.empresaId || null, processoId: p.processoId || null,
        acao: p.processoId ? abrirProcesso(p.empresaId, p.processoId)
          : { tipo: 'link', href: 'operacao.html?aba=agenda' + (UUID.test(p.empresaId || '') ? '&empresa=' + p.empresaId : ''), texto: 'Ver agenda' },
        corrigir: base && p.processoId && UUID.test(p.id || '') ? 'processos.html?' + [comEmpresa(p.empresaId), 'prazo=' + p.id].filter(Boolean).join('&') : null,
        agenda: { id: p.id, titulo: txt(p.titulo, 200) || 'Prazo', inicio: p.vencimento, processo: rotuloProcesso(p.processoId), empresaId: p.empresaId, processoId: p.processoId } });
    }

    for (const c of lista(dados?.certidoes)) {
      if (!Number.isInteger(c?.dias)) continue;
      const venc = /^\d{4}-\d{2}-\d{2}$/.test(c.vencimento || '') ? c.vencimento.split('-').reverse().join('/') : '';
      itens.push({ chave: 'certidao:' + c.empresaId + ':' + c.tipo + ':' + c.vencimento, tipo: 'certidao', rotuloTipo: 'Certidão', dias: c.dias, ordem: c.dias * MS_DIA,
        titulo: [txt(c.tipo, 120) || 'Documento', txt(c.titulo, 200)].filter(Boolean).join(' · '),
        detalhes: [(c.dias < 0 ? 'Vencida em ' : 'Vence em ') + venc],
        empresaId: c.empresaId, processoId: null,
        acao: UUID.test(c.empresaId || '') ? { tipo: 'link', href: 'operacao.html?aba=documentos&empresa=' + c.empresaId, texto: 'Renovar ou subir nova' } : null });
    }

    for (const t of lista(dados?.tarefas)) {
      if (!Number.isInteger(t?.dias) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t.inicio || '') || encerrado(t.processoId)) continue;
      itens.push({ chave: 'tarefa:' + t.id, tipo: 'tarefa', rotuloTipo: 'Tarefa do Funil', dias: t.dias, ordem: Date.parse(t.inicio + ':00-03:00'),
        titulo: txt(t.titulo, 160) || 'Tarefa',
        detalhes: [rotuloProcesso(t.processoId), dataBr(t.inicio) + ' às ' + t.inicio.slice(11, 16) + ' (horário de Brasília)', t.responsavel ? 'Responsável: ' + txt(t.responsavel, 80) : ''],
        empresaId: t.empresaId, processoId: t.processoId, acao: abrirFunil });
    }

    // Cartão parado não tem vencimento: entra como atrasado (já passou do limite da etapa), ordenado pelos dias parado.
    // Conta aproximada (sem etapa_desde, funil_crm.sql não aplicado ou cartão antigo) não entra: daria alarme falso.
    for (const p of lista(dados?.parados)) {
      if (!Number.isInteger(p?.dias) || p.aproximada || encerrado(p.processoId)) continue;
      itens.push({ chave: 'parado:' + p.processoId, tipo: 'parado', rotuloTipo: 'Funil parado', dias: -Math.max(1, p.dias), ordem: 0, seloTexto: 'Parado há ' + plural(p.dias, 'dia', 'dias'),
        titulo: rotuloProcesso(p.processoId) || 'Processo do Funil',
        detalhes: ['Sem movimento além do limite da etapa (' + plural(p.limite, 'dia', 'dias') + '). Defina o próximo passo.'],
        empresaId: p.empresaId, processoId: p.processoId, acao: abrirFunil });
    }
    return itens;
  }

  // Empresa escolhida (plano Assessoria): itens dela + os da organização inteira (agenda sem empresa). '' = todas.
  const filtrar = (itens, empresaId) => (empresaId ? itens.filter((i) => !i.empresaId || i.empresaId === empresaId) : itens);

  function agrupar(itens) {
    const grupos = { atrasado: [], hoje: [], proximos: [], depois: [] };
    for (const i of itens) grupos[grupoDe(i.dias)].push(i);
    const ordem = (a, b) => a.dias - b.dias || (a.ordem || 0) - (b.ordem || 0);
    for (const g of Object.values(grupos)) g.sort(ordem);
    return grupos;
  }

  // Blocos que o servidor não conseguiu ler (null), para o aviso. undefined (SQL não aplicado) não avisa.
  const NOMES_BLOCO = { prazos: 'prazos', certidoes: 'certidões', tarefas: 'tarefas do Funil', parados: 'cartões parados' };
  const blocosComFalha = (dados) => Object.keys(NOMES_BLOCO).filter((k) => dados?.[k] === null).map((k) => NOMES_BLOCO[k]);

  // ---------- tela ----------
  function criar(doc, tag, classe, texto) {
    const n = doc.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined) n.textContent = texto;
    return n;
  }
  function linha(doc, item, nomes, agendaIcs) {
    const li = criar(doc, 'li', 'md-item');
    li.dataset.situacao = item.situacao || situacao(item.dias);
    li.dataset.tipo = item.tipo;
    const topo = criar(doc, 'div', 'md-item-topo');
    topo.append(criar(doc, 'span', 'md-selo', item.seloTexto || selo(item.dias)), criar(doc, 'span', 'md-tipo', item.rotuloTipo));
    const empresa = item.empresaId ? nomes.get(item.empresaId) : 'Toda a organização';
    if (empresa) topo.append(criar(doc, 'span', 'md-empresa', empresa));
    const corpo = criar(doc, 'div', 'md-item-corpo');
    corpo.append(criar(doc, 'p', 'md-item-titulo', item.titulo));
    const detalhe = item.detalhes.filter(Boolean).join(' · ');
    if (detalhe) corpo.append(criar(doc, 'p', 'md-item-detalhe', detalhe));
    const acoes = criar(doc, 'div', 'md-acoes');
    if (item.acao?.tipo === 'processo') {
      const b = criar(doc, 'button', 'app-primario md-abrir', item.acao.texto);
      b.type = 'button';
      b.dataset.empresa = item.acao.empresaId;
      b.dataset.processo = item.acao.processoId;
      b.setAttribute('aria-label', item.acao.texto + ': ' + item.titulo);
      acoes.append(b);
    } else if (item.acao?.tipo === 'link') {
      const a = criar(doc, 'a', 'md-link', item.acao.texto);
      a.href = item.acao.href;
      a.setAttribute('aria-label', item.acao.texto + ': ' + item.titulo);
      acoes.append(a);
    }
    if (item.corrigir) {
      const a = criar(doc, 'a', 'md-link', 'Corrigir data');
      a.href = item.corrigir;
      a.setAttribute('aria-label', 'Corrigir a data de ' + item.titulo + ' pelo edital');
      acoes.append(a);
    }
    const ics = item.agenda && agendaIcs?.montarBotao(doc, { ...item.agenda, empresa: nomes.get(item.empresaId) });
    if (ics) acoes.append(ics);
    li.append(topo, corpo, acoes);
    return li;
  }

  // alvo: contêiner do Meu dia; empresas: [{empresaId, rotulo}]; filtro: empresa escolhida ('' = todas).
  // aoFiltrar(empresaId): o controlador guarda a escolha e chama renderizar de novo.
  function renderizar({ doc, alvo, dados, empresas = [], filtro = '', aoFiltrar = null, agora = Date.now(), calc = global.JuridicoPrazos, agendaIcs = global.AgendaIcs }) {
    const nomes = new Map(empresas.map((e) => [e.empresaId, e.rotulo]));
    const valido = empresas.some((e) => e.empresaId === filtro) ? filtro : '';
    const grupos = agrupar(filtrar(montarItens(dados, agora, calc), valido));
    const urgentes = grupos.atrasado.length + grupos.hoje.length;
    const cartao = criar(doc, 'section', 'app-cartao meu-dia');
    cartao.setAttribute('aria-labelledby', 'meu-dia-titulo');

    const cab = criar(doc, 'div', 'md-cabecalho');
    const titulos = criar(doc, 'div', 'md-titulos');
    const h = criar(doc, 'h2', 'md-titulo', 'Meu dia');
    h.id = 'meu-dia-titulo';
    const resumo = criar(doc, 'p', 'md-resumo');
    resumo.append(criar(doc, 'strong', 'md-numero', String(urgentes)),
      criar(doc, 'span', '', urgentes === 1 ? ' item pede atenção hoje' : ' itens pedem atenção hoje'));
    const contagem = criar(doc, 'p', 'md-contagem',
      [plural(grupos.atrasado.length, 'atrasado', 'atrasados'), plural(grupos.hoje.length, 'para hoje', 'para hoje'),
        plural(grupos.proximos.length, 'nos próximos 7 dias', 'nos próximos 7 dias')].join(' · '));
    titulos.append(h, resumo, contagem);
    cab.append(titulos);
    if (empresas.length > 1) {
      const rotulo = criar(doc, 'label', 'md-filtro', 'Empresa');
      const sel = doc.createElement('select');
      sel.id = 'meu-dia-empresa';
      for (const e of [{ empresaId: '', rotulo: 'Todas as empresas' }, ...empresas]) {
        const o = criar(doc, 'option', '', e.rotulo);
        o.value = e.empresaId;
        if (e.empresaId === valido) o.selected = true;
        sel.append(o);
      }
      if (aoFiltrar) sel.addEventListener('change', () => aoFiltrar(sel.value));
      rotulo.append(sel);
      cab.append(rotulo);
    }
    cartao.append(cab);

    const falhas = blocosComFalha(dados);
    if (falhas.length) cartao.append(criar(doc, 'p', 'md-falha', 'Não foi possível carregar ' + falhas.join(', ') + ' agora. Tente de novo em instantes.'));

    const total = urgentes + grupos.proximos.length + grupos.depois.length;
    if (!total) {
      const vazio = criar(doc, 'div', 'md-vazio');
      vazio.append(criar(doc, 'p', 'md-vazio-titulo', 'Tudo em dia.'),
        criar(doc, 'p', 'md-vazio-texto', 'Nada atrasado, nada para hoje e nada nos próximos 7 dias. Quando você marcar a data da sessão de um processo, os prazos de esclarecimento e impugnação aparecem aqui sozinhos.'));
      cartao.append(vazio);
    }
    for (const g of GRUPOS) {
      const itens = grupos[g.chave];
      if (!itens.length) continue;
      const lista = criar(doc, 'ul', 'md-lista');
      for (const i of itens) lista.append(linha(doc, i, nomes, agendaIcs));
      const titulo = criar(doc, g.chave === 'depois' ? 'summary' : 'h3', 'md-grupo-titulo', g.titulo + ' ');
      titulo.append(criar(doc, 'span', 'md-conta', String(itens.length)));
      const bloco = criar(doc, g.chave === 'depois' ? 'details' : 'section', 'md-grupo');
      bloco.dataset.grupo = g.chave;
      bloco.append(titulo, lista);
      cartao.append(bloco);
    }
    cartao.append(criar(doc, 'p', 'md-nota', 'Prazos legais pela Lei 14.133/2021 (arts. 164 e 165), em dias úteis com feriados nacionais. Feriado do estado ou da cidade do órgão pode mudar a data: o prazo do edital prevalece e você pode corrigir em Processos.'));
    alvo.replaceChildren(cartao);
    alvo.hidden = false;
  }

  const api = { montarItens, agrupar, filtrar, blocosComFalha, selo, renderizar, diaBrasilia };
  global.LicitaMeuDia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
