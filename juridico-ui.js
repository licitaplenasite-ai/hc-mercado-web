/* global module */
// Tela "Jurídico & Dúvidas" (painel.html #juridico-central): perguntas e respostas, modelos-base de peças e banco de peças reais.
// Conteúdo e modelos vêm de juridico-base.js. Nada aqui protocola ou envia: o Word sai por /api/gerar-checklist (mesma
// exportação da minuta da Central de Defesa) e o PDF pela impressão do navegador. Revisão jurídica pendente em tudo.
(function (raiz) {
  'use strict';
  const LIMITE_RESULTADOS = 30;
  const h = (doc, tag, attrs = {}, ...filhos) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else if (k in e && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined) e.append(f);
    return e;
  };
  const linkOficial = (doc, base) => {
    const a = h(doc, 'a', { href: base.url, target: '_blank', rel: 'noopener noreferrer', texto: `${base.norma}, ${base.dispositivo}` });
    return a;
  };

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
          h(doc, 'p', { classe: 'jur-base' }, 'Base: ', ...q.bases.flatMap((b, i) => [i ? ' · ' : '', linkOficial(doc, b)])),
          h(doc, 'p', { classe: 'jur-selo', texto: `${base.CATEGORIAS[q.categoria]} · revisão jurídica pendente` })));
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

  function renderizarModelos(doc, alvo, base, ctx) {
    const seletor = h(doc, 'select', { id: 'jur-modelo' }, ...base.MODELOS.map((m) => h(doc, 'option', { value: m.codigo, texto: m.titulo })));
    const processo = h(doc, 'select', { id: 'jur-processo' }, h(doc, 'option', { value: '', texto: 'Preencher à mão' }));
    const prazo = h(doc, 'p', { classe: 'jur-prazo' });
    const campos = h(doc, 'div', { classe: 'jur-campos' });
    const texto = h(doc, 'textarea', { id: 'jur-texto', rows: 18, maxLength: 50000, 'aria-describedby': 'jur-texto-ajuda' });
    const revisado = h(doc, 'input', { type: 'checkbox', id: 'jur-revisado' });
    const word = h(doc, 'button', { type: 'button', classe: 'jur-botao jur-primario', texto: 'Baixar Word', disabled: true });
    const pdf = h(doc, 'button', { type: 'button', classe: 'jur-botao', texto: 'Imprimir / salvar PDF', disabled: true });
    const aviso = h(doc, 'p', { classe: 'jur-aviso', role: 'status' });
    const entradas = {};
    let processos = [];
    const empresa = ctx.empresa() || {};
    const longo = new Set(['clausula', 'duvida', 'fatos', 'fundamentos', 'pedido', 'decisao', 'evento']);
    const atualizar = () => {
      const pronto = revisado.checked && texto.value.trim() && !texto.value.includes('[PREENCHER:');
      word.disabled = pdf.disabled = !pronto;
      word.title = pdf.title = pronto ? '' : 'Preencha os campos marcados com [PREENCHER] e confirme a revisão.';
    };
    const gerar = () => {
      const m = base.obterModelo(seletor.value);
      const dados = Object.fromEntries(Object.entries(entradas).map(([k, e]) => [k, e.value]));
      texto.value = base.preencherModelo(m, dados).texto;
      revisado.checked = false; atualizar();
    };
    const desenharCampos = () => {
      const m = base.obterModelo(seletor.value);
      const anteriores = Object.fromEntries(Object.entries(entradas).map(([k, e]) => [k, e.value]));
      prazo.replaceChildren(h(doc, 'strong', { texto: 'Prazo: ' }), m.prazo, ' Base: ', ...m.bases.flatMap((b, i) => [i ? ' · ' : '', linkOficial(doc, b)]));
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
      gerar();
    };
    const aplicarEmpresa = () => {
      const cnpj = String(empresa.cnpj || '').replace(/\D/g, '');
      const pares = { razao_social: empresa.empresa, cnpj: cnpj.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : empresa.cnpj, representante: empresa.nome, data: new Date().toLocaleDateString('pt-BR') };
      for (const [k, v] of Object.entries(pares)) if (entradas[k] && !entradas[k].value && v) entradas[k].value = v;
    };
    seletor.onchange = () => { desenharCampos(); aplicarEmpresa(); gerar(); };
    processo.onchange = () => {
      const p = processos.find((x) => x.id === processo.value);
      if (!p) return;
      for (const [k, v] of [['numero_edital', p.numero], ['orgao', p.orgao], ['objeto', p.objeto]]) if (entradas[k] && v) entradas[k].value = v;
      gerar();
    };
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
    pdf.onclick = () => { if (!pdf.disabled) ctx.imprimir(base.obterModelo(seletor.value).titulo, texto.value); };
    alvo.append(
      h(doc, 'p', { classe: 'jur-pendente', texto: 'Modelo-base com revisão jurídica pendente. Adapte aos fatos do seu caso e confira prazo e canal no edital.' }),
      h(doc, 'div', { classe: 'jur-linha' },
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-modelo', texto: 'Peça' }), seletor),
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-processo', texto: 'Processo do Funil' }), processo)),
      prazo, h(doc, 'details', { classe: 'jur-item', open: true }, h(doc, 'summary', { texto: 'Dados da peça' }), campos),
      h(doc, 'label', { for: 'jur-texto', classe: 'jur-rotulo', texto: 'Texto editável' }), texto,
      h(doc, 'p', { id: 'jur-texto-ajuda', classe: 'jur-ajuda', texto: 'Os campos vazios aparecem como [PREENCHER: …]. O texto fica só nesta tela até você baixar.' }),
      h(doc, 'div', { classe: 'jur-revisao' }, revisado, h(doc, 'label', { for: 'jur-revisado', texto: 'Revisei fatos, fundamentos, dados da empresa, destinatário e prazo.' })),
      h(doc, 'div', { classe: 'jur-acoes' }, word, pdf), aviso);
    desenharCampos(); aplicarEmpresa(); gerar();
    Promise.resolve(ctx.listarProcessos?.()).then((lista) => {
      processos = Array.isArray(lista) ? lista : [];
      for (const p of processos) processo.append(h(doc, 'option', { value: p.id, texto: [p.numero, p.orgao, p.objeto].filter(Boolean).join(' · ').slice(0, 120) }));
    }).catch(() => { /* Sem processos: o preenchimento à mão continua. */ });
  }

  const TIPOS_PECA = { esclarecimento: 'Esclarecimento', impugnacao: 'Impugnação', intencao_recurso: 'Intenção de recurso', recurso: 'Recurso', contrarrazao: 'Contrarrazão' };
  function renderizarBanco(doc, alvo, base, ctx) {
    const palavras = h(doc, 'input', { type: 'search', id: 'jur-banco-palavras', placeholder: 'Ex.: atestado; capacidade técnica', autocomplete: 'off' });
    const orgao = h(doc, 'input', { id: 'jur-banco-orgao', placeholder: 'Ex.: Instituto Federal', autocomplete: 'off' });
    const so14133 = h(doc, 'input', { type: 'checkbox', id: 'jur-banco-14133' });
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
      // Cada termo separado por ";" precisa aparecer (texto ou resposta). Só letras, números e espaço: nada de curinga do ILIKE.
      const termos = palavras.value.split(';').map((t) => base.normalizar(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1).slice(0, 5);
      if (!marcados.size) { resultado.replaceChildren(h(doc, 'p', { texto: 'Marque ao menos um tipo de peça.' })); return; }
      buscar.disabled = true; resultado.replaceChildren(h(doc, 'p', { texto: 'Buscando…' }));
      try {
        const linhas = await ctx.buscarPecas({ termos, tipos: [...marcados], orgao: orgao.value.replace(/[%_,()]/g, ' ').trim().slice(0, 80), so14133: so14133.checked, limite: LIMITE_RESULTADOS });
        resultado.replaceChildren(h(doc, 'p', { classe: 'jur-contagem', texto: linhas.length ? `${linhas.length} peça(s)${linhas.length >= LIMITE_RESULTADOS ? ' (mostrando as mais recentes)' : ''}` : 'Nenhuma peça encontrada com esses filtros.' }));
        for (const r of linhas) {
          const topo = `${TIPOS_PECA[r.tipo] || r.tipo} · Pregão nº ${r.pregao || '?'} · UASG ${r.uasg || '?'}${r.data ? ` · ${new Date(`${r.data}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}`;
          const cartao = h(doc, 'article', { classe: 'jur-peca' },
            h(doc, 'p', { classe: 'jur-peca-topo', texto: topo }),
            h(doc, 'p', { classe: 'jur-ajuda', texto: [r.orgao, r.empresa_nome && `${r.empresa_nome}${r.empresa_cnpj ? ` (CNPJ ${r.empresa_cnpj})` : ''}`, r.lei && `Lei ${r.lei}`].filter(Boolean).join(' · ') }),
            trechoDestacado(doc, r.texto, termos, base.normalizar));
          if (r.resultado) cartao.append(h(doc, 'p', { classe: 'jur-selo', texto: `Resultado: ${r.resultado}` }));
          const completo = h(doc, 'details', {}, h(doc, 'summary', { texto: 'Ver peça inteira e resposta' }), h(doc, 'p', { classe: 'jur-integral', texto: r.texto }));
          if (r.resposta) completo.append(h(doc, 'p', { classe: 'jur-rotulo', texto: 'Resposta / decisão do pregoeiro' }), h(doc, 'p', { classe: 'jur-integral', texto: r.resposta }));
          cartao.append(completo);
          if (/^https:\/\/www\.comprasnet\.gov\.br\//.test(r.url || '')) cartao.append(h(doc, 'a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', texto: 'Abrir no portal' }));
          resultado.append(cartao);
        }
      } catch (e) { resultado.replaceChildren(h(doc, 'p', { texto: e.message || 'Não foi possível buscar agora.' })); }
      finally { buscar.disabled = false; }
    };
    palavras.onkeydown = (ev) => { if (ev.key === 'Enter') buscar.onclick(); };
    alvo.append(
      h(doc, 'p', { classe: 'jur-ajuda', texto: 'Peças públicas do ComprasNet (pregões até 2023), com a resposta do pregoeiro. CPF, nomes de pessoas, e-mails e telefones são apagados; ficam empresa, CNPJ e órgão. São exemplos reais, não modelos revisados.' }),
      h(doc, 'div', { classe: 'jur-linha' },
        h(doc, 'div', { classe: 'jur-campo jur-campo-largo' }, h(doc, 'label', { for: 'jur-banco-palavras', texto: 'Palavras (separe com ;)' }), palavras),
        h(doc, 'div', { classe: 'jur-campo' }, h(doc, 'label', { for: 'jur-banco-orgao', texto: 'Órgão' }), orgao)),
      tipos, h(doc, 'div', { classe: 'jur-revisao' }, so14133, h(doc, 'label', { for: 'jur-banco-14133', texto: 'Só Lei 14.133' })),
      h(doc, 'div', { classe: 'jur-acoes' }, buscar), resultado);
  }

  function renderizar(host, ctx) {
    const doc = host.ownerDocument, base = raiz.JuridicoBase;
    if (!base) return;
    const abas = [['perguntas', 'Perguntas e respostas', renderizarPerguntas], ['modelos', 'Modelos de peças', renderizarModelos], ['banco', 'Banco de peças reais', renderizarBanco]];
    const barra = h(doc, 'div', { classe: 'jur-abas', role: 'tablist', 'aria-label': 'Jurídico' });
    const paineis = abas.map(([id, rotulo, desenhar], i) => {
      const painel = h(doc, 'div', { id: `jur-painel-${id}`, role: 'tabpanel', 'aria-labelledby': `jur-aba-${id}`, classe: 'jur-painel', hidden: i !== 0 });
      const aba = h(doc, 'button', { type: 'button', role: 'tab', id: `jur-aba-${id}`, 'aria-controls': painel.id, 'aria-selected': String(i === 0), classe: 'jur-aba', texto: rotulo });
      let desenhado = false;
      aba.onclick = () => {
        barra.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === aba)));
        host.querySelectorAll('.jur-painel').forEach((p) => { p.hidden = p !== painel; });
        if (!desenhado) { desenhado = true; desenhar(doc, painel, base, ctx); }
      };
      barra.append(aba);
      if (i === 0) { desenhado = true; desenhar(doc, painel, base, ctx); }
      return painel;
    });
    host.replaceChildren(h(doc, 'p', { classe: 'jur-pendente', texto: base.AVISO }), barra, ...paineis);
  }

  const api = { renderizar, trechoDestacado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.JuridicoUI = api;
})(globalThis);
