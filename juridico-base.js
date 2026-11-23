/* global module */
// Jurídico & Dúvidas (painel.html): perguntas e respostas e 10 modelos de peças, com base legal, prazo e "o que não pode faltar". Mesmo módulo no navegador e no Node (testes).
// Conteúdo informativo, em linguagem simples; NÃO substitui advogado. Toda resposta cita o artigo e o link do texto oficial
// (planalto.gov.br / gov.br). Onde o dispositivo não foi conferido no texto oficial, a resposta diz "confira" em vez de afirmar.
// Revisão jurídica: PENDENTE para tudo deste arquivo (marcado em REVISAO_JURIDICA e mostrado na tela).
(function (global) {
  'use strict';
  const REVISAO_JURIDICA = 'pendente';
  const AVISO = 'Conteúdo informativo. Confira com um advogado antes de protocolar.';
  // Parceira jurídica (decisão do dono: "Consultoria" leva à HC). Link simples, nunca pop-up.
  const ADVOGADO = Object.freeze({ texto: 'Precisa de um advogado? Fale com a HC', url: 'https://www.hclicitacoes.com' });

  const L = {
    l14133: { norma: 'Lei 14.133/2021', url: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm' },
    lc123: { norma: 'LC 123/2006', url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm' },
    d10024: { norma: 'Decreto 10.024/2019', url: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/decreto/d10024.htm' },
    d11462: { norma: 'Decreto 11.462/2023', url: 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/decreto/d11462.htm' },
    in73: { norma: 'IN SEGES/ME 73/2022', url: 'https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas/instrucao-normativa-seges-me-no-73-de-30-de-setembro-de-2022' },
  };
  const b = (lei, dispositivo) => Object.freeze({ norma: L[lei].norma, dispositivo, url: L[lei].url });

  const CATEGORIAS = Object.freeze({
    prazos: 'Prazos', pedidos: 'Esclarecimento e impugnação', recursos: 'Recurso e contrarrazão', habilitacao: 'Habilitação',
    me_epp: 'ME e EPP', julgamento: 'Proposta e julgamento', srp: 'Registro de preços', contrato: 'Contrato e pagamento',
    sancoes: 'Sanções', dispensa: 'Dispensa',
  });

  // p(id, categoria, pergunta, resposta, bases[])
  const p = (id, categoria, pergunta, resposta, bases) => Object.freeze({ id, categoria, pergunta, resposta, bases: Object.freeze(bases) });

  const PERGUNTAS = Object.freeze([
    // ---------- Prazos ----------
    p('prazo-esclarecimento', 'prazos', 'Até quando posso pedir esclarecimento sobre o edital?',
      'Até 3 dias úteis antes da data de abertura do certame. Qualquer pessoa pode pedir. O órgão tem até 3 dias úteis para divulgar a resposta, limitado ao último dia útil antes da abertura.',
      [b('l14133', 'art. 164, caput e parágrafo único')]),
    p('prazo-impugnacao', 'prazos', 'Até quando posso impugnar o edital?',
      'Até 3 dias úteis antes da data de abertura do certame, por irregularidade na aplicação da Lei 14.133. A resposta sai em até 3 dias úteis, limitada ao último dia útil antes da abertura. Conte os dias úteis para trás a partir da data de abertura, sem contar o dia da abertura.',
      [b('l14133', 'art. 164')]),
    p('prazo-intencao-recurso', 'prazos', 'Quando devo manifestar a intenção de recorrer?',
      'Imediatamente, na própria sessão, quando o recurso for contra o julgamento das propostas ou contra a habilitação/inabilitação. Se você não manifestar na hora, perde o direito (preclusão). O sistema costuma abrir um tempo curto para isso logo após a decisão: fique na sessão.',
      [b('l14133', 'art. 165, § 1º, I')]),
    p('prazo-recurso', 'prazos', 'Qual o prazo para apresentar as razões do recurso?',
      '3 dias úteis, contados da intimação ou da lavratura da ata. No recurso contra julgamento ou habilitação, o prazo começa na data de intimação ou de lavratura da ata de habilitação/inabilitação (ou da ata de julgamento, se a habilitação veio antes).',
      [b('l14133', 'art. 165, I e § 1º, I')]),
    p('prazo-contrarrazao', 'prazos', 'Qual o prazo para apresentar contrarrazões?',
      'O mesmo prazo do recurso: 3 dias úteis. Ele começa na data da intimação pessoal ou da divulgação da interposição do recurso.',
      [b('l14133', 'art. 165, § 4º')]),
    p('prazo-decisao-recurso', 'prazos', 'Em quanto tempo o recurso é decidido?',
      'Quem decidiu (pregoeiro ou agente de contratação) tem 3 dias úteis para reconsiderar. Se não reconsiderar, envia o recurso à autoridade superior, que tem até 10 dias úteis, contados do recebimento dos autos, para decidir.',
      [b('l14133', 'art. 165, § 2º')]),
    p('prazo-propostas', 'prazos', 'Qual o prazo mínimo entre a publicação do edital e a disputa?',
      'Para compra de bens: 8 dias úteis quando o critério é menor preço ou maior desconto, e 15 dias úteis nos outros casos. Para serviços comuns e obras/serviços comuns de engenharia por menor preço ou maior desconto: 10 dias úteis. Há prazos maiores para serviços especiais e contratação integrada.',
      [b('l14133', 'art. 55')]),
    p('prazo-defesa-sancao', 'prazos', 'Qual o prazo de defesa num processo de sanção?',
      '15 dias úteis para defesa: na multa, contados da intimação; no impedimento e na inidoneidade, defesa escrita em 15 dias úteis no processo de responsabilização conduzido por comissão. Do resultado cabe recurso (advertência, multa, impedimento) ou pedido de reconsideração (inidoneidade), também em 15 dias úteis.',
      [b('l14133', 'arts. 157, 158, 166 e 167')]),
    p('prazo-assinatura-contrato', 'prazos', 'Fui convocado para assinar o contrato. Posso pedir mais prazo?',
      'O prazo é o do edital. Ele pode ser prorrogado uma vez, por igual período, se você pedir durante o prazo e com justificativa aceita pela Administração. Recusar sem justificativa é tratado como descumprimento total e pode gerar sanção.',
      [b('l14133', 'art. 90, § 1º e § 5º')]),
    p('prazo-antigo-10024', 'prazos', 'O pregão é da lei antiga (10.520/Decreto 10.024). Os prazos mudam?',
      'No pregão federal regido pelo Decreto 10.024/2019: esclarecimento e impugnação até 3 dias úteis antes da abertura, com resposta em até 2 dias úteis; intenção de recurso imediata e 3 dias para as razões, com igual prazo para contrarrazões. Confira no edital qual lei rege a compra.',
      [b('d10024', 'arts. 23, 24 e 44')]),

    // ---------- Esclarecimento e impugnação ----------
    p('quem-impugna', 'pedidos', 'Quem pode impugnar ou pedir esclarecimento?',
      'Qualquer pessoa, não só quem vai participar. Basta protocolar no prazo e no canal indicado no edital (em geral, o próprio portal ou um e-mail).',
      [b('l14133', 'art. 164')]),
    p('diferenca-esclarecimento-impugnacao', 'pedidos', 'Qual a diferença entre esclarecimento e impugnação?',
      'Esclarecimento é uma pergunta: você quer entender uma regra do edital. Impugnação é um pedido de mudança: você aponta uma regra que fere a lei (por exemplo, exigência que restringe a competição) e pede que seja corrigida. Na dúvida sobre o sentido, comece pelo esclarecimento.',
      [b('l14133', 'art. 164')]),
    p('resposta-esclarecimento-vale', 'pedidos', 'A resposta do pregoeiro a um esclarecimento vale para todos?',
      'A resposta é divulgada em sítio oficial para todos os interessados e, na prática, orienta como o edital será aplicado. Guarde a cópia ou o print da resposta: ela ajuda num recurso se a regra for aplicada de outro jeito.',
      [b('l14133', 'art. 164, parágrafo único')]),
    p('impugnacao-suspende', 'pedidos', 'A impugnação adia a licitação?',
      'Não automaticamente. A lei não dá efeito suspensivo à impugnação; o edital costuma dizer o mesmo. Se a impugnação for acolhida e a mudança afetar as propostas, o edital deve ser republicado com novo prazo. Prepare-se como se a data estivesse mantida.',
      [b('l14133', 'arts. 55, § 1º, e 164'), b('d10024', 'art. 24, § 1º (pregão da lei antiga)')]),
    p('o-que-impugnar', 'pedidos', 'O que costuma ser motivo de impugnação?',
      'Exigências que restringem a competição sem justificativa: marca sem motivo técnico, atestado com quantidade acima de 50% da parcela relevante, limite de tempo ou local no atestado, índices contábeis sem justificativa, exigência de faturamento mínimo, prazo de entrega impossível. Cite a cláusula e o artigo.',
      [b('l14133', 'arts. 9º, 41, 67, §§ 1º e 2º, e 69, § 2º')]),

    // ---------- Recurso e contrarrazão ----------
    p('cabe-recurso', 'recursos', 'Contra o que cabe recurso?',
      'Cabe recurso, em 3 dias úteis, contra: pré-qualificação; julgamento das propostas; habilitação ou inabilitação; anulação ou revogação da licitação; e extinção unilateral do contrato. Quando não couber recurso hierárquico, cabe pedido de reconsideração no mesmo prazo.',
      [b('l14133', 'art. 165, I e II')]),
    p('recurso-efeito', 'recursos', 'O recurso suspende o resultado?',
      'Sim. O recurso e o pedido de reconsideração têm efeito suspensivo do ato ou da decisão recorrida até a decisão final da autoridade competente.',
      [b('l14133', 'art. 168')]),
    p('recurso-vista', 'recursos', 'Posso ver os documentos do concorrente para recorrer?',
      'Sim. A lei garante ao licitante vista dos elementos indispensáveis à defesa dos seus interesses. Peça pelo canal do edital logo após a sessão, para não perder o prazo.',
      [b('l14133', 'art. 165, § 5º')]),
    p('recurso-estrutura', 'recursos', 'Como montar um recurso?',
      'Partes usuais: endereçamento (pregoeiro/autoridade), qualificação da empresa, tempestividade (data da intimação e prazo de 3 dias úteis), fatos (o que foi decidido), fundamentos (cláusula do edital e artigo da lei), pedido (reformar a decisão) e, se não reconsiderar, pedido de envio à autoridade superior. Use o modelo-base desta tela.',
      [b('l14133', 'art. 165, I e § 2º')]),
    p('recurso-aproveitamento', 'recursos', 'Se o recurso for aceito, a licitação toda é anulada?',
      'Não necessariamente. O acolhimento do recurso invalida apenas o ato que não puder ser aproveitado; o restante do processo continua.',
      [b('l14133', 'art. 165, § 3º')]),
    p('controle-externo', 'recursos', 'Perdi o recurso. Posso levar a questão ao Tribunal de Contas?',
      'Sim. Qualquer licitante, contratado ou pessoa pode representar aos órgãos de controle interno ou ao tribunal de contas competente contra irregularidades na aplicação da lei. Isso não substitui o recurso no prazo.',
      [b('l14133', 'art. 170, § 4º')]),

    // ---------- Habilitação ----------
    p('habilitacao-quais', 'habilitacao', 'Quais documentos de habilitação podem ser exigidos?',
      'Quatro grupos: jurídica (contrato social, por exemplo), técnica (atestados, registro no conselho quando couber), fiscal, social e trabalhista (CNPJ, Receita, FGTS, Justiça do Trabalho, estadual/municipal) e econômico-financeira (balanço e certidão de falência).',
      [b('l14133', 'arts. 62, 66, 67, 68 e 69')]),
    p('habilitacao-so-vencedor', 'habilitacao', 'Todos os licitantes enviam os documentos de habilitação?',
      'Em regra, só o licitante vencedor apresenta os documentos de habilitação (os demais apresentam declaração de que atendem aos requisitos). A regularidade fiscal é exigida só depois do julgamento e só do mais bem classificado. Exceção: quando o edital coloca a habilitação antes do julgamento.',
      [b('l14133', 'art. 63, I, II e III')]),
    p('diligencia-documento', 'habilitacao', 'Esqueci um documento. Posso mandar depois?',
      'Depois da entrega não se pode trocar nem incluir documento novo, salvo em diligência para complementar informação de documento já apresentado (sobre fato que já existia na abertura) ou para atualizar documento que venceu depois do recebimento das propostas. Erro formal que não muda a substância pode ser sanado.',
      [b('l14133', 'arts. 12, III, e 64')]),
    p('sicaf', 'habilitacao', 'O SICAF substitui os documentos de habilitação?',
      'Sim, os documentos podem ser substituídos por registro cadastral emitido por órgão público, como o SICAF, desde que válidos. Mantenha as certidões em dia: certidão vencida no SICAF pode inabilitar.',
      [b('l14133', 'art. 70, II')]),
    p('atestado-quantidade', 'habilitacao', 'O edital pode exigir atestado de qualquer quantidade?',
      'Não. A exigência de atestado fica restrita às parcelas de maior relevância ou valor significativo (valor individual igual ou superior a 4% do total estimado). A quantidade mínima exigida pode ir até 50% dessas parcelas, e é proibido limitar tempo ou local dos atestados.',
      [b('l14133', 'art. 67, §§ 1º e 2º')]),
    p('balanco', 'habilitacao', 'Que balanço posso ter que apresentar?',
      'Balanço patrimonial, demonstração de resultado e demais demonstrações contábeis dos 2 últimos exercícios sociais, além de certidão negativa de falência. É proibido exigir faturamento mínimo anterior e índices de rentabilidade ou lucratividade. Empresa criada no ano pode ter regra própria no edital.',
      [b('l14133', 'art. 69, I, II e § 2º')]),
    p('capital-minimo', 'habilitacao', 'Podem exigir capital social mínimo?',
      'Podem exigir capital mínimo ou patrimônio líquido mínimo de até 10% do valor estimado da contratação, conforme o edital.',
      [b('l14133', 'art. 69, § 4º')]),
    p('vistoria', 'habilitacao', 'A vistoria (visita técnica) é obrigatória?',
      'O edital pode exigir quando for imprescindível conhecer o local. Mas deve sempre permitir trocar a vistoria por declaração formal do responsável técnico de que conhece as condições do local.',
      [b('l14133', 'art. 63, §§ 2º e 3º')]),

    // ---------- ME/EPP ----------
    p('me-epp-empate', 'me_epp', 'O que é o empate ficto da ME/EPP?',
      'No pregão, se a proposta da ME/EPP for até 5% acima da mais bem classificada (que não seja ME/EPP), considera-se empate: a ME/EPP pode cobrir a oferta com preço menor. Nas outras modalidades o intervalo é de 10%.',
      [b('lc123', 'arts. 44 e 45'), b('l14133', 'art. 4º')]),
    p('me-epp-certidao', 'me_epp', 'Sou ME/EPP e minha certidão está vencida. Fui inabilitado?',
      'Não de imediato. A ME/EPP precisa apresentar os documentos fiscais e trabalhistas mesmo com restrição; se vencer, tem prazo de 5 dias úteis, prorrogável por igual período, para regularizar. Se não regularizar, perde o direito à contratação.',
      [b('lc123', 'arts. 42 e 43, §§ 1º e 2º')]),
    p('me-epp-exclusiva', 'me_epp', 'Quando a licitação é exclusiva para ME/EPP?',
      'Nos itens de contratação com valor de até R$ 80.000,00. Em bens divisíveis pode haver cota de até 25% reservada a ME/EPP. Confira no edital como cada item foi marcado.',
      [b('lc123', 'art. 48, I e III')]),
    p('me-epp-limite', 'me_epp', 'Toda ME/EPP tem os benefícios em qualquer licitação?',
      'Não. Os benefícios não valem para item com valor estimado acima da receita bruta máxima de EPP, e só valem para quem, no ano da licitação, ainda não tiver contratos com a Administração que somados passem dessa receita (o edital pede declaração).',
      [b('l14133', 'art. 4º, §§ 1º e 2º')]),

    // ---------- Proposta e julgamento ----------
    p('desclassificacao', 'julgamento', 'Por quais motivos uma proposta é desclassificada?',
      'Vícios insanáveis; não atender às especificações técnicas; preço inexequível ou acima do orçamento estimado; não demonstrar a exequibilidade quando exigido; ou descumprir outra exigência do edital, desde que insanável.',
      [b('l14133', 'art. 59, I a V')]),
    p('exequibilidade', 'julgamento', 'Meu preço ficou muito baixo. Podem me desclassificar por inexequível?',
      'Só depois de verificar. A Administração pode fazer diligência ou pedir que você demonstre que o preço é viável (planilha, notas de compra, contratos). Em obras e serviços de engenharia, abaixo de 75% do orçado é inexequível. Em bens e serviços em geral, a IN 73/2022 trata como indício valores abaixo de 50% do orçado, a confirmar em diligência.',
      [b('l14133', 'art. 59, III, IV, §§ 2º e 4º'), b('in73', 'art. 34')]),
    p('amostra', 'julgamento', 'O órgão pode pedir amostra?',
      'Pode, excepcionalmente e desde que previsto no edital: na pré-qualificação, no julgamento (em geral do provisoriamente vencedor) ou durante o contrato ou a ata. O edital deve dizer prazo, local e critérios de avaliação.',
      [b('l14133', 'arts. 17, § 3º, e 41, II')]),
    p('marca', 'julgamento', 'O edital pode indicar marca?',
      'Só excepcionalmente e com justificativa: padronização, compatibilidade com o que o órgão já usa, ou quando a marca é a única que atende. Pode também pedir carta de solidariedade do fabricante e vetar marca que já falhou, comprovado em processo.',
      [b('l14133', 'art. 41, I, III e IV')]),
    p('negociacao', 'julgamento', 'O pregoeiro pode negociar o meu preço?',
      'Sim. Definido o resultado, a Administração pode negociar condições melhores com o primeiro colocado. Se ele for desclassificado por preço acima do máximo mesmo após negociação, pode negociar com os demais, na ordem.',
      [b('l14133', 'art. 61')]),
    p('orcamento-sigiloso', 'julgamento', 'Por que o valor estimado está sigiloso?',
      'A lei permite orçamento sigiloso, com justificativa. Ele é divulgado logo após o julgamento das propostas. No critério de maior desconto, o preço estimado precisa constar do edital.',
      [b('l14133', 'art. 24')]),
    p('desempate', 'julgamento', 'Como é o desempate entre propostas iguais?',
      'Depois das preferências da ME/EPP, a ordem é: disputa final entre os empatados; avaliação de desempenho contratual anterior; ações de equidade entre homens e mulheres; programa de integridade. Persistindo, há preferências do art. 60, § 1º.',
      [b('l14133', 'art. 60'), b('lc123', 'art. 44')]),
    p('erro-formal', 'julgamento', 'Um erro formal pequeno na proposta me elimina?',
      'Não deveria. Exigência meramente formal que não compromete a análise da qualificação ou o entendimento da proposta não leva ao afastamento do licitante. Se isso acontecer, é motivo de recurso.',
      [b('l14133', 'art. 12, III')]),

    // ---------- Registro de preços ----------
    p('srp-vigencia', 'srp', 'Quanto tempo vale uma ata de registro de preços?',
      '1 ano, podendo ser prorrogada por igual período se o preço continuar vantajoso.',
      [b('l14133', 'art. 84')]),
    p('srp-obriga', 'srp', 'Ganhei a ata. O órgão é obrigado a comprar?',
      'Não. A ata gera compromisso de fornecimento para você nas condições registradas, mas não obriga a Administração a contratar.',
      [b('l14133', 'art. 83')]),
    p('srp-adesao', 'srp', 'Outro órgão pode aderir à minha ata (carona)?',
      'Pode, com justificativa da vantagem, preço compatível com o mercado e aceitação do órgão gerenciador e do fornecedor. Cada órgão aderente pode comprar até 50% dos quantitativos registrados, e o total das adesões não passa do dobro de cada item. Órgão federal não pode aderir a ata estadual, distrital ou municipal.',
      [b('l14133', 'art. 86, §§ 2º, 4º, 5º e 8º')]),
    p('srp-preco', 'srp', 'O custo subiu e a ata ficou inviável. Posso pedir revisão do preço registrado?',
      'Pode pedir alteração do preço registrado por fato imprevisível ou de consequência incalculável, força maior, caso fortuito, fato do príncipe ou mudança de tributo, com prova. No federal, o Decreto 11.462/2023 regula o pedido e a possível liberação do fornecedor. Use o modelo de reequilíbrio desta tela.',
      [b('d11462', 'arts. 25 e 27'),b('l14133', 'art. 124, II, d')]),

    // ---------- Contrato e pagamento ----------
    p('reequilibrio', 'contrato', 'Quando posso pedir reequilíbrio econômico-financeiro?',
      'Quando força maior, caso fortuito, fato do príncipe ou fatos imprevisíveis (ou previsíveis de consequências incalculáveis) tornarem o contrato inviável como pactuado, respeitada a matriz de riscos. O pedido deve ser feito durante a vigência e antes de eventual prorrogação, com provas (notas, índices, cotações).',
      [b('l14133', 'arts. 124, II, d, e 131, parágrafo único')]),
    p('reajuste', 'contrato', 'Reajuste e reequilíbrio são a mesma coisa?',
      'Não. Reajuste é a correção por índice previsto no edital, com data-base na data do orçamento e periodicidade anual, feita por apostila. Reequilíbrio é para fato extraordinário que rompe a equação do contrato. Repactuação é para serviços contínuos com mão de obra dedicada.',
      [b('l14133', 'arts. 25, § 7º, 135 e 136')]),
    p('acrescimo', 'contrato', 'O órgão pode aumentar ou reduzir o contrato?',
      'Sim, unilateralmente, até 25% do valor inicial atualizado (acréscimos ou supressões). Em reforma de edifício ou de equipamento, o acréscimo pode chegar a 50%.',
      [b('l14133', 'art. 125')]),
    p('garantia', 'contrato', 'Que garantia podem exigir no contrato?',
      'Até 5% do valor inicial do contrato, podendo chegar a 10% conforme complexidade e riscos (e até 30% em obras de grande vulto). Você escolhe a modalidade: caução em dinheiro ou títulos, seguro-garantia, fiança bancária ou título de capitalização. Garantia de proposta, quando exigida, é de até 1% do estimado.',
      [b('l14133', 'arts. 58, 96, § 1º, 98 e 99')]),
    p('pagamento-atraso', 'contrato', 'O órgão atrasou o pagamento. O que posso fazer?',
      'O prazo de pagamento é o do edital e do contrato, e a Administração deve seguir a ordem cronológica de pagamentos. Atraso superior a 2 meses, contado da emissão da nota fiscal, dá ao contratado direito à extinção do contrato (ou a suspender a execução, conforme a lei). Registre a cobrança por escrito.',
      [b('l14133', 'arts. 92, V, 137, § 2º, IV, e 141')]),
    p('vigencia-contrato', 'contrato', 'Por quanto tempo um contrato de fornecimento contínuo pode durar?',
      'Até 5 anos na contratação inicial, e pode ser prorrogado sucessivamente até 10 anos, se previsto no edital e mantida a vantagem.',
      [b('l14133', 'arts. 106 e 107')]),

    // ---------- Sanções ----------
    p('sancoes-quais', 'sancoes', 'Quais sanções a empresa pode sofrer?',
      'Advertência, multa, impedimento de licitar e contratar e declaração de inidoneidade. A multa vai de 0,5% a 30% do valor do contrato. O impedimento dura até 3 anos no ente que aplicou; a inidoneidade, de 3 a 6 anos, em todos os entes.',
      [b('l14133', 'art. 156, I a IV, §§ 3º, 4º e 5º')]),
    p('sancoes-cadastro', 'sancoes', 'Onde as sanções ficam registradas?',
      'Em até 15 dias úteis, a sanção aplicada é informada no CEIS e no CNEP (cadastros nacionais). Consulte antes de contratar e verifique o seu CNPJ periodicamente.',
      [b('l14133', 'art. 161')]),
    p('sancoes-reabilitacao', 'sancoes', 'Fui impedido. Posso voltar a licitar antes do fim do prazo?',
      'Há reabilitação, com requisitos: reparação do dano, multa paga, prazo mínimo cumprido (1 ano no impedimento, 3 anos na inidoneidade), cumprimento das condições do ato e análise jurídica. Em fraude ou documento falso pode exigir programa de integridade.',
      [b('l14133', 'art. 163')]),

    // ---------- Dispensa ----------
    p('dispensa-aviso', 'dispensa', 'Como funciona a dispensa eletrônica?',
      'As dispensas por valor devem preferencialmente ser precedidas de aviso em sítio oficial por no mínimo 3 dias úteis, para receber propostas adicionais. Os limites de valor são atualizados todo ano por decreto: confira o vigente.',
      [b('l14133', 'art. 75, I, II e § 3º')]),
    p('dispensa-deserta', 'dispensa', 'A licitação deu deserta ou fracassada. O órgão pode comprar direto?',
      'Pode, por dispensa, se mantiver todas as condições do edital de licitação feita há menos de 1 ano, quando não apareceram interessados ou propostas válidas, ou quando os preços estavam muito acima do mercado.',
      [b('l14133', 'art. 75, III')]),
    p('dispensa-documentos', 'dispensa', 'Na dispensa preciso mandar toda a documentação?',
      'A documentação de habilitação pode ser dispensada, total ou parcialmente, em entrega imediata, em compras abaixo de 1/4 do limite de dispensa e em produto para pesquisa e desenvolvimento até R$ 300 mil. Confira o aviso da contratação.',
      [b('l14133', 'art. 70, III')]),
  ]);

  // Filtro por lei: o pregão federal da lei antiga (Decreto 10.024) responde à Lei 10.520; o resto é da Lei 14.133.
  const leiDaPergunta = (q) => (q.bases.some((x) => x.norma.startsWith('Decreto 10.024')) ? '10520' : '14133');
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // Busca por palavras (todas precisam aparecer em pergunta, resposta ou dispositivo), opcionalmente numa categoria.
  function buscarPerguntas(termo, categoria) {
    const palavras = normalizar(termo).split(/[\s;,]+/).filter((w) => w.length > 1);
    return PERGUNTAS.filter((q) => (!categoria || q.categoria === categoria) &&
      palavras.every((w) => normalizar(`${q.pergunta} ${q.resposta} ${q.bases.map((x) => `${x.norma} ${x.dispositivo}`).join(' ')}`).includes(w)));
  }

  // ---------- Modelos-base de peças ----------
  // Mesmos nomes de variável e o mesmo marcador visível do kit de declarações (_kit_declaracoes.js): valor ausente vira
  // "[PREENCHER: rótulo]", nunca some do texto. CPF fica fora de propósito: a peça não precisa dele (LGPD).
  const ROTULOS = Object.freeze({
    razao_social: 'razão social', cnpj: 'CNPJ', endereco: 'endereço', representante: 'representante', cargo: 'cargo',
    numero_edital: 'número do edital', orgao: 'órgão', objeto: 'objeto', cidade: 'cidade', data: 'data',
    autoridade: 'autoridade destinatária', clausula: 'item ou cláusula do edital', duvida: 'dúvida', fatos: 'fatos',
    fundamentos: 'fundamentos', pedido: 'pedido', data_intimacao: 'data da intimação ou da ata', decisao: 'decisão recorrida',
    recorrente: 'empresa recorrente', numero_contrato: 'número do contrato ou da ata', item: 'item ou lote',
    valor_atual: 'valor atual', valor_pedido: 'valor pedido', evento: 'fato que alterou os custos',
    data_abertura: 'data da abertura', motivo: 'motivo em uma frase', prazo_atual: 'prazo de entrega atual',
    nova_data: 'nova data pedida', data_diligencia: 'data do pedido de diligência', pedido_diligencia: 'o que o órgão pediu',
    resposta_diligencia: 'resposta e documentos enviados', valor_proposta: 'valor da proposta', valor_orcado: 'valor orçado pelo órgão',
    composicao: 'como o preço foi formado',
  });
  const CAMPOS_EMPRESA = ['razao_social', 'cnpj', 'endereco', 'representante', 'cargo', 'cidade', 'data'];
  const CAMPOS_PROCESSO = ['orgao', 'autoridade', 'numero_edital', 'objeto'];
  const ABERTURA = '{{razao_social}}, inscrita no CNPJ sob o nº {{cnpj}}, com sede em {{endereco}}, por seu representante legal {{representante}} ({{cargo}}),';
  const FECHO = '\n\nNestes termos, pede deferimento.\n\n{{cidade}}, {{data}}.\n\n\n______________________________\n{{razao_social}}\n{{representante}} – {{cargo}}';
  const ASSINATURA = '\n\n{{cidade}}, {{data}}.\n\n\n______________________________\n{{razao_social}}\n{{representante}} – {{cargo}}';
  // naoPodeFaltar: lista curta do que derruba a peça se faltar. lei: todos os modelos são da Lei 14.133 (filtro por lei).
  // curto: texto para colar no chat do pregão (sem endereçamento nem fecho).
  const m = (codigo, titulo, prazo, bases, campos, texto, naoPodeFaltar, { curto = false, fecho = FECHO } = {}) => Object.freeze({
    codigo, titulo, prazo, lei: '14133', bases: Object.freeze(bases), naoPodeFaltar: Object.freeze(naoPodeFaltar), curto,
    campos: Object.freeze(curto ? campos : [...CAMPOS_EMPRESA, ...CAMPOS_PROCESSO, ...campos]), texto: curto ? texto : texto + fecho,
    revisaoJuridica: REVISAO_JURIDICA });

  const MODELOS = Object.freeze([
    m('esclarecimento', 'Pedido de esclarecimento', 'Até 3 dias úteis antes da abertura do certame (art. 164 da Lei 14.133/2021).',
      [b('l14133', 'art. 164')], ['data_abertura', 'clausula', 'duvida'],
      'Ao(À) {{autoridade}} – {{orgao}}\n\nRef.: Edital nº {{numero_edital}} – {{objeto}}\n\nPEDIDO DE ESCLARECIMENTO\n\n' + ABERTURA +
      ' vem, tempestivamente, com fundamento no art. 164 da Lei nº 14.133/2021, apresentar PEDIDO DE ESCLARECIMENTO, nos seguintes termos.\n\n' +
      '1. TEMPESTIVIDADE\nA abertura do certame está marcada para {{data_abertura}}. O pedido é apresentado até 3 (três) dias úteis antes dessa data, conforme o art. 164 da Lei nº 14.133/2021.\n\n' +
      '2. TRECHO DO EDITAL\n{{clausula}}\n\n3. DÚVIDA\n{{duvida}}\n\n' +
      '4. PEDIDO\nRequer seja esclarecido o ponto acima, com divulgação da resposta em sítio eletrônico oficial no prazo do parágrafo único do art. 164 da Lei nº 14.133/2021.',
      ['Data e protocolo dentro do prazo (3 dias úteis antes da abertura).', 'O número do item e a página exata do edital ou do termo de referência.',
        'Uma pergunta objetiva por tópico, sem pedir mudança (mudança é impugnação).', 'Canal de envio que o edital indica (portal ou e-mail).']),
    m('impugnacao', 'Impugnação ao edital', 'Até 3 dias úteis antes da abertura do certame (art. 164 da Lei 14.133/2021).',
      [b('l14133', 'art. 164')], ['data_abertura', 'clausula', 'fatos', 'fundamentos', 'pedido'],
      'Ao(À) {{autoridade}} – {{orgao}}\n\nRef.: Edital nº {{numero_edital}} – {{objeto}}\n\nIMPUGNAÇÃO AO EDITAL\n\n' + ABERTURA +
      ' vem, tempestivamente, com fundamento no art. 164 da Lei nº 14.133/2021, apresentar IMPUGNAÇÃO ao edital em referência, pelas razões a seguir.\n\n' +
      '1. TEMPESTIVIDADE\nA abertura do certame está marcada para {{data_abertura}}. A impugnação é apresentada até 3 (três) dias úteis antes dessa data (art. 164 da Lei nº 14.133/2021).\n\n' +
      '2. CLÁUSULA IMPUGNADA\n{{clausula}}\n\n3. FATOS\n{{fatos}}\n\n4. FUNDAMENTOS\n{{fundamentos}}\n\n' +
      '5. PEDIDO\n{{pedido}}\nRequer, ainda, que, havendo alteração que afete a formulação das propostas, o edital seja republicado com reabertura do prazo (art. 55, § 1º, da Lei nº 14.133/2021).',
      ['Protocolo até 3 dias úteis antes da abertura: depois disso, só cabe recurso ou representação ao tribunal de contas.',
        'A cláusula transcrita e o artigo da lei que ela contraria.', 'Por que a exigência restringe a disputa ou não tem justificativa no processo.',
        'Um pedido concreto: excluir, mudar ou explicar a exigência.']),
    m('intencao_recurso', 'Intenção de recurso (texto curto para o chat)', 'Na hora, na própria sessão, no tempo que o pregoeiro abrir. Sem isso, perde-se o direito (art. 165, § 1º, I).',
      [b('l14133', 'art. 165, § 1º, I')], ['item', 'decisao', 'motivo'],
      'Manifestamos intenção de recorrer contra {{decisao}} no {{item}}. Motivo: {{motivo}}. Apresentaremos as razões no prazo de 3 dias úteis (art. 165, I, da Lei 14.133/2021).',
      ['Enviar na sessão, no campo próprio do sistema, antes de o prazo fechar.', 'Dizer qual decisão e qual item.',
        'Um motivo resumido e verdadeiro: o edital pode exigir intenção motivada.', 'Anotar a data da ata: dela contam os 3 dias úteis das razões.'],
      { curto: true }),
    m('recurso', 'Recurso administrativo', '3 dias úteis da intimação ou da lavratura da ata; a intenção de recorrer deve ser manifestada na sessão (art. 165, I e § 1º, I).',
      [b('l14133', 'art. 165'), b('l14133', 'art. 168')], ['item', 'data_intimacao', 'decisao', 'fatos', 'fundamentos', 'pedido'],
      'Ao(À) Pregoeiro(a) / Agente de Contratação – {{orgao}}\nCom pedido de encaminhamento à {{autoridade}}, caso não haja reconsideração\n\nRef.: Edital nº {{numero_edital}} – {{objeto}} – {{item}}\n\nRECURSO ADMINISTRATIVO\n\n' + ABERTURA +
      ' tendo manifestado a intenção de recorrer na sessão, vem, com fundamento no art. 165, I, da Lei nº 14.133/2021, apresentar RAZÕES DE RECURSO contra a decisão abaixo.\n\n' +
      '1. TEMPESTIVIDADE\nA intimação ou a lavratura da ata ocorreu em {{data_intimacao}}. O recurso é apresentado dentro de 3 (três) dias úteis (art. 165, I e § 1º, I).\n\n' +
      '2. DECISÃO RECORRIDA\n{{decisao}}\n\n3. FATOS\n{{fatos}}\n\n4. FUNDAMENTOS\n{{fundamentos}}\n\n' +
      '5. PEDIDO\n{{pedido}}\nRequer o recebimento do recurso com efeito suspensivo (art. 168) e, não havendo reconsideração em 3 (três) dias úteis, o seu encaminhamento à autoridade superior (art. 165, § 2º).',
      ['Ter manifestado a intenção de recorrer na sessão (sem ela, o recurso não é conhecido).', 'Data da ata ou da intimação e o cálculo dos 3 dias úteis.',
        'A decisão atacada, com a cláusula do edital e o artigo da lei.', 'Provas: print do chat, documentos, atestados, a proposta do concorrente (peça vista, art. 165, § 5º).',
        'Pedido de reforma e de envio à autoridade superior.']),
    m('contrarrazao', 'Contrarrazões ao recurso', 'Mesmo prazo do recurso (3 dias úteis), contado da intimação ou da divulgação do recurso (art. 165, § 4º).',
      [b('l14133', 'art. 165, § 4º')], ['item', 'recorrente', 'data_intimacao', 'fatos', 'fundamentos', 'pedido'],
      'Ao(À) Pregoeiro(a) / Agente de Contratação – {{orgao}}\n\nRef.: Edital nº {{numero_edital}} – {{objeto}} – {{item}}\n\nCONTRARRAZÕES AO RECURSO\n\n' + ABERTURA +
      ' vem, com fundamento no art. 165, § 4º, da Lei nº 14.133/2021, apresentar CONTRARRAZÕES ao recurso interposto por {{recorrente}}.\n\n' +
      '1. TEMPESTIVIDADE\nA interposição do recurso foi divulgada ou intimada em {{data_intimacao}}. As contrarrazões são apresentadas dentro de 3 (três) dias úteis (art. 165, § 4º).\n\n' +
      '2. SÍNTESE DO RECURSO\n{{fatos}}\n\n3. RAZÕES PARA MANTER A DECISÃO\n{{fundamentos}}\n\n' +
      '4. PEDIDO\n{{pedido}}\nRequer seja negado provimento ao recurso e mantida a decisão recorrida.',
      ['Data da divulgação do recurso e o cálculo dos 3 dias úteis.', 'Resposta ponto a ponto a cada argumento do recorrente.',
        'O item do edital que a sua proposta ou documento atende, com a página.', 'Pedido para manter a decisão.']),
    // Reequilíbrio é o pedido mais comum depois de ganhar (contrato ou ata), e tem prazo que se perde (antes da prorrogação).
    m('reequilibrio', 'Pedido de reequilíbrio econômico-financeiro', 'Durante a vigência do contrato e antes de eventual prorrogação (art. 131, parágrafo único).',
      [b('l14133', 'art. 124, II, d'), b('l14133', 'art. 131, parágrafo único'), b('d11462', 'arts. 25 e 27 (ata de registro de preços)')],
      ['numero_contrato', 'item', 'evento', 'valor_atual', 'valor_pedido', 'fatos'],
      'Ao(À) {{autoridade}} – {{orgao}}\n\nRef.: Contrato / Ata nº {{numero_contrato}} – Edital nº {{numero_edital}} – {{objeto}}\n\nPEDIDO DE REEQUILÍBRIO ECONÔMICO-FINANCEIRO\n\n' + ABERTURA +
      ' contratada no instrumento em referência, vem, com fundamento no art. 124, II, "d", da Lei nº 14.133/2021, requerer o RESTABELECIMENTO DO EQUILÍBRIO ECONÔMICO-FINANCEIRO, pelas razões a seguir.\n\n' +
      '1. OPORTUNIDADE DO PEDIDO\nO pedido é formulado durante a vigência do instrumento e antes de eventual prorrogação (art. 131, parágrafo único, da Lei nº 14.133/2021).\n\n' +
      '2. FATO SUPERVENIENTE\n{{evento}}\n\n3. FATOS E PROVAS\n{{fatos}}\n[Anexar notas fiscais de compra antes e depois, cotações, índices oficiais e planilha de custos.]\n\n' +
      '4. IMPACTO NO PREÇO\nItem: {{item}}\nValor atual: {{valor_atual}}\nValor pedido: {{valor_pedido}}\n\n' +
      '5. PEDIDO\nRequer a revisão do preço do item indicado para {{valor_pedido}}, com efeitos a partir da data do protocolo deste pedido, respeitada a matriz de riscos do contrato.',
      ['Pedido dentro da vigência e antes da prorrogação.', 'O fato novo e imprevisível (ou de consequência incalculável), com data.',
        'Prova do custo antes e depois: notas fiscais, cotações, índice oficial.', 'Planilha mostrando o impacto no preço de cada item.',
        'Na ata de registro de preços: pedido ao órgão gerenciador (Decreto 11.462/2023, art. 27).']),
    m('prorrogacao_entrega', 'Pedido de prorrogação do prazo de entrega', 'Antes de o prazo de entrega vencer. Atraso sem motivo justificado pode gerar sanção (art. 155, VII).',
      [b('l14133', 'art. 115, § 5º'), b('l14133', 'art. 155, VII'), b('l14133', 'art. 124, II, d')],
      ['numero_contrato', 'item', 'prazo_atual', 'nova_data', 'evento', 'fatos'],
      'Ao(À) {{autoridade}} – {{orgao}}\n\nRef.: Contrato / Nota de empenho / Ata nº {{numero_contrato}} – Edital nº {{numero_edital}} – {{objeto}}\n\nPEDIDO DE PRORROGAÇÃO DO PRAZO DE ENTREGA\n\n' + ABERTURA +
      ' contratada no instrumento em referência, vem requerer a PRORROGAÇÃO DO PRAZO DE ENTREGA, pelas razões a seguir.\n\n' +
      '1. PRAZO ATUAL E PEDIDO\nItem: {{item}}\nPrazo de entrega atual: {{prazo_atual}}\nNova data pedida: {{nova_data}}\nO pedido é feito antes do vencimento do prazo.\n\n' +
      '2. MOTIVO\n{{evento}}\n\n3. FATOS E PROVAS\n{{fatos}}\n[Anexar comunicado do fabricante ou da transportadora, notas, e-mails e qualquer documento que mostre o impedimento.]\n\n' +
      '4. FUNDAMENTOS\nO atraso decorre de fato alheio à vontade da contratada, o que afasta a hipótese de retardamento sem motivo justificado (art. 155, VII, da Lei nº 14.133/2021). ' +
      'Se o impedimento decorrer de ato da Administração, o cronograma é prorrogado pelo tempo correspondente (art. 115, § 5º).\n\n' +
      '5. PEDIDO\nRequer a prorrogação do prazo de entrega do item indicado até {{nova_data}}, sem aplicação de penalidade, mantidas as demais condições do contrato.',
      ['Pedir ANTES de o prazo vencer, por escrito e com protocolo.', 'O motivo concreto e alheio à empresa (fabricante, transporte, greve, falta no mercado).',
        'Prova do motivo: carta do fabricante, rastreio, notícia, e-mails.', 'Uma nova data realista, item por item.']),
    m('diligencia', 'Resposta à diligência', 'O prazo que o pregoeiro ou o agente de contratação fixar no pedido. Responda dentro dele.',
      [b('l14133', 'art. 64'), b('l14133', 'art. 59, § 2º'), b('l14133', 'art. 12, III')],
      ['item', 'data_diligencia', 'pedido_diligencia', 'resposta_diligencia'],
      'Ao(À) Pregoeiro(a) / Agente de Contratação – {{orgao}}\n\nRef.: Edital nº {{numero_edital}} – {{objeto}} – {{item}}\n\nRESPOSTA À DILIGÊNCIA\n\n' + ABERTURA +
      ' vem, em atenção à diligência de {{data_diligencia}}, apresentar os esclarecimentos e documentos solicitados.\n\n' +
      '1. O QUE FOI PEDIDO\n{{pedido_diligencia}}\n\n2. RESPOSTA E DOCUMENTOS\n{{resposta_diligencia}}\n\n' +
      '3. OBSERVAÇÃO\nOs documentos enviados complementam informações já apresentadas e se referem a fatos existentes à época da abertura do certame (art. 64, I, da Lei nº 14.133/2021), ' +
      'ou atualizam documento cuja validade expirou após o recebimento das propostas (art. 64, II).\n\n' +
      '4. PEDIDO\nRequer o recebimento desta resposta e o prosseguimento da análise, com a aceitação da proposta e a habilitação da empresa.',
      ['Responder dentro do prazo fixado, pelo canal indicado (em geral, anexo no sistema).', 'Responder a cada pergunta, na ordem em que foi feita.',
        'Documento novo só para complementar o que já foi entregue ou atualizar o que venceu depois da abertura (art. 64).',
        'Cotações e notas assinadas, com data, validade e local de entrega.']),
    m('exequibilidade', 'Defesa de exequibilidade da proposta', 'O prazo que o agente de contratação fixar (em obras, costuma ser curto, como 24 horas). Peça mais prazo por escrito, se precisar.',
      [b('l14133', 'art. 59, III, IV, §§ 2º, 4º e 5º'), b('in73', 'arts. 33 e 34')],
      ['item', 'valor_proposta', 'valor_orcado', 'composicao', 'fatos'],
      'Ao(À) Pregoeiro(a) / Agente de Contratação – {{orgao}}\n\nRef.: Edital nº {{numero_edital}} – {{objeto}} – {{item}}\n\nDEMONSTRAÇÃO DE EXEQUIBILIDADE DA PROPOSTA\n\n' + ABERTURA +
      ' vem, com fundamento no art. 59, § 2º, da Lei nº 14.133/2021, demonstrar que a sua proposta é exequível.\n\n' +
      '1. A PROPOSTA\nValor da proposta: {{valor_proposta}}\nValor orçado pela Administração: {{valor_orcado}}\n' +
      'O percentual abaixo do orçamento, por si só, não basta para desclassificar: a lei permite à Administração fazer diligência ou pedir a demonstração da exequibilidade ' +
      '(art. 59, § 2º), e o Tribunal de Contas da União entende que a linha de 75% em obras e serviços de engenharia (art. 59, § 4º) é presunção relativa, que admite prova em contrário (Acórdão 465/2024-Plenário).\n\n' +
      '2. COMO O PREÇO FOI FORMADO\n{{composicao}}\n\n3. PROVAS\n{{fatos}}\n' +
      '[Anexar: cotações válidas e assinadas, com local de entrega e frete; composições de custo; notas fiscais e contratos semelhantes já executados; declaração de compromisso dos fornecedores.]\n\n' +
      '4. TRIBUTOS E ENCARGOS\nOs tributos (PIS, COFINS, ISS e demais) e os encargos trabalhistas estão nos percentuais da lei e da convenção coletiva. A redução veio de custos da própria empresa, como indicado acima.\n\n' +
      '5. GARANTIA ADICIONAL\nEm obras e serviços de engenharia, a empresa está ciente da garantia adicional exigida da proposta inferior a 85% do orçado (art. 59, § 5º).\n\n' +
      '6. PEDIDO\nRequer seja reconhecida a exequibilidade da proposta, com a sua aceitação e o prosseguimento do certame.',
      ['Responder no prazo fixado; se a cotação depende de fornecedor, pedir mais prazo por escrito antes de vencer.',
        'Cotação válida (não vencida), assinada, com local de entrega e frete.', 'Não mexer em quantidades, coeficientes e produtividade das composições do órgão.',
        'Mão de obra no mínimo igual à convenção coletiva; tributos nunca abaixo da lei.', 'Mostrar onde está a economia (insumo, frete, administração central, lucro).',
        'Declaração dos fornecedores de manter o preço durante a execução.']),
    m('declaracoes', 'Declarações comuns', 'Junto com a proposta ou a habilitação, como o edital pedir. Apague as que o edital não exige.',
      [b('l14133', 'art. 63, I, IV e § 1º'), b('l14133', 'art. 68, VI'), b('l14133', 'art. 14'), b('l14133', 'art. 4º, § 2º')],
      [],
      'Ao(À) {{autoridade}} – {{orgao}}\n\nRef.: Edital nº {{numero_edital}} – {{objeto}}\n\nDECLARAÇÕES\n\n' + ABERTURA + ' DECLARA, sob as penas da lei:\n\n' +
      'a) que cumpre plenamente os requisitos de habilitação do edital (art. 63, I, da Lei nº 14.133/2021);\n\n' +
      'b) que cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social, previstas em lei e em outras normas (art. 63, IV);\n\n' +
      'c) que a sua proposta econômica compreende a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição, nas leis trabalhistas, nas normas infralegais, nas convenções coletivas de trabalho e nos termos de ajustamento de conduta vigentes na data de entrega das propostas (art. 63, § 1º);\n\n' +
      'd) que não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre, nem menor de 16 anos, salvo como aprendiz a partir de 14 anos (art. 68, VI, da Lei nº 14.133/2021 e art. 7º, XXXIII, da Constituição);\n\n' +
      'e) que não se enquadra em nenhum dos impedimentos de participação do art. 14 da Lei nº 14.133/2021;\n\n' +
      'f) [só para ME/EPP] que é microempresa ou empresa de pequeno porte e que, no ano-calendário da licitação, ainda não celebrou contratos com a Administração Pública cujos valores somados extrapolem a receita bruta máxima de empresa de pequeno porte (art. 4º, § 2º, da Lei nº 14.133/2021).',
      ['Conferir no edital quais declarações ele pede e em que modelo (alguns sistemas já pedem pelo portal, com um clique).',
        'Declaração falsa é infração e pode levar a inidoneidade (art. 155, VIII, e art. 156, § 5º).', 'Assinatura do representante legal e data.',
        'No plano Empresa, o Kit de proposta já gera as declarações do edital em Word.'],
      { fecho: ASSINATURA }),
  ]);

  const obterModelo = (codigo) => MODELOS.find((x) => x.codigo === codigo) || null;
  // Uma passada só (valor com "{{x}}" não é re-substituído), sem caracteres de controle; texto puro (quem exibe escapa).
  function preencherModelo(modelo, dados) {
    const d = dados || {}, faltando = [];
    const texto = String(modelo?.texto || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (todo, nome) => {
      if (!Object.hasOwn(ROTULOS, nome)) return todo;
      // eslint-disable-next-line no-control-regex -- limpa controle de texto livre (quebra de linha fica)
      const v = d[nome] === null || d[nome] === undefined ? '' : String(d[nome]).replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/[{}]/g, ' ').trim();
      if (v) return v;
      if (!faltando.includes(nome)) faltando.push(nome);
      return `[PREENCHER: ${ROTULOS[nome]}]`;
    });
    return { texto, faltando };
  }

  const api = { REVISAO_JURIDICA, AVISO, ADVOGADO, leiDaPergunta, CATEGORIAS, PERGUNTAS, buscarPerguntas, normalizar, ROTULOS, MODELOS, obterModelo, preencherModelo };
  global.JuridicoBase = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
