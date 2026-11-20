// Leitor da SALA DE DISPUTA do Compras.gov.br. Este módulo só LÊ: nunca clica, nunca preenche, nunca navega
// (mesma regra de MODO_AUTOMATICO=false em pregao-leitor.mjs). Quem preenche o campo e clica "Enviar lance" é
// lance-sala.mjs, e só depois do clique de confirmação da pessoa na extensão.
// ATENÇÃO: os seletores vêm de uma sala MODELADA (fixtures/comprasgov-sala-disputa.html), não da sala real, que nunca
// foi aberta por nós. Se a sala real usar outros nomes, lerSala devolve { ok: false, motivo: 'sem_itens' } e o popup
// oferece o diagnóstico; nada é palpitado.
// PRÓXIMO PASSO: abrir a sala no ambiente de treinamento oficial do Compras.gov com o dono logado e mapear os seletores.
//
// lerSala() é autocontida (chrome.scripting.executeScript serializa só o corpo) e devolve:
//   { ok: true, compra, mensagens: <nº de mensagens do pregoeiro na tela>, alertas: ['captcha'|'sessao_expirada'|'suspensa'|'desempate'],
//     itens: [{ itemId, modo, etapa: 'aberta'|'aleatoria'|'fechada'|'encerrada'|'aguardando'|'desconhecida',
//               melhorValor, meuValor, diferencaMinima (texto da tela ou null), situacao: 'ganhando'|'perdendo'|'empate'|null,
//               temCampoLance, temCampoValorFinalMinimo, valorFinalMinimo }] }
//   ou { ok: false, motivo: 'pagina_nao_suportada'|'captcha'|'sessao_expirada'|'sem_itens' }.

export function lerSala() {
  const g = globalThis, doc = g.document;
  let u;
  try { u = new URL(g.location.href); } catch { return { ok: false, motivo: 'pagina_nao_suportada' }; }
  const compra = u.searchParams.get('compra') || '';
  if (u.protocol !== 'https:' || u.hostname !== 'cnetmobile.estaleiro.serpro.gov.br' || !/^\/comprasnet-web\/seguro\/fornecedor\/[\w/-]+$/.test(u.pathname) || !/^\d{17}$/.test(compra)) {
    return { ok: false, motivo: 'pagina_nao_suportada' };
  }
  const limpo = s => String(s || '').replace(/\s+/g, ' ').trim();
  const semAcento = s => limpo(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const visivel = el => el && el.getClientRects().length > 0;
  const alertas = [];
  if (Array.from(doc.querySelectorAll('iframe[src*="hcaptcha.com"]')).some(f => visivel(f) && /desafio/i.test(f.getAttribute('title') || ''))) alertas.push('captcha');
  // Texto da página SEM o chat: "suspensa" dita no chat já para pela regra da mensagem nova, e não pode travar para sempre.
  const copia = doc.body.cloneNode(true);
  copia.querySelectorAll('app-mensagens-chat-lista, .mensagens-texto').forEach(n => n.remove());
  const texto = semAcento(copia.textContent).slice(0, 50000);
  if (/sessao\s+(expirou|expirada|encerrada)/.test(texto)) alertas.push('sessao_expirada');
  if (/\bsuspens[ao]\b|\bsuspendid[ao]\b/.test(texto)) alertas.push('suspensa');
  if (/desempate|direito de preferencia|convocad[ao] para (o )?desempate/.test(texto)) alertas.push('desempate');
  if (alertas.includes('captcha')) return { ok: false, motivo: 'captcha' };
  if (alertas.includes('sessao_expirada')) return { ok: false, motivo: 'sessao_expirada' };

  const mensagens = Array.from(doc.querySelectorAll('.mensagens-texto'))
    .filter(t => limpo(t.textContent) && !/(^|\s)(participante|fornecedor)(\s|$)|mensagens-(participante|fornecedor)/.test(t.parentElement?.className || '')).length;
  const etapaDe = s => {
    const e = semAcento(s);
    return /aleat/.test(e) ? 'aleatoria' : /fechad/.test(e) ? 'fechada' : /encerrad/.test(e) ? 'encerrada' : /aguard/.test(e) ? 'aguardando' : /abert|em disputa/.test(e) ? 'aberta' : 'desconhecida';
  };
  const itens = [];
  for (const card of doc.querySelectorAll('[data-test="item-disputa"]')) {
    const q = n => card.querySelector(`[data-test="${n}"]`);
    const itemId = limpo(q('numero-item')?.textContent).replace(/^0+(?=\d)/, '');
    if (!/^\d{1,6}$/.test(itemId)) continue;
    const sit = semAcento(q('situacao-item')?.textContent);
    itens.push({
      itemId, modo: limpo(q('modo-disputa')?.textContent) || null, etapa: etapaDe(q('etapa-item')?.textContent),
      melhorValor: limpo(q('melhor-valor')?.textContent) || null, meuValor: limpo(q('meu-valor')?.textContent) || null,
      diferencaMinima: limpo(q('intervalo-minimo')?.textContent) || null,
      situacao: /ganhando|vencendo|1o lugar/.test(sit) ? 'ganhando' : /perdendo/.test(sit) ? 'perdendo' : /empat/.test(sit) ? 'empate' : null,
      temCampoLance: Boolean(q('input-valor-lance') && q('btn-enviar-lance')),
      temCampoValorFinalMinimo: Boolean(q('input-valor-final-minimo')),
      valorFinalMinimo: q('input-valor-final-minimo')?.value || '',
    });
  }
  if (!itens.length) return { ok: false, motivo: 'sem_itens' };
  return { ok: true, compra, mensagens, alertas, itens };
}
