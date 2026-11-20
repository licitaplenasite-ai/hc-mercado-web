// Popup, seção "Lance com 1 clique" (etapas 1 e 2). Fluxo: na sala de disputa aberta pela pessoa (logada por ela),
// "Buscar meus pisos" lê o valor mínimo de cada item do processo no LicitaPlena (aba logada, como no preencher).
// A pessoa digita redução, diferença mínima e máximo de lances, marca "Confirmo" e liga. Com o popup aberto, a sala é
// lida a cada 3 s (só leitura) e aparece "Dar lance de R$ X?": SÓ o clique em "Sim, dar lance" envia, um lance por clique.
// Configuração e registro ficam no localStorage do popup, por compra (apagados em 30 dias, como o lote do preencher).
// Não há modo automático: fechar o popup ou PARAR desliga; nada roda em segundo plano nem no servidor.
import { origensLicitaPlena as origens } from './diagnostico.mjs';
import { oferecerDiagnostico } from './diagnostico-popup.mjs';
import { campo4, escolherLance, JANELA_EXCLUIR_MS, reais, textoParada, validarConfigItem, valor4 } from './lance-regras.mjs';
import { enviarLanceNaSala, preencherValorFinalMinimo } from './lance-sala.mjs';
import { buscarLoteNaPagina } from './preencher-proposta.mjs';
import { lerSala } from './sala-disputa.mjs';

const $ = id => document.getElementById(id);
const status = $('lanceStatus');
const chaveConfig = c => `lp-lance-config:${c}`, chaveRegistro = c => `lp-lance-registro:${c}`;
const ler = k => { try { return JSON.parse(globalThis.localStorage.getItem(k)) || null; } catch { return null; } };
const gravar = (k, v) => { try { globalThis.localStorage.setItem(k, JSON.stringify({ ...v, em: new Date().toISOString() })); } catch { /* sem armazenamento */ } };
const executar = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args }))?.[0]?.result;
const compraDe = url => { try { const u = new URL(url); return u.hostname === 'cnetmobile.estaleiro.serpro.gov.br' && u.pathname.startsWith('/comprasnet-web/seguro/fornecedor/') && /^\d{17}$/.test(u.searchParams.get('compra') || '') ? u.searchParams.get('compra') : null; } catch { return null; } };

async function sala() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  const compra = compraDe(aba?.url);
  if (!compra) throw new Error('Abra a sala de disputa do pregão no Compras.gov (logado por você) e clique de novo.');
  return { aba, compra };
}
const eventos = compra => ler(chaveRegistro(compra))?.eventos || [];
function registrar(compra, e) {
  const lista = [...eventos(compra), { ...e, emMs: Date.now(), em: new Date().toISOString(), valor: e.valor != null ? reais(e.valor) : null, piso: e.piso != null ? reais(e.piso) : null }].slice(-200);
  gravar(chaveRegistro(compra), { eventos: lista });
  mostrarRegistro(compra);
}
function mostrarRegistro(compra) {
  const ol = $('lanceRegistro');
  ol.replaceChildren(...eventos(compra).slice(-15).reverse().map(e => {
    const li = document.createElement('li');
    li.textContent = `${e.em.slice(11, 19)} item ${e.item ?? '—'}: ${e.situacao}${e.valor ? ` ${e.valor}` : ''}${e.piso ? ` (piso ${e.piso})` : ''}${e.motivo ? ` — ${e.motivo}` : ''}`;
    return li;
  }));
}

// ---------- configuração por item ----------
function desenharConfig(config) {
  const caixa = $('lanceConfig');
  caixa.replaceChildren(...Object.entries(config.itens).map(([item, c]) => {
    const f = document.createElement('fieldset'), lg = document.createElement('legend');
    lg.textContent = `Item ${item} — seu piso no LicitaPlena: ${valor4(c.piso) ? reais(valor4(c.piso)) : 'não cadastrado'}`;
    f.append(lg);
    for (const [campo, rotulo, valor] of [['decremento', 'Valor de cada redução (R$)', c.decremento], ['diferencaMinima', 'Diferença mínima do edital (R$, opcional)', c.diferencaMinima], ['maxLances', 'Máximo de lances neste item', c.maxLances]]) {
      const l = document.createElement('label'), i = document.createElement('input');
      l.textContent = rotulo; i.value = valor ?? ''; i.dataset.item = item; i.dataset.campo = campo; i.inputMode = 'decimal';
      l.append(i); f.append(l);
    }
    return f;
  }));
  $('lanceConfirmoTexto').textContent = `Confirmo: a extensão só sugere lances até o piso de cada item (${Object.entries(config.itens).map(([i, c]) => `item ${i}: ${valor4(c.piso) ? reais(valor4(c.piso)) : 'sem piso'}`).join('; ')}) e só envia quando eu clicar "Sim, dar lance". Li o edital e ele não proíbe lance por ferramenta.`;
  $('lanceConfirmo').checked = false;
}

$('lanceBuscar').addEventListener('click', () => {
  const pedido = chrome.permissions.request({ origins: origens(chrome.runtime.getManifest()) }); // 1º passo do clique (gesto do usuário)
  (async () => {
    if (!await pedido) throw new Error('Sem permissão para ler seus pisos no LicitaPlena.');
    const { aba, compra } = await sala();
    const [lp] = await chrome.tabs.query({ url: origens(chrome.runtime.getManifest()) });
    if (!lp) throw new Error('Abra o LicitaPlena (logado) em outra aba desta janela e clique de novo.');
    const r = await executar(lp.id, buscarLoteNaPagina, [compra]) || { ok: false, erro: 'O LicitaPlena não respondeu.' };
    if (!r.ok) throw new Error(r.erro || `Não foi possível ler seus pisos (HTTP ${r.status}).`);
    const empresasNaCompra = Number(r.empresasNaCompra) || 1;
    if (empresasNaCompra > 1) { gravar(chaveConfig(compra), { armado: false, empresasNaCompra, itens: {} }); throw new Error(textoParada('anticonluio')); }
    if (r.escolher) throw new Error(`Há ${r.escolher.length} processos desta compra no LicitaPlena. Deixe só um processo ativo.`);
    if (!r.processo) throw new Error('Não achei, no LicitaPlena, um processo com esta UASG e número.');
    const leitura = await executar(aba.id, lerSala);
    const naSala = new Set(leitura?.ok ? leitura.itens.map(i => i.itemId) : []);
    const antes = ler(chaveConfig(compra))?.itens || {};
    const itens = {};
    for (const i of r.itens) {
      const item = String(i.item).replace(/^0+(?=\d)/, '');
      if (naSala.size && !naSala.has(item)) continue;
      const p = valor4(i.valorMinimo);
      itens[item] = { decremento: '', diferencaMinima: '', maxLances: '10', ...antes[item], piso: p ? campo4(p) : '' };
    }
    if (!Object.keys(itens).length) throw new Error('Nenhum item do seu processo está nesta sala.');
    const config = { armado: false, empresasNaCompra, itens };
    gravar(chaveConfig(compra), config);
    desenharConfig(config);
    status.textContent = `Processo ${r.processo.numero}: ${Object.keys(itens).length} itens. Preencha a redução e o máximo de lances, marque "Confirmo" e clique em "Salvar e ligar".`;
    if (leitura && !leitura.ok && leitura.motivo === 'sem_itens') oferecerDiagnostico('acompanhar', 'sala_lance_sem_itens');
  })().catch(falha);
});

$('lanceLigar').addEventListener('click', () => {
  (async () => {
    const { aba, compra } = await sala();
    const config = ler(chaveConfig(compra));
    if (config?.empresasNaCompra > 1) throw new Error(textoParada('anticonluio'));
    if (!config?.itens || !Object.keys(config.itens).length) throw new Error('Clique antes em "Buscar meus pisos no LicitaPlena".');
    for (const i of document.querySelectorAll('#lanceConfig input')) config.itens[i.dataset.item][i.dataset.campo] = i.value.trim();
    const erros = Object.entries(config.itens).flatMap(([item, c]) => { const v = validarConfigItem(c); return v.ok ? [] : v.erros.map(e => `Item ${item}: ${e}`); });
    if (erros.length) { gravar(chaveConfig(compra), { ...config, armado: false }); throw new Error(erros.join('\n')); }
    if (!$('lanceConfirmo').checked) throw new Error('Marque "Confirmo" para ligar.');
    const leitura = await executar(aba.id, lerSala);
    if (!leitura?.ok) throw new Error(textoParada(leitura?.motivo === 'captcha' || leitura?.motivo === 'sessao_expirada' ? leitura.motivo : 'sem_leitura'));
    gravar(chaveConfig(compra), { ...config, armado: true, mensagensBase: leitura.mensagens });
    registrar(compra, { situacao: 'ligado', motivo: 'configuração confirmada por você' });
    rodar();
  })().catch(falha);
});

$('lanceMinimo').addEventListener('click', () => {
  (async () => {
    const { aba, compra } = await sala();
    const config = ler(chaveConfig(compra));
    if (config?.empresasNaCompra > 1) throw new Error(textoParada('anticonluio'));
    const itens = Object.entries(config?.itens || {}).filter(([, c]) => valor4(c.piso)).map(([item, c]) => ({ item, piso: c.piso }));
    if (!itens.length) throw new Error('Clique antes em "Buscar meus pisos no LicitaPlena".');
    const r = await executar(aba.id, preencherValorFinalMinimo, [{ itens }]);
    const linhas = [`Valor final mínimo preenchido nos itens: ${r.preenchidos.join(', ') || 'nenhum'}. Confira cada valor e clique você mesmo em Salvar no portal.`];
    if (r.semCampo.length) linhas.push(`Sem o campo "valor final mínimo" na tela (o robô do Compras.gov pode não estar disponível neste pregão): itens ${r.semCampo.join(', ')}.`);
    if (r.jaPreenchidos.length) linhas.push(`Já tinham outro valor (não mexi): itens ${r.jaPreenchidos.join(', ')}.`);
    status.textContent = linhas.join('\n');
  })().catch(falha);
});

// ---------- rodada: lê a sala e mostra a sugestão; nunca envia sozinha ----------
let timer = null, sugestao = null, enviando = false, avisoTimer = null;
function parar(compra, motivo) {
  globalThis.clearInterval(timer); timer = null; sugestao = null;
  $('lanceSugestao').hidden = true;
  const config = compra && ler(chaveConfig(compra));
  if (config?.armado) { gravar(chaveConfig(compra), { ...config, armado: false }); registrar(compra, { situacao: 'parado', motivo: textoParada(motivo) }); }
  status.textContent = textoParada(motivo);
}
async function rodada() {
  if (enviando) return;
  let compra = null;
  try {
    const s = await sala(); compra = s.compra;
    const config = ler(chaveConfig(compra));
    if (!config?.armado) return parar(compra, 'parado');
    const leitura = await executar(s.aba.id, lerSala);
    const r = escolherLance(config, leitura, eventos(compra), Date.now());
    if (r.parada) return parar(compra, r.parada);
    const linhas = (r.itens || []).map(i => `Item ${i.item}: ${i.motivo}.`);
    const box = $('lanceSugestao');
    if (!r.sugestao) { sugestao = null; box.hidden = true; status.textContent = linhas.join('\n') || 'Nada a fazer agora.'; return; }
    const nova = !sugestao || sugestao.item !== r.sugestao.item || sugestao.valor !== r.sugestao.valor;
    sugestao = { ...r.sugestao, compra, tabId: s.aba.id };
    $('lancePergunta').textContent = `Dar lance de ${reais(sugestao.valor)} no item ${sugestao.item}? (melhor agora ${sugestao.melhorLido}; seu ${sugestao.meuLido}; piso ${reais(sugestao.piso)})`;
    $('lanceSim').textContent = r.espera ? `Aguarde ${Math.ceil(r.espera / 1000)} s (intervalo mínimo de 20 s)` : `Sim, dar lance de ${reais(sugestao.valor)}`;
    $('lanceSim').disabled = Boolean(r.espera);
    box.hidden = false;
    status.textContent = linhas.join('\n');
    if (nova && !r.espera) registrar(compra, { situacao: 'sugerido', item: sugestao.item, valor: sugestao.valor, piso: sugestao.piso, motivo: `melhor ${sugestao.melhorLido}` });
  } catch (e) { parar(compra, 'sem_leitura'); status.textContent = e?.message || textoParada('sem_leitura'); }
}
function rodar() { globalThis.clearInterval(timer); timer = globalThis.setInterval(rodada, 3000); rodada(); }

$('lanceSim').addEventListener('click', () => {
  const s = sugestao;
  if (!s || enviando) return;
  enviando = true; $('lanceSim').disabled = true; // um clique, um lance
  (async () => {
    const config = ler(chaveConfig(s.compra));
    // Confere de novo com a sala de agora antes de enviar (o popup pode ter ficado parado).
    const r = escolherLance(config, await executar(s.tabId, lerSala), eventos(s.compra), Date.now());
    if (r.parada) { enviando = false; return parar(s.compra, r.parada); }
    if (!r.sugestao || r.espera || r.sugestao.item !== s.item || r.sugestao.valor !== s.valor) { registrar(s.compra, { situacao: 'não enviado', item: s.item, valor: s.valor, motivo: 'a sala mudou; veja a nova sugestão' }); return; }
    const res = await executar(s.tabId, enviarLanceNaSala, [{ item: s.item, valor: campo4(s.valor), piso: campo4(s.piso), melhorLido: s.melhorLido, meuLido: s.meuLido }]) || { situacao: 'incerto' };
    const motivo = res.situacao === 'bloqueado' ? { sala_mudou: 'a sala mudou; veja a nova sugestão', piso: 'abaixo do piso', nao_melhora: 'não melhora seu lance', sem_campo: 'campo de lance indisponível', mascara: `o portal mostrou "${res.campo}" no campo`, captcha: 'captcha na tela', sessao_expirada: 'sessão expirada', item_sumiu: 'item não está na tela' }[res.motivo] : res.mensagem;
    registrar(s.compra, { situacao: res.situacao, item: s.item, valor: s.valor, piso: s.piso, motivo: motivo || (res.situacao === 'incerto' ? 'o portal não confirmou em 5 s: confira na sala' : `melhor ${s.melhorLido}; confirmado por você`) });
    if (res.situacao === 'enviado') avisoExcluir(s);
    else if (res.situacao === 'incerto') parar(s.compra, 'parado');
    else status.textContent = `Lance não enviado: ${motivo || res.situacao}.`;
  })().catch(falha).finally(() => { enviando = false; sugestao = null; if (timer) rodada(); });
});
$('lanceNao').addEventListener('click', () => { if (sugestao) registrar(sugestao.compra, { situacao: 'recusado por você', item: sugestao.item, valor: sugestao.valor }); sugestao = null; $('lanceSugestao').hidden = true; });

function avisoExcluir(s) {
  const fim = Date.now() + JANELA_EXCLUIR_MS, aviso = $('lanceAviso');
  globalThis.clearInterval(avisoTimer);
  const mostrar = () => {
    const resta = Math.ceil((fim - Date.now()) / 1000);
    if (resta <= 0) { globalThis.clearInterval(avisoTimer); aviso.hidden = true; return; }
    aviso.hidden = false;
    aviso.textContent = `Lance de ${reais(s.valor)} enviado no item ${s.item}. Lance errado? Você pode excluir o seu último lance UMA vez, em até 15 s, no botão do portal (IN 73, art. 21, §3º). Restam ${resta} s.`;
  };
  mostrar(); avisoTimer = globalThis.setInterval(mostrar, 500);
}

$('lanceParar').addEventListener('click', () => { sala().then(({ compra }) => parar(compra, 'parado')).catch(() => parar(null, 'parado')); });

function falha(e) { status.textContent = e?.message || 'Falha. Nenhum lance foi enviado.'; }

// Ao abrir o popup na sala: mostra configuração e registro; se estava ligado, volta a ler a sala.
sala().then(({ compra }) => {
  const config = ler(chaveConfig(compra));
  mostrarRegistro(compra);
  if (config?.itens && Object.keys(config.itens).length) desenharConfig(config);
  if (config?.armado) rodar();
}).catch(() => {});
