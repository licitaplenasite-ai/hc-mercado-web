/* global module, require */
// CRM, fase 2 (24/11/2026, _historico/estudo-crm-20261124.md itens 4 e 9): no Dashboard,
//  1. "Quanto posso faturar?" = disputas abertas do Funil × chance da etapa + saldo a receber de contratos/atas ganhos,
//     mês a mês (estimativa, nunca promessa), e os ganhos dos últimos 90 dias à parte (já aconteceram: não somam).
//  2. "Por que eu perco?" = operacao_processos.motivo_perda agrupado pelo código de funil-crm-ui.js, com valor e conselho.
// Dinheiro sempre em centavos inteiros. Chance por etapa: operacao_funil_etapas.probabilidade (supabase/funil_previsao.sql),
// null = CHANCE_PADRAO do estágio. Saldo de execução reaproveita ContratoPublico.fasesExecucao (contrato-publico.js).
// Parte de cima: regras puras (testadas em crm-relatorios-ui.test.js). Parte de baixo: tela, só no navegador.
(function (global) {
  'use strict';
  // funil-crm-ui.js carrega depois deste arquivo no painel.html: busca na hora de usar.
  const funilCrm = () => global.LicitaFunilCrm || (typeof require === 'function' ? require('./funil-crm-ui.js') : null);
  const MS_DIA = 864e5, FUSO_BRASILIA_MS = -3 * 36e5;
  const ABERTOS = ['triagem', 'preparacao', 'proposta_enviada', 'sessao', 'habilitacao', 'recurso'];
  const GANHOS = ['homologado', 'contratado'];
  // Chance padrão por estágio, conservadora: triagem ainda nem decidiu participar; habilitação já passou do preço.
  const CHANCE_PADRAO = { triagem: 5, preparacao: 15, proposta_enviada: 25, sessao: 35, habilitacao: 60, recurso: 40 };
  const ROTULO_STATUS = { triagem: 'Triagem', preparacao: 'Preparação', proposta_enviada: 'Proposta enviada', sessao: 'Sessão de lances',
    habilitacao: 'Habilitação', recurso: 'Recurso' };
  const MESES_PADRAO = 6;
  // shortcut: contrato sem vigência registrada espalha o saldo em 12 meses; trocar quando houver cronograma de entrega.
  const MESES_SEM_VIGENCIA = 12;
  const PERIODOS = { '90d': 90, '12m': 365, tudo: null };
  const CONSELHOS = {
    preco: 'Revise custo, frete e margem antes da sessão e compare com a Pesquisa de Preços e a licitação anterior do órgão.',
    documento: 'Confira Minhas empresas e documentos: certidão vencida e atestado faltando são as causas mais comuns.',
    tecnica: 'Leia o termo de referência item a item e confirme marca, modelo e amostra antes de enviar a proposta.',
    prazo: 'Ligue os lembretes do Funil e marque na agenda a sessão e os prazos de recurso.',
    desistencia: 'Decida participar só depois da triagem completa: custo, prazo de entrega e documentos.',
    fracassada: 'Não depende de você. Acompanhe a republicação do edital no Boletim.',
    outro: 'Escreva o detalhe ao marcar a perda: com o tempo o padrão aparece aqui.',
    sem_motivo: 'Informe o motivo no cartão do Funil para este relatório ficar completo.',
  };

  // numeric do Postgres chega como número ou texto "1234.50". Vazio, zero ou inválido = sem valor.
  function centavosDe(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  }
  // Homologado (resultado oficial) > proposta > estimado do edital.
  const valorDoProcesso = (p) => centavosDe(p?.valor_homologado) ?? centavosDe(p?.preco_proposta) ?? centavosDe(p?.valor_estimado);
  function chanceDaEtapa(etapa, status) {
    const propria = etapa?.probabilidade;
    if (Number.isInteger(propria) && propria >= 0 && propria <= 100) return propria;
    return CHANCE_PADRAO[status] ?? 0;
  }
  // "AAAA-MM" no fuso de Brasília. Data pura (date do Postgres) não passa pelo fuso.
  function mesDe(iso) {
    const t = String(iso || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.slice(0, 7);
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? new Date(ms + FUSO_BRASILIA_MS).toISOString().slice(0, 7) : null;
  }
  function somarMes(mes, n) {
    const [a, m] = mes.split('-').map(Number);
    const total = a * 12 + (m - 1) + n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  }
  const mesesEntre = (de, ate) => { const [a1, m1] = de.split('-').map(Number), [a2, m2] = ate.split('-').map(Number); return (a2 - a1) * 12 + (m2 - m1); };
  // Processos de exemplo do primeiro acesso (operacao_processos.exemplo, planos_e_recursos.sql) nunca contam. O prefixo
  // "[Exemplo] " no objeto é reforço para banco sem a coluna ou linha antiga.
  const ehExemplo = (p) => p?.exemplo === true || /^\[exemplo\]/i.test(String(p?.objeto || '').trim());
  const dataDe = (p) => { const ms = Date.parse(p?.data_resultado || p?.atualizado_em || ''); return Number.isFinite(ms) ? ms : null; };

  // processos: linhas de operacao_processos; etapas: operacao_funil_etapas; execucao: { [processoId]: { potencial, recebido, vigenciaFim } }
  // com potencial/recebido em centavos (fasesExecucao). Devolve tudo em centavos.
  function calcularPrevisao({ processos = [], etapas = [], execucao = {}, agora = Date.now(), meses = MESES_PADRAO, diasGanhos = 90 } = {}) {
    const atual = mesDe(new Date(agora).toISOString());
    const ultimo = somarMes(atual, meses - 1);
    const linhas = Array.from({ length: meses }, (_, i) => ({ mes: somarMes(atual, i), disputas: 0, contratos: 0 }));
    const noMes = (mes) => linhas[mesesEntre(atual, mes)];
    const etapaPorId = new Map(etapas.map((e) => [e.id, e]));
    const etapaDoStatus = (s) => [...etapas].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).find((e) => e.status_sistema === s);
    const grupos = new Map();
    let semValor = 0, disputasDepois = 0, saldoContratos = 0, contratosDepois = 0;
    const ganhos = { quantidade: 0, valor: 0 };

    for (const p of processos) {
      if (ehExemplo(p)) continue;
      if (ABERTOS.includes(p.status)) {
        const etapa = (p.etapa_id && etapaPorId.get(p.etapa_id)?.status_sistema === p.status ? etapaPorId.get(p.etapa_id) : null) || etapaDoStatus(p.status);
        const chance = chanceDaEtapa(etapa, p.status);
        const chave = etapa?.id || p.status;
        if (!grupos.has(chave)) grupos.set(chave, { nome: etapa?.nome || ROTULO_STATUS[p.status], ordem: etapa?.ordem ?? ABERTOS.indexOf(p.status), chance, quantidade: 0, valor: 0, esperado: 0, semValor: 0 });
        const g = grupos.get(chave);
        g.quantidade += 1;
        const valor = valorDoProcesso(p);
        if (valor === null) { g.semValor += 1; semValor += 1; continue; }
        const esperado = Math.round((valor * chance) / 100);
        g.valor += valor; g.esperado += esperado;
        // Disputa entra no mês da sessão; sessão passada ou sem data = mês atual.
        const sessao = mesDe(p.data_sessao);
        const mes = !sessao || sessao < atual ? atual : sessao;
        if (mes > ultimo) disputasDepois += esperado; else noMes(mes).disputas += esperado;
      } else if (GANHOS.includes(p.status)) {
        const ex = execucao[p.id] || {};
        const potencial = ex.potencial ?? valorDoProcesso(p);
        const quando = dataDe(p);
        if (quando !== null && quando >= agora - diasGanhos * MS_DIA) { ganhos.quantidade += 1; ganhos.valor += potencial ?? 0; }
        const saldo = Math.max(0, (potencial ?? 0) - (ex.recebido ?? 0));
        if (!saldo) continue;
        saldoContratos += saldo;
        // Saldo espalhado igual até o fim da vigência (vencida = tudo no mês atual); centavo que sobra vai no 1º mês.
        const fimVig = mesDe(ex.vigenciaFim);
        const fim = fimVig ? (fimVig < atual ? atual : fimVig) : somarMes(atual, MESES_SEM_VIGENCIA - 1);
        const n = mesesEntre(atual, fim) + 1;
        const parte = Math.floor(saldo / n);
        for (let i = 0; i < n; i += 1) {
          const v = parte + (i === 0 ? saldo - parte * n : 0);
          if (i < meses) linhas[i].contratos += v; else contratosDepois += v;
        }
      }
    }
    for (const l of linhas) l.total = l.disputas + l.contratos;
    const totalDisputas = linhas.reduce((s, l) => s + l.disputas, 0), totalContratos = linhas.reduce((s, l) => s + l.contratos, 0);
    return {
      meses: linhas, total: totalDisputas + totalContratos, totalDisputas, totalContratos,
      depois: disputasDepois + contratosDepois, saldoContratos, ganhos, semValor,
      porEtapa: [...grupos.values()].sort((a, b) => a.ordem - b.ordem),
    };
  }

  // Perdidas no período (data do resultado ou da última atualização), agrupadas pelo motivo. Mais frequente primeiro.
  function agruparMotivos({ processos = [], periodo = '12m', agora = Date.now() } = {}) {
    const dias = PERIODOS[periodo] ?? null;
    const crm = funilCrm();
    const rotulos = Object.fromEntries((crm?.MOTIVOS_PERDA || []).concat([['sem_motivo', 'Motivo não informado']]));
    const grupos = new Map();
    let total = 0, valorTotal = 0;
    for (const p of processos) {
      if (p.status !== 'perdido' || ehExemplo(p)) continue;
      const quando = dataDe(p);
      if (dias !== null && (quando === null || quando < agora - dias * MS_DIA)) continue;
      const codigo = crm?.codigoDoMotivo(p.motivo_perda) || 'sem_motivo';
      const valor = valorDoProcesso(p) ?? 0;
      if (!grupos.has(codigo)) grupos.set(codigo, { codigo, rotulo: rotulos[codigo] || 'Outro motivo', quantidade: 0, valor: 0, conselho: CONSELHOS[codigo] || CONSELHOS.outro });
      const g = grupos.get(codigo);
      g.quantidade += 1; g.valor += valor; total += 1; valorTotal += valor;
    }
    const linhas = [...grupos.values()].sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor);
    for (const l of linhas) l.percentual = total ? Math.round((l.quantidade / total) * 100) : 0;
    return { total, valorTotal, linhas };
  }

  // ---------- tela ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reais = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const rotuloMes = (mes) => `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function htmlPrevisao(r, { podeAjustar }) {
    const maior = Math.max(1, ...r.meses.map((m) => m.total));
    const barras = r.meses.map((m) => {
      const pc = (v) => (v ? Math.max(2, Math.round((v / maior) * 100)) : 0);
      return `<li class="crm-mes"><span class="crm-mes-nome">${rotuloMes(m.mes)}</span>
        <span class="crm-mes-barra" aria-hidden="true"><span class="crm-seg-contrato" style="width:${pc(m.contratos)}%"></span><span class="crm-seg-disputa" style="width:${pc(m.disputas)}%"></span></span>
        <span class="crm-mes-valor">${esc(reais(m.total))}<small>${esc(`contratos ${reais(m.contratos)} · disputas ${reais(m.disputas)}`)}</small></span></li>`;
    }).join('');
    const etapas = r.porEtapa.length
      ? `<div class="crm-tabela-rolagem" role="region" aria-label="Previsão por etapa do Funil" tabindex="0"><table class="crm-tabela">
          <thead><tr><th scope="col">Etapa</th><th scope="col">Licitações</th><th scope="col">Valor em disputa</th><th scope="col">Chance</th><th scope="col">Estimativa</th></tr></thead>
          <tbody>${r.porEtapa.map((g) => `<tr><th scope="row">${esc(g.nome)}</th><td>${g.quantidade}${g.semValor ? ` <small>(${g.semValor} sem valor)</small>` : ''}</td><td>${esc(reais(g.valor))}</td><td>${g.chance}%</td><td><strong>${esc(reais(g.esperado))}</strong></td></tr>`).join('')}</tbody>
        </table></div>`
      : '<p class="crm-fraco">Nenhuma disputa aberta no Funil agora.</p>';
    return `<div class="crm-destaque">
        <p class="crm-pergunta">Quanto posso faturar nos próximos ${r.meses.length} meses?</p>
        <p class="crm-numero"><span class="crm-selo-estimativa">Estimativa</span> <strong>${esc(reais(r.total))}</strong></p>
        <p class="crm-fraco">Não é promessa: soma o saldo a receber dos contratos ganhos com as disputas abertas multiplicadas pela chance de cada etapa.</p>
      </div>
      <dl class="crm-tres">
        <div><dt><span class="crm-legenda crm-seg-contrato" aria-hidden="true"></span>Saldo de contratos e atas</dt><dd>${esc(reais(r.totalContratos))}</dd><dd class="crm-fraco">a receber no período · total ${esc(reais(r.saldoContratos))}</dd></div>
        <div><dt><span class="crm-legenda crm-seg-disputa" aria-hidden="true"></span>Disputas × chance</dt><dd>${esc(reais(r.totalDisputas))}</dd><dd class="crm-fraco">${r.semValor ? esc(plural(r.semValor, 'licitação sem valor fica de fora', 'licitações sem valor ficam de fora')) : 'pelo mês da sessão'}</dd></div>
        <div><dt>Ganhos nos últimos 90 dias</dt><dd>${esc(reais(r.ganhos.valor))}</dd><dd class="crm-fraco">${esc(plural(r.ganhos.quantidade, 'licitação ganha', 'licitações ganhas'))} · não soma de novo na previsão</dd></div>
      </dl>
      <h4 class="crm-sub">Mês a mês</h4>
      ${r.total || r.depois ? `<ul class="crm-meses">${barras}</ul>` : '<div class="crm-vazio"><p><strong>Ainda não há o que prever.</strong></p><p class="crm-fraco">Coloque o valor da proposta nos cartões do Funil e registre o contrato das licitações ganhas: a previsão se monta sozinha.</p></div>'}
      ${r.depois ? `<p class="crm-fraco">Depois de ${rotuloMes(r.meses[r.meses.length - 1].mes)}: mais ${esc(reais(r.depois))} estimados.</p>` : ''}
      <h4 class="crm-sub">Por etapa do Funil</h4>
      ${etapas}
      <div class="crm-acoes">${podeAjustar ? '<button type="button" class="btn-imprimir" data-crm-ajustar>Ajustar a chance de cada etapa</button>' : ''}
        <button type="button" class="btn-imprimir" data-crm-ir="kanban">Abrir o Funil</button></div>`;
  }

  function htmlMotivos(m, periodo) {
    const chips = [['90d', '90 dias'], ['12m', '12 meses'], ['tudo', 'Tudo']].map(([v, t]) => `<button type="button" class="crm-chip" data-crm-periodo="${v}" aria-pressed="${v === periodo}">${t}</button>`).join('');
    const corpo = m.total
      ? `<p class="crm-numero-menor"><strong>${esc(plural(m.total, 'licitação perdida', 'licitações perdidas'))}</strong> · ${esc(reais(m.valorTotal))} em jogo</p>
        <ol class="crm-motivos">${m.linhas.map((l) => `<li class="crm-motivo">
          <div class="crm-motivo-topo"><strong>${esc(l.rotulo)}</strong><span>${esc(plural(l.quantidade, 'vez', 'vezes'))} · ${l.percentual}% · ${esc(reais(l.valor))}</span></div>
          <span class="crm-motivo-barra" aria-hidden="true"><span style="width:${Math.max(3, l.percentual)}%"></span></span>
          <p class="crm-conselho"><span>O que fazer:</span> ${esc(l.conselho)}</p></li>`).join('')}</ol>`
      : `<div class="crm-vazio"><p><strong>Nenhuma licitação perdida neste período.</strong></p>
        <p class="crm-fraco">Quando você mover um cartão para "Perdi" no Funil e disser o motivo, ele aparece aqui com um conselho do que fazer na próxima.</p></div>`;
    return `<div class="crm-periodos" role="group" aria-label="Período do relatório">${chips}</div>${corpo}`;
  }

  function htmlAjuste(etapas) {
    const abertas = [...etapas].filter((e) => ABERTOS.includes(e.status_sistema)).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    return `<form method="dialog" class="crm-ajuste" novalidate>
      <div class="etapas-dialogo-topo"><h3 id="crm-ajuste-titulo">Chance de ganhar em cada etapa</h3></div>
      <p class="crm-fraco">De 0 a 100%. Deixe vazio para usar o padrão sugerido. Vale para todas as empresas desta conta.</p>
      ${abertas.map((e) => `<label class="crm-ajuste-linha"><span>${esc(e.nome)}</span>
        <span class="crm-ajuste-campo"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" name="${esc(e.id)}" value="${Number.isInteger(e.probabilidade) ? e.probabilidade : ''}" placeholder="${CHANCE_PADRAO[e.status_sistema] ?? 0}" aria-describedby="crm-ajuste-erro"> %</span></label>`).join('')}
      <p id="crm-ajuste-erro" class="erro-campo" role="alert" hidden></p>
      <div class="fc-acoes"><button type="button" class="btn-imprimir" data-crm-cancelar>Cancelar</button><button type="submit" class="btn-imprimir fc-primario">Salvar chances e recalcular</button></div>
    </form>`;
  }
  // Texto do campo -> null (padrão) ou inteiro 0..100; undefined = inválido.
  function lerChance(texto) {
    const t = String(texto ?? '').trim();
    if (!t) return null;
    return /^\d{1,3}$/.test(t) && Number(t) <= 100 ? Number(t) : undefined;
  }

  const api = { CHANCE_PADRAO, CONSELHOS, ehExemplo, centavosDe, chanceDaEtapa, mesDe, somarMes, calcularPrevisao, agruparMotivos, lerChance,
    htmlPrevisao, htmlMotivos, htmlAjuste };
  global.LicitaCrmRelatorios = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // ---------- navegador: lê o banco (RLS por organização) e desenha no #dash-crm do Dashboard ----------
  const estado = { empresas: [], escolha: null, periodo: '12m', processos: [], etapas: [], execucao: {}, carregando: null, chave: '', em: 0 };
  const CHAVE_EMPRESA = 'licitaplena_empresa_operacional_id';
  // URL do PostgREST tem limite: .in() em lotes.
  async function emLotes(ids, consulta) {
    const saida = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await consulta(ids.slice(i, i + 150));
      if (error) return { error };
      saida.push(...(data || []));
    }
    return { data: saida };
  }
  async function carregar() {
    const sb = global.__sbClient;
    const { data: empresas, error } = await sb.from('operacao_empresas').select('id,razao_social,organizacao_id').eq('ativo', true).order('razao_social');
    if (error) throw error;
    estado.empresas = empresas || [];
    const ativa = estado.empresas.find((e) => e.id === localStorage.getItem(CHAVE_EMPRESA)) || estado.empresas[0];
    if (!ativa) return false;
    if (estado.escolha !== 'todas' && !estado.empresas.some((e) => e.id === estado.escolha)) estado.escolha = ativa.id;
    const org = (estado.empresas.find((e) => e.id === estado.escolha) || ativa).organizacao_id;
    estado.empresas = estado.empresas.filter((e) => e.organizacao_id === org);
    const consulta = (comExemplo) => {
      let q = sb.from('operacao_processos').select(`id,empresa_id,status,etapa_id,objeto,valor_estimado,preco_proposta,valor_homologado,data_sessao,data_resultado,motivo_perda,atualizado_em${comExemplo ? ',exemplo' : ''}`)
        .eq('organizacao_id', org).neq('status', 'arquivado').limit(5000);
      if (comExemplo) q = q.not('exemplo', 'is', true);
      return estado.escolha !== 'todas' ? q.eq('empresa_id', estado.escolha) : q;
    };
    let [proc, etapas] = await Promise.all([consulta(true), sb.from('operacao_funil_etapas').select('*').eq('organizacao_id', org)]);
    // Sem planos_e_recursos.sql a coluna exemplo não existe: relê sem ela (o prefixo do objeto segue filtrando).
    if (proc.error && (proc.error.code === '42703' || /exemplo/.test(proc.error.message || ''))) proc = await consulta(false);
    if (proc.error) throw proc.error;
    estado.processos = proc.data || [];
    estado.etapas = etapas.error ? [] : etapas.data || [];
    estado.org = org;
    const ids = estado.processos.filter((p) => GANHOS.includes(p.status)).map((p) => p.id);
    estado.execucao = {};
    const cp = global.ContratoPublico;
    if (ids.length && cp) {
      // Tabelas opcionais (SQL ainda não aplicado) viram lista vazia, como em processos.html.
      const ler = (tabela, colunas) => emLotes(ids, (lote) => sb.from(tabela).select(colunas).in('processo_id', lote)).then((r) => r.data || []);
      const [contratos, empenhos, publicos, eventos] = await Promise.all([
        ler('operacao_contratos', 'processo_id,valor,vigencia_fim'), ler('operacao_empenhos', 'processo_id,valor,status'),
        ler('operacao_contratos_publicos', '*'), ler('operacao_execucao_eventos', 'processo_id,tipo,valor')]);
      const porId = new Map(estado.processos.map((p) => [p.id, p]));
      const doP = (lista, id) => lista.filter((x) => x.processo_id === id);
      for (const id of ids) {
        const f = cp.fasesExecucao({ contratos: doP(contratos, id), empenhos: doP(empenhos, id), publicos: doP(publicos, id), eventos: doP(eventos, id), homologado: porId.get(id)?.valor_homologado });
        const num = (c) => (c == null ? null : Number(c));
        estado.execucao[id] = { potencial: num(f.fases.potencial.valor), recebido: num(f.fases.recebido.valor), vigenciaFim: f.vigenciaFim };
      }
    }
    return true;
  }

  function desenhar(raiz) {
    const seletor = estado.empresas.length > 1
      ? `<label class="crm-empresa">Empresa <select data-crm-empresa><option value="todas" ${estado.escolha === 'todas' ? 'selected' : ''}>Todas as empresas (${estado.empresas.length})</option>${estado.empresas.map((e) => `<option value="${esc(e.id)}" ${e.id === estado.escolha ? 'selected' : ''}>${esc(e.razao_social)}</option>`).join('')}</select></label>`
      : '';
    const previsao = calcularPrevisao({ processos: estado.processos, etapas: estado.etapas, execucao: estado.execucao });
    const motivos = agruparMotivos({ processos: estado.processos, periodo: estado.periodo });
    const podeAjustar = estado.etapas.some((e) => 'probabilidade' in e);
    raiz.innerHTML = `${seletor ? `<div class="crm-topo">${seletor}</div>` : ''}<div class="crm-duas">
      <div role="region" class="dash-painel crm-cartao" aria-labelledby="crm-prev-titulo"><h3 class="dash-painel-titulo" id="crm-prev-titulo">Previsão de faturamento</h3>${htmlPrevisao(previsao, { podeAjustar })}</div>
      <div role="region" class="dash-painel crm-cartao" aria-labelledby="crm-perco-titulo"><h3 class="dash-painel-titulo" id="crm-perco-titulo">Por que eu perco?</h3>${htmlMotivos(motivos, estado.periodo)}</div></div>
      <dialog class="crm-dialogo" aria-labelledby="crm-ajuste-titulo"></dialog>`;
  }

  async function salvarChances(raiz) {
    const dialogo = raiz.querySelector('.crm-dialogo');
    dialogo.innerHTML = htmlAjuste(estado.etapas);
    const form = dialogo.querySelector('form'), erro = dialogo.querySelector('#crm-ajuste-erro');
    dialogo.querySelector('[data-crm-cancelar]').addEventListener('click', () => dialogo.close());
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const mudancas = [];
      for (const campo of form.querySelectorAll('input')) {
        const v = lerChance(campo.value);
        campo.setAttribute('aria-invalid', String(v === undefined));
        if (v === undefined) { erro.textContent = 'Use um número inteiro de 0 a 100, ou deixe vazio para o padrão.'; erro.hidden = false; campo.focus(); return; }
        const etapa = estado.etapas.find((e) => e.id === campo.name);
        if (etapa && (etapa.probabilidade ?? null) !== v) mudancas.push([etapa, v]);
      }
      const botao = form.querySelector('[type=submit]');
      botao.disabled = true; botao.textContent = 'Salvando…';
      for (const [etapa, v] of mudancas) {
        const { data, error } = await global.__sbClient.from('operacao_funil_etapas').update({ probabilidade: v }).eq('id', etapa.id).eq('organizacao_id', estado.org).select('id');
        if (error || !data?.length) {
          erro.textContent = error?.code === '42501' || !data?.length ? 'Seu acesso não permite mudar as etapas. Peça a quem administra a conta.' : 'O banco não aceitou agora. Tente de novo em instantes.';
          erro.hidden = false; botao.disabled = false; botao.textContent = 'Salvar chances e recalcular'; return;
        }
        etapa.probabilidade = v;
      }
      dialogo.close();
      desenhar(raiz);
    });
    dialogo.showModal();
    form.querySelector('input')?.focus();
  }

  function ligar(raiz) {
    if (raiz.dataset.crmLigado) return;
    raiz.dataset.crmLigado = '1';
    raiz.addEventListener('click', (ev) => {
      const periodo = ev.target.closest('[data-crm-periodo]');
      if (periodo) { estado.periodo = periodo.dataset.crmPeriodo; desenhar(raiz); raiz.querySelector(`[data-crm-periodo="${estado.periodo}"]`)?.focus(); return; }
      if (ev.target.closest('[data-crm-ajustar]')) { void salvarChances(raiz); return; }
      const ir = ev.target.closest('[data-crm-ir]');
      if (ir) document.querySelector(`nav button[data-alvo="${ir.dataset.crmIr}"]`)?.click();
    });
    raiz.addEventListener('change', (ev) => {
      if (!ev.target.matches('[data-crm-empresa]')) return;
      estado.escolha = ev.target.value; estado.chave = '';
      void atualizar();
    });
  }

  // Chamado por window.__atualizarDashboard (várias vezes por carga): só relê o banco se mudou a empresa ou passou 30 s.
  async function atualizar() {
    const raiz = document.getElementById('dash-crm');
    if (!raiz) return;
    ligar(raiz);
    const chave = `${localStorage.getItem(CHAVE_EMPRESA)}|${estado.escolha}`;
    if (estado.carregando || (chave === estado.chave && Date.now() - estado.em < 30000)) return;
    estado.chave = chave; estado.em = Date.now();
    if (!raiz.innerHTML.trim()) raiz.innerHTML = '<p class="crm-fraco">Carregando previsão e perdas…</p>';
    estado.carregando = (async () => {
      try {
        if (global.__clientePronto) await global.__clientePronto;
        if (!global.__sbClient) return;
        if (!(await carregar())) { raiz.innerHTML = '<div class="dash-painel crm-vazio"><p><strong>Previsão e perdas aparecem aqui.</strong></p><p class="crm-fraco">Cadastre sua empresa em Minhas empresas e documentos e acompanhe licitações no Funil.</p></div>'; return; }
        desenhar(raiz);
      } catch (e) {
        estado.chave = '';
        raiz.innerHTML = '<div class="dash-painel"><p class="crm-fraco">Não foi possível carregar a previsão agora. Atualize a página em instantes.</p></div>';
      } finally { estado.carregando = null; }
    })();
    await estado.carregando;
  }
  api.atualizar = atualizar;
})(globalThis);
