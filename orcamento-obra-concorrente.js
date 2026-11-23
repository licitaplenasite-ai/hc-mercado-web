/* global module, require -- script de navegador (orcamento-obra.html) e módulo do Node (testes) */
// Modo "Analisar concorrente" do Orçamento de obra: a planilha que o concorrente mandou passa pelo MESMO Leitor e
// pelas MESMAS regras do Auditor, usadas para fiscalizar proposta de terceiro, e é comparada com a planilha do edital
// (quando enviada). Os números do concorrente são usados como estão: nada é recalculado nem corrigido. Sai uma lista
// de achados (com item, valor, regra e fonte), um placar e um RASCUNHO de recurso, que um advogado precisa revisar.
(function () {
  'use strict';
  const noNode = typeof module !== 'undefined' && module.exports;
  const A = noNode ? require('./orcamento-obra-auditor.js') : globalThis.OrcObra.auditor;
  const C = noNode ? require('./orcamento-obra-calculo.js') : globalThis.OrcObra.calculo;
  const L = noNode ? require('./orcamento-obra-leitor.js') : globalThis.OrcObra.leitor;
  const { REGRAS } = noNode ? require('./orcamento-obra-regras.js') : globalThis.OrcObra.regras;

  const AVISO_RECURSO = 'RASCUNHO gerado automaticamente a partir da planilha do concorrente. Não é parecer jurídico: revise com advogado e confira cada número no documento original antes de protocolar.';
  const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = (f) => `${(Number(f) * 100).toFixed(2).replace('.', ',')}%`;
  const servicos = (itens) => (itens || []).filter((l) => l.tipo === 'servico');
  const lista = (xs, n = 12) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` e mais ${xs.length - n}` : ''}`;
  function alerta(regra, nivel, texto, item) {
    const r = REGRAS[regra];
    return { regra, nivel, titulo: r.titulo, texto, fonte: r.fonte, link: r.link, versao: r.versao, valeDesde: r.valeDesde, ...(item ? { item } : {}) };
  }
  // Os textos do Auditor falam com quem monta o próprio orçamento ("recalcule", "tenha a prova pronta"): aqui o
  // achado é do concorrente, então sai só o fato.
  const paraTerceiro = (t) => String(t).replace(/\s*(Recalcule|Tenha|Justifique ou ajuste|Revise|Anexe|Depois de ganhar|Confira de que ano)[^.]*\./g, '').replace(/ no edital: /, ' na proposta: ').trim();

  // Leitura da proposta (abas do Excel). A planilha de proposta costuma ter mais de uma coluna de preço unitário
  // (referência e proposta): vale a da proposta. Também lê a CPU e o cronograma, se vierem no mesmo arquivo.
  function lerProposta(abas) {
    const leitura = L.lerPasta(abas);
    if (leitura.erro) return leitura;
    const aba = (abas || []).find((a) => a.nome === leitura.aba), titulos = (aba?.linhas?.[leitura.linhaCabecalho] || []).map(L.norm);
    const col = titulos.findIndex((x) => /UNIT/.test(x) && /PROPOSTA|OFERTAD|LICITANTE|COM DESCONTO/.test(x));
    const itens = col < 0 || col === leitura.colunas.precoUnitario ? leitura.itens
      : leitura.itens.map((i) => (i.tipo === 'servico' ? { ...i, precoUnitario: L.num(aba.linhas[i.linhaPlanilha]?.[col]) } : i));
    const cpuAbas = (abas || []).filter((a) => /CPU|COMPOSI/i.test(a.nome));
    const cpu = cpuAbas.length ? L.lerCpu(cpuAbas.flatMap((a) => a.linhas)) : null;
    const abaCrono = (abas || []).find((a) => /CRONOG/i.test(a.nome));
    return { ...leitura, itens, cpu: cpu && Object.keys(cpu.bases).length ? cpu : null, cronograma: abaCrono ? L.lerCronograma(abaCrono.linhas) : null };
  }

  // Base de comparação: tudo COM BDI, porque a proposta e o edital podem pôr o BDI no rodapé ou em cada item.
  const bdiNoRodape = (l) => l.resumo?.custoDireto > 0 && l.resumo?.bdi > 0 && !(l.colunas?.unitarioComBdi >= 0);
  const comBdi = (leitura) => (v) => (v === null || v === undefined ? v : bdiNoRodape(leitura) ? C.arredondar(v * (1 + leitura.resumo.bdi)) : v);
  const comBdiNota = (t) => `${String(t).replace(/\.$/, '')} (valores com BDI).`;
  const unitarioDe = (l) => (l.unitarioComBdiEdital > 0 ? l.unitarioComBdiEdital : l.precoUnitario);

  // Preço global que o concorrente declarou e a soma dos itens dele (com o BDI do rodapé, se for o caso).
  function globais(conc) {
    const r = conc.resumo || {}, soma = C.arredondar(servicos(conc.itens).reduce((a, s) => a + (Number(s.totalEdital) || 0), 0));
    const declarado = r.globalOfertado > 1 ? r.globalOfertado : r.global > 1 ? r.global : null;
    return { soma, somaComBdi: bdiNoRodape(conc) ? C.arredondar(soma * (1 + r.bdi)) : soma, declarado };
  }

  // Regras de preço global contra o orçamento, com o texto de quem fiscaliza (Lei 14.133 art. 59).
  function regraGlobalConcorrente(g, ref, lei) {
    const out = [];
    if (!(ref > 0) || !(g > 0)) return out;
    if (lei === '13303') {
      out.push(alerta('lei_13303', 'info', 'Licitação de estatal (Lei 13.303/2016): a regra dos 75% não vale. Confira no edital o critério de inexequibilidade (em geral, 70% da média das propostas).'));
      if (g > ref + 0.005) out.push(alerta('global_acima', 'erro', `Preço global do concorrente ${reais(g)} acima do orçamento ${reais(ref)}.`));
      return out;
    }
    const d = 1 - g / ref, linha75 = C.arredondar(ref * 0.75);
    if (g > ref + 0.005) out.push(alerta('global_acima', 'erro', `Preço global do concorrente ${reais(g)} acima do orçamento estimado ${reais(ref)}: a proposta deve ser desclassificada (art. 59, III).`));
    else if (g < linha75 - 0.004) out.push(alerta('inexequivel', 'erro', `Preço global do concorrente ${reais(g)} é ${pct(g / ref)} do orçado (desconto de ${pct(d)}), abaixo da linha dos 75% (${reais(linha75)}). A lei presume inexequível: cabe pedir a desclassificação ou, no mínimo, diligência para o concorrente provar que consegue executar (art. 59, §2º e §4º).`));
    else if (g < C.arredondar(ref * 0.85) - 0.004) out.push(alerta('garantia_adicional', 'atencao', `Preço global do concorrente ${reais(g)} é ${pct(g / ref)} do orçado: abaixo de 85%, ele tem de prestar garantia adicional de ${reais(C.arredondar(ref * 0.85 - g))}. Confira se prestou no prazo do edital.`));
    if (d >= 0.2) out.push(alerta('zona_de_risco', 'info', `Desconto de ${pct(d)}: nas obras estudadas, propostas nesta faixa são recusadas com frequência (veja a fonte). Vale olhar com atenção a CPU, o BDI e as cotações do concorrente.`));
    return out;
  }

  // Contas da planilha do concorrente: aceita truncar OU arredondar (o critério do edital nem sempre é conhecido);
  // só fica o achado que não fecha de nenhum dos dois jeitos.
  function regraContas(linhas) {
    const t = A.regraTotais({ linhas, modo: 'truncar' }), a = new Set(A.regraTotais({ linhas, modo: 'arredondar' }).map((x) => `${x.item}|${x.regra}`));
    return t.filter((x) => a.has(`${x.item}|${x.regra}`)).map((x) => ({ ...x, texto: paraTerceiro(x.texto) }));
  }

  // Valores com mais de 2 casas: um achado só (costuma ser fórmula do Excel sem arredondar), de atenção.
  function regraCasas(linhas) {
    const itens = [...new Set(A.regraArredondamento({ linhas }).map((x) => x.item))];
    return itens.length ? [alerta('arredondamento', 'atencao', `${itens.length} item(ns) com preço ou total de mais de 2 casas decimais (${lista(itens)}). A planilha mostra 2 casas, mas a conta guarda mais: o total pode não fechar no centavo.`)] : [];
  }

  // Verba ou "diversos" (Súmula TCU 258). Se o item já vem assim no modelo do órgão, não é culpa do concorrente.
  function regraVerba(conc, edital) {
    const doEdital = new Map(servicos(edital?.itens).map((e) => [e.item, e]));
    const verba = (u) => /^(VB|VERBA)$/i.test(String(u || '').replace(/\.$/, '').trim());
    const ruins = servicos(conc.itens).filter((s) => verba(s.unidade) || /\b(DIVERSOS|EVENTUAIS|DESPESAS GERAIS)\b/i.test(L.norm(s.descricao)));
    const out = [];
    for (const s of ruins) {
      const e = doEdital.get(s.item);
      if (e && L.norm(e.unidade) === L.norm(s.unidade)) continue;
      out.push(alerta('verba_generica', edital ? 'erro' : 'atencao', `Item ${s.item} (${String(s.descricao).slice(0, 60)}): unidade "${s.unidade}" sem composição verificável${edital ? ', e não é assim no modelo do edital' : ''}.`, s.item));
    }
    return out;
  }

  // Item com desconto acima de 25% sobre a referência do edital (preço unitário relevante, art. 59 §3º).
  function regraDescontoPorItem(comparados) {
    const altos = comparados.filter((l) => l.desconto > 0.25).sort((a, b) => b.total - a.total);
    if (!altos.length) return [];
    return [alerta('item_desconto_alto', 'atencao', `${altos.length} item(ns) com desconto acima de 25% sobre o preço do edital: ${lista(altos.map((l) => `${l.item} (${pct(l.desconto)})`), 10)}. Cabe pedir que o concorrente prove a exequibilidade desses preços.`)];
  }

  // CPU do concorrente (no mesmo arquivo ou enviada à parte): item sem composição. Sem CPU nenhuma, só avisa.
  function regraCpuConcorrente(conc, cpu) {
    const s = servicos(conc.itens).filter((x) => x.codigo && !/^(N\/?A|-)$/i.test(x.codigo));
    if (!cpu) return s.length ? [alerta('cpu_incompleta', 'info', 'A planilha enviada não traz as composições (CPU). Se o edital exige a CPU de todos os itens, confira se o concorrente entregou (peça vista do processo) e envie aqui o arquivo da CPU para o Auditor conferir.')] : [];
    const codigos = new Set(Object.values(cpu.bases).flatMap((b) => Object.keys(b.composicoes)));
    const faltam = s.filter((x) => !codigos.has(x.codigo));
    if (!faltam.length) return [];
    // Mais da metade sem CPU: provavelmente o arquivo não é a CPU ou não foi lido direito; não dá para acusar.
    if (faltam.length > s.length / 2) return [alerta('cpu_incompleta', 'atencao', `Não consegui ligar a CPU enviada a ${faltam.length} de ${s.length} itens. Confira se o arquivo é a CPU desta proposta.`)];
    return [alerta('cpu_incompleta', 'erro', `${faltam.length} item(ns) sem composição na CPU do concorrente: ${lista(faltam.map((x) => x.item))}. Se algum for insumo puro (sem composição), ele não precisa de CPU: confira antes de usar.`)];
  }

  // Cronograma do concorrente: cada etapa soma 100% e toda etapa da planilha aparece nele.
  function regraCronogramaConcorrente(conc, crono) {
    if (!crono?.linhas?.length) return [];
    const etapas = crono.linhas.map((l) => ({ item: l.item, descricao: l.descricao, fracoes: l.fracoes, valores: [], total: 0 }));
    const out = A.regraCronograma({ cronogramaCompleto: { etapas } });
    const nome = (s) => L.norm(s).replace(/[^A-Z0-9]+/g, ' ').trim();
    for (const e of (conc.itens || []).filter((l) => l.tipo === 'etapa' && !l.item.includes('.'))) {
      if (!crono.linhas.some((l) => l.item === e.item || nome(l.descricao) === nome(e.descricao))) out.push(alerta('cronograma', 'atencao', `Etapa ${e.item} (${e.descricao}) da planilha não aparece no cronograma do concorrente.`, e.item));
    }
    return out;
  }

  // dados = { concorrente: leitura (lerProposta), edital: leitura | null, cpu, cronograma, origem: 'planilha' | 'pdf' | 'ia' }
  function analisarConcorrente({ concorrente: conc, edital = null, cpu, cronograma, origem = 'planilha' } = {}) {
    const achados = [], linhas = conc.itens.map((l) => (l.tipo === 'servico' ? { ...l, unitario: unitarioDe(l), total: l.totalEdital } : { ...l, total: l.totalEdital ?? undefined }));
    const g = globais(conc), cab = conc.cabecalho || {}, cabE = edital?.cabecalho || {};
    if (origem !== 'planilha') achados.push(alerta('leitura_documento', 'info', `Planilha lida de ${origem === 'ia' ? 'imagem (foto ou PDF digitalizado), pela IA' : 'PDF'}: ${servicos(conc.itens).length} itens. Confira cada número no original antes de usar no recurso.`));

    // 1. Contas da própria planilha (vale com ou sem edital).
    achados.push(...regraContas(linhas), ...regraCasas(linhas));
    if (g.declarado && conc.resumo?.custoDireto > 0 && Math.abs(conc.resumo.custoDireto - g.soma) > 0.05) achados.push(alerta('total_nao_fecha', 'erro', `O custo direto declarado (${reais(conc.resumo.custoDireto)}) não é a soma dos itens (${reais(g.soma)}).`));
    if (g.declarado && Math.abs(g.declarado - g.somaComBdi) > 0.05) {
      achados.push(g.declarado < g.somaComBdi
        ? alerta('desconto_so_no_global', 'atencao', `O preço global declarado (${reais(g.declarado)}) é menor que a soma dos itens${bdiNoRodape(conc) ? ' com BDI' : ''} (${reais(g.somaComBdi)}): o desconto ficou só no total e os preços unitários não estão adequados ao valor final (art. 56, §5º).`)
        : alerta('total_nao_fecha', 'erro', `O preço global declarado (${reais(g.declarado)}) é maior que a soma dos itens${bdiNoRodape(conc) ? ' com BDI' : ''} (${reais(g.somaComBdi)}).`));
    }
    // Código repetido que já vem assim no modelo do órgão não é falha do concorrente.
    const repetidoNoEdital = new Set(edital ? A.regraCodigoRepetido({ linhas: servicos(edital.itens) }).map((x) => x.item) : []);
    // Compara descrições: lida de PDF ou imagem a descrição quebra diferente, então só vale para Excel.
    if (origem === 'planilha') achados.push(...A.regraCodigoRepetido({ linhas }).filter((x) => !repetidoNoEdital.has(x.item)));
    achados.push(...regraVerba(conc, edital));

    // 2. Regime e encargos declarados na planilha.
    if (cab.desonerado !== true && cab.desonerado !== false) achados.push(alerta('regime_nao_declarado', 'atencao', 'A planilha do concorrente não diz se a empresa é desonerada ou não desonerada. Confira na tabela de encargos e no BDI dele: sem essa opção marcada, houve recusa no TRE-AM 2/2023.'));
    achados.push(...A.regraDesoneracao({ regime: { desonerado: cab.desonerado ?? undefined, editalDesonerado: cabE.desonerado ?? undefined } }).map((x) => ({ ...x, texto: x.texto.replace('a proposta está', 'a proposta do concorrente está') })));
    achados.push(...A.regraEncargosDaBase({ uf: cab.uf || cabE.uf, dataBaseEdital: cab.dataBase || cabE.dataBase, regime: { desonerado: cab.desonerado }, encargosEdital: { horista: cab.encargosHorista, mensalista: cab.encargosMensalista } }).map((x) => ({ ...x, texto: paraTerceiro(x.texto) })));

    // 3. Comparação com o edital.
    let ref = null;
    if (edital) {
      const cE = comBdi(edital), cC = comBdi(conc), doEdital = new Map(servicos(edital.itens).map((e) => [e.item, e]));
      const comparados = servicos(linhas).map((l) => {
        const e = doEdital.get(l.item), r = e ? cE(unitarioDe(e)) : null, u = cC(l.unitario);
        return { ...l, unitario: u, referenciaEdital: r > 0 ? r : null, desconto: r > 0 && u > 0 ? 1 - u / r : undefined };
      });
      achados.push(...A.regraUnitario({ linhas: comparados, bdiEdital: 0, modo: 'arredondar' }).map((x) => ({ ...x, texto: comBdiNota(x.texto) })));
      const itens = A.regraItens({ itensEdital: edital.itens, linhas: servicos(conc.itens) });
      // Descrição lida de PDF ou imagem quebra diferente: comparar texto só dá ruído.
      achados.push(...itens.filter((x) => origem === 'planilha' || !/descrição mudou/.test(x.texto)));
      const etapasRef = {}, etapasConc = [];
      for (const e of (edital.itens || []).filter((x) => x.tipo === 'etapa' && !x.item.includes('.') && x.totalEdital > 0)) etapasRef[e.item] = cE(e.totalEdital);
      for (const e of (conc.itens || []).filter((x) => x.tipo === 'etapa' && !x.item.includes('.') && x.totalEdital > 0)) etapasConc.push({ ...e, total: cC(e.totalEdital) });
      achados.push(...A.regraGlobalEtapas({ linhas: etapasConc, etapasReferencia: etapasRef }).map((x) => ({ ...x, texto: comBdiNota(x.texto) })));
      achados.push(...regraDescontoPorItem(comparados), ...A.regraJogoDePlanilha({ linhas: comparados.filter((l) => l.desconto !== undefined) }));
      ref = edital.resumo?.global > 1 ? edital.resumo.global : C.arredondar(servicos(edital.itens).reduce((a, s) => a + (Number(s.totalEdital) || 0), 0) * (bdiNoRodape(edital) ? 1 + edital.resumo.bdi : 1));
    } else if (conc.resumo?.globalOfertado > 1 && conc.resumo?.global > 1 && conc.resumo.global !== conc.resumo.globalOfertado) {
      ref = conc.resumo.global; // a própria planilha traz o "estimado pelo contratante"
    }
    const precoFinal = g.declarado ?? g.somaComBdi;
    achados.push(...regraGlobalConcorrente(precoFinal, ref, cabE.lei || cab.lei));
    if (!edital) achados.push(alerta('item_faltando', 'info', 'Sem a planilha do edital, o Auditor não compara itens, quantidades e preços unitários. Envie a planilha orçamentária do edital para a análise completa.'));

    // 4. CPU e cronograma do concorrente.
    achados.push(...regraCpuConcorrente(conc, cpu ?? conc.cpu ?? null), ...regraCronogramaConcorrente(conc, cronograma ?? conc.cronograma ?? null));

    const ORDEM = { erro: 0, atencao: 1, info: 2 };
    const lista_ = achados.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel]);
    return { achados: lista_, placar: placar(lista_), precoFinal, referencia: ref, soma: g.soma, somaComBdi: g.somaComBdi, origem };
  }

  // Nota de 0 a 100: o quanto a proposta do concorrente está exposta a desclassificação. Conta cada regra uma vez por
  // nível (100 itens acima do preço pesam como 1 regra, para a nota não explodir com planilha grande).
  const PESO = { erro: 35, atencao: 10, info: 0 };
  function placar(achados) {
    const n = { erro: 0, atencao: 0, info: 0 }, regras = new Set();
    for (const a of achados) { n[a.nivel]++; regras.add(`${a.regra}|${a.nivel}`); }
    const nota = Math.min(100, [...regras].reduce((s, k) => s + PESO[k.split('|')[1]], 0));
    const faixa = nota >= 70 ? 'Alta chance de desclassificar' : nota >= 35 ? 'Chance média: vale recurso ou pedido de diligência' : 'Pouca coisa a apontar';
    return { nota, faixa, ...n };
  }

  // Rascunho de recurso (Lei 14.133 art. 165): fatos (achados), direito (fonte de cada regra) e pedido.
  // dados = { orgao, edital, concorrente, empresa } (o que a pessoa digitou; vazio vira [campo]).
  function textoRecurso(analise, dados = {}) {
    const campo = (v, rotulo) => String(v || '').trim().slice(0, 200) || `[${rotulo}]`;
    const fortes = analise.achados.filter((a) => a.nivel !== 'info');
    const porRegra = new Map();
    for (const a of fortes) (porRegra.get(a.regra) || porRegra.set(a.regra, []).get(a.regra)).push(a);
    const p = [AVISO_RECURSO, '',
      `Ao(À) Agente de Contratação / Comissão de Contratação do(a) ${campo(dados.orgao, 'órgão')}`,
      `Referência: ${campo(dados.edital, 'modalidade e número do edital')}`, '',
      `${campo(dados.empresa, 'nossa empresa')}, por seu representante legal, vem apresentar RECURSO ADMINISTRATIVO contra a aceitação da proposta da empresa ${campo(dados.concorrente, 'empresa concorrente')}, com fundamento no art. 165, I, da Lei 14.133/2021, pelos motivos a seguir.`, '',
      'I. DOS FATOS', ''];
    let k = 0;
    for (const [regra, xs] of porRegra) {
      p.push(`${++k}. ${REGRAS[regra].titulo}`);
      for (const a of xs.slice(0, 25)) p.push(`   - ${a.texto}`);
      if (xs.length > 25) p.push(`   - … e mais ${xs.length - 25} ocorrência(s), listadas no relatório anexo.`);
      p.push('');
    }
    if (!porRegra.size) p.push('O Auditor não encontrou, na planilha enviada, falha que justifique recurso. Confira os documentos de habilitação e as declarações do concorrente.', '');
    p.push('II. DO DIREITO', '');
    k = 0;
    for (const regra of porRegra.keys()) p.push(`${++k}. ${REGRAS[regra].titulo}: ${REGRAS[regra].explica} (Fonte: ${REGRAS[regra].fonte}.)`, '');
    p.push('A proposta deve observar o edital e a Lei 14.133/2021, que manda desclassificar a proposta que contiver vícios insanáveis, não obedecer às especificações do edital, apresentar preços inexequíveis ou acima do orçamento estimado, ou desatender outras exigências do edital (art. 59, I a V).', '',
      'III. DO PEDIDO', '',
      'Diante do exposto, requer:',
      `a) o recebimento e o provimento deste recurso, com a desclassificação da proposta da empresa ${campo(dados.concorrente, 'empresa concorrente')};`,
      'b) subsidiariamente, a realização de diligência para que o concorrente demonstre a exequibilidade e a regularidade da planilha, sem alteração do preço global (art. 59, §2º, e art. 64 da Lei 14.133/2021);',
      'c) a vista e a cópia da proposta, das composições de custo unitário, do BDI, dos encargos e do cronograma apresentados pelo concorrente.', '',
      'Prazo: o recurso é de 3 dias úteis contados da intimação ou da lavratura da ata (art. 165, I), e no pregão e na concorrência eletrônica a intenção de recorrer deve ser manifestada logo após o resultado (art. 165, §1º). Confira o prazo no edital.', '',
      '[local], [data]', '', '_______________________________', 'Representante legal');
    return p.join('\n');
  }

  // Relatório para baixar (.xlsx): achados e o rascunho, uma linha por parágrafo.
  const NIVEL = { erro: 'Pode desclassificar', atencao: 'Atenção', info: 'Para saber' };
  function abasRelatorio(analise, dados = {}) {
    const pl = analise.placar;
    return [
      { nome: 'Achados', linhas: [['ANÁLISE DA PROPOSTA DO CONCORRENTE'], [AVISO_RECURSO], [],
        ['Nota de risco (0 a 100)', pl.nota, pl.faixa], ['Pode desclassificar', pl.erro], ['Atenção', pl.atencao], ['Para saber', pl.info],
        ['Preço do concorrente', analise.precoFinal ?? ''], ['Orçamento de referência', analise.referencia ?? ''], [],
        ['Nível', 'Item', 'O que é', 'Detalhe', 'Fonte', 'Link'],
        ...analise.achados.map((a) => [NIVEL[a.nivel], a.item || '', a.titulo, a.texto, a.fonte, a.link || ''])] },
      { nome: 'Rascunho de recurso', linhas: textoRecurso(analise, dados).split('\n').map((t) => [t]) },
    ];
  }

  // Relatório imprimível (.html: abre no navegador ou no Word, e dá para salvar em PDF).
  function relatorioHtml(analise, dados = {}) {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pl = analise.placar;
    const linhas = analise.achados.map((a) => `<tr><td>${esc(NIVEL[a.nivel])}</td><td>${esc(a.item || '')}</td><td><b>${esc(a.titulo)}</b><br>${esc(a.texto)}</td><td>${esc(a.fonte)}</td></tr>`).join('');
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Análise da proposta do concorrente</title>
<style>body{font:14px/1.5 Arial,sans-serif;margin:24px;color:#111}h1{font-size:20px}h2{font-size:16px;margin-top:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;vertical-align:top;text-align:left}.aviso{border:2px solid #b54708;background:#fffaeb;padding:10px}pre{white-space:pre-wrap;font:14px/1.6 Arial,sans-serif}</style></head><body>
<h1>Análise da proposta do concorrente${dados.concorrente ? `: ${esc(dados.concorrente)}` : ''}</h1>
<p class="aviso">${esc(AVISO_RECURSO)}</p>
<p><b>Nota de risco: ${pl.nota} de 100</b> (${esc(pl.faixa)}) · ${pl.erro} que podem desclassificar · ${pl.atencao} de atenção · ${pl.info} para saber${analise.precoFinal ? ` · preço do concorrente ${esc(reais(analise.precoFinal))}` : ''}${analise.referencia ? ` · orçamento ${esc(reais(analise.referencia))}` : ''}</p>
<h2>Achados</h2><table><thead><tr><th>Nível</th><th>Item</th><th>O que é</th><th>Fonte</th></tr></thead><tbody>${linhas}</tbody></table>
<h2>Rascunho de recurso</h2><pre>${esc(textoRecurso(analise, dados))}</pre></body></html>`;
  }

  const api = { lerProposta, analisarConcorrente, placar, textoRecurso, abasRelatorio, relatorioHtml, AVISO_RECURSO, paraTerceiro };
  if (noNode) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { concorrente: api });
})();
