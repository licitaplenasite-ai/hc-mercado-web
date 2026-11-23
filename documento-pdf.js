/* global module */
// PDF da proposta, da ficha técnica e das declarações, desenhado no navegador a partir dos mesmos blocos do DOCX
// (netlify/functions/_kit_proposta_doc.js). Biblioteca pdf-lib carregada só no clique, do cdnjs, com SRI (CSP já permite).
// Fonte Helvetica padrão (WinAnsi): cobre o português; caractere fora dela vira "?" em vez de quebrar o arquivo.
(function (global) {
  'use strict';
  const PDF_LIB = { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', integrity: 'sha512-z8IYLHO8bTgFqj+yrPyIJnzBDf7DDhWwiEsk4sY+Oe6J2M+WQequeGS7qioI5vT6rXgVRb4K1UVQC5ER7MKzKQ==' };
  let carregando = null;
  function carregarPdfLib(doc = global.document) {
    if (global.PDFLib) return Promise.resolve(global.PDFLib);
    carregando ||= new Promise((ok, falha) => {
      const s = doc.createElement('script');
      Object.assign(s, { src: PDF_LIB.src, integrity: PDF_LIB.integrity, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' });
      s.onload = () => (global.PDFLib ? ok(global.PDFLib) : falha(new Error('Gerador de PDF indisponível.')));
      s.onerror = () => { carregando = null; falha(new Error('Não foi possível carregar o gerador de PDF. Confira a internet e tente de novo, ou baixe o Word.')); };
      doc.head.append(s);
    });
    return carregando;
  }

  const EXTRA_WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const seguro = (t) => Array.from(String(t ?? '')).map((c) => { const n = c.codePointAt(0); return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || EXTRA_WINANSI.includes(c) ? c : n === 9 ? ' ' : '?'; }).join('');
  // Quebra em linhas que cabem em `largura` (palavra maior que a linha é cortada por caractere).
  function quebrar(texto, fonte, tamanho, largura) {
    const saida = [];
    for (const paragrafo of String(texto ?? '').split('\n').map(seguro)) {
      let linha = '';
      for (const palavra of paragrafo.split(/ +/)) {
        const tentativa = linha ? `${linha} ${palavra}` : palavra;
        if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) { linha = tentativa; continue; }
        if (linha) saida.push(linha);
        let resto = palavra;
        while (fonte.widthOfTextAtSize(resto, tamanho) > largura && resto.length > 1) {
          let n = resto.length - 1; while (n > 1 && fonte.widthOfTextAtSize(resto.slice(0, n), tamanho) > largura) n--;
          saida.push(resto.slice(0, n)); resto = resto.slice(n);
        }
        linha = resto;
      }
      saida.push(linha);
    }
    return saida;
  }

  const A4 = [595.28, 841.89], MARGEM = { esq: 65, dir: 57, topo: 112, base: 62 };
  const LARGURA = A4[0] - MARGEM.esq - MARGEM.dir;
  const COLUNAS_ITENS = [700, 3288, 700, 1000, 1560, 1110, 1110], DIREITA_ITENS = [false, false, true, false, false, true, true];

  async function gerarPdf(PDFLib, documento, logo) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const cor = (h) => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4), 16) / 255);
    const COR = cor('17243A'), SUAVE = cor('5B6B80'), FAIXA = cor('1F3A5F'), LINHA = cor('C9D3DF'), CLARO = cor('F4F7FA'), BRANCO = cor('FFFFFF');
    const pdf = await PDFDocument.create();
    pdf.setTitle(seguro(documento.titulo)); pdf.setAuthor(seguro(documento.emitente.nome)); pdf.setCreator('LicitaPlena'); pdf.setLanguage('pt-BR');
    const normal = await pdf.embedFont(StandardFonts.Helvetica), negrito = await pdf.embedFont(StandardFonts.HelveticaBold), italico = await pdf.embedFont(StandardFonts.HelveticaOblique);
    let imagem = null;
    if (logo?.base64) { try { const bytes = Uint8Array.from(global.atob(logo.base64), (c) => c.charCodeAt(0)); imagem = logo.tipo === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); } catch { imagem = null; } }
    let pagina, y;
    function cabecalho() {
      const topo = A4[1] - 40;
      if (imagem) { const e = Math.min(128 / imagem.width, 51 / imagem.height); pagina.drawImage(imagem, { x: MARGEM.esq, y: topo - imagem.height * e, width: imagem.width * e, height: imagem.height * e }); }
      let yy = topo - 8;
      for (const [i, l] of [documento.emitente.nome, ...documento.emitente.linhas].entries()) {
        const f = i ? normal : negrito, t = seguro(l), w = f.widthOfTextAtSize(t, 8);
        pagina.drawText(t, { x: A4[0] - MARGEM.dir - w, y: yy, size: 8, font: f, color: SUAVE }); yy -= 10;
      }
      pagina.drawLine({ start: { x: MARGEM.esq, y: A4[1] - 98 }, end: { x: A4[0] - MARGEM.dir, y: A4[1] - 98 }, thickness: 0.8, color: FAIXA });
    }
    function novaPagina() { pagina = pdf.addPage(A4); y = A4[1] - MARGEM.topo; cabecalho(); }
    const cabe = (h) => { if (y - h < MARGEM.base) novaPagina(); };
    function escrever(texto, { fonte = normal, tamanho = 10.5, alinhar = 'left', justificar = false, corTexto = COR, recuo = 0, antes = 0, depois = 6, largura = LARGURA - recuo } = {}) {
      y -= antes;
      const linhas = quebrar(texto, fonte, tamanho, largura), altura = tamanho * 1.35;
      linhas.forEach((l, i) => {
        cabe(altura);
        const w = fonte.widthOfTextAtSize(l, tamanho);
        let x = MARGEM.esq + recuo + (alinhar === 'center' ? (largura - w) / 2 : alinhar === 'right' ? largura - w : 0);
        const ultima = i === linhas.length - 1 || linhas[i + 1] === undefined;
        const palavras = l.split(' ');
        if (justificar && !ultima && palavras.length > 1) {
          const espaco = (largura - fonte.widthOfTextAtSize(palavras.join(''), tamanho)) / (palavras.length - 1);
          for (const p of palavras) { pagina.drawText(p, { x, y: y - tamanho, size: tamanho, font: fonte, color: corTexto }); x += fonte.widthOfTextAtSize(p, tamanho) + espaco; }
        } else pagina.drawText(l, { x, y: y - tamanho, size: tamanho, font: fonte, color: corTexto });
        y -= altura;
      });
      y -= depois;
    }
    // Tabela com quebra de página entre linhas; o cabeçalho se repete na página nova.
    // notas[k]: linha da largura toda logo abaixo da linha k (valor por extenso do item), sem separar da linha na quebra de página.
    function tabela(larguras, cabecalhoLinha, linhas, { direita = [], tamanho = 8.5, rotulo = false, destaqueFinal = false, notas = [] } = {}) {
      const total = larguras.reduce((a, b) => a + b, 0), ws = larguras.map((w) => (w / total) * LARGURA), pad = 3, tNota = tamanho - 1;
      const linhasNota = (t) => (t ? quebrar(t, italico, tNota, LARGURA - 2 * pad) : []);
      const alturaNota = (l) => (l.length ? l.length * tNota * 1.3 + 2 * pad : 0);
      const desenharNota = (l) => {
        const h = alturaNota(l);
        pagina.drawRectangle({ x: MARGEM.esq, y: y - h, width: LARGURA, height: h, borderColor: LINHA, borderWidth: 0.5 });
        l.forEach((s, k) => pagina.drawText(s, { x: MARGEM.esq + pad, y: y - pad - tNota * (k + 1) * 1.3 + tNota * 0.3, size: tNota, font: italico, color: SUAVE }));
        y -= h;
      };
      const desenharLinha = (valores, estilo, reserva = 0) => {
        const conteudos = valores.map((v, i) => quebrar(v, estilo.fonte(i), tamanho, ws[i] - 2 * pad));
        const h = Math.max(...conteudos.map((c) => c.length)) * tamanho * 1.3 + 2 * pad;
        if (y - h - reserva < MARGEM.base) { novaPagina(); if (cabecalhoLinha && estilo !== estiloCabecalho) desenharLinha(cabecalhoLinha, estiloCabecalho); }
        let x = MARGEM.esq;
        conteudos.forEach((c, i) => {
          const fundo = estilo.fundo(i);
          pagina.drawRectangle({ x, y: y - h, width: ws[i], height: h, color: fundo || undefined, borderColor: LINHA, borderWidth: 0.5 });
          c.forEach((l, k) => { const f = estilo.fonte(i), w = f.widthOfTextAtSize(l, tamanho); pagina.drawText(l, { x: direita[i] ? x + ws[i] - pad - w : x + pad, y: y - pad - tamanho * (k + 1) * 1.3 + tamanho * 0.3, size: tamanho, font: f, color: estilo.cor(i) }); });
          x += ws[i];
        });
        y -= h;
      };
      const estiloCabecalho = { fonte: () => negrito, fundo: () => FAIXA, cor: () => BRANCO };
      const estiloCorpo = { fonte: (i) => (rotulo && i === 0 ? negrito : normal), fundo: (i) => (rotulo && i === 0 ? CLARO : null), cor: (i) => (rotulo && i === 0 ? SUAVE : COR) };
      if (cabecalhoLinha) desenharLinha(cabecalhoLinha, estiloCabecalho);
      linhas.forEach((l, k) => {
        const nota = linhasNota(notas[k]);
        desenharLinha(l, destaqueFinal && k === linhas.length - 1 ? { fonte: () => negrito, fundo: () => CLARO, cor: () => COR } : estiloCorpo, alturaNota(nota));
        if (nota.length) desenharNota(nota);
      });
      y -= 8;
    }
    novaPagina();
    for (const b of documento.blocos) {
      switch (b.t) {
        case 'linhas': escrever(b.linhas.join('\n'), { alinhar: b.alinhar || 'left', depois: 10 }); break;
        case 'titulo': escrever(b.texto, { fonte: negrito, tamanho: 14, alinhar: 'center', corTexto: FAIXA, antes: 4, depois: 12 }); break;
        case 'secao': cabe(40); escrever(b.texto, { fonte: negrito, tamanho: 11, corTexto: FAIXA, antes: 8, depois: 2 }); pagina.drawLine({ start: { x: MARGEM.esq, y: y + 1 }, end: { x: A4[0] - MARGEM.dir, y: y + 1 }, thickness: 0.6, color: FAIXA }); y -= 6; break;
        case 'texto': for (const p of b.texto.split(/\n{2,}/)) /^_{5,}/.test(p) ? escrever(p, { alinhar: 'center', antes: 14 }) : escrever(p, { justificar: true }); break;
        case 'campos': tabela([2900, 6568], null, b.linhas, { rotulo: true, tamanho: 9.5 }); break;
        case 'tabela': tabela(b.larguras, b.cabecalho, b.linhas); break;
        case 'lista': for (const i of b.itens) { cabe(14); pagina.drawText('•', { x: MARGEM.esq + 4, y: y - 10.5, size: 10.5, font: normal, color: COR }); escrever(i, { recuo: 16, justificar: true, depois: 4 }); } break;
        case 'itens': {
          const linhas = [...b.linhas, ['', '', '', '', '', 'Valor global', b.total]];
          tabela(COLUNAS_ITENS, ['Item', 'Descrição', 'Qtd.', 'Unid.', 'Marca / modelo', 'Unitário (R$)', 'Total (R$)'], linhas, { direita: DIREITA_ITENS, destaqueFinal: true, notas: b.extensos || [] });
          escrever(`Valor global da proposta por extenso: ${b.extenso}.`, { fonte: italico, depois: 10 });
          break;
        }
        case 'assinatura':
          cabe(120); escrever(b.local, { alinhar: 'right', antes: 10, depois: 44 });
          escrever('______________________________________', { alinhar: 'center', depois: 0 });
          escrever(b.nome, { fonte: negrito, alinhar: 'center', depois: 0 });
          escrever(b.cargo + (b.cpf ? `\nCPF: ${b.cpf}` : ''), { alinhar: 'center' });
          break;
        case 'quebra': novaPagina(); break;
        default: throw new Error('Bloco desconhecido.');
      }
    }
    const paginas = pdf.getPages();
    paginas.forEach((p, i) => {
      const t = seguro(`${documento.rodape}  ·  Página ${i + 1} de ${paginas.length}`), w = normal.widthOfTextAtSize(t, 7.5);
      p.drawLine({ start: { x: MARGEM.esq, y: 44 }, end: { x: A4[0] - MARGEM.dir, y: 44 }, thickness: 0.5, color: LINHA });
      p.drawText(t, { x: (A4[0] - w) / 2, y: 32, size: 7.5, font: normal, color: SUAVE });
    });
    return pdf.save();
  }
  const api = { carregarPdfLib, gerarPdf, quebrar, seguro, PDF_LIB };
  global.LicitaDocumentoPdf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
