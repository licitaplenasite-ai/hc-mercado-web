/* global module */
// Biblioteca de artigos do Jurídico (juridico-ui.js, aba "Artigos"). Textos originais da Equipe LicitaPlena, curtos e
// práticos. Todo número de artigo foi conferido no texto oficial (planalto.gov.br e gov.br, 22/11/2026); a decisão do TCU
// citada aparece no manual do próprio TCU (licitacoesecontratos.tcu.gov.br). Conteúdo informativo: não promete resultado.
(function (global) {
  'use strict';
  const AUTOR = 'Equipe LicitaPlena';
  const ATUALIZADO = '2026-11-22';
  const F = {
    l14133: { nome: 'Lei 14.133/2021 (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm' },
    lc123: { nome: 'Lei Complementar 123/2006 (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm' },
    d11462: { nome: 'Decreto 11.462/2023 (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/decreto/d11462.htm' },
    d10024: { nome: 'Decreto 10.024/2019 (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/decreto/d10024.htm' },
    l8666: { nome: 'Lei 8.666/1993 (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/leis/l8666cons.htm' },
    l10520: { nome: 'Lei 10.520/2002 (Planalto)', url: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10520.htm' },
    in73: { nome: 'IN SEGES/ME 73/2022 (gov.br)', url: 'https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas/instrucao-normativa-seges-me-no-73-de-30-de-setembro-de-2022' },
    tcuManual: { nome: 'TCU: Licitações e Contratos, orientações e jurisprudência', url: 'https://licitacoesecontratos.tcu.gov.br/' },
    tcuAceitabilidade: { nome: 'TCU: aceitabilidade e desclassificação de propostas', url: 'https://licitacoesecontratos.tcu.gov.br/5-4-1-aceitabilidade-e-desclassificacao-2/' },
    tcuPesquisa: { nome: 'TCU: pesquisa de acórdãos', url: 'https://pesquisa.apps.tcu.gov.br/pesquisa/acordao-completo' },
  };
  // a(id, titulo, tema, leis[], resumo, paragrafos[], fontes[], modelo?)
  const a = (id, titulo, tema, leis, resumo, corpo, fontes, modelo = null) => Object.freeze({ id, titulo, tema, leis: Object.freeze(leis), resumo,
    corpo: Object.freeze(corpo), fontes: Object.freeze(fontes.map((f) => F[f])), modelo, autor: AUTOR, atualizado: ATUALIZADO });

  const ARTIGOS = Object.freeze([
    a('impugnacao', 'Impugnação e esclarecimento: quando usar cada um', 'Impugnação', ['14133'],
      'Qualquer pessoa pode impugnar até 3 dias úteis antes da abertura. Serve para tirar do edital uma exigência que fere a lei.',
      ['A impugnação é o pedido para mudar o edital. Ela cabe quando uma regra contraria a Lei 14.133: por exemplo, atestado com quantidade acima de 50% da parcela relevante, exigência de faturamento mínimo, marca sem justificativa técnica ou prazo de entrega impossível.',
        'Quem pode: qualquer pessoa, não só quem vai disputar (art. 164). Quando: até 3 dias úteis antes da data de abertura. O órgão tem até 3 dias úteis para responder, e a resposta tem de sair até o último dia útil antes da abertura (art. 164, parágrafo único).',
        'A impugnação não adia a sessão sozinha. Se for aceita e a mudança afetar as propostas, o edital tem de ser publicado de novo, com novo prazo (art. 55, § 1º). Por isso, prepare a proposta como se a data estivesse mantida.',
        'Na peça: transcreva a cláusula, diga qual artigo ela contraria, explique por que ela afasta concorrentes e faça um pedido concreto (excluir, mudar ou justificar). Guarde o protocolo e o print da resposta: eles ajudam num recurso depois.',
        'Se a regra só está confusa, peça esclarecimento no mesmo prazo. A resposta sai em sítio oficial, para todos, e passa a orientar como o edital será aplicado: leia as respostas publicadas antes de montar a proposta. Se a dúvida esconde uma ilegalidade, impugne logo: esperar a resposta pode fazer perder o prazo.'],
      ['l14133', 'tcuManual'], 'impugnacao'),
    a('prazos', 'Como contar os prazos na Lei 14.133', 'Prazos', ['14133'],
      'Exclui o dia do começo, inclui o do vencimento, e nos prazos em dias úteis só conta o dia com expediente no órgão.',
      ['A regra geral está no art. 183: o dia do evento (publicação, intimação, ata) não conta; o último dia conta. Nos prazos em dias úteis, só entram os dias em que o órgão teve expediente.',
        'Se o último dia cair num dia sem expediente, ou se o expediente fechar mais cedo, ou se o sistema ficar fora do ar, o prazo passa para o próximo dia útil (art. 183, § 2º).',
        'Quando a informação é divulgada na internet, a lei considera como dia do começo o primeiro dia útil seguinte ao da divulgação (art. 183, § 1º, I). Na dúvida, use a conta mais curta: protocolar um dia antes nunca prejudica.',
        'Feriado estadual e municipal do órgão também conta como dia sem expediente. A calculadora desta tela usa os feriados nacionais e fica sempre do lado seguro com o Carnaval e o Corpus Christi; confira o calendário do órgão.'],
      ['l14133'], null),
    a('intencao-recurso', 'Intenção de recurso: o minuto que decide tudo', 'Recurso', ['14133'],
      'Contra o julgamento das propostas e a habilitação, a intenção de recorrer é na hora, na sessão. Sem ela, perde-se o direito.',
      ['Quando o pregoeiro ou o agente de contratação declara o vencedor, o sistema abre um tempo curto para os licitantes manifestarem a intenção de recorrer. A lei diz que ela deve ser imediata, sob pena de preclusão (art. 165, § 1º, I).',
        'Fique na sessão até o fim, com o texto pronto. Basta dizer qual decisão, qual item e o motivo em uma frase. O modelo "Intenção de recurso" desta tela monta esse texto para colar no chat.',
        'Depois da intenção, as razões são apresentadas em 3 dias úteis, contados da intimação ou da lavratura da ata de habilitação ou inabilitação (art. 165, I e § 1º, I).',
        'Recurso contra julgamento e habilitação é apreciado em fase única (art. 165, § 1º, II): os argumentos sobre proposta e documentos vão todos na mesma peça.'],
      ['l14133'], 'intencao_recurso'),
    a('recurso', 'Recurso administrativo passo a passo', 'Recurso', ['14133'],
      '3 dias úteis para as razões, efeito suspensivo, reconsideração em 3 dias úteis e decisão da autoridade superior em até 10 dias úteis.',
      ['Cabe recurso, em 3 dias úteis, contra: pré-qualificação e registro cadastral, julgamento das propostas, habilitação ou inabilitação, anulação ou revogação da licitação e extinção unilateral do contrato (art. 165, I). Quando não houver recurso hierárquico, cabe pedido de reconsideração no mesmo prazo (art. 165, II).',
        'O recurso vai para quem decidiu. Se ele não reconsiderar em 3 dias úteis, envia o recurso à autoridade superior, que decide em até 10 dias úteis do recebimento (art. 165, § 2º). Enquanto isso, a decisão fica suspensa (art. 168).',
        'Peça vista dos documentos do concorrente logo depois da sessão: a lei garante acesso ao que for indispensável à sua defesa (art. 165, § 5º).',
        'Uma peça forte tem: tempestividade (data da ata e conta dos dias), a decisão atacada, a cláusula do edital, o artigo da lei, as provas e um pedido claro. Se o recurso for aceito, só cai o ato que não puder ser aproveitado (art. 165, § 3º).',
        'Se outra empresa recorreu contra você, as contrarrazões têm o mesmo prazo de 3 dias úteis, contado da intimação pessoal ou da divulgação do recurso (art. 165, § 4º). Responda a cada argumento, mostre o item do edital que você atende e peça que a decisão seja mantida.'],
      ['l14133', 'tcuManual'], 'recurso'),
    a('diligencia', 'Diligência: o que pode e o que não pode mandar depois', 'Diligência', ['14133'],
      'Na diligência dá para completar e atualizar, não para entregar o que faltou. Erro formal que não muda a substância pode ser corrigido.',
      ['Depois da entrega, não se pode trocar nem incluir documento novo, salvo em diligência para complementar informação sobre documento já apresentado (fato que já existia na abertura) ou para atualizar documento que venceu depois do recebimento das propostas (art. 64, I e II).',
        'Falha que não altera a substância do documento pode ser sanada por decisão fundamentada (art. 64, § 1º). E exigência meramente formal não pode afastar o licitante (art. 12, III).',
        'A diligência também serve para conferir se o preço é viável: o órgão pode pedir que você demonstre a exequibilidade (art. 59, § 2º).',
        'Responda dentro do prazo fixado, pergunta por pergunta, com documento assinado e datado. Se precisar de mais tempo (por exemplo, cotação de fornecedor), peça por escrito antes de vencer.'],
      ['l14133'], 'diligencia'),
    a('inexequibilidade-obras', 'Preço abaixo de 75% em obras: como defender a proposta', 'Inexequibilidade', ['14133'],
      'Abaixo de 75% do orçado, a lei presume inexequível; o TCU entende que é presunção relativa. Quem prova com documento pode ficar.',
      ['Em obras e serviços de engenharia, a lei considera inexequível a proposta abaixo de 75% do valor orçado (art. 59, § 4º). Abaixo de 85%, o vencedor presta garantia adicional igual à diferença entre o orçado e a proposta (art. 59, § 5º).',
        'O Tribunal de Contas da União entende que essa linha é presunção relativa: a Administração deve dar à empresa a chance de demonstrar que o preço é viável (Acórdão 465/2024-Plenário; veja o manual do TCU). A própria lei permite a diligência (art. 59, § 2º).',
        'Caso público do DNIT (restauração da BR-364/MT, 2025): a vencedora ficou 26% abaixo do orçamento. O agente pediu a demonstração e, numa diligência, recusou cotação vencida e sem local de entrega e pediu declaração dos fornecedores de manter o preço durante a obra. A empresa trouxe tudo e a exequibilidade foi aceita, com garantia adicional.',
        'O que pesa na defesa: composições sem mudar quantidades nem coeficientes do órgão, mão de obra pelo menos igual à convenção, tributos nos percentuais da lei, economia concentrada em insumos com cotação válida (com frete) e redução de administração central e lucro bem explicada.'],
      ['l14133', 'tcuAceitabilidade', 'tcuPesquisa'], 'exequibilidade'),
    a('inexequibilidade-bens', 'Preço muito baixo em bens e serviços: o que diz a regra federal', 'Inexequibilidade', ['14133'],
      'No federal, abaixo de 50% do orçado é só indício. A desclassificação depende de diligência que prove que o custo passa do preço.',
      ['A Lei 14.133 manda desclassificar a proposta com preço inexequível ou cuja exequibilidade não foi demonstrada quando exigida (art. 59, III e IV).',
        'Para bens e serviços em geral, a IN SEGES/ME 73/2022 diz que valor abaixo de 50% do orçado é indício de inexequibilidade, e que ela só é reconhecida depois de diligência que comprove que o custo do licitante passa do valor proposto e que não há custo de oportunidade que explique a oferta (art. 34).',
        'Essa IN vale para o federal e para quem a adotar; estados e municípios podem ter regra própria: confira o edital.',
        'Na defesa, mostre notas de compra, contratos parecidos já executados, estoque, escala ou outro motivo concreto para o preço. O modelo "Defesa de exequibilidade" organiza essas provas.'],
      ['l14133', 'in73'], 'exequibilidade'),
    a('reequilibrio', 'Reequilíbrio, reajuste e repactuação: qual pedir', 'Reequilíbrio', ['14133'],
      'Reajuste é índice do contrato; reequilíbrio é para fato extraordinário e tem de ser pedido antes da prorrogação.',
      ['Reajuste é a correção do preço pelo índice previsto no edital e no contrato, com data-base e periodicidade definidas (art. 92, V).',
        'Reequilíbrio é para força maior, caso fortuito, fato do príncipe ou fato imprevisível (ou previsível de consequência incalculável) que torne o contrato inviável como foi pactuado, respeitada a divisão de riscos (art. 124, II, "d").',
        'Prazo que se perde: o pedido de reequilíbrio tem de ser feito durante a vigência e antes de eventual prorrogação (art. 131, parágrafo único).',
        'Na ata de registro de preços federal, o fornecedor pede a alteração do preço registrado ao gerenciador, com documentos ou planilha de custos (Decreto 11.462/2023, arts. 25 e 27). Sem prova do fato novo, o pedido é negado e a ata continua valendo.'],
      ['l14133', 'd11462'], 'reequilibrio'),
    a('prorrogacao-entrega', 'Atrasou a entrega? Peça prorrogação antes do prazo vencer', 'Contrato', ['14133'],
      'Atraso sem motivo justificado é infração. Com motivo alheio à empresa e pedido feito a tempo, a conversa é outra.',
      ['A lei pune quem dá causa ao retardamento da entrega sem motivo justificado (art. 155, VII). A pena pode chegar ao impedimento de licitar (art. 156, § 4º).',
        'Por isso, quando o fabricante, a transportadora ou o mercado falham, peça a prorrogação por escrito, antes do vencimento, com a prova do motivo e uma nova data realista.',
        'Se quem atrasou foi a Administração (ordem de paralisação, suspensão ou impedimento), o cronograma é prorrogado pelo tempo correspondente (art. 115, § 5º).',
        'Se o fato também aumentou o custo, avalie junto o pedido de reequilíbrio (art. 124, II, "d").'],
      ['l14133'], 'prorrogacao_entrega'),
    a('sancoes', 'Sanções: defesa, recurso e prazos de 15 dias úteis', 'Sanções', ['14133'],
      'Advertência, multa, impedimento e inidoneidade. Defesa em 15 dias úteis e recurso em 15 dias úteis.',
      ['As sanções são advertência, multa (de 0,5% a 30% do valor do contrato), impedimento de licitar e contratar (até 3 anos no ente que aplicou) e declaração de inidoneidade (de 3 a 6 anos, em todos os entes) (art. 156).',
        'Defesa: na multa, 15 dias úteis da intimação (art. 157). No impedimento e na inidoneidade, há processo conduzido por comissão, com 15 dias úteis para a defesa escrita e para indicar as provas (art. 158).',
        'Contra a decisão: recurso em 15 dias úteis na advertência, na multa e no impedimento (art. 166); na inidoneidade, só pedido de reconsideração, também em 15 dias úteis (art. 167). Ambos suspendem a decisão (art. 168).',
        'A sanção vai para o CEIS e o CNEP em até 15 dias úteis (art. 161). Há reabilitação, com requisitos como reparar o dano e pagar a multa (art. 163).'],
      ['l14133'], null),
    a('habilitacao', 'Habilitação: o que o edital pode e não pode pedir', 'Habilitação', ['14133'],
      'Quatro grupos de documentos, em regra só do vencedor. Faturamento mínimo e índice de lucratividade são proibidos.',
      ['A habilitação tem quatro partes: jurídica, técnica, fiscal, social e trabalhista, e econômico-financeira (arts. 62, 66, 67, 68 e 69).',
        'Em regra, só o vencedor entrega os documentos; os demais declaram que atendem (art. 63, I e II). A regularidade fiscal só é exigida depois do julgamento e só do mais bem classificado (art. 63, III).',
        'No econômico-financeiro: balanço dos 2 últimos exercícios e certidão de falência; é proibido exigir faturamento mínimo e índices de rentabilidade ou lucratividade (art. 69, I, II e § 2º). Capital ou patrimônio mínimo, quando previsto, vai até 10% do estimado (art. 69, § 4º).',
        'Vistoria pode ser exigida, mas o edital tem de aceitar declaração do responsável técnico no lugar dela (art. 63, §§ 2º e 3º).'],
      ['l14133', 'tcuManual'], 'impugnacao'),
    a('atestados', 'Atestados de capacidade técnica: limites da exigência', 'Habilitação', ['14133'],
      'Só das parcelas relevantes (4% ou mais do valor), no máximo 50% da quantidade, sem limite de tempo ou de local.',
      ['O edital só pode exigir atestado das parcelas de maior relevância ou valor significativo: as que valem 4% ou mais do total estimado (art. 67, § 1º).',
        'A quantidade mínima pode ir até 50% dessas parcelas, e é proibido limitar o tempo ou o local dos atestados (art. 67, § 2º).',
        'Em serviços contínuos, o edital pode pedir experiência por um prazo mínimo de até 3 anos (art. 67, § 5º).',
        'Exigência acima desses limites é motivo de impugnação. Se você foi inabilitado por um atestado que atende ao edital, é motivo de recurso.'],
      ['l14133'], 'impugnacao'),
    a('me-epp', 'ME e EPP: empate ficto, certidão com restrição e exclusividade', 'ME/EPP', ['14133'],
      'No pregão, até 5% acima conta como empate; certidão com restrição tem 5 dias úteis para regularizar; itens até R$ 80 mil são exclusivos.',
      ['A Lei 14.133 manda aplicar os arts. 42 a 49 da LC 123/2006 (art. 4º). Os benefícios não valem para item acima da receita bruta máxima de EPP, nem para quem já passou desse valor em contratos públicos no ano (art. 4º, §§ 1º e 2º).',
        'Empate ficto: a proposta da ME/EPP até 10% acima da melhor (5% no pregão) é considerada empate, e ela pode cobrir a oferta (LC 123, arts. 44 e 45).',
        'Certidão fiscal ou trabalhista com restrição: a ME/EPP apresenta mesmo assim e tem 5 dias úteis, prorrogáveis por igual período, contados de quando é declarada vencedora, para regularizar (LC 123, art. 43, § 1º).',
        'Itens de até R$ 80.000,00 devem ser exclusivos para ME/EPP, e em bens divisíveis há cota de até 25% (LC 123, art. 48, I e III).'],
      ['l14133', 'lc123'], 'declaracoes'),
    a('garantia', 'Garantia de proposta e de contrato', 'Garantia', ['14133'],
      'Proposta: até 1% do estimado. Contrato: até 5%, podendo ir a 10%; em obra de grande vulto, seguro-garantia de até 30%.',
      ['A garantia de proposta, quando exigida, não passa de 1% do valor estimado e é devolvida em 10 dias úteis da assinatura do contrato ou do fracasso da licitação (art. 58, §§ 1º e 2º).',
        'A garantia do contrato é de até 5% do valor inicial, podendo chegar a 10% com justificativa de complexidade e risco (art. 98). Em obras e serviços de engenharia de grande vulto, pode ser exigido seguro-garantia com cláusula de retomada de até 30% (art. 99).',
        'Quem escolhe a modalidade é o contratado: caução em dinheiro ou títulos, seguro-garantia, fiança bancária ou título de capitalização (art. 96, § 1º). No seguro-garantia, o edital dá pelo menos 1 mês para apresentar (art. 96, § 3º).',
        'Em obra com proposta abaixo de 85% do orçado, some a garantia adicional (art. 59, § 5º) ao custo financeiro da proposta.'],
      ['l14133'], null),
    a('lei-antiga', 'Lei 8.666 e Lei 10.520: quando ainda importam', 'Lei antiga', ['8666', '10520'],
      'Revogadas em 30/12/2023, mas ainda regem contratos e licitações feitos sob elas. Os prazos são outros.',
      ['A Lei 8.666/1993 e a Lei 10.520/2002 foram revogadas em 30 de dezembro de 2023 (Lei 14.133, art. 193, II). Contratos assinados com base nelas continuam seguindo as regras antigas até o fim.',
        'Na Lei 8.666, o recurso era de 5 dias úteis (art. 109, I), e o licitante impugnava o edital até o 2º dia útil antes da abertura dos envelopes (art. 41, § 2º).',
        'No pregão da Lei 10.520, a intenção de recurso era imediata e motivada, com 3 dias para as razões e o mesmo prazo para as contrarrazões, contado do fim do prazo do recorrente (art. 4º, XVIII). No federal, o Decreto 10.024/2019 dava ao pregoeiro 2 dias úteis para responder esclarecimento e impugnação (arts. 23 e 24).',
        'As peças reais do ComprasNet desta tela (pregões até 2023) são, em geral, dessa época: use como exemplo de argumento, mas confira o prazo na lei do seu edital.'],
      ['l8666', 'l10520', 'd10024'], null),
  ]);

  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // Todas as palavras precisam aparecer (título, resumo, corpo ou tema); lei opcional ('14133', '8666', '10520').
  function buscarArtigos(termo, lei) {
    const palavras = normalizar(termo).split(/[\s;,]+/).filter((w) => w.length > 1);
    return ARTIGOS.filter((x) => (!lei || x.leis.includes(lei)) &&
      palavras.every((w) => normalizar(`${x.titulo} ${x.tema} ${x.resumo} ${x.corpo.join(' ')}`).includes(w)));
  }
  const obterArtigo = (id) => ARTIGOS.find((x) => x.id === id) || null;

  const api = { AUTOR, ARTIGOS, buscarArtigos, obterArtigo };
  global.JuridicoArtigos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
