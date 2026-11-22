/* global module, require, URLSearchParams */
// Tela do agente "Contador" dentro de Itens do processo (um quadro por item, aberto pelo botão "Contador").
// Contas em contador-tributario.js (puro, BigInt); tabela oficial, IA e calculadora da Receita em /api/contador;
// resumo salvo no item pelo kit-documentos (acao salvarContador). Ajustes da empresa (regime, alíquotas, UF de saída,
// taxa do dinheiro) ficam neste navegador, por empresa: são conveniência, o que vale para a proposta é o resumo salvo.
// Sem pop-up: tudo aparece no próprio quadro. Plano: o quadro tem data-recurso="contador" (plano-trava.js) e a rota barra.
(function (global) {
  'use strict';
  const carregar = (nome, arquivo) => global[nome] || (typeof module !== 'undefined' && module.exports ? require(arquivo) : null);
  const C = () => carregar('LicitaContador', './contador-tributario.js');
  const P = () => carregar('LicitaPrecificacao', './precificacao-item.js');
  const RT = () => carregar('LicitaReformaTributaria', './reforma-tributaria.js');
  const REGIMES = [['', 'Escolha'], ['simples', 'Simples Nacional'], ['mei', 'MEI'], ['presumido', 'Lucro Presumido'], ['real', 'Lucro Real']];
  // Planilha de custos: valor total do item em reais, com a explicação curta de cada linha.
  const CUSTOS = [
    ['frete', 'Frete (R$, total do item)', 'Do fornecedor até o órgão. Vem do frete das premissas, rateado. Mercadoria de outra UF costuma ter frete maior.'],
    ['embalagem', 'Embalagem (R$)', 'Caixa, etiqueta, palete. Zero se o fornecedor já entrega embalado.'],
    ['seguro', 'Seguro da carga (R$)', 'Opcional. Peça à transportadora.'],
    ['certidoes', 'Certidões e documentos (R$)', 'A maioria é grátis (Receita, FGTS, Trabalhista). Some cartório, autenticação e envio.'],
    ['deslocamento', 'Deslocamento e entrega (R$)', 'Combustível, diária, pedágio para entregar ou instalar.'],
    ['portal', 'Taxa do portal (R$)', 'O Compras.gov não cobra. Portais privados cobram: confira no contrato do portal.'],
    ['outros', 'Outros (R$)', 'Qualquer custo do item que não está acima.'],
  ];
  const PERCENTUAIS = [
    ['garantia', 'Garantia contratual (% do contrato)', 'Vem da garantia das premissas. O edital diz o percentual (em geral até 5%).'],
    ['comissao', 'Comissão (%)', 'De representante ou vendedor, se houver.'],
    ['administrativo', 'Custo administrativo (%)', 'Escritório, contador, sistema. Informe o seu; não há padrão oficial.'],
  ];
  const TAXA_PADRAO = '1,00'; // 1% ao mês: ponto de partida, perto do rendimento de uma aplicação conservadora. Editável.
  const DIAS_PADRAO = '30';    // prazo comum de pagamento após o atesto da entrega. Editável; o Pagômetro troca quando tem dado.

  const lerPct = (t) => { const s = String(t ?? '').trim(); return s ? P().lerPercentual(s) : null; };
  const lerReais = (t) => { const s = String(t ?? '').trim(); return s ? P().lerDinheiro(s) : null; };
  const reais = (c) => P().formatarReais(c);
  const pct = (m) => P().formatarPercentual(m);
  const chaveEmpresa = (empresaId) => `licitaplena_contador_${empresaId}`;
  function lerAjustes(storage, empresaId) {
    try { const v = JSON.parse(storage?.getItem(chaveEmpresa(empresaId)) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  }
  function gravarAjustes(storage, empresaId, v) { try { storage?.setItem(chaveEmpresa(empresaId), JSON.stringify(v)); } catch { /* conveniência */ } }

  // Mediana do Compras.gov gravada no item (4 casas) → centavos, para o "Vale a pena?".
  function centavosDaReferencia(texto) {
    const n = texto ? P().lerLance(String(texto).replace('.', ',')) : null;
    return n === null ? null : (n + 50n) / 100n;
  }
  // Item do edital atual que casa com este item: mesmo número (identificador) ou mesma descrição.
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  function vencedorDoItem(item, vencedores) {
    const lista = Array.isArray(vencedores?.itens) ? vencedores.itens : [];
    const v = lista.find((x) => String(x.numero) === String(item.identificador).trim()) || lista.find((x) => x.descricao && normalizar(x.descricao) === normalizar(item.descricao));
    return v && Number.isFinite(v.homologado) ? BigInt(Math.round(v.homologado * 100)) : null;
  }
  // https://pncp.gov.br/app/editais/<cnpj>/<ano>/<sequencial> → parâmetros do /api/pncp-detalhe.
  function compraPncp(url) {
    const m = /^https:\/\/pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,7})(?:[/?#]|$)/.exec(String(url || ''));
    return m ? { cnpj: m[1], ano: m[2], sequencial: m[3] } : null;
  }

  // Monta a entrada de formarPreco a partir dos campos (texto) da tela. Puro: testado.
  function entradaDaTela(v, item, calc, premissas) {
    const qtd = P().lerDecimal(String(item.quantidade ?? ''), 3);
    const custosItem = {}, pctPreco = {};
    for (const [k] of CUSTOS) { const n = lerReais(v[k]); if (n === null && String(v[k] ?? '').trim()) return { erro: `Confira o campo ${CUSTOS.find((c) => c[0] === k)[1]}: use reais com vírgula, ex.: 150,00.` }; if (n !== null) custosItem[k] = n; }
    for (const [k] of PERCENTUAIS) { const n = lerPct(v[k]); if (n === null && String(v[k] ?? '').trim()) return { erro: 'Percentual: use número com vírgula, ex.: 2,5.' }; if (n !== null) pctPreco[k] = n; }
    const custo = calc?.base !== undefined ? calc.base - (calc.freteUnidade || 0n) : item.custoUnitario ? P().lerDinheiro(String(item.custoUnitario).replace('.', ',')) : null;
    if (custo === null) return { erro: 'Informe o custo unitário do item (campo acima) para o Contador calcular.' };
    const aliquotas = {};
    for (const k of ['das', 'pisCofins', 'icms', 'iss', 'icmsDestino', 'outros']) { const n = lerPct(v[k]); if (n !== null) aliquotas[k] = n; }
    const dias = /^\d{1,3}$/.test(String(v.dias ?? '').trim()) ? Number(v.dias) : 0;
    return { entrada: {
      tipo: v.tipo, regime: v.regime, ano: Number(v.ano), quantidade: qtd ?? 0n, custoUnitarioCentavos: custo, custosItem, pctPreco, aliquotas,
      origemUf: String(v.origemUf || '').toUpperCase(), destinoUf: String(v.destinoUf || '').toUpperCase(), importado: v.importado === true, sublimite: v.sublimite === true,
      classe: v.classe || null, dinheiro: { taxaMensal: lerPct(v.taxa), dias },
      margem: premissas?.margem ? lerPct(String(premissas.margem).replace('.', ',')) : null,
      margemMinima: premissas?.margemMinima ? lerPct(String(premissas.margemMinima).replace('.', ',')) : null,
      referencias: { vencedor: lerReais(v.vencedor), mercado: lerReais(v.mercado) },
    } };
  }
  // Resumo para a proposta (texto canônico com ponto, como o servidor guarda preços).
  const canonico = (c) => P().formatarDecimal(c, 2).replace(',', '.');
  function resumoParaSalvar(r, v, oficial) {
    const alvo = r.alvo || r.minimo;
    return { versao: 1, salvoEm: new Date().toISOString(), ano: r.ano, regime: r.regime, tipo: v.tipo, codigo: v.codigo || null, cClassTrib: v.classe?.codigo || null,
      classificacao: v.classe?.rotulo || null, baseLegal: v.classe?.baseLegal || null, fonteOficial: oficial || null,
      custoUnidade: canonico(r.custos.custoUnidade), precoMinimo: canonico(r.minimo.final), precoAlvo: r.alvo ? canonico(r.alvo.final) : null, precoFinal: canonico(alvo.final),
      cbs: canonico(alvo.cbs), ibs: canonico(alvo.ibs), lucroUnidade: r.alvoLucro ? canonico(r.alvoLucro.lucro) : null, margem: r.alvoLucro ? P().formatarDecimal(r.alvoLucro.margem, 2).replace(',', '.') : null,
      tributos: r.tributos.map((t) => ({ rotulo: t.rotulo, pct: pct(t.pct) })),
      custos: { produto: canonico(r.custos.produtoTotal), extras: canonico(r.custos.extras), dinheiro: canonico(r.custos.dinheiro) },
      valeAPena: r.valeAPena.map((x) => x.texto).slice(0, 2), aviso: r.aviso };
  }

  function montar({ alvo, item, contexto, requisitar, obterCalculo = () => null, obterPremissas = () => null, chamarKit, resumoSalvo = null, storage = null, doc = global.document }) {
    let vivo = true, tabela = null, oficial = null;
    const ajustes = lerAjustes(storage, contexto.empresaId);
    const anoPadrao = String(Math.min(Math.max(new Date().getFullYear() + 1, 2026), 2033));
    const v = { regime: ajustes.regime || '', tipo: resumoSalvo?.tipo || 'bem', ano: String(resumoSalvo?.ano || anoPadrao), codigo: resumoSalvo?.codigo || '', classe: null,
      anexo: ajustes.anexo || '', rbt12: ajustes.rbt12 || '', das: ajustes.das || '', pisCofins: ajustes.pisCofins || '', icms: ajustes.icms || '', iss: ajustes.iss || '', outros: ajustes.outros || '',
      origemUf: ajustes.origemUf || '', destinoUf: '', icmsDestino: '', importado: false, sublimite: false, taxa: ajustes.taxa || TAXA_PADRAO, dias: DIAS_PADRAO,
      vencedor: '', mercado: '' };
    // Padrões que já existem nas premissas do processo (sem digitar de novo): frete rateado e garantia.
    const calc0 = obterCalculo(), prem0 = obterPremissas(), qtd0 = P().lerDecimal(String(item.quantidade ?? ''), 3);
    if (calc0?.freteUnidade > 0n && qtd0) v.frete = P().formatarDecimal((calc0.freteUnidade * qtd0 + 999n) / 1000n, 2);
    if (prem0?.garantia) v.garantia = P().formatarDecimal(P().lerPercentual(String(prem0.garantia).replace('.', ',')) ?? 0n, 3).replace(/,?0+$/, '');
    const id = (s) => `contador-${s}-${item.id}`;
    function h(tag, attrs = {}, ...filhos) {
      const e = doc.createElement(tag);
      for (const [k, x] of Object.entries(attrs)) {
        if (x === null || x === undefined || x === false) continue;
        if (k === 'texto') e.textContent = x; else if (k === 'classe') e.className = x; else e.setAttribute(k, x === true ? '' : String(x));
      }
      e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
      return e;
    }
    const campo = (chave, rotulo, ajuda, extra = {}) => {
      const input = h('input', { id: id(chave), 'data-contador': chave, inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': ajuda ? id(`${chave}-ajuda`) : null, ...extra });
      input.value = v[chave] ?? '';
      return h('div', { classe: 'itens-campo' }, h('label', { for: id(chave), texto: rotulo }), input, ajuda ? h('span', { id: id(`${chave}-ajuda`), classe: 'itens-campo-estado', 'data-ajuda': chave, texto: ajuda }) : null);
    };
    const escolha = (chave, rotulo, opcoes) => {
      const s = h('select', { id: id(chave), 'data-contador': chave }, ...opcoes.map(([valor, texto]) => h('option', { value: valor, texto })));
      s.value = v[chave] ?? '';
      return h('div', { classe: 'itens-campo' }, h('label', { for: id(chave), texto: rotulo }), s);
    };
    const n = {
      estado: h('p', { classe: 'itens-apoio', role: 'status', 'aria-live': 'polite' }),
      regimeFonte: h('p', { classe: 'itens-apoio', 'data-regime-fonte': '' }),
      simples: h('div', { classe: 'itens-premissas-campos', 'data-bloco': 'simples' }),
      regular: h('div', { classe: 'itens-premissas-campos', 'data-bloco': 'regular' }),
      classe: h('p', { classe: 'itens-apoio', 'data-classe': '' }),
      motivo: h('p', { classe: 'itens-apoio', 'data-motivo': '' }),
      resultado: h('div', { classe: 'contador-resultado', 'aria-live': 'polite', 'data-resultado': '' }),
      salvar: h('button', { type: 'button', 'data-contador-salvar': '', disabled: true, texto: 'Salvar no item para a proposta' }),
      salvoEstado: h('span', { classe: 'itens-campo-estado', 'aria-live': 'polite' }),
    };
    const anos = (RT()?.ANOS || []).map((a) => [String(a), a === 2026 ? '2026 (teste da Reforma)' : String(a)]);
    alvo.replaceChildren(
      h('h4', { classe: 'contador-titulo' }, h('span', { classe: 'rotulo-agente', texto: 'Contador' }), 'Preço com impostos'),
      h('p', { classe: 'contador-aviso', texto: C().AVISO_FIXO }),
      n.estado,
      h('fieldset', { classe: 'itens-reforma' }, h('legend', { texto: 'Sua empresa' }),
        h('div', { classe: 'itens-premissas-campos' }, escolha('regime', 'Regime tributário', REGIMES), campo('origemUf', 'UF de onde a mercadoria sai', 'Sua UF, ou a do fornecedor se ele entrega direto.', { maxlength: 2, inputmode: 'text', placeholder: 'Ex.: SP' })),
        h('div', { classe: 'itens-acoes' }, h('button', { type: 'button', 'data-contador-confirmar': '', texto: 'Confirmar regime' })),
        n.regimeFonte, n.simples, n.regular),
      h('fieldset', { classe: 'itens-reforma' }, h('legend', { texto: 'Este item' }),
        h('div', { classe: 'itens-premissas-campos' }, escolha('tipo', 'O item é', [['bem', 'Mercadoria (NCM)'], ['servico', 'Serviço (NBS)']]),
          campo('codigo', 'NCM ou NBS', 'Só números. A IA sugere; confira com a nota do fornecedor.', { inputmode: 'numeric', maxlength: 12 }),
          h('div', { classe: 'itens-campo' }, h('label', { for: id('cclasstrib'), texto: 'Classificação tributária (cClassTrib)' }), h('select', { id: id('cclasstrib'), 'data-contador': 'cclasstrib' }, h('option', { value: '', texto: 'Carregando a tabela oficial…' }))),
          escolha('ano', 'Ano da entrega', anos),
          campo('destinoUf', 'UF do órgão', 'Vem do edital quando é do PNCP.', { maxlength: 2, inputmode: 'text', placeholder: 'Ex.: AM' }),
          campo('icmsDestino', 'ICMS interno da UF do órgão (%)', 'Só para o DIFAL de outra UF. Informe o seu: não há tabela oficial nacional.')),
        h('label', { classe: 'contador-marca' }, h('input', { type: 'checkbox', 'data-contador': 'importado' }), ' Mercadoria importada (ICMS interestadual de 4%)'),
        h('div', { classe: 'itens-acoes' }, h('button', { type: 'button', 'data-contador-ia': '', texto: 'Sugerir NCM e classificação com IA' })),
        n.classe, n.motivo),
      h('fieldset', { classe: 'itens-reforma' }, h('legend', { texto: 'Planilha de custos do item' }),
        h('p', { classe: 'itens-apoio', texto: 'Custo do produto vem do Custo unitário acima. Preencha só o que tiver; nada é inventado.' }),
        h('div', { classe: 'itens-premissas-campos' }, ...CUSTOS.map(([k, r, a]) => campo(k, r, a)), ...PERCENTUAIS.map(([k, r, a]) => campo(k, r, a)))),
      h('fieldset', { classe: 'itens-reforma' }, h('legend', { texto: 'Dinheiro parado e comparação' }),
        h('div', { classe: 'itens-premissas-campos' },
          campo('dias', 'Dias até o órgão pagar', 'Padrão 30 dias, prazo comum após o atesto. O Pagômetro troca quando tem dado do órgão.', { inputmode: 'numeric', maxlength: 3 }),
          campo('taxa', 'Custo do dinheiro (% ao mês)', 'Padrão 1%: perto do rendimento de uma aplicação conservadora. Use a taxa do seu banco.'),
          campo('vencedor', 'Último vencedor deste órgão (R$ por unidade)', 'Vem da Licitação anterior quando o item casa.'),
          campo('mercado', 'Preço de mercado (R$ por unidade)', 'Vem da mediana do Compras.gov (Referência) quando houver.'))),
      h('div', { classe: 'itens-acoes' }, h('button', { type: 'button', classe: 'app-primario', 'data-contador-calcular': '', texto: 'Calcular' }), n.salvar, n.salvoEstado),
      n.resultado);
    const el = (s) => alvo.querySelector(s);
    const marcar = (no, texto, tipo = '') => { no.textContent = texto || ''; no.dataset.situacao = tipo; };

    function blocosDoRegime() {
      const simples = v.regime === 'simples', regular = v.regime === 'presumido' || v.regime === 'real';
      n.simples.hidden = !simples; n.regular.hidden = !regular;
      if (simples && !n.simples.childElementCount) n.simples.append(escolha('anexo', 'Anexo do Simples', [['', 'Escolha'], ['I', 'I (comércio)'], ['II', 'II (indústria)'], ['III', 'III (serviços)'], ['IV', 'IV (serviços)'], ['V', 'V (serviços)']]),
        campo('rbt12', 'Faturamento dos últimos 12 meses (R$)', 'O mesmo do PGDAS-D.'), campo('das', 'Alíquota efetiva do DAS (%)', 'Calculada pela LC 123 com o anexo e o faturamento. Pode trocar pela do seu PGDAS-D.'));
      if (regular && !n.regular.childElementCount) n.regular.append(campo('icms', 'ICMS da sua UF (%)', 'Venda na mesma UF. Informe o seu.'), campo('iss', 'ISS do município (%)', 'Serviço: de 2% a 5% (LC 116/2003). Informe o seu.'),
        campo('pisCofins', 'PIS/Cofins (%) — só até 2026', 'Vazio: 3,65% no Presumido e 9,25% no Real (lei). No Real os créditos baixam: informe o seu.'),
        campo('outros', 'IRPJ, CSLL e outros sobre a venda (%)', 'Informe o seu; depende do lucro e da atividade.'));
    }
    function atualizarDas() {
      if (v.regime !== 'simples' || !v.anexo || !v.rbt12) return;
      const r = C().aliquotaEfetivaSimples(v.anexo, lerReais(v.rbt12) ?? -1n);
      const ajuda = alvo.querySelector('[data-ajuda="das"]');
      if (!r.ok) { if (ajuda) marcar(ajuda, r.erro, 'erro'); return; }
      v.das = P().formatarDecimal(r.aliquota, 3).replace(/,?0+$/, ''); v.sublimite = r.sublimite; v.dasFonte = r.fonte;
      const campoDas = el('[data-contador="das"]'); if (campoDas) campoDas.value = v.das;
      if (ajuda) marcar(ajuda, `${r.fonte}${r.sublimite ? ' Acima de R$ 3,6 milhões: ICMS e ISS fora do DAS.' : ''}`, 'ok');
    }
    function preencherClasses() {
      const s = el('[data-contador="cclasstrib"]');
      if (!tabela) { s.replaceChildren(h('option', { value: '', texto: 'Tabela oficial indisponível agora' })); return; }
      const nom = v.tipo === 'bem' ? /NCM/ : /NBS/;
      const linhas = tabela.linhas.filter((l) => nom.test(l.nomenclatura) && /Padrão/.test(l.tipoAliquota));
      s.replaceChildren(h('option', { value: '', texto: 'Escolha' }), ...linhas.map((l) => h('option', { value: l.codigo, texto: `${l.codigo} · ${C().rotuloReducao(l)} · ${l.descricao.slice(0, 70)}` })));
      const atual = v.classe?.codigo || resumoSalvo?.cClassTrib || '000001';
      s.value = linhas.some((l) => l.codigo === atual) ? atual : '';
      escolherClasse(s.value);
    }
    function escolherClasse(codigo) {
      const c = codigo && tabela ? C().classificacaoDe(tabela.linhas, codigo, v.tipo) : null;
      v.classe = c?.ok ? c : null; oficial = null;
      marcar(n.classe, c ? (c.ok ? `${c.rotulo}. Base legal: ${c.baseLegal}. Tabela oficial ${tabela.versaoDb || ''}.` : c.erro) : '', c && !c.ok ? 'erro' : '');
    }

    alvo.addEventListener('input', (ev) => {
      const k = ev.target?.dataset?.contador; if (!k || k === 'cclasstrib') return;
      v[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
      if (k === 'regime') blocosDoRegime();
      if (k === 'anexo' || k === 'rbt12') atualizarDas();
      if (k === 'tipo') preencherClasses();
      if (['regime', 'anexo', 'rbt12', 'das', 'pisCofins', 'icms', 'iss', 'outros', 'origemUf', 'taxa'].includes(k)) salvarAjustes();
    });
    alvo.addEventListener('change', (ev) => {
      const k = ev.target?.dataset?.contador;
      if (k === 'cclasstrib') escolherClasse(ev.target.value);
      else if (k === 'importado') { v.importado = ev.target.checked; }
    });
    function salvarAjustes() {
      const { regime, anexo, rbt12, das, pisCofins, icms, iss, outros, origemUf, taxa } = v;
      gravarAjustes(storage, contexto.empresaId, { regime, anexo, rbt12, das, pisCofins, icms, iss, outros, origemUf, taxa });
    }
    el('[data-contador-confirmar]').addEventListener('click', () => {
      if (!v.regime) { marcar(n.regimeFonte, 'Escolha o regime antes de confirmar.', 'erro'); return; }
      salvarAjustes();
      marcar(n.regimeFonte, `Regime confirmado: ${REGIMES.find((r) => r[0] === v.regime)[1]}. Vale para os outros itens desta empresa neste navegador.`, 'ok');
    });

    async function api(corpo) {
      try { const r = await requisitar('/api/contador', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }); return { r, j: await r.json().catch(() => null) }; }
      catch { return { r: null, j: null }; }
    }
    el('[data-contador-ia]').addEventListener('click', async (ev) => {
      const b = ev.currentTarget; b.disabled = true; marcar(n.motivo, 'O Contador está lendo a descrição do item…', 'carregando');
      const { r, j } = await api({ acao: 'classificar', descricao: item.descricao, doEdital: item.origemPncp === true });
      b.disabled = false; if (!vivo) return;
      if (!r?.ok) { marcar(n.motivo, j?.erro || 'A IA não respondeu agora. Escolha a classificação à mão.', 'erro'); return; }
      v.tipo = j.tipo; v.codigo = j.codigo; el('[data-contador="tipo"]').value = j.tipo; el('[data-contador="codigo"]').value = j.codigo;
      preencherClasses(); el('[data-contador="cclasstrib"]').value = j.cClassTrib; escolherClasse(j.cClassTrib);
      marcar(n.motivo, `Sugestão${j.fonte === 'reaproveitada' ? ' (já classificada antes para este texto do edital)' : ' da IA'}: ${j.tipo === 'bem' ? 'NCM' : 'NBS'} ${j.codigo}. ${j.motivo || ''} Confira antes de usar.`, 'ok');
    });

    async function conferirOficial(e) {
      if (!v.classe || !/^\d{8,9}$/.test(String(v.codigo || '').replace(/\D/g, ''))) return 'Sem NCM/NBS e classificação: conta local, sem conferência oficial.';
      const uf = e.destinoUf || e.origemUf;
      if (!uf || e.regime === 'simples' || e.regime === 'mei') return e.regime === 'simples' || e.regime === 'mei' ? 'No Simples e no MEI a CBS e o IBS vão no DAS: a calculadora oficial do regime regular não se aplica.' : 'Informe a UF para conferir na calculadora oficial.';
      const { r, j } = await api({ acao: 'calcular', ano: e.ano, uf, municipio: v.municipioIbge || undefined, itens: [{ numero: item.identificador, tipo: e.tipo, codigo: String(v.codigo).replace(/\D/g, ''), cClassTrib: v.classe.codigo }] });
      if (!r?.ok) return j?.erro || 'Não foi possível falar com a calculadora oficial agora. Usamos a conta local.';
      const o = j.itens?.[0];
      if (o?.fonte === 'oficial' && ['CALCULADO', 'CALCULO_SIMULADO'].includes(o.estado)) {
        e.classe = { ...e.classe, reducaoCbs: Math.round(o.reducaoCbs), reducaoIbs: Math.round(o.reducaoIbsUf) };
        oficial = { estado: o.estado, versaoDb: j.versaoDb, memoria: o.memoria || null };
      }
      return [C().fraseStatusOficial(o?.fonte === 'oficial' ? o.estado : undefined, o?.erros), j.aviso].filter(Boolean).join(' ');
    }

    let ultimo = null;
    function desenhar(r, fraseOficial) {
      if (!r.ok) { n.resultado.replaceChildren(h('p', { classe: 'itens-campo-estado', 'data-situacao': 'erro', texto: r.erro })); n.salvar.disabled = true; return; }
      const alvoPreco = r.alvo || r.minimo;
      const linhas = [
        ['Preço mínimo sem prejuízo (por unidade)', reais(r.minimo.final)],
        r.alvo ? ['Preço com a margem desejada', reais(r.alvo.final)] : null,
        ['CBS + IBS por fora', `${reais(alvoPreco.cbs)} + ${reais(alvoPreco.ibs)}`],
        r.alvoLucro ? ['Lucro por unidade', `${reais(r.alvoLucro.lucro)} (${P().formatarDecimal(r.alvoLucro.margem, 2)}%)`] : null,
        ['Custo por unidade (com a planilha)', reais(r.custos.custoUnidade)],
        ['Ano da entrega', String(r.ano)],
      ].filter(Boolean);
      n.resultado.replaceChildren(...[
        h('dl', { classe: 'itens-precos' }, ...linhas.map(([dt, dd]) => h('div', {}, h('dt', { texto: dt }), h('dd', { texto: dd })))),
        h('strong', { texto: 'Tributos sobre a venda' }),
        h('ul', { classe: 'contador-lista' }, ...(r.tributos.length ? r.tributos.map((t) => h('li', { texto: `${t.rotulo}: ${pct(t.pct)} · ${t.fonte}` })) : [h('li', { texto: 'Nenhum por dentro neste regime e ano.' })])),
        r.valeAPena.length ? h('strong', { texto: 'Vale a pena?' }) : null,
        r.valeAPena.length ? h('ul', { classe: 'contador-lista' }, ...r.valeAPena.map((x) => h('li', { 'data-veredito': x.veredito, texto: x.texto }))) : null,
        h('strong', { texto: 'Dicas do Contador' }),
        h('ul', { classe: 'contador-lista', 'data-dicas': '' }, ...r.dicas.map((d) => h('li', { texto: d }))),
        h('p', { classe: 'itens-apoio', 'data-oficial': '', texto: fraseOficial }),
        h('p', { classe: 'contador-aviso', texto: r.aviso })].filter(Boolean));
      n.salvar.disabled = false;
    }
    el('[data-contador-calcular]').addEventListener('click', async (ev) => {
      const b = ev.currentTarget, montada = entradaDaTela(v, item, obterCalculo(), obterPremissas());
      if (montada.erro) { desenhar({ ok: false, erro: montada.erro }); return; }
      b.disabled = true; marcar(n.estado, 'Calculando…', 'carregando');
      const fraseOficial = await conferirOficial(montada.entrada);
      b.disabled = false; if (!vivo) return;
      marcar(n.estado, '', '');
      ultimo = C().formarPreco(montada.entrada);
      desenhar(ultimo, fraseOficial);
    });
    n.salvar.addEventListener('click', async () => {
      if (!ultimo?.ok || !chamarKit) return;
      n.salvar.disabled = true; marcar(n.salvoEstado, 'Salvando…', 'carregando');
      const { r, j } = await chamarKit({ acao: 'salvarContador', itemId: item.id, resumo: resumoParaSalvar(ultimo, { ...v, tipo: v.tipo }, oficial) });
      n.salvar.disabled = false; if (!vivo) return;
      marcar(n.salvoEstado, r?.ok ? 'Salvo no item. A proposta vai poder usar estes números.' : (j?.erro || 'Não foi possível salvar agora.'), r?.ok ? 'ok' : 'erro');
    });

    // Preenchimentos automáticos (todos editáveis): regime pelo CNPJ, mercado do item, vencedor da licitação anterior, UF e prazo do órgão.
    async function regimePeloCnpj() {
      const cnpj = String(contexto.cnpj || '').replace(/\D/g, '');
      if (v.regime) { marcar(n.regimeFonte, 'Regime confirmado por você neste navegador. Troque se mudou.'); return; }
      if (cnpj.length !== 14) { marcar(n.regimeFonte, 'Escolha o regime da sua empresa.'); return; }
      marcar(n.regimeFonte, 'Lendo o regime no CNPJ (Receita Federal)…', 'carregando');
      let d = null;
      try { const r = await global.fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`); d = r.ok ? await r.json() : null; } catch { d = null; }
      if (!vivo) return;
      const x = C().regimePeloCnpj(d);
      if (x.uf && !v.origemUf) { v.origemUf = x.uf; el('[data-contador="origemUf"]').value = x.uf; }
      if (x.regime) {
        v.regime = x.regime; el('[data-contador="regime"]').value = x.regime;
        if (x.anexo) v.anexo = x.anexo;
        blocosDoRegime();
        if (x.anexo && el('[data-contador="anexo"]')) el('[data-contador="anexo"]').value = x.anexo;
        marcar(n.regimeFonte, `${x.fonte} Confirme ou troque acima.`, 'ok');
      } else marcar(n.regimeFonte, x.pergunta);
    }
    async function dadosDoOrgao() {
      const compra = compraPncp(contexto.urlOrigem);
      if (!compra) return;
      let det = null;
      try { const r = await requisitar(`/api/pncp-detalhe?${new URLSearchParams(compra)}`, { method: 'GET' }); det = r.ok ? (await r.json())?.detalhe : null; } catch { det = null; }
      if (!vivo || !det) return;
      if (/^[A-Z]{2}$/.test(det.uf || '') && !v.destinoUf) { v.destinoUf = det.uf; el('[data-contador="destinoUf"]').value = det.uf; }
      if (/^\d{7}$/.test(det.codigoMunicipioIbge || '')) v.municipioIbge = det.codigoMunicipioIbge;
      const ente = global.LicitaPagometro?.enteDoEdital?.(det);
      if (!ente?.prazo) return;
      try {
        const r = await requisitar(`/api/pagometro?prazo=${encodeURIComponent(ente.prazo)}`, { method: 'GET' });
        const p = r.ok ? await r.json() : null;
        const dias = p?.dias_24m ?? p?.dias_36m;
        if (!vivo || !Number.isInteger(dias)) return;
        v.dias = String(dias); el('[data-contador="dias"]').value = v.dias;
        marcar(alvo.querySelector('[data-ajuda="dias"]'), `Pagômetro: este órgão paga em média em ${dias} dias depois do atesto (dados públicos).`, 'ok');
      } catch { /* fica o padrão explicado */ }
    }
    function preencherReferencias(vencedores) {
      const vc = vencedorDoItem(item, vencedores ?? global.LicitaUltimosVencedores);
      if (vc !== null && !v.vencedor) { v.vencedor = P().formatarDecimal(vc, 2); el('[data-contador="vencedor"]').value = v.vencedor; }
      const mc = centavosDaReferencia(item.precoReferencia);
      if (mc !== null && !v.mercado) { v.mercado = P().formatarDecimal(mc, 2); el('[data-contador="mercado"]').value = v.mercado; }
    }
    const aoVencedores = (ev) => { if (ev.detail?.processoId === contexto.processoId) preencherReferencias(ev.detail); };
    doc.addEventListener('licitaplena:vencedores', aoVencedores);

    blocosDoRegime();
    preencherReferencias();
    void regimePeloCnpj();
    void dadosDoOrgao();
    void api({ acao: 'tabela' }).then(({ r, j }) => {
      if (!vivo) return;
      if (r?.ok && Array.isArray(j?.linhas)) tabela = j;
      else marcar(n.classe, j?.erro || 'Tabela oficial indisponível agora. A conta sai sem redução de CBS/IBS.', 'erro');
      preencherClasses();
    });
    if (resumoSalvo?.precoFinal) marcar(n.salvoEstado, `Salvo antes: preço final R$ ${String(resumoSalvo.precoFinal).replace('.', ',')} (${resumoSalvo.ano}).`, 'ok');
    return { fechar() { vivo = false; doc.removeEventListener('licitaplena:vencedores', aoVencedores); } };
  }

  const api = { montar, entradaDaTela, resumoParaSalvar, vencedorDoItem, compraPncp, centavosDaReferencia, CUSTOS, PERCENTUAIS };
  global.LicitaContadorUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
