/* global window, module -- regras puras (sem DOM): rodam no navegador (mao-de-obra.html) e nos testes do Node */
// Planilha de Custos e Formação de Preços de serviços com dedicação exclusiva de mão de obra (limpeza, portaria,
// vigilância, copeiragem, recepção, motorista, manutenção).
// Estrutura e fórmulas: Anexo VII-D da IN SEGES/MP nº 05/2017, na redação da IN SEGES/MP nº 07/2018 (Módulos 1 a 6).
// Percentuais de partida: Cadernos de Logística / Cadernos Técnicos de Serviços Continuados da SEGES (gov.br/compras)
// e planilhas de órgãos federais que seguem esse modelo (ex.: INSS, SR Nordeste, pregão 2026: 2.1 = 8,33% + 2,78%;
// 2.2 = 36,80% com RAT 3%; Módulo 3: 0,42% / 1,94% / 3,44%; Módulo 4.1: 8,33% / 0,56% / 0,05% / 0,02% / 0,03%).
// Todos são editáveis: o que vale é a convenção coletiva (CCT) da categoria e o edital.
//
// Dinheiro em centavos inteiros. Cada linha da planilha é arredondada para o centavo (meio para cima), como no
// modelo oficial; os totais são a soma das linhas já arredondadas. Percentuais aceitam até 4 casas decimais.
(function (raiz) {
  'use strict';

  // Divisão inteira com arredondamento meio para cima (valores >= 0), em BigInt para não perder precisão.
  function divArred(n, d) {
    const N = BigInt(n); const D = BigInt(d);
    return Number((2n * N + D) / (2n * D));
  }
  const U = 1000000; // 100% em décimos de milésimo de ponto percentual
  const pu = (p) => Math.round(Number(p) * 10000); // 8,33 -> 83300
  const pct = (centavos, p) => divArred(centavos * pu(p), U);
  const cent = (reais) => Math.round(Number(reais) * 100);

  const SERVICOS = {
    limpeza: 'Limpeza e conservação', portaria: 'Portaria', vigilancia: 'Vigilância', copeiragem: 'Copeiragem',
    recepcao: 'Recepção', motorista: 'Motorista', manutencao: 'Manutenção predial',
  };
  // dias = dias trabalhados no mês (vale-transporte, alimentação e plantões); 12x36: 365 / 2 / 12 = 15,21 plantões.
  const ESCALAS = {
    '44h': { nome: '44 horas semanais', empregados: 1, dias: 22, noturno: false },
    '12x36-diurno': { nome: '12x36 diurna', empregados: 2, dias: 15.21, noturno: false },
    '12x36-noturno': { nome: '12x36 noturna', empregados: 2, dias: 15.21, noturno: true },
  };
  const SALARIO_MINIMO_2026 = 1621; // Decreto do salário mínimo de 2026; confira o valor vigente.

  const PADROES = {
    servico: 'limpeza', funcao: 'Servente de limpeza', escala: '44h', regime: 'presumido',
    // Módulo 1
    salarioBase: 0, salarioMinimo: SALARIO_MINIMO_2026, periculosidadePct: 0, insalubridadePct: 0, insalubridadeBase: 'minimo',
    divisorHoras: 220, horasNoturnasPlantao: 7, adicionalNoturnoPct: 20, dsrPct: 0, outrosRemuneracao: 0,
    // Submódulo 2.1: 13º = 1/12; adicional de férias = 1/3 × 1/12. As férias em si estão no Módulo 4 (substituto).
    decimoPct: 8.33, adicionalFeriasPct: 2.78,
    // Submódulo 2.2 (incide sobre Módulo 1 + Submódulo 2.1)
    inss: 20, salarioEducacao: 2.5, rat: 3, fap: 1, sesc: 1.5, senac: 1, sebrae: 0.6, incra: 0.2, fgts: 8,
    // Submódulo 2.3
    diasMes: 22, vtPassagensDia: 2, vtValorPassagem: 0, vtDescontoPct: 6, vaValorDia: 0, vaDescontoPct: 0,
    assistenciaMedica: 0, seguroVida: 0, outrosBeneficios: 0,
    // Módulo 3 (sobre o Módulo 1). Indenizado: 1/12 × 5% dos empregados; trabalhado: (7/30)/12;
    // multa sobre o trabalhado: 8% × 40% × 90% × (1 + 1/12 + 1/12 + 1/36).
    apIndenizadoPct: 0.42, apTrabalhadoPct: 1.94, multaFgtsPct: 3.44, multaFgtsAliquota: 40,
    // Módulo 4.1 (sobre o Módulo 1), com incidência do Submódulo 2.2
    feriasSubstPct: 8.33, ausenciasLegaisPct: 0.56, paternidadePct: 0.05, acidentePct: 0.02, maternidadePct: 0.03, outrasAusenciasPct: 0,
    // Módulo 5 (R$ por empregado por mês)
    uniformes: 0, materiais: 0, equipamentos: 0, outrosInsumos: 0,
    // Módulo 6
    ciPct: 3, lucroPct: 6, pisPct: 0.65, cofinsPct: 3, issPct: 5, simplesPct: 0,
    // Quantidades
    empregadosPorPosto: 1, postos: 1, meses: 12,
  };
  const TERCEIROS = ['salarioEducacao', 'sesc', 'senac', 'sebrae', 'incra'];

  // Valores de partida dos tributos por regime. Simples Nacional (Anexo IV): o DAS não inclui a contribuição
  // patronal (INSS 20% + RAT continuam na folha, LC 123/2006 art. 18, § 5º-C e art. 13, VI), mas a empresa fica
  // dispensada das contribuições a terceiros (Salário-Educação, Sistema S, SEBRAE, INCRA; art. 13, § 3º).
  // PIS, COFINS e ISS vão dentro da alíquota efetiva do DAS (o ISS só é separado se o município tiver valor fixo).
  function padroesRegime(regime) {
    if (regime === 'real') return { pisPct: 1.65, cofinsPct: 7.6, issPct: 5, simplesPct: 0, salarioEducacao: 2.5, sesc: 1.5, senac: 1, sebrae: 0.6, incra: 0.2 };
    if (regime === 'simples') return { pisPct: 0, cofinsPct: 0, issPct: 0, simplesPct: 4.5, salarioEducacao: 0, sesc: 0, senac: 0, sebrae: 0, incra: 0 };
    return { pisPct: 0.65, cofinsPct: 3, issPct: 5, simplesPct: 0, salarioEducacao: 2.5, sesc: 1.5, senac: 1, sebrae: 0.6, incra: 0.2 };
  }

  // Cessão de mão de obra é vedada no Simples (LC 123/2006, art. 17, XII), salvo as atividades do Anexo IV
  // (art. 18, § 5º-C: construção, vigilância, limpeza ou conservação).
  function regraSimples(servico) {
    if (servico === 'limpeza' || servico === 'vigilancia') return 'permitido';
    if (servico === 'manutencao') return 'atencao';
    return 'vedado';
  }

  // "1.800,00" | "1800,5" | "8,33" | 1800 -> número; vazio -> 0; texto inválido -> NaN.
  function lerNumero(v) {
    if (typeof v === 'number') return v;
    const t = String(v ?? '').trim().replace(/\s|R\$|%/g, '');
    if (!t) return 0;
    const n = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : NaN;
  }
  // 518875 -> "5.188,75"
  function fmtCent(c) {
    const neg = c < 0; const a = Math.abs(c);
    const inteiro = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${neg ? '-' : ''}${inteiro},${String(a % 100).padStart(2, '0')}`;
  }
  const fmtPct = (p) => `${String(Math.round(Number(p) * 10000) / 10000).replace('.', ',')}%`;

  const NUMERICOS = Object.keys(PADROES).filter((k) => typeof PADROES[k] === 'number');

  function calcular(entrada) {
    const e = { ...PADROES, ...entrada };
    const invalidos = NUMERICOS.filter((k) => { const n = lerNumero(e[k]); e[k] = n; return !Number.isFinite(n) || n < 0; });
    if (invalidos.length) return { erro: 'Valor inválido em: ' + invalidos.join(', ') + '.' };
    if (!e.salarioBase) return { erro: 'Informe o salário-base da categoria (CCT).' };
    if (!e.divisorHoras) return { erro: 'O divisor de horas deve ser maior que zero.' };
    const escala = ESCALAS[e.escala];
    if (!escala) return { erro: 'Escala desconhecida.' };
    const avisos = [];
    const L = (item, descricao, valor, p) => ({ item, descricao, valor, pct: p === undefined ? null : p });
    const soma = (linhas) => linhas.reduce((s, l) => s + l.valor, 0);

    // Módulo 1 — Composição da remuneração
    const sal = cent(e.salarioBase);
    const peric = pct(sal, e.periculosidadePct);
    const baseInsal = e.insalubridadeBase === 'salario' ? sal : cent(e.salarioMinimo);
    const insal = pct(baseInsal, e.insalubridadePct);
    if (e.periculosidadePct > 0 && e.insalubridadePct > 0) avisos.push({ tipo: 'atencao', texto: 'Periculosidade e insalubridade não se acumulam: o empregado escolhe uma (CLT, art. 193, § 2º). Confira a CCT.' });
    if (e.insalubridadePct > 0 && e.insalubridadeBase === 'minimo' && !e.salarioMinimo) return { erro: 'Informe o salário mínimo vigente (base da insalubridade).' };
    // Hora noturna: 22h às 5h, 52min30s (CLT, art. 73). Base da hora = salário + periculosidade + insalubridade
    // (OJ 259 e OJ 97 da SDI-1/TST). Horas noturnas no mês = horas por plantão × plantões.
    let an = 0; let hnr = 0;
    if (escala.noturno) {
      const baseHora = sal + peric + insal;
      const hnU = Math.round(e.horasNoturnasPlantao * e.diasMes * 100);
      const divU = Math.round(e.divisorHoras * 100) * U;
      an = divArred(BigInt(baseHora) * BigInt(pu(e.adicionalNoturnoPct)) * BigInt(hnU), divU);
      // 60 / 52,5 − 1 = 1/7: cada 7 horas de relógio viram 8 horas noturnas, pagas com o adicional.
      hnr = divArred(BigInt(baseHora) * BigInt(U + pu(e.adicionalNoturnoPct)) * BigInt(hnU), BigInt(divU) * 7n);
    }
    const dsr = pct(an + hnr, e.dsrPct);
    const m1 = [L('A', 'Salário-base', sal), L('B', 'Adicional de periculosidade', peric, e.periculosidadePct),
      L('C', `Adicional de insalubridade (sobre o ${e.insalubridadeBase === 'salario' ? 'salário-base' : 'salário mínimo'})`, insal, e.insalubridadePct),
      L('D', 'Adicional noturno', an, escala.noturno ? e.adicionalNoturnoPct : 0), L('E', 'Adicional de hora noturna reduzida', hnr),
      L('F', 'DSR sobre adicionais noturnos', dsr, e.dsrPct), L('G', 'Outros (especificar)', cent(e.outrosRemuneracao))];
    const M1 = soma(m1);

    // Submódulo 2.1 — 13º salário e adicional de férias (sobre o Módulo 1)
    const m21 = [L('A', '13º (décimo terceiro) salário', pct(M1, e.decimoPct), e.decimoPct),
      L('B', 'Adicional de férias (1/3)', pct(M1, e.adicionalFeriasPct), e.adicionalFeriasPct)];
    const S21 = soma(m21);

    // Submódulo 2.2 — GPS, FGTS e outras contribuições (sobre Módulo 1 + Submódulo 2.1)
    const rat = Math.round(e.rat * e.fap * 10000) / 10000;
    const taxas22 = [['A', 'INSS', e.inss], ['B', 'Salário-Educação', e.salarioEducacao], ['C', `SAT/RAT ajustado (RAT ${fmtPct(e.rat)} × FAP ${String(e.fap).replace('.', ',')})`, rat],
      ['D', 'SESC ou SESI', e.sesc], ['E', 'SENAC ou SENAI', e.senac], ['F', 'SEBRAE', e.sebrae], ['G', 'INCRA', e.incra], ['H', 'FGTS', e.fgts]];
    const total22Pct = Math.round(taxas22.reduce((s, t) => s + t[2], 0) * 10000) / 10000;
    const base22 = M1 + S21;
    const m22 = taxas22.map(([i, d, p]) => L(i, d, pct(base22, p), p));
    const S22 = soma(m22);

    // Submódulo 2.3 — Benefícios mensais e diários. VT: custo − 6% do salário-base (Lei 7.418/1985), nunca negativo.
    const vtCusto = divArred(cent(e.vtValorPassagem) * Math.round(e.vtPassagensDia * e.diasMes * 10000), 10000);
    const vt = Math.max(0, vtCusto - pct(sal, e.vtDescontoPct));
    const vaCusto = divArred(cent(e.vaValorDia) * Math.round(e.diasMes * 10000), 10000);
    const va = vaCusto - pct(vaCusto, Math.min(100, e.vaDescontoPct));
    const m23 = [L('A', `Transporte (custo ${fmtCent(vtCusto)} menos ${fmtPct(e.vtDescontoPct)} do salário-base)`, vt),
      L('B', 'Auxílio-refeição/alimentação', va), L('C', 'Assistência médica e odontológica', cent(e.assistenciaMedica)),
      L('D', 'Seguro de vida, invalidez e funeral', cent(e.seguroVida)), L('E', 'Outros (especificar)', cent(e.outrosBeneficios))];
    const S23 = soma(m23);
    const M2 = S21 + S22 + S23;

    // Módulo 3 — Provisão para rescisão (sobre o Módulo 1)
    const apI = pct(M1, e.apIndenizadoPct);
    const apT = pct(M1, e.apTrabalhadoPct);
    const m3 = [L('A', 'Aviso prévio indenizado', apI, e.apIndenizadoPct), L('B', 'Incidência do FGTS sobre o aviso prévio indenizado', pct(apI, e.fgts), e.fgts),
      L('C', 'Multa do FGTS sobre o aviso prévio indenizado', pct(apI, e.fgts * e.multaFgtsAliquota / 100)),
      L('D', 'Aviso prévio trabalhado', apT, e.apTrabalhadoPct), L('E', 'Incidência do Submódulo 2.2 sobre o aviso prévio trabalhado', pct(apT, total22Pct), total22Pct),
      L('F', 'Multa do FGTS sobre o aviso prévio trabalhado', pct(M1, e.multaFgtsPct), e.multaFgtsPct)];
    const M3 = soma(m3);

    // Módulo 4 — Custo de reposição do profissional ausente (sobre o Módulo 1) + incidência do Submódulo 2.2
    const m41 = [['A', 'Substituto na cobertura de férias', e.feriasSubstPct], ['B', 'Substituto na cobertura de ausências legais', e.ausenciasLegaisPct],
      ['C', 'Substituto na cobertura de licença-paternidade', e.paternidadePct], ['D', 'Substituto na cobertura de ausência por acidente de trabalho', e.acidentePct],
      ['E', 'Substituto na cobertura de afastamento maternidade', e.maternidadePct], ['F', 'Substituto na cobertura de outras ausências', e.outrasAusenciasPct]]
      .map(([i, d, p]) => L(i, d, pct(M1, p), p));
    const S41 = soma(m41);
    const m4 = m41.concat(L('G', 'Incidência do Submódulo 2.2 sobre o Módulo 4', pct(S41, total22Pct), total22Pct));
    const M4 = soma(m4);

    // Módulo 5 — Insumos diversos
    const m5 = [L('A', 'Uniformes', cent(e.uniformes)), L('B', 'Materiais', cent(e.materiais)), L('C', 'Equipamentos', cent(e.equipamentos)), L('D', 'Outros (especificar)', cent(e.outrosInsumos))];
    const M5 = soma(m5);

    // Módulo 6 — Custos indiretos, lucro e tributos. Tributos "por dentro": calculados sobre o faturamento,
    // Preço = (M1..M5 + CI + Lucro) / (1 − T), e cada tributo = Preço × alíquota.
    const custo = M1 + M2 + M3 + M4 + M5;
    const ci = pct(custo, e.ciPct);
    const lucro = pct(custo + ci, e.lucroPct);
    const antes = custo + ci + lucro;
    const simples = e.regime === 'simples';
    const tributos = simples
      ? [['C.1', 'Simples Nacional (alíquota efetiva do DAS, inclui PIS, COFINS e ISS)', e.simplesPct], ['C.2', 'ISS fora do DAS (só se houver)', e.issPct]]
      : [['C.1', 'PIS', e.pisPct], ['C.2', 'COFINS', e.cofinsPct], ['C.3', 'ISS', e.issPct]];
    const T = tributos.reduce((s, t) => s + pu(t[2]), 0);
    if (T >= U) return { erro: 'A soma dos tributos deve ser menor que 100%.' };
    const linhasTrib = tributos.map(([i, d, p]) => L(i, d, divArred(BigInt(antes) * BigInt(pu(p)), U - T), p));
    const m6 = [L('A', 'Custos indiretos', ci, e.ciPct), L('B', 'Lucro', lucro, e.lucroPct)].concat(linhasTrib);
    const M6 = soma(m6);

    if (simples) {
      const r = regraSimples(e.servico);
      if (r === 'vedado') avisos.push({ tipo: 'erro', texto: `${SERVICOS[e.servico] || 'Este serviço'} é cessão de mão de obra: empresa do Simples Nacional não pode prestar esse serviço pelo Simples (LC 123/2006, art. 17, XII). Só limpeza, conservação e vigilância (Anexo IV) são permitidas. Calcule como Lucro Presumido ou Real.` });
      if (r === 'atencao') avisos.push({ tipo: 'atencao', texto: 'Manutenção só fica no Simples (Anexo IV) se for conservação predial ou obra (LC 123/2006, art. 18, § 5º-C). Confira o enquadramento com o contador.' });
      if (TERCEIROS.some((k) => e[k] > 0)) avisos.push({ tipo: 'atencao', texto: 'No Simples Nacional a empresa não recolhe Salário-Educação, SESC/SESI, SENAC/SENAI, SEBRAE e INCRA (LC 123/2006, art. 13, § 3º). Zere esses itens no Submódulo 2.2.' });
      avisos.push({ tipo: 'info', texto: 'Simples Nacional, Anexo IV: o INSS patronal (20%) e o RAT não estão no DAS e continuam no Submódulo 2.2; PIS, COFINS e ISS estão dentro da alíquota efetiva do DAS.' });
    }
    if (e.regime === 'real') avisos.push({ tipo: 'info', texto: 'Lucro Real: PIS 1,65% e COFINS 7,60% são não cumulativos. Se a empresa tem créditos, informe a alíquota efetiva média (o edital costuma pedir a comprovação).' });

    const porEmpregado = M1 + M2 + M3 + M4 + M5 + M6;
    const empregados = e.empregadosPorPosto;
    const porPosto = divArred(porEmpregado * Math.round(empregados * 100), 100);
    const mensal = divArred(porPosto * Math.round(e.postos * 100), 100);
    const contrato = divArred(mensal * Math.round(e.meses * 100), 100);
    return {
      modulos: [
        { id: '1', titulo: 'Módulo 1 – Composição da remuneração', linhas: m1, total: M1 },
        { id: '2.1', titulo: 'Submódulo 2.1 – 13º (décimo terceiro) salário e adicional de férias', linhas: m21, total: S21 },
        { id: '2.2', titulo: `Submódulo 2.2 – Encargos previdenciários (GPS), FGTS e outras contribuições (${fmtPct(total22Pct)})`, linhas: m22, total: S22 },
        { id: '2.3', titulo: 'Submódulo 2.3 – Benefícios mensais e diários', linhas: m23, total: S23 },
        { id: '3', titulo: 'Módulo 3 – Provisão para rescisão', linhas: m3, total: M3 },
        { id: '4', titulo: 'Módulo 4 – Custo de reposição do profissional ausente', linhas: m4, total: M4 },
        { id: '5', titulo: 'Módulo 5 – Insumos diversos', linhas: m5, total: M5 },
        { id: '6', titulo: 'Módulo 6 – Custos indiretos, tributos e lucro', linhas: m6, total: M6 },
      ],
      resumo: [['A', 'Módulo 1 – Composição da remuneração', M1], ['B', 'Módulo 2 – Encargos e benefícios anuais, mensais e diários', M2],
        ['C', 'Módulo 3 – Provisão para rescisão', M3], ['D', 'Módulo 4 – Custo de reposição do profissional ausente', M4],
        ['E', 'Módulo 5 – Insumos diversos', M5], ['F', 'Módulo 6 – Custos indiretos, tributos e lucro', M6]],
      total22Pct, faturamento: porEmpregado, porEmpregado, empregados, porPosto, postos: e.postos, mensal, meses: e.meses, contrato, avisos,
    };
  }

  // CSV no layout do Anexo VII-D: ";" como separador, vírgula decimal e BOM UTF-8 (abre certo no Excel BR).
  function csv(entrada, r) {
    const e = { ...PADROES, ...entrada };
    const q = (s) => { const t = String(s ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const linha = (...c) => c.map(q).join(';');
    const pc = (p) => (p === null || p === undefined ? '' : fmtPct(p));
    const n = (v) => String(v).replace('.', ',');
    const out = [linha('Planilha de Custos e Formação de Preços – Anexo VII-D da IN SEGES/MP nº 05/2017'),
      linha('Serviço', SERVICOS[e.servico] || e.servico), linha('Função', e.funcao), linha('Escala', (ESCALAS[e.escala] || {}).nome || e.escala),
      linha('Regime tributário', { real: 'Lucro Real', presumido: 'Lucro Presumido', simples: 'Simples Nacional' }[e.regime] || e.regime),
      linha('Salário-base (R$)', fmtCent(cent(lerNumero(e.salarioBase)))), '', linha('Item', 'Descrição', 'Percentual', 'Valor (R$)')];
    for (const m of r.modulos) {
      out.push(linha(m.id, m.titulo, '', ''));
      for (const l of m.linhas) out.push(linha(l.item, l.descricao, pc(l.pct), fmtCent(l.valor)));
      out.push(linha('', `Total do ${m.id.includes('.') ? 'Submódulo' : 'Módulo'} ${m.id}`, '', fmtCent(m.total)));
    }
    out.push('', linha('', 'Quadro-resumo do custo por empregado', '', ''));
    for (const [i, d, v] of r.resumo) out.push(linha(i, d, '', fmtCent(v)));
    out.push(linha('', 'Valor total por empregado', '', fmtCent(r.porEmpregado)),
      linha('', `Valor por posto (${n(r.empregados)} empregado(s) por posto)`, '', fmtCent(r.porPosto)),
      linha('', `Valor mensal (${n(r.postos)} posto(s))`, '', fmtCent(r.mensal)),
      linha('', `Valor total do contrato (${n(r.meses)} meses)`, '', fmtCent(r.contrato)));
    return '﻿' + out.join('\r\n') + '\r\n';
  }

  // Rascunho por conta no navegador (cada usuário vê só o seu).
  const chaveRascunho = (uid) => `licitaplena_mao_de_obra_${uid}`;

  const api = { PADROES, ESCALAS, SERVICOS, SALARIO_MINIMO_2026, TERCEIROS, padroesRegime, regraSimples, lerNumero, fmtCent, fmtPct, calcular, csv, chaveRascunho, divArred };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MaoDeObraRegras = api;
})(typeof window !== 'undefined' ? window : globalThis);
