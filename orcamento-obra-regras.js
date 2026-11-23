/* global module -- dados puros: base de regras do Auditor do Orçamento de obra (navegador e Node) */
// Base de conhecimento do Auditor: regra escrita, com fonte e link, consultada na hora (não é modelo treinado).
// Cada regra diz em português simples o que pode desclassificar ou dar problema e de onde isso vem.
// Textos legais conferidos no Planalto em 22/11/2026; faixas de BDI copiadas do Acórdão TCU 2622/2013 (bdi-calculadora.js).
// Estudo completo e exemplos: _historico/orcamentista/ (fora do repositório).
// Cada regra tem "versao" e "valeDesde". Regra só muda com novidade aprovada pelo dono no vigia de normas
// (orcamento_normas_novidades, tela normas-obra.html): suba a versão, troque o "valeDesde" e anote no commit.
(function () {
  'use strict';
  const LEI = 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm';
  const DECRETO = 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7983.htm';
  const CPRB = 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12546.htm';
  const REONERACAO = 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14973.htm';
  const TCU = 'https://pesquisa.apps.tcu.gov.br/ (buscar "Acórdão 2622/2013 Plenário")';

  const REGRAS = {
    bdi_faixa: { versao: 1, valeDesde: '2026-11-22', titulo: 'BDI fora da faixa do TCU', fonte: 'Acórdão TCU 2622/2013-Plenário, itens 9.1 e 9.2', link: TCU,
      explica: 'O TCU publicou faixas (1º quartil a 3º quartil) de BDI e de cada parcela por tipo de obra. Fora da faixa não desclassifica sozinho, mas o órgão pode pedir justificativa e muitos editais fixam BDI máximo.' },
    iss_faixa: { versao: 1, valeDesde: '2026-11-22', titulo: 'ISS fora de 2% a 5%', fonte: 'Acórdão TCU 2622/2013, item 9.3.2.3; LC 116/2003 art. 8º', link: TCU,
      explica: 'Use a alíquota da lei do município da obra, sempre entre 2% e 5%.' },
    unitario_acima: { versao: 1, valeDesde: '2026-11-22', titulo: 'Preço unitário acima da referência', fonte: 'Lei 14.133/2021 art. 59, III e art. 6º, LVI; Decreto 7.983/2013 art. 2º, IX', link: LEI,
      explica: 'Quando o edital fixa critério de aceitabilidade de preço unitário (a maioria fixa), item acima do preço de referência desclassifica ou obriga a corrigir.' },
    etapa_acima: { versao: 1, valeDesde: '2026-11-22', titulo: 'Etapa do cronograma acima da referência', fonte: 'Decreto 7.983/2013 art. 13, I e parágrafo único', link: DECRETO,
      explica: 'Na empreitada por preço global, o preço global e o de cada etapa do cronograma precisam ficar iguais ou abaixo da referência.' },
    global_acima: { versao: 1, valeDesde: '2026-11-22', titulo: 'Preço global acima do orçamento', fonte: 'Lei 14.133/2021 art. 59, III', link: LEI,
      explica: 'Proposta que fica acima do orçamento estimado é desclassificada.' },
    inexequivel: { versao: 1, valeDesde: '2026-11-22', titulo: 'Abaixo de 75% do orçamento (inexequível)', fonte: 'Lei 14.133/2021 art. 59, §4º; Acórdãos TCU 465/2024, 803/2024 e 3.794/2024', link: 'https://licitacoesecontratos.tcu.gov.br/5-4-1-aceitabilidade-e-desclassificacao-2/',
      explica: 'Em obras e serviços de engenharia, proposta inferior a 75% do valor orçado é considerada inexequível. Exatamente 75% não é. Desde 2024 o TCU trata os 75% como presunção relativa: a empresa tem direito de provar que consegue executar antes de ser desclassificada (cabe recurso se não teve a chance). Mesmo assim, muitos editais desclassificam na hora: no TRE-AM 2/2023 as três propostas acima de 25% caíram automaticamente pelo item 6.7.1 do edital.' },
    zona_de_risco: { versao: 1, valeDesde: '2026-11-22', titulo: 'Desconto na faixa que mais cai', fonte: 'Padrão observado (não é lei): 1.466 concorrências de obra no Compras.gov, 2023 a 2026, e o caso TRE-AM 2/2023', link: 'https://repositorio.dados.gov.br/seges/comprasgov/propostas/',
      explica: 'Propostas recusadas por faixa de desconto: 20% a 24,99% = 24% (30% no Norte); exatamente 25% = 27%; 25,01% a 30% = 40,5% (54% no Norte); acima de 30% = 48,6% (66% no Norte). Desconto mediano do vencedor: 18,4% no Brasil, 17,4% no AM. A maioria das recusas (74%) é por planilha, documento ou habilitação, não por preço.' },
    cpu_incompleta: { versao: 1, valeDesde: '2026-11-22', titulo: 'CPU incompleta', fonte: 'Decreto 7.983/2013 art. 2º, II; edital (ex.: TRE-AM 2/2023, PB 8.4.2); recusa confirmada no chat da sessão', link: DECRETO,
      explica: 'O edital pede a composição de custo unitário de todos os itens. No TRE-AM 2/2023 uma proposta com 24,99% de desconto foi recusada porque a CPU não tinha a composição de alguns preços.' },
    checklist_envio: { versao: 1, valeDesde: '2026-11-22', titulo: 'Antes da disputa', fonte: 'Edital (prazo de envio da proposta ajustada); Lei 14.133/2021 art. 63; recusas confirmadas no chat do TRE-AM 2/2023', link: LEI,
      explica: 'O prazo para mandar a proposta ajustada costuma ser de 2 horas. No TRE-AM uma empresa com 25% caiu por não enviar; outra caiu porque a declaração de vistoria não estava assinada pelo responsável técnico.' },
    bdi_zerado: { versao: 1, valeDesde: '2026-11-22', titulo: 'BDI zerado', fonte: 'Decreto 7.983/2013 art. 9º; Lei 14.133/2021 art. 23, §2º', link: DECRETO,
      explica: 'Preço de obra sem BDI deixa de fora administração central, tributos, risco e lucro: fica inexequível ou não é o preço que a empresa pode cumprir. Ferramenta de mercado já deixou o BDI cair para 0% sem avisar.' },
    cronograma: { versao: 1, valeDesde: '2026-11-22', titulo: 'Cronograma que não fecha em 100%', fonte: 'Decreto 7.983/2013 art. 13 (etapas do cronograma); edital', link: DECRETO,
      explica: 'Cada etapa tem de somar 100% nos meses e o cronograma tem de fechar com o total da planilha. Cronograma com 120% numa etapa é recusado.' },
    propria_vs_referencia: { versao: 1, valeDesde: '2026-11-22', titulo: 'Composição própria longe da referência', fonte: 'Lei 14.133/2021 art. 23, §2º, I (SINAPI primeiro) e art. 59, §4º', link: LEI,
      explica: 'Antes de criar composição própria, procure no SINAPI e nas tabelas. Se existe serviço parecido, o preço próprio muito abaixo (ex.: 10 vezes) é inexequível, e muito acima é sobrepreço.' },
    lei_13303: { versao: 1, valeDesde: '2026-11-22', titulo: 'Estatal (Lei 13.303/2016): outra regra de inexequível', fonte: 'Lei 13.303/2016, art. 56; edital (ex.: Correios, item 6.15.1)', link: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2016/lei/l13303.htm',
      explica: 'Em estatal (Correios, Petrobras, bancos públicos) a regra dos 75% da Lei 14.133 não vale: o edital costuma presumir inexequível abaixo de 70% do menor valor entre a média das propostas acima de 50% do máximo e o próprio máximo. Muitas vezes o orçamento é sigiloso.' },
    codigo_repetido: { versao: 1, valeDesde: '2026-11-22', titulo: 'Mesmo código para itens diferentes', fonte: 'Lei 14.133/2021 art. 23, §2º (cada preço com sua fonte)', link: LEI,
      explica: 'Dois itens diferentes com o mesmo código da mesma tabela: um deles fica sem fonte de preço. Pode vir errado do modelo do órgão; anote a fonte certa ou peça esclarecimento.' },
    bdi_diferenciado: { versao: 1, valeDesde: '2026-11-22', titulo: 'BDI diferenciado de equipamento', fonte: 'Decreto 7.983/2013 art. 9º, §1º; Súmula TCU 253', link: DECRETO,
      explica: 'Equipamento de valor relevante (módulo, inversor, transformador, gerador, elevador) costuma ter BDI reduzido, separado do BDI dos serviços. Item sem BDI (projeto, ART, taxa) precisa estar explicado.' },
    simples: { versao: 1, valeDesde: '2026-11-22', titulo: 'Simples Nacional com BDI de outro regime', fonte: 'Acórdão TCU 2622/2013, item 9.3.2.5; LC 123/2006, Anexo IV', link: TCU,
      explica: 'Empresa do Simples usa no BDI as alíquotas efetivas do Anexo IV (ISS, PIS, COFINS) e encargos sem as contribuições dispensadas. Copiar o BDI do órgão (PIS 0,65%, COFINS 3%, CPRB) é o erro mais comum de ME; o edital costuma deixar corrigir, mas o Auditor marca.' },
    garantia_adicional: { versao: 1, valeDesde: '2026-11-22', titulo: 'Abaixo de 85%: garantia adicional', fonte: 'Lei 14.133/2021 art. 59, §5º', link: LEI,
      explica: 'Abaixo de 85% do valor orçado, o vencedor precisa dar garantia adicional igual à diferença.' },
    desoneracao: { versao: 1, valeDesde: '2026-11-22', titulo: 'Desoneração incoerente', fonte: 'Lei 12.546/2011 art. 7º (CPRB da construção civil); Acórdão TCU 2622/2013', link: CPRB,
      explica: 'Quem é desonerado tira o INSS de 20% dos encargos sociais e põe a CPRB no BDI. Misturar (CPRB no BDI e encargos não desonerados, ou o contrário) cobra o imposto duas vezes ou nenhuma. Seguir o regime da referência evita preço acima do órgão: no TRE-AM 2/2023 a empresa que usou mão de obra não desonerada contra uma referência desonerada ficou com preços unitários acima e foi recusada.' },
    reoneracao: { versao: 1, valeDesde: '2026-11-22', titulo: 'Reoneração gradual (2025 a 2027)', fonte: 'Lei 14.973/2024 (altera a Lei 12.546/2011)', link: REONERACAO,
      explica: 'De 2025 a 2027 quem fica na CPRB paga parte na receita e parte na folha: 2025 = 80% da CPRB + 5% de INSS na folha; 2026 = 60% + 10%; 2027 = 40% + 15%; 2028 volta aos 20% na folha.' },
    total_nao_fecha: { versao: 1, valeDesde: '2026-11-22', titulo: 'Conta que não fecha', fonte: 'Lei 14.133/2021 art. 59, I e V; regra do edital', link: LEI,
      explica: 'Quantidade × preço unitário tem que dar o total do item; a soma dos itens, o total da etapa; e a soma das etapas, o global.' },
    arredondamento: { versao: 1, valeDesde: '2026-11-22', titulo: 'Arredondamento', fonte: 'Regra do edital (a maioria pede 2 casas, truncando); observado nos editais do piloto', link: '',
      explica: 'Preço com mais de 2 casas ou arredondado do jeito diferente do edital gera diferença de centavos que o sistema do órgão pode recusar.' },
    item_faltando: { versao: 1, valeDesde: '2026-11-22', titulo: 'Item faltando ou quantidade mudada', fonte: 'Lei 14.133/2021 art. 59, II e V', link: LEI,
      explica: 'A planilha da proposta tem que ter todos os itens do edital, com a mesma unidade e quantidade.' },
    desconto_so_no_global: { versao: 1, valeDesde: '2026-11-22', titulo: 'Desconto só no total', fonte: 'Lei 14.133/2021 art. 56, §5º', link: LEI,
      explica: 'O vencedor tem que reapresentar as planilhas (custos unitários, BDI e encargos) adequadas ao valor final. Desconto só no global obriga a refazer tudo depois, com prazo curto.' },
    sem_referencia: { versao: 1, valeDesde: '2026-11-22', titulo: 'Item sem preço de referência', fonte: 'Lei 14.133/2021 art. 23, §2º; Decreto 7.983/2013 art. 6º', link: LEI,
      explica: 'Sem SINAPI/SICRO, vale tabela oficial, mídia especializada, contratação similar ou composição própria com cotações. Guarde a memória.' },
    cotacao: { versao: 1, valeDesde: '2026-11-22', titulo: 'Composição própria: cotações e CPU', fonte: 'Lei 14.133/2021 art. 23, §2º; IN SEGES/ME 65/2021 art. 6º (mínimo de 3 preços)', link: LEI,
      explica: 'Composição própria precisa de pelo menos 3 cotações parecidas entre si, com data e fornecedor.' },
    jogo_de_planilha: { versao: 1, valeDesde: '2026-11-22', titulo: 'Risco de jogo de planilha', fonte: 'Lei 14.133/2021 art. 128 e art. 6º, LVII, c; Decreto 7.983/2013 art. 14', link: LEI,
      explica: 'Descontos muito desiguais entre itens (alguns no teto, outros muito baixos) parecem jogo de planilha: o desconto não pode ser reduzido em aditivo e o órgão pode glosar.' },
    data_base: { versao: 1, valeDesde: '2026-11-22', titulo: 'Data-base diferente', fonte: 'Lei 14.133/2021 art. 23 (valor compatível com o mercado)', link: LEI,
      explica: 'Preço tirado de um mês de referência diferente do pedido no edital não é comparável com o orçamento do órgão.' },
    encargos: { versao: 1, valeDesde: '2026-11-22', titulo: 'Encargos sociais', fonte: 'Metodologia SINAPI de encargos sociais (CAIXA); Lei 12.546/2011', link: 'https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/',
      explica: 'O total dos encargos é A + B + C + D. Desonerado: grupo A sem os 20% de INSS (na transição de 2025 a 2027, com 5%, 10% ou 15%). A tabela tem de trazer marcada a opção "desonerado" ou "não desonerado": no TRE-AM 2/2023 uma proposta caiu por não ter esse campo.' },
  };

  // Regras novas da fase 2 (vigia de normas e bases por data-base).
  Object.assign(REGRAS, {
    encargos_da_base: { versao: 1, valeDesde: '2026-11-22', titulo: 'Encargos diferentes da tabela do SINAPI da UF e do ano', fonte: 'SINAPI, Cálculos e Parâmetros, 8ª ed. (vigência 01/2026); Lei 14.973/2024; REGRAS-AUDITOR E01 e E06', link: 'https://www.caixa.gov.br/Downloads/sinapi-metodologia/Livro_SINAPI_Calculos_Parametros.pdf',
      explica: 'O encargo social muda por UF, regime (desonerado ou não), tipo (horista ou mensalista) e ANO da data-base. No AM, o horista desonerado era 83,73% em 2023 e é 98,35% em 2026: copiar a tabela de um edital antigo erra em mais de 14 pontos. A CAIXA vai mudar de novo em jan/2027 (redução da jornada).' },
    arredondamento_da_base: { versao: 1, valeDesde: '2026-11-22', titulo: 'Arredondamento da base diferente do escolhido', fonte: 'Manual de Custos do DNIT (SICRO), vol. 1, 3.7 (NBR 5891); TCU 2026, Engenharia de Custos, 5.1.40', link: 'https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro',
      explica: 'O SICRO arredonda (NBR 5891); órgãos que usam o SINAPI costumam truncar em 2 casas. Vale o que o edital mandar: refaça 3 composições e 3 totais da referência e veja se fecham truncando ou arredondando.' },
  });

  // Regras do modo "Analisar concorrente" (23/11/2026): fiscalizar a proposta de terceiro. Ids da lista única entre
  // parênteses (REGRAS-AUDITOR.md); o catálogo continua sem chave para elas porque o NOSSO orçamento não as confere sozinho.
  Object.assign(REGRAS, {
    item_desconto_alto: { versao: 1, valeDesde: '2026-11-23', titulo: 'Item com desconto acima de 25%', fonte: 'Lei 14.133/2021 art. 59, §3º e §4º; REGRAS-AUDITOR A07 (caso TJAM 90001/2024)', link: LEI,
      explica: 'Mesmo com o global acima de 75%, o órgão pode exigir prova de exequibilidade dos preços unitários relevantes. No TJAM, propostas com itens acima de 25% de desconto foram diligenciadas e desclassificadas.' },
    verba_generica: { versao: 1, valeDesde: '2026-11-23', titulo: 'Item em verba ou "diversos"', fonte: 'Súmula TCU 258; Lei 14.133/2021 art. 59, V; REGRAS-AUDITOR B07', link: TCU,
      explica: 'Item em "verba" (vb) ou descrito como "diversos", "eventuais" ou "despesas gerais" não tem composição verificável. O TCU veda esse tipo de preço sem detalhamento.' },
    regime_nao_declarado: { versao: 1, valeDesde: '2026-11-23', titulo: 'Proposta não diz se a empresa é desonerada', fonte: 'Lei 12.546/2011 art. 7º; edital; REGRAS-AUDITOR E02 (recusa no TRE-AM 2/2023)', link: CPRB,
      explica: 'A tabela de encargos e o BDI dependem da opção pela desoneração. No TRE-AM 2/2023 uma proposta foi recusada porque a tabela de encargos não trazia o campo "optante: sim ou não".' },
    leitura_documento: { versao: 1, valeDesde: '2026-11-23', titulo: 'Números lidos de PDF ou imagem', fonte: 'Leitura automática do arquivo enviado (não é regra legal)', link: '',
      explica: 'Quando a planilha vem em PDF ou foto, os números são lidos do documento. Antes de usar qualquer achado em recurso, confira o valor no original.' },
  });

  // Encargos sociais do SINAPI por UF, com vigência (a tabela muda por ano). [horista desonerado, mensalista desonerado,
  // horista não desonerado, mensalista não desonerado], em %. Fonte: CAIXA, Cálculos e Parâmetros, 8ª ed. (vigência
  // 01/2026), copiado em _historico/orcamentista/BASE-TECNICA.md 2.5. Tabela nova da CAIXA entra aqui com nova vigência
  // (novidade do vigia de normas aprovada pelo dono), sem apagar a anterior: orçamento antigo usa a do ano dele.
  const ENCARGOS_SINAPI = [
    { vigencia: '2026-01', fonte: 'SINAPI — Cálculos e Parâmetros, 8ª ed., vigência 01/2026', link: 'https://www.caixa.gov.br/Downloads/sinapi-metodologia/Livro_SINAPI_Calculos_Parametros.pdf', uf: {
      AC: [96.88, 56.53, 112.61, 69.03], AL: [100.13, 58.59, 116.12, 71.25], AP: [99.23, 57.46, 115.18, 70.06], AM: [98.35, 58.20, 114.16, 70.80],
      BA: [101.70, 60.13, 117.73, 72.85], CE: [99.71, 59.74, 115.61, 72.46], DF: [94.63, 57.45, 110.08, 69.94], ES: [102.22, 61.06, 118.30, 73.85],
      GO: [93.22, 57.47, 107.72, 69.28], MA: [98.31, 58.66, 114.11, 71.30], MT: [90.89, 56.03, 105.33, 67.83], MS: [99.56, 58.74, 115.71, 71.57],
      MG: [100.33, 61.06, 116.23, 73.83], PA: [103.26, 59.98, 119.42, 72.70], PB: [102.06, 59.91, 118.19, 72.66], PR: [100.25, 59.65, 116.28, 72.42],
      PE: [98.83, 58.10, 114.63, 70.67], PI: [97.96, 58.91, 113.78, 71.59], RJ: [96.88, 57.20, 112.49, 69.66], RN: [100.77, 59.55, 116.83, 72.29],
      RS: [96.12, 56.67, 111.95, 69.29], RO: [99.61, 57.92, 115.71, 70.65], RR: [98.85, 57.72, 114.79, 70.35], SC: [98.38, 58.22, 114.47, 71.03],
      SP: [99.09, 58.51, 115.01, 71.18], SE: [95.88, 57.18, 111.51, 69.72], TO: [99.23, 59.20, 115.23, 71.98] } },
  ];
  // Tabela vigente na data-base ("AAAA-MM") para a UF, o regime e o tipo. null = sem tabela guardada para esse mês.
  function encargosDeReferencia(uf, dataBase, desonerado, tipo = 'horista') {
    const db = String(dataBase || '').slice(0, 7);
    const t = ENCARGOS_SINAPI.filter((x) => /^\d{4}-\d{2}$/.test(db) && x.vigencia <= db).sort((a, b) => (a.vigencia < b.vigencia ? 1 : -1))[0];
    const v = t?.uf?.[uf];
    if (!v) return null;
    const i = (desonerado ? 0 : 2) + (tipo === 'mensalista' ? 1 : 0);
    return { percentual: v[i] / 100, vigencia: t.vigencia, fonte: t.fonte, link: t.link };
  }

  // Onde estão as tabelas de referência e como citar (Lei 14.133/2021 art. 23 §2º, II: "data e hora de acesso").
  const TABELAS = [
    { sigla: 'SINAPI', nome: 'Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (CAIXA/IBGE)', uso: 'Edificações e obras em geral', link: 'https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/', citar: 'SINAPI, UF, mês/ano, desonerado ou não, código' },
    { sigla: 'SICRO', nome: 'Sistema de Custos Referenciais de Obras (DNIT)', uso: 'Rodovias, ferrovias e infraestrutura de transportes (Decreto 7.983/2013 art. 4º)', link: 'https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-e-pagamentos', citar: 'SICRO, UF, mês/ano, código da composição' },
    { sigla: 'ORSE', nome: 'Orçamento de Obras de Sergipe (CEHOP-SE)', uso: 'Itens que o SINAPI não tem', link: 'https://orse.cehop.se.gov.br/', citar: 'ORSE, mês/ano, código' },
    { sigla: 'SEINFRA', nome: 'Tabela de Custos da SEINFRA (Ceará)', uso: 'Itens que o SINAPI não tem', link: 'https://sites.seinfra.ce.gov.br/siproce/', citar: 'SEINFRA-CE, versão da tabela, código' },
    { sigla: 'EMOP', nome: 'Empresa de Obras Públicas do Rio de Janeiro', uso: 'Itens que o SINAPI não tem', link: 'http://www.emop.rj.gov.br/', citar: 'EMOP-RJ, mês/ano, código' },
    { sigla: 'SETOP', nome: 'Planilha de preços da SEINFRA-MG (antiga SETOP)', uso: 'Itens que o SINAPI não tem', link: 'https://www.infraestrutura.mg.gov.br/', citar: 'SETOP/SEINFRA-MG, região, mês/ano, código' },
    { sigla: 'CPOS', nome: 'Companhia Paulista de Obras e Serviços (CPOS/CDHU)', uso: 'Itens que o SINAPI não tem', link: 'https://www.cpos.sp.gov.br/', citar: 'CPOS, boletim nº, código' },
  ];

  const api = { REGRAS, TABELAS, ENCARGOS_SINAPI, encargosDeReferencia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { regras: api });
})();
