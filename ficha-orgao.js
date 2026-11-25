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
    const cnpj = digitos(p.get('cnpj')), uasg = digitos(p.get('uasg'));
    return { cnpj: CNPJ.test(cnpj) ? cnpj : cnpjDeControle(p.get('controle')), nome: String(p.get('nome') || '').trim().slice(0, 300),
      uasg: /^\d{1,8}$/.test(uasg) ? uasg : null };
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

  // PNCP ao vivo (/api/orgao-pncp) só com dado guardado velho ou faltando: o que ele lê fica no banco para todos
  // (orgaos_pncp_cache) e volta pela ficha_orgao em ficha.pncp = [{ fonte, periodo, total, itens, em }].
  // agora em ms (Date.now()). 6 h: as licitações abertas mudam no dia; os contratos de meses fechados quase não mudam.
  const FRESCO_MS = 6 * 36e5;
  const FECHADO_MS = 30 * 864e5;
  // Trimestre de calendário do dia (AAAA-MM-DD) no formato do lote de contratos (orgao-pncp.js): AAAAMM do 1º mês.
  const trimestre = (dia) => dia.slice(0, 4) + String(Math.floor((Number(dia.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0');
  const diaBrasilia = (ms) => new Date(ms - 3 * 36e5).toISOString().slice(0, 10);
  const idade = (l, agora) => { const t = Date.parse(l.em); return Number.isFinite(t) ? agora - t : Infinity; };
  function precisaPncp(ficha, agora) {
    if (!ficha || ficha.encontrado === false || !CNPJ.test(ficha.cnpj_principal || ficha.cnpj || '')) return false;
    const lotes = ficha.pncp || [], atual = trimestre(diaBrasilia(agora));
    const fresco = (l) => !!l && idade(l, agora) < FRESCO_MS;
    return !fresco(lotes.find((l) => l.fonte === 'abertas')) || !fresco(lotes.find((l) => l.fonte === 'contratos' && l.periodo === atual))
      || lotes.filter((l) => l.fonte === 'contratos').length < 4;
  }
  // O que o /api/orgao-pncp pode pular (o PNCP aceita ~20 chamadas por minuto): o cadastro e os trimestres já fechados,
  // consultados há menos de 30 dias.
  function pularPncp(ficha, agora) {
    const atual = trimestre(diaBrasilia(agora));
    return (ficha?.pncp || []).filter((l) => (l.fonte === 'orgao' || (l.fonte === 'contratos' && l.periodo !== atual)) && idade(l, agora) < FECHADO_MS)
      .map((l) => (l.fonte === 'orgao' ? 'orgao' : l.periodo));
  }
  // Selo da origem dos dados. vivo = resposta do /api/orgao-pncp nesta visita (ou { erro }), null se não consultou.
  const NOMES_FONTE = { orgao: 'cadastro', abertas: 'licitações abertas', contratos: 'contratos de alguns trimestres', atas: 'atas' };
  function avisoPncp(ficha, vivo, agora) {
    const hora = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
    const ems = (ficha?.pncp || []).map((l) => Date.parse(l.em)).filter(Number.isFinite);
    const ultimo = ems.length ? Math.max(...ems) : null;
    const minutos = ultimo == null ? null : Math.round((agora - ultimo) / 6e4);
    const base = ultimo == null ? 'Dados coletados pelo robô do LicitaPlena.'
      : `Inclui o PNCP consultado ${minutos < 1 ? 'agora' : minutos < 60 ? `há ${minutos} min` : `em ${hora(ultimo)}`}, guardado para a sua equipe e para os próximos acessos.`;
    if (vivo?.erro) return { tipo: 'atencao', texto: `${vivo.erro} ${base}` };
    const avisos = [];
    if (vivo?.pendentes) avisos.push('Parte do PNCP ainda está chegando: a ficha se completa sozinha em instantes.');
    const falhou = (vivo?.falharam || []).map((f) => NOMES_FONTE[f] || f);
    if (falhou.length) avisos.push(`O PNCP não respondeu a tempo: ${falhou.join(', ')}. Tente de novo mais tarde.`);
    if (vivo && vivo.gravado === false) avisos.push('A consulta ao PNCP não pôde ser guardada agora.');
    return { tipo: avisos.length ? 'atencao' : ultimo == null ? 'neutro' : 'ok', texto: [base, ...avisos].join(' ') };
  }

  const api = {
    cnpjDeControle, normalizarNome, chaveOrgao, linkFicha, linkFichaHtml, linkFichaElemento, lerParametros, formatarCnpj,
    situacaoProcesso, resumirRelacionamento, prazoAberta, validarContato, validarAnotacao, padraoIlike, linkPncp,
    interpretarTermo, descreverOrgao, precisaPncp, pularPncp, avisoPncp,
  };
  raiz.LicitaFichaOrgao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
