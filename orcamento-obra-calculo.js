/* global module -- script de navegador (orcamento-obra.html) e módulo do Node (testes e scripts/orcamento_obra.js) */
// Agente Orçamentista do "Orçamento de obra": liga cada serviço à composição de referência (SINAPI ou outra fonte),
// monta a CPU (insumos × coeficientes), aplica BDI e desconto, e calcula encargos sociais, curva ABC e cronograma.
// Só conta: não lê planilha (orcamento-obra-leitor.js), não julga (orcamento-obra-auditor.js), não exporta
// (orcamento-obra-montador.js). Dinheiro sempre com 2 casas; o modo (truncar ou arredondar) vem do edital.
(function () {
  'use strict';

  // toPrecision(12) tira o ruído binário antes de cortar: 0,3541 × 24,71 = 8,749811 -> 8,74 (truncar) ou 8,75 (arredondar).
  const limpo = (v) => Number(Number(v).toPrecision(12));
  function truncar(v, casas = 2) {
    const f = 10 ** casas;
    return Math.trunc(limpo(limpo(v) * f)) / f;
  }
  function arredondar(v, casas = 2) {
    const f = 10 ** casas;
    return Math.sign(v) * Math.round(limpo(Math.abs(limpo(v)) * f)) / f;
  }
  const ajustar = (v, modo) => (modo === 'arredondar' ? arredondar(v) : truncar(v));
  const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const soma = (lista) => limpo(lista.reduce((a, x) => a + x, 0));

  // CPU de uma composição: cada linha = coeficiente × preço (ajustado a 2 casas), custo = soma das linhas.
  // base = { composicoes: { [codigo]: { descricao, unidade, itens: [{ tipo, codigo, descricao, unidade, coeficiente }] } },
  //          precos: { 'insumo|codigo': 12.3, 'composicao|codigo': 45.6 } }
  // custoReferencia = preço publicado da composição (o que vale como referência, Decreto 7.983/2013 art. 3º).
  function montarCpu(codigo, base, modo = 'truncar') {
    const comp = base.composicoes?.[codigo];
    if (!comp) return null;
    const semPreco = [];
    const linhas = comp.itens.map((it) => {
      const preco = num(base.precos?.[`${it.tipo}|${it.codigo}`]);
      if (preco === null) semPreco.push(it.codigo);
      return { ...it, coeficiente: Number(it.coeficiente), preco, parcial: preco === null ? null : ajustar(Number(it.coeficiente) * preco, modo) };
    });
    const custo = arredondar(soma(linhas.map((l) => l.parcial || 0)));
    return { codigo, descricao: comp.descricao, unidade: comp.unidade, linhas, custo, semPreco, custoReferencia: num(base.precos?.[`composicao|${codigo}`]) };
  }

  const reais = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
  // Composição própria (item sem referência oficial): mediana de pelo menos 3 cotações válidas
  // (Lei 14.133/2021 art. 23 §2º, II e III; mesmo critério de 3 preços da IN SEGES 65/2021 art. 6º).
  // cotacoes: [{ fornecedor, valor, data }] ou números. Devolve a memória de cálculo em texto, para ir na planilha.
  function composicaoPropria(cotacoes) {
    const validas = (cotacoes || []).map((c) => (typeof c === 'object' && c ? c : { valor: c }))
      .map((c) => ({ ...c, valor: num(c.valor) })).filter((c) => c.valor !== null && c.valor > 0).sort((a, b) => a.valor - b.valor);
    if (!validas.length) return { preco: null, n: 0, cotacoes: [], memoria: '', aviso: 'Sem cotação: peça 3 orçamentos de fornecedores ou use o agente de Cotação.' };
    const v = validas.map((c) => c.valor), m = v.length >> 1;
    const preco = arredondar(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
    // Cotação a mais de 50% da mediana (para cima ou para baixo) costuma ser recusada pelo órgão: aponta para trocar.
    const destoantes = validas.filter((c) => Math.abs(c.valor - preco) / preco > 0.5);
    const memoria = `Mediana de ${v.length} cotação(ões): ${validas.map((c, i) => `${c.fornecedor || `Fornecedor ${i + 1}`}${c.data ? ` (${c.data})` : ''} ${reais(c.valor)}`).join('; ')} → ${reais(preco)}.`;
    const avisos = [];
    if (v.length < 3) avisos.push(`Só ${v.length} cotação(ões): a lei pede pelo menos 3 para justificar o preço.`);
    if (destoantes.length) avisos.push(`Cotação muito diferente das outras (${destoantes.map((c) => reais(c.valor)).join(', ')}): troque ou justifique.`);
    return { preco, n: v.length, cotacoes: validas, memoria, aviso: avisos.join(' ') || null };
  }

  // Preço de referência de cada serviço (sem BDI), com a base que valeu ("baseUsada") para a memória do orçamento.
  // bases: { SINAPI: { composicoes, precos }, SICRO: {...}, ORSE: {...} } — a fonte do item escolhe a base.
  // manuais[item] = { preco, fonte, codigo, dataBase, observacao }: preço tirado à mão de tabela que o sistema não tem
  // (SETOP, ORSE, AGESUL...). cotacoes[item] = [{ fornecedor, valor, data }]: composição própria.
  // Ordem: preço posto no edital > base da fonte do item > preço manual > cotação. Sem nada: 'sem_referencia'.
  function precificar(itens, bases = {}, { cotacoes = {}, manuais = {}, modo = 'truncar' } = {}) {
    return itens.map((it) => {
      if (it.tipo !== 'servico') return it;
      const fonte = String(it.fonte || '').toUpperCase();
      const base = bases[fonte] || {};
      const cpu = montarCpu(it.codigo, base, modo);
      const publicado = num(base.precos?.[`composicao|${it.codigo}`] ?? base.precos?.[`insumo|${it.codigo}`]);
      const manual = manuais[it.item];
      const propria = cotacoes[it.item] ? composicaoPropria(cotacoes[it.item]) : null;
      const com = (referencia, origem, baseUsada, extra = {}) => ({ ...it, referencia, origem, baseUsada, cpu, publicado, ...extra });
      if (num(it.precoUnitario) > 0) return com(Number(it.precoUnitario), 'edital', `Preço do edital (${fonte || 'fonte não informada'} ${it.codigo || ''})`.trim());
      if (publicado !== null) return com(publicado, 'base', `${fonte} ${it.codigo}${base.referencia ? ` · ${base.referencia}` : ''}${base.uf ? ` · ${base.uf}` : ''}${base.desonerado === undefined ? '' : base.desonerado ? ' · desonerado' : ' · não desonerado'}`);
      if (cpu && !cpu.semPreco.length) return com(cpu.custo, 'cpu', `${fonte} ${it.codigo} (soma da CPU)`);
      if (num(manual?.preco) > 0) return com(Number(manual.preco), 'manual', `${manual.fonte || fonte} ${manual.codigo || it.codigo || ''}${manual.dataBase ? ` · ${manual.dataBase}` : ''} (preço digitado)`.replace(/\s+/g, ' '), { manual });
      if (propria?.preco) return com(propria.preco, 'cotacao', `Composição própria: ${propria.memoria}`, { propria });
      return com(null, 'sem_referencia', fonte ? `${fonte} ${it.codigo || ''}: sem preço no sistema`.trim() : 'Sem fonte', { propria });
    });
  }

  // Preço da proposta por serviço: referência × (1 + BDI) × (1 − desconto), sem nunca passar da referência com BDI.
  // desconto: { linear: 0.17 } ou { porItem: { '4.1': 0.2 } } (fração). bdi em fração (0,2835).
  // O desconto vai no preço unitário (art. 56 §5º da Lei 14.133/2021 pede as planilhas "adequadas ao valor final").
  // bdiPorItem[item] = BDI diferenciado (fornecimento de equipamento, Decreto 7.983/2013 art. 9º §1º).
  function proposta(itens, { bdi = 0, bdiPorItem = {}, desconto = {}, modo = 'truncar', modoTotal = modo, bdiNoUnitario = true } = {}) {
    const linhas = itens.map((it) => {
      if (it.tipo !== 'servico' || it.referencia === null || it.referencia === undefined) return { ...it };
      const d = Math.min(Math.max(Number(desconto.porItem?.[it.item] ?? desconto.linear ?? 0), 0), 1);
      const b = Number(bdiPorItem[it.item] ?? bdi);
      const refComBdi = bdiNoUnitario ? ajustar(it.referencia * (1 + b), modo) : it.referencia;
      const unitario = Math.min(ajustar(refComBdi * (1 - d), modo), refComBdi);
      const q = num(it.quantidade) || 0;
      return { ...it, bdi: b, refComBdi, desconto: d, unitario, unitarioSemBdi: ajustar(it.referencia * (1 - d), modo), total: ajustar(q * unitario, modoTotal), totalReferencia: ajustar(q * refComBdi, modoTotal) };
    });
    return totalizar(linhas);
  }

  // Soma serviços nas etapas (pelo prefixo do número do item) e no total geral.
  function totalizar(linhas) {
    const servicos = linhas.filter((l) => l.tipo === 'servico');
    const dentro = (etapa, s) => s.item.startsWith(`${etapa.item}.`);
    const out = linhas.map((l) => (l.tipo === 'servico' ? l : { ...l,
      total: arredondar(soma(servicos.filter((s) => dentro(l, s)).map((s) => s.total || 0))),
      totalReferencia: arredondar(soma(servicos.filter((s) => dentro(l, s)).map((s) => s.totalReferencia || 0))) }));
    return { linhas: out, total: arredondar(soma(servicos.map((s) => s.total || 0))), totalReferencia: arredondar(soma(servicos.map((s) => s.totalReferencia || 0))) };
  }

  // Encargos sociais no método do SINAPI: A + B + C + D, D1 = A × B (reincidência de A sobre B), D2 informado pela tabela.
  // grupos: { A: [{ codigo, descricao, valor }], B: [...], C: [...], D2: 0.0037 } (frações).
  function encargosSociais(grupos) {
    const t = (g) => soma((grupos[g] || []).map((x) => Number(x.valor) || 0));
    const A = t('A'), B = t('B'), C = t('C');
    const D1 = arredondar(A * B, 4), D2 = Number(grupos.D2) || 0;
    return { A: arredondar(A, 4), B: arredondar(B, 4), C: arredondar(C, 4), D1, D2, D: arredondar(D1 + D2, 4), total: arredondar(A + B + C + D1 + D2, 4) };
  }

  // INSS patronal do grupo A conforme o regime e o ano (Lei 12.546/2011 com a reoneração gradual da Lei 14.973/2024:
  // empresa na CPRB paga 5% da folha em 2025, 10% em 2026, 15% em 2027; a partir de 2028 volta tudo aos 20%).
  function inssGrupoA(desonerado, ano) {
    if (!desonerado || ano >= 2028) return 0.2;
    return { 2025: 0.05, 2026: 0.1, 2027: 0.15 }[ano] ?? 0;
  }
  // CPRB da construção civil (4,5%, Lei 13.161/2015) reduzida na transição: 80% em 2025, 60% em 2026, 40% em 2027.
  function cprbConstrucao(ano) {
    if (ano >= 2028) return 0;
    return arredondar(0.045 * ({ 2025: 0.8, 2026: 0.6, 2027: 0.4 }[ano] ?? 1), 4);
  }

  // Curva ABC: serviços do maior para o menor total; A até 80% acumulado, B até 95%, C o resto.
  function curvaAbc(linhas) {
    const s = linhas.filter((l) => l.tipo === 'servico' && (l.total || 0) > 0).sort((a, b) => b.total - a.total);
    const total = soma(s.map((l) => l.total));
    let acumulado = 0;
    return s.map((l) => {
      const antes = acumulado;
      acumulado = limpo(acumulado + l.total);
      const pct = total ? l.total / total : 0;
      // Classe pelo acumulado ANTES do item: o item que cruza os 80% ainda é A.
      return { item: l.item, codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, quantidade: l.quantidade, unitario: l.unitario, total: l.total,
        pct: arredondar(pct, 6), acumulado: arredondar(total ? acumulado / total : 0, 6), classe: antes / total < 0.8 ? 'A' : antes / total < 0.95 ? 'B' : 'C' };
    });
  }

  // Cronograma físico-financeiro: cada etapa (nível 1) distribuída nos meses. distribuicao[item] = frações por mês
  // (somam 1); sem distribuição, divide igual. O último mês recebe a sobra, para a linha fechar no centavo.
  function cronograma(linhas, meses, distribuicao = {}) {
    const etapas = linhas.filter((l) => l.tipo === 'etapa' && !l.item.includes('.'));
    const out = etapas.map((e) => {
      const fr = distribuicao[e.item] || Array.from({ length: meses }, () => 1 / meses);
      const valores = fr.map((f) => arredondar((e.total || 0) * f));
      valores[valores.length - 1] = arredondar((e.total || 0) - soma(valores.slice(0, -1)));
      return { item: e.item, descricao: e.descricao, total: e.total || 0, fracoes: fr, valores };
    });
    const porMes = Array.from({ length: meses }, (_, i) => arredondar(soma(out.map((e) => e.valores[i] || 0))));
    let ac = 0;
    const acumulado = porMes.map((v) => (ac = arredondar(ac + v)));
    return { etapas: out, porMes, acumulado, total: arredondar(soma(porMes)) };
  }

  const api = { truncar, arredondar, ajustar, montarCpu, composicaoPropria, precificar, proposta, totalizar, encargosSociais, inssGrupoA, cprbConstrucao, curvaAbc, cronograma };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { calculo: api });
})();
