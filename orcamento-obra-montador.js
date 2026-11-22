/* global module, require -- script de navegador (orcamento-obra.html) e módulo do Node (testes e scripts/orcamento_obra.js) */
// Agente Montador do "Orçamento de obra": junta o trabalho dos outros (Leitor -> Orçamentista -> Auditor) num
// orçamento só e gera as abas da planilha: orçamento sintético, CPU, BDI, encargos, curva ABC, cronograma e alertas.
// Também devolve a planilha do próprio edital preenchida (mesma matriz, só com preços e totais trocados).
// As abas saem como matriz (linhas × células); quem grava o .xlsx é o SheetJS (navegador) ou scripts/xlsx_simples.js.
(function () {
  'use strict';
  const noNode = typeof module !== 'undefined' && module.exports;
  const C = noNode ? require('./orcamento-obra-calculo.js') : globalThis.OrcObra.calculo;
  const A = noNode ? require('./orcamento-obra-auditor.js') : globalThis.OrcObra.auditor;
  const BDI = noNode ? require('./bdi-calculadora.js') : globalThis.BdiCalculadora;

  const AVISO = 'Revisão e assinatura de engenheiro ou arquiteto responsável são obrigatórias.';
  const ORIGEM = { edital: 'Preço do edital', base: 'Tabela de referência', cpu: 'Soma da CPU', manual: 'Preço digitado de tabela', cotacao: 'Composição própria (cotações)', sem_referencia: 'SEM PREÇO' };

  // leitura = resultado do Leitor. op = { bases, cotacoes, manuais, bdi (componentes, como bdi-calculadora), bdiFracao,
  //   bdiPorItem, desconto, modo, modoTotal, meses, distribuicao, encargos: { grupos, informado }, regime: { desonerado, ano, inssEncargos },
  //   dataBaseBanco }
  function montarOrcamento(leitura, op = {}) {
    const modo = op.modo || 'truncar', modoTotal = op.modoTotal || modo;
    const calcBdi = op.bdi?.tipo ? BDI.avaliar(op.bdi) : null;
    const bdi = calcBdi && !calcBdi.erro ? calcBdi.bdi / 10000 : (op.bdiFracao ?? leitura.resumo?.bdi ?? 0);
    // Edital que põe o BDI só no rodapé (custo direto + BDI = global): os preços unitários ficam sem BDI, como no edital.
    const bdiNoUnitario = !(leitura.resumo?.custoDireto > 0 && leitura.resumo?.bdi > 0);
    const precificados = C.precificar(leitura.itens, op.bases || {}, { cotacoes: op.cotacoes, manuais: op.manuais, modo })
      .map((l) => (l.tipo === 'servico' ? { ...l, referenciaEdital: l.precoUnitario > 0 ? l.precoUnitario : null } : l));
    const p = C.proposta(precificados, { bdi, bdiPorItem: op.bdiPorItem, desconto: op.desconto || {}, modo, modoTotal, bdiNoUnitario });
    const globalProposta = bdiNoUnitario ? p.total : C.arredondar(C.ajustar(p.total * bdi, modoTotal) + p.total);
    const editalComPreco = !leitura.emBranco;
    const bdiEdital = leitura.resumo?.bdi ?? 0;
    const etapasReferencia = {};
    if (editalComPreco) {
      for (const e of p.linhas.filter((l) => l.tipo === 'etapa' && !l.item.includes('.'))) {
        const ref = e.totalEdital ?? e.totalReferencia;
        if (ref > 0) etapasReferencia[e.item] = ref; // mesma base da proposta: com BDI no item, ou sem BDI quando o edital põe o BDI no rodapé
      }
    }
    const globalReferencia = editalComPreco ? (leitura.resumo?.global ?? (bdiNoUnitario ? p.totalReferencia : C.arredondar(p.totalReferencia * (1 + bdiEdital)))) : null;
    // Distribuição dos meses: a informada, senão a do cronograma do edital (pelo número da etapa ou pelo nome).
    const ce = op.cronogramaEdital, nome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    let distribuicao = op.distribuicao;
    if (!distribuicao && (ce?.linhas?.length || ce?.geral)) {
      distribuicao = {};
      for (const e of p.linhas.filter((l) => l.tipo === 'etapa' && !l.item.includes('.'))) {
        const achou = ce.linhas.find((x) => x.item === e.item) || ce.linhas.find((x) => nome(x.descricao) === nome(e.descricao));
        if (achou || ce.geral) distribuicao[e.item] = achou ? achou.fracoes : ce.geral;
      }
    }
    const meses = op.meses || ce?.meses || 1;
    const orc = {
      leitura, linhas: p.linhas, total: p.total, totalReferencia: p.totalReferencia, globalProposta, globalReferencia,
      bdi, calcBdi, bdiNoUnitario, modo, modoTotal, desconto: op.desconto || {}, encargos: op.encargos || null,
      abc: C.curvaAbc(p.linhas), crono: C.cronograma(p.linhas, meses, distribuicao),
    };
    // Cronograma de referência: as etapas do edital com a mesma distribuição (para comparar mês a mês).
    const cronoRef = editalComPreco ? C.cronograma(p.linhas.map((l) => (l.tipo === 'etapa' ? { ...l, total: etapasReferencia[l.item] ?? 0 } : l)), meses, distribuicao).porMes : null;
    orc.alertas = A.auditar({
      cronograma: orc.crono.porMes, cronogramaReferencia: cronoRef ?? undefined,
      linhas: p.linhas, total: bdiNoUnitario ? p.total : globalProposta, globalProposta: op.globalDeclarado ?? undefined,
      globalReferencia, etapasReferencia, bdi: op.bdi, bdiAplicado: calcBdi && !calcBdi.erro && op.bdiFracao !== undefined ? op.bdiFracao : undefined,
      bdiEdital: bdiNoUnitario ? bdiEdital : 0, modo, modoTotal, itensEdital: op.itensEdital, encargos: op.encargos,
      regime: { ...(op.regime || {}), editalDesonerado: leitura.cabecalho?.desonerado },
      dataBaseEdital: leitura.cabecalho?.dataBase, dataBaseBanco: op.dataBaseBanco,
    });
    orc.resumoAlertas = A.resumo(orc.alertas);
    return orc;
  }

  const pctTexto = (f) => `${(Number(f) * 100).toFixed(2).replace('.', ',')}%`;
  const cab = (orc, titulo) => {
    const c = orc.leitura.cabecalho || {};
    return [[titulo], [AVISO], [`Data-base: ${c.dataBase || '—'} · UF: ${c.uf || '—'} · ${c.desonerado === true ? 'Desonerado' : c.desonerado === false ? 'Não desonerado' : 'Regime não informado'} · BDI: ${pctTexto(orc.bdi)} · Arredondamento: ${orc.modo}`], []];
  };

  function abaSintetico(orc) {
    const t = [['Item', 'Código', 'Fonte', 'Descrição', 'Unid.', 'Quant.', 'Preço unit. referência (sem BDI)', orc.bdiNoUnitario ? 'Preço unit. com BDI' : 'Preço unit. referência', 'Desconto', 'Preço unit. proposta', 'Total proposta', 'Base usada']];
    for (const l of orc.linhas) {
      if (l.tipo === 'etapa') t.push([l.item, '', '', l.descricao, '', '', '', '', '', '', l.total ?? 0, '']);
      else t.push([l.item, l.codigo || '', l.fonte || '', l.descricao, l.unidade || '', l.quantidade ?? '', l.referencia ?? '', l.refComBdi ?? '', l.desconto ?? '', l.unitario ?? '', l.total ?? '', l.referencia === null ? ORIGEM.sem_referencia : l.baseUsada || ORIGEM[l.origem] || '']);
    }
    const rod = orc.bdiNoUnitario
      ? [[], ['', '', '', 'TOTAL DA PROPOSTA (com BDI)', '', '', '', '', '', '', orc.total]]
      : [[], ['', '', '', 'CUSTO DIRETO TOTAL', '', '', '', '', '', '', orc.total], ['', '', '', `BDI (${pctTexto(orc.bdi)})`, '', '', '', '', '', '', C.arredondar(orc.globalProposta - orc.total)], ['', '', '', 'PREÇO GLOBAL DA PROPOSTA', '', '', '', '', '', '', orc.globalProposta]];
    if (orc.globalReferencia) rod.push(['', '', '', 'Preço global de referência (edital)', '', '', '', '', '', '', orc.globalReferencia]);
    return { nome: 'Orçamento sintético', linhas: [...cab(orc, 'ORÇAMENTO SINTÉTICO'), ...t, ...rod] };
  }

  function abaCpu(orc) {
    const out = [...cab(orc, 'COMPOSIÇÕES DE CUSTO UNITÁRIO (CPU)')];
    for (const l of orc.linhas.filter((x) => x.tipo === 'servico')) {
      out.push([`Item ${l.item}`, l.codigo || '', l.fonte || '', l.descricao, l.unidade || '', 'Base usada:', l.baseUsada || ORIGEM[l.origem] || '']);
      if (l.cpu) {
        out.push(['Tipo', 'Código', 'Descrição', 'Unid.', 'Coeficiente', 'Preço unit.', 'Parcial']);
        for (const c of l.cpu.linhas) out.push([c.tipo === 'composicao' ? 'Composição auxiliar' : 'Insumo', c.codigo, c.descricao || '', c.unidade || '', c.coeficiente, c.preco ?? 'sem preço', c.parcial ?? '']);
        out.push(['', '', 'Custo pela CPU', '', '', '', l.cpu.custo]);
        if (l.cpu.custoReferencia !== null) out.push(['', '', 'Custo publicado pela tabela', '', '', '', l.cpu.custoReferencia]);
      }
      if (l.origem === 'cotacao' && l.propria) {
        out.push(['Fornecedor', 'Data', 'Valor']);
        for (const c of l.propria.cotacoes) out.push([c.fornecedor || '', c.data || '', c.valor]);
        out.push(['', 'Mediana', l.propria.preco], ['Memória:', l.propria.memoria]);
      }
      if (l.origem === 'manual' && l.manual?.observacao) out.push(['Observação:', l.manual.observacao]);
      out.push(['', '', 'Preço de referência (sem BDI)', '', '', '', l.referencia ?? 'SEM PREÇO'], []);
    }
    return { nome: 'CPU', linhas: out };
  }

  function abaBdi(orc) {
    if (orc.calcBdi && !orc.calcBdi.erro) return { nome: 'BDI', linhas: [[AVISO], [], ...BDI.matrizDetalhe(orc.calcBdi)] };
    return { nome: 'BDI', linhas: [[AVISO], [], ['BDI aplicado', orc.bdi], ['Composição do BDI não informada: detalhe AC, S, R, G, DF, L e tributos (Decreto 7.983/2013 art. 9º).']] };
  }

  function abaEncargos(orc) {
    const e = orc.encargos, c = orc.leitura.cabecalho || {};
    if (!e?.grupos) {
      return { nome: 'Encargos sociais', linhas: [[AVISO], [], ['Encargos do edital', c.encargosHorista ?? '', 'horista', c.encargosMensalista ?? '', 'mensalista'],
        ['Tabela por grupos não informada: use a tabela de encargos do SINAPI da UF e do regime (CAIXA).']] };
    }
    const r = C.encargosSociais(e.grupos), out = [[AVISO], [], ['Código', 'Descrição', 'Percentual']];
    for (const g of ['A', 'B', 'C']) {
      for (const x of e.grupos[g] || []) out.push([x.codigo || '', x.descricao || '', x.valor]);
      out.push([g, `Total do grupo ${g}`, r[g]], []);
    }
    out.push(['D1', 'Reincidência do grupo A sobre o grupo B', r.D1], ['D2', 'Reincidência sobre aviso prévio', r.D2], ['D', 'Total do grupo D', r.D], ['TOTAL', 'A + B + C + D', r.total]);
    return { nome: 'Encargos sociais', linhas: out };
  }

  function abaAbc(orc) {
    return { nome: 'Curva ABC', linhas: [...cab(orc, 'CURVA ABC'), ['Item', 'Código', 'Descrição', 'Unid.', 'Quant.', 'Preço unit.', 'Total', '% do total', '% acumulado', 'Classe'],
      ...orc.abc.map((x) => [x.item, x.codigo || '', x.descricao, x.unidade || '', x.quantidade ?? '', x.unitario ?? '', x.total, x.pct, x.acumulado, x.classe])] };
  }

  function abaCronograma(orc) {
    const n = orc.crono.porMes.length, meses = Array.from({ length: n }, (_, i) => `${(i + 1) * 30} dias`);
    const out = [...cab(orc, 'CRONOGRAMA FÍSICO-FINANCEIRO'), ['Item', 'Etapa', 'Total', ...meses]];
    for (const e of orc.crono.etapas) {
      out.push([e.item, e.descricao, e.total, ...e.valores]);
      out.push(['', '% da etapa', 1, ...e.fracoes]);
    }
    const total = orc.crono.total || 1;
    out.push([], ['', 'Total no período', orc.crono.total, ...orc.crono.porMes], ['', '% no período', 1, ...orc.crono.porMes.map((v) => C.arredondar(v / total, 4))],
      ['', 'Total acumulado', '', ...orc.crono.acumulado], ['', '% acumulado', '', ...orc.crono.acumulado.map((v) => C.arredondar(v / total, 4))]);
    if (!orc.bdiNoUnitario) out.push([], ['', 'Valores sem BDI, como no orçamento do edital.']);
    return { nome: 'Cronograma', linhas: out };
  }

  function abaAlertas(orc) {
    return { nome: 'Alertas do Auditor', linhas: [[AVISO], [], ['Nível', 'Item', 'O que é', 'Detalhe', 'Fonte', 'Link'],
      ...orc.alertas.map((a) => [{ erro: 'Pode desclassificar', atencao: 'Atenção', info: 'Para saber' }[a.nivel], a.item || '', a.titulo, a.texto, a.fonte, a.link || ''])] };
  }

  function montarAbas(orc) {
    return [abaSintetico(orc), abaCpu(orc), abaBdi(orc), abaEncargos(orc), abaAbc(orc), abaCronograma(orc), abaAlertas(orc)];
  }

  // Planilha do edital preenchida: copia a matriz original e troca só preço unitário e total de cada linha lida,
  // e os números do rodapé (custo direto, BDI, desconto, global ofertado). Não mexe no "estimado pelo contratante".
  function formatoEdital(matriz, orc) {
    const k = orc.leitura.colunas, m = matriz.map((l) => [...(l || [])]);
    const por = (c, i, v) => { if (c >= 0 && v !== undefined && v !== null) { m[i][c] = v; } };
    for (const l of orc.linhas) {
      const i = l.linhaPlanilha;
      if (i === undefined) continue;
      if (l.tipo === 'servico') {
        por(k.precoUnitario, i, k.unitarioComBdi >= 0 ? l.unitarioSemBdi : l.unitario);
        por(k.unitarioComBdi, i, l.unitario);
      }
      por(k.total, i, l.total);
    }
    const ultima = Math.max(...orc.linhas.map((l) => l.linhaPlanilha ?? 0));
    const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    for (let i = ultima + 1; i < m.length; i++) {
      const t = norm((m[i] || []).filter((c) => typeof c === 'string').join(' '));
      if (/CUSTO DIRETO/.test(t)) por(k.total, i, orc.total);
      else if (/^\s*BDI/.test(t) && !orc.bdiNoUnitario) por(k.total, i, C.arredondar(orc.globalProposta - orc.total));
      else if (/DESCONTO/.test(t) && orc.desconto.linear !== undefined) por(k.total, i, orc.desconto.linear);
      else if (/(PRECO|VALOR) GLOBAL|TOTAL GERAL/.test(t) && /LICITANTE|OFERTADO|PROPOSTA/.test(t)) por(k.total, i, orc.globalProposta);
    }
    return m;
  }

  const api = { AVISO, montarOrcamento, montarAbas, formatoEdital };
  if (noNode) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { montador: api });
})();
