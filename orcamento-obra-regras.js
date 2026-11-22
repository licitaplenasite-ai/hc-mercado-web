/* global module -- dados puros: base de regras do Auditor do Orçamento de obra (navegador e Node) */
// Base de conhecimento do Auditor: regra escrita, com fonte e link, consultada na hora (não é modelo treinado).
// Cada regra diz em português simples o que pode desclassificar ou dar problema e de onde isso vem.
// Textos legais conferidos no Planalto em 22/11/2026; faixas de BDI copiadas do Acórdão TCU 2622/2013 (bdi-calculadora.js).
// Estudo completo e exemplos: _historico/orcamentista/ (fora do repositório).
(function () {
  'use strict';
  const LEI = 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm';
  const DECRETO = 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7983.htm';
  const CPRB = 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12546.htm';
  const REONERACAO = 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14973.htm';
  const TCU = 'https://pesquisa.apps.tcu.gov.br/ (buscar "Acórdão 2622/2013 Plenário")';

  const REGRAS = {
    bdi_faixa: { titulo: 'BDI fora da faixa do TCU', fonte: 'Acórdão TCU 2622/2013-Plenário, itens 9.1 e 9.2', link: TCU,
      explica: 'O TCU publicou faixas (1º quartil a 3º quartil) de BDI e de cada parcela por tipo de obra. Fora da faixa não desclassifica sozinho, mas o órgão pode pedir justificativa e muitos editais fixam BDI máximo.' },
    iss_faixa: { titulo: 'ISS fora de 2% a 5%', fonte: 'Acórdão TCU 2622/2013, item 9.3.2.3; LC 116/2003 art. 8º', link: TCU,
      explica: 'Use a alíquota da lei do município da obra, sempre entre 2% e 5%.' },
    unitario_acima: { titulo: 'Preço unitário acima da referência', fonte: 'Lei 14.133/2021 art. 59, III e art. 6º, LVI; Decreto 7.983/2013 art. 2º, IX', link: LEI,
      explica: 'Quando o edital fixa critério de aceitabilidade de preço unitário (a maioria fixa), item acima do preço de referência desclassifica ou obriga a corrigir.' },
    etapa_acima: { titulo: 'Etapa do cronograma acima da referência', fonte: 'Decreto 7.983/2013 art. 13, I e parágrafo único', link: DECRETO,
      explica: 'Na empreitada por preço global, o preço global e o de cada etapa do cronograma precisam ficar iguais ou abaixo da referência.' },
    global_acima: { titulo: 'Preço global acima do orçamento', fonte: 'Lei 14.133/2021 art. 59, III', link: LEI,
      explica: 'Proposta que fica acima do orçamento estimado é desclassificada.' },
    inexequivel: { titulo: 'Abaixo de 75% do orçamento (inexequível)', fonte: 'Lei 14.133/2021 art. 59, §4º; Acórdãos TCU 465/2024, 803/2024 e 3.794/2024', link: 'https://licitacoesecontratos.tcu.gov.br/5-4-1-aceitabilidade-e-desclassificacao-2/',
      explica: 'Em obras e serviços de engenharia, proposta inferior a 75% do valor orçado é considerada inexequível. Exatamente 75% não é. Desde 2024 o TCU trata os 75% como presunção relativa: a empresa tem direito de provar que consegue executar antes de ser desclassificada (cabe recurso se não teve a chance).' },
    zona_de_risco: { titulo: 'Desconto na faixa que mais cai', fonte: 'Padrão observado: Concorrência 2/2023 TRE-AM (6 recusas entre 20% e 29,5%) e 19 obras no AM no PNCP (ago a out/2026, desconto mediano 1,7%, maior 11,8%)', link: '',
      explica: 'Não é regra da lei: é o que se viu nos casos estudados. Entre 20% e 25% de desconto a proposta ainda é exequível pela lei, mas é onde a análise da planilha e da habilitação mais derrubou. Planilha, CPU, BDI e cronograma precisam estar impecáveis.' },
    simples: { titulo: 'Simples Nacional com BDI de outro regime', fonte: 'Acórdão TCU 2622/2013, item 9.3.2.5; LC 123/2006, Anexo IV', link: TCU,
      explica: 'Empresa do Simples usa no BDI as alíquotas efetivas do Anexo IV (ISS, PIS, COFINS) e encargos sem as contribuições dispensadas. Copiar o BDI do órgão (PIS 0,65%, COFINS 3%, CPRB) é o erro mais comum de ME; o edital costuma deixar corrigir, mas o Auditor marca.' },
    garantia_adicional: { titulo: 'Abaixo de 85%: garantia adicional', fonte: 'Lei 14.133/2021 art. 59, §5º', link: LEI,
      explica: 'Abaixo de 85% do valor orçado, o vencedor precisa dar garantia adicional igual à diferença.' },
    desoneracao: { titulo: 'Desoneração incoerente', fonte: 'Lei 12.546/2011 art. 7º (CPRB da construção civil); Acórdão TCU 2622/2013', link: CPRB,
      explica: 'Quem é desonerado tira o INSS de 20% dos encargos sociais e põe a CPRB no BDI. Misturar (CPRB no BDI e encargos não desonerados, ou o contrário) cobra o imposto duas vezes ou nenhuma.' },
    reoneracao: { titulo: 'Reoneração gradual (2025 a 2027)', fonte: 'Lei 14.973/2024 (altera a Lei 12.546/2011)', link: REONERACAO,
      explica: 'De 2025 a 2027 quem fica na CPRB paga parte na receita e parte na folha: 2025 = 80% da CPRB + 5% de INSS na folha; 2026 = 60% + 10%; 2027 = 40% + 15%; 2028 volta aos 20% na folha.' },
    total_nao_fecha: { titulo: 'Conta que não fecha', fonte: 'Lei 14.133/2021 art. 59, I e V; regra do edital', link: LEI,
      explica: 'Quantidade × preço unitário tem que dar o total do item; a soma dos itens, o total da etapa; e a soma das etapas, o global.' },
    arredondamento: { titulo: 'Arredondamento', fonte: 'Regra do edital (a maioria pede 2 casas, truncando); observado nos editais do piloto', link: '',
      explica: 'Preço com mais de 2 casas ou arredondado do jeito diferente do edital gera diferença de centavos que o sistema do órgão pode recusar.' },
    item_faltando: { titulo: 'Item faltando ou quantidade mudada', fonte: 'Lei 14.133/2021 art. 59, II e V', link: LEI,
      explica: 'A planilha da proposta tem que ter todos os itens do edital, com a mesma unidade e quantidade.' },
    desconto_so_no_global: { titulo: 'Desconto só no total', fonte: 'Lei 14.133/2021 art. 56, §5º', link: LEI,
      explica: 'O vencedor tem que reapresentar as planilhas (custos unitários, BDI e encargos) adequadas ao valor final. Desconto só no global obriga a refazer tudo depois, com prazo curto.' },
    sem_referencia: { titulo: 'Item sem preço de referência', fonte: 'Lei 14.133/2021 art. 23, §2º; Decreto 7.983/2013 art. 6º', link: LEI,
      explica: 'Sem SINAPI/SICRO, vale tabela oficial, mídia especializada, contratação similar ou composição própria com cotações. Guarde a memória.' },
    cotacao: { titulo: 'Composição própria com poucas cotações', fonte: 'Lei 14.133/2021 art. 23, §2º; IN SEGES/ME 65/2021 art. 6º (mínimo de 3 preços)', link: LEI,
      explica: 'Composição própria precisa de pelo menos 3 cotações parecidas entre si, com data e fornecedor.' },
    jogo_de_planilha: { titulo: 'Risco de jogo de planilha', fonte: 'Lei 14.133/2021 art. 128 e art. 6º, LVII, c; Decreto 7.983/2013 art. 14', link: LEI,
      explica: 'Descontos muito desiguais entre itens (alguns no teto, outros muito baixos) parecem jogo de planilha: o desconto não pode ser reduzido em aditivo e o órgão pode glosar.' },
    data_base: { titulo: 'Data-base diferente', fonte: 'Lei 14.133/2021 art. 23 (valor compatível com o mercado)', link: LEI,
      explica: 'Preço tirado de um mês de referência diferente do pedido no edital não é comparável com o orçamento do órgão.' },
    encargos: { titulo: 'Encargos sociais não batem', fonte: 'Metodologia SINAPI de encargos sociais (CAIXA); Lei 12.546/2011', link: 'https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/',
      explica: 'O total dos encargos é A + B + C + D. Desonerado: grupo A sem os 20% de INSS (na transição de 2025 a 2027, com 5%, 10% ou 15%).' },
  };

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

  const api = { REGRAS, TABELAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { regras: api });
})();
