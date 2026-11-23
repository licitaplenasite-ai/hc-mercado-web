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
  const R = noNode ? require('./orcamento-obra-regras.js') : globalThis.OrcObra.regras;
  const CAT = noNode ? require('./orcamento-obra-regras-catalogo.js') : globalThis.OrcObra.catalogo;

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
    // Conferindo uma proposta já pronta (op.itensEdital): a referência de cada item é o preço do edital, não o da proposta.
    const doEdital = op.itensEdital ? new Map(op.itensEdital.filter((e) => e.tipo === 'servico').map((e) => [e.item, e.precoUnitario])) : null;
    const precificados = C.precificar(leitura.itens, op.bases || {}, { cotacoes: op.cotacoes, manuais: op.manuais, modo })
      .map((l) => (l.tipo !== 'servico' ? l : { ...l, referenciaEdital: doEdital ? (doEdital.get(l.item) > 0 ? doEdital.get(l.item) : null) : l.precoUnitario > 0 ? l.precoUnitario : null }));
    const p = C.proposta(precificados, { bdi, bdiPorItem: op.bdiPorItem, desconto: op.desconto || {}, modo, modoTotal, bdiNoUnitario });
    const globalProposta = bdiNoUnitario ? p.total : C.arredondar(C.ajustar(p.total * bdi, modoTotal) + p.total);
    const editalComPreco = !leitura.emBranco;
    const bdiEdital = leitura.resumo?.bdi ?? 0;
    const etapasReferencia = {};
    const etapaEdital = op.itensEdital ? new Map(op.itensEdital.filter((e) => e.tipo === 'etapa').map((e) => [e.item, e.totalEdital])) : null;
    // Etapa sem total na planilha do edital (só as subetapas têm): soma os itens do edital, na mesma base da proposta.
    const somaEdital = (etapa) => C.arredondar(op.itensEdital.filter((s) => s.tipo === 'servico' && s.item.startsWith(`${etapa}.`) && s.precoUnitario > 0)
      .reduce((a, s) => a + C.ajustar((Number(s.quantidade) || 0) * (bdiNoUnitario ? C.ajustar(s.precoUnitario * (1 + bdiEdital), modo) : s.precoUnitario), modoTotal), 0));
    if (editalComPreco) {
      for (const e of p.linhas.filter((l) => l.tipo === 'etapa' && !l.item.includes('.'))) {
        const ref = etapaEdital ? (etapaEdital.get(e.item) > 0 ? etapaEdital.get(e.item) : somaEdital(e.item)) : e.totalEdital ?? e.totalReferencia;
        if (ref > 0) etapasReferencia[e.item] = ref; // mesma base da proposta: com BDI no item, ou sem BDI quando o edital põe o BDI no rodapé
      }
    }
    const globalReferencia = editalComPreco ? (op.globalEdital ?? leitura.resumo?.global ??(bdiNoUnitario ? p.totalReferencia : C.arredondar(p.totalReferencia * (1 + bdiEdital)))) : null;
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
      bdi, calcBdi, bdiNoUnitario, modo, modoTotal, desconto: op.desconto || {}, encargos: op.encargos || null, regime: op.regime || {},
      abc: C.curvaAbc(p.linhas), crono: C.cronograma(p.linhas, meses, distribuicao),
    };
    // Cronograma de referência: as etapas do edital com a mesma distribuição (para comparar mês a mês).
    const cronoRef = editalComPreco ? C.cronograma(p.linhas.map((l) => (l.tipo === 'etapa' ? { ...l, total: etapasReferencia[l.item] ?? 0 } : l)), meses, distribuicao).porMes : null;
    orc.alertas = A.auditar({
      cronograma: orc.crono.porMes, cronogramaReferencia: cronoRef ?? undefined, cronogramaCompleto: orc.crono, totalPlanilha: p.total, bdiFinal: bdi, similares: op.similares,
      linhas: p.linhas, total: bdiNoUnitario ? p.total : globalProposta, globalProposta: op.globalDeclarado ?? undefined,
      globalReferencia, etapasReferencia, bdi: op.bdi, bdiAplicado: calcBdi && !calcBdi.erro && op.bdiFracao !== undefined ? op.bdiFracao : undefined,
      bdiEdital: bdiNoUnitario ? bdiEdital : 0, modo, modoTotal, itensEdital: op.itensEdital, encargos: op.encargos,
      regime: { ...(op.regime || {}), editalDesonerado: leitura.cabecalho?.desonerado },
      dataBaseEdital: leitura.cabecalho?.dataBase, dataBaseBanco: op.dataBaseBanco, lei: op.lei ?? leitura.cabecalho?.lei,
      uf: leitura.cabecalho?.uf, encargosEdital: { horista: leitura.cabecalho?.encargosHorista, mensalista: leitura.cabecalho?.encargosMensalista },
    });
    orc.resumoAlertas = A.resumo(orc.alertas);
    return orc;
  }

  // Ajuste ao lance: o maior desconto linear (em 0,01%) cuja planilha, já truncada item a item, fica igual ou abaixo do
  // lance. Assim a planilha reapresentada (art. 56 §5º) bate com o lance e passa de novo pelo Auditor.
  function ajustarAoLance(leitura, op, lance) {
    const tentar = (d) => montarOrcamento(leitura, { ...op, desconto: { linear: d / 10000 } });
    let baixo = 0, alto = 10000, melhor = null;
    while (baixo <= alto) {
      const meio = Math.floor((baixo + alto) / 2), o = tentar(meio);
      if (o.globalProposta <= lance + 0.004) { melhor = o; alto = meio - 1; } else baixo = meio + 1;
    }
    if (!melhor) return null;
    return { ...melhor, lance, sobra: C.arredondar(lance - melhor.globalProposta) };
  }
  // Tabela de lances: global e risco de cada desconto, para a pessoa ter o preço pronto na disputa.
  function tabelaDeLances(leitura, op, descontos = [0.05, 0.1, 0.15, 0.17, 0.2, 0.22, 0.25, 0.3]) {
    return descontos.map((d) => {
      const o = montarOrcamento(leitura, { ...op, desconto: { linear: d } });
      const ruim = o.alertas.filter((a) => ['inexequivel', 'garantia_adicional', 'zona_de_risco', 'unitario_acima', 'etapa_acima', 'global_acima'].includes(a.regra)).map((a) => a.titulo);
      return { desconto: d, global: o.globalProposta, pctReferencia: o.globalReferencia ? C.arredondar(o.globalProposta / o.globalReferencia, 4) : null, riscos: [...new Set(ruim)] };
    });
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
    const e = orc.encargos, c = orc.leitura.cabecalho || {}, d = orc.regime?.desonerado;
    // Campo de opção pela desoneração: a falta dele derrubou proposta no TRE-AM 2/2023.
    const opcao = ['Empresa optante pela desoneração da folha (CPRB, Lei 12.546/2011):', d === true ? '( X ) Sim    (   ) Não' : d === false ? '(   ) Sim    ( X ) Não' : '(   ) Sim    (   ) Não  ← MARQUE'];
    if (!e?.grupos) {
      // Tabela do SINAPI da UF, do regime e do ano da data-base (vem da base, nunca de número fixo).
      const h = d === true || d === false ? R.encargosDeReferencia(c.uf, c.dataBase, d, 'horista') : null, m = h ? R.encargosDeReferencia(c.uf, c.dataBase, d, 'mensalista') : null;
      return { nome: 'Encargos sociais', linhas: [[AVISO], [], opcao, [], ['Encargos do edital', c.encargosHorista ?? '', 'horista', c.encargosMensalista ?? '', 'mensalista'],
        ...(h ? [[`Tabela SINAPI ${c.uf} ${d ? 'desonerado' : 'não desonerado'}`, h.percentual, 'horista', m.percentual, 'mensalista', h.fonte]] : []),
        ['Tabela por grupos não informada: use a tabela de encargos do SINAPI da UF e do regime (CAIXA).']] };
    }
    const r = C.encargosSociais(e.grupos), out = [[AVISO], [], opcao, [], ['Código', 'Descrição', 'Percentual']];
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

  // Valor por extenso em reais (carta-proposta): 705488.9 -> "setecentos e cinco mil quatrocentos e oitenta e oito reais e noventa centavos".
  const UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function ate999(n) {
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100), r = n % 100, d = Math.floor(r / 10), u = r % 10;
    const resto = r < 20 ? UNID[r] : [DEZ[d], UNID[u]].filter(Boolean).join(' e ');
    return [CEM[c], resto].filter(Boolean).join(' e ');
  }
  function inteiroPorExtenso(n) {
    if (n === 0) return 'zero';
    const escalas = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
    const grupos = [];
    for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) grupos.push({ v: n % 1000, i });
    const partes = grupos.filter((g) => g.v).reverse().map((g) => (g.i === 1 && g.v === 1 ? 'mil' : `${ate999(g.v)}${g.i ? ` ${escalas[g.i][g.v === 1 ? 0 : 1]}` : ''}`));
    const ultimo = grupos.find((g) => g.v);
    // "e" antes do último grupo quando ele é menor que 100 ou centena redonda: "mil e quinhentos", "dois mil e dez".
    if (partes.length > 1 && (ultimo.v < 100 || ultimo.v % 100 === 0)) return `${partes.slice(0, -1).join(' ')} e ${partes[partes.length - 1]}`;
    return partes.join(' ');
  }
  function valorPorExtenso(valor) {
    const centavosTotal = Math.round(Number(valor) * 100), reais = Math.floor(centavosTotal / 100), cent = centavosTotal % 100;
    const milhaoRedondo = reais >= 1e6 && reais % 1e6 === 0;
    const r = reais ? `${inteiroPorExtenso(reais)}${milhaoRedondo ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}` : '';
    const c = cent ? `${inteiroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}` : '';
    return [r, c].filter(Boolean).join(' e ') || 'zero real';
  }

  // Composições próprias: cada item sem tabela, com as cotações, a mediana e o lugar da CPU (MO, material, equipamento).
  function abaComposicoesProprias(orc) {
    const out = [...cab(orc, 'COMPOSIÇÕES PRÓPRIAS (itens sem tabela de referência)')];
    const proprias = orc.linhas.filter((l) => l.tipo === 'servico' && (l.origem === 'cotacao' || l.fonte === 'PROPRIA'));
    if (!proprias.length) out.push(['Nenhum item com composição própria.']);
    for (const l of proprias) {
      out.push([`Item ${l.item}`, l.codigo || '', l.descricao, l.unidade || '', 'Quantidade:', l.quantidade ?? '']);
      if (l.propria?.cotacoes?.length) {
        out.push(['Fornecedor', 'Data', 'Valor (R$)']);
        for (const c of l.propria.cotacoes) out.push([c.fornecedor || '', c.data || '(anotar a data)', c.valor]);
        out.push(['Mediana (preço adotado, sem BDI)', '', l.propria.preco], ['Memória:', l.propria.memoria]);
      } else out.push(['Cotações:', 'faltam (são 3, com data e CNPJ do fornecedor)']);
      if (l.cpu) {
        out.push(['Tipo', 'Código', 'Descrição', 'Unid.', 'Coeficiente', 'Preço unit.', 'Parcial']);
        for (const c of l.cpu.linhas) out.push([c.tipo === 'composicao' ? 'Composição auxiliar' : 'Insumo', c.codigo, c.descricao || '', c.unidade || '', c.coeficiente, c.preco ?? 'sem preço', c.parcial ?? '']);
      } else out.push(['CPU:', 'detalhar mão de obra, material e equipamento com coeficientes (o edital pede a composição de todos os itens)']);
      out.push([]);
    }
    return { nome: 'Composições próprias', linhas: out };
  }

  // Carta-proposta: modelo com os números do orçamento; razão social e CNPJ da empresa do orçamento (operacao_empresas),
  // o resto em branco (a ferramenta não assina). Sem empresa (orçamento só no navegador): os campos ficam para preencher.
  const cnpjFormatado = (c) => String(c || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  function abaCartaProposta(orc, empresa) {
    const c = orc.leitura.cabecalho || {}, g = orc.globalProposta, d = orc.desconto?.linear;
    const meses = orc.crono?.porMes?.length || 0;
    return { nome: 'Carta-proposta', linhas: [
      ['CARTA-PROPOSTA (modelo: confira com o modelo do edital)'], [AVISO], [],
      ['À', '[órgão licitante]'], ['Referência:', '[modalidade e número do edital]'], ['Objeto:', c.objeto || '[objeto do edital]'], [],
      ['Empresa:', empresa?.razao_social || '[razão social]'], ['CNPJ:', cnpjFormatado(empresa?.cnpj) || '[CNPJ]'], ['Endereço:', '[endereço]'], ['Representante legal:', '[nome e cargo]'], [],
      ['Valor global da proposta (R$):', g], ['Por extenso:', valorPorExtenso(g)],
      ...(d ? [['Desconto linear sobre a referência:', d]] : []),
      ...(orc.globalReferencia ? [['Valor de referência do edital (R$):', orc.globalReferencia]] : []),
      ['BDI adotado:', orc.bdi], ['Regime da empresa:', orc.regime?.desonerado === true ? 'desonerada (CPRB)' : orc.regime?.desonerado === false ? 'não desonerada' : '[marcar: desonerada ou não desonerada]'],
      ['Data-base dos preços:', c.dataBase || '[mês/ano]'], ['Prazo de execução:', meses ? `${meses * 30} dias (${meses} meses, conforme cronograma)` : '[conforme edital]'],
      ['Validade da proposta:', '[conforme edital; em geral, 60 dias]'], [],
      ['Declaramos que:'],
      ['1.', 'nos preços estão incluídos todos os custos diretos e indiretos, tributos, encargos sociais e trabalhistas, BDI, materiais, mão de obra, equipamentos, transporte e demais despesas para executar o objeto;'],
      ['2.', 'a planilha orçamentária, as composições de custo unitário, o BDI, os encargos sociais e o cronograma físico-financeiro anexos fazem parte desta proposta;'],
      ['3.', 'conhecemos as condições do local da obra (vistoria realizada ou dispensada por declaração do responsável técnico, conforme o edital);'],
      ['4.', 'aceitamos todas as condições do edital e de seus anexos.'], [],
      ['[local], [data]'], [],
      ['_______________________________', '', '_______________________________'],
      ['Representante legal', '', 'Responsável técnico (CREA/CAU nº ______)'],
    ] };
  }

  // "Pacote pronto para enviar": as regras que o Auditor não confere sozinho (lista única de 106, REGRAS-AUDITOR.md) e que
  // bloqueiam ou derrubam, para o engenheiro marcar ANTES da disputa (a causa nº 1 de queda é não enviar no prazo de 2 h).
  // Desconto acima de 25%: entra o memorial de exequibilidade (A03; caso DNIT BR-364).
  function abaConferencia(orc) {
    const ref = orc.globalReferencia, desconto = ref > 0 ? 1 - orc.globalProposta / ref : 0;
    const manuais = CAT.CATALOGO.filter((r) => !r.chave && (['BLOQUEIA', 'ERRO'].includes(r.nivel) || /^[IJ]/.test(r.id)) && !/^M/.test(r.id) && (r.id !== 'A03' || desconto > 0.25));
    const linhas = [[AVISO], [], ['CONFERÊNCIA ANTES DE ENVIAR (o Auditor não confere estes pontos sozinho)'], [],
      ['Regra', 'Nível', 'Grupo', 'O que conferir', 'Fonte', 'Versão', 'Feito']];
    for (const r of manuais) linhas.push([r.id, r.nivel, r.grupo, r.checar, r.fonte, `v${r.versao} de ${r.valeDesde}`, '(   )']);
    if (desconto > 0.25) {
      linhas.push([], ['MEMORIAL DE EXEQUIBILIDADE (desconto de ' + (Math.round(desconto * 10000) / 100).toString().replace('.', ',') + '%, acima de 25%)'],
        ['1', 'Cotações válidas e assinadas dos insumos da curva A, com local de entrega e frete.'],
        ['2', 'Declaração de compromisso de fornecimento dos fornecedores cotados.'],
        ['3', 'Mão de obra, coeficientes, equipamentos e tributos IGUAIS aos da referência (só o preço do insumo cotado muda).'],
        ['4', 'Salários no mínimo iguais aos da convenção coletiva da UF.'],
        ['Fonte', 'Lei 14.133/2021 art. 59 §2º e §4º; DNIT CE 268/2025 (BR-364); REGRAS-AUDITOR A03']);
    }
    return { nome: 'Conferência antes de enviar', linhas };
  }

  // op.empresa = { razao_social, cnpj } da empresa licitante (carta-proposta).
  function montarAbas(orc, op = {}) {
    return [abaSintetico(orc), abaCpu(orc), abaComposicoesProprias(orc), abaBdi(orc), abaEncargos(orc), abaAbc(orc), abaCronograma(orc), abaCartaProposta(orc, op.empresa), abaAlertas(orc), abaConferencia(orc)];
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
      // Global ofertado antes do desconto: a linha do TRE-AM traz a nota "Inserir o preço global com o desconto ofertado"
      // e, na ordem inversa, recebia 0,17 no lugar do preço global.
      else if (/(PRECO|VALOR) GLOBAL|TOTAL GERAL/.test(t) && /LICITANTE|OFERTADO|PROPOSTA/.test(t)) por(k.total, i, orc.globalProposta);
      else if (/DESCONTO/.test(t) && orc.desconto.linear !== undefined) por(k.total, i, orc.desconto.linear);
    }
    return m;
  }

  const api = { AVISO, montarOrcamento, montarAbas, formatoEdital, valorPorExtenso, ajustarAoLance, tabelaDeLances };
  if (noNode) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { montador: api });
})();
