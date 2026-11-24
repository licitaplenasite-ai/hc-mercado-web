/* global module */
// Linha do tempo do processo (CRM fase 2, 24/11/2026): tudo o que aconteceu num lugar só, do mais recente para o mais
// antigo. Só junta o que o dossiê de processos.html já carrega (prazos, ocorrências, anexos, contratos, empenhos,
// execução, tarefas do card, resultado) + operacao_processos_etapas_historico (supabase/crm_orgao_linha_tempo.sql).
// Sem esse SQL aplicado, a linha mostra só "na etapa atual desde" (etapa_desde); nada é inventado.
(function (raiz) {
  'use strict';
  const FUSO = 'America/Sao_Paulo';
  const DIA = /^\d{4}-\d{2}-\d{2}$/;
  const OCORRENCIA = { registro: 'Registro', sessao: 'Sessão', chat: 'Mensagem do chat', diligencia: 'Diligência', recurso: 'Recurso', resultado: 'Resultado', contrato: 'Contrato', execucao: 'Execução' };
  const ANEXO = { edital: 'Edital', proposta: 'Proposta', habilitacao: 'Habilitação', homologacao: 'Homologação', contrato: 'Contrato assinado', empenho: 'Empenho', ata: 'Ata', outro: 'Documento' };
  const EXECUCAO = { empenho: 'Empenho registrado', entrega: 'Entrega registrada', nota: 'Nota fiscal registrada', recebimento: 'Pagamento recebido' };
  const RESULTADO = { sem_vitoria: 'Participou sem vencer', vitoria_parcial: 'Vitória parcial', vitoria_total: 'Vitória total', vitoria_sem_detalhamento: 'Ganhou', nao_participou: 'Não participou', revogado_anulado: 'Revogado / anulado' };
  const SITUACAO = { futuro: 'Próximo', atrasado: 'Atrasado', feito: 'Feito' };
  // Ícones de traço simples (24x24), um por tipo de acontecimento.
  const ICONES = {
    criacao: 'M12 5v14M5 12h14',
    etapa: 'M5 12h14M13 6l6 6-6 6',
    sessao: 'M4 7h16v13H4zM4 11h16M9 3v4M15 3v4',
    prazo: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    tarefa: 'M5 12l4 4 10-10',
    ocorrencia: 'M4 5h16v11H9l-5 4z',
    documento: 'M7 3h7l5 5v13H7zM14 3v5h5',
    contrato: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
    dinheiro: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
    resultado: 'M8 4h8v5a4 4 0 0 1-8 0zM12 13v4M8 20h8M16 5h3a3 3 0 0 1-3 4M8 5H5a3 3 0 0 0 3 4',
    perda: 'M6 6l12 12M18 6L6 18',
  };

  // 'AAAA-MM-DD' é dia de Brasília (meio-dia, para ordenar no meio do dia); o resto é instante ISO.
  function instante(valor) {
    if (!valor) return null;
    const t = DIA.test(String(valor)) ? Date.parse(`${valor}T12:00:00-03:00`) : Date.parse(valor);
    return Number.isFinite(t) ? t : null;
  }
  const formatoDia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });
  const formatoHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  function quandoTexto(ev) {
    const d = new Date(ev.quando);
    return ev.soData ? formatoDia.format(d) : `${formatoDia.format(d)} às ${formatoHora.format(d)}`;
  }
  const dinheiro = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

  function montarEventos(processo, dados = {}, agora = Date.now()) {
    const p = processo || {};
    const rotulo = dados.rotuloStatus || ((s) => s);
    const doProcesso = (lista) => (lista || []).filter((r) => !r.processo_id || r.processo_id === p.id);
    const eventos = [];
    const add = (valor, ev) => { const quando = instante(valor); if (quando != null) eventos.push({ situacao: null, detalhe: '', ...ev, quando, soData: DIA.test(String(valor)) }); };

    const inicial = (dados.historico || []).find((h) => h.status_anterior == null);
    add(p.criado_em, { tipo: 'criacao', icone: 'criacao', titulo: p.origem_externa_id ? 'Processo criado a partir do Boletim / Funil' : 'Processo criado', detalhe: inicial ? `Etapa inicial: ${inicial.etapa_nome || rotulo(inicial.status_novo)}` : '' });
    if (p.data_publicacao) add(p.data_publicacao, { tipo: 'sessao', icone: 'documento', titulo: 'Edital publicado' });
    if (p.data_sessao) add(p.data_sessao, { tipo: 'sessao', icone: 'sessao', titulo: instante(p.data_sessao) > agora ? 'Sessão marcada' : 'Sessão / abertura', situacao: instante(p.data_sessao) > agora ? 'futuro' : null });

    const historico = (dados.historico || []).filter((h) => h.status_anterior != null || h.etapa_nome);
    for (const h of historico) {
      add(h.mudou_em, { tipo: 'etapa', icone: h.status_novo === 'perdido' ? 'perda' : 'etapa', titulo: `Mudou para ${h.etapa_nome || rotulo(h.status_novo)}`, detalhe: h.status_anterior ? `Antes: ${rotulo(h.status_anterior)}` : '' });
    }
    // Sem histórico gravado (processo de antes do SQL): mostra só a entrada na etapa atual, se não for a da criação.
    if (!(dados.historico || []).length && p.etapa_desde && instante(p.etapa_desde) - (instante(p.criado_em) || 0) > 60000) {
      add(p.etapa_desde, { tipo: 'etapa', icone: 'etapa', titulo: `Entrou na etapa atual: ${rotulo(p.status)}`, detalhe: 'As mudanças anteriores não foram registradas.' });
    }

    for (const z of doProcesso(dados.prazos)) {
      if (z.concluido_em) add(z.concluido_em, { tipo: 'prazo', icone: 'prazo', titulo: `Prazo cumprido: ${z.titulo}`, detalhe: `Vencia em ${quandoTexto({ quando: instante(z.vencimento), soData: false })}`, situacao: 'feito' });
      else {
        const futuro = instante(z.vencimento) > agora;
        add(z.vencimento, { tipo: 'prazo', icone: 'prazo', titulo: futuro ? `Prazo: ${z.titulo}` : `Prazo vencido sem conclusão: ${z.titulo}`, detalhe: z.responsavel ? `Responsável: ${z.responsavel}` : '', situacao: futuro ? 'futuro' : 'atrasado' });
      }
    }
    for (const s of p.tarefas_card?.secoes || []) {
      for (const t of s.tarefas || []) if (t.feita_em) add(t.feita_em, { tipo: 'tarefa', icone: 'tarefa', titulo: `Tarefa concluída: ${t.titulo}`, detalhe: [s.nome, t.responsavel ? `por ${t.responsavel}` : ''].filter(Boolean).join(' · '), situacao: 'feito' });
    }
    for (const o of doProcesso(dados.ocorrencias)) add(o.ocorrido_em, { tipo: 'ocorrencia', icone: 'ocorrencia', titulo: OCORRENCIA[o.categoria] || 'Ocorrência', detalhe: o.descricao || '' });
    for (const a of doProcesso(dados.anexos)) add(a.criado_em, { tipo: 'documento', icone: 'documento', titulo: `Documento anexado: ${ANEXO[a.tipo] || 'Documento'}`, detalhe: [a.titulo, a.referencia_numero].filter(Boolean).join(' · ') });
    for (const c of doProcesso(dados.contratos)) add(c.assinado_em || c.criado_em, { tipo: 'contrato', icone: 'contrato', titulo: c.assinado_em ? `Contrato ${c.numero} assinado` : `Contrato ${c.numero} registrado`, detalhe: dinheiro(c.valor) });
    for (const e of doProcesso(dados.empenhos)) add(e.emitido_em || e.criado_em, { tipo: 'contrato', icone: 'dinheiro', titulo: `Empenho ${e.numero} emitido`, detalhe: dinheiro(e.valor) });
    for (const x of doProcesso(dados.execucao)) add(x.ocorrido_em, { tipo: 'contrato', icone: 'dinheiro', titulo: EXECUCAO[x.tipo] || 'Registro na execução', detalhe: [dinheiro(x.valor), x.referencia].filter(Boolean).join(' · ') });

    const situacao = RESULTADO[p.situacao_resultado];
    const perdido = p.status === 'perdido';
    if (situacao || perdido) {
      const mudouPerdido = historico.filter((h) => h.status_novo === 'perdido').pop();
      const quando = p.data_resultado || (perdido && (mudouPerdido?.mudou_em || p.etapa_desde)) || p.atualizado_em;
      const ganhou = /^vitoria/.test(p.situacao_resultado || '');
      add(quando, {
        tipo: 'resultado', icone: ganhou ? 'resultado' : 'perda',
        titulo: `Resultado: ${situacao || 'Perdido'}`,
        detalhe: [ganhou ? dinheiro(p.valor_homologado) : '', p.motivo_perda ? `Motivo da perda: ${p.motivo_perda}` : ''].filter(Boolean).join(' · '),
      });
    }
    return eventos.sort((a, b) => b.quando - a.quando);
  }

  function html(eventos, { esc, limite = 8, todos = false } = {}) {
    if (!eventos.length) return '<p class="nota">Nada registrado ainda. Prazos, tarefas, ocorrências e documentos aparecem aqui sozinhos.</p>';
    const vistos = todos ? eventos : eventos.slice(0, limite);
    const itens = vistos.map((ev) => `<li class="lt-item lt-${ev.tipo}${ev.situacao ? ` lt-${ev.situacao}` : ''}">
      <span class="lt-icone" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${ICONES[ev.icone] || ICONES.etapa}"/></svg></span>
      <div class="lt-texto"><time datetime="${new Date(ev.quando).toISOString()}">${esc(quandoTexto(ev))}</time>${ev.situacao ? ` <span class="lt-selo">${SITUACAO[ev.situacao]}</span>` : ''}
        <strong>${esc(ev.titulo)}</strong>${ev.detalhe ? `<small>${esc(ev.detalhe)}</small>` : ''}</div></li>`).join('');
    const mais = !todos && eventos.length > limite ? `<button type="button" class="btn lt-mais" data-lt-todos>Mostrar tudo (${eventos.length})</button>` : '';
    return `<ol class="lt-lista">${itens}</ol>${mais}`;
  }

  // Cola do dossiê: busca o histórico de etapas deste processo e desenha. Falha de leitura (SQL não aplicado) = sem histórico.
  async function renderizarNoDossie({ sb, alvo, processo, estado, rotuloStatus, esc }) {
    if (!alvo || !processo) return;
    alvo.dataset.processo = processo.id;
    alvo.innerHTML = '<details class="lt-caixa" open><summary>Linha do tempo</summary><p class="nota">Montando a linha do tempo…</p></details>';
    // O dossiê abre antes de prazos/ocorrências chegarem e é redesenhado depois: não mostrar "nada registrado" à toa.
    if (!estado.detalhesCarregados) return;
    let historico = [];
    try {
      const r = await sb.from('operacao_processos_etapas_historico').select('status_anterior,status_novo,etapa_nome,mudou_em').eq('processo_id', processo.id).order('mudou_em').limit(500);
      if (!r.error) historico = r.data || [];
    } catch { historico = []; }
    if (alvo.dataset.processo !== processo.id || !alvo.isConnected) return;
    const eventos = montarEventos(processo, { historico, rotuloStatus, prazos: estado.prazos, ocorrencias: estado.ocorrencias, anexos: estado.anexos, contratos: estado.contratos, empenhos: estado.empenhos, execucao: estado.execucaoEventos });
    const desenhar = (todos) => {
      alvo.innerHTML = `<details class="lt-caixa" open><summary>Linha do tempo <span class="lt-conta">${eventos.length} ${eventos.length === 1 ? 'registro' : 'registros'}, do mais recente ao mais antigo · horário de Brasília</span></summary>${html(eventos, { esc, todos })}</details>`;
      alvo.querySelector('[data-lt-todos]')?.addEventListener('click', () => desenhar(true));
    };
    desenhar(false);
  }

  const api = { montarEventos, html, quandoTexto, instante, renderizarNoDossie };
  raiz.LicitaLinhaTempo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
