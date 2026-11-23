/* global document, window, location, FileReader, CSS, module -- script de navegador (orcamento-obra.html); funções puras testadas no Node */
// Tela "Orçamento de obra" (agente Orçamentista): envia a planilha do edital -> confere o que o Leitor entendeu ->
// monta (preços do SINAPI da UF pelo Supabase, CPU do edital, preço digitado de outra tabela ou 3 cotações) ->
// vê os alertas do Auditor -> baixa as planilhas. A conta é toda no navegador (orcamento-obra-*.js); o banco só
// entrega o SINAPI, pela sessão do usuário (RLS cliente_aprovado). Nada do edital é enviado ao servidor.
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reais = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const pct = (f) => `${(Number(f) * 100).toFixed(2).replace('.', ',')}%`;
  // "1.234,56" ou "1234.56" -> número; vazio ou inválido -> null.
  const numero = (s) => { let t = String(s ?? '').trim().replace(/^R\$\s*/, ''); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); return t && Number.isFinite(Number(t)) ? Number(t) : null; };

  // Linhas do Supabase -> base do Orçamentista. custos: [{ tipo, codigo, preco_sd, preco_cd, referencia }];
  // itens: sinapi_composicao_itens. Preço vazio no regime escolhido fica fora (o item aparece "sem preço").
  function baseDoSupabase(custos, itens, desonerado, uf) {
    const col = desonerado ? 'preco_cd' : 'preco_sd', precos = {}, composicoes = {};
    let referencia = '';
    for (const c of custos || []) {
      if (c[col] !== null && c[col] !== undefined) precos[`${c.tipo}|${c.codigo}`] = Number(c[col]);
      if (c.referencia > referencia) referencia = c.referencia;
    }
    for (const it of itens || []) {
      (composicoes[it.composicao] ||= { descricao: '', unidade: '', itens: [] }).itens.push({ tipo: it.item_tipo, codigo: it.item_codigo, descricao: it.descricao, unidade: it.unidade, coeficiente: Number(it.coeficiente) });
    }
    return { precos, composicoes, uf, desonerado, referencia: String(referencia).slice(0, 7) };
  }
  // Cotações digitadas na tela -> [{ fornecedor, valor }] (só as que têm valor).
  function lerCotacoes(campos) {
    return campos.map((c, i) => ({ fornecedor: String(c.fornecedor || '').trim().slice(0, 120) || `Fornecedor ${i + 1}`, valor: numero(c.valor) })).filter((c) => c.valor > 0);
  }

  // Palavras para achar serviço parecido no SINAPI: sem acento, minúsculas, sem palavra vazia, as mais longas primeiro
  // (a busca usa cada palavra solta, então a ordem não importa: "piso porcelanato" acha "PORCELANATO ... PISO").
  const VAZIAS = new Set('para com sem por das dos de da do em no na nos nas ou e a o as os ate tipo inclusive fornecimento instalacao execucao servico'.split(' '));
  function palavrasBusca(descricao, max = 4) {
    const t = String(descricao || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
    return [...new Set(t.split(/\s+/).filter((p) => p.length >= 4 && !VAZIAS.has(p) && !/\d/.test(p)))].sort((a, b) => b.length - a.length).slice(0, max);
  }

  // ---- Histórico por data-base (bases_preco_versoes / bases_preco_partes) ----
  const mesDe = (d) => String(d || '').slice(0, 7);
  // Data-base do edital ("AAAA-MM") + versões do SINAPI no histórico -> qual usar e o aviso. versao null = tabelas
  // vigentes (sinapi_*). Sem histórico no banco (bases_preco.sql ainda não aplicado): segue como na fase 1.
  function escolherReferencia(dataBase, versoes) {
    const comPreco = (versoes || []).filter((v) => v.situacao === 'precos').sort((a, b) => (a.data_base < b.data_base ? 1 : -1));
    const maisNova = mesDe(comPreco[0]?.data_base), maisVelha = mesDe(comPreco[comPreco.length - 1]?.data_base);
    const db = mesDe(dataBase);
    if (!comPreco.length || !/^\d{4}-\d{2}$/.test(db) || db === maisNova) return { versao: null, maisNova: maisNova || null, aviso: null };
    if (db > maisNova) return { versao: null, maisNova, nivel: 'info', aviso: `A CAIXA ainda não publicou o SINAPI de ${db}. Usei o mais novo, ${maisNova}.` };
    const exata = (versoes || []).find((v) => mesDe(v.data_base) === db);
    if (exata?.situacao === 'zerada') return { versao: null, maisNova, nivel: 'erro', aviso: `O SINAPI de ${db} saiu sem preço e ainda não foi retificado pela CAIXA. Usei ${maisNova}: confira com a CPU do edital.` };
    if (exata?.situacao === 'precos') return { versao: exata, maisNova, nivel: 'info', aviso: `Preços do SINAPI de ${db}, a data-base do edital. Existe referência mais nova: ${maisNova}.` };
    return { versao: null, maisNova, nivel: 'erro', aviso: `O SINAPI de ${db} não está guardado no sistema (há de ${maisVelha} a ${maisNova}). Usei ${maisNova}: envie a CPU do edital para orçar na data-base certa.` };
  }
  // Partes do histórico -> a mesma base de baseDoSupabase. precos: { "tipo|codigo": [sem, com desoneração] };
  // analitico: { composicao: [[tipo, codigo, coeficiente]] }; descricoes: { "tipo|codigo": [descrição, unidade] }.
  function baseDoHistorico(precos, analitico, descricoes, desonerado, uf, referencia) {
    const i = desonerado ? 1 : 0, out = {}, composicoes = {};
    for (const [k, par] of Object.entries(precos || {})) if (Array.isArray(par) && par[i] !== null && par[i] !== undefined) out[k] = Number(par[i]);
    for (const [comp, itens] of Object.entries(analitico || {})) {
      const [descricao, unidade] = descricoes?.[`composicao|${comp}`] || ['', ''];
      composicoes[comp] = { descricao, unidade, itens: itens.map(([tipo, codigo, coeficiente]) => {
        const [d, u] = descricoes?.[`${tipo}|${codigo}`] || ['', ''];
        return { tipo, codigo, descricao: d, unidade: u, coeficiente: Number(coeficiente) };
      }) };
    }
    return { precos: out, composicoes, uf, desonerado, referencia: mesDe(referencia) };
  }
  // Catálogo -> "Bases no sistema: SINAPI 2026-10 (atualizada em 16/11/2026) · SICRO AM 07/2026 · ...".
  const SO_CATALOGO = { ORSE: 'só o mês: preço digitado', 'SEINFRA-CE': 'só a versão: preço digitado' };
  function textoBases(versoes, uf) {
    const porBase = new Map();
    for (const v of versoes || []) {
      if (v.base === 'SICRO' && uf && v.abrangencia !== uf) continue;
      const atual = porBase.get(v.base);
      if (v.situacao !== 'zerada' && (!atual || v.data_base > atual.data_base)) porBase.set(v.base, v);
    }
    if (!porBase.size) return '';
    const dia = (t) => (t ? new Date(t).toLocaleDateString('pt-BR', { timeZone: 'America/Manaus' }) : '');
    return `Bases no sistema: ${[...porBase.values()].map((v) => `${v.base}${v.abrangencia !== 'BR' ? ` ${v.abrangencia}` : ''} ${v.versao}`
      + (v.situacao === 'catalogo' ? ` (${SO_CATALOGO[v.base] || 'só o catálogo'})` : ` (atualizada em ${dia(v.coletado_em)})`)).join(' · ')}.`;
  }

  // ---- Rascunho no navegador (fase 1: recarregar perdia o trabalho) ----
  const CHAVE_RASCUNHO = 'licitaplena_orcamento_obra_rascunho';
  const VERSAO_RASCUNHO = 1;
  // Só o necessário para voltar ao ponto: a aba lida (a única que o "Baixar no formato do edital" usa), CPU,
  // cronograma, preços digitados, cotações, os campos e se já tinha sido montado (ao abrir, as contas são refeitas).
  function montarRascunho(estado, campos, agora = new Date()) {
    return JSON.stringify({ versao: VERSAO_RASCUNHO, salvoEm: agora.toISOString(), nomeArquivo: estado.nomeArquivo, abas: (estado.abas || []).filter((a) => a.nome === estado.leitura?.aba),
      leitura: estado.leitura, cpu: estado.cpu, crono: estado.crono, manuais: estado.manuais, cotacoes: estado.cotacoes, montado: Boolean(estado.montado), campos });
  }
  function lerRascunho(texto) {
    try {
      const r = JSON.parse(texto);
      return r && r.versao === VERSAO_RASCUNHO && r.leitura && Array.isArray(r.abas) && r.campos && typeof r.campos === 'object' ? r : null;
    } catch { return null; }
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { baseDoSupabase, lerCotacoes, numero, palavrasBusca, escolherReferencia, baseDoHistorico, textoBases, montarRascunho, lerRascunho }; return; }

  const O = window.OrcObra, BDI = window.BdiCalculadora;
  // Só mensagem escrita por nós chega à tela; erro técnico (de rede, de biblioteca) vira texto simples.
  const erroSimples = (texto) => Object.assign(new Error(texto), { simples: true });
  const mensagemSimples = (e, padrao) => (e?.simples ? e.message : padrao);
  const $ = (id) => document.getElementById(id);
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // eslint-disable-line no-undef -- globais de supabase-config.js
  O.sb = sb; // a aba "Analisar concorrente" (orcamento-obra-concorrente-ui.js) usa a mesma sessão para chamar a IA
  const estado = { abas: null, leitura: null, cpu: null, crono: null, orc: null, manuais: {}, cotacoes: {}, sinapi: null, nomeArquivo: '', lances: null, similares: {}, versoes: [], referencia: null };
  function aviso(texto, tipo) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? `aviso ${tipo || 'info'}` : 'aviso'; }

  async function autenticar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('login.html?voltar=/orcamento-obra'); return null; }
    const { data: cliente } = await sb.from('clientes').select('status').eq('id', session.user.id).maybeSingle();
    if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/orcamento-obra'); return null; }
    const versoes = carregarVersoes();
    void oferecerAjuda(session.user.id);
    oferecerRascunho(versoes);
    return cliente;
  }

  // ---- Bases e data-base ----
  async function carregarVersoes() {
    const { data, error } = await sb.from('bases_preco_versoes').select('id,base,abrangencia,data_base,versao,situacao,coletado_em').order('data_base', { ascending: false }).limit(500);
    estado.versoes = error ? [] : data || []; // sem a tabela (SQL ainda não aplicado): segue sem histórico, como na fase 1
    mostrarBases();
  }
  const versoesSinapi = () => estado.versoes.filter((v) => v.base === 'SINAPI' && v.abrangencia === 'BR');
  function mostrarBases() {
    $('m-bases').textContent = textoBases(estado.versoes, $('l-uf').value);
    const r = escolherReferencia($('l-data').value, versoesSinapi());
    $('l-base').textContent = r.aviso || (r.maisNova ? `SINAPI ${r.maisNova}: o mais novo no sistema.` : '');
    $('l-base').className = r.nivel === 'erro' ? 'nota alerta-base' : 'nota';
  }

  // ---- O que costuma acontecer (estudo de quem ganha e quem perde) ----
  async function mostrarEstudo() {
    const E = O.estudo, c = estado.leitura?.cabecalho || {}, global = estado.leitura?.resumo?.global;
    const tipo = E.tipoDeObra(c.objeto), faixa = global > 0 ? E.faixaDeValor(global) : null, uf = $('l-uf').value;
    const { data, error } = await sb.from('orcamento_estudo_estatisticas').select('recorte,n,dados').in('recorte', E.recortesCandidatos(uf, tipo, faixa));
    const r = error ? null : E.fraseDoEstudo(Object.fromEntries((data || []).map((x) => [x.recorte, x])), uf, tipo, faixa);
    $('m-estudo').hidden = !r;
    if (r) $('m-estudo-frase').textContent = `${r.frase} O motivo de cada queda não vem no dado aberto do Compras.gov.`;
  }

  // ---- "Ajudar a melhorar o Auditor" (desligado até o dono ligar; ver docs/orcamento-obra/privacidade-motivos-recusa.md) ----
  const VERSAO_TEXTO_AJUDA = '2026-11-22';
  async function oferecerAjuda(usuario) {
    const { data: cfg, error } = await sb.from('orcamento_motivos_config').select('ligado').maybeSingle();
    if (error || !cfg?.ligado) return; // desligado: a opção nem aparece
    const { data: aceite } = await sb.from('orcamento_motivos_consentimento').select('usuario_id').eq('usuario_id', usuario).maybeSingle();
    $('m-ajudar').hidden = false;
    $('m-ajudar-sim').checked = Boolean(aceite);
    $('m-ajudar-sim').addEventListener('change', async (ev) => {
      const r = ev.target.checked
        ? await sb.from('orcamento_motivos_consentimento').insert({ versao_texto: VERSAO_TEXTO_AJUDA })
        : await sb.from('orcamento_motivos_consentimento').delete().eq('usuario_id', usuario);
      if (r.error) { ev.target.checked = !ev.target.checked; aviso('Não foi possível salvar a sua escolha agora. Tente de novo.', 'erro'); }
    });
  }

  // ---- Rascunho (fica só neste navegador) ----
  const CAMPOS = ['l-uf', 'l-data', 'l-regime', 'b-tipo', 'b-ac', 'b-s', 'b-g', 'b-r', 'b-df', 'b-l', 'b-iss', 'b-pis', 'b-cofins', 'b-cprb', 'm-desconto', 'm-lance', 'm-modo', 'm-meses', 'm-lei', 'm-simples'];
  // Devolve false quando não coube no navegador: quem chama avisa, em vez de perder calado (23/11: o dono recarregou e sumiu tudo).
  function salvarRascunho() {
    if (!estado.leitura) return true;
    const campos = Object.fromEntries(CAMPOS.map((id) => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value]));
    try { window.localStorage.setItem(CHAVE_RASCUNHO, montarRascunho(estado, campos)); return true; } catch {
      try { window.localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* nada a apagar */ } // rascunho velho não volta no lugar do novo
      aviso('Esta planilha é grande demais para ficar guardada neste navegador. Se recarregar ou fechar a página, vai precisar enviar a planilha de novo. Baixe as planilhas antes de sair.', 'erro');
      return false;
    }
  }
  // Ao abrir a página, o trabalho volta sozinho (sem clique) e, se já tinha sido montado, as contas são refeitas.
  function oferecerRascunho(versoes) {
    let r = null;
    try { r = lerRascunho(window.localStorage.getItem(CHAVE_RASCUNHO)); } catch { r = null; }
    if (!r) return;
    Object.assign(estado, { abas: r.abas, leitura: r.leitura, cpu: r.cpu, crono: r.crono, manuais: r.manuais || {}, cotacoes: r.cotacoes || {}, nomeArquivo: r.nomeArquivo, orc: null, similares: {}, montado: r.montado === true });
    mostrarLeitura();
    for (const id of CAMPOS) if (id in r.campos) { if ($(id).type === 'checkbox') $(id).checked = r.campos[id] === true; else $(id).value = String(r.campos[id] ?? ''); }
    mostrarBases();
    $('rascunho').hidden = false;
    $('rascunho-texto').textContent = `Orçamento em andamento recuperado: ${r.nomeArquivo || 'planilha'}, salvo neste navegador em ${new Date(r.salvoEm).toLocaleString('pt-BR')}.`;
    $('btn-rascunho-apagar').onclick = () => { try { window.localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* nada a apagar */ } location.reload(); };
    if (!r.montado) return;
    // Espera as versões do SINAPI (data-base antiga usa o histórico). Aba "Analisar concorrente" aberta (#concorrente):
    // não mexe no aviso dela; refaz quando a pessoa voltar para cá.
    const refazer = () => void Promise.resolve(versoes).catch(() => null).then(() => montar());
    if (document.querySelector('main').classList.contains('modo-concorrente')) $('aba-orcamento').addEventListener('click', refazer, { once: true });
    else refazer();
  }

  // ---- 1. Ler o arquivo (SheetJS) ----
  const LIMITE_ARQUIVO = 15 * 1024 * 1024;
  function lerArquivo(arquivo) {
    return new Promise((ok, falha) => {
      if (!arquivo) return falha(erroSimples('Escolha o arquivo.'));
      if (!/\.(xlsx|xlsm|xls|ods)$/i.test(arquivo.name)) return falha(erroSimples('Envie a planilha em Excel (.xlsx). PDF ainda não é lido.'));
      if (arquivo.size > LIMITE_ARQUIVO) return falha(erroSimples('Arquivo maior que 15 MB.'));
      if (!window.XLSX) return falha(erroSimples('O leitor de Excel não carregou. Recarregue a página.'));
      const r = new FileReader();
      r.onload = () => {
        try {
          const wb = window.XLSX.read(r.result, { type: 'array' });
          ok(wb.SheetNames.map((nome) => ({ nome, linhas: window.XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' }) })));
        } catch { falha(erroSimples('Não consegui abrir este arquivo. Salve de novo como .xlsx no Excel.')); }
      };
      r.onerror = () => falha(erroSimples('Não consegui ler o arquivo.'));
      r.readAsArrayBuffer(arquivo);
    });
  }

  async function enviar(ev) {
    ev.preventDefault();
    try {
      aviso('Lendo a planilha…');
      const abas = await lerArquivo($('f-edital').files[0]);
      const leitura = O.leitor.lerPasta(abas);
      if (leitura.erro) { aviso(leitura.erro, 'erro'); return; }
      const cpuArq = $('f-cpu').files[0];
      estado.cpu = cpuArq ? O.leitor.lerCpu((await lerArquivo(cpuArq)).flatMap((a) => a.linhas)) : null;
      const abaCrono = abas.find((a) => /cronog/i.test(a.nome));
      Object.assign(estado, { abas, leitura, crono: abaCrono ? O.leitor.lerCronograma(abaCrono.linhas) : null, orc: null, montado: false, manuais: {}, cotacoes: {}, similares: {}, nomeArquivo: $('f-edital').files[0].name.replace(/\.[^.]+$/, '') });
      mostrarLeitura();
      $('rascunho').hidden = true;
      if (salvarRascunho()) aviso('');
    } catch (e) { aviso(mensagemSimples(e, 'Não foi possível ler a planilha. Confira o arquivo e tente de novo.'), 'erro'); }
  }

  // ---- 2. O que o Leitor entendeu ----
  function mostrarLeitura() {
    const r = estado.leitura, c = r.cabecalho, s = r.itens.filter((i) => i.tipo === 'servico');
    $('passo-leitura').hidden = false; $('passo-montar').hidden = false;
    $('l-uf').value = c.uf || 'AM';
    $('l-data').value = c.dataBase || '';
    $('l-regime').value = c.desonerado === true ? 'sim' : 'nao'; // sem informação: confira (o Leitor avisa)
    $('l-resumo').innerHTML = `Aba <b>${esc(r.aba)}</b> · ${s.length} serviços em ${r.itens.length - s.length} etapas · ${r.emBranco ? '<b>planilha em branco</b> (preços a preencher)' : 'com preços de referência'}`
      + `${r.resumo.global ? ` · orçamento do edital ${esc(reais(r.resumo.global))}` : ''}${r.resumo.bdi ? ` · BDI do edital ${esc(pct(r.resumo.bdi))}` : ''}`
      + `${estado.cpu ? ` · CPU do edital: ${Object.values(estado.cpu.bases).reduce((a, b) => a + Object.keys(b.composicoes).length, 0)} composições` : ''}`
      + `${estado.crono ? ` · cronograma de ${estado.crono.meses} períodos` : ''}`;
    $('l-fontes').innerHTML = Object.entries(r.fontes).map(([f, n]) => `<span class="chip">${esc(f === 'PROPRIA' ? 'Composição própria' : f)}: ${n}</span>`).join('');
    $('l-avisos').innerHTML = r.avisos.map((a) => `<li>${esc(a)}</li>`).join('');
    $('l-corpo').innerHTML = r.itens.map((i) => (i.tipo === 'etapa'
      ? `<tr class="etapa"><td data-rotulo="Item"><b>${esc(i.item)}</b></td><td data-rotulo="Descrição" colspan="6"><b>${esc(i.descricao)}</b></td></tr>`
      : `<tr><td data-rotulo="Item">${esc(i.item)}</td><td data-rotulo="Código">${esc(i.codigo)}</td><td data-rotulo="Fonte">${esc(i.fonte === 'PROPRIA' ? 'Composição própria' : i.fonte)}</td><td data-rotulo="Descrição" class="item">${esc(i.descricao)}</td>`
        + `<td data-rotulo="Unid.">${esc(i.unidade)}</td><td data-rotulo="Quant.">${esc(i.quantidade ?? '—')}</td><td data-rotulo="Preço do edital">${esc(i.precoUnitario ? reais(i.precoUnitario) : '—')}</td></tr>`)).join('');
    $('m-meses').value = estado.crono?.meses || 6;
    $('m-lei').value = c.lei === '13303' ? '13303' : '14133';
    // Planilha mais SICRO que SINAPI: começa arredondando (NBR 5891); o edital manda e a pessoa pode trocar.
    $('m-modo').value = (r.fontes.SICRO || 0) > (r.fontes.SINAPI || 0) ? 'arredondar' : 'truncar';
    preencherBdi();
    mostrarBases();
    void mostrarEstudo();
  }

  // ---- 3. Montar ----
  function preencherBdi() {
    const tipo = $('b-tipo').value || 'edificios', t = BDI.TIPOS[tipo], f = (c) => BDI.fmtPct(c).replace('%', '');
    const ano = Number(String($('l-data').value).slice(0, 4)) || new Date().getFullYear();
    const cprb = $('l-regime').value === 'sim' ? O.calculo.cprbConstrucao(ano) * 10000 : 0;
    const v = { 'b-ac': f(t.ac[1]), 'b-s': f(t.sg[1]), 'b-g': '0,00', 'b-r': f(t.r[1]), 'b-df': f(t.df[1]), 'b-l': f(t.l[1]), 'b-iss': '', 'b-pis': '0,65', 'b-cofins': '3,00', 'b-cprb': f(Math.round(cprb)) };
    for (const [id, x] of Object.entries(v)) $(id).value = x;
  }
  function lerBdi() {
    // ISS vazio virava 0% (BDI baixo e alerta de desclassificação): a alíquota é do município, só a pessoa sabe.
    if (!$('b-iss').value.trim()) { $('b-iss').focus(); throw erroSimples('Preencha o ISS %: a alíquota da lei do município da obra, entre 2% e 5% (o edital costuma trazer na planilha do BDI).'); }
    const e = { tipo: $('b-tipo').value, issBase: 10000 }, mapa = { ac: 'b-ac', s: 'b-s', g: 'b-g', r: 'b-r', df: 'b-df', l: 'b-l', issAliquota: 'b-iss', pis: 'b-pis', cofins: 'b-cofins', cprb: 'b-cprb' };
    for (const [k, id] of Object.entries(mapa)) {
      const v = BDI.lerPct($(id).value || '0');
      if (v === null) throw erroSimples('BDI: use só números, com vírgula (ex.: 4,50).');
      e[k] = v;
    }
    return e;
  }

  // PostgREST: lista longa vai em lotes (URL curta e menos de 1000 linhas por resposta).
  async function emLotes(lista, tamanho, consulta) {
    let out = [];
    for (let i = 0; i < lista.length; i += tamanho) {
      const { data, error } = await consulta(lista.slice(i, i + tamanho));
      if (error) throw erroSimples('Não foi possível consultar o SINAPI agora. Tente de novo.');
      out = out.concat(data || []);
    }
    return out;
  }
  // Data-base antiga guardada no histórico: só os códigos da planilha, pela função do banco (a RLS vale).
  async function buscarHistorico(versao, uf, desonerado, cods) {
    const rpc = async (grupo, chaves) => {
      const { data, error } = await sb.rpc('bases_preco_buscar', { p_versao: versao.id, p_grupo: grupo, p_chaves: chaves });
      if (error) throw erroSimples('Não foi possível consultar o histórico do SINAPI agora. Tente de novo.');
      return data || {};
    };
    const chaves = (cs) => cs.flatMap((c) => [`composicao|${c}`, `insumo|${c}`]);
    const analitico = await rpc('analitico', cods);
    const todos = [...new Set(cods.concat(Object.values(analitico).flat().map((x) => String(x[1]))))];
    const precos = await rpc(`precos:${uf}`, chaves(todos));
    const descricoes = await rpc('itens', chaves(todos));
    return baseDoHistorico(precos, analitico, descricoes, desonerado, uf, versao.data_base);
  }
  async function buscarSinapi(uf, desonerado, referencia) {
    const cods = [...new Set(estado.leitura.itens.filter((i) => i.fonte === 'SINAPI').map((i) => i.codigo).filter((c) => /^\d{1,10}$/.test(c)))];
    if (!cods.length) return null;
    if (referencia?.versao) return buscarHistorico(referencia.versao, uf, desonerado, cods);
    const campos = 'tipo,codigo,preco_sd,preco_cd,referencia';
    const custos = await emLotes(cods, 150, (l) => sb.from('sinapi_custos').select(campos).eq('uf', uf).in('codigo', l));
    const itens = await emLotes(cods, 40, (l) => sb.from('sinapi_composicao_itens').select('composicao,item_tipo,item_codigo,descricao,unidade,coeficiente').in('composicao', l));
    const aux = [...new Set(itens.map((i) => i.item_codigo))].filter((c) => !cods.includes(c));
    const custosAux = await emLotes(aux, 150, (l) => sb.from('sinapi_custos').select(campos).eq('uf', uf).in('codigo', l));
    return baseDoSupabase(custos.concat(custosAux), itens, desonerado, uf);
  }

  async function montar() {
    try {
      $('btn-montar').disabled = true;
      aviso('Montando: buscando o SINAPI e fazendo as contas…');
      const uf = $('l-uf').value, desonerado = $('l-regime').value === 'sim';
      const dataBase = $('l-data').value || null, ano = Number(String(dataBase || '').slice(0, 4)) || new Date().getFullYear();
      const leitura = { ...estado.leitura, cabecalho: { ...estado.leitura.cabecalho, uf, dataBase, desonerado } };
      estado.referencia = escolherReferencia(dataBase, versoesSinapi());
      estado.sinapi = await buscarSinapi(uf, desonerado, estado.referencia);
      const bases = { ...(estado.cpu?.bases || {}) };
      if (estado.sinapi) bases.SINAPI = estado.cpu?.bases?.SINAPI ? { ...estado.sinapi, precos: { ...estado.sinapi.precos, ...estado.cpu.bases.SINAPI.precos }, composicoes: { ...estado.sinapi.composicoes, ...estado.cpu.bases.SINAPI.composicoes } } : estado.sinapi;
      const desconto = numero($('m-desconto').value);
      const meses = Math.min(Math.max(Math.round(numero($('m-meses').value) || 1), 1), 60);
      const op = {
        bases, manuais: estado.manuais, cotacoes: estado.cotacoes, similares: estado.similares, bdi: lerBdi(), desconto: desconto ? { linear: desconto / 100 } : {},
        modo: $('m-modo').value, meses, cronogramaEdital: estado.crono && estado.crono.meses === meses ? estado.crono : null,
        regime: { desonerado, ano, simples: $('m-simples').checked }, lei: $('m-lei').value, dataBaseBanco: estado.sinapi?.referencia || undefined,
      };
      // Valor do lance informado: acha o desconto linear que deixa a planilha igual ou abaixo do lance.
      const lance = numero($('m-lance').value);
      if (lance > 0) {
        estado.orc = O.montador.ajustarAoLance(leitura, op, lance);
        if (!estado.orc) throw erroSimples('Não dá para chegar nesse lance.');
        $('m-desconto').value = String(Math.round(estado.orc.desconto.linear * 10000) / 100).replace('.', ',');
      } else estado.orc = O.montador.montarOrcamento(leitura, op);
      estado.lances = estado.orc.globalReferencia ? O.montador.tabelaDeLances(leitura, op) : null;
      mostrarResultado();
      estado.montado = true;
      if (salvarRascunho()) aviso('');
    } catch (e) { aviso(mensagemSimples(e, 'Não foi possível montar o orçamento. Confira a planilha e tente de novo.'), 'erro'); } finally { $('btn-montar').disabled = false; }
  }

  // Itens sem preço (ou com preço digitado/cotado): preço da tabela da fonte ou 3 cotações.
  function editorPendentes(s) {
    const pend = s.filter((l) => ['sem_referencia', 'manual', 'cotacao'].includes(l.origem));
    $('passo-pendentes').hidden = !pend.length;
    $('p-corpo').innerHTML = pend.map((l) => {
      const m = estado.manuais[l.item] || {}, c = estado.cotacoes[l.item] || [];
      const cot = [0, 1, 2].map((i) => `<div class="cot"><input data-cot-f="${esc(l.item)}" data-i="${i}" maxlength="120" placeholder="Fornecedor ${i + 1}" value="${esc(c[i]?.fornecedor || '')}" aria-label="Fornecedor ${i + 1} do item ${esc(l.item)}">`
        + `<input data-cot-v="${esc(l.item)}" data-i="${i}" inputmode="decimal" placeholder="R$" value="${esc(c[i]?.valor ?? '')}" aria-label="Valor ${i + 1} do item ${esc(l.item)}"></div>`).join('');
      return `<tr><td data-rotulo="Item"><b>${esc(l.item)}</b><small>${esc(l.fonte)} ${esc(l.codigo)}</small></td><td data-rotulo="Descrição" class="item">${esc(l.descricao)}<small>${esc(l.baseUsada || '')}</small><div class="parecidos" data-parecidos="${esc(l.item)}"></div></td>`
        + `<td data-rotulo="Preço da tabela ${esc(l.fonte)}"><input data-man-p="${esc(l.item)}" inputmode="decimal" placeholder="R$ sem BDI" value="${esc(m.preco ?? '')}" aria-label="Preço da tabela do item ${esc(l.item)}"><input data-man-d="${esc(l.item)}" maxlength="20" placeholder="Mês (ex.: 09/2026)" value="${esc(m.dataBase || '')}" aria-label="Mês de referência do item ${esc(l.item)}">`
        + `<label class="marca-cpu"><input type="checkbox" data-man-cpu="${esc(l.item)}"${m.cpuAnexada ? ' checked' : ''}>Vou anexar a CPU da tabela</label></td>`
        + `<td data-rotulo="Ou 3 cotações">${cot}</td></tr>`;
    }).join('');
    void sugerirParecidos(pend.slice(0, 30));
  }

  // Antes de cotar, procura no SINAPI da UF um serviço parecido (sem acento, palavras fora de ordem) e mostra até 3.
  // O primeiro vira a comparação do Auditor (composição própria muito longe dele é suspeita).
  async function sugerirParecidos(pend) {
    const uf = $('l-uf').value, col = $('l-regime').value === 'sim' ? 'preco_cd' : 'preco_sd';
    for (const l of pend) {
      const alvo = document.querySelector(`[data-parecidos="${CSS.escape(l.item)}"]`);
      if (!alvo) continue;
      alvo.textContent = 'Procurando parecido no SINAPI…';
      let achados = [];
      for (const n of [4, 2]) {
        const palavras = palavrasBusca(l.descricao, n);
        if (!palavras.length) break;
        let q = sb.from('sinapi_itens').select(`codigo,descricao,unidade,sinapi_custos!inner(uf,${col},referencia)`).eq('tipo', 'composicao').eq('sinapi_custos.uf', uf).not(`sinapi_custos.${col}`, 'is', null);
        for (const p of palavras) q = q.ilike('busca', `%${p}%`);
        const { data, error } = await q.limit(3);
        if (error) break;
        achados = (data || []).map((d) => ({ codigo: d.codigo, descricao: d.descricao, unidade: d.unidade, preco: Number(d.sinapi_custos[0][col]), referencia: String(d.sinapi_custos[0].referencia || '').slice(0, 7) }));
        if (achados.length) break;
      }
      if (achados.length) estado.similares[l.item] = achados[0]; else delete estado.similares[l.item];
      alvo.innerHTML = achados.length ? `<b>Parecidos no SINAPI ${esc(uf)}:</b>${achados.map((a, i) => `<span class="parecido">${esc(a.codigo)} · ${esc(a.descricao.slice(0, 90))} · ${esc(a.unidade || '')} · ${esc(reais(a.preco))}`
        + ` <button type="button" class="btn mini" data-usar-parecido="${esc(l.item)}" data-i="${i}">Usar este</button></span>`).join('')}` : '<small>Nenhum serviço parecido no SINAPI: siga com a tabela da fonte ou 3 cotações.</small>';
      alvo.achados = achados;
    }
  }
  function guardarPendentes() {
    document.querySelectorAll('[data-man-p]').forEach((el) => {
      const item = el.dataset.manP, preco = numero(el.value), data = document.querySelector(`[data-man-d="${CSS.escape(item)}"]`).value.trim().slice(0, 20);
      const linha = estado.orc.linhas.find((l) => l.item === item);
      const cpuAnexada = document.querySelector(`[data-man-cpu="${CSS.escape(item)}"]`)?.checked === true;
      // Preço trazido de um parecido do SINAPI (botão "Usar este"): a fonte passa a ser o SINAPI, com o código dele.
      const fonte = el.dataset.manFonte || linha?.fonte, codigo = el.dataset.manCodigo || linha?.codigo;
      if (preco > 0) estado.manuais[item] = { preco, fonte, codigo, dataBase: data || undefined, cpuAnexada };
      else delete estado.manuais[item];
    });
    const porItem = {};
    document.querySelectorAll('[data-cot-v]').forEach((el) => {
      const item = el.dataset.cotV, i = Number(el.dataset.i);
      (porItem[item] ||= [])[i] = { fornecedor: document.querySelector(`[data-cot-f="${CSS.escape(item)}"][data-i="${i}"]`).value, valor: el.value };
    });
    for (const [item, campos] of Object.entries(porItem)) {
      const c = lerCotacoes(campos.filter(Boolean));
      if (c.length) estado.cotacoes[item] = c; else delete estado.cotacoes[item];
    }
  }

  const ORIGEM = { edital: 'Edital', base: 'Tabela', cpu: 'CPU', manual: 'Digitado', cotacao: 'Cotações', sem_referencia: 'SEM PREÇO' };
  const NIVEL = { erro: 'Pode desclassificar', atencao: 'Atenção', info: 'Para saber' };
  function mostrarResultado() {
    const o = estado.orc, s = o.linhas.filter((l) => l.tipo === 'servico');
    const cont = s.reduce((a, l) => ({ ...a, [l.origem]: (a[l.origem] || 0) + 1 }), {});
    // Tabela SINAPI da UF vazia no banco (robô da CAIXA bloqueado, por exemplo): dizer, em vez de só "CPU incompleta".
    const semSinapi = estado.sinapi && !Object.keys(estado.sinapi.precos).length
      ? `A tabela SINAPI de ${estado.sinapi.uf} ainda não foi carregada no sistema: ${cont.edital ? 'usamos o preço do edital nos itens' : 'os itens SINAPI ficaram sem preço'}. Confira com a CPU do edital.` : '';
    $('passo-resultado').hidden = false; $('passo-alertas').hidden = false; $('passo-baixar').hidden = false;
    $('r-totais').innerHTML = `${o.bdiNoUnitario ? 'Total da proposta (com BDI)' : `Custo direto <b>${esc(reais(o.total))}</b> · BDI ${esc(pct(o.bdi))} ·`} <b>Preço global ${esc(reais(o.globalProposta))}</b>`
      + `${o.globalReferencia ? ` · orçamento do edital ${esc(reais(o.globalReferencia))} (${esc(pct(o.globalProposta / o.globalReferencia))})` : ''}`
      + `<br>Preço de cada item: ${Object.entries(cont).map(([k, n]) => `${esc(ORIGEM[k])} ${n}`).join(' · ')}${estado.sinapi && !semSinapi ? ` · SINAPI ${esc(estado.sinapi.uf)} ${esc(estado.sinapi.referencia)} ${estado.sinapi.desonerado ? 'desonerado' : 'não desonerado'}` : ''}`;
    $('r-referencia').textContent = [semSinapi, estado.referencia?.aviso].filter(Boolean).join(' ');
    $('r-referencia').className = semSinapi || estado.referencia?.aviso ? `aviso ${semSinapi || estado.referencia.nivel === 'erro' ? 'erro' : 'info'}` : 'aviso';
    if (o.lance) $('r-totais').innerHTML += `<br>Ajustado ao lance de ${esc(reais(o.lance))}: desconto linear de ${esc(pct(o.desconto.linear))} em cada preço, sobra ${esc(reais(o.sobra))} por causa dos centavos.`;
    $('r-lances').hidden = !estado.lances;
    $('r-lances-corpo').innerHTML = (estado.lances || []).map((x) => `<tr><td data-rotulo="Desconto">${esc(pct(x.desconto))}</td><td data-rotulo="Preço global">${esc(reais(x.global))}</td>`
      + `<td data-rotulo="% do orçado">${esc(x.pctReferencia === null ? '—' : pct(x.pctReferencia))}</td><td data-rotulo="Riscos">${x.riscos.length ? esc(x.riscos.join(' · ')) : 'Nenhum'}</td></tr>`).join('');
    $('r-corpo').innerHTML = s.map((l) => `<tr${l.origem === 'sem_referencia' ? ' class="falta"' : ''}><td data-rotulo="Item">${esc(l.item)}</td><td data-rotulo="Descrição" class="item">${esc(l.descricao)}<small>Base: ${esc(l.baseUsada || ORIGEM[l.origem])}</small></td>`
      + `<td data-rotulo="Quant.">${esc(l.quantidade ?? '—')} ${esc(l.unidade)}</td><td data-rotulo="Referência">${esc(reais(l.referencia))}</td><td data-rotulo="Proposta">${esc(reais(l.unitario))}</td><td data-rotulo="Total">${esc(reais(l.total))}</td></tr>`).join('');
    editorPendentes(s);
    const r = o.resumoAlertas;
    $('a-resumo').innerHTML = r.pronto ? `<b>Nenhum alerta que desclassifica.</b> ${r.atencao} de atenção e ${r.info} para saber. Agora é com o engenheiro ou arquiteto responsável.`
      : `<b>${r.erro} alerta(s) que podem desclassificar</b>, ${r.atencao} de atenção e ${r.info} para saber.`;
    $('a-lista').innerHTML = o.alertas.slice(0, 300).map((a) => `<li class="alerta ${a.nivel}"><span class="chip ${a.nivel}">${esc(NIVEL[a.nivel])}</span> <b>${esc(a.titulo)}</b>${a.item ? ` · item ${esc(a.item)}` : ''}<br>${esc(a.texto)}`
      + `<small>${esc(a.fonte)}${a.link && /^https:/.test(a.link) ? ` · <a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">ver a fonte</a>` : ''}</small></li>`).join('')
      + (o.alertas.length > 300 ? `<li>… e mais ${o.alertas.length - 300} na aba "Alertas do Auditor" da planilha.</li>` : '');
  }

  // ---- 5. Baixar ----
  function baixarXlsx(abas, nome) {
    const wb = window.XLSX.utils.book_new();
    abas.forEach((a, i) => window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(a.linhas), String(a.nome || `Aba ${i + 1}`).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)));
    window.XLSX.writeFile(wb, nome);
  }

  $('form-edital').addEventListener('submit', enviar);
  $('btn-montar').addEventListener('click', () => void montar());
  $('btn-remontar').addEventListener('click', () => { guardarPendentes(); salvarRascunho(); void montar(); });
  $('p-corpo').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-usar-parecido]'); if (!b) return;
    const item = b.dataset.usarParecido, a = document.querySelector(`[data-parecidos="${CSS.escape(item)}"]`)?.achados?.[Number(b.dataset.i)];
    const campo = document.querySelector(`[data-man-p="${CSS.escape(item)}"]`);
    if (!a || !campo) return;
    campo.value = String(a.preco).replace('.', ','); campo.dataset.manFonte = 'SINAPI'; campo.dataset.manCodigo = a.codigo;
    document.querySelector(`[data-man-d="${CSS.escape(item)}"]`).value = a.referencia;
    aviso(`Item ${item}: preço do SINAPI ${a.codigo} posto no campo. Clique em "Usar estes preços e montar de novo".`, 'info');
  });
  $('b-tipo').innerHTML = Object.entries(BDI.TIPOS).map(([k, t]) => `<option value="${k}">${esc(t.nome)}</option>`).join('');
  $('b-tipo').addEventListener('change', preencherBdi);
  $('l-regime').addEventListener('change', preencherBdi);
  $('l-uf').addEventListener('change', () => { mostrarBases(); if (estado.leitura) void mostrarEstudo(); });
  $('l-data').addEventListener('change', mostrarBases);
  // Campo mudado (UF, BDI, ISS, preço digitado, cotação) já fica guardado (depois do preencherBdi, que troca o BDI ao mudar tipo/regime): recarregar antes de montar não perde nada.
  for (const id of CAMPOS) $(id).addEventListener('change', () => salvarRascunho());
  $('p-corpo').addEventListener('change', () => { if (estado.orc) { guardarPendentes(); salvarRascunho(); } });
  $('btn-baixar-completa').addEventListener('click', () => estado.orc && baixarXlsx(O.montador.montarAbas(estado.orc), `orcamento-${estado.nomeArquivo || 'obra'}.xlsx`));
  $('btn-baixar-edital').addEventListener('click', () => {
    if (!estado.orc) return;
    const aba = estado.abas.find((a) => a.nome === estado.leitura.aba);
    baixarXlsx([{ nome: aba.nome, linhas: O.montador.formatoEdital(aba.linhas, estado.orc) }], `${estado.nomeArquivo || 'edital'}-preenchido.xlsx`);
  });
  $('btn-tema').addEventListener('click', () => {
    const claro = document.documentElement.classList.toggle('tema-claro');
    document.documentElement.dataset.theme = claro ? 'light' : 'dark';
    try { window.localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
  });
  autenticar().catch(() => aviso('Não foi possível validar a sessão. Recarregue a página.', 'erro'));
})();
