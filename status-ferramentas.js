/* global window, module -- script de navegador (admin.html) e funções puras testadas no Node */
// Status das Ferramentas: atualização E cobertura de cada fonte de dados. Morava no painel do cliente (painel.html#status);
// em 23/11 virou controle interno e foi para a aba "Saúde do sistema" do admin.html. As consultas só leem.
(function () {
  'use strict';

  const FONTES_STATUS = [
    { supabase: 'oportunidades_meta', nome: 'Editais e licitações (PNCP)', afeta: 'Boletim, Encontrar Licitações, Dashboard', icone: 'ph-clipboard-text' },
    // Contratos e atas agora moram no Supabase. Consultar o último registro direto
    // dali impede que este quadro acuse um metadado estático antigo como se a coleta
    // inteira estivesse parada.
    { tabelaSupabase: 'contratos', nome: 'Contratos assinados (PNCP)', afeta: 'Inteligência de Mercado, Analisar concorrente', icone: 'ph-file-text' },
    { tabelaSupabase: 'mercado_atas', nome: 'Inteligência de Mercado', afeta: 'Inteligência de Mercado (atas e empresas do segmento)', icone: 'ph-chart-bar' },
    // "Licitações federais (Portal da Transparência)" saiu em 05/08/2026 (commit f5b6299): o coletor foi aposentado
    // em favor do radar de convênios/repasses abaixo, e o cartão ficava órfão com "atualizado há 14 dia(s)".
    { supabase: 'convenios', nome: 'Convênios e Emendas Federais', afeta: 'Convênios e Emendas Federais', icone: 'ph-handshake' },
    { supabase: 'sistema_s_am', nome: 'Sistema S/AM (SENAC/SESC)', afeta: 'Boletim (editais do Sistema S no AM)', icone: 'ph-graduation-cap' },
    // Prospecção: o robô coleta UF por UF em rodízio e grava um resumo por grupo (prospeccao_cobertura_<grupo>).
    { prospeccao: true, nome: 'Prospecção (PCA, IRP, atas, contratos)', afeta: 'Prospecção', icone: 'ph-chart-bar' },
  ];

  // Cobertura real da Prospecção: quantas das 27 UFs têm coleta completa nos últimos 3 dias, por tipo.
  function resumoProspeccao(blobs, agora = Date.now()) {
    const ufs = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
    const etapas = Object.assign({}, ...blobs.map((b) => (b && b.dado && b.dado.etapas) || {}));
    const recente = (k) => { const t = Date.parse(etapas[k] && etapas[k].concluidaEm); return Number.isFinite(t) && agora - t <= 72 * 36e5; };
    const tipos = [['pca', 'planos de compras'], ['ata', 'atas'], ['contrato', 'contratos']];
    const contagem = tipos.map(([t, nome]) => [nome, ufs.filter((uf) => recente(`${uf}:${t}`)).length]);
    const pendentes = ufs.filter((uf) => tipos.some(([t]) => !recente(`${uf}:${t}`)));
    const atualizadoEm = blobs.map((b) => b && b.dado && b.dado.atualizadoEm).filter(Boolean).sort().pop() || null;
    const detalhe = `Coleta completa nos últimos 3 dias: ${contagem.map(([nome, n]) => `${nome} em ${n} de 27 UFs`).join(', ')}; IRP ${recente('irp') ? 'em dia' : 'pendente'}.`;
    return { atualizadoEm, pendentes, detalhe };
  }

  function formatarHaQuanto(iso) {
    if (!iso) return null;
    const diffMs = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diffMs)) return null;
    const horas = diffMs / (1000 * 60 * 60);
    if (horas < 1) return 'há menos de 1 hora';
    if (horas < 24) return `há ${Math.round(horas)} hora(s)`;
    return `há ${Math.round(horas / 24)} dia(s)`;
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function lerFonte(sb, fonte) {
    try {
      if (fonte.supabase) {
        const { data, error } = await sb.from('dados_robo').select('dado').eq('chave', fonte.supabase).maybeSingle();
        const dados = !error && data ? data.dado : null;
        if (!dados) return { ...fonte, ok: false };
        return {
          ...fonte,
          ok: true,
          atualizadoEm: dados.atualizadoEm || null,
          // O metadado de oportunidades registra UFs com falha. Sem esta leitura, uma coleta que só preservou cache
          // antigo parecia saudável apenas por ter um horário recente. Os outros blobs não têm esses campos.
          ufsComFalha: Array.isArray(dados.ufsComFalha) ? dados.ufsComFalha : [],
          saudeFonte: dados.saudeFonte || null,
        };
      }
      if (fonte.prospeccao) {
        const { data, error } = await sb.from('dados_robo').select('dado').like('chave', 'prospeccao_cobertura_%');
        if (error || !data || !data.length) return { ...fonte, ok: false };
        const r = resumoProspeccao(data);
        return { ...fonte, ok: true, atualizadoEm: r.atualizadoEm, ufsPendentesProspeccao: r.pendentes, detalheProspeccao: r.detalhe };
      }
      const { data, error } = await sb.from(fonte.tabelaSupabase).select('atualizado_em')
        .order('atualizado_em', { ascending: false }).limit(1).maybeSingle();
      if (error || !data) return { ...fonte, ok: false };
      return { ...fonte, ok: true, atualizadoEm: data.atualizado_em || null };
    } catch {
      return { ...fonte, ok: false };
    }
  }

  // Cor, marca e texto de um cartão. Sem leitura não dá para afirmar que a fonte parou: fica cinza, não vermelho.
  function classificarFonte(r) {
    const haQuanto = r.ok ? formatarHaQuanto(r.atualizadoEm) : null;
    const horas = r.atualizadoEm ? (Date.now() - new Date(r.atualizadoEm).getTime()) / (1000 * 60 * 60) : Infinity;
    let cor = 'var(--texto-fraco)', texto = 'Não foi possível verificar agora', detalhe = '', marca = '○';
    if (r.ok && haQuanto) {
      marca = '●';
      if (horas <= 30) { cor = 'var(--verde)'; texto = `Em dia — atualizado ${haQuanto}`; }
      else if (horas <= 72) { cor = 'var(--laranja)'; texto = `Atenção — atualizado ${haQuanto}`; }
      else { cor = 'var(--vermelho)'; texto = `Atrasado — atualizado ${haQuanto}, pode estar parado`; }
    }
    if (r.ufsComFalha && r.ufsComFalha.length > 0) {
      marca = '●';
      if (r.saudeFonte === 'indisponivel') {
        cor = 'var(--laranja)';
        texto = 'Portal do governo (PNCP) instável — mostramos os editais da última atualização';
        detalhe = 'O portal não respondeu na última atualização. Tentamos de novo sozinhos, sem apagar os editais que você já vê.';
      } else {
        const todas = r.ufsComFalha.length >= 27;
        cor = todas ? 'var(--vermelho)' : 'var(--laranja)';
        texto = todas ? 'Sem editais novos de nenhum estado' : `Atualização parcial — ${r.ufsComFalha.length} estado(s) pendente(s)`;
        detalhe = todas ? 'A última atualização não trouxe editais novos; mostramos os da atualização anterior.' : `Estados pendentes: ${r.ufsComFalha.join(', ')}.`;
      }
    }
    if (r.ok && r.ufsPendentesProspeccao) {
      // A data da última gravação diz só que o robô está rodando; o que importa é quantas UFs já têm dado.
      const n = r.ufsPendentesProspeccao.length;
      if (n === 0) { cor = 'var(--verde)'; texto = 'Em dia — as 27 UFs coletadas nos últimos 3 dias'; }
      else if (n === 27) { cor = 'var(--laranja)'; texto = 'Primeira coleta em andamento'; }
      else { cor = 'var(--laranja)'; texto = `Cobertura parcial — ${27 - n} de 27 UFs completas`; }
      detalhe = r.detalheProspeccao + (n && n < 27 ? ` Ainda faltam: ${r.ufsPendentesProspeccao.join(', ')}.` : '');
    }
    return { cor, texto, detalhe, marca };
  }

  function cartao(f, { cor, texto, detalhe, marca }, sprite) {
    return `<div class="cartao-fonte" style="border-top-color:${cor};">
        <h4><svg class="icone-ph" aria-hidden="true"><use href="${sprite}#${f.icone}"></use></svg> ${escapeHtml(f.nome)}</h4>
        <div class="valor" style="color:${cor};">${marca} ${escapeHtml(texto)}</div>
        ${detalhe ? `<p>${escapeHtml(detalhe)}</p>` : ''}
        <p>Afeta: ${escapeHtml(f.afeta)}</p>
      </div>`;
  }

  async function carregar(sb, alvo, sprite = 'menu-icones.svg') {
    // Estado inicial cinza: "verificando" não é bom nem ruim, então não usa verde nem vermelho.
    alvo.innerHTML = FONTES_STATUS.map((f) => cartao(f, { cor: 'var(--border-default)', texto: 'Verificando…', detalhe: '', marca: '○' }, sprite)).join('');
    const resultados = await Promise.all(FONTES_STATUS.map((f) => lerFonte(sb, f)));
    alvo.innerHTML = resultados.map((r) => cartao(r, classificarFonte(r), sprite)).join('');
  }

  const api = { FONTES_STATUS, resumoProspeccao, formatarHaQuanto, classificarFonte, carregar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.StatusFerramentas = api;
})();
