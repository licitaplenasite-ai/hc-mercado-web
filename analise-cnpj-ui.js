/* global module */
// Análise por CNPJ (tela "Analisar concorrente" do painel): cabeçalho da Receita, alertas, disputas por item
// (vencidas e não vencidas, com descrição, preço, posição, órgão, data e link) e motivos de desclassificação.
// Dados:
//   - RPC analise_cnpj_participacoes (tabelas historico_*, com a RLS do usuário): PNCP, dados abertos do
//     Compras.gov e arquivo semanal de propostas;
//   - pregoes_gravados_* (extensão "Gravar pregão"): desclassificação/inabilitação com o texto literal;
//   - /api/sancoes-cnpj (CEIS/CNEP) e /api/analise-cnpj (coleta por demanda + fila do robô);
//   - /api/analise-cnpj {acao:"cadastro"} (base aberta da Receita, cache empresas_cadastro) e a tabela
//     historico_contratos_fornecedor (contratos do PNCP por fornecedor; empenhado/pago/faturado do Contratos.gov.br).
// Tudo por textContent (o dado vem de fontes externas). Regras puras exportadas para o node --test.
(function (global) {
  'use strict';
  const moeda = (v) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
  const pct = (v) => (Number.isFinite(v) ? `${(Math.round(v * 10) / 10).toLocaleString('pt-BR')}%` : '—');
  const dataBr = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const cnpjFormatado = (d) => String(d || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const media = (lista) => (lista.length ? lista.reduce((s, x) => s + x, 0) / lista.length : null);

  // Arquivo de propostas: "2" = recusada no julgamento (sem dicionário oficial; ver supabase/analise_cnpj.sql).
  const RECUSADA = '2';
  const cancelado = (p) => /cancel/i.test(p.situacao_resultado || '');
  const precoFinal = (p) => num(p.valor_homologado) ?? num(p.valor_negociado) ?? num(p.valor_lance) ?? num(p.valor_proposta);
  function posicao(p) {
    return num(p.ordem_classificacao) ?? num(p.classificacao);
  }
  // Venceu: 1º colocado não recusado e não cancelado; sem posição (resultado fora de SRP), quem tem valor homologado.
  function venceu(p) {
    if (cancelado(p) || p.situacao_proposta === RECUSADA) return false;
    const pos = posicao(p);
    return pos === null ? num(p.valor_homologado) !== null : pos === 1;
  }
  const fracassadoSendo1o = (p) => posicao(p) === 1 && /fracass/i.test(p.situacao_item || '');

  function agrupar(linhas, chaveDe) {
    const g = new Map();
    for (const p of linhas) {
      const k = chaveDe(p) || 'Não informado';
      const a = g.get(k) || { chave: k, disputas: 0, vencidas: 0, valor: 0, valorDisputado: 0 };
      a.disputas++;
      a.valorDisputado += p._valorDisputado || 0;
      if (p._venceu) { a.vencidas++; a.valor += p._valorGanho || 0; }
      g.set(k, a);
    }
    return [...g.values()].sort((x, y) => y.disputas - x.disputas || y.valor - x.valor);
  }
  // Produto: código do catálogo quando existe; senão o nome do item (descrição até a 1ª vírgula; 2 palavras cortavam "SOLUÇÃO DE").
  const produto = (p) => (p.catmat ? `CATMAT ${p.catmat} · ${String(p.descricao || '').split(/[,;:]/)[0].slice(0, 60)}` : String(p.descricao || '').split(/[,;:]/)[0].replace(/\s+/g, ' ').trim().slice(0, 60).toUpperCase());

  // Sazonalidade: mês do ano (jan-dez, todos os anos somados) da data do resultado ou, sem ela, da publicação.
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function porMesDoAno(itens) {
    const meses = MESES.map((rotulo) => ({ rotulo, disputas: 0, vencidas: 0, valor: 0 }));
    for (const p of itens) {
      const m = /^\d{4}-(\d{2})/.exec(String(p.data_resultado || p.data_publicacao || ''));
      if (!m) continue;
      const a = meses[Number(m[1]) - 1];
      a.disputas++;
      if (p._venceu) { a.vencidas++; a.valor += p._valorGanho || 0; }
    }
    return meses;
  }
  // Marcas que a empresa usa nos itens que venceu (a fonte pública só traz a marca do vencedor).
  function marcasDe(vencidas) {
    const g = new Map();
    for (const p of vencidas) {
      const marca = String(p.marca || '').trim();
      if (!marca) continue;
      const k = marca.toUpperCase();
      const a = g.get(k) || { chave: marca, itens: 0, valor: 0, exemplo: p.descricao || '' };
      a.itens++;
      a.valor += p._valorGanho || 0;
      g.set(k, a);
    }
    return [...g.values()].sort((x, y) => y.itens - x.itens || y.valor - x.valor);
  }

  // linhas: RPC analise_cnpj_participacoes. -> números da tela (puro).
  function resumir(linhas) {
    const itens = (Array.isArray(linhas) ? linhas : []).map((p) => {
      const v = venceu(p);
      const preco = precoFinal(p);
      const qtd = num(p.quantidade_homologada) ?? num(p.quantidade);
      return { ...p, _venceu: v, _posicao: posicao(p) ?? (v ? 1 : null), _preco: preco, _valorGanho: v && preco !== null && qtd !== null ? preco * qtd : 0,
        _valorDisputado: preco !== null && qtd !== null ? preco * qtd : 0,
        _vencedorPreco: num(p.vencedor_valor), _recusada: p.situacao_proposta === RECUSADA, _fracassado1: fracassadoSendo1o(p) };
    });
    const vencidas = itens.filter((p) => p._venceu), naoVencidas = itens.filter((p) => !p._venceu);
    // Preço com que perde vs vencedor: só pares com os dois preços (diferença % item a item).
    const pares = naoVencidas.filter((p) => p._preco > 0 && p._vencedorPreco > 0 && !p._recusada);
    const descontos = vencidas.filter((p) => p._preco > 0 && num(p.valor_estimado) > 0).map((p) => (p._preco / num(p.valor_estimado) - 1) * 100);
    return {
      disputas: itens.length, compras: new Set(itens.map((p) => p.id_compra)).size, vencidas: vencidas.length, naoVencidas: naoVencidas.length,
      vitoria: itens.length ? (vencidas.length / itens.length) * 100 : null, valorGanho: vencidas.reduce((s, p) => s + p._valorGanho, 0),
      valorDisputado: itens.reduce((s, p) => s + p._valorDisputado, 0), porMes: porMesDoAno(itens), marcas: marcasDe(vencidas),
      vitoriasPorProduto: agrupar(vencidas, produto).sort((x, y) => y.vencidas - x.vencidas || y.valor - x.valor),
      precoMedioGanha: media(vencidas.map((p) => p._preco).filter((x) => x > 0)), descontoMedioGanha: media(descontos),
      precoMedioPerde: media(pares.map((p) => p._preco)), precoMedioVencedor: media(pares.map((p) => p._vencedorPreco)),
      diferencaMediaPerde: media(pares.map((p) => (p._preco / p._vencedorPreco - 1) * 100)), paresComparados: pares.length,
      recusadas: itens.filter((p) => p._recusada), fracassados1: itens.filter((p) => p._fracassado1),
      porUf: agrupar(itens, (p) => p.uf), porModalidade: agrupar(itens, (p) => p.modalidade),
      porOrgao: agrupar(itens, (p) => p.orgao_nome || p.unidade_nome || (p.uasg && `UASG ${p.uasg}`)), porProduto: agrupar(itens, produto),
      itensVencidos: vencidas, itensNaoVencidos: naoVencidas,
    };
  }

  // Pregões gravados pela extensão: mensagens do pregoeiro por tipo e situação da proposta lida na página.
  // Lido por um usuário do LicitaPlena, não pelo robô: só é "verificado" com 2+ organizações concordando
  // (leituras_concordantes, supabase/pregoes_gravados.sql). Abaixo disso a tela mostra o selo.
  const DESCLASS = /desclassific|recusad/i, INABIL = /inabilit/i;
  const leituras = (x) => Number(x?.leituras_concordantes) || 1;
  const seloNaoVerificado = (n) => `lido por usuário, não verificado (${n} leitura${n === 1 ? '' : 's'} concordando)`;
  function motivosGravados(mensagens, propostas) {
    const desclass = new Set(), inabil = new Set(), lista = [];
    let naoVerificados = 0;
    for (const m of Array.isArray(mensagens) ? mensagens : []) {
      if (!['recusa', 'desclassificacao', 'inabilitacao'].includes(m.tipo)) continue;
      const k = `${m.id_compra}|${m.numero_item}`;
      (m.tipo === 'inabilitacao' ? inabil : desclass).add(k);
      const pg = m.pregoes_gravados || {};
      if (leituras(m) < 2) naoVerificados += 1;
      lista.push({ chave: k, id_compra: m.id_compra, numero_item: m.numero_item, tipo: m.tipo, texto: m.motivo || m.texto, data: m.data_hora,
        url: pg.url || null, orgao: pg.orgao || null, descricao: pg.itens?.[String(m.numero_item)]?.descricao || null,
        leituras: leituras(m), verificado: leituras(m) >= 2 });
    }
    for (const p of Array.isArray(propostas) ? propostas : []) {
      const k = `${p.id_compra}|${p.numero_item}`;
      const conta = INABIL.test(p.situacao || '') ? inabil : DESCLASS.test(p.situacao || '') ? desclass : null;
      if (!conta) continue;
      conta.add(k);
      if (leituras(p) < 2) naoVerificados += 1;
    }
    return { desclassificacoes: desclass.size, inabilitacoes: inabil.size, lista, chaves: new Set([...desclass, ...inabil]), naoVerificados };
  }

  // Todas as desclassificações/inabilitações/recusas com o motivo LITERAL e a fonte (puro). Nunca inventa motivo:
  // sem texto na fonte, a linha diz "Motivo não registrado" e manda abrir o pregão.
  //   detalhes: RPC analise_cnpj_detalhes (motivo do item no termo de adjudicação do ComprasNet antigo);
  //   pecas: pecas_juridicas da empresa (intenção de recurso, recurso, contrarrazão com a decisão do pregoeiro).
  const ROTULO_PECA = { intencao_recurso: 'Intenção de recurso', recurso: 'Recurso', contrarrazao: 'Contrarrazão' };
  const SOBRE_RECUSA = /desclassific|inabilit|recusad|recusa\b|n[aã]o aceit/i;
  const MAX_MOTIVO = 600;
  const cortar = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > MAX_MOTIVO ? `${x.slice(0, MAX_MOTIVO)}…` : x; };
  function motivosComFonte({ r, mot, detalhes, pecas }) {
    const lista = [];
    const onde = (p) => p.orgao_nome || p.unidade_nome || (p.uasg ? `UASG ${p.uasg}` : '');
    for (const m of mot.lista) {
      lista.push({ item: `${m.numero_item}. ${m.descricao || ''}`.trim(), tipo: ROTULO[m.tipo], texto: m.texto || '', orgao: m.orgao || `Compra ${m.id_compra}`, data: m.data,
        fonte: 'Pregão gravado', selo: m.verificado ? null : seloNaoVerificado(m.leituras), url: m.url });
    }
    const todos = [...r.itensVencidos, ...r.itensNaoVencidos];
    for (const p of todos.filter((x) => cancelado(x) && x.motivo_cancelamento)) {
      lista.push({ item: `${p.numero_item}. ${p.descricao || ''}`.trim(), tipo: 'Resultado cancelado', texto: p.motivo_cancelamento, orgao: onde(p),
        data: p.data_resultado || p.data_publicacao, fonte: 'PNCP (resultado do item)', url: p.link_pncp || p.link_origem });
    }
    const porItem = new Map(todos.map((p) => [`${p.id_compra}|${p.numero_item}`, p]));
    for (const d of Array.isArray(detalhes) ? detalhes : []) {
      const p = porItem.get(`${d.id_compra}|${d.numero_item}`);
      if (!d.motivo_situacao || !p) continue;
      lista.push({ item: `${p.numero_item}. ${p.descricao || ''}`.trim(), tipo: `Item ${String(p.situacao_item || 'cancelado').toLowerCase()}`, texto: d.motivo_situacao, orgao: onde(p),
        data: p.data_resultado || p.data_publicacao, fonte: 'ComprasNet (termo de adjudicação)', url: p.link_origem });
    }
    for (const x of Array.isArray(pecas) ? pecas : []) {
      if (!ROTULO_PECA[x.tipo] || !SOBRE_RECUSA.test(`${x.texto || ''} ${x.resposta || ''}`)) continue;
      const decisao = [x.resultado, x.resposta].filter(Boolean).join(' — ');
      lista.push({ item: x.item ? `Item ${x.item}` : 'Pregão', tipo: ROTULO_PECA[x.tipo], texto: cortar(decisao ? `Decisão: ${decisao}` : x.texto),
        orgao: [x.orgao, x.pregao && `Pregão ${x.pregao}`].filter(Boolean).join(' · '), data: x.data, fonte: 'ComprasNet (recursos do pregão)', url: x.url });
    }
    for (const p of r.recusadas.filter((x) => !mot.chaves.has(`${x.id_compra}|${x.numero_item}`))) {
      lista.push({ item: `${p.numero_item}. ${p.descricao || ''}`.trim(), tipo: 'Recusada (arquivo)', texto: '', orgao: onde(p),
        data: p.data_resultado || p.data_publicacao, fonte: 'Arquivo de propostas do Compras.gov (situação "2", sem motivo)', url: p.link_origem });
    }
    return lista;
  }

  // Contratos do fornecedor (historico_contratos_fornecedor) -> totais e por UF da unidade contratante (puro).
  // Empenhado/liquidado/pago/faturado só existem para contrato federal com registro no Contratos.gov.br.
  function resumirContratos(contratos, hoje) {
    const lista = Array.isArray(contratos) ? contratos : [];
    const soma = (campo, l = lista) => l.reduce((t, c) => t + (num(c[campo]) || 0), 0);
    const vigente = (c) => Boolean(c.vigencia_fim) && c.vigencia_fim >= hoje;
    const comGov = lista.filter((c) => num(c.valor_empenhado) !== null || num(c.valor_pago) !== null);
    const porUf = new Map();
    for (const c of lista) {
      const k = c.uf || 'Não informado';
      const a = porUf.get(k) || { chave: k, contratos: 0, valor: 0, vigentes: 0 };
      a.contratos++;
      a.valor += num(c.valor_global) || 0;
      if (vigente(c)) a.vigentes++;
      porUf.set(k, a);
    }
    return { total: lista.length, valorContratado: soma('valor_global'), vigentes: lista.filter(vigente).length,
      encerrados: lista.filter((c) => Boolean(c.vigencia_fim) && c.vigencia_fim < hoje).length,
      maiorContrato: lista.reduce((m, c) => Math.max(m, num(c.valor_global) || 0), 0),
      federaisComValores: comGov.length, valorContratadoFederal: soma('valor_global', comGov), empenhado: soma('valor_empenhado', comGov),
      liquidado: soma('valor_liquidado', comGov), pago: soma('valor_pago', comGov), faturado: soma('valor_faturado', comGov),
      porUf: [...porUf.values()].sort((x, y) => y.valor - x.valor || y.contratos - x.contratos), lista };
  }

  // Alerta de vulnerabilidade (puro): o que o ConLicitação mostra no topo (desclassificações, inabilitações, sanções)
  // mais sinais cadastrais. nivel: 'alto' (pode impedir de contratar) | 'medio' (atenção) | 'info'.
  // Capital: a Lei 14.133 (art. 69, §4º) deixa o edital exigir capital ou patrimônio mínimo de até 10% do valor estimado;
  // capital abaixo de 10% do maior contrato já assinado é sinal de que pode não passar nessa exigência.
  const MS_DIA = 864e5;
  const TETO_MEI = 81000;
  function alertasCadastro(cadastro, maior, hoje) {
    const a = [];
    const situacao = String(cadastro.situacao || '').toUpperCase();
    if (situacao && situacao !== 'ATIVA') {
      const motivo = cadastro.motivo_situacao && !/sem motivo/i.test(cadastro.motivo_situacao) ? ` (${cadastro.motivo_situacao})` : '';
      a.push({ nivel: 'alto', texto: `Situação cadastral na Receita: ${cadastro.situacao}${cadastro.data_situacao ? ` desde ${dataBr(cadastro.data_situacao)}` : ''}${motivo}.` });
    }
    if (cadastro.situacao_especial) a.push({ nivel: 'alto', texto: `Situação especial na Receita: ${cadastro.situacao_especial}.` });
    const idadeDias = /^\d{4}-\d{2}-\d{2}$/.test(String(cadastro.data_abertura || '')) ? (Date.parse(hoje) - Date.parse(cadastro.data_abertura)) / MS_DIA : null;
    if (idadeDias !== null && idadeDias >= 0 && idadeDias < 365) {
      a.push({ nivel: 'medio', texto: `Empresa aberta há ${Math.floor(idadeDias / 30)} mês(es) (${dataBr(cadastro.data_abertura)}): pode não ter atestado de capacidade técnica nem balanço.` });
    }
    const capital = num(cadastro.capital_social);
    if (capital !== null && maior > 0 && capital < maior * 0.1) {
      a.push({ nivel: 'medio', texto: `Capital social de ${moeda(capital)} é menos de 10% do maior contrato dela (${moeda(maior)}): editais que exigem capital mínimo (até 10%, Lei 14.133 art. 69 §4º) podem barrá-la.` });
    }
    if (cadastro.opcao_mei && maior > TETO_MEI) a.push({ nivel: 'medio', texto: `Optante pelo MEI com contrato de ${moeda(maior)}: acima do teto anual do MEI (R$ 81 mil).` });
    return a;
  }
  function alertasVulnerabilidade({ cadastro, sancoes, resumo, mot, contratos, hoje }) {
    const a = [];
    const vig = (sancoes && sancoes.vigentes) || [], exp = (sancoes && sancoes.expiradas) || [];
    if (vig.length) a.push({ nivel: 'alto', texto: `${vig.length} sanção(ões) vigente(s) no CEIS/CNEP (${vig.map((x) => x.orgao_sancionador).filter(Boolean).slice(0, 2).join('; ') || 'órgão não informado'}).` });
    else if (exp.length) a.push({ nivel: 'info', texto: `${exp.length} sanção(ões) já encerrada(s) no CEIS/CNEP: histórico, não impede contratar.` });
    if (cadastro) a.push(...alertasCadastro(cadastro, contratos ? contratos.maiorContrato : 0, hoje));
    if (mot && resumo) {
      const recusas = mot.desclassificacoes + mot.inabilitacoes + resumo.recusadas.filter((p) => !mot.chaves.has(`${p.id_compra}|${p.numero_item}`)).length;
      if (resumo.disputas >= 5 && recusas / resumo.disputas >= 0.2) {
        a.push({ nivel: 'medio', texto: `${recusas} desclassificação(ões)/inabilitação(ões)/recusa(s) em ${resumo.disputas} disputas (${pct((recusas / resumo.disputas) * 100)}).` });
      }
    }
    return a;
  }

  // ---------- Tela ----------
  function el(doc, tag, attrs, ...filhos) {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'texto') e.textContent = v; else e.setAttribute(k, v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(typeof f === 'string' ? doc.createTextNode(f) : f);
    return e;
  }
  const link = (doc, href, texto) => (/^https:\/\//.test(String(href || '')) ? el(doc, 'a', { href, target: '_blank', rel: 'noopener', class: 'link-pncp', texto }) : null);
  const rolavel = (doc, tabela) => el(doc, 'div', { style: 'overflow-x:auto;-webkit-overflow-scrolling:touch' }, tabela);
  const cartao = (doc, titulo, valor) => el(doc, 'div', { class: 'cartao' }, el(doc, 'h3', { texto: titulo }), el(doc, 'div', { class: 'valor', texto: valor }));

  // Ficha da BrasilAPI que o painel já buscou -> mesmo formato de empresas_cadastro (quando o cache não respondeu).
  const cadastroDaFicha = (ficha) => (ficha ? { razao_social: ficha.razao_social, municipio: ficha.municipio, uf: ficha.uf, porte: ficha.descricao_porte || ficha.porte,
    situacao: ficha.descricao_situacao_cadastral, cnae_principal: ficha.cnae_fiscal ? { codigo: String(ficha.cnae_fiscal), descricao: ficha.cnae_fiscal_descricao } : null,
    cnaes_secundarios: (ficha.cnaes_secundarios || []).filter((x) => x && x.codigo).map((x) => ({ codigo: String(x.codigo), descricao: x.descricao })),
    data_abertura: ficha.data_inicio_atividade, capital_social: num(ficha.capital_social), natureza_juridica: ficha.natureza_juridica, socios: [] } : null);

  // cad: linha de empresas_cadastro (via /api/analise-cnpj); sem ela, a ficha da BrasilAPI.
  function cabecalho(doc, cnpj, cad, ficha) {
    const caixa = el(doc, 'div', { class: 'acn-cabecalho' });
    const c = cad || cadastroDaFicha(ficha);
    if (!c) {
      caixa.append(el(doc, 'p', { class: 'dica-clique', texto: `CNPJ ${cnpjFormatado(cnpj)} — dados cadastrais da Receita indisponíveis agora (a base aberta não respondeu ou o CNPJ não existe nela).` }));
      return caixa;
    }
    const cnaes = [c.cnae_principal && `${c.cnae_principal.codigo} — ${c.cnae_principal.descricao || ''} (principal)`, ...(c.cnaes_secundarios || []).map((x) => `${x.codigo} — ${x.descricao || ''}`)].filter(Boolean);
    const campo = (rotulo, valor) => el(doc, 'li', {}, el(doc, 'strong', { texto: `${rotulo}: ` }), valor || '—');
    const fonte = cad ? `${cad.fonte === 'minhareceita' ? 'minhareceita.org' : 'BrasilAPI'}, consultada em ${dataBr(cad.consultado_em)}` : 'BrasilAPI';
    caixa.append(el(doc, 'h3', { texto: 'Dados da empresa' }), el(doc, 'h4', { style: 'margin:0 0 4px', texto: c.razao_social || '—' }),
      el(doc, 'p', { style: 'margin:0', texto: [`CNPJ ${cnpjFormatado(cnpj)}`, [c.municipio, c.uf].filter(Boolean).join('/'), c.porte, c.situacao && `Situação: ${c.situacao}`].filter(Boolean).join(' · ') }),
      el(doc, 'ul', { class: 'ficha-lista acn-cadastro' },
        campo('Situação cadastral', [c.situacao, c.data_situacao && `desde ${dataBr(c.data_situacao)}`, c.situacao_especial && `situação especial: ${c.situacao_especial}`].filter(Boolean).join(' · ')),
        campo('Abertura', c.data_abertura ? dataBr(c.data_abertura) : null),
        campo('Capital social', num(c.capital_social) === null ? null : moeda(num(c.capital_social))),
        campo('Porte', [c.porte, c.opcao_mei ? 'MEI' : c.opcao_simples ? 'Simples Nacional' : null].filter(Boolean).join(' · ')),
        campo('Natureza jurídica', c.natureza_juridica),
        campo('CNAE principal', c.cnae_principal ? `${c.cnae_principal.codigo} — ${c.cnae_principal.descricao || ''}` : null)),
      cnaes.length > 1 ? el(doc, 'details', {}, el(doc, 'summary', { texto: `CNAEs (${cnaes.length})` }), el(doc, 'ul', { class: 'ficha-lista' }, cnaes.map((x) => el(doc, 'li', { texto: x })))) : null,
      (c.socios || []).length ? el(doc, 'details', {}, el(doc, 'summary', { texto: `Sócios e administradores (${c.socios.length})` }),
        el(doc, 'ul', { class: 'ficha-lista' }, c.socios.map((x) => el(doc, 'li', { texto: [x.nome, x.qualificacao, x.entrada && `desde ${dataBr(x.entrada)}`].filter(Boolean).join(' — ') })))) : null,
      el(doc, 'p', { class: 'dica-clique', style: 'margin:4px 0 0', texto: `Fonte: base aberta de CNPJ da Receita Federal (${fonte}). Sócios: só o nome como a Receita publica; CPF não é guardado.` }));
    return caixa;
  }

  // Seções da tela, na ordem que o licitante lê (pedido do dono, 20/11/2026): dados, alertas, desempenho, contratos,
  // pagamentos federais, onde atua. Título simples e números explicados em frase; nada de jargão de robô.
  const secao = (doc, classe, titulo, ...filhos) => el(doc, 'div', { class: `acn-secao ${classe}` }, el(doc, 'h3', { texto: titulo }), ...filhos);
  const dica = (doc, texto) => el(doc, 'p', { class: 'dica-clique', texto });

  const ROTULO_NIVEL = { alto: 'Alto', medio: 'Atenção', info: 'Info' };
  function blocoAlertas(doc, alertas, sanc, hoje, LicitaSancoes) {
    const caixa = secao(doc, 'acn-alertas', 'Alertas');
    if (sanc && sanc.erro) caixa.append(el(doc, 'p', { class: 'aviso', texto: 'Não foi possível consultar agora a lista de empresas punidas pelo governo (CEIS/CNEP). Tente de novo mais tarde.' }));
    else if (sanc && LicitaSancoes) { const selo = LicitaSancoes.montarSelo(doc, sanc, hoje); if (selo) caixa.append(selo); }
    if (alertas.length) {
      caixa.append(el(doc, 'ul', { class: 'ficha-lista' }, alertas.map((x) => el(doc, 'li', { class: x.nivel === 'alto' ? 'aviso' : null, 'data-nivel': x.nivel },
        el(doc, 'strong', { texto: `${ROTULO_NIVEL[x.nivel]}: ` }), x.texto))));
    } else if (!(sanc && sanc.erro)) {
      caixa.append(el(doc, 'p', { texto: 'Nenhum alerta: a empresa não está na lista de punidas do governo (CEIS/CNEP) e não encontramos problema no cadastro da Receita.' }));
    }
    caixa.append(dica(doc, 'Certidões (CND federal, FGTS, trabalhista) não são consultadas aqui: confira no SICAF.'));
    return caixa;
  }

  // Frases do desempenho em português simples (puro).
  function explicarDesempenho(r) {
    if (!r.disputas) return ['Ainda não encontramos disputas desta empresa no histórico.'];
    const f = [`Ela disputou ${r.disputas} item(ns) em ${r.compras} licitação(ões) e ganhou ${r.vencidas}: ${pct(r.vitoria)} de vitória.`];
    if (r.vencidas) f.push(`Somando os itens que ganhou, levou ${moeda(r.valorGanho)}.`);
    if (Number.isFinite(r.descontoMedioGanha)) f.push(`Quando ganha, o preço dela fica em média ${pct(Math.abs(r.descontoMedioGanha))} ${r.descontoMedioGanha <= 0 ? 'abaixo' : 'acima'} do valor estimado pelo órgão.`);
    if (r.paresComparados) f.push(`Quando perde, o preço dela fica em média ${pct(Math.abs(r.diferencaMediaPerde))} ${r.diferencaMediaPerde >= 0 ? 'acima' : 'abaixo'} do preço de quem ganhou (comparados ${r.paresComparados} item(ns)).`);
    return f;
  }
  // Órgãos onde ela mais perde (puro): mais derrotas primeiro.
  const ondePerde = (r) => r.porOrgao.map((g) => ({ ...g, perdidas: g.disputas - g.vencidas })).filter((g) => g.perdidas > 0)
    .sort((x, y) => y.perdidas - x.perdidas || y.disputas - x.disputas);

  function blocoDesempenho(doc, r, motivos, selos) {
    const perde = r.paresComparados ? `${pct(Math.abs(r.diferencaMediaPerde))} ${r.diferencaMediaPerde >= 0 ? 'acima' : 'abaixo'}` : null;
    const caixa = secao(doc, 'acn-desempenho', 'Desempenho em licitações',
      el(doc, 'div', { class: 'cartoes' }, cartao(doc, 'Itens disputados', String(r.disputas)), cartao(doc, 'Vitórias', String(r.vencidas)),
        cartao(doc, '% de vitória', pct(r.vitoria)), cartao(doc, 'Valor ganho', moeda(r.valorGanho)), perde ? cartao(doc, 'Quando perde, preço dela vs. o vencedor', perde) : null),
      el(doc, 'ul', { class: 'ficha-lista' }, explicarDesempenho(r).map((t) => el(doc, 'li', { texto: t }))));
    const perdas = ondePerde(r);
    if (perdas.length) {
      caixa.append(el(doc, 'h4', { texto: 'Onde ela mais perde' }), rolavel(doc, el(doc, 'table', {},
        el(doc, 'tr', {}, ['Órgão', 'Disputas', 'Perdeu', 'Ganhou'].map((t) => el(doc, 'th', { texto: t }))),
        perdas.slice(0, 10).map((g) => el(doc, 'tr', {}, el(doc, 'td', { texto: g.chave }), el(doc, 'td', { texto: String(g.disputas) }),
          el(doc, 'td', { texto: String(g.perdidas) }), el(doc, 'td', { texto: String(g.vencidas) }))))));
    }
    const detalhe = (titulo, ...filhos) => el(doc, 'details', { class: 'acn-grupo' }, el(doc, 'summary', { texto: titulo }), ...filhos);
    caixa.append(
      detalhe(`Itens que ela ganhou (${r.itensVencidos.length})`, tabelaItens(doc, 'Itens que ganhou', r.itensVencidos, false)),
      detalhe(`Itens que ela perdeu e quem ganhou (${r.itensNaoVencidos.length})`, tabelaItens(doc, 'Itens que perdeu', r.itensNaoVencidos, true, selos)),
      detalhe(`Desclassificações e inabilitações (${motivos.length})`, blocoMotivos(doc, motivos)),
      detalhe('Em que meses ela disputa', blocoSazonalidade(doc, r)));
    return caixa;
  }

  // Contrato: vigente (fim no futuro), encerrado (fim no passado) ou sem data de fim publicada.
  const situacaoContrato = (c, hoje) => (!c.vigencia_fim ? 'Sem data de fim' : c.vigencia_fim >= hoje ? 'Vigente' : 'Encerrado');
  function blocoContratos(doc, c, hoje) {
    const caixa = secao(doc, 'acn-contratos', 'Contratos com o governo');
    if (!c.total) { caixa.append(dica(doc, 'Nenhum contrato desta empresa encontrado ainda no Portal Nacional de Contratações Públicas (PNCP).')); return caixa; }
    caixa.append(el(doc, 'div', { class: 'cartoes' }, cartao(doc, 'Contratos vigentes', String(c.vigentes)), cartao(doc, 'Contratos encerrados', String(c.encerrados)),
      cartao(doc, 'Valor total dos contratos', moeda(c.valorContratado)), c.federaisComValores ? cartao(doc, 'Já pago (contratos federais)', moeda(c.pago)) : null));
    caixa.append(rolavel(doc, el(doc, 'table', {},
      el(doc, 'tr', {}, ['Situação', 'Órgão', 'O que foi contratado', 'Valor', 'Vigência', 'Ver'].map((t) => el(doc, 'th', { texto: t }))),
      c.lista.slice(0, MAX_LINHAS).map((x) => {
        const gov = Number(x.contratos_gov_id);
        return el(doc, 'tr', {}, el(doc, 'td', { texto: situacaoContrato(x, hoje) }),
          el(doc, 'td', { texto: [x.unidade_nome || x.orgao_nome, x.uf].filter(Boolean).join(' / ') || '—' }),
          el(doc, 'td', { texto: x.objeto || 'Não informado' }), el(doc, 'td', { texto: moeda(num(x.valor_global)) }),
          el(doc, 'td', { texto: `${dataBr(x.vigencia_inicio || x.data_assinatura)} a ${dataBr(x.vigencia_fim)}` }),
          el(doc, 'td', {}, link(doc, x.link_pncp, 'PNCP'), gov > 0 ? ' · ' : null, gov > 0 ? link(doc, `https://contratos.comprasnet.gov.br/api/contrato/id/${gov}`, 'Contratos.gov.br') : null));
      }))));
    if (c.total > MAX_LINHAS) caixa.append(dica(doc, `Mostrando os ${MAX_LINHAS} mais recentes de ${c.total}; os totais contam todos.`));
    caixa.append(dica(doc, 'Fonte: PNCP. "Já pago" só existe para contrato federal registrado no Contratos.gov.br.'));
    return caixa;
  }

  // Pagamentos do governo federal (/api/despesas-fornecedor, o mesmo do Raio-X Financeiro), dentro da própria análise.
  function conteudoPagamentos(doc, d) {
    if (!d || (d.erro && !d.totalDocumentos)) return el(doc, 'p', { class: 'aviso', texto: 'Não foi possível consultar o Portal da Transparência agora. Tente de novo mais tarde.' });
    if (!d.totalDocumentos) return el(doc, 'p', { texto: 'Nenhum pagamento do governo federal a esta empresa nos últimos 4 anos. Ela pode vender só para estados e municípios, que não aparecem nesta fonte.' });
    const anos = Object.keys(d.porAno || {}).sort().reverse();
    const docs = Array.isArray(d.documentos) ? d.documentos : [];
    return el(doc, 'div', {},
      el(doc, 'div', { class: 'cartoes' }, cartao(doc, d.parcial ? 'Total recebido (pelo menos)' : 'Total recebido', moeda(Number(d.totalPago))), anos.map((a) => cartao(doc, `Em ${a}`, moeda(Number(d.porAno[a]))))),
      d.erro || d.parcial ? dica(doc, 'Parte da consulta não respondeu ou passou do limite: o total pode ser maior.') : null,
      rolavel(doc, el(doc, 'table', {}, el(doc, 'tr', {}, ['Data', 'Órgão que pagou', 'Unidade', 'Valor'].map((t) => el(doc, 'th', { texto: t }))),
        docs.map((x) => el(doc, 'tr', {}, el(doc, 'td', { texto: dataBr(x.data) }), el(doc, 'td', { texto: x.orgao || '—' }), el(doc, 'td', { texto: x.unidadeGestora || '—' }), el(doc, 'td', { texto: moeda(Number(x.valor)) }))))),
      d.totalDocumentos > docs.length ? dica(doc, `Mostrando os ${docs.length} pagamentos mais recentes de ${d.totalDocumentos}.`) : null);
  }
  function blocoPagamentos(doc, promessa) {
    const corpo = el(doc, 'div', { class: 'carregando', texto: 'Consultando o Portal da Transparência…' });
    const caixa = secao(doc, 'acn-pagamentos', 'Quanto essa empresa já recebeu do governo federal',
      dica(doc, 'Dinheiro que o governo federal já pagou de fato a esta empresa nos últimos 4 anos (não é o valor do contrato assinado). Fonte: Portal da Transparência.'), corpo);
    if (!promessa) corpo.replaceWith(conteudoPagamentos(doc, null));
    else promessa.then((d) => corpo.replaceWith(conteudoPagamentos(doc, d)), () => corpo.replaceWith(conteudoPagamentos(doc, null)));
    return caixa;
  }

  function blocoOndeAtua(doc, r, ct) {
    const caixa = secao(doc, 'acn-onde-atua', 'Onde atua e o que vende');
    caixa.append(tabelaGrupo(doc, 'Estados onde disputa', r.porUf) || '', tabelaGrupo(doc, 'Órgãos onde disputa', r.porOrgao) || '');
    if (ct.porUf.length) caixa.append(el(doc, 'details', { class: 'acn-grupo' }, el(doc, 'summary', { texto: `Estados onde tem contrato (${ct.porUf.length})` }), rolavel(doc, el(doc, 'table', {},
      el(doc, 'tr', {}, ['Estado', 'Contratos', 'Vigentes', 'Valor'].map((t) => el(doc, 'th', { texto: t }))),
      ct.porUf.map((g) => el(doc, 'tr', {}, el(doc, 'td', { texto: g.chave }), el(doc, 'td', { texto: String(g.contratos) }), el(doc, 'td', { texto: String(g.vigentes) }), el(doc, 'td', { texto: moeda(g.valor) })))))));
    const vit = r.vitoriasPorProduto;
    caixa.append(el(doc, 'h4', { texto: 'Produtos que ela mais ganha' }), vit.length ? rolavel(doc, el(doc, 'table', {}, el(doc, 'tr', {}, ['Produto', 'Vitórias', 'Disputas', 'Valor ganho'].map((t) => el(doc, 'th', { texto: t }))),
      vit.slice(0, 20).map((g) => el(doc, 'tr', {}, el(doc, 'td', { texto: g.chave }), el(doc, 'td', { texto: String(g.vencidas) }),
        el(doc, 'td', { texto: String((r.porProduto.find((x) => x.chave === g.chave) || g).disputas) }), el(doc, 'td', { texto: moeda(g.valor) })))))
      : dica(doc, 'Nenhuma vitória no histórico ainda.'));
    caixa.append(el(doc, 'h4', { texto: `Marcas que ela oferece (${r.marcas.length})` }), r.marcas.length ? rolavel(doc, el(doc, 'table', {}, el(doc, 'tr', {}, ['Marca', 'Itens ganhos', 'Valor ganho', 'Exemplo de item'].map((t) => el(doc, 'th', { texto: t }))),
      r.marcas.slice(0, 30).map((m) => el(doc, 'tr', {}, el(doc, 'td', { texto: m.chave }), el(doc, 'td', { texto: String(m.itens) }), el(doc, 'td', { texto: moeda(m.valor) }), el(doc, 'td', { texto: m.exemplo })))))
      : dica(doc, 'O governo só publica a marca de quem ganhou o item; nenhuma marca publicada ainda para esta empresa.'));
    return caixa;
  }

  function tabelaGrupo(doc, titulo, grupos) {
    if (!grupos.length) return null;
    return el(doc, 'details', { class: 'acn-grupo' }, el(doc, 'summary', { texto: `${titulo} (${grupos.length})` }), rolavel(doc, el(doc, 'table', {},
      el(doc, 'tr', {}, ['', 'Disputas', 'Vitórias', '% vitória', 'Valor ganho'].map((t) => el(doc, 'th', { texto: t || titulo }))),
      grupos.slice(0, 30).map((g) => el(doc, 'tr', {}, el(doc, 'td', { texto: g.chave }), el(doc, 'td', { texto: String(g.disputas) }),
        el(doc, 'td', { texto: String(g.vencidas) }), el(doc, 'td', { texto: pct((g.vencidas / g.disputas) * 100) }), el(doc, 'td', { texto: moeda(g.valor) }))))));
  }

  // Coleta ainda em andamento: aviso curto, sem detalhe técnico do robô.
  function blocoColeta(doc, coleta, aoAtualizar) {
    if (!coleta || coleta.situacao === 'completo') return null;
    // Erro (ex.: cota diária de consultas, 429): diz que pode faltar coisa, sem o detalhe técnico.
    if (coleta.erro) return el(doc, 'div', { class: 'aviso acn-coleta', role: 'status', texto: 'Não conseguimos buscar licitações novas desta empresa agora; mostrando o que já temos. Tente de novo mais tarde.' });
    const b = el(doc, 'button', { type: 'button', class: 'btn-imprimir', texto: 'Atualizar' });
    b.addEventListener('click', aoAtualizar);
    return el(doc, 'div', { class: 'aviso acn-coleta', role: 'status' }, 'Ainda estamos juntando o histórico completo desta empresa; volte mais tarde para ver mais disputas. ', b);
  }

  const MAX_LINHAS = 100;
  // Selo CEIS/CNEP do vencedor (sancoes-ui.js) quando ele tem sanção; selos = { resultados, hoje, LicitaSancoes } da consulta em lote.
  const seloDoVencedor = (doc, selos, ni) => {
    const res = selos && ni && selos.resultados && selos.resultados[ni];
    return res ? selos.LicitaSancoes.montarSelo(doc, res, selos.hoje) : null;
  };
  // CNPJs dos vencedores das linhas que a tabela mostra (até 200, o teto do endpoint em lote).
  const cnpjsDosVencedores = (itens) => [...new Set(itens.slice(0, MAX_LINHAS).map((p) => p.vencedor_ni).filter((ni) => /^\d{14}$/.test(String(ni || ''))))].slice(0, 200);

  function tabelaItens(doc, titulo, itens, perdidos, selos) {
    const caixa = el(doc, 'div', {}, el(doc, 'h3', { texto: `${titulo} (${itens.length})` }));
    if (!itens.length) { caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Nenhum no histórico guardado.' })); return caixa; }
    const cab = ['Item', 'Qtd', 'Preço unit.', ...(perdidos ? ['Vencedor (preço)'] : []), 'Posição', 'Órgão', 'Data', 'Fonte'];
    const linhas = itens.slice(0, MAX_LINHAS).map((p) => el(doc, 'tr', {},
      el(doc, 'td', { texto: `${p.numero_item}. ${p.descricao || 'Descrição não informada pela fonte'}` }),
      el(doc, 'td', { texto: num(p.quantidade_homologada ?? p.quantidade) === null ? '—' : `${Number(p.quantidade_homologada ?? p.quantidade).toLocaleString('pt-BR')} ${p.unidade || ''}`.trim() }),
      el(doc, 'td', { texto: moeda(p._preco) }),
      perdidos ? el(doc, 'td', {}, p.vencedor_nome ? `${p.vencedor_nome} (${moeda(p._vencedorPreco)})` : '—', seloDoVencedor(doc, selos, p.vencedor_ni)) : null,
      el(doc, 'td', { texto: p._recusada ? 'recusada' : p._fracassado1 ? '1º (item fracassado)' : p._posicao ? `${p._posicao}º` : '—' }),
      el(doc, 'td', { texto: [p.orgao_nome || p.unidade_nome, p.uf].filter(Boolean).join(' / ') || (p.uasg ? `UASG ${p.uasg}` : '—') }),
      el(doc, 'td', { texto: dataBr(p.data_resultado || p.data_publicacao) }),
      el(doc, 'td', {}, link(doc, p.link_pncp, 'PNCP'), p.link_pncp && p.link_origem ? ' · ' : null, link(doc, p.link_origem, 'Compras.gov'))));
    caixa.append(rolavel(doc, el(doc, 'table', {}, el(doc, 'tr', {}, cab.map((t) => el(doc, 'th', { texto: t }))), linhas)));
    if (itens.length > MAX_LINHAS) caixa.append(el(doc, 'p', { class: 'dica-clique', texto: `Mostrando os ${MAX_LINHAS} mais recentes de ${itens.length}.` }));
    return caixa;
  }

  const ROTULO = { recusa: 'Recusa', desclassificacao: 'Desclassificação', inabilitacao: 'Inabilitação' };
  function blocoMotivos(doc, motivos) {
    const caixa = el(doc, 'div', { class: 'acn-motivos' }, el(doc, 'h3', { texto: `Motivos de desclassificação / inabilitação (${motivos.length})` }));
    if (!motivos.length) { caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Nenhuma desclassificação ou inabilitação registrada no histórico guardado.' })); return caixa; }
    const linhas = motivos.slice(0, MAX_LINHAS).map((m) => el(doc, 'tr', {}, el(doc, 'td', { texto: m.item }), el(doc, 'td', { texto: m.tipo }),
      el(doc, 'td', { texto: m.texto || 'Motivo não registrado — abra o pregão' }), el(doc, 'td', { texto: m.orgao || '—' }), el(doc, 'td', { texto: dataBr(m.data) }),
      el(doc, 'td', {}, link(doc, m.url, m.fonte) || m.fonte, m.selo ? el(doc, 'small', { class: 'selo-nao-verificado', texto: ` ${m.selo}` }) : null)));
    caixa.append(rolavel(doc, el(doc, 'table', {}, el(doc, 'tr', {}, ['Item', 'Tipo', 'Motivo (texto literal da fonte)', 'Órgão', 'Data', 'Fonte'].map((t) => el(doc, 'th', { texto: t }))), linhas)));
    if (motivos.length > MAX_LINHAS) caixa.append(el(doc, 'p', { class: 'dica-clique', texto: `Mostrando ${MAX_LINHAS} de ${motivos.length}; a planilha traz todos.` }));
    return caixa;
  }

  // Sazonalidade: colunas do mini-gráfico do painel (.mini-grafico), altura = disputas; rótulo "vencidas/disputas".
  function blocoSazonalidade(doc, r) {
    const caixa = el(doc, 'div', { class: 'acn-sazonalidade' }, el(doc, 'h3', { texto: 'Sazonalidade: em que meses disputa e vence' }));
    const maior = Math.max(0, ...r.porMes.map((m) => m.disputas));
    if (!maior) { caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Sem datas nas disputas guardadas ainda.' })); return caixa; }
    // Em 375 px as 12 colunas não cabem com os rótulos: o gráfico rola dentro da caixa, a página não.
    caixa.append(rolavel(doc, el(doc, 'div', { class: 'mini-grafico', style: 'min-width:420px', role: 'img', 'aria-label': r.porMes.map((m) => `${m.rotulo}: ${m.vencidas} vitória(s) em ${m.disputas} disputa(s)`).join('; ') },
      r.porMes.map((m) => el(doc, 'div', { class: 'mini-grafico-coluna', title: `${m.rotulo}: ${m.vencidas} vitória(s) em ${m.disputas} disputa(s) · ${moeda(m.valor)}` },
        el(doc, 'div', { class: 'mini-grafico-valor', texto: `${m.vencidas}/${m.disputas}` }),
        el(doc, 'div', { class: 'mini-grafico-barra', style: `height:${Math.max(m.disputas ? 4 : 0, Math.round((m.disputas / maior) * 100))}%` }),
        el(doc, 'div', { class: 'mini-grafico-rotulo', texto: m.rotulo }))))));
    caixa.append(el(doc, 'p', { class: 'dica-clique', texto: 'Barra = disputas no mês (todos os anos guardados somados); número = vitórias/disputas. Data do resultado ou, sem ela, da publicação.' }));
    return caixa;
  }

  // Relatório da empresa em abas de planilha (puro): [{ nome, linhas: [[...]] }]. Números ficam como número.
  function planilhaRelatorio({ cnpj, cad, r, motivos, ct, hoje }) {
    const n = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : '');
    const grupos = (gs) => [['', 'Disputas', 'Vencidas', '% vitória', 'Valor disputado (R$)', 'Valor vencido (R$)'], ...gs.map((g) => [g.chave, g.disputas, g.vencidas, n((g.vencidas / g.disputas) * 100), n(g.valorDisputado), n(g.valor)])];
    const itens = [...r.itensVencidos, ...r.itensNaoVencidos];
    return [
      { nome: 'Resumo', linhas: [['Relatório da empresa — LicitaPlena', ''], ['CNPJ', cnpjFormatado(cnpj)], ['Razão social', cad?.razao_social || ''], ['Situação na Receita', cad?.situacao || ''],
        ['Gerado em', hoje || ''], ['Disputas (itens)', r.disputas], ['Contratações', r.compras], ['Vencidas', r.vencidas], ['Não vencidas', r.naoVencidas],
        ['% de vitória', n(r.vitoria)], ['Valor disputado (R$)', n(r.valorDisputado)], ['Valor vencido (R$)', n(r.valorGanho)], ['Desclassificações/inabilitações/recusas listadas', motivos.length],
        ['Contratos (PNCP)', ct.total], ['Valor contratado (R$)', n(ct.valorContratado)],
        ['Fontes', 'PNCP, Compras.gov (dados abertos e Pesquisa de Preços), ComprasNet antigo, pregões gravados pela extensão, Receita Federal, Contratos.gov.br']] },
      { nome: 'Por modalidade', linhas: grupos(r.porModalidade) },
      { nome: 'Por UF', linhas: grupos(r.porUf) },
      { nome: 'Sazonalidade', linhas: [['Mês', 'Disputas', 'Vencidas', 'Valor vencido (R$)'], ...r.porMes.map((m) => [m.rotulo, m.disputas, m.vencidas, n(m.valor)])] },
      { nome: 'Materiais', linhas: [['Material / CATMAT', 'Vitórias', 'Valor vencido (R$)'], ...r.vitoriasPorProduto.map((g) => [g.chave, g.vencidas, n(g.valor)])] },
      { nome: 'Marcas', linhas: [['Marca', 'Itens vencidos', 'Valor vencido (R$)', 'Exemplo de item'], ...r.marcas.map((m) => [m.chave, m.itens, n(m.valor), m.exemplo])] },
      { nome: 'Motivos', linhas: [['Item', 'Tipo', 'Motivo (literal)', 'Órgão', 'Data', 'Fonte', 'Link'], ...motivos.map((m) => [m.item, m.tipo, m.texto || 'Motivo não registrado', m.orgao, dataBr(m.data), [m.fonte, m.selo].filter(Boolean).join(' — '), m.url || ''])] },
      { nome: 'Disputas', linhas: [['Compra', 'Item', 'Descrição', 'Resultado', 'Posição', 'Preço unit. (R$)', 'Quantidade', 'Valor disputado (R$)', 'Marca', 'Vencedor', 'Preço do vencedor (R$)', 'Modalidade', 'Órgão', 'UF', 'Data', 'Link'],
        ...itens.map((p) => [p.id_compra, p.numero_item, p.descricao || '', p._venceu ? 'Venceu' : p._recusada ? 'Recusada' : 'Não venceu', p._posicao ?? '', n(p._preco),
          num(p.quantidade_homologada ?? p.quantidade) ?? '', n(p._valorDisputado), p.marca || '', p.vencedor_nome || '', n(p._vencedorPreco), p.modalidade || '',
          p.orgao_nome || p.unidade_nome || '', p.uf || '', dataBr(p.data_resultado || p.data_publicacao), p.link_pncp || p.link_origem || ''])] },
      { nome: 'Contratos', linhas: [['Contrato', 'Objeto', 'Contratante', 'UF', 'Assinatura', 'Vigência até', 'Valor global (R$)', 'Empenhado (R$)', 'Pago (R$)', 'Link'],
        ...ct.lista.map((x) => [x.numero || '', x.objeto || '', x.unidade_nome || x.orgao_nome || '', x.uf || '', dataBr(x.data_assinatura), dataBr(x.vigencia_fim),
          n(num(x.valor_global)), n(num(x.valor_empenhado)), n(num(x.valor_pago)), x.link_pncp || ''])] },
    ];
  }

  // Baixa a planilha: .xlsx pelo SheetJS do painel (window.XLSX); sem ele, uma aba por arquivo seria ruim, então CSV só do resumo + disputas.
  function baixarPlanilha(doc, abas, nome) {
    const X = global.XLSX;
    if (X) {
      const wb = X.utils.book_new();
      for (const a of abas) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(a.linhas), a.nome);
      X.writeFile(wb, `${nome}.xlsx`);
      return;
    }
    // shortcut: sem SheetJS sai um CSV com todas as abas empilhadas; abre no Excel pt-BR (BOM e ";").
    const celula = (c) => { const t = typeof c === 'number' ? String(c).replace('.', ',') : String(c ?? ''); return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = abas.flatMap((a) => [[a.nome], ...a.linhas, []]).map((l) => l.map(celula).join(';')).join('\r\n');
    const url = global.URL.createObjectURL(new global.Blob([`${String.fromCharCode(0xfeff)}${csv}`], { type: 'text/csv;charset=utf-8' }));
    Object.assign(doc.createElement('a'), { href: url, download: `${nome}.csv` }).click();
    global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
  }

  // Imprimir / Gerar PDF: impressão do navegador; abre os <details> do relatório só durante a impressão.
  function imprimir(alvo) {
    const fechados = [...alvo.querySelectorAll('details:not([open])')];
    fechados.forEach((d) => { d.open = true; });
    global.addEventListener('afterprint', () => fechados.forEach((d) => { d.open = false; }), { once: true });
    global.print();
  }

  function barraExportar(doc, alvo, dados) {
    const planilha = el(doc, 'button', { type: 'button', class: 'btn-imprimir', title: 'Baixar o relatório da empresa em planilha do Excel (.xlsx)', texto: 'Baixar planilha' });
    const pdf = el(doc, 'button', { type: 'button', class: 'btn-imprimir', title: 'Imprimir ou salvar o relatório em PDF', texto: 'Imprimir / Gerar PDF' });
    planilha.addEventListener('click', () => baixarPlanilha(doc, planilhaRelatorio(dados), `licitaplena-empresa-${dados.cnpj}-${dados.hoje || ''}`));
    pdf.addEventListener('click', () => imprimir(alvo));
    return el(doc, 'div', { class: 'dg-topo-botoes acn-exportar' }, planilha, pdf);
  }

  // Mudou o que foi gravado? (para atualizar sozinho quando o usuário volta da página do governo)
  const assinaturaGravado = (mensagens, propostas) => [...(mensagens || []), ...(propostas || [])].reduce((n, x) => n + leituras(x), 0) + '|' + (mensagens || []).length + '|' + (propostas || []).length;

  async function lerTudo(sb, cnpj) {
    const linhas = [];
    for (let de = 0; de < 10000; de += 1000) {
      const { data, error } = await sb.rpc('analise_cnpj_participacoes', { p_cnpj: cnpj }).range(de, de + 999);
      if (error) throw error;
      linhas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    // Contratos: tabela da parte 2 (analise_cnpj_v2.sql); ausente, a tela segue sem contratos.
    const ct = await sb.from('historico_contratos_fornecedor').select('numero_controle_pncp,numero,objeto,orgao_nome,unidade_nome,municipio,uf,esfera,data_assinatura,vigencia_inicio,vigencia_fim,valor_global,valor_empenhado,valor_liquidado,valor_pago,valor_faturado,contratos_gov_id,link_pncp')
      .eq('fornecedor_ni', cnpj).order('data_assinatura', { ascending: false, nullsFirst: false }).limit(1000);
    // Parte 3 (analise_cnpj_v3.sql e pecas_juridicas.sql): ausentes, a tela segue sem esses motivos e marcas declaradas.
    const [det, pec] = await Promise.all([sb.rpc('analise_cnpj_detalhes', { p_cnpj: cnpj }).range(0, 4999),
      sb.from('pecas_juridicas').select('tipo,pregao,orgao,item,data,texto,resposta,resultado,url').eq('empresa_cnpj', cnpj)
        .in('tipo', ['intencao_recurso', 'recurso', 'contrarrazao']).order('data', { ascending: false }).limit(300)]);
    return { linhas, contratos: ct.error ? [] : ct.data, detalhes: det.error ? [] : det.data || [], pecas: pec.error ? [] : pec.data || [], ...(await lerGravados(sb, cnpj)) };
  }
  async function lerGravados(sb, cnpj) {
    // Tabelas da extensão ausentes (banco sem pregoes_gravados.sql): sem motivos gravados, o resto segue.
    const [msg, prop] = await Promise.all([
      sb.from('pregoes_gravados_mensagens').select('id_compra,numero_item,data_hora,texto,tipo,motivo,leituras_concordantes,pregoes_gravados(url,orgao,itens)')
        .eq('fornecedor_chave', cnpj).in('tipo', ['recusa', 'desclassificacao', 'inabilitacao']).order('data_hora', { ascending: false }).limit(500),
      sb.from('pregoes_gravados_propostas').select('id_compra,numero_item,situacao,leituras_concordantes').eq('cnpj', cnpj).limit(5000),
    ]);
    return { mensagens: msg.error ? [] : msg.data, propostas: prop.error ? [] : prop.data };
  }

  // alvo: container; requisitar(corpo) -> /api/analise-cnpj; sancoes() -> /api/sancoes-cnpj (ou {erro}).
  // sancoesLote(cnpjs) -> { resultados, hoje } (POST /api/sancoes-cnpj): selo de sanção nos vencedores das disputas perdidas.
  // pagamentos() -> /api/despesas-fornecedor (Portal da Transparência): mostrado aqui mesmo, sem levar a outra tela.
  async function montar(opcoes) {
    const { alvo, cnpj, ficha, sb, requisitar, sancoes, sancoesLote, pagamentos, hoje, LicitaSancoes } = opcoes;
    const doc = alvo.ownerDocument;
    const status = el(doc, 'div', { class: 'carregando', texto: 'Buscando as licitações e os contratos desta empresa…' });
    alvo.replaceChildren(cabecalho(doc, cnpj, null, ficha), status);
    const pag = pagamentos ? pagamentos().catch(() => null) : null; // começa já: o Portal demora e não bloqueia o resto
    const [coleta, sanc, cad] = await Promise.all([requisitar({ acao: 'coletar', cnpj }).catch((e) => ({ erro: String(e.message || e) })), sancoes().catch(() => ({ erro: 'indisponível agora' })),
      requisitar({ acao: 'cadastro', cnpj }).then((x) => (x && x.cadastro) || null).catch(() => null)]);
    let dados;
    try { dados = await lerTudo(sb, cnpj); } catch {
      status.replaceWith(el(doc, 'div', { class: 'aviso', texto: 'Não foi possível ler o histórico desta empresa agora. Tente de novo em alguns instantes.' }));
      return null;
    }
    const r = resumir(dados.linhas), mot = motivosGravados(dados.mensagens, dados.propostas), ct = resumirContratos(dados.contratos, hoje);
    const vulneraveis = alertasVulnerabilidade({ cadastro: cad, sancoes: sanc && !sanc.erro ? sanc : null, resumo: r, mot, contratos: ct, hoje });
    let selos = null;
    const vencedores = sancoesLote && LicitaSancoes ? cnpjsDosVencedores(r.itensNaoVencidos) : [];
    if (vencedores.length) {
      try { const lote = await sancoesLote(vencedores); if (lote && lote.resultados) selos = { resultados: lote.resultados, hoje: lote.hoje || hoje, LicitaSancoes }; } catch { selos = null; }
    }
    const desenhar = (mot, atualizado) => {
      const motivos = motivosComFonte({ r, mot, detalhes: dados.detalhes, pecas: dados.pecas });
      alvo.replaceChildren(barraExportar(doc, alvo, { cnpj, cad, r, ct, hoje, motivos }),
        blocoColeta(doc, coleta, () => montar(opcoes)) || '',
        atualizado ? el(doc, 'p', { class: 'la-atualizado', role: 'status', texto: 'Atualizado com o que você gravou' }) : '',
        cabecalho(doc, cnpj, cad, ficha), blocoAlertas(doc, vulneraveis, sanc, hoje, LicitaSancoes), blocoDesempenho(doc, r, motivos, selos),
        blocoContratos(doc, ct, hoje), blocoPagamentos(doc, pag), blocoOndeAtua(doc, r, ct),
        dica(doc, 'Fontes: PNCP, Compras.gov, Contratos.gov.br, Receita Federal, Portal da Transparência (pagamentos e CEIS/CNEP) e pregões gravados pela extensão. Disputas perdidas em outras plataformas (Licitanet, BLL, BNC…) não são públicas.'));
    };
    desenhar(Object.assign(mot, { mensagens: dados.mensagens, propostas: dados.propostas }), false);
    // Voltou da página do governo (foco da janela) e há gravação nova: atualiza sozinho, sem clicar.
    if (alvo.__acnVoltar && global.removeEventListener) global.removeEventListener('focus', alvo.__acnVoltar);
    if (global.addEventListener) {
      let assin = assinaturaGravado(dados.mensagens, dados.propostas), ocupado = false;
      alvo.__acnVoltar = async () => {
        if (ocupado || !alvo.isConnected) return;
        ocupado = true;
        try {
          const novo = await lerGravados(sb, cnpj);
          const a = assinaturaGravado(novo.mensagens, novo.propostas);
          if (a !== assin) { assin = a; desenhar(Object.assign(motivosGravados(novo.mensagens, novo.propostas), novo), true); }
        } catch { /* sem rede agora: fica como está */ } finally { ocupado = false; }
      };
      global.addEventListener('focus', alvo.__acnVoltar);
    }
    return r;
  }

  // Busca por nome: lista clicável dos fornecedores do PNCP (só CNPJ).
  function montarEscolha(doc, alvo, lista, aoEscolher) {
    if (!lista.length) { alvo.replaceChildren(el(doc, 'div', { class: 'aviso', texto: 'Nenhuma empresa com esse nome tem resultado no PNCP. Tente outra parte do nome ou o CNPJ.' })); return; }
    alvo.replaceChildren(el(doc, 'p', { texto: 'Escolha a empresa:' }), el(doc, 'ul', { class: 'ficha-lista' }, lista.map((f) => {
      const b = el(doc, 'button', { type: 'button', class: 'btn-imprimir', texto: `${f.nome} — ${cnpjFormatado(f.cnpj)} (${f.total} contratações no PNCP)` });
      b.addEventListener('click', () => aoEscolher(f.cnpj));
      return el(doc, 'li', {}, b);
    })));
  }

  const api = { motivosComFonte, planilhaRelatorio, resumir, motivosGravados, venceu, posicao, precoFinal, montar, montarEscolha, cnpjsDosVencedores, resumirContratos, alertasVulnerabilidade, explicarDesempenho, ondePerde };
  global.LicitaAnaliseCnpj = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
