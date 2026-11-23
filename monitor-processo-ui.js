/* global module, document, MutationObserver, URL, setTimeout, clearTimeout, SUPABASE_URL, SUPABASE_ANON_KEY */
// "Mudou algo no edital?": mostra o que o robô scripts/monitor_processos.js gravou (supabase/operacao_monitor_edital.sql).
// Lê com o cliente supabase do usuário (RLS: só processos das empresas que ele acessa). Tudo por textContent.
// Três usos, um módulo:
//   montar       cartão "Últimas atividades" dentro do processo (sistema.html): situação, "Atualizado em…", contadores,
//                aviso de que a resposta a esclarecimento vira regra do edital e a lista do que mudou.
//   montarHoje   bloco no "Hoje" (sistema.html) com as mudanças dos últimos 7 dias, botão "Abrir processo".
//   marcarFunil  selo no cartão do Funil (painel.html): "Mudou o edital (N)" ou "Monitorado". Liga sozinho na página que
//                tem #kanban-quadro; só acrescenta um <span> com as classes de selo que o painel já tem.
// Banco sem as tabelas (SQL ainda não aplicado): nada aparece.
(function (global) {
  'use strict';
  const DIAS_ALERTA = 7;
  const ROTULOS = { situacao: 'Situação', data: 'Mudança de data', arquivo_novo: 'Arquivo novo', arquivo_retificado: 'Arquivo trocado',
    arquivo_removido: 'Arquivo retirado', aviso: 'Aviso', esclarecimento: 'Esclarecimento', impugnacao: 'Impugnação', retificacao: 'Retificação',
    item_alterado: 'Item alterado', item_cancelado: 'Item cancelado', resultado: 'Resultado', chat: 'Chat do pregão', outro: 'Registro' };
  const CONTADORES = [['aviso', 'Avisos', ['aviso']], ['esclarecimento', 'Esclarecimentos', ['esclarecimento']], ['impugnacao', 'Impugnações', ['impugnacao']],
    ['arquivo', 'Arquivos novos', ['arquivo_novo', 'arquivo_retificado']], ['data', 'Mudanças de data', ['data']], ['chat', 'Mensagens no chat', ['chat']]];
  const REGRA = 'Resposta a esclarecimento vira regra do edital: leia antes de montar a proposta e os documentos.';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ---------- regras (puras, testadas em monitor-processo-ui.test.js) ----------
  function contar(mudancas) {
    const porTipo = {};
    for (const m of mudancas || []) porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1;
    return CONTADORES.map(([chave, rotulo, tipos]) => ({ chave, rotulo, total: tipos.reduce((s, t) => s + (porTipo[t] || 0), 0) }));
  }
  const recente = (m, agora) => Boolean(m?.alerta) && agora - Date.parse(m.detectado_em) <= DIAS_ALERTA * 86400000;
  function dataHora(v) {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '';
  }
  function linkPncp(numero) {
    const m = /^(\d{14})-\d-(\d{6})\/(\d{4})$/.exec(numero || '');
    return m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${Number(m[2])}` : null;
  }
  // Página oficial do Compras.gov: a pessoa abre (o portal pode pedir verificação); o robô nunca abre.
  const linkQuadro = (id) => (/^\d{17}$/.test(id || '') ? `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=quadro-informativo&compra=${id}` : null);
  // Saiu resultado, mensagem no chat ou recurso: oferece o modelo do Jurídico já com os dados do processo (juridico-ui.js).
  function linkRecurso(processoId, mudancas) {
    if (!UUID.test(processoId || '')) return null;
    const pede = (mudancas || []).some((m) => m.tipo === 'resultado' || m.tipo === 'chat' || /recurs|contrarraz|inabilit|desclassific/i.test(m.resumo || ''));
    return pede ? `painel.html?juridico=recurso&processo=${processoId}#juridico` : null;
  }
  // Selo do Funil: N mudanças recentes > monitorado > nada.
  function seloFunil(monitorado, recentes) {
    if (recentes > 0) return { classe: 'perto', texto: `Mudou o edital (${recentes})` };
    return monitorado ? { classe: 'ok', texto: 'Monitorado' } : null;
  }
  const semTabela = (erro) => Boolean(erro) && (erro.code === '42P01' || erro.code === 'PGRST205' || erro.status === 404);

  // ---------- desenho ----------
  function el(doc, tag, classe, texto) {
    const e = doc.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function link(doc, href, texto) {
    const a = el(doc, 'a', 'mp-link', texto);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }

  function desenhar(alvo, { monitor, mudancas, processoId, agora = Date.now() }) {
    const doc = alvo.ownerDocument;
    const raiz = el(doc, 'div', 'mp');
    raiz.append(el(doc, 'h2', 'app-subtitulo', 'Mudou algo no edital?'));
    if (!monitor) {
      raiz.append(el(doc, 'p', 'mp-apoio', 'Este processo ainda não está no monitor. O robô acompanha processos com número de controle do PNCP '
        + '(ou compra do Compras.gov) e confere de hora em hora; a primeira conferência sai em até 1 hora depois de salvar o processo.'));
      alvo.replaceChildren(raiz);
      return;
    }
    const status = el(doc, 'p', 'mp-status');
    status.append('Situação atual: ', el(doc, 'strong', '', monitor.situacao || 'ainda não conferida'));
    raiz.append(status, el(doc, 'p', 'mp-apoio', monitor.verificado_em ? `Atualizado em ${dataHora(monitor.verificado_em)} · confere a cada hora no PNCP` : 'Primeira conferência em até 1 hora.'));
    if (monitor.encerramento_propostas) raiz.append(el(doc, 'p', 'mp-apoio', `Propostas até ${dataHora(monitor.encerramento_propostas)}`));
    if (monitor.erro) raiz.append(el(doc, 'p', 'mp-erro', `Última conferência com problema: ${monitor.erro}`));

    const lista = el(doc, 'ul', 'mp-contadores');
    lista.setAttribute('aria-label', 'Contadores do que mudou');
    for (const c of contar(mudancas)) {
      const li = el(doc, 'li', c.total ? 'mp-contador mp-tem' : 'mp-contador');
      li.append(el(doc, 'span', 'mp-numero', String(c.total)), el(doc, 'span', 'mp-rotulo', c.rotulo));
      lista.append(li);
    }
    raiz.append(lista);
    const regra = el(doc, 'p', 'mp-regra', REGRA);
    regra.setAttribute('role', 'note');
    raiz.append(regra);

    raiz.append(el(doc, 'h3', 'mp-subtitulo', 'Últimas atividades'));
    if (!mudancas.length) raiz.append(el(doc, 'p', 'mp-apoio', 'Nada registrado ainda.'));
    else {
      const ol = el(doc, 'ol', 'mp-lista');
      for (const m of mudancas) {
        const li = el(doc, 'li', recente(m, agora) ? 'mp-item mp-novo' : 'mp-item');
        const topo = el(doc, 'p', 'mp-topo');
        topo.append(el(doc, 'span', 'mp-selo', ROTULOS[m.tipo] || 'Registro'));
        if (recente(m, agora)) topo.append(el(doc, 'span', 'mp-selo mp-selo-novo', 'Novo'));
        topo.append(el(doc, 'span', 'mp-quando', dataHora(m.ocorrido_em || m.detectado_em)));
        li.append(topo, el(doc, 'p', 'mp-resumo', m.resumo));
        ol.append(li);
      }
      raiz.append(ol);
    }
    const links = el(doc, 'p', 'mp-links');
    const pncp = linkPncp(monitor.numero_controle_pncp), quadro = linkQuadro(monitor.id_compra);
    if (pncp) links.append(link(doc, pncp, 'Ver no PNCP'));
    if (quadro) links.append(link(doc, quadro, 'Avisos e esclarecimentos no Compras.gov (abre no portal)'));
    const recurso = linkRecurso(processoId, mudancas);
    if (recurso) { const a = el(doc, 'a', 'mp-link', 'Preparar recurso ou contrarrazão'); a.href = recurso; links.append(a); }
    raiz.append(links, el(doc, 'p', 'mp-fonte', 'Fontes: PNCP (situação, datas, arquivos, itens e resultado) e, no dia da sessão, '
      + 'mensagens do chat gravadas pela extensão "Acompanhar chat" com "Gravar no LicitaPlena" ligado.'));
    alvo.replaceChildren(raiz);
  }

  async function montar({ alvo, contexto, cliente }) {
    let vivo = true;
    const processoId = contexto?.processoId;
    if (!alvo || !cliente || !UUID.test(processoId || '')) return { fechar() {} };
    try {
      const [m, ms] = await Promise.all([
        cliente.from('operacao_monitor_processos').select('processo_id,numero_controle_pncp,id_compra,situacao,encerramento_propostas,verificado_em,erro').eq('processo_id', processoId).maybeSingle(),
        cliente.from('operacao_monitor_mudancas').select('tipo,resumo,ocorrido_em,detectado_em,alerta').eq('processo_id', processoId).order('detectado_em', { ascending: false }).limit(30),
      ]);
      if (!vivo) return { fechar() {} };
      if (semTabela(m.error) || semTabela(ms.error)) { alvo.replaceChildren(); return { fechar() {} }; }
      if (m.error || ms.error) { alvo.replaceChildren(el(alvo.ownerDocument, 'p', 'mp-erro', 'Não foi possível carregar o monitor agora. Tente de novo em instantes.')); }
      // Mais recente primeiro pela data do fato (o PNCP às vezes registra fora de ordem).
      else desenhar(alvo, { processoId, monitor: m.data, mudancas: (ms.data || []).sort((a, b) => String(b.ocorrido_em || b.detectado_em).localeCompare(String(a.ocorrido_em || a.detectado_em))) });
    } catch { if (vivo) alvo.replaceChildren(); }
    return { fechar() { vivo = false; alvo.replaceChildren(); } };
  }

  // Bloco no "Hoje": mesmo desenho dos outros alertas (classes hoje-alerta/hoje-selo de app-comercial.css).
  async function montarHoje({ alvo, cliente, abrir, agora = Date.now() }) {
    if (!alvo || !cliente) return;
    const desde = new Date(agora - DIAS_ALERTA * 86400000).toISOString();
    let r;
    try {
      r = await cliente.from('operacao_monitor_mudancas').select('processo_id,empresa_id,tipo,resumo,detectado_em,operacao_processos(objeto,numero)')
        .eq('alerta', true).gte('detectado_em', desde).order('detectado_em', { ascending: false }).limit(20);
    } catch { r = { error: {} }; }
    if (r.error || !r.data?.length) { alvo.hidden = true; alvo.replaceChildren(); return; }
    const doc = alvo.ownerDocument;
    const sec = el(doc, 'section', 'app-cartao hoje-alerta');
    sec.setAttribute('aria-labelledby', 'hoje-monitor-titulo');
    const h = el(doc, 'h2', '', 'Mudou algo no edital?');
    h.id = 'hoje-monitor-titulo';
    const ul = el(doc, 'ul');
    for (const m of r.data) {
      const li = el(doc, 'li');
      li.dataset.situacao = m.tipo === 'esclarecimento' || m.tipo === 'impugnacao' || m.tipo === 'situacao' || m.tipo === 'data' ? 'atrasado' : 'atencao';
      const proc = m.operacao_processos || {};
      li.append(el(doc, 'span', 'hoje-selo', ROTULOS[m.tipo] || 'Mudou'), el(doc, 'p', '', m.resumo),
        el(doc, 'p', 'hoje-detalhe', [proc.numero, proc.objeto && String(proc.objeto).slice(0, 120), dataHora(m.detectado_em)].filter(Boolean).join(' · ')));
      if (typeof abrir === 'function' && UUID.test(m.empresa_id) && UUID.test(m.processo_id)) {
        const b = el(doc, 'button', '', 'Abrir processo');
        b.type = 'button';
        b.addEventListener('click', () => abrir(m.empresa_id, m.processo_id));
        li.append(b);
      }
      ul.append(li);
    }
    sec.append(h, el(doc, 'p', 'hoje-detalhe', REGRA), ul);
    alvo.replaceChildren(sec);
    alvo.hidden = false;
  }

  // Funil (painel.html): o cartão já traz "Abrir no sistema" com ?processo=<uuid>; o selo entra antes do "Mover para".
  function marcarFunil({ raiz, cliente, agora = Date.now }) {
    if (!raiz || !cliente) return { parar() {} };
    let ultimo = '', dados = { monitorados: new Set(), recentes: {} }, timer = null;
    const idDoCartao = (card) => {
      const a = card.querySelector('a.kanban-btn-sistema');
      try { const id = a ? new URL(a.href, 'https://x.invalid').searchParams.get('processo') : null; return UUID.test(id || '') ? id : null; } catch { return null; }
    };
    const aplicar = () => {
      for (const card of raiz.querySelectorAll('.kanban-card')) {
        const id = idDoCartao(card);
        const selo = id ? seloFunil(dados.monitorados.has(id), dados.recentes[id] || 0) : null;
        let span = card.querySelector('.kanban-card-monitor');
        if (!selo) { span?.remove(); continue; }
        if (!span) {
          span = card.ownerDocument.createElement('span');
          const mover = card.querySelector('.kanban-card-mover');
          if (mover) mover.before(span); else card.append(span);
        }
        span.className = `kanban-card-prazo kanban-card-monitor ${selo.classe}`;
        if (span.textContent !== selo.texto) span.textContent = selo.texto;
      }
    };
    const atualizar = async () => {
      const ids = [...new Set([...raiz.querySelectorAll('.kanban-card')].map(idDoCartao).filter(Boolean))].sort();
      const chave = ids.join(',');
      if (chave !== ultimo) {
        ultimo = chave;
        if (!ids.length) { dados = { monitorados: new Set(), recentes: {} }; aplicar(); return; }
        try {
          const desde = new Date(agora() - DIAS_ALERTA * 86400000).toISOString();
          const [m, ms] = await Promise.all([
            cliente.from('operacao_monitor_processos').select('processo_id').in('processo_id', ids),
            cliente.from('operacao_monitor_mudancas').select('processo_id').in('processo_id', ids).eq('alerta', true).gte('detectado_em', desde).limit(1000),
          ]);
          const recentes = {};
          for (const x of ms.data || []) recentes[x.processo_id] = (recentes[x.processo_id] || 0) + 1;
          dados = { monitorados: new Set((m.data || []).map((x) => x.processo_id)), recentes };
        } catch { /* selo é opcional */ }
      }
      aplicar();
    };
    // O painel redesenha o quadro inteiro (innerHTML): reaplica o selo depois de cada redesenho.
    const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(atualizar, 250); });
    obs.observe(raiz, { childList: true, subtree: true });
    void atualizar();
    return { parar() { obs.disconnect(); clearTimeout(timer); } };
  }

  const api = { contar, recente, seloFunil, linkRecurso, linkPncp, linkQuadro, desenhar, montar, montarHoje, marcarFunil, REGRA };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.LicitaMonitorProcesso = api;

  // painel.html: liga sozinho no Funil com um cliente próprio (mesma sessão salva no navegador).
  if (typeof document !== 'undefined' && global.supabase && typeof SUPABASE_URL === 'string') {
    const iniciar = () => {
      const raiz = document.getElementById('kanban-quadro');
      if (!raiz) return;
      try { marcarFunil({ raiz, cliente: global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) }); } catch { /* selo é opcional */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
