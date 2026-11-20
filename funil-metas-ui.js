/* global module */
// Funil v3 — "Metas e automação" por empresa (CNPJ): meta de faturamento (planilha de metas, rtzJ_7w8uOE), nota do nicho
// pelos 4 critérios do diagrama de convergência (kR0PMkUDOpc), conversão de cada etapa do Funil com a meta de
// oportunidades por dia (UXT8jQH0fE4) e o Prospecta (as melhores do boletim entram sozinhas no Funil).
// Sem rede: o painel.html lê/grava operacao_funil_preferencias (supabase/funil_v3.sql) e passa buscarNicho(); aqui só regras e tela.
// Visual novo (20/11/2026): aguarda aprovação do dono.
(function (global) {
  'use strict';
  const num = (v, padrao = 0) => { if (String(v ?? '').trim() === '') return padrao; const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : padrao; };
  const PADRAO_META = { pro_labore: 0, custo_empresa: 0, caixa_total: 0, caixa_meses: 60, margem: 30, vitorias_mes: 4, taxa_vitoria: 20 };

  // Faturamento que a margem precisa gerar para pagar pró-labore, custo fixo e o caixa desejado (dividido em N meses).
  function calcularMeta(entrada = {}) {
    const m = { ...PADRAO_META };
    for (const k of Object.keys(PADRAO_META)) m[k] = num(entrada[k], PADRAO_META[k]);
    const margem = Math.min(Math.max(m.margem, 1), 100) / 100;
    const taxa = Math.min(Math.max(m.taxa_vitoria, 1), 100) / 100;
    const vitorias = Math.max(1, Math.round(m.vitorias_mes));
    const lucro_mes = m.pro_labore + m.custo_empresa + m.caixa_total / Math.max(1, m.caixa_meses);
    const faturamento_mes = Math.round((lucro_mes / margem) * 100) / 100;
    const disputas_mes = Math.ceil(vitorias / taxa);
    return { ...m, vitorias_mes: vitorias, lucro_mes, faturamento_mes, faturamento_ano: Math.round(faturamento_mes * 1200) / 100,
      valor_minimo: Math.round((faturamento_mes / vitorias) * 100) / 100, disputas_mes, disputas_semana: Math.ceil(disputas_mes / 4.33) };
  }

  // Diagrama de convergência: atue onde passam 3 ou 4 critérios.
  function notaNicho(n = {}, faturamentoAno = 0) {
    const participantes = n.participantes == null || n.participantes === '' ? null : num(n.participantes, null);
    const volume = num(n.volume_anual), marcas = n.marcas == null || n.marcas === '' ? null : num(n.marcas, null);
    const afinidade = Math.min(3, Math.round(num(n.afinidade)));
    const criterios = [
      { nome: 'Pouca concorrência', passou: participantes !== null && participantes <= 3, texto: participantes === null ? 'Sem dado de participantes' : `${participantes.toLocaleString('pt-BR')} participante(s) por item (bom: até 3)` },
      { nome: 'Mercado grande', passou: faturamentoAno > 0 && volume >= 3 * faturamentoAno, texto: faturamentoAno > 0 ? `Volume do ano ${volume >= 3 * faturamentoAno ? '≥' : '<'} 3 vezes a sua meta anual` : 'Defina a meta para comparar' },
      { nome: 'Opções de fornecedor', passou: marcas !== null && marcas >= 3, texto: marcas === null ? 'Sem dado de marcas' : `${marcas} marca(s) ou fabricante(s) (bom: 3 ou mais, há de quem comprar)` },
      { nome: 'Afinidade', passou: afinidade >= 2, texto: `Sua afinidade: ${afinidade} de 3` },
    ];
    const nota = criterios.filter((c) => c.passou).length;
    return { nota, criterios, veredito: nota >= 3 ? 'Vale atuar neste nicho.' : nota === 2 ? 'Nicho no limite: avalie com cuidado.' : 'Melhor procurar outro nicho.' };
  }

  // historico_itens com historico_participacoes(fornecedor_chave, marca, marca_declarada) -> média de participantes e marcas.
  function resumoNicho(linhas) {
    const itens = (linhas || []).filter((i) => Array.isArray(i?.historico_participacoes) && i.historico_participacoes.length);
    const marcas = new Set(itens.flatMap((i) => i.historico_participacoes.map((p) => String(p.marca || p.marca_declarada || '').trim().toUpperCase()).filter(Boolean)));
    const soma = itens.reduce((s, i) => s + new Set(i.historico_participacoes.map((p) => p.fornecedor_chave)).size, 0);
    return { itens: itens.length, participantes: itens.length ? Math.round((soma / itens.length) * 10) / 10 : null, marcas: itens.length ? marcas.size : null };
  }

  // Conversão: quantas licitações chegaram a cada etapa (as que estão nela ou adiante). Perdidas contam só na primeira.
  // etapas = operacao_funil_etapas; processos = [{ status, etapa_id, criado_em }].
  function conversaoFunil(etapas, processos, agora = Date.now()) {
    const ordem = [...(etapas || [])].filter((e) => e.status_sistema !== 'perdido').sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    const posicao = (p) => {
      if (p.status === 'perdido') return 0;
      const porId = ordem.findIndex((e) => e.id === p.etapa_id);
      if (porId >= 0) return porId;
      const porStatus = ordem.findIndex((e) => e.status_sistema === p.status);
      return porStatus >= 0 ? porStatus : 0;
    };
    const ativos = (processos || []).filter((p) => p.status !== 'arquivado');
    const pos = ativos.map(posicao);
    const linhas = ordem.map((e, i) => ({ id: e.id, nome: e.nome, chegaram: pos.filter((x) => x >= i).length }));
    linhas.forEach((l, i) => { l.taxa = i === 0 ? null : (linhas[i - 1].chegaram ? Math.round((l.chegaram / linhas[i - 1].chegaram) * 1000) / 10 : 0); });
    const hoje = new Date(agora - 3 * 36e5).toISOString().slice(0, 10);
    const entraramHoje = ativos.filter((p) => p.criado_em && new Date(Date.parse(p.criado_em) - 3 * 36e5).toISOString().slice(0, 10) === hoje).length;
    return { linhas, entraramHoje, perdidas: ativos.filter((p) => p.status === 'perdido').length };
  }

  // ---------- tela ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const ABAS = [['meta', 'Minha meta'], ['nicho', 'Nota do nicho'], ['conversao', 'Conversão do Funil'], ['automacao', 'Prospecta e modelo']];
  const CAMPOS_META = [['pro_labore', 'Pró-labore desejado por mês (R$)'], ['custo_empresa', 'Custo fixo da empresa por mês (R$)'],
    ['caixa_total', 'Caixa que quer juntar (R$)'], ['caixa_meses', 'Em quantos meses'], ['margem', 'Margem sobre a venda (%)'],
    ['vitorias_mes', 'Contratos que consegue atender por mês'], ['taxa_vitoria', 'Quantas disputas você ganha (%)']];

  function htmlResultadoMeta(r, oportunidadesDia) {
    return `<dl class="fm-numeros">
      <div><dt>Faturamento por mês</dt><dd>${esc(brl(r.faturamento_mes))}</dd></div>
      <div><dt>Faturamento por ano</dt><dd>${esc(brl(r.faturamento_ano))}</dd></div>
      <div><dt>Valor mínimo por oportunidade</dt><dd>${esc(brl(r.valor_minimo))}</dd></div>
      <div><dt>Disputas por mês</dt><dd>${r.disputas_mes} (${r.disputas_semana} por semana)</dd></div>
      <div><dt>Oportunidades novas por dia no Funil</dt><dd>${oportunidadesDia}</dd></div></dl>
      <p class="funil-fraco">Use ${esc(brl(r.valor_minimo))} como valor mínimo no filtro do Boletim. O Prospecta dá nota maior às licitações acima desse valor.</p>`;
  }

  // ctx: { empresaNome, preferencias, etapas, processos, modelos, salvar(campos) -> linha, buscarNicho(termo) -> {participantes, marcas, volume_anual} }
  function abrirMetas(dialogo, ctx) {
    let pref = { meta: {}, nichos: [], oportunidades_dia: 10, prospecta_ativo: false, prospecta_limite: 3, prospecta_nota_minima: 60, modelo_tarefas: 'padrao', ...(ctx.preferencias || {}) };
    let aba = 'meta', ocupado = false, mensagem = '', ok = '';
    let rascunhoNicho = { termo: '', participantes: '', marcas: '', volume_anual: '', afinidade: 2 };
    const faturamentoAno = () => calcularMeta(pref.meta).faturamento_ano;

    function corpo() {
      if (aba === 'meta') {
        const r = calcularMeta(pref.meta);
        return `<form class="fm-form" data-fm-meta>${CAMPOS_META.map(([k, rot]) => `<label>${rot}<input type="number" min="0" step="any" name="${k}" value="${esc(r[k])}"></label>`).join('')}
          <label>Meta de oportunidades novas por dia<input type="number" min="0" max="200" name="oportunidades_dia" value="${esc(pref.oportunidades_dia)}"></label>
          <div data-fm-resultado class="fm-resultado">${htmlResultadoMeta(r, pref.oportunidades_dia)}</div>
          <button type="submit" class="btn-imprimir">Salvar meta</button></form>`;
      }
      if (aba === 'nicho') {
        const lista = (pref.nichos || []).map((n, i) => {
          const r = notaNicho(n, faturamentoAno());
          return `<li class="fm-nicho"><strong>${esc(n.termo)}</strong> · nota ${r.nota} de 4 · ${esc(r.veredito)}
            <ul>${r.criterios.map((c) => `<li class="${c.passou ? 'fm-passou' : 'fm-falhou'}">${c.passou ? '✓' : '✗'} ${esc(c.nome)}: ${esc(c.texto)}</li>`).join('')}</ul>
            <button type="button" class="funil-link" data-fm-remover-nicho="${i}">Remover</button></li>`;
        }).join('');
        const previa = notaNicho(rascunhoNicho, faturamentoAno());
        return `<p class="funil-fraco">Avalie um nicho por 4 critérios. "Buscar dados" usa a Inteligência de Mercado (contratos do último ano) e o histórico de pregões.</p>
          <form class="fm-form" data-fm-nicho>
            <label>Produto ou nicho<input name="termo" maxlength="80" required value="${esc(rascunhoNicho.termo)}" placeholder="Ex.: papel A4"></label>
            <button type="button" class="btn-imprimir" data-fm-buscar-nicho>Buscar dados</button>
            <label>Participantes por item<input type="number" min="0" step="any" name="participantes" value="${esc(rascunhoNicho.participantes)}"></label>
            <label>Volume contratado no ano (R$)<input type="number" min="0" step="any" name="volume_anual" value="${esc(rascunhoNicho.volume_anual)}"></label>
            <label>Marcas ou fabricantes<input type="number" min="0" name="marcas" value="${esc(rascunhoNicho.marcas)}"></label>
            <label>Sua afinidade com o produto<select name="afinidade">${[0, 1, 2, 3].map((v) => `<option value="${v}" ${Number(rascunhoNicho.afinidade) === v ? 'selected' : ''}>${v} de 3</option>`).join('')}</select></label>
            <p class="fm-previa" data-fm-previa>Nota: ${previa.nota} de 4 · ${esc(previa.veredito)}</p>
            <button type="submit" class="btn-imprimir">Salvar nicho</button></form>
          <ul class="fm-nichos">${lista || '<li class="funil-fraco">Nenhum nicho salvo.</li>'}</ul>`;
      }
      if (aba === 'conversao') {
        const c = conversaoFunil(ctx.etapas, ctx.processos);
        const meta = Number(pref.oportunidades_dia) || 0;
        return `<p class="fm-hoje">Hoje entraram <strong>${c.entraramHoje}</strong> de ${meta} oportunidade(s) da meta diária.</p>
          <table class="funil-tabela fm-tabela"><thead><tr><th scope="col">Etapa</th><th scope="col">Chegaram</th><th scope="col">Conversão da etapa anterior</th></tr></thead><tbody>
          ${c.linhas.map((l) => `<tr><td data-rotulo="Etapa">${esc(l.nome)}</td><td data-rotulo="Chegaram">${l.chegaram}</td><td data-rotulo="Conversão">${l.taxa === null ? '—' : `${l.taxa.toLocaleString('pt-BR')}%`}</td></tr>`).join('')}
          </tbody></table><p class="funil-fraco">Conta as licitações desta empresa que estão em cada etapa ou já passaram dela. Perdidas (${c.perdidas}) contam só na primeira etapa; arquivadas ficam de fora.</p>`;
      }
      const opcoes = [['padrao', 'Padrão do LicitaPlena'], ['nenhum', 'Nenhuma tarefa'], ...(ctx.modelos || []).map((m) => [m.id, m.nome])]
        .map(([v, r]) => `<option value="${esc(v)}" ${pref.modelo_tarefas === v ? 'selected' : ''}>${esc(r)}</option>`).join('');
      return `<form class="fm-form" data-fm-automacao>
          <label class="fm-check"><input type="checkbox" name="prospecta_ativo" ${pref.prospecta_ativo ? 'checked' : ''}> Ligar o Prospecta nesta empresa</label>
          <p class="funil-fraco">Todo dia, na rodada do boletim das 6h, o robô põe no Funil (primeira etapa, selo "Sugerida") as melhores licitações do boletim desta empresa. Nunca repete uma licitação que já está no Funil ou que você dispensou. Precisa do filtro do Boletim desta empresa salvo.</p>
          <label>Até quantas por dia<input type="number" min="1" max="10" name="prospecta_limite" value="${esc(pref.prospecta_limite)}"></label>
          <label>Nota mínima (0 a 100)<input type="number" min="0" max="100" name="prospecta_nota_minima" value="${esc(pref.prospecta_nota_minima)}"></label>
          <p class="funil-fraco">A nota soma: palavras do seu filtro achadas no objeto (até 60), valor acima do mínimo da sua meta (25) e prazo de pelo menos 3 dias para preparar a proposta (15).</p>
          <label>Tarefas de toda licitação nova no Funil<select name="modelo_tarefas">${opcoes}</select></label>
          <button type="submit" class="btn-imprimir">Salvar</button></form>`;
    }
    function desenhar() {
      dialogo.innerHTML = `<div class="etapas-dialogo-topo"><h3 id="funil-metas-titulo">Metas e automação · ${esc(ctx.empresaNome || 'empresa')}</h3>
          <div class="funil-topo-acoes"><button type="button" class="btn-imprimir" data-fm-fechar>Fechar</button></div></div>
        <div class="funil-abas" role="tablist">${ABAS.map(([v, r]) => `<button type="button" role="tab" class="funil-aba" data-fm-aba="${v}" aria-selected="${aba === v}" aria-pressed="${aba === v}">${r}</button>`).join('')}</div>
        <p class="erro-campo" role="alert" ${mensagem ? '' : 'hidden'}>${esc(mensagem)}</p>
        <p class="fm-ok" role="status" ${ok ? '' : 'hidden'}>${esc(ok)}</p>
        <div class="fm-corpo">${corpo()}</div>`;
    }
    async function salvar(campos, aviso) {
      if (ocupado) return;
      ocupado = true;
      try { pref = { ...pref, ...(await ctx.salvar(campos)) }; mensagem = ''; ok = aviso; }
      catch (e) { mensagem = e.message || 'Não foi possível salvar.'; ok = ''; }
      finally { ocupado = false; desenhar(); }
    }
    const lerForm = (form) => Object.fromEntries(new global.FormData(form).entries());

    dialogo.onclick = async (ev) => {
      const b = ev.target.closest('button');
      if (!b || ocupado) return;
      if (b.hasAttribute('data-fm-fechar')) dialogo.close();
      else if (b.dataset.fmAba) { aba = b.dataset.fmAba; mensagem = ''; ok = ''; desenhar(); }
      else if (b.dataset.fmRemoverNicho) void salvar({ nichos: pref.nichos.filter((_, i) => i !== Number(b.dataset.fmRemoverNicho)) }, 'Nicho removido.');
      else if (b.hasAttribute('data-fm-buscar-nicho')) {
        rascunhoNicho = { ...rascunhoNicho, ...lerForm(b.form) };
        const termo = String(rascunhoNicho.termo || '').trim();
        if (termo.length < 3) { mensagem = 'Digite ao menos 3 letras do produto.'; desenhar(); return; }
        ocupado = true; ok = 'Buscando…'; mensagem = ''; desenhar();
        try {
          const d = await ctx.buscarNicho(termo);
          rascunhoNicho = { ...rascunhoNicho, participantes: d.participantes ?? '', marcas: d.marcas ?? '', volume_anual: d.volume_anual ?? '' };
          ok = d.itens ? `Achamos ${d.itens} item(ns) no histórico.` : 'Sem itens no histórico para este termo: preencha à mão.';
        } catch (e) { mensagem = e.message || 'Não foi possível buscar os dados.'; ok = ''; }
        finally { ocupado = false; desenhar(); }
      }
    };
    dialogo.oninput = (ev) => {
      const form = ev.target.closest('form');
      if (form?.hasAttribute('data-fm-meta')) {
        const f = lerForm(form);
        form.querySelector('[data-fm-resultado]').innerHTML = htmlResultadoMeta(calcularMeta(f), Number(f.oportunidades_dia) || 0);
      } else if (form?.hasAttribute('data-fm-nicho')) {
        rascunhoNicho = { ...rascunhoNicho, ...lerForm(form) };
        const r = notaNicho(rascunhoNicho, faturamentoAno());
        form.querySelector('[data-fm-previa]').textContent = `Nota: ${r.nota} de 4 · ${r.veredito}`;
      }
    };
    dialogo.onsubmit = (ev) => {
      const form = ev.target.closest('form');
      if (!form) return;
      ev.preventDefault();
      const f = lerForm(form);
      if (form.hasAttribute('data-fm-meta')) {
        const r = calcularMeta(f);
        const meta = Object.fromEntries([...Object.keys(PADRAO_META), 'faturamento_mes', 'faturamento_ano', 'valor_minimo'].map((k) => [k, r[k]]));
        void salvar({ meta, oportunidades_dia: Math.min(200, Math.round(num(f.oportunidades_dia, 10))) }, 'Meta salva.');
      } else if (form.hasAttribute('data-fm-nicho')) {
        const termo = String(f.termo || '').trim().slice(0, 80);
        if (!termo) return;
        const nicho = { termo, participantes: f.participantes === '' ? null : num(f.participantes), marcas: f.marcas === '' ? null : num(f.marcas),
          volume_anual: num(f.volume_anual), afinidade: Math.min(3, Math.round(num(f.afinidade))) };
        const outros = (pref.nichos || []).filter((n) => n.termo.toLowerCase() !== termo.toLowerCase());
        if (outros.length >= 20) { mensagem = 'Até 20 nichos por empresa.'; desenhar(); return; }
        rascunhoNicho = { termo: '', participantes: '', marcas: '', volume_anual: '', afinidade: 2 };
        void salvar({ nichos: [nicho, ...outros] }, 'Nicho salvo.');
      } else if (form.hasAttribute('data-fm-automacao')) {
        void salvar({ prospecta_ativo: f.prospecta_ativo === 'on', prospecta_limite: Math.min(10, Math.max(1, Math.round(num(f.prospecta_limite, 3)))),
          prospecta_nota_minima: Math.min(100, Math.round(num(f.prospecta_nota_minima, 60))), modelo_tarefas: f.modelo_tarefas || 'padrao' }, 'Preferências salvas.');
      }
    };
    desenhar();
    if (!dialogo.open) dialogo.showModal();
  }

  const api = { calcularMeta, notaNicho, resumoNicho, conversaoFunil, abrirMetas };
  global.LicitaFunilMetas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
