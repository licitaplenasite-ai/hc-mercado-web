/* global document, window, location, history, Blob, URL, console, module -- script de navegador (orcamento-obra.html) */
// Aba "Analisar concorrente" do Orçamento de obra: lê a planilha do concorrente (Excel e PDF com texto no navegador;
// foto ou PDF digitalizado pela IA, uma página por vez) e mostra os achados do Auditor com o rascunho de recurso.
// A lógica fica em orcamento-obra-concorrente.js e orcamento-obra-pdf.js (testadas no Node); aqui só tela e arquivo.
(function () {
  'use strict';
  // ---- Leitura à espera de confirmação (PDF ou foto) ----
  // Fica guardada nesta aba do navegador (sessionStorage) até a análise sair: se a página recarregar entre a
  // conferência e o "Confirmar" (Chrome descarta aba pesada, por exemplo), a pessoa volta ao mesmo ponto em vez de
  // perder tudo sem aviso (bug de 23/11 em produção).
  const CHAVE_LEITURA = 'licitaplena_concorrente_leitura', VERSAO_LEITURA = 1;
  // Foto (IA) sempre pede confirmação; PDF só quando alguma conta não fecha; Excel nunca.
  const precisaConfirmar = (lido) => Boolean(lido?.conferencia) && (!lido.conferencia.ok || lido.origem === 'ia');
  const guardarLeitura = (pendente, conferencia) => JSON.stringify({ versao: VERSAO_LEITURA, pendente, conferencia });
  function lerLeituraGuardada(texto) {
    try {
      const r = JSON.parse(texto);
      return r?.versao === VERSAO_LEITURA && Array.isArray(r.pendente?.concorrente?.itens) && r.conferencia && ['pdf', 'ia'].includes(r.pendente.origem) ? r : null;
    } catch { return null; }
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { precisaConfirmar, guardarLeitura, lerLeituraGuardada }; return; }
  const O = window.OrcObra, $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const erroSimples = (texto) => Object.assign(new Error(texto), { simples: true });
  function aviso(texto, tipo) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? `aviso ${tipo || 'info'}` : 'aviso'; }
  const LIMITE_ARQUIVO = 20 * 1024 * 1024, MAX_PAGINAS_TEXTO = 80, MAX_PAGINAS_IA = 15, LARGURA_IMAGEM = 1600;
  const estado = { pendente: null, analise: null };

  // ---- Abas ----
  function abrirAba(concorrente) {
    document.querySelector('main').classList.toggle('modo-concorrente', concorrente);
    $('aba-orcamento').setAttribute('aria-selected', String(!concorrente));
    $('aba-concorrente').setAttribute('aria-selected', String(concorrente));
    aviso('');
  }
  $('aba-orcamento').addEventListener('click', () => { abrirAba(false); history.replaceState(null, '', location.pathname); });
  $('aba-concorrente').addEventListener('click', () => { abrirAba(true); history.replaceState(null, '', '#concorrente'); });
  if (location.hash === '#concorrente') abrirAba(true);

  // ---- Arquivos ----
  async function abasDoExcel(arquivo) {
    if (!window.XLSX) throw erroSimples('O leitor de Excel não carregou. Recarregue a página.');
    try {
      const wb = window.XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
      return wb.SheetNames.map((nome) => ({ nome, linhas: window.XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' }) }));
    } catch { throw erroSimples(`Não consegui abrir "${arquivo.name}". Salve de novo como .xlsx no Excel.`); }
  }
  const tipoDe = (a) => (/\.(xlsx|xlsm|xls|ods)$/i.test(a.name) ? 'excel' : /\.pdf$/i.test(a.name) ? 'pdf' : /\.(jpe?g|png)$/i.test(a.name) ? 'imagem' : null);

  // pdf.js só carrega quando chega um PDF. Versão fixa com SRI; isEvalSupported: false fecha a falha de fonte maliciosa
  // (CVE-2024-4367) e a CSP do site já não deixa rodar eval. O worker roda na própria página (a CSP não libera blob:).
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const SRI = { 'pdf.min.js': 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e', 'pdf.worker.min.js': 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2' };
  const carregar = (nome) => new Promise((ok, falha) => {
    const s = document.createElement('script');
    Object.assign(s, { src: PDFJS + nome, integrity: SRI[nome], crossOrigin: 'anonymous', onload: ok, onerror: () => falha(erroSimples('O leitor de PDF não carregou. Recarregue a página ou envie a planilha em Excel.')) });
    document.head.appendChild(s);
  });
  let pdfjsPronto = null;
  function pdfjs() {
    pdfjsPronto ||= carregar('pdf.min.js').then(() => carregar('pdf.worker.min.js')).then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`; return window.pdfjsLib; });
    return pdfjsPronto;
  }
  // PDF -> { paginas (texto com posição), doc }. Sem texto (escaneado): o chamador manda as páginas como imagem para a IA.
  async function lerPdf(arquivo) {
    const lib = await pdfjs();
    let doc;
    try { doc = await lib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise; }
    catch { throw erroSimples('Não consegui abrir este PDF. Se tiver senha, salve sem senha.'); }
    if (doc.numPages > MAX_PAGINAS_TEXTO) throw erroSimples(`PDF com ${doc.numPages} páginas: envie só as páginas da planilha orçamentária (até ${MAX_PAGINAS_TEXTO}).`);
    const paginas = [];
    let letras = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const c = await (await doc.getPage(p)).getTextContent();
      paginas.push(c.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width })));
      letras += c.items.reduce((a, i) => a + String(i.str).trim().length, 0);
    }
    return { paginas, doc, comTexto: letras >= 100 * doc.numPages };
  }
  const canvasParaJpeg = (canvas) => canvas.toDataURL('image/jpeg', 0.75);
  async function paginasComoImagem(doc) {
    if (doc.numPages > MAX_PAGINAS_IA) throw erroSimples(`PDF escaneado com ${doc.numPages} páginas: envie só as páginas da planilha (até ${MAX_PAGINAS_IA}).`);
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p), base = pagina.getViewport({ scale: 1 }), vp = pagina.getViewport({ scale: LARGURA_IMAGEM / base.width });
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(vp.width), height: Math.round(vp.height) });
      await pagina.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      out.push(canvasParaJpeg(canvas));
    }
    return out;
  }
  // createImageBitmap e não <img src="blob:...">: a CSP do site (img-src) não libera blob:.
  async function fotoComoImagem(arquivo) {
    let img;
    try { img = await window.createImageBitmap(arquivo); } catch { throw erroSimples('Não consegui abrir a foto. Envie JPG ou PNG.'); }
    const f = Math.min(1, LARGURA_IMAGEM / img.width), canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * f), height: Math.round(img.height * f) });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    return [canvasParaJpeg(canvas)];
  }
  // Uma página por pedido (corpo pequeno e cota por página). Para no primeiro erro, com a mensagem do servidor.
  async function lerComIa(imagens) {
    const { data: { session } } = await O.sb.auth.getSession();
    if (!session) throw erroSimples('Sua sessão terminou. Entre de novo.');
    const paginas = [];
    for (let i = 0; i < imagens.length; i++) {
      aviso(`A IA está lendo a página ${i + 1} de ${imagens.length}…`);
      let r, corpo;
      try {
        r = await window.fetch('/api/planilha-ia', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ imagem: imagens[i] }) });
        corpo = await r.json();
      } catch { throw erroSimples('Não foi possível falar com a IA agora. Tente de novo.'); }
      if (!r.ok) throw erroSimples(`Página ${i + 1}: ${corpo?.erro || 'a IA não conseguiu ler.'}`);
      paginas.push(corpo);
    }
    return paginas;
  }

  // ---- Analisar ----
  async function lerConcorrente(arquivo) {
    const tipo = tipoDe(arquivo);
    if (!tipo) throw erroSimples('Envie a planilha do concorrente em Excel, PDF, JPG ou PNG.');
    if (arquivo.size > LIMITE_ARQUIVO) throw erroSimples('Arquivo maior que 20 MB.');
    if (tipo === 'excel') {
      const leitura = O.concorrente.lerProposta(await abasDoExcel(arquivo));
      if (leitura.erro) throw erroSimples(leitura.erro);
      return { leitura, origem: 'planilha' };
    }
    let origem = 'ia', matriz;
    if (tipo === 'pdf') {
      aviso('Lendo o PDF…');
      const pdf = await lerPdf(arquivo);
      // destroy(): o pdf.js roda na própria página; segurar o documento só pesa a aba.
      try {
        if (pdf.comTexto) { origem = 'pdf'; matriz = O.pdf.matrizDoPdf(pdf.paginas); }
        else matriz = O.pdf.matrizDaIa(await lerComIa(await paginasComoImagem(pdf.doc)));
      } finally { void pdf.doc.destroy(); }
    } else matriz = O.pdf.matrizDaIa(await lerComIa(await fotoComoImagem(arquivo)));
    const leitura = O.pdf.lerMatriz(matriz);
    if (leitura.erro) throw erroSimples(origem === 'pdf' ? 'Não achei a tabela de itens neste PDF. Se for escaneado, envie como foto; se tiver o Excel, prefira.' : 'A IA não achou a tabela de itens. Confira se a foto está nítida e reta.');
    return { leitura, origem, conferencia: O.pdf.conferirExtracao(leitura) };
  }

  async function enviar(ev) {
    ev.preventDefault();
    $('btn-conc').disabled = true;
    $('conc-conferir').hidden = true; $('conc-resultado').hidden = true;
    try {
      const arq = $('fc-proposta').files[0];
      if (!arq) throw erroSimples('Escolha a planilha do concorrente.');
      const ed = $('fc-edital').files[0], cpuArq = $('fc-cpu').files[0];
      let edital = null, cpu;
      if (ed) {
        edital = O.leitor.lerPasta(await abasDoExcel(ed));
        if (edital.erro) throw erroSimples(`Planilha do edital: ${edital.erro}`);
      }
      if (cpuArq) cpu = O.leitor.lerCpu((await abasDoExcel(cpuArq)).flatMap((a) => a.linhas));
      const lido = await lerConcorrente(arq);
      estado.pendente = { concorrente: lido.leitura, edital, cpu: cpu && Object.keys(cpu.bases).length ? cpu : undefined, origem: lido.origem };
      // PDF ou foto: mostra o que não fechou; foto (IA) sempre pede confirmação, mesmo com as contas certas.
      if (precisaConfirmar(lido)) {
        try { window.sessionStorage.setItem(CHAVE_LEITURA, guardarLeitura(estado.pendente, lido.conferencia)); } catch { /* sem espaço: segue sem a cópia */ }
        aviso('');
        return mostrarConferencia(lido);
      }
      analisar();
    } catch (e) { aviso(e?.simples ? e.message : 'Não foi possível ler a planilha do concorrente. Confira o arquivo e tente de novo.', 'erro'); } finally { $('btn-conc').disabled = false; }
  }
  function mostrarConferencia({ leitura, origem, conferencia: c }) {
    $('conc-conferir').hidden = false; $('cc-ok').checked = false;
    $('cc-resumo').textContent = `${origem === 'ia' ? 'A IA leu' : 'Li do PDF'} ${c.conferidos} itens, que somam ${reais(c.soma)}${leitura.resumo?.custoDireto ? ` (custo direto declarado: ${reais(leitura.resumo.custoDireto)})` : ''}. `
      + (c.ok ? 'Todas as contas fecham. Mesmo assim, confira alguns itens com o original.' : `${c.problemas.length} conta(s) não fecham: pode ser erro de leitura ou erro da própria planilha do concorrente. Confira no original.`);
    $('cc-problemas').innerHTML = c.problemas.slice(0, 60).map((p) => `<li>${esc(p)}</li>`).join('') + (c.problemas.length > 60 ? `<li>… e mais ${c.problemas.length - 60}.</li>` : '');
    $('conc-conferir').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const esquecerLeitura = () => { try { window.sessionStorage.removeItem(CHAVE_LEITURA); } catch { /* nada guardado */ } };
  // A caixa de conferência só some depois que o resultado está na tela; qualquer falha vira aviso (antes sumia calada).
  $('btn-cc-seguir').addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!$('cc-ok').checked) { aviso('Marque que conferiu com o documento original para seguir.', 'erro'); $('cc-ok').focus(); return; }
    if (!estado.pendente) { aviso('A leitura se perdeu. Clique em "Analisar a planilha" de novo.', 'erro'); return; }
    try {
      analisar();
      $('conc-conferir').hidden = true;
      esquecerLeitura();
    } catch (e) {
      console.error('analisar concorrente:', e); // único rastro para o suporte quando a análise falha
      aviso('Não foi possível montar a análise com esta leitura. Tente de novo; se continuar, envie a planilha em Excel.', 'erro');
    }
  });
  $('btn-cc-cancelar').addEventListener('click', () => { $('conc-conferir').hidden = true; estado.pendente = null; esquecerLeitura(); aviso(''); });
  // Página recarregada no meio da conferência: volta à mesma leitura.
  let guardada = null;
  try { guardada = lerLeituraGuardada(window.sessionStorage.getItem(CHAVE_LEITURA)); } catch { guardada = null; }
  if (guardada) {
    estado.pendente = guardada.pendente;
    abrirAba(true);
    mostrarConferencia({ leitura: guardada.pendente.concorrente, origem: guardada.pendente.origem, conferencia: guardada.conferencia });
    aviso('A página foi recarregada. Recuperei a leitura da planilha do concorrente: confira e confirme para ver o resultado.', 'info');
  }

  const NIVEL = { erro: 'Pode desclassificar', atencao: 'Atenção', info: 'Para saber' };
  const dados = () => ({ concorrente: $('fc-nome').value, orgao: $('fc-orgao').value, edital: $('fc-numero').value, empresa: $('fc-empresa').value });
  function analisar() {
    const K = O.concorrente, a = K.analisarConcorrente(estado.pendente), p = a.placar;
    estado.analise = a;
    aviso('');
    $('conc-resultado').hidden = false;
    $('cr-placar').textContent = `Nota de risco do concorrente: ${p.nota} de 100 · ${p.faixa}`;
    $('cr-resumo').innerHTML = `<b>${p.erro}</b> ponto(s) que podem desclassificar, <b>${p.atencao}</b> de atenção e <b>${p.info}</b> para saber.`
      + `${a.precoFinal ? ` Preço do concorrente: ${esc(reais(a.precoFinal))}.` : ''}${a.referencia ? ` Orçamento de referência: ${esc(reais(a.referencia))}.` : ''}`;
    $('cr-lista').innerHTML = a.achados.slice(0, 300).map((x) => `<li class="alerta ${x.nivel}"><span class="chip ${x.nivel}">${esc(NIVEL[x.nivel])}</span> <b>${esc(x.titulo)}</b>${x.item ? ` · item ${esc(x.item)}` : ''}<br>${esc(x.texto)}`
      + `<small>${esc(x.fonte)}${x.link && /^https:/.test(x.link) ? ` · <a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">ver a fonte</a>` : ''}</small></li>`).join('')
      + (a.achados.length > 300 ? `<li>… e mais ${a.achados.length - 300} no relatório.</li>` : '');
    $('cr-recurso').value = K.textoRecurso(a, dados());
    $('conc-resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  ['fc-nome', 'fc-orgao', 'fc-numero', 'fc-empresa'].forEach((id) => $(id).addEventListener('input', () => { if (estado.analise) $('cr-recurso').value = O.concorrente.textoRecurso(estado.analise, dados()); }));

  // ---- Baixar ----
  const nomeArquivo = (ext) => `analise-concorrente-${String($('fc-nome').value || 'proposta').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').slice(0, 40)}.${ext}`;
  $('btn-cr-html').addEventListener('click', () => {
    if (!estado.analise) return;
    const url = URL.createObjectURL(new Blob([O.concorrente.relatorioHtml(estado.analise, dados())], { type: 'text/html;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nomeArquivo('html') });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
  $('btn-cr-xlsx').addEventListener('click', () => {
    if (!estado.analise || !window.XLSX) return;
    const wb = window.XLSX.utils.book_new();
    for (const aba of O.concorrente.abasRelatorio(estado.analise, dados())) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(aba.linhas), aba.nome.slice(0, 31));
    window.XLSX.writeFile(wb, nomeArquivo('xlsx'));
  });
  $('form-conc').addEventListener('submit', (ev) => void enviar(ev));
})();
