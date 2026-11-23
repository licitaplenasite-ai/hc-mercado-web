/* global module, URLSearchParams */
// Tela "Jurídico & Dúvidas" (painel.html #juridico-central): busca em tudo, modelos de peças, calculadora de prazos, artigos,
// perguntas e respostas e banco de peças reais. Conteúdo em juridico-base.js (perguntas e modelos), juridico-artigos.js e
// juridico-prazos.js. Nada aqui protocola ou envia: o Word sai por /api/gerar-checklist (mesma exportação da minuta da
// Central de Defesa) e o PDF pela impressão do navegador. Sem pop-up: aviso fixo no topo e link simples para a HC.
// Abrir já num modelo: painel.html?juridico=<modelo>&processo=<uuid>#juridico (Funil e "Mudou algo no edital?").
(function (raiz) {
  'use strict';
  const LIMITE_RESULTADOS = 30;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LEIS = [['', 'Todas as leis'], ['14133', 'Lei 14.133'], ['8666', 'Lei 8.666'], ['10520', 'Lei 10.520']];
  const h = (doc, tag, attrs = {}, ...filhos) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else if (k in e && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined) e.append(f);
    return e;
  };
  const linkExterno = (doc, url, texto) => h(doc, 'a', { href: url, target: '_blank', rel: 'noopener noreferrer', texto });
  const linkOficial = (doc, base) => linkExterno(doc, base.url, `${base.norma}, ${base.dispositivo}`);
  const dataBr = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

  // Trecho de até ~320 caracteres em volta da 1ª palavra achada, com as palavras marcadas (<mark>, sem innerHTML).
  function trechoDestacado(doc, texto, palavras, normalizar) {
    const t = String(texto || '');
    const norm = Array.from(t).map((c) => normalizar(c) || ' ').join('');
    const termos = palavras.map(normalizar).filter(Boolean);
    const primeiro = Math.min(...termos.map((p) => norm.indexOf(p)).filter((i) => i >= 0), Infinity);
    const ini = Number.isFinite(primeiro) ? Math.max(0, primeiro - 120) : 0;
    const fim = Math.min(t.length, ini + 320);
    const marcas = [];
    for (const p of termos) for (let i = norm.indexOf(p, ini); i >= 0 && i < fim; i = norm.indexOf(p, i + p.length)) marcas.push([i, Math.min(fim, i + p.length)]);
    marcas.sort((a, b) => a[0] - b[0]);
    const caixa = h(doc, 'p', { classe: 'jur-trecho' });
    let pos = ini;
    if (ini > 0) caixa.append('…');
    for (const [a, b] of marcas) { if (a < pos) continue; caixa.append(t.slice(pos, a), h(doc, 'mark', { texto: t.slice(a, b) })); pos = b; }
    caixa.append(t.slice(pos, fim) + (fim < t.length ? '…' : ''));
    return caixa;
  }

  // Chips de lei (filtro): chama mudou(lei) ao trocar.
  function chipsDeLei(doc, mudou, rotulo = 'Filtrar por lei') {
    const grupo = h(doc, 'div', { classe: 'jur-chips', role: 'group', 'aria-label': rotulo });
    for (const [valor, texto] of LEIS) {
      const b = h(doc, 'button', { type: 'button', classe: 'jur-chip', texto, 'aria-pressed': String(valor === ''), 'data-lei': valor });
      b.onclick = () => { grupo.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); mudou(valor); };
      grupo.append(b);
    }
    return grupo;
  }
  // Termos para o banco de peças: só letras, números e espaço (nada de curinga do ILIKE), até 5 termos.
  const termosDaBusca = (texto, normalizar, separador) => String(texto || '').split(separador).map((t) => normalizar(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 1).slice(0, 5);

  const TIPOS_PECA = { esclarecimento: 'Esclarecimento', impugnacao: 'Impugnação', intencao_recurso: 'Intenção de recurso', recurso: 'Recurso', contrarrazao: 'Contrarrazão' };
  function cartaoPeca(doc, r, termos, base) {
    // Peça do PNCP (Lei 14.133) costuma vir sem UASG: só aparece o que existe.
    const topo = [TIPOS_PECA[r.tipo] || r.tipo, r.pregao && `Nº ${r.pregao}`, r.uasg && `UASG ${r.uasg}`, r.data && new Date(`${r.data}T12:00:00`).toLocaleDateString('pt-BR')].filter(Boolean).join(' · ');
    const cartao = h(doc, 'article', { classe: 'jur-peca' },
      h(doc, 'p', { classe: 'jur-peca-topo', texto: topo }),
      h(doc, 'p', { classe: 'jur-ajuda', texto: [r.orgao, r.empresa_nome && `${r.empresa_nome}${r.empresa_cnpj ? ` (CNPJ ${r.empresa_cnpj})` : ''}`, r.lei && `Lei ${r.lei}`].filter(Boolean).join(' · ') }),
      trechoDestacado(doc, r.texto, termos, base.normalizar));
    if (r.resultado) cartao.append(h(doc, 'p', { classe: 'jur-selo', texto: `Resultado: ${r.resultado}` }));
    const completo = h(doc, 'details', {}, h(doc, 'summary', { texto: 'Ver peça inteira e resposta' }), h(doc, 'p', { classe: 'jur-integral', texto: r.texto }));
    if (r.resposta) completo.append(h(doc, 'p', { classe: 'jur-rotulo', texto: 'Resposta / decisão do pregoeiro' }), h(doc, 'p', { classe: 'jur-integral', texto: r.resposta }));
    cartao.append(completo);
    if (/^https:\/\/(www\.comprasnet\.gov\.br|pncp\.gov\.br)\//.test(r.url || '')) cartao.append(linkExterno(doc, r.url, /pncp\.gov\.br/.test(r.url) ? 'Abrir no PNCP' : 'Abrir no portal'));
    return cartao;
  }

  // ---------- Buscar em tudo ----------
  function renderizarBusca(doc, alvo, base, ctx, ir) {
    const artigos = raiz.JuridicoArtigos;
    const busca = h(doc, 'input', { type: 'search', id: 'jur-tudo', placeholder: 'Ex.: atestado, prazo recurso, inexequível, reequilíbrio', autocomplete: 'off' });
    const lista = h(doc, 'div', { classe: 'jur-lista', 'aria-live': 'polite' });
    const pecas = h(doc, 'div', { classe: 'jur-lista', 'aria-live': 'polite' });
    const botaoPecas = h(doc, 'button', { type: 'button', classe: 'jur-botao', texto: 'Buscar também nas peças reais' });
    let lei = '';
    const grupo = (titulo, itens) => (itens.length ? [h(doc, 'h3', { classe: 'jur-grupo', texto: `${titulo} (${itens.length})` }), ...itens] : []);
    const desenhar = () => {
      const termo = busca.value;
      const temTermo = termo.trim().length > 1;
      const palavras = base.normalizar(termo).split(/[\s;,]+/).filter((w) => w.length > 1);
      const modelos = !temTermo ? [] : base.MODELOS.filter((m) => (!lei || m.lei === lei)
        && palavras.every((w) => base.normalizar(`${m.titulo} ${m.prazo} ${m.naoPodeFaltar.join(' ')} ${m.bases.map((x) => x.dispositivo).join(' ')}`).includes(w)));
      const achados = !temTermo || !artigos ? [] : artigos.buscarArtigos(termo, lei);
      const perguntas = !temTermo ? [] : base.buscarPerguntas(termo).filter((q) => !lei || base.leiDaPergunta(q) === lei);
      lista.replaceChildren();
      if (!temTermo) { lista.append(h(doc, 'p', { classe: 'jur-ajuda', texto: 'Digite uma palavra para procurar nos modelos, nos artigos e nas perguntas. As peças reais são buscadas pelo botão abaixo.' })); return; }
      const total = modelos.length + achados.length + perguntas.length;
      lista.append(h(doc, 'p', { classe: 'jur-contagem', texto: total ? `${total} resultado(s) nesta área` : 'Nada nos modelos, artigos e perguntas. Tente as peças reais ou outra palavra.' }),
        ...grupo('Modelos', modelos.map((m) => {
          const b = h(doc, 'button', { type: 'button', classe: 'jur-resultado', texto: m.titulo });
          b.onclick = () => ir('modelos', { modelo: m.codigo });
          return h(doc, 'div', { classe: 'jur-item' }, b, h(doc, 'p', { classe: 'jur-ajuda', texto: m.prazo }));
        })),
        ...grupo('Artigos', achados.map((x) => {
          const b = h(doc, 'button', { type: 'button', classe: 'jur-resultado', texto: x.titulo });
          b.onclick = () => ir('artigos', { artigo: x.id });
          return h(doc, 'div', { classe: 'jur-item' }, b, h(doc, 'p', { classe: 'jur-ajuda', texto: x.resumo }));
        })),
        ...grupo('Perguntas e respostas', perguntas.slice(0, 15).map((q) => h(doc, 'details', { classe: 'jur-item' },
          h(doc, 'summary', { texto: q.pergunta }), h(doc, 'p', { texto: q.resposta }),
          h(doc, 'p', { classe: 'jur-base' }, 'Base: ', ...q.bases.flatMap((x, i) => [i ? ' · ' : '', linkOficial(doc, x)]))))));
    };
    botaoPecas.onclick = async () => {
      const termos = termosDaBusca(busca.value, base.normalizar, /\s+/);
      if (!termos.length) { pecas.replaceChildren(h(doc, 'p', { texto: 'Digite ao menos uma palavra.' })); return; }
      botaoPecas.disabled = true; pecas.replaceChildren(h(doc, 'p', { texto: 'Buscando nas peças reais…' }));
      try {
        const linhas = await ctx.buscarPecas({ termos, tipos: Object.keys(TIPOS_PECA), orgao: '', lei, limite: 10 });
        pecas.replaceChildren(h(doc, 'h3', { classe: 'jur-grupo', texto: `Peças reais (${linhas.length}${linhas.length >= 10 ? ', as mais recentes' : ''})` }),
          ...(linhas.length ? linhas.map((r) => cartaoPeca(doc, r, termos, base)) : [h(doc, 'p', { texto: 'Nenhuma peça real com essas palavras.' })]));
      } catch (e) { pecas.replaceChildren(h(doc, 'p', { texto: e.message || 'Não foi possível buscar agora.' })); }
      finally { botaoPecas.disabled = false; }
    };
    busca.oninput = () => { pecas.replaceChildren(); desenhar(); };
    busca.onkeydown = (ev) => { if (ev.key === 'Enter') botaoPecas.onclick(); };
    alvo.append(h(doc, 'label', { for: 'jur-tudo', classe: 'jur-rotulo', texto: 'Buscar em toda a área jurídica' }), busca,
      chipsDeLei(doc, (v) => { lei = v; pecas.replaceChildren(); desenhar(); }), lista, h(doc, 'div', { classe: 'jur-acoes' }, botaoPecas), pecas);
    desenhar();
  }

  // ---------- Modelos ----------
  function renderizarModelos(doc, alvo, base, ctx) {
    const prazos = raiz.JuridicoPrazos;
    const seletor = h(doc, 'select', { id: 'jur-modelo' }, ...base.MODELOS.map((m) => h(doc, 'option', { value: m.codigo, texto: m.titulo })));
    const processo = h(doc, 'select', { id: 'jur-processo' }, h(doc, 'option', { value: '', texto: 'Preencher à mão' }));
    const prazo = h(doc, 'div', { classe: 'jur-prazo' });
    const faltar = h(doc, 'details', { classe: 'jur-item jur-faltar', open: true });
    const campos = h(doc, 'div', { classe: 'jur-campos' });
    const texto = h(doc, 'textarea', { id: 'jur-texto', rows: 18, maxLength: 50000, 'aria-describedby': 'jur-texto-ajuda' });
    const revisado = h(doc, 'input', { type: 'checkbox', id: 'jur-revisado' });
    const word = h(doc, 'button', { type: 'button', classe: 'jur-botao jur-primario', texto: 'Baixar Word', disabled: true });
    const pdf = h(doc, 'button', { type: 'button', classe: 'jur-botao', texto: 'Imprimir / salvar PDF', disabled: true });
    const copiar = h(doc, 'button', { type: 'button', classe: 'jur-botao', texto: 'Copiar texto' });
    const aviso = h(doc, 'p', { classe: 'jur-aviso', role: 'status' });
    const entradas = {};
    let processos = [], processoAtual = null;
    const empresa = ctx.empresa() || {};
    const longo = new Set(['clausula', 'duvida', 'fatos', 'fundamentos', 'pedido', 'decisao', 'evento', 'pedido_diligencia', 'resposta_diligencia', 'composicao']);
    const atual = () => base.obterModelo(seletor.value);
    const atualizar = () => {
      const pronto = revisado.checked && texto.value.trim() && !texto.value.includes('[PREENCHER:');
      word.disabled = pdf.disabled = !pronto;
      word.title = pdf.title = pronto ? '' : 'Preencha os campos marcados com [PREENCHER] e confirme a revisão.';
    };
    const gerar = () => {
      const dados = Object.fromEntries(Object.entries(entradas).map(([k, e]) => [k, e.value]));
      texto.value = base.preencherModelo(atual(), dados).texto;
      revisado.checked = false; atualizar();
    };
    // Prazo do modelo e, se o processo tiver a data, o último dia já calculado (juridico-prazos.js).
    const desenharPrazo = () => {
      const m = atual();
      prazo.replaceChildren(h(doc, 'p', {}, h(doc, 'strong', { texto: 'Prazo: ' }), m.prazo), h(doc, 'p', { classe: 'jur-base' }, 'Base: ', ...m.bases.flatMap((x, i) => [i ? ' · ' : '', linkOficial(doc, x)])));
      const evento = { esclarecimento: ['abertura', 'abertura'], impugnacao: ['abertura', 'abertura'], recurso: ['ata', 'ata'] }[m.codigo];
      const dia = evento && processoAtual?.[evento[1]];
      const linha = dia && prazos?.calcular(evento[0], dia)?.find((p) => p.codigo === m.codigo);
      if (linha) prazo.append(h(doc, 'p', { classe: 'jur-calculado' }, h(doc, 'strong', { texto: 'Pelo calendário deste processo: ' }), `último dia em ${linha.texto}. Confira feriado local e protocole antes, se puder.`));
      faltar.replaceChildren(h(doc, 'summary', { texto: 'O que não pode faltar' }), h(doc, 'ul', {}, ...m.naoPodeFaltar.map((t) => h(doc, 'li', { texto: t }))));
    };
    const desenharCampos = () => {
      const m = atual();
      const anteriores = Object.fromEntries(Object.entries(entradas).map(([k, e]) => [k, e.value]));
      campos.replaceChildren();
      for (const k of Object.keys(entradas)) delete entradas[k];
      for (const nome of m.campos) {
        const id = `jur-campo-${nome}`;
        const e = longo.has(nome) ? h(doc, 'textarea', { id, rows: 3, maxLength: 6000 }) : h(doc, 'input', { id, maxLength: 300, autocomplete: 'off' });
        e.value = anteriores[nome] ?? '';
        e.oninput = gerar;
        entradas[nome] = e;
        campos.append(h(doc, 'div', { classe: `jur-campo${longo.has(nome) ? ' jur-campo-largo' : ''}` }, h(doc, 'label', { for: id, texto: base.ROTULOS[nome] }), e));
      }
      desenharPrazo();
    };
    const aplicarEmpresa = () => {
      const cnpj = String(empresa.cnpj || '').replace(/\D/g, '');
      const pares = { razao_social: empresa.empresa, cnpj: cnpj.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : empresa.cnpj, representante: empresa.nome, data: new Date().toLocaleDateString('pt-BR') };
      for (const [k, v] of Object.entries(pares)) if (entradas[k] && !entradas[k].value && v) entradas[k].value = v;
    };
    const aplicarProcesso = () => {
      const p = processoAtual;
      if (!p) return;
      for (const [k, v] of [['numero_edital', p.numero], ['orgao', p.orgao], ['objeto', p.objeto], ['data_abertura', dataBr(p.abertura)], ['data_intimacao', dataBr(p.ata)]]) if (entradas[k] && v) entradas[k].value = v;
    };
    const trocar = () => { desenharCampos(); aplicarEmpresa(); aplicarProcesso(); gerar(); };
    seletor.onchange = trocar;
    processo.onchange = () => { processoAtual = processos.find((x) => x.id === processo.value) || null; aplicarProcesso(); desenharPrazo(); gerar(); };
    texto.oninput = () => { revisado.checked = false; atualizar(); };
    revisado.onchange = atualizar;
    word.onclick = async () => {
      if (word.disabled) return;
      word.disabled = true; aviso.textContent = 'Gerando o Word…';
      try {
        await ctx.baixarWord({ tipo: seletor.value, texto: texto.value, revisado: true });
        aviso.textContent = 'Word baixado. Nada foi protocolado ou enviado: revise e protocole no portal do órgão.';
      } catch (e) { aviso.textContent = e.message || 'Não foi possível gerar o Word. Seu texto foi preservado.'; }
      finally { atualizar(); }
    };
    pdf.onclick = () => { if (!pdf.disabled) ctx.imprimir(atual().titulo, texto.value); };
    copiar.onclick = async () => {
      try { await raiz.navigator.clipboard.writeText(texto.value); aviso.textContent = 'Texto copiado. Cole no portal ou no chat do pregão.'; }
      catch { texto.select(); aviso.textContent = 'Não deu para copiar sozinho: o texto ficou selecionado, use Ctrl+C.'; }
    };
    alvo.append(
      h(doc, 'div', { classe: 'jur-linha' },
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-modelo', texto: 'Peça' }), seletor),
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-processo', texto: 'Processo do Funil (preenche órgão, número, objeto e datas)' }), processo)),
      prazo, faltar, h(doc, 'details', { classe: 'jur-item', open: true }, h(doc, 'summary', { texto: 'Dados da peça' }), campos),
      h(doc, 'label', { for: 'jur-texto', classe: 'jur-rotulo', texto: 'Texto editável' }), texto,
      h(doc, 'p', { id: 'jur-texto-ajuda', classe: 'jur-ajuda', texto: 'Os campos vazios aparecem como [PREENCHER: …]. O texto fica só nesta tela até você baixar ou copiar.' }),
      h(doc, 'div', { classe: 'jur-revisao' }, revisado, h(doc, 'label', { for: 'jur-revisado', texto: 'Revisei fatos, fundamentos, dados da empresa, destinatário e prazo.' })),
      h(doc, 'div', { classe: 'jur-acoes' }, word, pdf, copiar), aviso);
    trocar();
    const carregados = Promise.resolve(ctx.listarProcessos?.()).then((lista) => {
      processos = Array.isArray(lista) ? lista : [];
      for (const p of processos) processo.append(h(doc, 'option', { value: p.id, texto: [p.numero, p.orgao, p.objeto].filter(Boolean).join(' · ').slice(0, 120) }));
    }).catch(() => { /* Sem processos: o preenchimento à mão continua. */ });
    // Usado pela busca, pelos artigos, pela calculadora e pelo link do Funil / "Mudou algo no edital?".
    return {
      abrir: async ({ modelo, processoId } = {}) => {
        if (modelo && base.obterModelo(modelo)) { seletor.value = modelo; trocar(); }
        if (processoId && UUID.test(processoId)) {
          await carregados;
          if (processos.some((p) => p.id === processoId)) { processo.value = processoId; processo.onchange(); }
        }
        seletor.focus();
      },
    };
  }

  // ---------- Calculadora de prazos ----------
  function renderizarPrazos(doc, alvo, base, ctx, ir) {
    const P = raiz.JuridicoPrazos;
    if (!P) return;
    const evento = h(doc, 'select', { id: 'jur-prazo-evento' }, ...Object.entries(P.EVENTOS).map(([k, e]) => h(doc, 'option', { value: k, texto: e.rotulo })));
    const dia = h(doc, 'input', { type: 'date', id: 'jur-prazo-data' });
    const ajuda = h(doc, 'p', { classe: 'jur-ajuda' });
    const lista = h(doc, 'div', { classe: 'jur-lista', 'aria-live': 'polite' });
    const desenhar = () => {
      ajuda.textContent = P.EVENTOS[evento.value].ajuda;
      const linhas = P.calcular(evento.value, dia.value);
      lista.replaceChildren();
      if (!linhas) { lista.append(h(doc, 'p', { classe: 'jur-ajuda', texto: 'Escolha a data para ver os prazos.' })); return; }
      for (const l of linhas) {
        const item = h(doc, 'div', { classe: 'jur-item jur-prazo-linha' },
          h(doc, 'p', { classe: 'jur-rotulo', texto: l.titulo }),
          h(doc, 'p', { classe: 'jur-prazo-dia', texto: l.texto }),
          h(doc, 'p', { classe: 'jur-base' }, `${l.regra}. Base: `, linkOficial(doc, l.base)));
        if (l.modelo) {
          const b = h(doc, 'button', { type: 'button', classe: 'jur-botao', texto: `Preparar: ${base.obterModelo(l.modelo).titulo}` });
          b.onclick = () => ir('modelos', { modelo: l.modelo });
          item.append(b);
        }
        lista.append(item);
      }
    };
    evento.onchange = desenhar; dia.oninput = desenhar; dia.onchange = desenhar;
    alvo.append(
      h(doc, 'div', { classe: 'jur-linha' },
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-prazo-evento', texto: 'O que aconteceu' }), evento),
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-prazo-data', texto: 'Data' }), dia)),
      ajuda, lista, h(doc, 'p', { classe: 'jur-pendente', texto: P.AVISO }));
    desenhar();
  }

  // ---------- Artigos ----------
  function renderizarArtigos(doc, alvo, base, ctx, ir) {
    const A = raiz.JuridicoArtigos;
    if (!A) return;
    const busca = h(doc, 'input', { type: 'search', id: 'jur-artigos-busca', placeholder: 'Ex.: atestado, sanção, garantia', autocomplete: 'off' });
    const lista = h(doc, 'div', { classe: 'jur-lista', 'aria-live': 'polite' });
    let lei = '';
    const desenhar = () => {
      const achados = A.buscarArtigos(busca.value, lei);
      lista.replaceChildren(h(doc, 'p', { classe: 'jur-contagem', texto: `${achados.length} artigo(s)` }));
      for (const x of achados) {
        const d = h(doc, 'details', { classe: 'jur-item jur-artigo', id: `jur-artigo-${x.id}` },
          h(doc, 'summary', {}, h(doc, 'span', { classe: 'jur-artigo-titulo', texto: x.titulo }), h(doc, 'span', { classe: 'jur-ajuda jur-artigo-resumo', texto: x.resumo })),
          ...x.corpo.map((p) => h(doc, 'p', { texto: p })),
          h(doc, 'p', { classe: 'jur-base' }, 'Fontes oficiais: ', ...x.fontes.flatMap((f, i) => [i ? ' · ' : '', linkExterno(doc, f.url, f.nome)])),
          h(doc, 'p', { classe: 'jur-selo', texto: `${x.tema} · ${x.autor} · atualizado em ${dataBr(x.atualizado)}` }));
        if (x.modelo) {
          const b = h(doc, 'button', { type: 'button', classe: 'jur-botao', texto: `Abrir o modelo: ${base.obterModelo(x.modelo).titulo}` });
          b.onclick = () => ir('modelos', { modelo: x.modelo });
          d.append(h(doc, 'div', { classe: 'jur-acoes' }, b));
        }
        lista.append(d);
      }
      if (!achados.length) lista.append(h(doc, 'p', { texto: 'Nenhum artigo com essas palavras.' }));
    };
    busca.oninput = desenhar;
    alvo.append(h(doc, 'label', { for: 'jur-artigos-busca', classe: 'jur-rotulo', texto: 'Buscar nos artigos' }), busca,
      chipsDeLei(doc, (v) => { lei = v; desenhar(); }), lista);
    desenhar();
    return {
      abrir: ({ artigo } = {}) => {
        const d = artigo && doc.getElementById(`jur-artigo-${artigo}`);
        if (d) { d.open = true; d.scrollIntoView?.({ block: 'start' }); }
      },
    };
  }

  // ---------- Perguntas e respostas ----------
  function renderizarPerguntas(doc, alvo, base) {
    const busca = h(doc, 'input', { type: 'search', id: 'jur-busca', placeholder: 'Ex.: prazo recurso, atestado, ME/EPP', autocomplete: 'off' });
    const chips = h(doc, 'div', { classe: 'jur-chips', role: 'group', 'aria-label': 'Categorias' });
    const lista = h(doc, 'div', { classe: 'jur-lista', 'aria-live': 'polite' });
    let categoria = '';
    const desenhar = () => {
      const achadas = base.buscarPerguntas(busca.value, categoria);
      lista.replaceChildren(h(doc, 'p', { classe: 'jur-contagem', texto: `${achadas.length} resposta(s)` }));
      for (const q of achadas) {
        lista.append(h(doc, 'details', { classe: 'jur-item' },
          h(doc, 'summary', { texto: q.pergunta }),
          h(doc, 'p', { texto: q.resposta }),
          h(doc, 'p', { classe: 'jur-base' }, 'Base: ', ...q.bases.flatMap((x, i) => [i ? ' · ' : '', linkOficial(doc, x)])),
          h(doc, 'p', { classe: 'jur-selo', texto: `${base.CATEGORIAS[q.categoria]} · conteúdo informativo, confira com um advogado` })));
      }
      if (!achadas.length) lista.append(h(doc, 'p', { texto: 'Nada encontrado. Tente outra palavra ou envie sua dúvida no formulário abaixo.' }));
    };
    for (const [valor, rotulo] of [['', 'Todas'], ...Object.entries(base.CATEGORIAS)]) {
      const b = h(doc, 'button', { type: 'button', classe: 'jur-chip', texto: rotulo, 'aria-pressed': String(valor === '') });
      b.onclick = () => { categoria = valor; chips.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); desenhar(); };
      chips.append(b);
    }
    busca.oninput = desenhar;
    alvo.append(h(doc, 'label', { for: 'jur-busca', classe: 'jur-rotulo', texto: 'Buscar por palavra' }), busca, chips, lista);
    desenhar();
  }

  // ---------- Banco de peças reais ----------
  function renderizarBanco(doc, alvo, base, ctx) {
    const palavras = h(doc, 'input', { type: 'search', id: 'jur-banco-palavras', placeholder: 'Ex.: atestado; capacidade técnica', autocomplete: 'off' });
    const orgao = h(doc, 'input', { id: 'jur-banco-orgao', placeholder: 'Ex.: Instituto Federal', autocomplete: 'off' });
    const lei = h(doc, 'select', { id: 'jur-banco-lei' }, ...LEIS.map(([v, t]) => h(doc, 'option', { value: v, texto: t })));
    const tipos = h(doc, 'div', { classe: 'jur-chips', role: 'group', 'aria-label': 'Tipo de peça' });
    const marcados = new Set(Object.keys(TIPOS_PECA));
    for (const [valor, rotulo] of Object.entries(TIPOS_PECA)) {
      const b = h(doc, 'button', { type: 'button', classe: 'jur-chip', texto: rotulo, 'aria-pressed': 'true' });
      b.onclick = () => { if (marcados.has(valor)) marcados.delete(valor); else marcados.add(valor); b.setAttribute('aria-pressed', String(marcados.has(valor))); };
      tipos.append(b);
    }
    const buscar = h(doc, 'button', { type: 'button', classe: 'jur-botao jur-primario', texto: 'Buscar peças' });
    const resultado = h(doc, 'div', { classe: 'jur-lista', 'aria-live': 'polite' });
    buscar.onclick = async () => {
      // Cada termo separado por ";" precisa aparecer (texto ou resposta).
      const termos = termosDaBusca(palavras.value, base.normalizar, ';');
      if (!marcados.size) { resultado.replaceChildren(h(doc, 'p', { texto: 'Marque ao menos um tipo de peça.' })); return; }
      buscar.disabled = true; resultado.replaceChildren(h(doc, 'p', { texto: 'Buscando…' }));
      try {
        const linhas = await ctx.buscarPecas({ termos, tipos: [...marcados], orgao: orgao.value.replace(/[%_,()]/g, ' ').trim().slice(0, 80), lei: lei.value, limite: LIMITE_RESULTADOS });
        resultado.replaceChildren(h(doc, 'p', { classe: 'jur-contagem', texto: linhas.length ? `${linhas.length} peça(s)${linhas.length >= LIMITE_RESULTADOS ? ' (mostrando as mais recentes)' : ''}` : 'Nenhuma peça encontrada com esses filtros.' }),
          ...linhas.map((r) => cartaoPeca(doc, r, termos, base)));
      } catch (e) { resultado.replaceChildren(h(doc, 'p', { texto: e.message || 'Não foi possível buscar agora.' })); }
      finally { buscar.disabled = false; }
    };
    palavras.onkeydown = (ev) => { if (ev.key === 'Enter') buscar.onclick(); };
    alvo.append(
      h(doc, 'p', { classe: 'jur-ajuda', texto: 'Peças públicas do ComprasNet (pregões até 2023, com a resposta do pregoeiro) e, da Lei 14.133, as que os órgãos publicam no PNCP. CPF, nomes de pessoas, e-mails e telefones são apagados; ficam empresa, CNPJ e órgão. São exemplos reais, não modelos revisados.' }),
      h(doc, 'div', { classe: 'jur-linha' },
        h(doc, 'div', { classe: 'jur-campo jur-campo-largo' }, h(doc, 'label', { for: 'jur-banco-palavras', texto: 'Palavras (separe com ;)' }), palavras),
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-banco-orgao', texto: 'Órgão' }), orgao),
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-banco-lei', texto: 'Lei' }), lei)),
      tipos, h(doc, 'div', { classe: 'jur-acoes' }, buscar), resultado);
  }

  // Parâmetros do link (painel.html?juridico=recurso&processo=<uuid>#juridico): só modelo conhecido e UUID.
  function pedidoDoEndereco(busca, base) {
    let p;
    try { p = new URLSearchParams(String(busca || '')); } catch { return null; }
    const modelo = p.get('juridico');
    if (!modelo || !base.obterModelo(modelo)) return null;
    const processoId = p.get('processo');
    return { modelo, processoId: UUID.test(processoId || '') ? processoId : null };
  }

  function renderizar(host, ctx) {
    const doc = host.ownerDocument, base = raiz.JuridicoBase;
    if (!base) return null;
    const abas = [['busca', 'Buscar em tudo', renderizarBusca], ['modelos', 'Modelos de peças', renderizarModelos], ['prazos', 'Calculadora de prazos', renderizarPrazos],
      ['artigos', 'Artigos', renderizarArtigos], ['perguntas', 'Perguntas e respostas', renderizarPerguntas], ['banco', 'Peças reais', renderizarBanco]];
    const barra = h(doc, 'div', { classe: 'jur-abas', role: 'tablist', 'aria-label': 'Jurídico' });
    const estado = {};
    const ir = async (id, pedido) => {
      const aba = barra.querySelector(`#jur-aba-${id}`);
      if (!aba) return;
      aba.click();
      await estado[id]?.controle?.abrir?.(pedido);
    };
    const paineis = abas.map(([id, rotulo, desenhar], i) => {
      const painel = h(doc, 'div', { id: `jur-painel-${id}`, role: 'tabpanel', 'aria-labelledby': `jur-aba-${id}`, classe: 'jur-painel', hidden: i !== 0 });
      const aba = h(doc, 'button', { type: 'button', role: 'tab', id: `jur-aba-${id}`, 'aria-controls': painel.id, 'aria-selected': String(i === 0), classe: 'jur-aba', texto: rotulo });
      estado[id] = { desenhado: false, controle: null };
      const garantir = () => { if (!estado[id].desenhado) { estado[id].desenhado = true; estado[id].controle = desenhar(doc, painel, base, ctx, ir) || null; } };
      aba.onclick = () => {
        barra.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === aba)));
        host.querySelectorAll('.jur-painel').forEach((p) => { p.hidden = p !== painel; });
        garantir();
      };
      barra.append(aba);
      if (i === 0) garantir();
      return painel;
    });
    const topo = h(doc, 'div', { classe: 'jur-topo' },
      h(doc, 'p', { classe: 'jur-pendente', role: 'note', texto: base.AVISO }),
      h(doc, 'p', { classe: 'jur-hc' }, linkExterno(doc, base.ADVOGADO.url, base.ADVOGADO.texto)));
    host.replaceChildren(topo, barra, ...paineis);
    const pedido = pedidoDoEndereco(raiz.location?.search, base);
    if (pedido) void ir('modelos', pedido);
    return { abrirModelo: (modelo, processoId) => ir('modelos', { modelo, processoId }) };
  }

  const api = { renderizar, trechoDestacado, pedidoDoEndereco };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.JuridicoUI = api;
})(globalThis);
