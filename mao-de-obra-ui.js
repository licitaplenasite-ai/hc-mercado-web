/* global document, window, location, localStorage, URL, Blob -- script de navegador */
// Tela da planilha de custos de mão de obra (mao-de-obra.html). Toda a conta está em mao-de-obra-regras.js;
// aqui só monta o formulário, mostra o resultado, guarda o rascunho por conta e baixa o CSV.
(function () {
  'use strict';
  const R = window.MaoDeObraRegras;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opcoes = (mapa) => Object.entries(mapa).map(([v, n]) => [v, typeof n === 'string' ? n : n.nome]);
  // [chave, rótulo, dica, opções de select]
  const CAMPOS = {
    dados: [['servico', 'Tipo de serviço', '', opcoes(R.SERVICOS)], ['funcao', 'Função / cargo', 'Como está na CCT. Ex.: Servente de limpeza'],
      ['escala', 'Escala de trabalho', '44h: 1 empregado por posto. 12x36: 2 empregados por posto.', opcoes(R.ESCALAS)],
      ['empregadosPorPosto', 'Empregados por posto'], ['postos', 'Quantidade de postos'], ['meses', 'Meses do contrato'],
      ['diasMes', 'Dias trabalhados no mês', '44h: 22. 12x36: 15,21 plantões (365 ÷ 2 ÷ 12).']],
    m1: [['salarioBase', 'Salário-base (R$)', 'Piso da CCT.'], ['salarioMinimo', 'Salário mínimo vigente (R$)', 'Base da insalubridade. Confira o valor do ano.'],
      ['periculosidadePct', 'Periculosidade %', '30% do salário-base (vigilância).'], ['insalubridadePct', 'Insalubridade %', 'Grau mínimo 10%, médio 20%, máximo 40%.'],
      ['insalubridadeBase', 'Insalubridade calculada sobre', 'A CCT pode mandar usar o salário-base.', [['minimo', 'Salário mínimo'], ['salario', 'Salário-base']]],
      ['divisorHoras', 'Divisor de horas do mês', '220 para 44h. Algumas CCTs usam 180 na 12x36.'],
      ['horasNoturnasPlantao', 'Horas noturnas por plantão', 'Só na 12x36 noturna. 22h às 5h = 7; com prorrogação até 7h = 9.'],
      ['adicionalNoturnoPct', 'Adicional noturno %', 'Mínimo 20% (CLT, art. 73).'], ['dsrPct', 'DSR sobre adicionais noturnos %', 'Só se a CCT mandar. Ex.: 16,67.'],
      ['outrosRemuneracao', 'Outros na remuneração (R$)', 'Ex.: gratificação da CCT.']],
    m2: [['decimoPct', '13º salário %', '1/12 = 8,33%.'], ['adicionalFeriasPct', 'Adicional de férias %', '1/3 × 1/12 = 2,78%.'],
      ['inss', 'INSS %'], ['salarioEducacao', 'Salário-Educação %'], ['rat', 'SAT/RAT %', '1%, 2% ou 3% conforme o CNAE.'], ['fap', 'FAP (multiplicador)', 'Entre 0,5 e 2,0.'],
      ['sesc', 'SESC ou SESI %'], ['senac', 'SENAC ou SENAI %'], ['sebrae', 'SEBRAE %'], ['incra', 'INCRA %'], ['fgts', 'FGTS %']],
    m23: [['vtPassagensDia', 'Passagens por dia'], ['vtValorPassagem', 'Valor da passagem (R$)'], ['vtDescontoPct', 'Desconto do VT no salário %', 'Até 6% do salário-base (Lei 7.418/1985).'],
      ['vaValorDia', 'Auxílio-alimentação por dia (R$)', 'Valor da CCT.'], ['vaDescontoPct', 'Desconto do auxílio-alimentação %'],
      ['assistenciaMedica', 'Assistência médica/odontológica (R$/mês)'], ['seguroVida', 'Seguro de vida (R$/mês)'], ['outrosBeneficios', 'Outros benefícios (R$/mês)']],
    m34: [['apIndenizadoPct', 'Aviso prévio indenizado %', '1/12 × 5% dos empregados = 0,42%.'], ['apTrabalhadoPct', 'Aviso prévio trabalhado %', '(7 ÷ 30) ÷ 12 = 1,94%.'],
      ['multaFgtsPct', 'Multa do FGTS sobre aviso trabalhado %', '8% × 40% × 90% × 1,1944 = 3,44%.'], ['multaFgtsAliquota', 'Multa rescisória do FGTS %', '40% (usada sobre o aviso indenizado).'],
      ['feriasSubstPct', 'Substituto nas férias %', '1/12 = 8,33%.'], ['ausenciasLegaisPct', 'Ausências legais %'], ['paternidadePct', 'Licença-paternidade %'],
      ['acidentePct', 'Acidente de trabalho %'], ['maternidadePct', 'Afastamento maternidade %'], ['outrasAusenciasPct', 'Outras ausências %']],
    m5: [['uniformes', 'Uniformes (R$)'], ['materiais', 'Materiais (R$)'], ['equipamentos', 'Equipamentos (R$)'], ['outrosInsumos', 'Outros insumos (R$)']],
    m6: [['regime', 'Regime tributário', 'Preenche PIS, COFINS, ISS e Simples com valores de partida.', [['presumido', 'Lucro Presumido'], ['real', 'Lucro Real'], ['simples', 'Simples Nacional (Anexo IV)']]],
      ['ciPct', 'Custos indiretos %'], ['lucroPct', 'Lucro %'], ['pisPct', 'PIS %'], ['cofinsPct', 'COFINS %'], ['issPct', 'ISS %', 'Entre 2% e 5%, conforme o município.'],
      ['simplesPct', 'Simples: alíquota efetiva do DAS %', 'Só no Simples. Anexo IV, 1ª faixa: 4,5%. Peça ao contador a alíquota efetiva.']],
  };
  const TODOS = Object.values(CAMPOS).flat();
  const mostrar = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''));
  let uid = null;
  let interagiu = false;

  for (const [grupo, campos] of Object.entries(CAMPOS)) {
    document.querySelector(`[data-grupo="${grupo}"]`).innerHTML = campos.map(([k, rotulo, dica, ops]) => {
      const campo = ops ? `<select id="f-${k}">${ops.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('')}</select>`
        : `<input id="f-${k}" ${typeof R.PADROES[k] === 'number' ? 'inputmode="decimal"' : ''} maxlength="80">`;
      return `<div${k === 'funcao' ? ' class="largo"' : ''}><label for="f-${k}">${esc(rotulo)}</label>${campo}${dica ? `<p class="dica">${esc(dica)}</p>` : ''}</div>`;
    }).join('');
  }

  function preencher(valores) { for (const [k] of TODOS) $(`f-${k}`).value = mostrar(valores[k] ?? R.PADROES[k]); }
  function ler() { return Object.fromEntries(TODOS.map(([k]) => [k, $(`f-${k}`).value])); }
  function aviso(texto) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? 'aviso erro' : 'aviso'; }

  function desenhar() {
    const e = ler();
    for (const [k] of TODOS) $(`f-${k}`).removeAttribute('aria-invalid');
    const r = R.calcular(e);
    if (r.erro) {
      // Tela recém-aberta com o salário vazio: sem erro vermelho antes de o usuário digitar (só esconde o resultado).
      if (!interagiu) { aviso(''); $('resultado').hidden = true; return null; }
      for (const [k] of TODOS) if (r.erro.includes(k)) $(`f-${k}`).setAttribute('aria-invalid', 'true');
      aviso(r.erro.replace(/[a-zA-Z]+Pct|[a-z]+[A-Z][a-zA-Z]+/g, (k) => (TODOS.find((c) => c[0] === k) || [k, k])[1]));
      $('resultado').hidden = true; return null;
    }
    aviso(''); $('resultado').hidden = false;
    const real = (c) => `R$ ${R.fmtCent(c)}`;
    $('totais').innerHTML = [['Por empregado (mês)', r.porEmpregado], [`Por posto (${mostrar(r.empregados)} empregado(s))`, r.porPosto],
      [`Total mensal (${mostrar(r.postos)} posto(s))`, r.mensal], [`Total do contrato (${mostrar(r.meses)} meses)`, r.contrato]]
      .map(([n, v]) => `<div><span class="dica">${esc(n)}</span><b>${esc(real(v))}</b></div>`).join('');
    $('avisos').innerHTML = r.avisos.map((a) => `<p class="aviso-linha ${a.tipo}">${esc(a.texto)}</p>`).join('');
    const pct = (p) => (p === null ? '' : R.fmtPct(p));
    $('tabela-corpo').innerHTML = r.modulos.map((m) => `<tr class="modulo"><td colspan="4">${esc(m.titulo)}</td></tr>`
      + m.linhas.map((l) => `<tr><td data-rotulo="Item">${esc(l.item)}</td><td data-rotulo="Descrição">${esc(l.descricao)}</td><td data-rotulo="Percentual" class="num">${esc(pct(l.pct))}</td><td data-rotulo="Valor (R$)" class="num">${esc(R.fmtCent(l.valor))}</td></tr>`).join('')
      + `<tr class="total"><td></td><td>Total</td><td></td><td class="num">${esc(R.fmtCent(m.total))}</td></tr>`).join('')
      + '<tr class="modulo"><td colspan="4">Quadro-resumo do custo por empregado</td></tr>'
      + r.resumo.map(([i, d, v]) => `<tr><td>${esc(i)}</td><td>${esc(d)}</td><td></td><td class="num">${esc(R.fmtCent(v))}</td></tr>`).join('')
      + `<tr class="total"><td></td><td>Valor total por empregado</td><td></td><td class="num">${esc(R.fmtCent(r.porEmpregado))}</td></tr>`;
    return { e, r };
  }

  function salvar() { try { localStorage.setItem(R.chaveRascunho(uid), JSON.stringify(ler())); $('salvo').textContent = 'Rascunho guardado.'; } catch { /* sem armazenamento: vale só nesta visita */ } }
  function carregar() {
    let v = {};
    try { v = JSON.parse(localStorage.getItem(R.chaveRascunho(uid)) || '{}') || {}; } catch { v = {}; }
    preencher(v); desenhar();
  }

  document.querySelector('main').addEventListener('change', (ev) => {
    const id = ev.target.id;
    if (id === 'f-escala') { const s = R.ESCALAS[ev.target.value]; $('f-empregadosPorPosto').value = mostrar(s.empregados); $('f-diasMes').value = mostrar(s.dias); }
    if (id === 'f-regime') for (const [k, v] of Object.entries(R.padroesRegime(ev.target.value))) $(`f-${k}`).value = mostrar(v);
    if (id.startsWith('f-')) { interagiu = true; desenhar(); salvar(); }
  });
  document.querySelector('main').addEventListener('input', (ev) => { if (ev.target.tagName === 'INPUT') { interagiu = true; desenhar(); salvar(); } });
  $('btn-padroes').addEventListener('click', () => {
    const manter = Object.fromEntries(['servico', 'funcao', 'escala', 'salarioBase', 'postos', 'meses', 'empregadosPorPosto', 'diasMes', 'vtValorPassagem', 'vaValorDia', 'uniformes', 'materiais', 'equipamentos', 'regime'].map((k) => [k, $(`f-${k}`).value]));
    preencher({ ...R.padroesRegime(manter.regime) }); for (const [k, v] of Object.entries(manter)) $(`f-${k}`).value = v;
    desenhar(); salvar();
  });
  $('btn-csv').addEventListener('click', () => {
    interagiu = true; const x = desenhar(); if (!x) return;
    const url = URL.createObjectURL(new Blob([R.csv(x.e, x.r)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `planilha-custos-mao-de-obra-${x.e.servico}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('btn-tema').addEventListener('click', () => {
    const claro = document.documentElement.classList.toggle('tema-claro');
    document.documentElement.dataset.theme = claro ? 'light' : 'dark';
    try { localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
  });

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // eslint-disable-line no-undef -- globais de supabase-config.js
  (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('login.html?voltar=/mao-de-obra'); return; }
    const { data: cliente } = await sb.from('clientes').select('status').eq('id', session.user.id).maybeSingle();
    if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/mao-de-obra'); return; }
    uid = session.user.id;
    carregar();
  })().catch(() => aviso('Não foi possível validar a sessão. Recarregue a página.'));
})();
