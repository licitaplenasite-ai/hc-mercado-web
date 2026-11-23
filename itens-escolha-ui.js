/* global module */
// Escolha dos itens do edital ("Vou participar"), dentro de Itens do processo (itens-processo-ui.js).
// Edital com centenas de itens: a empresa marca só os seus. Item não marcado fica guardado e fora da proposta
// e do arquivo para o portal (coluna participar, supabase/operacao_itens_participar.sql).
// Servidor: kit-documentos lerEscolha / salvarEscolha / salvarOferta (_itens_processo.js), que valida tudo de novo.
// Ordem de carga no navegador: precificacao-item.js, este arquivo, itens-processo-ui.js.
(function (global) {
  'use strict';
  // tipoBeneficio do PNCP: 1 exclusivo ME/EPP, 2 subcontratação ME/EPP, 3 cota reservada ME/EPP, 4 sem benefício, 5 não se aplica.
  const RESTRITOS = new Set([1, 3]);
  const restrito = (tipo) => RESTRITOS.has(tipo);
  const ehMeEpp = (porte) => ['mei', 'me', 'epp'].includes(porte);
  const classe = (tipo) => (tipo === 1 ? 'exclusivo' : tipo === 3 ? 'cota' : 'ampla');
  const ROTULO = { exclusivo: 'Exclusivo ME/EPP', cota: 'Cota reservada ME/EPP', ampla: 'Ampla concorrência' };
  const FILTROS = [['todos', 'Todos os itens'], ['selecionados', 'Só os que vou participar'], ['nao_selecionados', 'Só os que não marquei'],
    ['exclusivo', 'Exclusivos ME/EPP'], ['cota', 'Cota reservada ME/EPP'], ['ampla', 'Ampla concorrência']];

  // Valor digitado em pt-BR → texto canônico do servidor ("52,00" → "52.00", "1.500,00" → "1500.00").
  // Ponto sozinho segue valendo como decimal ("1.10"), como antes; com 2 casas, "1.500" só pode ser milhar.
  function normalizarDecimal(digitado, casas) {
    let t = String(digitado ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
    if (t.includes(',')) {
      if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, '');
      t = t.replace(',', '.');
    } else if (casas < 3 && /^\d{1,3}(?:\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    return t.replace(/^0+(?=\d)/, '');
  }
  // Texto canônico do banco → campo em pt-BR com milhar ("1500.00" → "1.500,00").
  function campoReais(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    const [i, f = ''] = String(valor).split('.');
    return `${i.replace(/\B(?=(\d{3})+$)/g, '.')},${f.padEnd(2, '0')}`;
  }
  // Número do item como a pessoa escreve ("007" = "7"); texto livre fica como está.
  const chaveNumero = (identificador) => { const t = String(identificador ?? '').trim(); return /^\d{1,18}$/.test(t) ? String(BigInt(t)) : t.toLowerCase(); };

  // "3, 7, 10-15" → { ok, numeros: Set de textos, erros: [pedaços que não entendi] }. Aceita vírgula, ponto e vírgula,
  // espaço, "a"/"até" e travessão nas faixas. Faixa invertida vale ("15-10"). Teto de 10.000 números por faixa.
  function lerFaixas(texto) {
    const numeros = new Set(), erros = [];
    const t = String(texto ?? '').toLowerCase().replace(/\s*(?:-|–|—|\ba\b|\baté\b)\s*/g, '-');
    for (const pedaco of t.split(/[\s,;]+/).filter(Boolean)) {
      const m = /^(\d{1,9})(?:-(\d{1,9}))?$/.exec(pedaco);
      if (!m) { erros.push(pedaco); continue; }
      let a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b - a > 10000) { erros.push(pedaco); continue; }
      for (let n = a; n <= b; n++) numeros.add(String(n));
    }
    return { ok: numeros.size > 0 && erros.length === 0, numeros, erros };
  }

  const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function filtrarItens(itens, { busca = '', filtro = 'todos' } = {}) {
    const b = semAcento(busca).trim(), numero = /^\d+$/.test(b) ? String(BigInt(b)) : null;
    const achados = itens.filter((i) => {
      if (filtro === 'selecionados' && !i.participar) return false;
      if (filtro === 'nao_selecionados' && i.participar) return false;
      if (['exclusivo', 'cota', 'ampla'].includes(filtro) && classe(i.tipoBeneficio) !== filtro) return false;
      if (!b) return true;
      if (numero !== null && chaveNumero(i.identificador) === numero) return true;
      // Busca por número acha o item com aquele número (o 1 não traz o 12); texto procura também no identificador.
      return semAcento(`${numero === null ? i.identificador : ''} ${i.descricao} ${i.marca || ''} ${i.modelo || ''}`).includes(b);
    });
    // Número digitado: o item com esse número vem primeiro; depois os que citam o número na descrição ("500 folhas").
    return numero === null ? achados : [...achados.filter((i) => chaveNumero(i.identificador) === numero), ...achados.filter((i) => chaveNumero(i.identificador) !== numero)];
  }
  // Itens que a empresa não ME/EPP estaria marcando nos exclusivos/cota: pedem confirmação.
  const bloqueadosParaPorte = (itens, porte) => (ehMeEpp(porte) ? [] : itens.filter((i) => restrito(i.tipoBeneficio)));
  function textoConfirmacao(n, porte) {
    const quem = porte === null ? 'O porte da empresa não está informado no Perfil da empresa' : 'Sua empresa não é ME/EPP (Perfil da empresa)';
    return `${quem}. ${n === 1 ? '1 item é exclusivo' : `${n} itens são exclusivos`} para ME/EPP ou cota reservada: só microempresa e empresa de pequeno porte podem participar. Marcar mesmo assim?`;
  }
  function textoPorte(porte) {
    if (ehMeEpp(porte)) return { situacao: 'ok', texto: `Empresa ${porte === 'mei' ? 'MEI' : porte.toUpperCase()}: pode entrar nos itens exclusivos ME/EPP e na cota reservada.` };
    if (porte === 'demais') return { situacao: 'atrasado', texto: 'Sua empresa não é ME/EPP: não pode participar dos itens exclusivos ME/EPP nem da cota reservada.' };
    return { situacao: 'atencao', texto: 'Porte não informado. Informe no Perfil da empresa para saber se pode entrar nos itens exclusivos ME/EPP.' };
  }

  // chamar(corpo) -> { r, j } (nunca lança). total(quantidade, valor) -> centavos BigInt ou null; reais(centavos) -> texto.
  // aoMudar(item): oferta salva (a casca atualiza o cartão). aoSalvar(): avisa o kit que a proposta mudou.
  function montar({ alvo, doc, chamar, total, reais, aoMudar = () => {}, aoSalvar = () => {}, confirmar = (t) => global.confirm(t) }) {
    let itens = [], porte = null, vivo = true, ocupado = false, filtro = 'todos', busca = '', pagina = 1, tamanho = 10;
    const PG = global.LicitaPaginacao;
    const h = (tag, attrs = {}, ...filhos) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, v === true ? '' : String(v));
      }
      e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
      return e;
    };
    alvo.hidden = true;
    alvo.className = 'itens-escolha';
    alvo.setAttribute('aria-labelledby', 'itens-escolha-titulo');
    alvo.innerHTML = `<h3 id="itens-escolha-titulo">Em quais itens você vai participar?</h3>
      <p class="itens-escolha-contador" data-escolha-contador></p>
      <p class="itens-apoio" data-escolha-total></p>
      <p class="selo-porte" data-escolha-porte></p>
      <p class="itens-apoio">Só os itens marcados entram na proposta e no arquivo para o portal. Os outros ficam guardados aqui. Preço, marca e modelo salvam ao sair do campo.</p>
      <div class="itens-escolha-filtros">
        <div class="itens-campo"><label for="itens-escolha-busca">Buscar item (número ou texto)</label><input id="itens-escolha-busca" type="search" data-escolha-busca autocomplete="off" placeholder="Ex.: 12 ou papel A4"></div>
        <div class="itens-campo"><label for="itens-escolha-filtro">Mostrar</label><select id="itens-escolha-filtro" data-escolha-filtro></select></div>
      </div>
      <div class="itens-acoes"><button type="button" data-escolha-marcar></button><button type="button" data-escolha-desmarcar></button></div>
      <form class="itens-escolha-atalho" data-escolha-atalho novalidate>
        <div class="itens-campo"><label for="itens-escolha-faixas">Só quero os itens</label><input id="itens-escolha-faixas" name="faixas" inputmode="text" autocomplete="off" placeholder="Ex.: 3, 7, 10-15" aria-describedby="itens-escolha-faixas-ajuda"></div>
        <p class="itens-apoio" id="itens-escolha-faixas-ajuda">Marca só estes números e tira os outros da proposta.</p>
        <div class="itens-acoes"><button type="submit">Ficar só com estes itens</button></div>
      </form>
      <p class="itens-escolha-estado" data-escolha-estado role="status" aria-live="polite"></p>
      <div class="tabela-rolagem" tabindex="0" role="region" aria-label="Itens do edital para escolher"><table class="itens-escolha-tabela"><thead><tr>
        <th scope="col">Vou participar</th><th scope="col">Item</th><th scope="col">Descrição</th><th scope="col">Tipo</th><th scope="col">Quantidade</th>
        <th scope="col">Preço unitário (R$)</th><th scope="col">Marca</th><th scope="col">Modelo</th><th scope="col">Total</th></tr></thead><tbody data-escolha-linhas></tbody></table></div>
      <div data-escolha-paginas></div>`;
    const el = (s) => alvo.querySelector(s);
    el('[data-escolha-filtro]').replaceChildren(...FILTROS.map(([v, t]) => h('option', { value: v, texto: t })));
    const estado = (t, situacao) => { const p = el('[data-escolha-estado]'); p.textContent = t || ''; p.dataset.situacao = situacao || ''; };
    const visiveis = () => filtrarItens(itens, { busca, filtro });

    function resumo() {
      const marcados = itens.filter((i) => i.participar);
      el('[data-escolha-contador]').textContent = `${marcados.length} de ${itens.length} ${itens.length === 1 ? 'item selecionado' : 'itens selecionados'}`;
      let soma = 0n, semPreco = 0;
      for (const i of marcados) { const t = total(i.quantidade, i.valorUnitario); if (t === null) semPreco++; else soma += t; }
      // A casca (processo-abas.js) mostra contador e total no cabeçalho fixo do processo.
      if (typeof global.CustomEvent === 'function') alvo.dispatchEvent(new global.CustomEvent('licita:itens-resumo', { bubbles: true, detail: { marcados: marcados.length, total: itens.length, soma: reais(soma), semPreco } }));
      el('[data-escolha-total]').textContent = marcados.length ? `Total da proposta: ${reais(soma)}${semPreco ? ` (${semPreco} ${semPreco === 1 ? 'item marcado ainda sem preço' : 'itens marcados ainda sem preço'})` : ''}.` : 'Nenhum item marcado: a proposta fica vazia.';
      const v = visiveis(), marcar = v.filter((i) => !i.participar).length, tirar = v.filter((i) => i.participar).length;
      const bm = el('[data-escolha-marcar]'), bd = el('[data-escolha-desmarcar]');
      bm.textContent = `Marcar todos do filtro (${marcar})`; bm.disabled = ocupado || !marcar;
      bd.textContent = `Desmarcar todos do filtro (${tirar})`; bd.disabled = ocupado || !tirar;
    }
    function quantidadeTexto(i) {
      const q = String(i.quantidade ?? '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
      const [a, b] = q.split('.');
      return `${(a || '').replace(/\B(?=(\d{3})+$)/g, '.')}${b ? `,${b}` : ''}${i.unidade ? ` ${i.unidade}` : ''}`;
    }
    function linha(i) {
      const id = (s) => `itens-escolha-${s}-${i.id}`, c = classe(i.tipoBeneficio), bloqueado = !ehMeEpp(porte) && restrito(i.tipoBeneficio);
      const t = total(i.quantidade, i.valorUnitario);
      const desc = String(i.descricao || '');
      return h('tr', { 'data-escolha-item': i.id, 'data-participa': i.participar ? 'sim' : 'nao' },
        h('td', {}, h('input', { type: 'checkbox', id: id('participar'), 'data-escolha-participar': i.id, checked: i.participar, 'aria-label': `Vou participar do item ${i.identificador}`, disabled: ocupado })),
        h('td', {}, h('strong', { texto: i.identificador })),
        h('td', { title: desc.length > 160 ? desc : null, texto: desc.length > 160 ? `${desc.slice(0, 157)}…` : desc }),
        h('td', {}, h('span', { classe: 'selo-beneficio', 'data-beneficio': c, texto: ROTULO[c] }),
          bloqueado ? h('span', { classe: 'itens-escolha-aviso', texto: porte === null ? 'Confira seu porte' : 'Sua empresa não pode' }) : null),
        h('td', { texto: quantidadeTexto(i) }),
        h('td', {}, h('input', { id: id('preco'), 'data-escolha-campo': 'valorUnitario', 'data-item': i.id, inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: campoReais(i.valorUnitario), 'aria-label': `Preço unitário ofertado do item ${i.identificador} (R$)`, 'aria-describedby': id('estado') })),
        h('td', {}, h('input', { id: id('marca'), 'data-escolha-campo': 'marca', 'data-item': i.id, maxlength: 500, autocomplete: 'off', value: i.marca || '', 'aria-label': `Marca do item ${i.identificador}` })),
        h('td', {}, h('input', { id: id('modelo'), 'data-escolha-campo': 'modelo', 'data-item': i.id, maxlength: 500, autocomplete: 'off', value: i.modelo || '', 'aria-label': `Modelo do item ${i.identificador}` })),
        h('td', {}, h('span', { 'data-escolha-total-item': i.id, texto: t === null ? '—' : reais(t) }), h('span', { id: id('estado'), classe: 'itens-campo-estado', 'data-escolha-linha-estado': i.id })));
    }
    // Só a página atual vira linha (edital de 200 itens = 20 páginas de 10); sem paginacao-ui.js, todas as linhas.
    function render() {
      const todos = visiveis(), f = PG ? PG.fatiar(todos, pagina, tamanho) : null, v = f ? f.itens : todos;
      if (f) pagina = f.pagina;
      el('[data-escolha-linhas]').replaceChildren(...(v.length ? v.map(linha) : [h('tr', {}, h('td', { colspan: 9, texto: 'Nenhum item neste filtro.' }))]));
      el('[data-escolha-paginas]').replaceChildren(...(f && f.total > PG.TAMANHOS[0] ? [PG.barra(doc, { fatia: f, rotulo: 'itens', id: 'itens-escolha-paginas',
        mudar: (n) => { pagina = n.pagina; tamanho = n.tamanho; render(); el('[data-escolha-linhas]').closest('.tabela-rolagem')?.scrollIntoView?.({ block: 'nearest' }); } })] : []));
      const p = textoPorte(porte), selo = el('[data-escolha-porte]');
      selo.textContent = p.texto; selo.dataset.situacao = p.situacao;
      resumo();
    }
    function travar(v) {
      ocupado = v;
      for (const b of alvo.querySelectorAll('button, [data-escolha-participar]')) b.disabled = v;
      if (!v) resumo();
    }

    async function recarregar() {
      const { r, j } = await chamar({ acao: 'lerEscolha' });
      if (!vivo) return;
      // Banco sem operacao_itens_participar.sql (503) ou processo sem itens: o quadro some, o resto da tela segue igual.
      if (!r || !r.ok || !Array.isArray(j?.itens)) { itens = []; alvo.hidden = true; return; }
      itens = j.itens; porte = ['mei', 'me', 'epp', 'demais'].includes(j.porte) ? j.porte : null;
      alvo.hidden = itens.length === 0;
      render(); // render -> resumo avisa o cabeçalho, inclusive "0 itens" (falta importar)
    }
    // Marca/desmarca no servidor; só muda a tela com a confirmação. Retorna true se gravou.
    async function gravarEscolha(lista, participar) {
      if (!lista.length) return true;
      const { r, j } = await chamar({ acao: 'salvarEscolha', itemIds: lista.map((i) => i.id), participar });
      if (!vivo) return false;
      if (r && r.ok && Number.isInteger(j?.gravados)) {
        for (const i of lista) i.participar = participar;
        try { aoSalvar(); } catch { /* sem efeito na escolha */ }
        return true;
      }
      estado(j?.erro || 'Não foi possível salvar a escolha agora. Tente de novo.', 'erro');
      await recarregar(); // parte pode ter sido gravada: mostra o que está no banco
      return false;
    }
    // Confirmação só quando a empresa (não ME/EPP) marca exclusivos/cota. Cancelar não grava nada.
    const podeMarcar = (lista) => { const b = bloqueadosParaPorte(lista, porte); return !b.length || confirmar(textoConfirmacao(b.length, porte)); };

    async function alternar(caixa) {
      const i = itens.find((x) => x.id === caixa.dataset.escolhaParticipar);
      if (!i || ocupado) { caixa.checked = Boolean(i?.participar); return; }
      const participar = caixa.checked;
      if (participar && !podeMarcar([i])) { caixa.checked = false; estado(`Item ${i.identificador} continua fora da proposta.`, ''); return; }
      travar(true); estado('Salvando a escolha…', 'carregando');
      const ok = await gravarEscolha([i], participar);
      if (!vivo) return;
      travar(false); render();
      if (ok) estado(participar ? `Item ${i.identificador} entra na proposta.` : `Item ${i.identificador} saiu da proposta (continua guardado).`, 'ok');
      alvo.querySelector(`[data-escolha-participar="${i.id}"]`)?.focus?.();
    }
    async function marcarFiltro(participar) {
      if (ocupado) return;
      const lista = visiveis().filter((i) => i.participar !== participar);
      if (!lista.length || (participar && !podeMarcar(lista))) return;
      travar(true); estado('Salvando a escolha…', 'carregando');
      const ok = await gravarEscolha(lista, participar);
      if (!vivo) return;
      travar(false); render();
      if (ok) estado(`${lista.length} ${lista.length === 1 ? 'item' : 'itens'} ${participar ? 'marcado(s) para a proposta' : 'tirado(s) da proposta'}.`, 'ok');
    }
    async function ficarSo(ev) {
      ev.preventDefault();
      if (ocupado) return;
      const campo = el('[data-escolha-atalho]').elements.faixas, f = lerFaixas(campo.value);
      if (!f.ok) { campo.setAttribute('aria-invalid', 'true'); estado(f.erros.length ? `Não entendi: ${f.erros.slice(0, 5).join(', ')}. Use números e faixas separados por vírgula. Ex.: 3, 7, 10-15` : 'Digite os números dos itens. Ex.: 3, 7, 10-15', 'erro'); campo.focus?.(); return; }
      campo.removeAttribute('aria-invalid');
      const existentes = new Set(itens.map((i) => chaveNumero(i.identificador)));
      const faltam = [...f.numeros].filter((n) => !existentes.has(n));
      const quero = itens.filter((i) => f.numeros.has(chaveNumero(i.identificador)));
      if (!quero.length) { estado(`Nenhum destes números existe no edital (${faltam.slice(0, 10).join(', ')}).`, 'erro'); return; }
      const marcar = quero.filter((i) => !i.participar), tirar = itens.filter((i) => i.participar && !f.numeros.has(chaveNumero(i.identificador)));
      if (!podeMarcar(marcar)) { estado('Nada mudou.', ''); return; }
      travar(true); estado('Salvando a escolha…', 'carregando');
      const ok = (await gravarEscolha(marcar, true)) && (await gravarEscolha(tirar, false));
      if (!vivo) return;
      travar(false); filtro = 'selecionados'; pagina = 1; el('[data-escolha-filtro]').value = filtro; render();
      if (ok) estado(`Pronto: ${quero.length} ${quero.length === 1 ? 'item ficou' : 'itens ficaram'} na proposta; os outros ${itens.length - quero.length} ficaram fora.${faltam.length ? ` Não existem no edital: ${faltam.slice(0, 10).join(', ')}${faltam.length > 10 ? '…' : ''}.` : ''}`, 'ok');
    }
    async function salvarOferta(campo) {
      const i = itens.find((x) => x.id === campo.dataset.item);
      if (!i) return;
      const linhaEl = campo.closest('tr'), aviso = linhaEl.querySelector('[data-escolha-linha-estado]');
      const valores = Object.fromEntries(['valorUnitario', 'marca', 'modelo'].map((k) => [k, linhaEl.querySelector(`[data-escolha-campo="${k}"]`).value.trim()]));
      const preco = valores.valorUnitario ? normalizarDecimal(valores.valorUnitario, 2) : null;
      const precoCampo = linhaEl.querySelector('[data-escolha-campo="valorUnitario"]');
      if (preco !== null && (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(preco) || /^0(?:\.0*)?$/.test(preco))) {
        precoCampo.setAttribute('aria-invalid', 'true'); aviso.textContent = 'Use reais com vírgula, maior que zero. Ex.: 52,00'; aviso.dataset.situacao = 'erro'; return;
      }
      precoCampo.removeAttribute('aria-invalid');
      const corpo = { acao: 'salvarOferta', itemId: i.id, valorUnitario: preco, marca: valores.marca || null, modelo: valores.modelo || null };
      const igual = (a, b) => (a ?? null) === (b ?? null);
      if (igual(campoReais(corpo.valorUnitario), campoReais(i.valorUnitario)) && igual(corpo.marca, i.marca) && igual(corpo.modelo, i.modelo)) { aviso.textContent = ''; return; }
      aviso.textContent = 'Salvando…'; aviso.dataset.situacao = 'carregando';
      const { r, j } = await chamar(corpo);
      if (!vivo) return;
      const atual = alvo.querySelector(`[data-escolha-linha-estado="${i.id}"]`);
      if (r && r.ok && j?.item) {
        Object.assign(i, { valorUnitario: j.item.valorUnitario, marca: j.item.marca, modelo: j.item.modelo });
        const p = alvo.querySelector(`[data-escolha-item="${i.id}"] [data-escolha-campo="valorUnitario"]`);
        if (p && doc.activeElement !== p) p.value = campoReais(i.valorUnitario);
        const t = total(i.quantidade, i.valorUnitario), cel = alvo.querySelector(`[data-escolha-total-item="${i.id}"]`);
        if (cel) cel.textContent = t === null ? '—' : reais(t);
        if (atual) { atual.textContent = 'Salvo'; atual.dataset.situacao = 'ok'; }
        resumo();
        try { aoSalvar(); } catch { /* sem efeito na oferta */ }
        try { aoMudar(j.item); } catch { /* sem efeito na oferta */ }
        return;
      }
      if (atual) { atual.textContent = j?.erro || 'Não foi possível salvar agora. Saia do campo de novo para tentar.'; atual.dataset.situacao = 'erro'; }
    }

    el('[data-escolha-busca]').addEventListener('input', (ev) => { busca = ev.target.value; pagina = 1; render(); });
    el('[data-escolha-filtro]').addEventListener('change', (ev) => { filtro = ev.target.value; pagina = 1; render(); });
    el('[data-escolha-marcar]').addEventListener('click', () => { void marcarFiltro(true); });
    el('[data-escolha-desmarcar]').addEventListener('click', () => { void marcarFiltro(false); });
    el('[data-escolha-atalho]').addEventListener('submit', (ev) => { void ficarSo(ev); });
    alvo.addEventListener('change', (ev) => {
      const d = ev.target?.dataset || {};
      if (d.escolhaParticipar) void alternar(ev.target);
      else if (d.escolhaCampo) void salvarOferta(ev.target);
    });
    return {
      recarregar,
      // Mapa id → participar (undefined = escolha indisponível): o arquivo do portal leva só os marcados.
      participa: (id) => { const i = itens.find((x) => x.id === id); return i ? i.participar : undefined; },
      disponivel: () => itens.length > 0,
      // Item importado sozinho ("Importar este item"): a pessoa quis este item, então ele já entra marcado,
      // a não ser que seja exclusivo ME/EPP e a empresa não seja ME/EPP (aí ela decide na lista).
      async marcarImportado(id) {
        await recarregar();
        const i = itens.find((x) => x.id === id);
        if (!i || i.participar) return '';
        if (bloqueadosParaPorte([i], porte).length) return ` Item ${i.identificador} é ${ROTULO[classe(i.tipoBeneficio)]}: ficou fora da proposta. Marque na lista se puder participar.`;
        if (await gravarEscolha([i], true)) { render(); return ` Item ${i.identificador} marcado para a proposta.`; }
        return '';
      },
      fechar() { vivo = false; },
    };
  }

  const api = { montar, normalizarDecimal, campoReais, lerFaixas, filtrarItens, restrito, ehMeEpp, classe, bloqueadosParaPorte, textoConfirmacao, textoPorte, chaveNumero };
  global.LicitaItensEscolha = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
