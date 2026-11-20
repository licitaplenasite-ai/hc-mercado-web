// Ações na sala de disputa (funções injetadas, autocontidas: executeScript serializa só o corpo). Seletores da sala
// MODELADA (ver sala-disputa.mjs); não homologado na sala real.
//
// preencherValorFinalMinimo (etapa 1, IN 73 art. 19): escreve o piso do LicitaPlena no campo "valor final mínimo" do
//   robô do próprio Compras.gov. NUNCA clica em Salvar: quem confere e salva é a pessoa.
// enviarLanceNaSala (etapa 2, "lance com 1 clique"): chamada SÓ pelo clique da pessoa em "Sim, dar lance" no popup.
//   Confere de novo, na hora, que a sala não mudou desde a sugestão (melhor valor e meu valor iguais), que não há
//   captcha nem sessão expirada e que o valor não fica abaixo do piso; então preenche o valor e clica "Enviar lance"
//   do item (o único clique). Um lance por chamada; não repete sozinha. Não resolve captcha, não aceita termo.

export function preencherValorFinalMinimo(entrada) {
  const doc = globalThis.document;
  const escrever = (el, valor) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    el.focus();
    if (desc?.set) desc.set.call(el, valor); else el.value = valor;
    for (const tipo of ['input', 'change', 'blur']) el.dispatchEvent(new globalThis.Event(tipo, { bubbles: true }));
  };
  const pisos = new Map((entrada?.itens || []).map(i => [String(i.item), String(i.piso)]));
  const r = { preenchidos: [], semCampo: [], jaPreenchidos: [] };
  for (const card of doc.querySelectorAll('[data-test="item-disputa"]')) {
    const item = String(card.querySelector('[data-test="numero-item"]')?.textContent || '').trim().replace(/^0+(?=\d)/, '');
    if (!pisos.has(item)) continue;
    const campo = card.querySelector('[data-test="input-valor-final-minimo"]');
    if (!campo) { r.semCampo.push(item); continue; }
    if (campo.value.trim() && campo.value.trim() !== pisos.get(item)) { r.jaPreenchidos.push(item); continue; } // não sobrescreve o que a pessoa digitou
    escrever(campo, pisos.get(item));
    r.preenchidos.push(item);
  }
  return r;
}

export async function enviarLanceNaSala(entrada) {
  const g = globalThis, doc = g.document;
  const limpo = s => String(s || '').replace(/\s+/g, ' ').trim();
  const escalar = t => {
    let s = String(t ?? '').replace(/R\$|\s/g, '');
    if (!/^\d[\d.]*,\d{1,4}$|^\d+(\.\d{1,4})?$/.test(s)) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const [i, f = ''] = s.split('.');
    return BigInt(i + f.padEnd(4, '0'));
  };
  const visivel = el => el && el.getClientRects().length > 0;
  if (Array.from(doc.querySelectorAll('iframe[src*="hcaptcha.com"]')).some(f => visivel(f) && /desafio/i.test(f.getAttribute('title') || ''))) return { situacao: 'bloqueado', motivo: 'captcha' };
  if (/sess[aã]o\s+(expirou|expirada|encerrada)/i.test(String(doc.body?.textContent || '').slice(0, 50000))) return { situacao: 'bloqueado', motivo: 'sessao_expirada' };
  const card = Array.from(doc.querySelectorAll('[data-test="item-disputa"]'))
    .find(c => limpo(c.querySelector('[data-test="numero-item"]')?.textContent).replace(/^0+(?=\d)/, '') === String(entrada?.item));
  if (!card) return { situacao: 'bloqueado', motivo: 'item_sumiu' };
  const q = n => card.querySelector(`[data-test="${n}"]`);
  const valor = escalar(entrada?.valor), piso = escalar(entrada?.piso), meu = escalar(q('meu-valor')?.textContent);
  if (limpo(q('melhor-valor')?.textContent) !== entrada?.melhorLido || limpo(q('meu-valor')?.textContent) !== entrada?.meuLido) return { situacao: 'bloqueado', motivo: 'sala_mudou' };
  if (valor === null || piso === null || valor < piso) return { situacao: 'bloqueado', motivo: 'piso' };
  if (meu === null || valor >= meu) return { situacao: 'bloqueado', motivo: 'nao_melhora' };
  const campo = q('input-valor-lance'), botao = q('btn-enviar-lance');
  if (!campo || !botao || botao.disabled) return { situacao: 'bloqueado', motivo: 'sem_campo' };
  const texto = `${valor / 10000n},${String(valor % 10000n).padStart(4, '0')}`;
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(campo), 'value');
  campo.focus();
  if (desc?.set) desc.set.call(campo, texto); else campo.value = texto;
  for (const tipo of ['input', 'change', 'blur']) campo.dispatchEvent(new g.Event(tipo, { bubbles: true }));
  if (escalar(campo.value) !== valor) return { situacao: 'bloqueado', motivo: 'mascara', campo: campo.value };
  const msgAntes = limpo(q('mensagem-lance')?.textContent);
  botao.click();
  // Resposta do portal: "Meu valor" passa a ser o lance (enviado) ou aparece mensagem de recusa. Espera até 5 s.
  for (let t = 0; t < 50; t++) {
    await new Promise(r => g.setTimeout(r, 100));
    if (escalar(q('meu-valor')?.textContent) === valor) return { situacao: 'enviado', valor: texto };
    const msg = limpo(q('mensagem-lance')?.textContent);
    if (msg && msg !== msgAntes && /recus|n[aã]o (foi )?aceit|inv[aá]lid|erro/i.test(msg)) return { situacao: 'recusado', valor: texto, mensagem: msg.slice(0, 200) };
  }
  return { situacao: 'incerto', valor: texto };
}
