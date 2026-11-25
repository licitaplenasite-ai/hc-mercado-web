/* global module */
// Órgãos sem digitar (24/11/2026): a área de busca/escolha de orgao.html antes da ficha. O dono: "a gente não é obrigado a
// saber o nome, o CNPJ ou a UASG". Escolhida a UF, aparece a relação de órgãos do estado agrupada por tipo, com filtro de
// cidade, esfera e "só com licitação aberta"; sem nada escolhido, blocos de início (mais abertas, prefeituras do estado,
// acompanhados, já disputados). Dados: listar_orgaos / listar_municipios_orgaos (supabase/orgaos_navegacao.sql).
// Regras sem rede no topo (testadas em orgaos-navegacao.test.js); a tela em montar(), chamada por orgao.html.
(function (raiz) {
  'use strict';
  // Mesma ordem e mesmos códigos de orgao_tipo/orgao_tipo_ordem do banco.
  const TIPOS = [
    ['prefeitura', 'Prefeituras'], ['legislativo', 'Câmaras e Assembleias'], ['municipal', 'Secretarias e fundos municipais'],
    ['estadual', 'Governo do Estado e secretarias'], ['justica', 'Tribunais, Justiça e MP'], ['universidade', 'Universidades e institutos federais'],
    ['seguranca', 'Forças Armadas e Segurança'], ['saude', 'Saúde (hospitais e fundos)'], ['educacao', 'Educação'],
    ['autarquia', 'Autarquias e fundações'], ['consorcio', 'Consórcios'], ['federal', 'Outros federais'], ['outros', 'Outros (empresas públicas, Sistema S)'],
  ];
  const ROTULO_TIPO = Object.fromEntries(TIPOS);
  const UF_NOME = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
    GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
    PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
    SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
  const ESFERAS = { M: 'Municipal', E: 'Estadual', F: 'Federal', D: 'Distrital' };
  const ORDENS = { abertas: 'Mais licitações abertas', contratos: 'Mais contratos', nome: 'Nome (A–Z)' };
  const POR_PAGINA = 30;

  // "no Acre", "na Bahia", "em Minas Gerais".
  const noEstado = (uf) => `${/^(BA|PB)$/.test(uf) ? 'na' : /^(AL|GO|MG|PE|RO|RR|SC|SP|SE)$/.test(uf) ? 'em' : 'no'} ${UF_NOME[uf]}`;
  const plural = (n, um, varios) => `${Number(n).toLocaleString('pt-BR')} ${Number(n) === 1 ? um : varios}`;
  const ufValida = (u) => Object.prototype.hasOwnProperty.call(UF_NOME, String(u || '').toUpperCase());

  // clientes.estados_interesse (lista de siglas, às vezes "todos"/nomes) -> UFs válidas, sem repetir.
  function ufsDoCliente(estados) {
    return [...new Set((Array.isArray(estados) ? estados : []).map((u) => String(u || '').trim().toUpperCase()).filter(ufValida))];
  }

  // Filtros da tela (e da URL) -> filtros válidos. Cidade só vale com 1 UF.
  function normalizarFiltros(f = {}) {
    const uf = ufValida(f.uf) ? String(f.uf).toUpperCase() : '';
    return {
      uf, municipio: uf ? String(f.municipio || '').trim().slice(0, 120) : '', tipo: ROTULO_TIPO[f.tipo] ? f.tipo : '',
      esfera: ESFERAS[f.esfera] ? f.esfera : '', soAbertas: f.soAbertas === true || f.soAbertas === '1',
      ordem: ORDENS[f.ordem] ? f.ordem : 'abertas', termo: String(f.termo || '').trim().slice(0, 120),
    };
  }
  // Lista aparece com UF, com tipo/esfera/"só abertas" ou com texto de 3+ letras; senão, os blocos de início.
  const listaAtiva = (f) => !!(f.uf || f.tipo || f.esfera || f.soAbertas || termoDaLista(f.termo));
  // Texto que filtra a lista: só com letras (CNPJ/UASG ficam com o autocompletar, que já acha pelo número).
  function termoDaLista(termo) {
    const t = String(termo || '').trim();
    return /[a-zà-ú]/i.test(t) && t.replace(/[^a-z0-9à-ú]/gi, '').length >= 3 ? t : '';
  }
  function parametrosRpc(f, offset = 0, limite = POR_PAGINA) {
    return { p_uf: f.uf || null, p_municipio: f.municipio || null, p_tipo: f.tipo || null, p_esfera: f.esfera || null, p_so_abertas: !!f.soAbertas,
      p_ordem: f.ordem, p_limite: limite, p_offset: offset, p_termo: termoDaLista(f.termo) || null, p_agrupar: !f.tipo };
  }
  function filtrosDaUrl(busca) {
    const p = new URLSearchParams(busca || '');
    return normalizarFiltros({ uf: p.get('uf'), municipio: p.get('cidade'), tipo: p.get('tipo'), esfera: p.get('esfera'), soAbertas: p.get('abertas'), ordem: p.get('ordem'), termo: p.get('q') });
  }
  function urlDosFiltros(f) {
    const p = new URLSearchParams();
    if (f.uf) p.set('uf', f.uf);
    if (f.municipio) p.set('cidade', f.municipio);
    if (f.tipo) p.set('tipo', f.tipo);
    if (f.esfera) p.set('esfera', f.esfera);
    if (f.soAbertas) p.set('abertas', '1');
    if (f.ordem !== 'abertas') p.set('ordem', f.ordem);
    if (termoDaLista(f.termo)) p.set('q', f.termo);
    const s = p.toString();
    return s ? '?' + s : '';
  }

  // Itens já na ordem do banco -> blocos consecutivos por tipo (um título por grupo).
  function agruparPorTipo(itens) {
    const grupos = [];
    for (const o of itens || []) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.tipo === o.tipo) ultimo.itens.push(o);
      else grupos.push({ tipo: o.tipo, rotulo: ROTULO_TIPO[o.tipo] || 'Outros', itens: [o] });
    }
    return grupos;
  }

  // Título da lista: "412 órgãos no Acre · Rio Branco · Prefeituras".
  function tituloLista(total, f) {
    const partes = [`${plural(total, 'órgão', 'órgãos')} ${f.uf ? noEstado(f.uf) : 'no Brasil'}`];
    if (f.municipio) partes.push(f.municipio);
    if (f.tipo) partes.push(ROTULO_TIPO[f.tipo]);
    if (f.esfera) partes.push('esfera ' + ESFERAS[f.esfera].toLowerCase());
    if (f.soAbertas) partes.push('com licitação aberta agora');
    return partes.join(' · ');
  }

  // Processos da organização -> órgãos com que ela já disputou (pelo CNPJ do nº de controle do PNCP; sem ele, pelo nome).
  function orgaosDisputados(processos, normalizarNome) {
    const mapa = new Map();
    for (const p of processos || []) {
      const cnpj = /^(\d{14})-/.exec(String(p?.origem_externa_id || ''))?.[1] || null;
      const nome = String(p?.orgao || '').trim();
      const chave = cnpj ? 'c:' + cnpj : nome.length >= 3 ? 'n:' + normalizarNome(nome) : null;
      if (!chave) continue;
      const o = mapa.get(chave) || { cnpj, nome: '', disputas: 0, ganhou: 0 };
      o.disputas++;
      if (p.situacao_resultado === 'ganhou' || p.status === 'homologado' || p.status === 'contratado') o.ganhou++;
      if (!o.nome && nome) o.nome = nome;
      mapa.set(chave, o);
    }
    return [...mapa.values()].sort((a, b) => b.disputas - a.disputas || a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  const api = { TIPOS, ROTULO_TIPO, UF_NOME, ESFERAS, ORDENS, POR_PAGINA, ufsDoCliente, normalizarFiltros, listaAtiva, termoDaLista,
    parametrosRpc, filtrosDaUrl, urlDosFiltros, agruparPorTipo, tituloLista, orgaosDisputados, plural, noEstado };

  // ---------- Tela ----------
  // ctx: { sb, F (ficha-orgao.js), esc, orgId, raiz (elemento), campoTermo, campoUf, acompanhados: [{cnpj,nome,desde}] | null }
  function montar(ctx) {
    const { sb, F, esc } = ctx;
    const $ = (id) => document.getElementById(id);
    const estado = { f: filtrosDaUrl(location.search), itens: [], total: 0, tipos: {}, seq: 0, carregando: false, municipios: new Map(), ufs: [], observador: null };
    if (estado.f.uf) ctx.campoUf.value = estado.f.uf;
    if (estado.f.termo && !ctx.campoTermo.value) ctx.campoTermo.value = estado.f.termo;
    estado.f.termo = ctx.campoTermo.value.trim();

    ctx.raiz.innerHTML = `
      <section class="fo-secao on-navegar" id="on-navegar" aria-labelledby="on-h-lista" hidden>
        <div class="on-cabeca-lista"><h2 id="on-h-lista">Órgãos</h2><button type="button" class="btn on-limpar" id="on-limpar">Limpar filtros</button></div>
        <div class="on-filtros">
          <div><label for="on-cidade">Cidade</label><select id="on-cidade" disabled><option value="">Todas as cidades</option></select></div>
          <div><label for="on-esfera">Esfera</label><select id="on-esfera"><option value="">Todas</option>${Object.entries(ESFERAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div><label for="on-ordem">Ordenar por</label><select id="on-ordem">${Object.entries(ORDENS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <label class="on-check" for="on-abertas"><input type="checkbox" id="on-abertas"> Só com licitação aberta agora</label>
        </div>
        <div class="on-tipos" id="on-tipos" role="group" aria-label="Tipo de órgão"></div>
        <p class="on-titulo" id="on-titulo" role="status" aria-live="polite"></p>
        <div id="on-lista"></div>
        <div class="on-mais"><button type="button" class="btn" id="on-mais" hidden>Mostrar mais órgãos</button></div>
      </section>
      <div id="on-inicio"></div>`;

    const desenharTipos = () => {
      const total = Object.values(estado.tipos).reduce((s, n) => s + n, 0);
      const botao = (tipo, rotulo, n) => `<button type="button" class="on-tipo" data-tipo="${tipo}" aria-pressed="${estado.f.tipo === tipo}">${esc(rotulo)} <span>${Number(n).toLocaleString('pt-BR')}</span></button>`;
      $('on-tipos').innerHTML = botao('', 'Todos', total) + TIPOS.filter(([t]) => estado.tipos[t] || estado.f.tipo === t).map(([t, r]) => botao(t, r, estado.tipos[t] || 0)).join('');
    };
    const linha = (o) => {
      const local = [o.municipio, o.uf].filter(Boolean).join('/');
      const abertas = o.abertas ? `<span class="fo-chip emdia">${esc(plural(o.abertas, 'aberta agora', 'abertas agora'))}</span>` : '<span class="fo-chip neutro">Nenhuma aberta</span>';
      return `<li class="on-item"><div class="on-item-nome"><a href="${esc(F.linkFicha({ cnpj: o.cnpj, nome: o.nome }))}">${esc(o.nome)}</a>
          <small>${esc([local || 'Cidade não informada', 'CNPJ ' + F.formatarCnpj(o.cnpj), o.cnpjs > 1 ? `${o.cnpjs} CNPJs (matriz e filiais)` : ''].filter(Boolean).join(' · '))}</small>
          ${o.secretarias > 0 && o.municipio ? `<button type="button" class="on-link on-secretarias" data-on-uf="${esc(o.uf)}" data-on-cidade="${esc(o.municipio)}" data-on-esfera="M">Ver secretarias e fundos (${Number(o.secretarias).toLocaleString('pt-BR')})</button>` : ''}</div>
        <div class="on-item-numeros">${abertas}<span class="on-num"><b>${Number(o.contratos).toLocaleString('pt-BR')}</b> ${o.contratos === 1 ? 'contrato' : 'contratos'}</span><span class="on-num"><b>${Number(o.atas).toLocaleString('pt-BR')}</b> ${o.atas === 1 ? 'ata' : 'atas'}</span></div>
        <a class="btn on-abrir" href="${esc(F.linkFicha({ cnpj: o.cnpj, nome: o.nome }))}" aria-label="Abrir ficha: ${esc(o.nome)}">Abrir ficha</a></li>`;
    };
    function desenharLista() {
      const f = estado.f;
      if (!estado.itens.length) {
        const semFiltro = !f.municipio && !f.tipo && !f.esfera && !f.soAbertas && !termoDaLista(f.termo);
        $('on-lista').innerHTML = `<div class="on-vazio"><p>${semFiltro && f.uf
          ? `Ainda não temos órgãos de ${esc(UF_NOME[f.uf])} com o estado identificado. Estamos completando o estado e a cidade de todos os órgãos do cadastro do PNCP; enquanto isso, digite o nome, a cidade ou o CNPJ no campo acima.`
          : 'Nenhum órgão com esses filtros.'}</p>${semFiltro ? '' : '<button type="button" class="btn" data-on-limpar>Limpar filtros</button>'}</div>`;
        return;
      }
      const grupos = f.tipo ? [{ tipo: f.tipo, rotulo: '', itens: estado.itens }] : agruparPorTipo(estado.itens);
      $('on-lista').innerHTML = grupos.map((g) => `${g.rotulo ? `<h3 class="on-grupo">${esc(g.rotulo)} <span>${Number(estado.tipos[g.tipo] || g.itens.length).toLocaleString('pt-BR')}</span></h3>` : ''}<ul class="on-itens">${g.itens.map(linha).join('')}</ul>`).join('');
    }
    function erroLista(error) {
      const semBanco = error?.code === 'PGRST202' || /listar_orgaos/.test(error?.message || '');
      $('on-titulo').textContent = '';
      $('on-lista').innerHTML = `<div class="on-vazio erro" role="alert"><p>${semBanco ? 'A lista de órgãos por estado fica disponível depois da atualização do banco. Enquanto isso, digite o nome, a cidade ou o CNPJ no campo acima.' : 'A lista não respondeu agora. Tente de novo em instantes.'}</p>${semBanco ? '' : '<button type="button" class="btn" id="on-tentar">Tentar de novo</button>'}</div>`;
      $('on-tentar')?.addEventListener('click', () => carregar(false));
    }

    async function carregar(mais) {
      const meu = ++estado.seq, f = estado.f;
      estado.carregando = true;
      $('on-mais').disabled = true;
      if (!mais) { $('on-titulo').textContent = 'Carregando órgãos…'; $('on-lista').setAttribute('aria-busy', 'true'); }
      const r = await sb.rpc('listar_orgaos', parametrosRpc(f, mais ? estado.itens.length : 0));
      if (meu !== estado.seq) return; // filtro mudou enquanto esperava
      estado.carregando = false;
      $('on-lista').removeAttribute('aria-busy');
      $('on-mais').disabled = false;
      if (r.error) { erroLista(r.error); $('on-mais').hidden = true; return; }
      const d = r.data || {};
      estado.itens = mais ? estado.itens.concat(d.itens || []) : d.itens || [];
      estado.total = Number(d.total) || 0;
      estado.tipos = d.tipos || {};
      $('on-titulo').textContent = tituloLista(estado.total, f);
      desenharTipos();
      desenharLista();
      const faltam = estado.total - estado.itens.length;
      $('on-mais').hidden = faltam <= 0;
      $('on-mais').textContent = `Mostrar mais órgãos (${estado.itens.length.toLocaleString('pt-BR')} de ${estado.total.toLocaleString('pt-BR')})`;
    }

    async function carregarMunicipios(uf) {
      const sel = $('on-cidade');
      sel.disabled = true;
      sel.innerHTML = `<option value="">${uf ? 'Todas as cidades' : 'Escolha a UF primeiro'}</option>`;
      if (!uf) return;
      if (!estado.municipios.has(uf)) {
        const r = await sb.rpc('listar_municipios_orgaos', { p_uf: uf });
        if (r.error) return;
        estado.municipios.set(uf, r.data || []);
      }
      if (estado.f.uf !== uf) return;
      sel.innerHTML = '<option value="">Todas as cidades</option>' + estado.municipios.get(uf).map((m) => `<option value="${esc(m.municipio)}">${esc(m.municipio)} (${Number(m.orgaos).toLocaleString('pt-BR')})</option>`).join('');
      sel.value = estado.municipios.get(uf).some((m) => m.municipio === estado.f.municipio) ? estado.f.municipio : '';
      sel.disabled = false;
    }

    function aplicar(mudanca, opcoes = {}) {
      const ufAntes = estado.f.uf;
      estado.f = normalizarFiltros({ ...estado.f, ...mudanca });
      if (estado.f.uf !== ufAntes) { if (!('municipio' in mudanca)) estado.f.municipio = ''; carregarMunicipios(estado.f.uf); }
      history.replaceState(null, '', location.pathname + urlDosFiltros(estado.f));
      $('on-esfera').value = estado.f.esfera;
      $('on-ordem').value = estado.f.ordem;
      $('on-abertas').checked = estado.f.soAbertas;
      const ativa = listaAtiva(estado.f);
      $('on-navegar').hidden = !ativa;
      $('on-inicio').hidden = ativa;
      $('on-h-lista').textContent = estado.f.uf ? `Órgãos ${noEstado(estado.f.uf).replace(/^(no|na|em) /, (m) => ({ 'no ': 'do ', 'na ': 'da ', 'em ': 'de ' })[m])}` : 'Órgãos do Brasil';
      if (ativa) carregar(false);
      else inicio();
      if (opcoes.rolar && ativa) $('on-navegar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Integração com a busca existente: UF do formulário escolhe o estado; o texto digitado filtra a lista.
    ctx.campoUf.addEventListener('change', () => aplicar({ uf: ctx.campoUf.value }));
    let timer = 0;
    ctx.campoTermo.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (termoDaLista(ctx.campoTermo.value) !== termoDaLista(estado.f.termo)) aplicar({ termo: ctx.campoTermo.value }); else estado.f.termo = ctx.campoTermo.value.trim(); }, 400);
    });
    $('on-cidade').addEventListener('change', (ev) => aplicar({ municipio: ev.target.value }));
    $('on-esfera').addEventListener('change', (ev) => aplicar({ esfera: ev.target.value }));
    $('on-ordem').addEventListener('change', (ev) => aplicar({ ordem: ev.target.value }));
    $('on-abertas').addEventListener('change', (ev) => aplicar({ soAbertas: ev.target.checked }));
    $('on-tipos').addEventListener('click', (ev) => { const b = ev.target.closest('[data-tipo]'); if (b) aplicar({ tipo: b.dataset.tipo }); });
    const limpar = () => { ctx.campoUf.value = ''; ctx.campoTermo.value = ''; aplicar({ uf: '', municipio: '', tipo: '', esfera: '', soAbertas: false, ordem: 'abertas', termo: '' }); ctx.campoUf.focus(); };
    $('on-limpar').addEventListener('click', limpar);
    ctx.raiz.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-on-limpar]')) limpar();
      const uf = ev.target.closest('[data-on-uf]');
      if (uf) {
        ctx.campoUf.value = uf.dataset.onUf;
        aplicar({ uf: uf.dataset.onUf, municipio: uf.dataset.onCidade || '', esfera: uf.dataset.onEsfera || '', tipo: uf.dataset.onTipo || '', soAbertas: uf.dataset.onAbertas === '1', ordem: 'abertas' }, { rolar: true });
      }
    });
    $('on-mais').addEventListener('click', () => carregar(true));
    // Rolagem infinita leve: o botão "Mostrar mais" carrega sozinho quando chega perto da tela (o botão continua lá).
    if ('IntersectionObserver' in window) {
      estado.observador = new IntersectionObserver((ent) => { if (ent.some((e) => e.isIntersecting) && !$('on-mais').hidden && !estado.carregando && estado.itens.length < 300) carregar(true); }, { rootMargin: '200px' });
      estado.observador.observe($('on-mais'));
    }

    // ---------- Início (nada escolhido) ----------
    const blocoLista = (itens, vazio) => (itens.length
      ? `<ul class="on-mini">${itens.map((o) => `<li><a href="${esc(F.linkFicha({ cnpj: o.cnpj, nome: o.nome }))}">${esc(o.nome)}</a><small>${esc([[o.municipio, o.uf].filter(Boolean).join('/'), o.abertas ? plural(o.abertas, 'licitação aberta', 'licitações abertas') : '', o.contratos ? plural(o.contratos, 'contrato', 'contratos') : ''].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>`
      : `<p class="nota">${vazio}</p>`);
    let inicioPronto = null;
    async function inicio() {
      if (inicioPronto) return inicioPronto;
      inicioPronto = (async () => {
        const ufs = estado.ufs;
        const meus = ufs.join(',');
        const pedir = (p) => sb.rpc('listar_orgaos', { p_uf: null, p_municipio: null, p_tipo: null, p_esfera: null, p_so_abertas: false, p_ordem: 'abertas', p_limite: 6, p_offset: 0, p_termo: null, p_agrupar: false, ...p });
        const [noEstado, noBrasil, prefeituras, processos] = await Promise.all([
          ufs.length ? pedir({ p_uf: meus, p_so_abertas: true }) : null,
          pedir({ p_so_abertas: true }),
          ufs.length ? pedir({ p_uf: meus, p_tipo: 'prefeitura', p_limite: 8 }) : null,
          sb.from('operacao_processos').select('origem_externa_id,orgao,status,situacao_resultado').eq('organizacao_id', ctx.orgId).limit(1000),
        ]);
        const falhou = [noEstado, noBrasil, prefeituras].find((r) => r?.error);
        const nomeUfs = ufs.map((u) => UF_NOME[u]).join(', ');
        const disputados = processos.error ? null : orgaosDisputados(processos.data, F.normalizarNome).slice(0, 8);
        const acomp = ctx.acompanhados;
        $('on-inicio').innerHTML = `
          <section class="fo-secao on-estados" aria-labelledby="on-h-estados"><h2 id="on-h-estados">Escolha um estado para ver a relação de órgãos</h2>
            <p class="nota">Prefeituras, câmaras, governo do estado, tribunais, universidades, quartéis, hospitais e mais, agrupados por tipo. Não precisa saber o nome, o CNPJ nem a UASG.</p>
            <div class="on-ufs">${Object.keys(UF_NOME).sort().map((u) => `<button type="button" class="on-uf${ufs.includes(u) ? ' meu' : ''}" data-on-uf="${u}" title="${esc(UF_NOME[u])}" aria-label="Órgãos de ${esc(UF_NOME[u])}${ufs.includes(u) ? ' (seu estado de interesse)' : ''}">${u}</button>`).join('')}</div>
            ${ufs.length ? `<p class="nota on-legenda"><span class="on-uf meu" aria-hidden="true">UF</span> seus estados de interesse no cadastro</p>` : ''}</section>
          ${falhou ? `<p class="aviso ${falhou.error.code === 'PGRST202' ? 'info' : 'erro'}" style="display:block">${falhou.error.code === 'PGRST202' ? 'A relação de órgãos por estado fica disponível depois da atualização do banco.' : 'Parte das listas não respondeu agora. Recarregue a página em instantes.'}</p>` : ''}
          <div class="on-blocos">
            <section class="fo-secao on-bloco destaque" aria-labelledby="on-h-abertas"><h2 id="on-h-abertas">Órgãos com mais licitações abertas agora</h2>
              ${ufs.length ? `<h3>${ufs.length === 1 ? 'No seu estado' : 'Nos seus estados'} (${esc(ufs.join(', '))})</h3>${blocoLista(noEstado?.data?.itens || [], `Nenhum órgão de ${esc(nomeUfs)} com licitação aberta nos dados coletados agora.`)}
                <button type="button" class="on-link" data-on-uf="${ufs[0]}" data-on-abertas="1">Ver todos com licitação aberta em ${esc(UF_NOME[ufs[0]])}</button>` : ''}
              <h3>No Brasil</h3>${blocoLista(noBrasil?.data?.itens || [], 'Nenhuma licitação aberta nos dados coletados agora.')}
              ${ufs.length ? '' : '<p class="nota">Dica: informe seus estados de interesse no seu cadastro para ver aqui os órgãos do seu estado.</p>'}</section>
            <section class="fo-secao on-bloco" aria-labelledby="on-h-pref"><h2 id="on-h-pref">${ufs.length === 1 ? 'Prefeituras do seu estado' : 'Prefeituras dos seus estados'}</h2>
              ${ufs.length ? `${blocoLista(prefeituras?.data?.itens || [], 'As prefeituras aparecem aqui assim que o estado delas for identificado no cadastro do PNCP.')}
                <p class="on-links">${ufs.map((u) => `<button type="button" class="on-link" data-on-uf="${u}" data-on-tipo="prefeitura">Ver todas as prefeituras: ${esc(UF_NOME[u])}</button>`).join('')}</p>`
                : '<p class="nota">Escolha um estado acima para ver todas as prefeituras dele.</p>'}</section>
            <section class="fo-secao on-bloco" aria-labelledby="on-h-acomp"><h2 id="on-h-acomp">Órgãos que você acompanha</h2>
              ${acomp == null ? '<p class="nota">A lista de órgãos acompanhados fica disponível depois da atualização do banco.</p>'
                : acomp.length ? `<ul class="on-mini">${acomp.map((o) => `<li><a href="${esc(F.linkFicha({ cnpj: o.cnpj, nome: o.nome }))}">${esc(o.nome || F.formatarCnpj(o.cnpj) || 'Órgão')}</a><small>${esc([o.cnpj ? 'CNPJ ' + F.formatarCnpj(o.cnpj) : '', o.desde ? 'acompanhando desde ' + o.desde : ''].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>`
                : '<p class="nota">Nenhum ainda. Abra a ficha de um órgão e clique em "Acompanhar este órgão".</p>'}</section>
            <section class="fo-secao on-bloco" aria-labelledby="on-h-disp"><h2 id="on-h-disp">Órgãos com que você já disputou</h2>
              ${disputados == null ? '<p class="nota">Não foi possível ler os seus processos agora.</p>' : disputados.length
                ? `<ul class="on-mini">${disputados.map((o) => `<li><a href="${esc(F.linkFicha({ cnpj: o.cnpj, nome: o.nome }))}">${esc(o.nome || F.formatarCnpj(o.cnpj))}</a><small>${esc(plural(o.disputas, 'disputa', 'disputas') + (o.ganhou ? ' · ' + plural(o.ganhou, 'ganha', 'ganhas') : ''))}</small></li>`).join('')}</ul>`
                : '<p class="nota">Quando você colocar uma licitação no Funil, o órgão dela aparece aqui.</p>'}</section>
          </div>`;
      })();
      return inicioPronto;
    }

    $('on-esfera').value = estado.f.esfera;
    $('on-ordem').value = estado.f.ordem;
    $('on-abertas').checked = estado.f.soAbertas;
    return (async () => {
      const { data: { session } } = await sb.auth.getSession();
      const c = await sb.from('clientes').select('estados_interesse').eq('id', session?.user?.id).maybeSingle();
      estado.ufs = c.error ? [] : ufsDoCliente(c.data?.estados_interesse);
      carregarMunicipios(estado.f.uf);
      aplicar({});
    })();
  }
  api.montar = montar;

  // ---------- Ficha: órgãos do mesmo município (ou do mesmo governo) ----------
  // A Prefeitura de Manaus quase não publica contrato: quem publica são SEMSA, SEMINF, ManausPrev..., cada uma com CNPJ
  // próprio (o Estado idem). Na ficha de prefeitura, câmara ou governo do estado, lista esses órgãos e soma tudo, dizendo
  // com todas as letras que é soma de órgãos diferentes. Resultado guardado por CNPJ: a ficha redesenha várias vezes.
  const cacheEnte = new Map();
  const doEstado = (uf) => noEstado(uf).replace(/^no /, 'do ').replace(/^na /, 'da ').replace(/^em /, 'de ');
  function textoEnte(d) {
    const municipio = d.ente === 'municipio';
    return {
      titulo: municipio ? `Órgãos do mesmo município: ${d.municipio}/${d.uf}` : `Órgãos do mesmo governo: Estado ${doEstado(d.uf)}`,
      soma: municipio ? 'Prefeitura, câmara, secretarias e fundos' : 'Governo do estado, secretarias e órgãos estaduais',
      lista: '?' + new URLSearchParams(municipio ? { uf: d.uf, cidade: d.municipio, esfera: 'M' } : { uf: d.uf, esfera: 'E' }).toString(),
    };
  }
  function desenharEnte(alvo, d, F, esc) {
    if (!alvo) return;
    if (!d) { alvo.innerHTML = ''; return; }
    if (d.pendente) {
      alvo.innerHTML = `<section class="fo-secao fo-mesmo-ente" aria-labelledby="fo-h-ente"><h2 id="fo-h-ente">${d.ente === 'municipio' ? 'Órgãos do mesmo município' : 'Órgãos do mesmo governo'}</h2>
        <p class="on-vazio" role="status">Estamos localizando este órgão no PNCP; as secretarias aparecem em breve.</p></section>`;
      return;
    }
    const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const t = textoEnte(d);
    const outros = Number(d.total.orgaos) - 1;
    const link = (o) => esc(F.linkFicha({ cnpj: o.cnpj, nome: o.nome }));
    alvo.innerHTML = `<section class="fo-secao fo-mesmo-ente" aria-labelledby="fo-h-ente"><h2 id="fo-h-ente">${esc(t.titulo)}</h2>
      <p class="nota">Cada órgão abaixo tem CNPJ próprio e publica os próprios contratos e licitações. Por isso a ficha deste órgão pode mostrar poucos contratos.</p>
      <div class="fo-ente-soma"><span>${esc(t.soma)} (${esc(plural(d.total.orgaos, 'órgão', 'órgãos'))} somados)</span>
        <b>${esc(plural(d.total.contratos, 'contrato', 'contratos'))} · ${esc(brl(d.total.valor))}</b>
        <small>Soma de órgãos diferentes, não de um só. Só este órgão: ${esc(plural(d.proprio?.contratos || 0, 'contrato', 'contratos'))}, ${esc(brl(d.proprio?.valor))}. Contratos coletados pelo robô do LicitaPlena.</small></div>
      ${d.orgaos.length ? `<div class="fo-tabela-wrap" tabindex="0" role="region" aria-label="${esc(t.titulo)}"><table class="fo-tabela"><thead><tr><th scope="col">Órgão</th><th scope="col">Tipo</th><th scope="col">Abertas agora</th><th scope="col">Contratos</th><th scope="col">Valor dos contratos</th><th scope="col" aria-label="Ação"></th></tr></thead><tbody>
        ${d.orgaos.map((o) => `<tr><td><a href="${link(o)}">${esc(o.nome)}</a><small>CNPJ ${esc(F.formatarCnpj(o.cnpj))}</small></td><td>${esc(ROTULO_TIPO[o.tipo] || 'Outros')}</td>
          <td>${o.abertas ? `<span class="fo-chip emdia">${esc(plural(o.abertas, 'aberta', 'abertas'))}</span>` : '<span class="fo-chip neutro">Nenhuma</span>'}</td><td class="num">${Number(o.contratos).toLocaleString('pt-BR')}</td><td class="num">${esc(brl(o.valor))}</td>
          <td><a class="btn on-abrir" href="${link(o)}" aria-label="Abrir ficha: ${esc(o.nome)}">Abrir ficha</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="nota">Nenhum outro órgão com o mesmo local no catálogo.</p>'}
      <p class="nota">${outros > d.orgaos.length ? `Mostrando os ${d.orgaos.length} de maior valor, de ${outros.toLocaleString('pt-BR')}. ` : ''}<a href="orgao.html${esc(t.lista)}">Ver todos na lista de órgãos</a></p>
    </section>`;
  }
  async function montarMesmoEnte({ sb, F, esc, cnpj, alvo }) {
    if (!alvo || !/^[0-9]{14}$/.test(cnpj || '')) return;
    if (cacheEnte.has(cnpj)) { desenharEnte(alvo, cacheEnte.get(cnpj), F, esc); return; }
    const r = await sb.rpc('orgaos_mesmo_ente', { p_cnpj: cnpj });
    // Sem o SQL aplicado ou com falha: a ficha segue sem a seção (não é a informação principal dela).
    const d = r.error ? null : r.data || null;
    if (!r.error) cacheEnte.set(cnpj, d);
    desenharEnte(document.getElementById(alvo.id) || alvo, d, F, esc);
  }
  api.montarMesmoEnte = montarMesmoEnte;
  api.textoEnte = textoEnte;

  raiz.LicitaOrgaosNavegacao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
