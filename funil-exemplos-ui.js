/* global module */
// Dados de exemplo do primeiro acesso (padrão Pipedrive, _historico/estudo-crm-produto-ux-20261124.md): Funil vazio mostra
// o convite "Ver o sistema com exemplos"; com exemplos na empresa, a faixa "Apagar exemplos" fica sempre à vista.
// Nada é criado sem o clique. A marca é operacao_processos.exemplo = true (supabase/funil_exemplos.sql): o banco
// garante o prefixo "[Exemplo] ", não deixa a marca mudar e não conta exemplo no limite do plano. Prazos e tarefas
// pendem do processo, então apagar o processo apaga o resto. Sem DOM no cálculo: testado no Node.
(function (global) {
  'use strict';
  const PREFIXO = '[Exemplo] ';
  const MS_DIA = 864e5, FUSO_BR = -3 * 36e5;
  // "AAAA-MM-DDTHH:MM" no horário de Brasília, N dias a partir de agora (formato das tarefas do cartão).
  const localBr = (agora, dias, hora) => new Date(agora + dias * MS_DIA + FUSO_BR).toISOString().slice(0, 11) + hora;
  const instanteBr = (agora, dias, hora) => new Date(localBr(agora, dias, hora) + ':00-03:00').toISOString();

  const MODELOS = [
    { objeto: 'Material de expediente para as escolas municipais', orgao: 'Prefeitura Municipal de Exemplo', modalidade: 'Pregão eletrônico',
      status: 'triagem', decisao: 'em_analise', valor: 48750, sessao: 9, proposta: 8,
      tarefa: { id: 'ler-edital', titulo: 'Ler o edital e conferir a amostra exigida', dias: 2, hora: '10:00' } },
    { objeto: 'Serviço de limpeza predial da sede', orgao: 'Câmara Municipal de Exemplo', modalidade: 'Pregão eletrônico',
      status: 'preparacao', decisao: 'participar', valor: 216000, sessao: 4, proposta: 3,
      tarefa: { id: 'montar-planilha', titulo: 'Montar a planilha de custos e conferir a convenção coletiva', dias: 1, hora: '14:00' } },
    { objeto: 'Gêneros alimentícios para a merenda escolar', orgao: 'Secretaria de Educação de Exemplo', modalidade: 'Pregão eletrônico',
      status: 'sessao', decisao: 'participar', valor: 93420.5, sessao: 1 },
    { objeto: 'Aquisição de computadores para o atendimento', orgao: 'Instituto de Exemplo', modalidade: 'Dispensa eletrônica',
      status: 'homologado', decisao: 'participar', valor: 120000, sessao: -6, resultado: -2 },
  ];

  // Linhas de operacao_processos (sem id: o banco gera) e o prazo de propostas que o cartão do Funil lê.
  function montar(organizacaoId, empresaId, agora) {
    return MODELOS.map((m, i) => ({
      processo: {
        organizacao_id: organizacaoId, empresa_id: empresaId, exemplo: true, origem_externa_id: 'exemplo-' + (i + 1),
        objeto: PREFIXO + m.objeto, orgao: PREFIXO + m.orgao, modalidade: m.modalidade, status: m.status, decisao: m.decisao,
        valor_estimado: m.valor, data_sessao: instanteBr(agora, m.sessao, '09:00'),
        data_resultado: m.resultado === undefined ? null : localBr(agora, m.resultado, '').slice(0, 10),
        observacoes: 'Dado de exemplo criado pelo botão "Ver o sistema com exemplos". Apague em "Apagar exemplos".',
        tarefas_card: m.tarefa ? { secoes: [{ id: 'exemplo', nome: 'Tarefas de exemplo', tarefas: [{ id: m.tarefa.id,
          titulo: PREFIXO + m.tarefa.titulo, quando: localBr(agora, m.tarefa.dias, m.tarefa.hora), responsavel: 'Equipe de licitação' }] }] } : null,
      },
      // Mesmo título que o Boletim grava: é por ele que o cartão mostra o prazo (carregarAcompanhamentosEmpresa).
      prazoProposta: m.proposta === undefined ? null : instanteBr(agora, m.proposta, '18:00'),
    }));
  }

  async function criar(sb, organizacaoId, empresaId, agora = Date.now()) {
    const itens = montar(organizacaoId, empresaId, agora);
    const { data, error } = await sb.from('operacao_processos').insert(itens.map((i) => i.processo)).select('id,origem_externa_id');
    if (error) throw error;
    const idDe = new Map((data || []).map((p) => [p.origem_externa_id, p.id]));
    const prazos = itens.filter((i) => i.prazoProposta && idDe.has(i.processo.origem_externa_id)).map((i) => ({
      organizacao_id: organizacaoId, processo_id: idDe.get(i.processo.origem_externa_id), categoria: 'proposta',
      titulo: 'Prazo de propostas (Boletim)', vencimento: i.prazoProposta, observacoes: 'Exemplo' }));
    if (prazos.length) {
      const r = await sb.from('operacao_prazos_processo').insert(prazos);
      if (r.error) throw r.error;
    }
    return (data || []).length;
  }

  // Só linhas com a marca: o filtro exemplo = true é o que impede apagar dado real.
  async function apagar(sb, organizacaoId, empresaId) {
    const { error } = await sb.from('operacao_processos').delete()
      .eq('organizacao_id', organizacaoId).eq('empresa_id', empresaId).eq('exemplo', true);
    if (error) throw error;
  }

  // contagem = { total, exemplos } dos processos da empresa (arquivados inclusive). Sem contagem = ainda carregando.
  function htmlFaixa(contagem) {
    if (!contagem) return '';
    if (contagem.exemplos > 0) {
      return `<div class="fx-faixa fx-faixa-ativa" role="status">
        <p><strong>Você está vendo exemplos.</strong> Os cartões marcados "[Exemplo]" são fictícios e não entram em boletim, e-mail nem relatório.
        Quando quiser começar de verdade, apague todos de uma vez. Seus processos reais não são tocados.</p>
        <button type="button" class="btn-imprimir fx-apagar" data-fx="apagar">Apagar exemplos</button></div>`;
    }
    if (contagem.total > 0) return '';
    return `<div class="fx-faixa fx-convite">
      <p><strong>Seu Funil ainda está vazio.</strong> Quer ver como ele funciona antes de cadastrar a primeira licitação?
      Criamos 4 licitações de exemplo, com prazos e tarefas, marcadas "[Exemplo]". Elas não contam no limite do seu plano e saem com um clique.</p>
      <button type="button" class="btn-imprimir fc-primario" data-fx="criar">Ver o sistema com exemplos</button></div>`;
  }

  const api = { PREFIXO, montar, criar, apagar, htmlFaixa };
  global.LicitaFunilExemplos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
