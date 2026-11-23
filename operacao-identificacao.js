/* global URLSearchParams, module */
(function (global) {
  'use strict';
  function empresaDoLink(busca, empresas) {
    const parametros = new URLSearchParams(busca);
    if (!parametros.has('empresa')) return undefined;
    const id = parametros.get('empresa');
    return empresas.some(e => e.id === id) ? id : null;
  }
  function retornoAoProcesso(busca, empresaId) {
    const parametros = new URLSearchParams(busca), processoId = parametros.get('processo');
    if (parametros.get('empresa') !== empresaId || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(processoId || '')) return null;
    // O destino só abre o dossiê depois de encontrá-lo na lista autorizada da empresa.
    return `processos.html?empresa=${encodeURIComponent(empresaId)}&processo=${encodeURIComponent(processoId)}`;
  }
  // titulo e aoAtualizar: o quadro único de operacao.html nomeia a seção e repassa o endereço confirmado ao perfil (UF da sede).
  function montar({ alvo, obterSessao, requisitar = global.fetch.bind(global), titulo, aoAtualizar }) {
    let vigente = null, uiAtiva = null;
    function limpar(mensagem) {
      vigente = null; uiAtiva = null; alvo.replaceChildren();
      const aviso = alvo.ownerDocument.createElement('p'); aviso.setAttribute('role', 'status'); aviso.textContent = mensagem; alvo.append(aviso);
    }
    function abrir(empresaId, usuarioId) {
      limpar(empresaId ? 'Carregando identificação…' : 'Selecione ou adicione uma empresa para conferir seus dados.');
      if (!empresaId || !usuarioId) return;
      const contexto = { empresaId, usuarioId }; vigente = contexto;
      const ativo = () => vigente === contexto;
      const sessaoValida = sessao => {
        if (!ativo()) return false;
        if (!sessao?.accessToken || sessao.userId !== contexto.usuarioId) { limpar('Sua sessão mudou. Recarregue a página para validar seu acesso.'); return false; }
        return true;
      };
      const solicitar = async dados => {
        if (!ativo()) return null;
        const sessao = await obterSessao(); if (!sessaoValida(sessao)) return null;
        let resposta, resultado, erro;
        try {
          resposta = await requisitar('/api/empresa-identificacao', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.accessToken}` }, body: JSON.stringify({ ...dados, empresaId }) });
          if (!ativo()) return null;
          resultado = await resposta.json(); if (!ativo()) return null;
        } catch { erro = new Error('Não foi possível consultar a identificação. Confira a conexão e use Carregar identificação salva para repetir.'); }
        if (!ativo()) return null;
        const atual = await obterSessao(); if (!sessaoValida(atual)) return null;
        if (erro) throw erro;
        if (!resposta.ok) throw new Error(resultado.erro || 'Identificação indisponível. Use Carregar identificação salva para repetir.');
        return resultado;
      };
      alvo.replaceChildren();
      const ui = global.EmpresaIdentificacaoUI.renderizar(alvo, { empresaId, ativo, solicitar, semMinuta: true, aberto: true, titulo, atualizado: aoAtualizar, salvarPorFora: true }); uiAtiva = ui;
      void ui.carregar();
    }
    return { abrir, limpar, salvarPendente: () => uiAtiva ? uiAtiva.salvarPendente() : Promise.resolve({ ok: true, salvou: false }), temAlteracoesNaoSalvas: () => uiAtiva?.temAlteracoesNaoSalvas?.() === true };
  }
  // Dígito verificador do CNPJ (mesma conta de supabase/empresa_editar.sql): recusa 13 dígitos e número trocado.
  function cnpjValido(valor) {
    const c = String(valor || '').replace(/\D/g, '');
    if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
    const dv = n => { const r = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2].slice(13 - n).reduce((s, p, i) => s + Number(c[i]) * p, 0) % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
  }
  const api = { montar, empresaDoLink, retornoAoProcesso, cnpjValido };
  global.OperacaoIdentificacao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
