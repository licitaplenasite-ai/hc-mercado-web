/* global module, require */
// Agente "Contador": forma o preço de licitação com os tributos de hoje (DAS, PIS/Cofins, ICMS/ISS, DIFAL) e os da
// Reforma (CBS e IBS por fora), item por item, como um contador faria. Funções puras, só BigInt: dinheiro em centavos,
// percentuais em milésimos de ponto (8,5% = 8500n; 100% = 100000n), igual a precificacao-item.js e reforma-tributaria.js.
// Alíquotas de CBS/IBS por ano vêm SÓ de reforma-tributaria.js (ALIQUOTAS). A conferência com a calculadora oficial e
// a tabela de cClassTrib ficam em netlify/functions/contador.js. Estimativa para formar preço, nunca parecer contábil.
(function (global) {
  'use strict';
  const carregar = (nome, arquivo) => global[nome] || (typeof module !== 'undefined' && module.exports ? require(arquivo) : null);
  const P = () => carregar('LicitaPrecificacao', './precificacao-item.js');
  const RT = () => carregar('LicitaReformaTributaria', './reforma-tributaria.js');
  const CEM = 100000n;
  const AVISO_FIXO = 'Estimativa para formar preço. Confirme com o seu contador.';

  // ---------- Regime pelo CNPJ (dado público da Receita, como vem da BrasilAPI) ----------
  // Presumido e Real só aparecem em "regime_tributario" (declarações de anos passados), e nem sempre: aí pergunta.
  const excluido = (dataExclusao, hoje) => Boolean(dataExclusao) && String(dataExclusao).slice(0, 10) <= hoje;
  function regimePeloCnpj(d, hoje = new Date().toISOString().slice(0, 10)) {
    if (!d || typeof d !== 'object') return { regime: null, pergunta: 'Não consegui ler o CNPJ agora. Qual é o regime da sua empresa?' };
    const cnae = { principal: d.cnae_fiscal ? String(d.cnae_fiscal) : null, descricao: d.cnae_fiscal_descricao || null,
      secundarios: Array.isArray(d.cnaes_secundarios) ? d.cnaes_secundarios.filter((c) => c && c.codigo).map((c) => String(c.codigo)) : [] };
    const base = { cnae, uf: /^[A-Z]{2}$/.test(d.uf || '') ? d.uf : null, municipioIbge: /^\d{7}$/.test(String(d.codigo_municipio_ibge || '')) ? String(d.codigo_municipio_ibge) : null };
    if (d.opcao_pelo_mei === true && !excluido(d.data_exclusao_do_mei, hoje)) return { ...base, regime: 'mei', fonte: `Receita Federal: optante pelo MEI${d.data_opcao_pelo_mei ? ` desde ${d.data_opcao_pelo_mei}` : ''}.` };
    if (d.opcao_pelo_simples === true && !excluido(d.data_exclusao_do_simples, hoje)) return { ...base, regime: 'simples', anexo: anexoSugerido(cnae.principal), fonte: `Receita Federal: optante pelo Simples Nacional${d.data_opcao_pelo_simples ? ` desde ${d.data_opcao_pelo_simples}` : ''}.` };
    const anos = Array.isArray(d.regime_tributario) ? d.regime_tributario.filter((r) => r && r.ano && r.forma_de_tributacao).sort((a, b) => Number(b.ano) - Number(a.ano)) : [];
    const forma = String(anos[0]?.forma_de_tributacao || '').toUpperCase();
    if (/PRESUMIDO/.test(forma)) return { ...base, regime: 'presumido', fonte: `Receita Federal: declarou Lucro Presumido em ${anos[0].ano}. Confirme se continua.` };
    if (/REAL/.test(forma)) return { ...base, regime: 'real', fonte: `Receita Federal: declarou Lucro Real em ${anos[0].ano}. Confirme se continua.` };
    return { ...base, regime: null, pergunta: 'O CNPJ não é do Simples nem MEI. A sua empresa é do Lucro Presumido ou do Lucro Real?' };
  }
  // Anexo do Simples pelo CNAE principal: comércio (divisões 45 a 47) no I, indústria (10 a 33) no II. Serviço depende
  // da atividade e do fator r (LC 123/2006, art. 18): o empresário informa.
  function anexoSugerido(cnae) {
    const div = Number(String(cnae || '').slice(0, 2));
    if (div >= 45 && div <= 47) return 'I';
    if (div >= 10 && div <= 33) return 'II';
    return null;
  }

  // ---------- Simples Nacional: alíquota efetiva (LC 123/2006, Anexos I a V, redação da LC 155/2016) ----------
  // [teto da faixa em reais, alíquota nominal em milésimos, parcela a deduzir em reais]
  const FAIXAS = [180000, 360000, 720000, 1800000, 3600000, 4800000];
  const ANEXOS = {
    I: [[4000, 0], [7300, 5940], [9500, 13860], [10700, 22500], [14300, 87300], [19000, 378000]],
    II: [[4500, 0], [7800, 5940], [10000, 13860], [11200, 22500], [14700, 85500], [30000, 720000]],
    III: [[6000, 0], [11200, 9360], [13500, 17640], [16000, 35640], [21000, 125640], [33000, 648000]],
    IV: [[4500, 0], [9000, 8100], [10200, 12420], [14000, 39780], [22000, 183780], [33000, 828000]],
    V: [[15500, 0], [18000, 4500], [19500, 9900], [20500, 17100], [23000, 62100], [30500, 540000]],
  };
  // (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12, meio para cima, em milésimos de ponto.
  function aliquotaEfetivaSimples(anexo, rbt12Centavos) {
    const tabela = ANEXOS[anexo];
    if (!tabela) return { ok: false, erro: 'Escolha o anexo do Simples (I a V).' };
    if (typeof rbt12Centavos !== 'bigint' || rbt12Centavos <= 0n) return { ok: false, erro: 'Informe o faturamento dos últimos 12 meses (RBT12).' };
    const k = FAIXAS.findIndex((t) => rbt12Centavos <= BigInt(t) * 100n);
    if (k < 0) return { ok: false, erro: 'Faturamento acima de R$ 4,8 milhões em 12 meses fica fora do Simples. Fale com o seu contador.' };
    const [nominal, deduzir] = tabela[k];
    const n = rbt12Centavos * BigInt(nominal) - BigInt(deduzir) * 100n * CEM;
    const aliquota = (2n * n + rbt12Centavos) / (2n * rbt12Centavos);
    // Acima de R$ 3,6 milhões (sublimite) o ICMS e o ISS saem do DAS e são pagos à parte (LC 123/2006, art. 13-A).
    return { ok: true, aliquota, faixa: k + 1, nominal: BigInt(nominal), deduzir: BigInt(deduzir) * 100n,
      sublimite: k === 5, fonte: `LC 123/2006, Anexo ${anexo}, ${k + 1}ª faixa: (RBT12 × ${P().formatarPercentual(BigInt(nominal))} − R$ ${deduzir.toLocaleString('pt-BR')}) ÷ RBT12.` };
  }

  // ---------- ICMS entre estados (Resoluções do Senado 22/1989 e 13/2012) ----------
  const SUL_SUDESTE_SEM_ES = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);
  const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
  function icmsInterestadual(origem, destino, importado = false) {
    if (!UFS.has(origem) || !UFS.has(destino)) return { ok: false, erro: 'Informe a UF de origem e a do órgão (sigla, ex.: AM).' };
    if (origem === destino) return { ok: true, mesmaUf: true, aliquota: 0n };
    if (importado) return { ok: true, aliquota: 4000n, fonte: 'Resolução do Senado 13/2012: 4% para mercadoria importada.' };
    const sete = SUL_SUDESTE_SEM_ES.has(origem) && !SUL_SUDESTE_SEM_ES.has(destino);
    return { ok: true, aliquota: sete ? 7000n : 12000n, fonte: `Resolução do Senado 22/1989: ${sete ? '7%' : '12%'} de ${origem} para ${destino}.` };
  }

  // ---------- Transição (EC 132/2023, disposições transitórias) ----------
  // ICMS e ISS: alíquota cheia até 2028, 90% em 2029, 80% em 2030, 70% em 2031, 60% em 2032, extintos em 2033.
  const FATOR_ICMS_ISS = { 2026: 100n, 2027: 100n, 2028: 100n, 2029: 90n, 2030: 80n, 2031: 70n, 2032: 60n, 2033: 0n };
  // PIS/Cofins: extintos em 2027 (substituídos pela CBS). Padrões em lei, só até 2026.
  const PIS_COFINS = { presumido: { aliquota: 3650n, fonte: 'Lei 9.718/1998: 0,65% + 3% (cumulativo).' },
    real: { aliquota: 9250n, fonte: 'Leis 10.637/2002 e 10.833/2003: 1,65% + 7,6% (não cumulativo; os créditos baixam o efetivo, informe o seu).' } };

  // ---------- Classificação tributária (cClassTrib) da tabela oficial copiada pelo robô ----------
  // tabela: [{ codigo, descricao, nomenclatura, reducaoCbs, reducaoIbsUf, reducaoIbsMun, tipoAliquota, creditoCbs, baseLegal }]
  function rotuloReducao(c) {
    const r = Number(c.reducaoCbs), d = String(c.descricao || '');
    if (r === 100) {
      if (/Anexo I\b|cesta|alimentação humana/i.test(d)) return 'Alíquota zero: cesta básica';
      if (/medicamento/i.test(d)) return 'Alíquota zero: medicamento';
      if (/hortícola|frutas|ovos/i.test(d)) return 'Alíquota zero: hortifrúti e ovos';
      if (/dispositivo/i.test(d)) return 'Alíquota zero: dispositivo médico ou de acessibilidade';
      return 'Alíquota zero';
    }
    if (r === 60) {
      if (/medicamento/i.test(d)) return 'Redução de 60%: medicamento';
      if (/saúde|dispositivo|nutrição/i.test(d)) return 'Redução de 60%: saúde';
      if (/educação/i.test(d)) return 'Redução de 60%: educação';
      if (/alimento|agropecu|insumo/i.test(d)) return 'Redução de 60%: alimentos e agro';
      if (/higiene/i.test(d)) return 'Redução de 60%: higiene pessoal e limpeza';
      return 'Redução de 60%';
    }
    return r > 0 ? `Redução de ${r}%` : 'Sem redução';
  }
  function classificacaoDe(tabela, codigo, tipo) {
    const c = Array.isArray(tabela) ? tabela.find((x) => x && x.codigo === String(codigo || '')) : null;
    if (!c) return { ok: false, erro: 'Classificação tributária (cClassTrib) não está na tabela oficial. Escolha outra.' };
    const nom = String(c.nomenclatura || '');
    if (tipo === 'bem' && !/NCM/.test(nom)) return { ok: false, erro: `A classificação ${c.codigo} é só para serviço (NBS). Escolha uma de mercadoria.` };
    if (tipo === 'servico' && !/NBS/.test(nom)) return { ok: false, erro: `A classificação ${c.codigo} é só para mercadoria (NCM). Escolha uma de serviço.` };
    if (/Sem alíquota|Fixa|Uniforme/.test(c.tipoAliquota || '')) return { ok: false, erro: `A classificação ${c.codigo} (${c.tipoAliquota}) não é de venda comum. Escolha outra ou confirme com o seu contador.` };
    const red = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null; };
    const reducaoCbs = red(c.reducaoCbs), reducaoIbs = red(c.reducaoIbsUf);
    if (reducaoCbs === null || reducaoIbs === null) return { ok: false, erro: 'A tabela oficial trouxe uma redução que não sei ler. Avise o suporte.' };
    return { ok: true, codigo: c.codigo, cst: c.codigo.slice(0, 3), descricao: c.descricao, reducaoCbs, reducaoIbs, rotulo: rotuloReducao(c),
      baseLegal: !c.baseLegal ? 'LC 214/2025' : /\bLC\b|Lei/.test(c.baseLegal) ? c.baseLegal : `LC 214/2025, ${c.baseLegal}`, creditoCbs: c.creditoCbs !== false };
  }

  // ---------- Conta do preço ----------
  const arred = (n, d) => (2n * n + d) / (2n * d); // meio para cima, n >= 0
  const pctDe = (v, pct) => arred(v * pct, CEM);
  const ehBig = (v) => typeof v === 'bigint';
  const CUSTOS_ITEM = ['frete', 'embalagem', 'seguro', 'certidoes', 'deslocamento', 'portal', 'outros'];
  const PCT_PRECO = ['garantia', 'comissao', 'administrativo'];
  // Linha de atenção do "Vale a pena?" quando as premissas não têm margem mínima: 5%, editável na tela.
  const MARGEM_ATENCAO = 5000n;

  // Tributos "por dentro" (sobre o valor da venda) no ano da entrega. Devolve as linhas com a fonte de cada número.
  function tributosPorDentro(e) {
    const linhas = [], faltando = [];
    const fator = FATOR_ICMS_ISS[e.ano];
    const aplicar = (rotulo, pct, fonte, excluiDaBase) => { if (pct > 0n) linhas.push({ rotulo, pct, fonte, excluiDaBase }); };
    const a = e.aliquotas || {};
    if (e.regime === 'mei') return { linhas, faltando, aviso: 'No MEI o imposto é o valor fixo mensal do DAS, não sai por item.' };
    if (e.regime === 'simples') {
      if (!ehBig(a.das)) faltando.push('alíquota efetiva do Simples (DAS)');
      else aplicar('DAS do Simples', a.das, a.dasFonte || 'Informada por você.', false);
      if (e.sublimite && e.tipo === 'bem' && ehBig(a.icms)) aplicar('ICMS fora do DAS (acima do sublimite)', (a.icms * fator) / 100n, 'Informada por você.', true);
      return { linhas, faltando };
    }
    // Regime regular (Presumido ou Real).
    if (e.ano <= 2026) {
      const padrao = PIS_COFINS[e.regime];
      const pis = ehBig(a.pisCofins) ? a.pisCofins : padrao?.aliquota;
      if (ehBig(pis)) aplicar('PIS/Cofins', pis, ehBig(a.pisCofins) ? 'Informada por você.' : padrao.fonte, true);
    }
    if (e.tipo === 'servico') {
      if (!ehBig(a.iss)) faltando.push('ISS do município (2% a 5%, LC 116/2003)');
      else aplicar(`ISS${fator < 100n ? ` (${fator}% da alíquota em ${e.ano})` : ''}`, (a.iss * fator) / 100n, 'Informada por você.', true);
    } else if (fator > 0n) {
      const inter = e.destinoUf && e.origemUf ? icmsInterestadual(e.origemUf, e.destinoUf, e.importado) : null;
      if (inter?.ok && !inter.mesmaUf) {
        aplicar(`ICMS interestadual${fator < 100n ? ` (${fator}% em ${e.ano})` : ''}`, (inter.aliquota * fator) / 100n, inter.fonte, true);
        // DIFAL na venda a órgão (consumidor final não contribuinte) de outra UF: EC 87/2015 e LC 190/2022, base única.
        if (!ehBig(a.icmsDestino)) faltando.push(`alíquota interna de ICMS de ${e.destinoUf} (para o DIFAL)`);
        else if (a.icmsDestino > inter.aliquota) aplicar(`DIFAL para ${e.destinoUf}`, ((a.icmsDestino - inter.aliquota) * fator) / 100n, `EC 87/2015 e LC 190/2022: interna de ${e.destinoUf} (informada) menos a interestadual.`, true);
      } else if (!ehBig(a.icms)) faltando.push('alíquota de ICMS da sua UF');
      else aplicar(`ICMS${fator < 100n ? ` (${fator}% da alíquota em ${e.ano})` : ''}`, (a.icms * fator) / 100n, 'Informada por você.', true);
    }
    if (ehBig(a.outros) && a.outros > 0n) aplicar('IRPJ, CSLL e outros sobre a venda', a.outros, 'Informada por você.', false);
    return { linhas, faltando };
  }

  // CBS e IBS por fora (só regime regular, de 2027 em diante; 2026 é teste compensado com PIS/Cofins).
  function cbsIbs(e) {
    if (e.regime === 'simples' || e.regime === 'mei' || e.ano <= 2026) return { cbs: 0n, ibs: 0n };
    const a = RT().ALIQUOTAS[e.ano];
    const rc = BigInt(100 - (e.classe?.reducaoCbs ?? 0)), ri = BigInt(100 - (e.classe?.reducaoIbs ?? 0));
    return { cbs: (a.cbs * rc) / 100n, ibs: ((a.ibsUf + a.ibsMun) * ri) / 100n, provisoria: a.provisoria };
  }

  // Valor da venda V (com tributos por dentro) → preço final ao órgão = V + CBS + IBS sobre (V − ICMS/ISS/PIS/Cofins).
  function finalDe(v, excluido, t) {
    const base = v - pctDe(v, excluido);
    const cbs = pctDe(base, t.cbs), ibs = pctDe(base, t.ibs);
    return { valor: v, base, cbs, ibs, final: v + cbs + ibs };
  }
  // Inverso: do preço final ao valor da venda, arredondado para baixo (nunca superestima o lucro).
  function valorDoFinal(final, excluido, t) {
    const d = CEM * CEM + (CEM - excluido) * (t.cbs + t.ibs);
    return (final * CEM * CEM) / d;
  }

  // e: { tipo: 'bem'|'servico', regime, ano, quantidade (milésimos), custoUnitarioCentavos, custosItem: { frete, ... } (centavos,
  //      total do item), pctPreco: { garantia, comissao, administrativo } (milésimos), aliquotas, origemUf, destinoUf, importado,
  //      sublimite, classe, dinheiro: { taxaMensal (milésimos), dias }, margem, margemMinima, referencias: { vencedor, mercado } }
  function formarPreco(e) {
    const p = P();
    if (!e || !['bem', 'servico'].includes(e.tipo)) return { ok: false, erro: 'Diga se o item é mercadoria ou serviço.' };
    if (!['simples', 'mei', 'presumido', 'real'].includes(e.regime)) return { ok: false, erro: 'Confirme o regime da empresa.' };
    if (!Object.hasOwn(FATOR_ICMS_ISS, e.ano)) return { ok: false, erro: 'Escolha o ano da entrega (2026 a 2033).' };
    if (!ehBig(e.custoUnitarioCentavos) || e.custoUnitarioCentavos < 0n) return { ok: false, erro: 'Informe o custo do produto por unidade.' };
    if (!ehBig(e.quantidade) || e.quantidade <= 0n) return { ok: false, erro: 'O item precisa de quantidade maior que zero.' };
    const ci = e.custosItem || {}, pp = e.pctPreco || {};
    if (CUSTOS_ITEM.some((k) => ci[k] !== undefined && (!ehBig(ci[k]) || ci[k] < 0n))) return { ok: false, erro: 'Os custos da planilha devem ser valores em reais, zero ou mais.' };
    if (PCT_PRECO.some((k) => pp[k] !== undefined && (!ehBig(pp[k]) || pp[k] < 0n))) return { ok: false, erro: 'Os percentuais da planilha devem ser zero ou mais.' };
    // Custos do item (total) e custo do dinheiro parado sobre tudo o que você gasta antes de receber.
    const produtoTotal = (e.custoUnitarioCentavos * e.quantidade + 999n) / 1000n;
    const extras = CUSTOS_ITEM.reduce((s, k) => s + (ci[k] || 0n), 0n);
    const dm = e.dinheiro || {};
    const dias = Number.isInteger(dm.dias) && dm.dias >= 0 && dm.dias <= 720 ? BigInt(dm.dias) : 0n;
    const dinheiro = ehBig(dm.taxaMensal) && dm.taxaMensal > 0n ? arred((produtoTotal + extras) * dm.taxaMensal * dias, CEM * 30n) : 0n;
    const totalCustos = produtoTotal + extras + dinheiro;
    const custoUnidade = (totalCustos * 1000n + e.quantidade - 1n) / e.quantidade; // para cima: nunca subestima o custo
    // Percentuais sobre o preço.
    const trib = tributosPorDentro(e);
    const outrosPct = PCT_PRECO.map((k) => ({ rotulo: { garantia: 'Garantia contratual', comissao: 'Comissão', administrativo: 'Custo administrativo' }[k], pct: pp[k] || 0n })).filter((l) => l.pct > 0n);
    const dentro = [...trib.linhas, ...outrosPct].reduce((s, l) => s + l.pct, 0n);
    const excluido = trib.linhas.filter((l) => l.excluiDaBase).reduce((s, l) => s + l.pct, 0n);
    if (dentro >= CEM) return { ok: false, erro: 'Tributos e percentuais somam 100% ou mais do preço. Confira os números.' };
    const t = cbsIbs(e);
    const minimo = p.precoComMargem(custoUnidade, dentro);
    if (!minimo.ok) return { ok: false, erro: minimo.erro };
    const margem = ehBig(e.margem) ? e.margem : null;
    const alvo = margem !== null ? p.precoComMargem(custoUnidade, dentro + margem) : null;
    if (alvo && !alvo.ok) return { ok: false, erro: alvo.erro };
    const r = {
      ok: true, ano: e.ano, regime: e.regime, aviso: AVISO_FIXO, faltando: trib.faltando,
      custos: { produtoTotal, extras, dinheiro, totalCustos, custoUnidade }, tributos: trib.linhas, outrosPct, pctDentro: dentro, pctExcluido: excluido, cbsIbs: t,
      minimo: finalDe(minimo.centavos, excluido, t), alvo: alvo ? finalDe(alvo.centavos, excluido, t) : null,
    };
    r.alvoLucro = r.alvo ? lucroNoFinal(r.alvo.final, r) : null;
    const linhaAtencao = ehBig(e.margemMinima) ? e.margemMinima : MARGEM_ATENCAO;
    r.valeAPena = ['vencedor', 'mercado'].map((k) => valeAPena(k, e.referencias?.[k], r, linhaAtencao)).filter(Boolean);
    r.dicas = dicas(e, r, trib);
    return r;
  }

  // Lucro por unidade num preço final qualquer (lance, último vencedor, mercado). Margem sobre o valor da venda sem
  // CBS/IBS (que só passam pelo caixa), na mesma base da margem das premissas (precoComMargem).
  function lucroNoFinal(final, r) {
    const v = valorDoFinal(final, r.pctExcluido, r.cbsIbs);
    const lucro = v - pctDe(v, r.pctDentro) - r.custos.custoUnidade;
    const margem = v > 0n ? (lucro * 10000n) / v : 0n; // centésimos de ponto, para baixo
    return { valor: v, lucro, margem };
  }

  const TITULOS = { vencedor: 'último vencedor deste órgão', mercado: 'preço de mercado (Compras.gov)' };
  function valeAPena(chave, referencia, r, linhaAtencao) {
    if (!ehBig(referencia) || referencia <= 0n) return null;
    const p = P(), l = lucroNoFinal(referencia, r);
    const margemTxt = `${p.formatarDecimal(l.margem, 2)}%`;
    const base = { chave, referencia, lucro: l.lucro, margem: l.margem };
    if (referencia < r.minimo.final) {
      return { ...base, veredito: 'nao', texto: chave === 'vencedor'
        ? `Não vale: o último vencedor ganhou a ${p.formatarReais(referencia)}, abaixo do seu custo de ${p.formatarReais(r.minimo.final)}.`
        : `Não vale: o mercado paga ${p.formatarReais(referencia)}, abaixo do seu custo de ${p.formatarReais(r.minimo.final)}.` };
    }
    // margem em centésimos × 10 = milésimos (mesma escala da margem mínima).
    if (l.margem * 10n < linhaAtencao) return { ...base, veredito: 'apertado', texto: `Apertado: a ${p.formatarReais(referencia)} (${TITULOS[chave]}) sobra margem de ${margemTxt}, lucro de ${p.formatarReais(l.lucro)} por unidade.` };
    return { ...base, veredito: 'vale', texto: `Vale: margem de ${margemTxt} a ${p.formatarReais(referencia)} (${TITULOS[chave]}), lucro de ${p.formatarReais(l.lucro)} por unidade.` };
  }

  function dicas(e, r, trib) {
    const p = P(), d = [];
    d.push(`Preço mínimo para não ter prejuízo: ${p.formatarReais(r.minimo.final)} por unidade${r.minimo.cbs + r.minimo.ibs > 0n ? ` (já com CBS e IBS de ${p.formatarReais(r.minimo.cbs + r.minimo.ibs)})` : ''}.`);
    const c = e.classe;
    if (c && c.reducaoCbs === 100) d.push(`${c.rotulo} (${c.baseLegal}): confira se o NCM do seu fornecedor é o mesmo. Se ele classificar diferente, o imposto muda.`);
    else if (c && c.reducaoCbs > 0) d.push(`Este item tem redução de ${c.reducaoCbs}% (${c.baseLegal}): confira se o NCM do seu fornecedor é o mesmo.`);
    if (e.regime === 'simples') {
      d.push('No Simples, a CBS e o IBS ficam dentro do DAS e você não gera crédito cheio para quem compra. Em venda para o governo isso pesa menos, porque o órgão não usa crédito.');
      d.push('A Reforma deixa o optante do Simples recolher CBS e IBS pelo regime regular. Pense nisso se você compra muito de fornecedores do regime regular e quer usar o crédito. Converse com o seu contador.');
      if (e.sublimite) d.push('Seu faturamento passou de R$ 3,6 milhões: ICMS e ISS saem do DAS e são pagos à parte.');
    }
    if (e.regime === 'presumido' || e.regime === 'real') {
      if (e.ano >= 2027) d.push('Peça ao fornecedor nota com CBS e IBS destacados: no regime regular esse valor vira crédito e o seu custo real cai. Informe o custo sem o imposto que você recupera.');
      if (e.ano >= 2027) d.push('A partir de 2027 o PIS e a Cofins deixam de existir: não coloque no preço.');
      if (e.ano >= 2027) d.push('Em compra pública, a lei prevê um redutor da CBS e do IBS (LC 214/2025, compras governamentais). O percentual de cada ano depende do Senado; quando sair, a conta passa a usar.');
    }
    if (r.cbsIbs.provisoria) d.push(`As alíquotas de CBS e IBS de ${e.ano} ainda são provisórias até o Senado definir.`);
    if (e.ano <= 2026 && e.regime !== 'simples' && e.regime !== 'mei') d.push('Em 2026 a CBS e o IBS são só teste, compensados com PIS/Cofins: não entram como custo.');
    if (FATOR_ICMS_ISS[e.ano] < 100n) d.push(`Entrega em ${e.ano}: ICMS e ISS caem para ${FATOR_ICMS_ISS[e.ano]}% da alíquota (EC 132/2023).`);
    const inter = trib.linhas.find((l) => /interestadual/.test(l.rotulo)), difal = trib.linhas.find((l) => /DIFAL/.test(l.rotulo));
    if (inter) d.push(`Venda para órgão de outra UF: o ICMS interestadual fica com a UF de saída${difal ? ' e a diferença (DIFAL) vai para a UF do órgão. Você recolhe o DIFAL antes de a mercadoria sair' : ''}.`);
    if (e.regime === 'simples' && e.destinoUf && e.origemUf && e.destinoUf !== e.origemUf) d.push('No Simples, o STF suspendeu o DIFAL na venda a não contribuinte de outra UF (ADI 5464). Confirme com o seu contador.');
    if (r.custos.dinheiro > 0n) d.push(`Esperar o pagamento custa ${p.formatarReais(r.custos.dinheiro)} neste item: isso já está no preço.`);
    if (trib.faltando.length) d.push(`Falta informar: ${trib.faltando.join('; ')}. Sem isso o preço fica baixo demais.`);
    if (trib.aviso) d.push(trib.aviso);
    return d;
  }

  // Estado da calculadora oficial em frase simples.
  function fraseStatusOficial(estado, erros = []) {
    const e = Array.isArray(erros) ? erros[0] : null;
    switch (estado) {
      case 'CALCULADO': return 'Conferido na calculadora oficial da Receita.';
      case 'CALCULO_SIMULADO': return 'Conferido na calculadora oficial da Receita, com alíquotas ainda provisórias (simulação).';
      case 'INCONSISTENCIA_ENTRADA': return e?.code === 'REG-011'
        ? 'A calculadora oficial diz que este NCM não está na lista dessa classificação. Confira o NCM com o seu fornecedor ou escolha outra classificação.'
        : 'A calculadora oficial recusou os dados deste item. Confira o NCM (ou NBS) e a classificação.';
      case 'NAO_IMPLEMENTADO': return 'A calculadora oficial ainda não calcula este caso. Usamos a conta local.';
      case 'FALHA_TECNICA': return 'A calculadora oficial teve uma falha. Usamos a conta local.';
      default: return 'Sem conferência na calculadora oficial. Usamos a conta local.';
    }
  }

  const api = { AVISO_FIXO, ANEXOS, FATOR_ICMS_ISS, PIS_COFINS, CUSTOS_ITEM, PCT_PRECO, MARGEM_ATENCAO, regimePeloCnpj, anexoSugerido, aliquotaEfetivaSimples,
    icmsInterestadual, rotuloReducao, classificacaoDe, formarPreco, lucroNoFinal, fraseStatusOficial };
  global.LicitaContador = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
