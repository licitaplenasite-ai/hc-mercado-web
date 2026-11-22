/* global module, require -- script de navegador (orcamento-obra.html) e módulo do Node (testes e scripts/orcamento_obra.js) */
// Agente Auditor do "Orçamento de obra": confere o orçamento montado contra a base de regras (orcamento-obra-regras.js)
// e devolve alertas em português simples, cada um com o artigo ou acórdão. Não corrige nada: aponta.
// nivel: 'erro' (pode desclassificar), 'atencao' (pode dar problema ou pedir justificativa), 'info' (para saber).
(function () {
  'use strict';
  const noNode = typeof module !== 'undefined' && module.exports;
  const { REGRAS } = noNode ? require('./orcamento-obra-regras.js') : globalThis.OrcObra.regras;
  const C = noNode ? require('./orcamento-obra-calculo.js') : globalThis.OrcObra.calculo;
  const BDI = noNode ? require('./bdi-calculadora.js') : globalThis.BdiCalculadora;

  const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = (f) => `${(Number(f) * 100).toFixed(2).replace('.', ',')}%`;
  const casas = (v) => (String(v).split('.')[1] || '').length;
  // Valor com mais de 2 casas aparece com 4, para a pessoa ver de onde vem a diferença de centavo.
  const exato = (v) => (casas(Number(Number(v).toPrecision(12))) > 2 ? `R$ ${Number(v).toFixed(4).replace('.', ',')}` : reais(v));
  const servicos = (linhas) => (linhas || []).filter((l) => l.tipo === 'servico');

  function alerta(regra, nivel, texto, item) {
    const r = REGRAS[regra];
    return { regra, nivel, titulo: r.titulo, texto, fonte: r.fonte, link: r.link, ...(item ? { item } : {}) };
  }

  // ---- Uma função por regra: (ctx) -> [alertas] ----

  // ctx.bdi = { tipo, ac, s, r, g, df, l, issAliquota, pis, cofins, cprb } em centésimos de ponto (como bdi-calculadora.js).
  function regraBdi(ctx) {
    if (ctx.bdiFinal === 0 && servicos(ctx.linhas).length) return [alerta('bdi_zerado', 'erro', 'O BDI está em 0%: informe a composição do BDI (administração central, seguro, risco, despesas financeiras, lucro e tributos).')];
    if (!ctx.bdi?.tipo) return [];
    const r = BDI.avaliar(ctx.bdi);
    if (r.erro) return [alerta('bdi_faixa', 'erro', `Não deu para calcular o BDI: ${r.erro}`)];
    const out = [];
    // As faixas do Acórdão 2622/2013 não contam a CPRB: com desoneração, compara também o BDI sem ela.
    const b = ctx.bdi, semCprb = (b.cprb || 0) > 0 ? BDI.calcularBdi({ ac: b.ac, s: b.s, r: b.r, g: b.g, df: b.df, l: b.l, i: r.i - b.cprb }).bdi : null;
    const semCprbNaFaixa = semCprb !== null && BDI.classificar(semCprb, r.total.faixa).estado === 'verde';
    if (r.total.estado !== 'verde' && semCprbNaFaixa) {
      out.push(alerta('bdi_faixa', 'info', `BDI de ${BDI.fmtPct(r.bdi)} passa da faixa do TCU (${BDI.fmtPct(r.total.faixa[0])} a ${BDI.fmtPct(r.total.faixa[2])}) só por causa da CPRB; sem ela fica em ${BDI.fmtPct(semCprb)}, dentro da faixa. Explique isso na planilha do BDI.`));
    } else if (r.total.estado !== 'verde') {
      out.push(alerta('bdi_faixa', r.total.estado === 'vermelho' ? 'atencao' : 'info',
        `BDI de ${BDI.fmtPct(r.bdi)} está ${r.total.posicao} da faixa do TCU para ${r.tipo} (${BDI.fmtPct(r.total.faixa[0])} a ${BDI.fmtPct(r.total.faixa[2])}). Justifique ou ajuste.`));
    }
    for (const l of r.linhas) if (l.estado === 'vermelho' && !/ISS|PIS|CPRB/.test(l.rotulo)) out.push(alerta('bdi_faixa', 'info', `${l.rotulo}: ${BDI.fmtPct(l.valor)} fora da faixa do TCU.`));
    const iss = r.linhas.find((l) => /^ISS/.test(l.rotulo));
    if (iss && iss.estado !== 'verde') out.push(alerta('iss_faixa', 'erro', `ISS de ${BDI.fmtPct(iss.valor)}: tem que ficar entre 2% e 5%, pela lei do município da obra.`));
    if (ctx.bdiAplicado !== undefined && Math.abs(ctx.bdiAplicado * 10000 - r.bdi) > 1) {
      out.push(alerta('total_nao_fecha', 'erro', `O BDI usado nos preços (${pct(ctx.bdiAplicado)}) não é o da composição do BDI (${BDI.fmtPct(r.bdi)}).`));
    }
    return out;
  }

  // Unitário da proposta acima da referência do edital (com o BDI do edital, quando o edital põe BDI só no global).
  function regraUnitario(ctx) {
    const out = [];
    for (const l of servicos(ctx.linhas)) {
      if (l.unitario === undefined || l.referenciaEdital === undefined || l.referenciaEdital === null) continue;
      const teto = C.ajustar(l.referenciaEdital * (1 + (ctx.bdiEdital ?? 0)), ctx.modo);
      if (l.unitario > teto + 0.005) out.push(alerta('unitario_acima', 'erro', `Item ${l.item}: ${reais(l.unitario)} acima da referência ${reais(teto)}.`, l.item));
    }
    return out;
  }

  // Etapa (nível 1) e global contra os da referência; abaixo de 75% e 85% do orçado.
  function regraGlobalEtapas(ctx) {
    const out = [];
    for (const e of (ctx.linhas || []).filter((l) => l.tipo === 'etapa' && !l.item.includes('.'))) {
      const ref = ctx.etapasReferencia?.[e.item];
      if (ref !== undefined && e.total > ref + 0.005) out.push(alerta('etapa_acima', 'erro', `Etapa ${e.item} (${e.descricao}): ${reais(e.total)} acima da referência ${reais(ref)}.`, e.item));
    }
    // Cada mês do cronograma também não pode passar do mês do cronograma de referência (Decreto 7.983/2013 art. 13, I).
    (ctx.cronograma || []).forEach((v, i) => {
      const ref = ctx.cronogramaReferencia?.[i];
      if (ref !== undefined && v > ref + 0.005) out.push(alerta('etapa_acima', 'erro', `Mês ${i + 1} do cronograma: ${reais(v)} acima do mês da referência ${reais(ref)}.`));
    });
    const g = ctx.globalProposta ?? ctx.total, ref = ctx.globalReferencia;
    if (ctx.lei === '13303') {
      out.push(alerta('lei_13303', 'info', 'Licitação de estatal (Lei 13.303/2016): a regra dos 75% não vale. Confira no edital o limite de inexequibilidade (em geral, 70% da média das propostas) e se o orçamento é sigiloso.'));
      if (ref > 0 && g > ref + 0.005) out.push(alerta('global_acima', 'erro', `Global ${reais(g)} acima do orçamento ${reais(ref)}.`));
      return out;
    }
    if (ref > 0 && g > 0) {
      const d = 1 - g / ref;
      if (g > ref + 0.005) out.push(alerta('global_acima', 'erro', `Global ${reais(g)} acima do orçamento ${reais(ref)}.`));
      // Compara em centavos: 25% de desconto cravado (R$ 637.489,97 de R$ 849.986,63) não é "inferior a 75%".
      else if (g < C.arredondar(ref * 0.75) - 0.004) out.push(alerta('inexequivel', 'erro', `Global ${reais(g)} é ${pct(g / ref)} do orçado (desconto de ${pct(d)}): abaixo de 75%, a lei presume inexequível. Tenha a prova de exequibilidade pronta (CPU, cotações, contratos parecidos).`));
      else if (g < C.arredondar(ref * 0.85) - 0.004) out.push(alerta('garantia_adicional', 'atencao', `Global ${reais(g)} é ${pct(g / ref)} do orçado: abaixo de 85%, exige garantia adicional de ${reais(ref * 0.85 - g)} ou mais (custo que entra na conta do desconto).`));
      if (d >= 0.2) {
        const taxa = d > 0.30005 ? '48,6% (66% no Norte)' : d > 0.25005 ? '40,5% (54% no Norte)' : d > 0.24995 ? '27%' : '24% (30% no Norte)';
        out.push(alerta('zona_de_risco', 'atencao', `Desconto de ${pct(d)}: nas obras estudadas, ${taxa} das propostas nesta faixa foram recusadas. ${d > 0.25005 ? 'Tenha o memorial de exequibilidade pronto (contratos parecidos, notas de insumo, produtividade). ' : ''}Revise planilha, CPU, BDI, cronograma e habilitação antes da sessão.`));
      }
    }
    return out;
  }

  // ctx.regime = { desonerado, ano, inssEncargos (fração do INSS no grupo A), editalDesonerado, simples }
  function regraDesoneracao(ctx) {
    const r = ctx.regime || {}, cprb = (ctx.bdi?.cprb || 0) / 10000, out = [];
    if (r.simples && ctx.bdi && ((ctx.bdi.pis || 0) === 65 || (ctx.bdi.cofins || 0) === 300 || cprb > 0)) {
      out.push(alerta('simples', 'atencao', 'A empresa é do Simples Nacional, mas o BDI usa PIS 0,65%, COFINS 3% ou CPRB, que são de outro regime. Use as alíquotas efetivas do Anexo IV da LC 123/2006 (confira com o contador).'));
    }
    if (r.inssEncargos !== undefined && cprb > 0 && r.inssEncargos >= 0.2) out.push(alerta('desoneracao', 'erro', `Há CPRB de ${pct(cprb)} no BDI e INSS de 20% nos encargos: o imposto está sendo cobrado duas vezes.`));
    if (r.inssEncargos !== undefined && cprb === 0 && r.inssEncargos === 0) out.push(alerta('desoneracao', 'erro', 'Encargos sem INSS (desonerados) e BDI sem CPRB: falta o imposto sobre a receita.'));
    if (r.desonerado === true && ctx.bdi && cprb === 0) out.push(alerta('desoneracao', 'erro', 'Orçamento desonerado sem CPRB no BDI.'));
    if (r.desonerado === false && cprb > 0) out.push(alerta('desoneracao', 'erro', 'Orçamento não desonerado com CPRB no BDI.'));
    if (r.editalDesonerado !== undefined && r.editalDesonerado !== null && r.desonerado !== undefined && r.editalDesonerado !== r.desonerado) {
      out.push(alerta('desoneracao', 'atencao', `O edital orçou ${r.editalDesonerado ? 'desonerado' : 'não desonerado'} e a proposta está ${r.desonerado ? 'desonerada' : 'não desonerada'}. Se o edital deixa escolher, BDI e encargos têm de seguir o regime da empresa, e mesmo assim nenhum preço unitário pode passar da referência (caso real: recusa no TRE-AM 2/2023).`));
    }
    if (ctx.bdi && r.desonerado !== true && r.desonerado !== false) out.push(alerta('encargos', 'atencao', 'Marque se a empresa é desonerada ou não: a tabela de encargos precisa trazer essa opção.'));
    if (r.ano >= 2025 && r.ano <= 2027 && cprb > 0) {
      const certa = C.cprbConstrucao(r.ano);
      if (Math.abs(cprb - certa) > 0.0001) out.push(alerta('reoneracao', 'erro', `Em ${r.ano} a CPRB da construção é ${pct(certa)} (não ${pct(cprb)}), e a folha paga ${pct(C.inssGrupoA(true, r.ano))} de INSS.`));
      if (r.inssEncargos !== undefined && Math.abs(r.inssEncargos - C.inssGrupoA(true, r.ano)) > 0.0001) out.push(alerta('reoneracao', 'erro', `Em ${r.ano}, desonerado tem ${pct(C.inssGrupoA(true, r.ano))} de INSS no grupo A dos encargos (está ${pct(r.inssEncargos)}).`));
    }
    return out;
  }

  // Quantidade × unitário = total; soma dos itens = etapa; soma = global.
  function regraTotais(ctx) {
    const out = [];
    for (const l of servicos(ctx.linhas)) {
      // Célula de fórmula salva sem valor: o item tem preço, mas fica fora da soma (caso real: R$ 687 mil fora do total).
      if (l.unitario > 0 && (l.total === null || l.total === '')) { out.push(alerta('total_nao_fecha', 'erro', `Item ${l.item}: tem preço (${exato(l.unitario)}) mas o total está vazio, e fica fora da soma. Recalcule a planilha no Excel antes de enviar.`, l.item)); continue; }
      if (!(Number(l.quantidade) > 0)) { out.push(alerta('total_nao_fecha', 'erro', `Item ${l.item}: sem quantidade.`, l.item)); continue; }
      if (l.unitario === undefined || l.total === undefined) continue;
      const certo = C.ajustar((Number(l.quantidade) || 0) * l.unitario, ctx.modoTotal || ctx.modo);
      if (Math.abs(certo - l.total) > 0.005) out.push(alerta('total_nao_fecha', 'erro', `Item ${l.item}: ${l.quantidade} × ${exato(l.unitario)} = ${reais(certo)}, mas está ${exato(l.total)}.`, l.item));
    }
    const etapas = (ctx.linhas || []).filter((l) => l.tipo === 'etapa');
    for (const e of etapas) {
      const filhos = servicos(ctx.linhas).filter((s) => s.item.startsWith(`${e.item}.`));
      const somaFilhos = C.arredondar(filhos.reduce((a, s) => a + (s.total || 0), 0));
      if (e.total !== undefined && filhos.length && Math.abs(somaFilhos - e.total) > 0.005) out.push(alerta('total_nao_fecha', 'erro', `Etapa ${e.item}: itens somam ${reais(somaFilhos)}, mas a etapa diz ${reais(e.total)}.`, e.item));
    }
    if (ctx.globalProposta !== undefined && ctx.total !== undefined && Math.abs(ctx.globalProposta - ctx.total) > 0.005) {
      out.push(alerta('desconto_so_no_global', 'atencao', `O global declarado (${reais(ctx.globalProposta)}) é diferente da soma dos itens (${reais(ctx.total)}): o desconto ficou só no total. Depois de ganhar, as planilhas terão de ser refeitas com os preços unitários ajustados.`));
    }
    return out;
  }

  // Mais de 2 casas, ou arredondado diferente do modo do edital.
  function regraArredondamento(ctx) {
    const out = [];
    for (const l of servicos(ctx.linhas)) {
      for (const [campo, v] of [['unitário', l.unitario], ['total', l.total]]) {
        if (typeof v === 'number' && casas(Number(v.toPrecision(12))) > 2) out.push(alerta('arredondamento', 'erro', `Item ${l.item}: ${campo} ${v} com mais de 2 casas.`, l.item));
      }
      if (l.unitario !== undefined && l.total !== undefined && ctx.modoTotal) {
        const outro = ctx.modoTotal === 'truncar' ? 'arredondar' : 'truncar', q = Number(l.quantidade) || 0;
        if (C.ajustar(q * l.unitario, outro) === l.total && C.ajustar(q * l.unitario, ctx.modoTotal) !== l.total) {
          out.push(alerta('arredondamento', 'atencao', `Item ${l.item}: total ${ctx.modoTotal === 'truncar' ? 'arredondado' : 'truncado'}, mas o edital pede ${ctx.modoTotal}.`, l.item));
        }
      }
    }
    return out;
  }

  // Itens do edital que sumiram, ou com quantidade/unidade diferente; itens a mais.
  function regraItens(ctx) {
    if (!ctx.itensEdital) return [];
    const out = [], prop = new Map(servicos(ctx.linhas).map((l) => [l.item, l]));
    for (const e of servicos(ctx.itensEdital)) {
      const p = prop.get(e.item);
      if (!p) { out.push(alerta('item_faltando', 'erro', `Item ${e.item} (${e.descricao.slice(0, 60)}) do edital não está na proposta.`, e.item)); continue; }
      if (Number(p.quantidade) !== Number(e.quantidade)) out.push(alerta('item_faltando', 'erro', `Item ${e.item}: quantidade ${p.quantidade}, o edital pede ${e.quantidade}.`, e.item));
      if (String(p.unidade || '').toLowerCase() !== String(e.unidade || '').toLowerCase()) out.push(alerta('item_faltando', 'atencao', `Item ${e.item}: unidade "${p.unidade}", o edital pede "${e.unidade}".`, e.item));
      const desc = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
      if (p.descricao !== undefined && desc(p.descricao) !== desc(e.descricao)) out.push(alerta('item_faltando', 'atencao', `Item ${e.item}: a descrição mudou em relação ao edital.`, e.item));
    }
    const doEdital = new Set(servicos(ctx.itensEdital).map((e) => e.item));
    for (const p of prop.values()) if (!doEdital.has(p.item)) out.push(alerta('item_faltando', 'atencao', `Item ${p.item} não existe no edital.`, p.item));
    return out;
  }

  // Sem referência, composição própria com menos de 3 cotações, preço digitado de tabela sem data-base.
  function regraReferencias(ctx) {
    const out = [];
    for (const l of servicos(ctx.linhas)) {
      if (l.origem === 'sem_referencia') out.push(alerta('sem_referencia', 'erro', `Item ${l.item} (${l.fonte || 'sem fonte'} ${l.codigo || ''}): sem preço. Busque na tabela ${l.fonte || 'de referência'} ou faça composição própria com 3 cotações.`, l.item));
      if (l.origem === 'cotacao' && l.propria?.aviso) out.push(alerta('cotacao', 'atencao', `Item ${l.item}: ${l.propria.aviso}`, l.item));
      if (l.origem === 'cotacao' && l.propria?.cotacoes?.some((c) => !c.data)) out.push(alerta('cotacao', 'info', `Item ${l.item}: anexe as cotações com data e CNPJ do fornecedor, e a CPU (mão de obra, material e equipamento). Na diligência o órgão pede.`, l.item));
      if (l.origem === 'manual' && !l.manual?.dataBase) out.push(alerta('data_base', 'atencao', `Item ${l.item}: preço da ${l.manual?.fonte || l.fonte} sem mês de referência. Anote a data-base (e a data de acesso) na memória.`, l.item));
    }
    if (ctx.dataBaseEdital && ctx.dataBaseBanco && ctx.dataBaseEdital !== ctx.dataBaseBanco) {
      out.push(alerta('data_base', 'atencao', `O edital é de data-base ${ctx.dataBaseEdital} e os preços do sistema são de ${ctx.dataBaseBanco}. Os preços buscados podem ficar acima ou abaixo da referência do edital.`));
    }
    return out;
  }

  // Desconto por item muito desigual entre os itens que mais pesam (curva A).
  function regraJogoDePlanilha(ctx) {
    const s = servicos(ctx.linhas).filter((l) => l.desconto !== undefined && l.total > 0);
    if (s.length < 3) return [];
    const total = s.reduce((a, l) => a + l.total, 0);
    let ac = 0;
    const curvaA = [...s].sort((a, b) => b.total - a.total).filter((l) => { const antes = ac; ac += l.total; return antes / total < 0.8; });
    const d = curvaA.map((l) => l.desconto);
    const spread = Math.max(...d) - Math.min(...d);
    return spread > 0.3 ? [alerta('jogo_de_planilha', 'atencao', `Nos itens que mais pesam, o desconto vai de ${pct(Math.min(...d))} a ${pct(Math.max(...d))}. Descontos tão desiguais parecem jogo de planilha.`)] : [];
  }

  // CPU de todos os itens (recusa confirmada no TRE-AM 2/2023): item sem composição ou composição com insumo sem preço.
  // Agrupa num alerta só para não afogar a lista. Composição própria tem a memória das cotações; insumo puro não tem CPU.
  function regraCpuIncompleta(ctx) {
    const s = servicos(ctx.linhas).filter((l) => l.referencia !== null && l.referencia !== undefined), out = [];
    const semCpu = s.filter((l) => !l.cpu && !l.insumo && l.origem !== 'cotacao' && !l.manual?.cpuAnexada);
    const furada = s.filter((l) => l.cpu?.semPreco?.length);
    const lista = (xs) => `${xs.slice(0, 12).map((l) => l.item).join(', ')}${xs.length > 12 ? ` e mais ${xs.length - 12}` : ''}`;
    if (semCpu.length) out.push(alerta('cpu_incompleta', 'erro', `${semCpu.length} item(ns) sem a composição (CPU): ${lista(semCpu)}. Anexe a composição da tabela de cada um (ou a sua) antes de enviar.`));
    if (furada.length) out.push(alerta('cpu_incompleta', 'erro', `${furada.length} composição(ões) com insumo sem preço: ${lista(furada)}.`));
    const zerado = s.filter((l) => l.cpu?.linhas?.some((c) => !(Number(c.coeficiente) > 0)));
    if (zerado.length) out.push(alerta('cpu_incompleta', 'atencao', `${zerado.length} composição(ões) com coeficiente zerado: ${lista(zerado)}. Confira se o insumo deveria estar lá.`));
    return out;
  }

  // Cada etapa do cronograma soma 100% e o cronograma fecha com o total da planilha.
  function regraCronograma(ctx) {
    const c = ctx.cronogramaCompleto, out = [];
    if (!c) return out;
    for (const e of c.etapas) {
      const soma = e.fracoes.reduce((a, f) => a + Number(f || 0), 0);
      if (Math.abs(soma - 1) > 0.0001 || e.valores.some((v) => v < 0)) out.push(alerta('cronograma', 'erro', `Etapa ${e.item} (${e.descricao}): os meses somam ${pct(soma)}, e não 100%.`, e.item));
    }
    const soma = C.arredondar(c.etapas.reduce((a, e) => a + e.total, 0));
    if (ctx.totalPlanilha !== undefined && Math.abs(soma - ctx.totalPlanilha) > 0.005) out.push(alerta('cronograma', 'erro', `O cronograma soma ${reais(soma)} e a planilha ${reais(ctx.totalPlanilha)}: falta etapa no cronograma.`));
    return out;
  }

  // Composição própria (ou preço digitado) comparada com o serviço parecido que existe no SINAPI (ctx.similares).
  function regraPropriaVsReferencia(ctx) {
    const out = [];
    for (const l of servicos(ctx.linhas)) {
      const sim = ctx.similares?.[l.item];
      if (!sim?.preco || !(l.referencia > 0) || !['cotacao', 'manual'].includes(l.origem)) continue;
      const r = l.referencia / sim.preco;
      if (r < 0.5 || r > 2) out.push(alerta('propria_vs_referencia', 'atencao', `Item ${l.item}: preço de ${reais(l.referencia)} é ${r < 1 ? `${(1 / r).toFixed(1).replace('.', ',')} vezes menor` : `${r.toFixed(1).replace('.', ',')} vezes maior`} que o SINAPI ${sim.codigo} parecido (${reais(sim.preco)}). Confira antes de usar.`, l.item));
    }
    return out;
  }

  // Lembrete fixo do que derrubou propostas fora da planilha (prazo de 2 h, declarações assinadas pelo RT).
  function regraChecklistEnvio(ctx) {
    if (!servicos(ctx.linhas).length) return [];
    return [alerta('checklist_envio', 'info', 'Antes da disputa, deixe prontos e assinados pelo responsável técnico: planilha, CPU, BDI, encargos (com a opção desonerado ou não desonerado marcada), cronograma e as declarações (vistoria ou dispensa e as demais). O prazo de envio costuma ser de 2 horas.')];
  }

  // Mesmo código da mesma tabela em itens de descrição diferente (ex.: módulo e otimizador com o mesmo código SIURB).
  function regraCodigoRepetido(ctx) {
    const vistos = new Map(), out = [];
    const desc = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().slice(0, 40);
    for (const l of servicos(ctx.linhas)) {
      if (!l.codigo || /^(N\/?A|-)$/i.test(l.codigo) || l.fonte === 'PROPRIA') continue;
      const k = `${l.fonte}|${l.codigo}`, antes = vistos.get(k);
      if (antes && desc(antes.descricao) !== desc(l.descricao)) out.push(alerta('codigo_repetido', 'atencao', `Itens ${antes.item} e ${l.item} usam o mesmo código ${l.fonte} ${l.codigo} com descrições diferentes.`, l.item));
      if (!antes) vistos.set(k, l);
    }
    return out;
  }

  // Equipamento de valor relevante com o BDI dos serviços; item sem BDI.
  const EQUIPAMENTO = /MODULO FOTOVOLTAICO|PAINEL SOLAR|INVERSOR|TRANSFORMADOR|GERADOR|ELEVADOR|CHILLER|SUBESTACAO|CARREGADOR/;
  function regraBdiDiferenciado(ctx) {
    const s = servicos(ctx.linhas).filter((l) => l.bdi !== undefined && l.total > 0), out = [];
    const total = s.reduce((a, l) => a + l.total, 0), maior = Math.max(0, ...s.map((l) => l.bdi));
    for (const l of s) {
      const d = String(l.descricao || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      if (EQUIPAMENTO.test(d) && l.bdi === maior && maior > 0 && l.total / total >= 0.05) out.push(alerta('bdi_diferenciado', 'atencao', `Item ${l.item} parece equipamento de valor relevante (${pct(l.total / total)} da obra) com o mesmo BDI dos serviços. O BDI diferenciado (reduzido) é o esperado.`, l.item));
    }
    const semBdi = s.filter((l) => l.bdi === 0);
    if (semBdi.length && maior > 0) out.push(alerta('bdi_diferenciado', 'info', `${semBdi.length} item(ns) sem BDI (ex.: ${semBdi.slice(0, 3).map((l) => l.item).join(', ')}): explique na planilha (projeto, ART ou taxa entram pelo preço de tabela).`));
    return out;
  }

  // Encargos: total informado diferente de A+B+C+D; desonerado com INSS.
  function regraEncargos(ctx) {
    const e = ctx.encargos;
    if (!e?.grupos) return [];
    const r = C.encargosSociais(e.grupos), out = [];
    if (e.informado !== undefined && Math.abs(r.total - e.informado) > 0.0001) out.push(alerta('encargos', 'erro', `Encargos informados ${pct(e.informado)}, mas A+B+C+D dá ${pct(r.total)}.`));
    return out;
  }

  const REGRAS_ATIVAS = [regraBdi, regraUnitario, regraGlobalEtapas, regraDesoneracao, regraTotais, regraArredondamento, regraItens, regraReferencias, regraJogoDePlanilha, regraEncargos, regraCodigoRepetido, regraBdiDiferenciado, regraCpuIncompleta, regraChecklistEnvio, regraCronograma, regraPropriaVsReferencia];
  const ORDEM = { erro: 0, atencao: 1, info: 2 };
  function auditar(ctx) {
    return REGRAS_ATIVAS.flatMap((f) => f(ctx)).sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel]);
  }
  // Resumo para a tela: quantos de cada nível e se está pronto para o engenheiro revisar.
  function resumo(alertas) {
    const n = { erro: 0, atencao: 0, info: 0 };
    for (const a of alertas) n[a.nivel]++;
    return { ...n, pronto: n.erro === 0 };
  }

  const api = { auditar, resumo, regraBdi, regraUnitario, regraGlobalEtapas, regraDesoneracao, regraTotais, regraArredondamento, regraItens, regraReferencias, regraJogoDePlanilha, regraEncargos, regraCodigoRepetido, regraBdiDiferenciado, regraCpuIncompleta, regraChecklistEnvio, regraCronograma, regraPropriaVsReferencia };
  if (noNode) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { auditor: api });
})();
