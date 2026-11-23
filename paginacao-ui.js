/* global module */
// Paginação de listas longas na tela do processo (itens, escolha dos itens, licitação anterior): 10 por página,
// com 10/25/50, "Anterior", "Próxima" e "Ir para a página", como o Compras.gov. A lista inteira continua na memória
// do módulo dono (busca, filtro e "marcar todos do filtro" valem para todas as páginas); só o desenho é fatiado.
(function (global) {
  'use strict';
  const TAMANHOS = [10, 25, 50];

  // { pagina (1..paginas), paginas, inicio, fim, itens }: página fora do intervalo volta para o limite.
  function fatiar(lista, pagina, tamanho) {
    const t = TAMANHOS.includes(tamanho) ? tamanho : TAMANHOS[0];
    const total = Array.isArray(lista) ? lista.length : 0;
    const paginas = Math.max(1, Math.ceil(total / t));
    const p = Math.min(Math.max(1, Math.trunc(Number(pagina)) || 1), paginas);
    const inicio = (p - 1) * t;
    return { pagina: p, paginas, tamanho: t, total, inicio, fim: Math.min(inicio + t, total), itens: total ? lista.slice(inicio, inicio + t) : [] };
  }

  // Barra de navegação. mudar({ pagina, tamanho }) redesenha a lista dona. rotulo: "itens" (texto do contador).
  function barra(doc, { fatia, rotulo = 'itens', mudar, id }) {
    const h = (tag, attrs = {}, ...filhos) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, v === true ? '' : String(v));
      }
      e.append(...filhos);
      return e;
    };
    const nav = h('nav', { classe: 'paginacao', 'aria-label': `Páginas de ${rotulo}` });
    const resumo = fatia.total ? `${fatia.inicio + 1}–${fatia.fim} de ${fatia.total} ${rotulo}` : `0 ${rotulo}`;
    nav.append(h('p', { classe: 'paginacao-resumo', 'aria-live': 'polite', texto: `${resumo} · página ${fatia.pagina} de ${fatia.paginas}` }));
    const ant = h('button', { type: 'button', 'data-pagina-anterior': '', disabled: fatia.pagina <= 1, texto: '‹ Anterior' });
    const prox = h('button', { type: 'button', 'data-pagina-proxima': '', disabled: fatia.pagina >= fatia.paginas, texto: 'Próxima ›' });
    ant.addEventListener('click', () => mudar({ pagina: fatia.pagina - 1, tamanho: fatia.tamanho }));
    prox.addEventListener('click', () => mudar({ pagina: fatia.pagina + 1, tamanho: fatia.tamanho }));
    const idIr = `${id}-ir`, idTam = `${id}-tamanho`;
    const ir = h('input', { id: idIr, type: 'number', inputmode: 'numeric', min: 1, max: fatia.paginas, value: fatia.pagina, 'data-pagina-ir': '' });
    const form = h('form', { classe: 'paginacao-ir', novalidate: true }, h('label', { for: idIr, texto: 'Ir para a página' }), ir, h('button', { type: 'submit', texto: 'Ir' }));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); mudar({ pagina: Number(ir.value), tamanho: fatia.tamanho }); });
    const tam = h('select', { id: idTam, 'data-pagina-tamanho': '' }, ...TAMANHOS.map((n) => h('option', { value: n, selected: n === fatia.tamanho, texto: `${n} por página` })));
    tam.addEventListener('change', () => mudar({ pagina: 1, tamanho: Number(tam.value) }));
    nav.append(h('div', { classe: 'paginacao-botoes' }, ant, prox), form, h('div', { classe: 'paginacao-tamanho' }, h('label', { for: idTam, texto: 'Mostrar' }), tam));
    return nav;
  }

  const api = { fatiar, barra, TAMANHOS };
  global.LicitaPaginacao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
