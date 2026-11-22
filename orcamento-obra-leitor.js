/* global module -- script de navegador (orcamento-obra.html) e módulo do Node (testes e scripts/orcamento_obra.js) */
// Agente Leitor do "Orçamento de obra": recebe a planilha do edital já convertida em matriz (linhas × células; no
// navegador via SheetJS, no Node via scripts/xlsx_simples.js) e reconhece item, código, fonte, unidade, quantidade,
// preço, data-base, UF e regime (desonerado ou não). Também lê planilha em branco (preços zerados, caso Correios).
// Nada aqui decide preço: só entende o que o edital trouxe e avisa o que ficou duvidoso.
(function () {
  'use strict';

  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const num = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v ?? '').trim().replace(/^R\$\s*/, '');
    if (!t) return null;
    // "1.234,56" (pt-BR) ou "1234.56"
    const s = /,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t;
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  };
  const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
  const ESTADOS = { ACRE: 'AC', ALAGOAS: 'AL', AMAZONAS: 'AM', AMAPA: 'AP', BAHIA: 'BA', CEARA: 'CE', 'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', GOIAS: 'GO', MARANHAO: 'MA',
    'MINAS GERAIS': 'MG', 'MATO GROSSO DO SUL': 'MS', 'MATO GROSSO': 'MT', PARA: 'PA', PARAIBA: 'PB', PERNAMBUCO: 'PE', PIAUI: 'PI', PARANA: 'PR', 'RIO DE JANEIRO': 'RJ',
    'RIO GRANDE DO NORTE': 'RN', RONDONIA: 'RO', RORAIMA: 'RR', 'RIO GRANDE DO SUL': 'RS', 'SANTA CATARINA': 'SC', SERGIPE: 'SE', 'SAO PAULO': 'SP', TOCANTINS: 'TO' };
  // Nome mais longo primeiro: "MATO GROSSO DO SUL" antes de "MATO GROSSO", "PARAIBA" antes de "PARA".
  const NOMES_ESTADOS = Object.keys(ESTADOS).sort((a, b) => b.length - a.length);
  const fracao = (pctNumero) => Number((pctNumero / 100).toPrecision(12)); // 46,63 -> 0,4663 sem ruído de float
  const MESES = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
  // Tabelas de referência conhecidas (Lei 14.133/2021 art. 23 §2º; Decreto 7.983/2013 arts. 3º, 4º e 6º).
  const FONTES = ['SINAPI', 'SICRO', 'ORSE', 'SETOP', 'SEINFRA', 'EMOP', 'CPOS', 'AGESUL', 'SBC', 'SCO', 'FDE', 'SIURB', 'AGETOP', 'SUDECAP', 'IOPES', 'DER', 'CAEMA', 'SEDOP', 'GOINFRA', 'SIPROCE'];

  // Fonte do item: coluna "Banco/Fonte" quando existe; senão, pelo jeito do código.
  function fonteDe(textoFonte, codigo) {
    const f = norm(textoFonte);
    if (f) {
      if (/COTAC/.test(f)) return 'COTACAO';
      if (/PROPRI|MONTADA|COMPOSI/.test(f)) return 'PROPRIA';
      return FONTES.find((x) => f.includes(x)) || f.split(/[\s/-]/)[0];
    }
    const c = String(codigo ?? '').trim();
    if (!c) return '';
    if (/^\d{4,6}(\/\d{3})?$/.test(c)) return 'SINAPI'; // 97622, 74209/001 (código antigo do SINAPI)
    return 'PROPRIA'; // ex.: "TRE - 0450": composição do próprio órgão
  }

  // Linha de cabeçalho: a primeira com ITEM + DESCRIÇÃO + (QUANT ou UNID). Devolve o índice de cada coluna.
  function acharCabecalho(matriz) {
    for (let i = 0; i < Math.min(matriz.length, 60); i++) {
      const c = (matriz[i] || []).map(norm);
      const idx = (re, desde = 0) => c.findIndex((x, j) => j >= desde && re.test(x));
      const item = idx(/^ITEM\b/), descricao = idx(/^(DESCRI|ESPECIFICA|DISCRIMINA)/), quantidade = idx(/^(QUANT|QTD|QTDE)/), unidade = idx(/^(UN\b|UNID|UND|UM\b)/);
      if (item < 0 || descricao < 0 || (quantidade < 0 && unidade < 0)) continue;
      const precoUnitario = idx(/UNIT/, Math.max(quantidade, 0));
      // Coluna "Valor unit. com BDI" (planilha que põe o BDI no preço de cada item, como a dos Correios).
      const comBdi = c.findIndex((x, j) => j > precoUnitario && /UNIT/.test(x) && /COM BDI|C\/ ?BDI/.test(x));
      let total = -1;
      c.forEach((x, j) => { if (/TOTAL/.test(x) && !/UNIT/.test(x) && j > Math.max(quantidade, precoUnitario)) total = j; });
      return { linha: i, colunas: { item, codigo: idx(/^COD/), fonte: idx(/^(BANCO|FONTE|BASE\b|REF\b|REFERENCIA$)/), descricao, unidade, quantidade, precoUnitario, unitarioComBdi: precoUnitario >= 0 ? comBdi : -1, total } };
    }
    return null;
  }

  // Data-base "AAAA-MM", UF, regime e encargos a partir dos textos da planilha (cabeçalho e rodapé).
  function metadados(textos) {
    const todo = textos.map(norm);
    const out = { dataBase: null, uf: null, desonerado: null, encargosHorista: null, encargosMensalista: null, lei: null };
    for (const t of todo) {
      if (/13\.?303/.test(t)) out.lei = '13303'; // estatal: outra regra de inexequível
      if (!out.dataBase && /DATA[\s-]*BASE|REFERENCIA|MES[\s-]*BASE/.test(t)) {
        const m = new RegExp(`(${MESES.join('|')})\\s*(?:/|DE)?\\s*(\\d{4})`).exec(t) || /\b(0?[1-9]|1[0-2])\s*\/\s*(\d{4})\b/.exec(t);
        if (m) out.dataBase = `${m[2]}-${String(MESES.includes(m[1]) ? MESES.indexOf(m[1]) + 1 : Number(m[1])).padStart(2, '0')}`;
      }
      if (!out.uf) {
        const m = /SINAPI\s*[-–]\s*(.*)/.exec(t);
        const porNome = m && ESTADOS[NOMES_ESTADOS.find((k) => m[1].startsWith(k))];
        const sigla = /\bUF\s*[:=]?\s*([A-Z]{2})\b/.exec(t)?.[1] || /\/([A-Z]{2})\b/.exec(t)?.[1];
        out.uf = porNome || (UFS.includes(sigla) ? sigla : null);
      }
      // "NÃO DESONERADO" e "DESONERADO" juntos (edital que deixa a empresa escolher): fica null.
      const nao = /(NAO|SEM)\s+(OPTANTE\s+PELA\s+)?DESONERA/.test(t), sim = /(?<!NAO |SEM )(DESONERAD|COM DESONERA|OPTANTE PELA DESONERA)/.test(t.replace(/(NAO|SEM)\s+(OPTANTE\s+PELA\s+)?DESONERA\w*/g, ''));
      if (nao && sim) out.desonerado = 'escolha';
      else if (out.desonerado === null && (nao || sim)) out.desonerado = !nao;
      const h = /(\d{1,3},\d{1,2})\s*%\s*\(?\s*HORISTA/.exec(t), me = /(\d{1,3},\d{1,2})\s*%\s*\(?\s*MENSALISTA/.exec(t);
      if (h) out.encargosHorista = fracao(num(h[1]));
      if (me) out.encargosMensalista = fracao(num(me[1]));
    }
    if (out.desonerado === 'escolha') out.desonerado = null;
    return out;
  }

  // Objeto da obra: "OBRA: | texto" (célula seguinte) ou "Objeto: texto" (mesma célula), acima dos títulos.
  function objetoDe(linhas) {
    for (const l of linhas) {
      const cel = (l || []).filter((c) => String(c ?? '').trim() !== '').map((c) => String(c).trim());
      const m = /^(OBRA|OBJETO)\s*:?\s*(.*)$/i.exec(cel[0] || '');
      if (m) return (m[2] || cel[1] || '').slice(0, 500) || null;
    }
    return null;
  }

  // Rodapé: custo direto, BDI, preço global, desconto (o número vem na mesma linha do rótulo).
  function rodape(linhas) {
    const out = {};
    for (const l of linhas) {
      const t = norm(l.filter((c) => typeof c === 'string').join(' '));
      const numeros = l.map(num).filter((x) => x !== null);
      const pctTexto = /(\d{1,2},\d{1,2})\s*%/.exec(t);
      if (/^BDI/.test(t) && out.bdi === undefined) out.bdi = pctTexto ? fracao(num(pctTexto[1])) : numeros.find((x) => x > 0 && x < 1) ?? null;
      if (/CUSTO DIRETO/.test(t) && numeros.length) out.custoDireto = numeros[numeros.length - 1];
      if (/DESCONTO/.test(t) && numeros.length) out.desconto = numeros.find((x) => x >= 0 && x < 1) ?? null;
      if (/PRECO GLOBAL|VALOR GLOBAL|TOTAL GERAL/.test(t) && numeros.length) {
        if (/LICITANTE|OFERTADO|PROPOSTA/.test(t)) out.globalOfertado = numeros[numeros.length - 1];
        else out.global = numeros[numeros.length - 1];
      }
    }
    return out;
  }

  // matriz -> { cabecalho, colunas, itens, resumo, emBranco, avisos } ou { erro }.
  function lerPlanilha(matriz) {
    const cab = acharCabecalho(matriz || []);
    if (!cab) return { erro: 'Não achei a linha de títulos (ITEM, DESCRIÇÃO, UNIDADE, QUANTIDADE). Confira se é a aba da planilha orçamentária.' };
    const k = cab.colunas, celula = (l, c) => (c >= 0 ? l[c] : '');
    const itens = [], avisos = [], vistos = new Set(), ultimoFilho = {};
    let ultima = cab.linha;
    for (let i = cab.linha + 1; i < matriz.length; i++) {
      const l = matriz[i] || [];
      let item = String(celula(l, k.item) ?? '').trim().replace(/\.$/, '');
      if (!/^\d+(\.\d+)*$/.test(item)) continue;
      // Item gravado como número no Excel perde o zero final (1.10 vira 1.1): se o anterior do mesmo grupo foi 1.9, é 1.10.
      if (typeof celula(l, k.item) === 'number' && item.includes('.')) {
        const pai = item.slice(0, item.lastIndexOf('.')), filho = item.slice(item.lastIndexOf('.') + 1);
        if (Number(filho) <= (ultimoFilho[pai] || 0) && Number(`${filho}0`) === (ultimoFilho[pai] || 0) + 1) item = `${pai}.${filho}0`;
      }
      if (item.includes('.')) ultimoFilho[item.slice(0, item.lastIndexOf('.'))] = Number(item.slice(item.lastIndexOf('.') + 1));
      ultima = i;
      const codigo = String(celula(l, k.codigo) ?? '').trim();
      const quantidade = num(celula(l, k.quantidade)), unidade = String(celula(l, k.unidade) ?? '').trim();
      const servico = Boolean(codigo && codigo.toLowerCase() !== 'n/a') || quantidade !== null || Boolean(unidade);
      const linha = { item, nivel: item.split('.').length, tipo: servico ? 'servico' : 'etapa', descricao: String(celula(l, k.descricao) ?? '').trim(), linhaPlanilha: i };
      if (servico) Object.assign(linha, { codigo, fonte: fonteDe(celula(l, k.fonte), codigo), unidade, quantidade, precoUnitario: num(celula(l, k.precoUnitario)), unitarioComBdiEdital: num(celula(l, k.unitarioComBdi)), totalEdital: num(celula(l, k.total)) });
      else linha.totalEdital = num(celula(l, k.total));
      if (vistos.has(item)) avisos.push(`Item ${item} aparece duas vezes: confira a numeração (o Excel pode ter lido 4.10 como 4.1).`);
      vistos.add(item);
      if (servico && !(quantidade > 0)) avisos.push(`Item ${item}: sem quantidade.`);
      if (servico && !unidade) avisos.push(`Item ${item}: sem unidade.`);
      if (servico && linha.precoUnitario > 0 && linha.totalEdital === null && k.total >= 0) avisos.push(`Item ${item}: tem preço mas o total está vazio (fórmula sem valor salvo?). Abra no Excel, recalcule e salve.`);
      itens.push(linha);
    }
    const servicos = itens.filter((x) => x.tipo === 'servico');
    if (!servicos.length) return { erro: 'Achei os títulos, mas nenhum item numerado (1, 1.1, 1.1.1...) abaixo deles.' };
    const textos = matriz.slice(0, cab.linha).concat(matriz.slice(ultima + 1)).flat().filter((c) => typeof c === 'string');
    const comPreco = servicos.filter((x) => x.precoUnitario > 0).length;
    const fontes = {};
    for (const s of servicos) fontes[s.fonte || 'sem fonte'] = (fontes[s.fonte || 'sem fonte'] || 0) + 1;
    const cabecalho = { ...metadados(textos), objeto: objetoDe(matriz.slice(0, cab.linha)) };
    if (!cabecalho.dataBase) avisos.push('Não achei a data-base do orçamento: informe o mês de referência.');
    if (!cabecalho.uf) avisos.push('Não achei a UF da obra: informe para buscar os preços certos.');
    if (cabecalho.desonerado === null) avisos.push('A planilha não diz se é desonerado ou não desonerado: confira no edital.');
    return { cabecalho, colunas: k, linhaCabecalho: cab.linha, itens, resumo: rodape(matriz.slice(ultima + 1)), fontes, emBranco: comPreco < servicos.length / 2, avisos };
  }

  // CPU do edital (anexo de composições analíticas, no modelo mais comum: linha "Composição" seguida das linhas
  // "Composição Auxiliar" e "Insumo" com Código | Banco | Descrição | Tipo | Und | Quant. | Valor Unit | Total).
  // Vira base de preços por fonte para o Orçamentista: { SINAPI: { composicoes, precos }, PROPRIA: {...} } e
  // custosEdital = { codigo: custo unitário que o edital deu à composição }.
  function lerCpu(matriz) {
    const bases = {}, custosEdital = {};
    const base = (f) => (bases[f] ||= { composicoes: {}, precos: {} });
    let atual = null, col = null;
    for (const l of matriz || []) {
      const c = (l || []).map(norm);
      const iCod = c.findIndex((x) => /^CODIGO$/.test(x));
      if (iCod >= 0 && c.some((x) => /^BANCO$/.test(x))) {
        col = { codigo: iCod, banco: c.findIndex((x) => x === 'BANCO'), descricao: c.findIndex((x) => /^DESCRI/.test(x)), unidade: c.findIndex((x) => /^(UND|UNID)/.test(x)),
          coef: c.findIndex((x) => /^(QUANT|COEF)/.test(x)), preco: c.findIndex((x) => /^VALOR UNIT/.test(x)) };
        continue;
      }
      const tipoLinha = c.find((x) => /^(COMPOSICAO( AUXILIAR)?|INSUMO)$/.test(x));
      if (!col || !tipoLinha) continue;
      const v = (k) => l[col[k]];
      const codigo = String(v('codigo') ?? '').trim(), fonte = fonteDe(v('banco'), codigo), preco = num(v('preco'));
      if (!codigo) continue;
      if (tipoLinha === 'COMPOSICAO') {
        atual = { fonte, codigo };
        base(fonte).composicoes[codigo] = { descricao: String(v('descricao') ?? '').trim(), unidade: String(v('unidade') ?? '').trim(), itens: [] };
        if (preco !== null) custosEdital[codigo] = preco;
        continue;
      }
      if (!atual) continue;
      const tipo = tipoLinha === 'INSUMO' ? 'insumo' : 'composicao';
      base(atual.fonte).composicoes[atual.codigo].itens.push({ tipo, codigo, descricao: String(v('descricao') ?? '').trim(), unidade: String(v('unidade') ?? '').trim(), coeficiente: num(v('coef')) ?? 0 });
      if (preco !== null) base(atual.fonte).precos[`${tipo}|${codigo}`] = preco;
    }
    return { bases, custosEdital };
  }

  // Cronograma do edital: colunas "30 DIAS", "MÊS 1", "1ª ETAPA"... Cada linha de etapa vira a fração de cada mês
  // (pelo "%" da célula, ou pelo valor dividido pelo total da linha). Serve de distribuição para o Orçamentista.
  function lerCronograma(matriz) {
    const periodo = /^(\d+\s*DIAS|MES\s*\d+|\d+\s*[ºOª]?\s*(MES|ETAPA)|ETAPA\s*\d+|\d+\s*ª?\s*ETAPA)$/;
    for (let i = 0; i < Math.min((matriz || []).length, 60); i++) {
      const c = (matriz[i] || []).map(norm), cols = c.map((x, j) => (periodo.test(x.replace(/\s+/g, ' ')) ? j : -1)).filter((j) => j >= 0);
      if (cols.length < 2) continue;
      const linhas = [];
      let geral = null;
      for (const l of matriz.slice(i + 1)) {
        const item = String(l?.[0] ?? '').trim(), descricao = String(l?.[1] ?? '').trim();
        if (!item && !descricao) continue;
        // Linha "%" do rodapé: a distribuição geral pedida pelo edital (vale para planilha em branco, sem valor por etapa).
        if (/^(%|PORCENTAGEM$)/.test(norm(item)) && !geral) {
          const f = cols.map((j) => (typeof l[j] === 'number' ? l[j] : String(l[j] ?? '').includes('%') ? fracao(num(String(l[j]).replace('%', '').trim()) || 0) : num(l[j]) || 0));
          if (f.some((x) => x > 0)) geral = f;
          continue;
        }
        if (/^(TOTAL|PORCENTAGEM|CUSTO)/.test(norm(item))) continue;
        const partes = cols.map((j) => { const t = String(l[j] ?? ''); const p = /(\d{1,3}(?:,\d+)?)\s*%/.exec(t); return { pct: p ? fracao(num(p[1])) : null, valor: typeof l[j] === 'number' ? l[j] : num(t.split(/\s+/).pop()) }; });
        const somaValores = partes.reduce((a, p) => a + (p.valor || 0), 0);
        const fracoes = partes.some((p) => p.pct !== null) ? partes.map((p) => p.pct || 0) : partes.map((p) => (somaValores ? (p.valor || 0) / somaValores : 0));
        if (fracoes.some((f) => f > 0)) linhas.push({ item: /^\d+$/.test(item) ? item : '', descricao: descricao || item, fracoes });
      }
      return { meses: cols.length, linhas, geral };
    }
    return null;
  }

  // Pasta (várias abas): escolhe a aba com mais serviços reconhecidos.
  function lerPasta(abas) {
    let melhor = null;
    for (const a of abas || []) {
      const r = lerPlanilha(a.linhas);
      if (!r.erro && (!melhor || r.itens.length > melhor.itens.length)) melhor = { ...r, aba: a.nome };
    }
    return melhor || { erro: 'Nenhuma aba parece uma planilha orçamentária (ITEM, DESCRIÇÃO, UNIDADE, QUANTIDADE).' };
  }

  const api = { lerPlanilha, lerPasta, lerCpu, lerCronograma, fonteDe, acharCabecalho, metadados, num, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { leitor: api });
})();
