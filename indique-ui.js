/* global document, window, location, localStorage, navigator, LicitaPlenaIndicacao -- script de navegador */
// Tela "Indique e ganhe" (indique.html). Tudo vem de uma chamada: rpc minhas_indicacoes (supabase/indicacoes.sql), que
// só devolve o nome curto e a situação de cada indicado (sem e-mail, CNPJ nem telefone). Contas e textos: indicacao.js.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataBr = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
  const I = LicitaPlenaIndicacao;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // eslint-disable-line no-undef -- globais de supabase-config.js
  const SITUACAO_INDICADO = { cadastrado: ['Cadastrado, ainda não pagou', 'espera'], cliente: ['Cliente pagante', 'ok'], bloqueada: ['Não vale (mesmo CNPJ, e-mail ou telefone)', ''] };
  const SITUACAO_COMISSAO = { pendente: ['Aguardando garantia', 'espera'], liberada: ['Liberada', 'ok'], paga: ['Paga', 'ok'], cancelada: ['Cancelada (estorno)', ''] };
  const selo = (mapa, s) => `<span class="selo ${(mapa[s] || ['', ''])[1]}">${esc((mapa[s] || [s])[0])}</span>`;
  function aviso(texto, tipo) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? `aviso ${tipo || 'info'}` : 'aviso'; }

  async function autenticar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('login.html?voltar=/indique'); return false; }
    const { data: cliente } = await sb.from('clientes').select('status').eq('id', session.user.id).maybeSingle();
    if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/indique'); return false; }
    return true;
  }

  function pintar(d) {
    const r = d.regras || {};
    const link = I.linkIndicacao(d.codigo);
    $('link-indicacao').value = link;
    $('codigo-indicacao').textContent = d.codigo;
    $('btn-copiar').disabled = false;
    const whats = $('btn-whatsapp');
    whats.href = I.linkWhatsApp(I.textoConvite(link, r.desconto_indicado_percentual, r.desconto_indicado_meses));
    whats.removeAttribute('aria-disabled');
    const pct = String(Number(r.percentual)).replace('.', ',');
    $('resumo-regras').textContent = r.ativo === false
      ? 'O programa está pausado. Comissões já ganhas continuam valendo.'
      : `Você ganha ${pct}% de cada mensalidade paga por quem você indicar, durante ${r.meses_comissao} ${r.meses_comissao === 1 ? 'mês' : 'meses'}. `
        + (Number(r.desconto_indicado_percentual) > 0 ? `Quem você indicar ganha ${String(Number(r.desconto_indicado_percentual)).replace('.', ',')}% de desconto. ` : '')
        + `A comissão é liberada ${r.dias_garantia} dias depois do pagamento.`;
    const t = I.resumirComissoes(d.comissoes, r.saque_minimo_centavos);
    $('total-pendente').textContent = I.reais(t.pendente);
    $('total-liberada').textContent = I.reais(t.liberada);
    $('total-paga').textContent = I.reais(t.paga);
    $('nota-pendente').textContent = `Libera ${r.dias_garantia} dias depois do pagamento.`;
    $('nota-liberada').textContent = `Saque mínimo: ${I.reais(r.saque_minimo_centavos)}.`;
    $('btn-saque').disabled = !t.podePedirSaque;
    if (t.liberada > t.liberadaSemPedido) $('nota-saque').textContent = 'Pedido de pagamento enviado. A equipe chama você pelo contato do cadastro para pegar a chave Pix.';
    $('corpo-indicados').innerHTML = d.indicados.length ? d.indicados.map((i) => `<tr><td data-rotulo="Nome">${esc(i.nome)}</td>`
      + `<td data-rotulo="Situação">${selo(SITUACAO_INDICADO, i.situacao)}</td><td data-rotulo="Desde">${dataBr(i.desde)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="vazio">Ninguém se cadastrou pelo seu link ainda. Copie o link ou envie pelo WhatsApp.</td></tr>';
    $('corpo-comissoes').innerHTML = d.comissoes.length ? d.comissoes.map((c) => `<tr><td data-rotulo="Indicado">${esc(c.nome)}${c.meses > 1 ? ` <span class="nota">(${c.meses} meses)</span>` : ''}</td>`
      + `<td data-rotulo="Valor">${I.reais(c.valor_centavos)}</td><td data-rotulo="Situação">${selo(SITUACAO_COMISSAO, c.situacao)}${c.saque_pedido_em && c.situacao === 'liberada' ? ' <span class="nota">pagamento pedido</span>' : ''}</td>`
      + `<td data-rotulo="Data">${c.situacao === 'paga' ? 'Paga em ' + dataBr(c.paga_em) : c.situacao === 'pendente' ? 'Libera em ' + dataBr(c.libera_em) : dataBr(c.criado_em)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="vazio">A comissão aparece aqui quando um indicado pagar a mensalidade.</td></tr>';
  }

  async function carregar() {
    const { data, error } = await sb.rpc('minhas_indicacoes');
    if (error) { aviso('Não foi possível carregar suas indicações agora. Recarregue a página.', 'erro'); return; }
    pintar(data);
  }

  $('btn-copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('link-indicacao').value); aviso('Link copiado. Agora é só colar na conversa.', 'info'); }
    catch { $('link-indicacao').select(); aviso('Selecionamos o link: copie com Ctrl+C (ou segure o dedo no celular).', 'info'); }
  });
  $('btn-saque').addEventListener('click', async () => {
    $('btn-saque').disabled = true;
    const { data, error } = await sb.rpc('pedir_saque_indicacao');
    if (error) { aviso(error.message, 'erro'); $('btn-saque').disabled = false; return; }
    aviso(`Pedido de ${I.reais(data.total_centavos)} enviado. A equipe chama você para pegar a chave Pix.`, 'info');
    await carregar();
  });
  $('btn-tema').addEventListener('click', () => {
    const claro = document.documentElement.classList.toggle('tema-claro');
    document.documentElement.dataset.theme = claro ? 'light' : 'dark';
    try { localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
  });

  autenticar().then((ok) => { if (ok) return carregar(); })
    .catch(() => aviso('Não foi possível validar a sessão. Recarregue a página.', 'erro'));
})();
