/* global module */
// Ficha do órgão (CRM fase 2, 24/11/2026): regras sem rede da tela orgao.html e do link "Ver ficha do órgão" do Funil e
// dos Processos. O órgão é identificado pelo CNPJ (o número de controle do PNCP começa por ele: CNPJ-1-000012/2026);
// sem CNPJ (processo cadastrado à mão), pelo nome normalizado. A mesma chave é a orgao_chave de
// operacao_orgaos_registros (supabase/crm_orgao_linha_tempo.sql), que repete o formato num CHECK.
(function (raiz) {
  'use strict';
  const CNPJ = /^\d{14}$/;
  // Mesmo padrão do banco: número com cara de CPF não é guardado (pregoes_gravados.sql / funil_v3.sql).
  const CPF = /(^|[^0-9])[0-9]{3}[. ]?[0-9]{3}[. ]?[0-9]{3}[- /]?[0-9]{2}($|[^0-9])/;
  const TELEFONE = /^[0-9 ()+.-]{8,20}$/;
  // No telefone, 11 dígitos seguidos são celular com DDD: só o formato de CPF (123.456.789-09) é recusado.
  const CPF_TELEFONE = /[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}/;
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const digitos = (v) => String(v || '').replace(/\D/g, '');
  function cnpjDeControle(controle) {
    const m = /^(\d{14})-\d+-/.exec(String(controle || ''));
    return m ? m[1] : null;
  }
  function normalizarNome(nome) {
    return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9 .,/()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220).trim();
  }
  function chaveOrgao({ cnpj, nome } = {}) {
    const c = digitos(cnpj);
    if (CNPJ.test(c)) return `cnpj:${c}`;
    const n = normalizarNome(nome);
    return /^[a-z0-9]/.test(n) && n.length >= 3 ? `nome:${n}` : null;
  }
  // Link da ficha a partir do que cada tela tem: CNPJ, número de controle do PNCP ou só o nome.
  function linkFicha({ cnpj, controle, nome } = {}) {
    const c = CNPJ.test(digitos(cnpj)) ? digitos(cnpj) : cnpjDeControle(controle);
    const p = new URLSearchParams();
    if (c) p.set('cnpj', c);
    if (String(nome || '').trim()) p.set('nome', String(nome).trim().slice(0, 300));
    return p.toString() ? `orgao.html?${p}` : null;
  }
  // Link pronto (HTML) para as telas que mostram o nome do órgão: azul de link + ícone "abrir". Sem dado, string vazia.
  // A última palavra vai junto com o ícone (nowrap): sem isso, o ícone quebrava sozinho para a linha de baixo.
  const partirFim = (texto) => { const t = String(texto), i = t.lastIndexOf(' ') + 1; return [t.slice(0, i), t.slice(i)]; };
  const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function linkFichaHtml(dados, { texto = 'Ver ficha do órgão', classe = '' } = {}) {
    const href = linkFicha(dados);
    if (!href) return '';
    return `<a class="link-ficha-orgao${classe ? ' ' + classe : ''}" href="${escHtml(href)}" title="Ver ficha do órgão">${escHtml(partirFim(texto)[0])}<span class="link-ficha-fim">${escHtml(partirFim(texto)[1])}<svg class="icone-ph" aria-hidden="true"><use href="menu-icones.svg#ph-arrow-square-out"></use></svg></span></a>`;
  }
  // O mesmo link como elemento, para as telas montadas com createElement (Pesquisa de Preços, Meu dia, Licitação anterior).
  function linkFichaElemento(doc, dados, texto = 'Ver ficha do órgão', classe = '') {
    const href = linkFicha(dados);
    if (!href) return null;
    const a = doc.createElement('a');
    a.className = 'link-ficha-orgao' + (classe ? ' ' + classe : '');
    a.href = href;
    a.title = 'Ver ficha do órgão';
    const [inicio, fim] = partirFim(texto), span = doc.createElement('span');
    span.className = 'link-ficha-fim';
    span.textContent = fim;
    a.textContent = inicio;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'), uso = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
    svg.setAttribute('class', 'icone-ph'); svg.setAttribute('aria-hidden', 'true'); uso.setAttribute('href', 'menu-icones.svg#ph-arrow-square-out');
    svg.append(uso); span.append(svg); a.append(span);
    return a;
  }
  function lerParametros(busca) {
    const p = new URLSearchParams(busca || '');
    const cnpj = digitos(p.get('cnpj'));
    return { cnpj: CNPJ.test(cnpj) ? cnpj : cnpjDeControle(p.get('controle')), nome: String(p.get('nome') || '').trim().slice(0, 300) };
  }
  function formatarCnpj(c) {
    return CNPJ.test(c || '') ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '';
  }

  // Relacionamento da empresa com o órgão: o mesmo resultado que Processos mostra, reduzido a 4 situações.
  const GANHOU = new Set(['vitoria_parcial', 'vitoria_total', 'vitoria_sem_detalhamento']);
  const SITUACOES = {
    ganhou: 'Ganhou', perdeu: 'Perdeu', andamento: 'Em andamento', nao_participou: 'Não participou ou arquivado',
  };
  function situacaoProcesso(p) {
    const r = p?.situacao_resultado, s = p?.status;
    let chave = 'andamento';
    if (GANHOU.has(r) || s === 'homologado' || s === 'contratado') chave = 'ganhou';
    else if (r === 'sem_vitoria' || s === 'perdido') chave = 'perdeu';
    else if (r === 'nao_participou' || r === 'revogado_anulado' || p?.decisao === 'nao_participar' || s === 'arquivado') chave = 'nao_participou';
    return { chave, texto: SITUACOES[chave] };
  }
  function resumirRelacionamento(processos) {
    const r = { total: 0, ganhou: 0, perdeu: 0, andamento: 0, nao_participou: 0, valorGanho: 0, ganhosSemValor: 0, taxaVitoria: null };
    for (const p of processos || []) {
      const { chave } = situacaoProcesso(p);
      r.total += 1; r[chave] += 1;
      if (chave !== 'ganhou') continue;
      const v = Number(p.valor_homologado);
      if (p.valor_homologado != null && Number.isFinite(v)) r.valorGanho += v; else r.ganhosSemValor += 1;
    }
    const disputadas = r.ganhou + r.perdeu;
    r.taxaVitoria = disputadas ? Math.round((r.ganhou / disputadas) * 100) : null;
    return r;
  }

  // Situação da licitação aberta: texto + classe (nunca só cor). hoje = 'AAAA-MM-DD' em Brasília.
  function prazoAberta(encerramento, hoje) {
    if (!encerramento) return { classe: 'neutro', texto: 'Sem data de encerramento' };
    const dias = Math.round((Date.parse(String(encerramento).slice(0, 10)) - Date.parse(hoje)) / 864e5);
    if (dias < 0) return { classe: 'atrasado', texto: 'Encerrada' };
    if (dias === 0) return { classe: 'atencao', texto: 'Atenção: fecha hoje' };
    if (dias <= 3) return { classe: 'atencao', texto: `Atenção: fecha em ${dias} ${dias === 1 ? 'dia' : 'dias'}` };
    return { classe: 'emdia', texto: `Aberta: ${dias} dias para propostas` };
  }

  function validarContato(entrada) {
    const nome = String(entrada?.nome || '').trim(), papel = String(entrada?.papel || '').trim();
    const telefone = String(entrada?.telefone || '').trim(), email = String(entrada?.email || '').trim();
    const texto = String(entrada?.texto || '').trim();
    if (!nome) return { erro: 'Informe o nome do contato.', campo: 'nome' };
    if (nome.length > 120) return { erro: 'O nome pode ter até 120 caracteres.', campo: 'nome' };
    if (papel.length > 80) return { erro: 'A função pode ter até 80 caracteres.', campo: 'papel' };
    if (telefone && !TELEFONE.test(telefone)) return { erro: 'Telefone com DDD, só números, espaço, parênteses ou traço. Ex.: (92) 3333-4444.', campo: 'telefone' };
    if (email && (email.length > 160 || !EMAIL.test(email))) return { erro: 'E-mail inválido. Ex.: nome@orgao.gov.br.', campo: 'email' };
    if (texto.length > 2000) return { erro: 'A observação pode ter até 2.000 caracteres.', campo: 'texto' };
    const comCpf = [['nome', nome], ['papel', papel], ['texto', texto]].find(([, v]) => CPF.test(v)) || (CPF_TELEFONE.test(telefone) && ['telefone']);
    if (comCpf) return { erro: 'Não guardamos CPF. Tire o número e salve de novo.', campo: comCpf[0] };
    return { dados: { nome, papel: papel || null, telefone: telefone || null, email: email || null, texto: texto || null } };
  }
  function validarAnotacao(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return { erro: 'Escreva a anotação antes de salvar.' };
    if (texto.length > 2000) return { erro: 'A anotação pode ter até 2.000 caracteres.' };
    if (CPF.test(texto)) return { erro: 'Não guardamos CPF. Tire o número e salve de novo.' };
    return { dados: { texto } };
  }
  // Página pública do PNCP a partir do número de controle: edital CNPJ-1-SEQ/ANO, contrato CNPJ-2-SEQ/ANO,
  // ata CNPJ-1-SEQ/ANO-SEQATA. Fora desse formato, sem link (nunca um endereço montado de texto livre).
  function linkPncp(controle) {
    const m = /^(\d{14})-([12])-(\d{1,6})\/(\d{4})(?:-(\d{1,6}))?$/.exec(String(controle || ''));
    if (!m) return null;
    const [, cnpj, tipo, seq, ano, ata] = m, n = (x) => String(Number(x));
    if (ata) return `https://pncp.gov.br/app/atas/${cnpj}/${ano}/${n(seq)}/${n(ata)}`;
    return `https://pncp.gov.br/app/${tipo === '2' ? 'contratos' : 'editais'}/${cnpj}/${ano}/${n(seq)}`;
  }
  // PostgREST: ilike sem curinga = igual sem diferença de maiúscula; % e _ do nome viram literais.
  const padraoIlike = (nome) => String(nome || '').trim().replace(/[\\%_]/g, (c) => `\\${c}`);

  // ---------- Busca de órgãos (catálogo + PNCP ao vivo, 24/11/2026) ----------
  // O que a pessoa digitou: CNPJ completo abre a ficha direto; o resto vai para buscar_orgaos (supabase/orgaos_catalogo.sql).
  function interpretarTermo(termo) {
    const t = String(termo || '').trim(), d = digitos(t);
    if (/^[\d./\s-]+$/.test(t) && d.length === 14) return { tipo: 'cnpj', cnpj: d };
    if (/^[\d./\s-]+$/.test(t)) return d.length >= 4 ? { tipo: 'numero' } : { tipo: 'curto' };
    return normalizarNome(t).replace(/[^a-z0-9]/g, '').length >= 2 ? { tipo: 'nome' } : { tipo: 'curto' };
  }
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  // Linha de baixo de cada sugestão: cidade/UF, CNPJ e o que há de dado do órgão.
  function descreverOrgao(o) {
    const local = [o?.municipio, o?.uf].filter(Boolean).join('/');
    const contagens = [o?.abertas ? plural(o.abertas, 'licitação aberta', 'licitações abertas') : '',
      o?.contratos ? plural(o.contratos, 'contrato', 'contratos') : '', o?.atas ? plural(o.atas, 'ata', 'atas') : ''].filter(Boolean);
    return [local, CNPJ.test(o?.cnpj || '') ? 'CNPJ ' + formatarCnpj(o.cnpj) : '', contagens.join(', ') || 'sem compras nos dados coletados'].filter(Boolean).join(' · ');
  }

  // Banco local com pouco do órgão: a tela completa com o PNCP ao vivo (/api/orgao-pncp). Com bastante, só se pedirem.
  const POUCO_DADO_LOCAL = 10;
  function precisaPncp(ficha) {
    if (!ficha || !CNPJ.test(ficha.cnpj || '')) return false;
    return (ficha.abertas?.length || 0) + Number(ficha.contratos_resumo?.quantidade || 0) + (ficha.atas?.length || 0) < POUCO_DADO_LOCAL;
  }
  const unirPor = (chave, ...listas) => { const m = new Map(); for (const l of listas) for (const x of l || []) if (x?.[chave] && !m.has(x[chave])) m.set(x[chave], x); return [...m.values()]; };
  const valorNumero = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  // Ficha local (RPC ficha_orgao) + PNCP ao vivo, sem duplicar (mesmo número de controle = mesmo registro; o local vence,
  // é o que o resto do sistema mostra). hoje = 'AAAA-MM-DD' de Brasília.
  function mesclarFicha(local, vivo, hoje) {
    const base = local && local.encontrado !== false ? local : { cnpj: local?.cnpj || null };
    if (!vivo) return base;
    const abertas = unirPor('numero_controle_pncp', base.abertas, vivo.abertas)
      .filter((a) => !a.encerramento || String(a.encerramento).slice(0, 10) >= hoje)
      .sort((a, b) => String(a.encerramento || '9999').localeCompare(String(b.encerramento || '9999')));
    const contratos = unirPor('numero_controle_pncp', base.contratos, vivo.contratos)
      .sort((a, b) => String(b.data_assinatura || '').localeCompare(String(a.data_assinatura || '')));
    const atas = unirPor('numero_controle_pncp_ata', base.atas, vivo.atas)
      .sort((a, b) => String(b.data_assinatura || '').localeCompare(String(a.data_assinatura || '')));
    // Contratos: a contagem local cobre 2 anos; a do PNCP, 12 meses. Vale a maior; sem a soma local, soma o que veio.
    const r = base.contratos_resumo || { quantidade: 0, valor: 0, desde: null };
    const totalVivo = Number(vivo.totais?.contratos || 0);
    const resumoVivo = () => {
      const lista = contratos.filter((c) => valorNumero(c.valor) != null);
      return { quantidade: Math.max(totalVivo, contratos.length), valor: lista.reduce((s, c) => s + Number(c.valor), 0),
        desde: contratos.map((c) => c.data_assinatura).filter(Boolean).sort()[0] || null, parcial: totalVivo > contratos.length, doPncp: true };
    };
    const contratosResumo = Number(r.quantidade || 0) >= Math.max(totalVivo, contratos.length) ? r : resumoVivo();
    let fornecedores = base.fornecedores || [];
    if (!fornecedores.length && contratos.length) {
      const soma = new Map();
      for (const c of contratos) {
        const nome = c.fornecedor || 'Fornecedor não informado', x = soma.get(nome) || { nome, contratos: 0, valor: 0 };
        x.contratos += 1; x.valor += valorNumero(c.valor) || 0; soma.set(nome, x);
      }
      fornecedores = [...soma.values()].sort((a, b) => b.valor - a.valor).slice(0, 5);
    }
    const primeiro = [...(vivo.abertas || []), ...(vivo.contratos || [])].find((x) => x.municipio || x.uf) || {};
    const dados = {
      nome: base.dados?.nome || vivo.orgao?.nome || null,
      uf: base.dados?.uf || primeiro.uf || null,
      municipio: base.dados?.municipio || primeiro.municipio || null,
    };
    return { ...base, encontrado: true, cnpj: base.cnpj, dados, esfera: base.esfera || vivo.orgao?.esfera || null,
      abertas: abertas.slice(0, 30), contratos: contratos.slice(0, 30), atas: atas.slice(0, 30), contratos_resumo: contratosResumo, fornecedores };
  }
  // Selo da origem dos dados ao vivo. agora em ms (Date.now()).
  function avisoPncp(vivo, agora) {
    if (!vivo) return null;
    const hora = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    const NOMES = { orgao: 'cadastro', abertas: 'licitações abertas', contratos: 'contratos', atas: 'atas' };
    const falhou = (vivo.falharam || []).map((f) => NOMES[f] || f);
    const resto = falhou.length ? ` O PNCP não respondeu a tempo: ${falhou.join(', ')} (mostrando o que já tínhamos).` : '';
    if (vivo.origem === 'ao-vivo') return { tipo: falhou.length ? 'atencao' : 'ok', texto: 'Atualizado agora do PNCP.' + resto };
    const quando = vivo.guardadoEm && Number.isFinite(Date.parse(vivo.guardadoEm)) ? hora(vivo.guardadoEm) : null;
    const minutos = quando ? Math.round((agora - Date.parse(vivo.guardadoEm)) / 6e4) : null;
    if (vivo.origem === 'cache') return { tipo: falhou.length ? 'atencao' : 'ok', texto: `Do PNCP, consultado ${minutos != null && minutos < 60 ? `há ${Math.max(minutos, 1)} min` : `em ${quando}`}.` + resto };
    return { tipo: 'atencao', texto: `O PNCP está lento agora: mostrando a consulta guardada de ${quando || 'antes'}.` + resto };
  }

  const api = {
    cnpjDeControle, normalizarNome, chaveOrgao, linkFicha, linkFichaHtml, linkFichaElemento, lerParametros, formatarCnpj,
    situacaoProcesso, resumirRelacionamento, prazoAberta, validarContato, validarAnotacao, padraoIlike, linkPncp,
    interpretarTermo, descreverOrgao, precisaPncp, mesclarFicha, avisoPncp,
  };
  raiz.LicitaFichaOrgao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
