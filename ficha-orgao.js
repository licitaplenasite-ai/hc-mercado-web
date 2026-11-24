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

  const api = {
    cnpjDeControle, normalizarNome, chaveOrgao, linkFicha, lerParametros, formatarCnpj,
    situacaoProcesso, resumirRelacionamento, prazoAberta, validarContato, validarAnotacao, padraoIlike, linkPncp,
  };
  raiz.LicitaFichaOrgao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
