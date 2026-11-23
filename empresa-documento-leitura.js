/* global module, document, window */
// Leitura do contrato social, alteração contratual e cartão CNPJ para sugerir endereço da sede, representante e cargo.
// Só regras de texto, sem IA. Usado no servidor (_empresa_documentos.js, PDF de até 8 páginas, com prova da fonte) e no
// navegador (qualquer tamanho: o pdf.js lê o PDF na própria página e nada sai do computador além do que já está salvo).
(function (raiz) {
  'use strict';
  const espacos = s => String(s || '').replace(/\s+/g, ' ').trim();
  const semAcento = s => espacos(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const digitos = s => String(s || '').replace(/\D/g, '');
  const trechoDe = (texto, inicio, fim) => espacos(texto.slice(Math.max(0, inicio), Math.min(texto.length, fim))).slice(0, 300);

  // Cartão CNPJ e fichas com rótulo: valor na mesma linha do rótulo; só vale se aparecer uma vez.
  const ROTULOS = { razaoSocial: /NOME EMPRESARIAL\s*[:\n]\s*([^\n]{3,180})/i, endereco: /ENDERE[CÇ]O\s*[:\n]\s*([^\n]{5,500})/i, representante: /REPRESENTANTE LEGAL\s*[:\n]\s*([^\n]{3,180})/i, cargo: /CARGO\s*[:\n]\s*([^\n]{3,120})/i };
  function porRotulo(paginas) {
    const achados = {};
    for (const [campo, regex] of Object.entries(ROTULOS)) {
      const m = paginas.flatMap(p => [...p.texto.matchAll(new RegExp(regex.source, 'gi'))].map(x => ({ campo, pagina: p.pagina, trecho: x[0].trim(), valor: x[1].trim() })));
      if (m.length === 1) achados[campo] = m[0];
    }
    return achados;
  }

  // ---------- Contrato social / alteração contratual (texto corrido) ----------
  // Vale a última ocorrência: na alteração com consolidação, o texto consolidado (atual) vem no fim.
  const SEDE = /(?:com|tem|ter[áa]|possui|fixa|transfere)\s+(?:a\s+)?(?:sua\s+)?sede\s+(?:social\s+)?(?:e\s+foro\s+)?(?:para\s+|em\s+|n[ao]\s+|à\s+|a\s+)(?:(?:cidade|munic[íi]pio)\s+de\s+[^,]{2,60},\s*)?(?:(?:n[ao]|à)\s+)?/gi;
  const FIM_ENDERECO = /;|\.\s|,\s*(?:inscrit|registrad|neste\s+ato|doravante|cujo|onde|podendo|com\s+(?:capital|filial|foro)|e\s+foro)/i;
  function endereco(texto) {
    let achado = null;
    for (const m of texto.matchAll(SEDE)) {
      const resto = texto.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const cep = /CEP\s*(?:n[º°o.]*\s*)?:?\s*\d{2}\.?\d{3}-?\d{3}/i.exec(resto);
      const fim = FIM_ENDERECO.exec(resto);
      const corte = cep && (!fim || cep.index < fim.index + 80) ? cep.index + cep[0].length : fim ? fim.index : -1;
      const valor = corte > 0 ? espacos(resto.slice(0, corte)).replace(/[,\s]+$/, '') : '';
      if (valor.length >= 10 && /\d/.test(valor) && valor.length <= 500) achado = { valor, inicio: m.index, fim: m.index + m[0].length + corte };
    }
    return achado;
  }

  const ADMINISTRACAO = [
    /administra[çc][ãa]o\s+da\s+sociedade\s+(?:caber[áa]|ser[áa]\s+exercida|compete|competir[áa]|fica(?:r[áa])?\s+a\s+cargo|ficar[áa]\s+a\s+cargo)\s+/gi,
    /(?:sociedade\s+)?(?:ser[áa]|é)\s+administrada\s+(?:e\s+representada\s+)?(?:isoladamente\s+|exclusivamente\s+)?(?:por|pel[oa]s?)\s+/gi,
    /(?:fica|ficam|é|s[ãa]o)\s+designad[oa]s?\s+(?:como\s+|para\s+o\s+cargo\s+de\s+)?administrador(?:a|es|as)?\s+(?:da\s+sociedade\s+)?/gi,
    /\b(?:o|a)\s+s[óo]ci[oa][\s-]+administrador[a]?\s*,?\s*/gi,
  ];
  // Cada palavra só conta inteira ("aos" não pode parar em "a" + "o").
  const PREENCHIMENTO = /^(?:(?:(?:aos|ao|as|às|a|à|os|o|pel[oa]s?|sra|sr|senhora|senhor|s[óo]ci[oa]s?|administrador(?:a|es|as)?|n[ãa]o\s+s[óo]ci[oa]s?|isoladamente|exclusivamente|individualmente|ou)(?![A-Za-zÀ-ÿ])\.?|,|-|–)\s*)*/i;
  // Nome próprio em maiúsculas ou com iniciais maiúsculas; "da", "de", "dos", "e" no meio.
  const NOME = /^((?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'´`.]+)(?:\s+(?:(?:d[aeo]s?|D[AEO]S?|e|E)\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ'´`.]+){1,7})/;
  const PARADA = /\s+(?:COM|QUE|O\s+QUAL|A\s+QUAL|ISOLADAMENTE|EM\s+CONJUNTO|NA\s+QUALIDADE|BRASILEIR\w*|PORTADOR\w*|INSCRIT\w*|RESIDENTE\w*|CPF|ASSINANDO|REPRESENTANDO|A\s+QUEM|AO\s+QUAL|DE\s+FORMA|SEM|PODENDO|CABENDO|COMPETINDO|NOS\s+TERMOS|DORAVANTE)\b.*$/;
  // qualificado(nome): o nome aparece em algum lugar com nacionalidade/CPF (todo sócio e administrador é qualificado no contrato).
  function representante(texto, qualificado) {
    let achado = null;
    for (const regex of ADMINISTRACAO) for (const m of texto.matchAll(regex)) {
      const depois = texto.slice(m.index + m[0].length, m.index + m[0].length + 260);
      const filler = PREENCHIMENTO.exec(depois)[0];
      const n = NOME.exec(depois.slice(filler.length));
      if (!n) continue;
      const inteiro = espacos(n[1].replace(PARADA, '')).replace(/[.,]+$/, '');
      // "JOÃO ... e MARIA ...": dois nomes juntos; fica o primeiro que for qualificado e o aviso de vários.
      const nome = [inteiro, ...inteiro.split(/\s+[eE]\s+/)].find(x => x.split(' ').length >= 2 && !/^(SOCIEDADE|LTDA|CLAUSULA|JUNTA)/.test(semAcento(x)) && qualificado(x));
      if (!nome) continue;
      const contexto = semAcento(m[0] + filler);
      const naoSocio = /NAO\s+SOCI/.test(contexto) || /^\W*N[ÃA]O\s+S[ÓO]CI/i.test(depois.slice(filler.length + n[0].length, filler.length + n[0].length + 20));
      const socio = !naoSocio && /SOCI[OA]/.test(contexto);
      const feminino = /SOCIA\b|ADMINISTRADORA\b|\bA\s+SOCIA|PELA\b/.test(contexto);
      const cargo = socio ? (feminino ? 'Sócia-administradora' : 'Sócio-administrador') : (feminino ? 'Administradora' : 'Administrador');
      // Mais de um administrador citado na mesma frase: avisa para conferir.
      const varios = nome !== inteiro || /\s+e\s+(?:[oa]\s+)?(?:s[óo]ci[oa]\s+)?[A-ZÀ-Ý]{2,}/.test(depois.slice(filler.length + n[0].length, filler.length + n[0].length + 60)) || /\bAOS\b|\bSOCIOS\b|ADMINISTRADORES/.test(contexto);
      achado = { nome, cargo, varios, inicio: m.index, fim: m.index + m[0].length + filler.length + n[0].length };
    }
    return achado;
  }

  // paginas: [{ pagina, texto }]; empresa: { razao_social, cnpj } do cadastro.
  function extrairDadosEmpresa(paginas, empresa = {}) {
    const lista = (paginas || []).map(p => ({ pagina: p.pagina, texto: String(p.texto || '') }));
    const sugestoes = {}, evidencias = [], avisos = [];
    const rotulos = porRotulo(lista);
    for (const campo of ['razaoSocial', 'endereco', 'representante', 'cargo']) if (rotulos[campo]) { sugestoes[campo] = rotulos[campo].valor; evidencias.push(rotulos[campo]); }
    // Texto corrido por página (cláusula quebrada em linhas vira uma frase só).
    const corridas = lista.map(p => ({ pagina: p.pagina, texto: espacos(p.texto) }));
    const tudo = corridas.map(p => p.texto).join(' '), tudoSemAcento = semAcento(tudo);
    const qualificado = nome => { const n = semAcento(nome), i = tudoSemAcento.indexOf(n); return i >= 0 && [...tudoSemAcento.matchAll(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].some(m => /BRASILEIR|CPF|PORTADOR|NACIONALIDADE|NASCID|SOLTEIR|CASAD|DIVORCIAD|VIUV|EMPRESARI/.test(tudoSemAcento.slice(m.index + n.length, m.index + n.length + 120))); };
    if (!sugestoes.endereco) {
      let ultimo = null; for (const p of corridas) { const e = endereco(p.texto); if (e) ultimo = { ...e, p }; }
      if (ultimo) { sugestoes.endereco = ultimo.valor; evidencias.push({ campo: 'endereco', pagina: ultimo.p.pagina, trecho: trechoDe(ultimo.p.texto, ultimo.inicio, ultimo.fim), valor: ultimo.valor }); }
    }
    if (!sugestoes.representante) {
      let ultimo = null; for (const p of corridas) { const r = representante(p.texto, qualificado); if (r) ultimo = { ...r, p }; }
      if (ultimo) {
        const trecho = trechoDe(ultimo.p.texto, ultimo.inicio, ultimo.fim);
        sugestoes.representante = ultimo.nome; evidencias.push({ campo: 'representante', pagina: ultimo.p.pagina, trecho, valor: ultimo.nome });
        if (!sugestoes.cargo) { sugestoes.cargo = ultimo.cargo; evidencias.push({ campo: 'cargo', pagina: ultimo.p.pagina, trecho, valor: ultimo.cargo }); }
        if (ultimo.varios) avisos.push('O documento cita mais de um administrador. Confira quem assina pela empresa.');
      }
    }
    // Razão social e CNPJ: só conferência com o cadastro (o contrato cita também sócios e outras empresas).
    const cnpj = digitos(empresa.cnpj);
    if (/^\d{14}$/.test(cnpj)) {
      const achou = [...tudo.matchAll(/\d{2}\.?\d{3}\.?\d{3}\s?\/?\s?\d{4}\s?-?\s?\d{2}/g)].some(m => digitos(m[0]) === cnpj);
      if (achou) sugestoes.cnpj = cnpj; else avisos.push('Não encontramos no documento o CNPJ do cadastro. Confira se é o documento da empresa certa.');
    }
    if (empresa.razao_social && !sugestoes.razaoSocial) {
      const limpa = s => semAcento(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (limpa(tudo).includes(limpa(empresa.razao_social))) sugestoes.razaoSocial = empresa.razao_social;
      else avisos.push('Não encontramos no documento a razão social do cadastro. Confira se o nome mudou ou se é o documento certo.');
    }
    return { sugestoes, evidencias, avisos };
  }
  // PDF escaneado (foto da página): quase nenhuma letra para ler.
  const semTexto = paginas => (paginas || []).reduce((n, p) => n + String(p.texto || '').replace(/\s/g, '').length, 0) < 40 * Math.max(1, Math.min(3, (paginas || []).length));

  // ---------- Navegador: pdf.js da mesma versão e SRI do leitor do Orçamento de obra ----------
  // isEvalSupported: false fecha a falha de fonte maliciosa (CVE-2024-4367); o worker roda na própria página (a CSP não libera blob:).
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const SRI = { 'pdf.min.js': 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e', 'pdf.worker.min.js': 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2' };
  const MAX_PAGINAS = 120;
  let pronto = null;
  function pdfjs() {
    const carregar = nome => new Promise((ok, falha) => { const s = document.createElement('script'); Object.assign(s, { src: PDFJS + nome, integrity: SRI[nome], crossOrigin: 'anonymous', onload: ok, onerror: () => falha(new Error('O leitor de PDF não carregou. Recarregue a página e tente de novo.')) }); document.head.appendChild(s); });
    pronto ||= (window.pdfjsLib ? Promise.resolve() : carregar('pdf.min.js').then(() => carregar('pdf.worker.min.js')))
      .then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`; return window.pdfjsLib; })
      .catch(e => { pronto = null; throw e; });
    return pronto;
  }
  async function lerPdf(bytes) {
    const lib = await pdfjs();
    let doc;
    try { doc = await lib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise; }
    catch { throw new Error('Não conseguimos abrir este PDF. Se ele tiver senha, salve uma cópia sem senha e anexe de novo.'); }
    try {
      const paginas = [];
      for (let pagina = 1; pagina <= Math.min(doc.numPages, MAX_PAGINAS); pagina++) {
        const c = await (await doc.getPage(pagina)).getTextContent();
        let linha = null, texto = '';
        for (const item of c.items) { const y = item.transform?.[5]; if (y !== linha) { texto += '\n'; linha = y; } texto += item.str + ' '; }
        paginas.push({ pagina, texto });
      }
      return paginas;
    } finally { doc.destroy(); }
  }

  const api = { extrairDadosEmpresa, semTexto, lerPdf };
  raiz.EmpresaDocumentoLeitura = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
