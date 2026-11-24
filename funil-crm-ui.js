/* global module */
// Funil, fase 1 de CRM (24/11/2026, estudo-crm-produto-ux-20261124.md): total em reais por coluna, alerta de cartão
// parado (padrão Pipedrive), motivo obrigatório ao perder e filtros salvos do Funil.
// Sem rede: o painel.html lê e grava (operacao_processos.etapa_desde/motivo_perda, operacao_funil_etapas.limite_parado_dias
// em supabase/funil_crm.sql; filtros em filtros_salvos com filtro.tela = 'funil') e chama estas funções.
(function (global) {
  'use strict';
  const MS_DIA = 864e5;
  const FUSO_BRASILIA_MS = -3 * 36e5;

  // ---- 1. Total em reais da coluna ----
  // "1.234,56", "R$ 1.234,56", "150.000" (ponto de milhar), "1234.5" ou número. Vazio, zero ou inválido = sem valor.
  function numeroDe(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
    const t = String(v ?? '').replace(/[^0-9.,-]/g, '');
    if (!t) return null;
    const milhar = t.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(t);
    const n = Number(milhar ? t.replace(/\./g, '').replace(',', '.') : t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // Valor proposto (o que a empresa ganha se vencer) vale mais que o estimado do edital.
  function valorDoCard(edital) {
    return numeroDe(edital?.precoProposta) ?? numeroDe(edital?.valorTotalEstimado) ?? numeroDe(edital?.valor);
  }
  // Soma em centavos para não acumular erro de ponto flutuante. Cartão sem valor conta 0 e é contado à parte.
  function totalDaColuna(editais) {
    let centavos = 0, semValor = 0;
    for (const e of editais || []) {
      const v = valorDoCard(e);
      if (v === null) semValor += 1; else centavos += Math.round(v * 100);
    }
    return { quantidade: (editais || []).length, total: centavos / 100, semValor };
  }
  const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // ---- 2. Cartão parado ----
  // Dias sem movimento até o alerta, pelo estágio ("conta como"). Contratado e Perdido não ficam "parados".
  const LIMITE_PADRAO = { triagem: 7, preparacao: 5, proposta_enviada: 10, sessao: 3, habilitacao: 5, recurso: 7, homologado: 15 };
  // limite_parado_dias da etapa: null = padrão do estágio; 0 = sem alerta nesta etapa.
  function limiteDaEtapa(etapa, estagio) {
    const proprio = etapa?.limite_parado_dias;
    if (Number.isInteger(proprio)) return proprio > 0 ? proprio : null;
    return LIMITE_PADRAO[estagio || etapa?.status_sistema] ?? null;
  }
  const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };
  // Última movimentação: entrada na etapa, tarefa do checklist marcada ou tarefa do cartão concluída.
  // Cartão antigo (antes de funil_crm.sql) não tem etapa_desde: conta da última atualização do processo, marcado aproximado.
  function ultimaMovimentacao(edital) {
    const base = ms(edital?.etapaDesde);
    const aproximada = base === null;
    const datas = [base ?? ms(edital?.atualizadoEm)];
    for (const v of Object.values(edital?.checklistFunil || {})) datas.push(ms(v));
    for (const s of edital?.tarefasCard?.secoes || []) for (const t of s?.tarefas || []) datas.push(ms(t?.feita_em));
    const validas = datas.filter((d) => d !== null);
    return validas.length ? { ms: Math.max(...validas), aproximada } : null;
  }
  // Dias civis de Brasília: o cartão movido às 23h não vira "parado há 1 dia" à meia-noite e um minuto.
  const dia = (t) => Math.floor((t + FUSO_BRASILIA_MS) / MS_DIA);
  function diasParado(desdeMs, agora = Date.now()) {
    if (!Number.isFinite(desdeMs)) return null;
    return Math.max(0, dia(agora) - dia(desdeMs));
  }
  // null = sem alerta (etapa sem limite ou sem data). parado só quando passa do limite (limite 5: o 6º dia acende).
  function estadoParado(edital, limite, agora = Date.now()) {
    if (!limite) return null;
    const u = ultimaMovimentacao(edital);
    if (!u) return null;
    const dias = diasParado(u.ms, agora);
    return { dias, limite, parado: dias > limite, aproximada: u.aproximada };
  }

  // ---- 3. Motivo da perda ----
  // Mesmo texto vai para operacao_processos.motivo_perda (lido também em processos.html): "Rótulo" ou "Rótulo: detalhe".
  const MOTIVOS_PERDA = [
    ['preco', 'Preço acima do vencedor'],
    ['documento', 'Inabilitação ou documento'],
    ['tecnica', 'Desclassificação técnica'],
    ['prazo', 'Prazo perdido'],
    ['desistencia', 'Desistência'],
    ['fracassada', 'Licitação deserta, fracassada ou revogada'],
    ['outro', 'Outro motivo'],
  ];
  const LIMITE_DETALHE = 300;
  const CPF = /\b\d{3}[. ]?\d{3}[. ]?\d{3}[- /]?\d{2}\b/;
  function validarMotivo(codigo, detalhe) {
    const d = String(detalhe || '').trim();
    if (!MOTIVOS_PERDA.some(([c]) => c === codigo)) return 'Escolha por que a licitação foi perdida.';
    if (codigo === 'outro' && d.length < 3) return 'Escreva o motivo em poucas palavras (pelo menos 3 letras).';
    if (d.length > LIMITE_DETALHE) return `O detalhe pode ter até ${LIMITE_DETALHE} caracteres.`;
    if (CPF.test(d)) return 'Não escreva CPF aqui.';
    return null;
  }
  function textoMotivo(codigo, detalhe) {
    const rotulo = MOTIVOS_PERDA.find(([c]) => c === codigo)?.[1];
    const d = String(detalhe || '').replace(/\s+/g, ' ').trim();
    return d ? `${rotulo}: ${d}` : rotulo;
  }
  // Base do relatório "por que perco": texto salvo -> código. Texto livre antigo (processos.html) = 'outro'.
  function codigoDoMotivo(texto) {
    const t = String(texto || '').trim();
    if (!t) return null;
    return MOTIVOS_PERDA.find(([, r]) => t === r || t.startsWith(r + ':'))?.[0] || 'outro';
  }

  // ---- 4. Filtros salvos ----
  const CAMPOS_FILTRO = ['texto', 'portal', 'modalidade', 'de', 'ate'];
  // O que vai para filtros_salvos.filtro. tela = 'funil' separa dos filtros de Encontrar licitações (e dos jornais por e-mail).
  function filtroParaSalvar(f, vence3) {
    const saida = { tela: 'funil' };
    for (const c of CAMPOS_FILTRO) if (typeof f?.[c] === 'string' && f[c].trim()) saida[c] = f[c].trim().slice(0, 200);
    if (f?.favoritas) saida.favoritas = true;
    if (vence3) saida.vence3 = true;
    return saida;
  }
  // Volta o filtro salvo para o formato de filtrosFunil (campo ausente = vazio).
  function filtroSalvoParaTela(salvo) {
    const f = { texto: '', portal: '', modalidade: '', de: '', ate: '', favoritas: Boolean(salvo?.favoritas) };
    for (const c of CAMPOS_FILTRO) if (typeof salvo?.[c] === 'string') f[c] = salvo[c];
    return { filtros: f, vence3: Boolean(salvo?.vence3) };
  }
  function nomeFiltroValido(nome) {
    const n = String(nome || '').replace(/\s+/g, ' ').trim();
    return n && n.length <= 60 ? n : null;
  }

  // ---- HTML ----
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function htmlTotal(t) {
    const qtd = `${t.quantidade} ${t.quantidade === 1 ? 'licitação' : 'licitações'}`;
    const sem = t.semValor ? `<span class="fc-sem-valor" title="Cartão sem valor estimado nem proposto entra como R$ 0 na soma">${t.semValor} sem valor (conta R$ 0)</span>` : '';
    return `<div class="fc-total" aria-label="${esc(`${qtd}, total ${reais(t.total)}`)}"><strong>${esc(reais(t.total))}</strong><span>${qtd}</span>${sem}</div>`;
  }
  function htmlSeloParado(estado) {
    if (!estado?.parado) return '';
    const dica = `Sem mudança de etapa nem tarefa concluída há ${estado.dias} dias (limite desta etapa: ${estado.limite}). Mova o cartão ou conclua uma tarefa.`
      + (estado.aproximada ? ' Contado desde a última atualização do processo.' : '');
    return `<span class="kanban-card-prazo fc-selo-parado" title="${esc(dica)}">Parado há ${estado.dias} ${estado.dias === 1 ? 'dia' : 'dias'}</span>`;
  }
  function htmlMotivoCard(id, motivo) {
    return motivo
      ? `<p class="fc-motivo"><span>Motivo da perda:</span> ${esc(motivo)}</p>`
      : `<button type="button" class="fc-motivo-falta" data-fc-motivo="${esc(id)}">Informar o motivo da perda</button>`;
  }
  function htmlSalvos(salvos, podeSalvar, abertoForm, aviso) {
    const chips = (salvos || []).map((s) => `<span class="fc-chip"><button type="button" class="fc-chip-aplicar" data-fc-aplicar="${esc(s.id)}">${esc(s.nome)}</button><button type="button" class="fc-chip-apagar" data-fc-apagar="${esc(s.id)}" aria-label="Apagar o filtro ${esc(s.nome)}" title="Apagar">×</button></span>`).join('');
    const form = abertoForm
      ? `<form class="fc-salvar-form" data-fc-form><label>Nome do filtro<input type="text" name="nome" maxlength="60" required placeholder="Ex.: Compras.gov favoritas" autocomplete="off"></label><button type="submit" class="btn-imprimir fc-primario">Salvar filtro</button><button type="button" class="btn-imprimir" data-fc-cancelar>Cancelar</button></form>`
      : `<button type="button" class="btn-imprimir" data-fc-novo ${podeSalvar ? '' : 'disabled title="Escolha algum filtro antes de salvar"'}>Salvar estes filtros</button>`;
    return `<div class="fc-salvos" role="group" aria-label="Meus filtros salvos do Funil"><span class="fc-salvos-titulo">Meus filtros salvos</span>${chips || '<span class="fc-salvos-vazio">Nenhum ainda</span>'}${form}<span class="fc-salvos-aviso" role="status">${esc(aviso || '')}</span></div>`;
  }

  // Diálogo do motivo. Resolve com o texto a salvar, ou null se a pessoa cancelar (o cartão não muda de coluna).
  function pedirMotivo(dialogo, titulo) {
    const opcoes = MOTIVOS_PERDA.map(([c, r]) => `<label class="fc-opcao"><input type="radio" name="motivo" value="${c}"> ${esc(r)}</label>`).join('');
    dialogo.innerHTML = `<form method="dialog" class="fc-motivo-form" novalidate>
      <div class="etapas-dialogo-topo"><h3 id="fc-motivo-titulo">Por que a licitação foi perdida?</h3></div>
      <p class="etapas-ajuda">${esc(titulo)}</p>
      <fieldset class="fc-opcoes" aria-describedby="fc-motivo-erro"><legend>Motivo (obrigatório)</legend>${opcoes}</fieldset>
      <label class="fc-detalhe"><span>Detalhe <span data-fc-opcional>(opcional)</span></span><textarea name="detalhe" rows="2" maxlength="${LIMITE_DETALHE}" placeholder="Ex.: vencedor ofertou 8% abaixo"></textarea></label>
      <p id="fc-motivo-erro" class="erro-campo" role="alert" hidden></p>
      <div class="fc-acoes"><button type="button" class="btn-imprimir" data-fc-cancelar>Cancelar e não mover</button><button type="submit" class="btn-imprimir fc-primario">Mover para perdida</button></div>
    </form>`;
    const form = dialogo.querySelector('form'), erro = dialogo.querySelector('#fc-motivo-erro');
    return new Promise((resolver) => {
      let resposta = null;
      form.addEventListener('change', () => { dialogo.querySelector('[data-fc-opcional]').textContent = form.motivo.value === 'outro' ? '(obrigatório)' : '(opcional)'; });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const problema = validarMotivo(form.motivo.value, form.detalhe.value);
        erro.textContent = problema || ''; erro.hidden = !problema;
        if (problema) { (form.motivo.value ? form.detalhe : form.querySelector('input[name=motivo]')).focus(); return; }
        resposta = textoMotivo(form.motivo.value, form.detalhe.value);
        dialogo.close();
      });
      dialogo.querySelector('[data-fc-cancelar]').addEventListener('click', () => dialogo.close());
      dialogo.addEventListener('close', () => resolver(resposta), { once: true });
      dialogo.showModal();
      form.querySelector('input[name=motivo]').focus();
    });
  }

  const api = { LIMITE_PADRAO, MOTIVOS_PERDA, valorDoCard, totalDaColuna, reais, limiteDaEtapa, ultimaMovimentacao, diasParado, estadoParado,
    validarMotivo, textoMotivo, codigoDoMotivo, filtroParaSalvar, filtroSalvoParaTela, nomeFiltroValido,
    htmlTotal, htmlSeloParado, htmlMotivoCard, htmlSalvos, pedirMotivo };
  global.LicitaFunilCrm = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
