/* global module, require -- script de navegador (orcamento-obra.html) e módulo do Node (testes) */
// Leitura de planilha orçamentária que chega em PDF ou em foto (modo "Analisar concorrente"). Não lê o arquivo:
// recebe o texto já extraído (PDF com texto: pdf.js no navegador; foto ou PDF digitalizado: a IA devolve as linhas)
// e monta a MESMA matriz (linhas × células) que o Leitor entende, com títulos fixos. Assim o concorrente passa pelo
// mesmo Leitor e pelo mesmo Auditor que a planilha em Excel. Nenhum número é inventado: o que não foi lido fica vazio,
// e conferirExtracao() refaz as contas (quantidade × unitário = total; soma = custo direto) para a pessoa confirmar.
(function () {
  'use strict';
  const noNode = typeof module !== 'undefined' && module.exports;
  const L = noNode ? require('./orcamento-obra-leitor.js') : globalThis.OrcObra.leitor;

  const TITULOS = ['ITEM', 'CÓDIGO', 'DESCRIÇÃO', 'UNID.', 'QUANT.', 'PREÇO UNITÁRIO', 'PREÇO TOTAL'];
  const NUM = '-?\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,6})?';
  const SERVICO = new RegExp(`^(\\d{1,3}(?:\\.\\d{1,3}){1,4})\\s+(.*?)\\s*(\\S{1,10})\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})$`);
  const ETAPA = new RegExp(`^(\\d{1,3}(?:\\.\\d{1,3}){0,4})\\s+(\\D.*?)\\s+(-?\\d{1,3}(?:\\.\\d{3})*,\\d{2})$`);
  // Etapa com o nome em outras linhas (acima e abaixo do número): "10.2 8.638,44".
  const ETAPA_SO_TOTAL = /^(\d{1,3}(?:\.\d{1,3}){0,4})\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/;
  const CODIGO = /^(\d{4,6}(?:\/\d{3})?|[A-Z]{2,10}\s*-\s*\d{1,6}|[A-Z]{2,10}\d{2,8})(?:\s+(.*))?$/;
  const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const terminaEmNumero = (t) => /(\d,\d{1,6}|\d%)\s*$/.test(t);
  // "4.10" depois de "4.9": compara número a número.
  function ordemItem(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
    return 0;
  }

  // Itens de texto de uma página ({ str, x, y, w }, y cresce para cima como no pdf.js) -> linhas com células.
  // Pedaços colados (distância ≤ 1,5 pt) viram uma célula só: o pdf.js corta "CART" + "ÓRIO" no meio da palavra.
  function linhasDaPagina(itens) {
    const its = (itens || []).filter((i) => String(i.str ?? '').trim()).map((i) => ({ s: String(i.str), x: Number(i.x) || 0, y: Number(i.y) || 0, w: Number(i.w) || 0 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const linhas = [], unicos = new Set();
    for (const it of its) {
      // O mesmo texto no mesmo lugar duas vezes (PDF gerado do Excel repete a linha do corte de página): fica um.
      const k = `${it.s}|${Math.round(it.x)}|${Math.round(it.y)}`;
      if (unicos.has(k)) continue;
      unicos.add(k);
      const l = linhas.find((x) => Math.abs(x.y - it.y) <= 1.5);
      if (l) l.itens.push(it); else linhas.push({ y: it.y, itens: [it] });
    }
    return linhas.map((l) => {
      const ord = l.itens.sort((a, b) => a.x - b.x), celulas = [];
      let fim = -Infinity;
      for (const it of ord) {
        if (celulas.length && it.x - fim <= 1.5) celulas[celulas.length - 1] += it.s; else celulas.push(it.s);
        fim = it.x + it.w;
      }
      const c = celulas.map(limpa).filter(Boolean);
      return { y: l.y, x: ord[0].x + (ord[0].s.length - ord[0].s.trimStart().length) * 2, celulas: c, texto: limpa(c.join(' ').replace(/R\$\s*/g, '')) };
    }).filter((l) => l.celulas.length);
  }

  function separarCodigo(meio) {
    const m = CODIGO.exec(limpa(meio));
    return m ? { codigo: limpa(m[1]), descricao: limpa(m[2]) } : { codigo: '', descricao: limpa(meio) };
  }

  // paginas: [[{ str, x, y, w }]] -> matriz para L.lerPlanilha. Linha de descrição sem número (a descrição quebrada em
  // várias linhas, acima e abaixo da linha do item) vai para o serviço mais próximo da mesma página.
  // Palavras que só aparecem no título da tabela ("PREÇO" numa linha, "UNITÁRIO" na de baixo): não são descrição.
  const SO_TITULO = /^(ITEM|C[OÓ]DIGO|DESCRI[CÇ][AÃ]O|UNID\.?|UN\.?|QUANT\.?|QTD\.?|PRE[CÇ]O|VALOR|UNIT[AÁ]RIO|UNIT\.?|TOTAL|COM|SEM|BDI|R\$|\(R\$\)|\s)+$/i;
  const ITEM_SO = /^(\d{1,3}(?:\.\d{1,3}){0,4})\s+(\D.*)$/, ITEM_NU = /^(\d{1,3}(?:\.\d{1,3}){0,4})$/;

  function matrizDoPdf(paginas) {
    const antes = [], depois = [], servicos = [], vistos = new Set();
    for (const pagina of paginas || []) {
      const linhas = linhasDaPagina(pagina), daPagina = [], soltas = [], jaTinha = servicos.length > 0;
      for (const l of linhas) {
        const s = SERVICO.exec(l.texto), e = !s && (ETAPA.exec(l.texto) || ETAPA_SO_TOTAL.exec(l.texto));
        if (s) {
          const { codigo, descricao } = separarCodigo(s[2]);
          const sv = { y: l.y, x: l.x, item: s[1], codigo, partes: descricao ? [{ y: l.y, t: descricao }] : [], unidade: s[3], quantidade: s[4], unitario: s[5], total: s[6] };
          const chave = `${s[1]}|${s[4]}|${s[5]}|${s[6]}`;
          daPagina.push(sv);
          // Página que repete a última linha da anterior: a linha fica na página (para segurar a descrição dela), mas não entra duas vezes.
          if (vistos.has(chave)) { sv.repetida = true; continue; }
          vistos.add(chave); servicos.push(sv);
        } else if (e) {
          const total = e[3] ?? e[2], ev = { y: l.y, x: l.x, item: e[1], etapa: true, partes: e[3] ? [{ y: l.y, t: limpa(e[2]) }] : [], total };
          daPagina.push(ev);
          if (vistos.has(`${e[1]}|${total}`)) { ev.repetida = true; continue; }
          vistos.add(`${e[1]}|${total}`); servicos.push(ev);
        } else if (/\bITEM\b/i.test(l.texto) && /DESCRI/i.test(l.texto)) {
          // título da tabela do próprio PDF: a matriz usa os títulos fixos
        } else if (!SO_TITULO.test(l.texto)) soltas.push(l);
      }
      // Coluna do número do item nesta página: etapa sem total ("5 INFRAESTRUTURA") começa nela; descrição quebrada
      // começa mais à direita; rodapé e endereço começam antes ou ficam longe de qualquer item.
      const xs = daPagina.map((s) => s.x).sort((a, b) => a - b), xItem = xs.length ? xs[xs.length >> 1] : null;
      // Primeiro as etapas sem total (para a descrição quebrada achar a etapa), depois as linhas de descrição.
      const resto = soltas.filter((l) => {
        const et = xItem !== null && Math.abs(l.x - xItem) <= 8 && !terminaEmNumero(l.texto) && (ITEM_SO.exec(l.texto) || ITEM_NU.exec(l.texto));
        if (!et) return true;
        const ev = { y: l.y, x: l.x, item: et[1], etapa: true, partes: et[2] ? [{ y: l.y, t: limpa(et[2]) }] : [], total: '' };
        daPagina.push(ev);
        if (!vistos.has(`${et[1]}|`)) { vistos.add(`${et[1]}|`); servicos.push(ev); } else ev.repetida = true;
        return false;
      });
      for (const l of resto) {
        // Empate (linha entre dois itens): fica com o de cima, porque o texto continua para baixo. Folga de 3 pt.
        const dist = (s) => Math.abs(s.y - l.y) - (s.y > l.y ? 3 : 0);
        const perto = xItem !== null && l.x > xItem + 10 && !terminaEmNumero(l.texto) && [...daPagina].sort((a, b) => dist(a) - dist(b))[0];
        if (perto && Math.abs(perto.y - l.y) <= 20) { if (!perto.repetida) perto.partes.push({ y: l.y, t: l.texto }); }
        // Célula vazia na frente: linha solta nunca é lida como item (o Leitor olha a 1ª coluna).
        else if (!jaTinha && !daPagina.some((s) => s.y >= l.y)) antes.push(l.celulas);
        else depois.push(['', ...l.celulas]);
      }
    }
    servicos.sort((a, b) => ordemItem(a.item, b.item));
    const corpo = servicos.map((s) => {
      const descricao = limpa(s.partes.sort((a, b) => b.y - a.y).map((p) => p.t).join(' '));
      return s.etapa ? [s.item, '', descricao, '', '', '', s.total] : [s.item, s.codigo, descricao, s.unidade, s.quantidade, s.unitario, s.total];
    });
    return [...antes, TITULOS, ...corpo, ...depois];
  }

  // Resposta da IA (uma por página) -> a mesma matriz. Só aceita o formato combinado; texto fora disso é descartado.
  // pagina = { linhas: [{ item, codigo, descricao, unidade, quantidade, precoUnitario, total }], rodape: {...}, textos: [] }
  function matrizDaIa(paginas) {
    const antes = [], corpo = [], vistos = new Set(), r = {};
    const txt = (v, max = 400) => limpa(v).slice(0, max);
    for (const p of paginas || []) {
      for (const t of (p?.textos || []).slice(0, 40)) if (txt(t)) antes.push([txt(t)]);
      for (const l of (p?.linhas || []).slice(0, 600)) {
        const item = txt(l?.item, 20).replace(/\.$/, '');
        if (!/^\d+(\.\d+)*$/.test(item)) continue;
        const linha = [item, txt(l.codigo, 40), txt(l.descricao), txt(l.unidade, 12), txt(l.quantidade, 30), txt(l.precoUnitario, 30), txt(l.total, 30)];
        const chave = linha.join('|');
        if (vistos.has(chave)) continue;
        vistos.add(chave); corpo.push(linha);
      }
      for (const k of ['custoDireto', 'bdi', 'global', 'globalOfertado']) if (p?.rodape?.[k] !== undefined && p.rodape[k] !== null && p.rodape[k] !== '') r[k] = txt(p.rodape[k], 30);
    }
    const depois = [];
    if (r.custoDireto) depois.push(['CUSTO DIRETO TOTAL', r.custoDireto]);
    if (r.bdi) depois.push([`BDI (${/%/.test(r.bdi) ? r.bdi : `${r.bdi}%`})`]);
    if (r.global) depois.push(['PREÇO GLOBAL (ESTIMADO PELO CONTRATANTE)', r.global]);
    if (r.globalOfertado) depois.push(['PREÇO GLOBAL (OFERTADO PELO LICITANTE)', r.globalOfertado]);
    return [...antes, TITULOS, ...corpo, ...depois];
  }

  // Conferência forte do que foi lido: quantidade × unitário = total (truncando ou arredondando), itens = etapa,
  // soma = custo direto. Devolve os problemas em português; quem chama pede confirmação quando há algum.
  function conferirExtracao(leitura) {
    const problemas = [], s = (leitura?.itens || []).filter((i) => i.tipo === 'servico');
    const brl = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    for (const i of s) {
      if (!(i.quantidade > 0) || !(i.precoUnitario > 0) || !(i.totalEdital > 0)) { problemas.push(`Item ${i.item}: falta quantidade, preço unitário ou total.`); continue; }
      const c = i.quantidade * i.precoUnitario, t = Math.trunc(Math.round(c * 1e6) / 1e4) / 100, a = Math.round(c * 100) / 100;
      if (Math.abs(t - i.totalEdital) > 0.011 && Math.abs(a - i.totalEdital) > 0.011) problemas.push(`Item ${i.item}: ${brl(i.quantidade)} × ${brl(i.precoUnitario)} = ${brl(a)}, mas foi lido ${brl(i.totalEdital)}.`);
    }
    for (const e of (leitura?.itens || []).filter((i) => i.tipo === 'etapa' && i.totalEdital > 0)) {
      const filhos = s.filter((x) => x.item.startsWith(`${e.item}.`));
      const soma = Math.round(filhos.reduce((a, x) => a + (x.totalEdital || 0), 0) * 100) / 100;
      if (filhos.length && Math.abs(soma - e.totalEdital) > 0.011) problemas.push(`Etapa ${e.item}: os itens lidos somam ${brl(soma)}, mas a etapa diz ${brl(e.totalEdital)} (pode faltar item lido).`);
    }
    const soma = Math.round(s.reduce((a, x) => a + (x.totalEdital || 0), 0) * 100) / 100, cd = leitura?.resumo?.custoDireto;
    if (cd > 0 && Math.abs(soma - cd) > 0.011) problemas.push(`Os itens lidos somam ${brl(soma)}, mas o custo direto diz ${brl(cd)}.`);
    return { ok: problemas.length === 0, problemas, conferidos: s.length, soma };
  }

  // Atalho para os dois caminhos: matriz -> leitura do Leitor (ou { erro }).
  const lerMatriz = (matriz) => L.lerPlanilha(matriz);

  const api = { linhasDaPagina, matrizDoPdf, matrizDaIa, conferirExtracao, lerMatriz, TITULOS };
  if (noNode) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { pdf: api });
})();
