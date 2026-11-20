// Regras de dinheiro do "lance com 1 clique" (etapa 2) e do piso no robô do próprio Compras.gov (etapa 1).
// Puro: sem DOM, sem rede, sem relógio próprio (agora vem de quem chama). Valores em BigInt com 4 casas
// (10,5 -> 105000n): nada de float. Quem envia é a pessoa, clicando no botão de confirmação da extensão;
// aqui só se decide SE há lance possível e qual. Nunca abaixo do piso.
// Fontes: _historico/lance-automatico-20261120.md (IN SEGES 73/2022 arts. 19 e 21; Decreto 10.024 art. 30;
// 20 s entre lances do mesmo licitante: IN SLTI 3/2011-2013, mantidos como piso conservador).

export const INTERVALO_PROPRIO_MS = 20000;
export const JANELA_EXCLUIR_MS = 15000; // IN 73 art. 21 §3º: excluir o próprio último lance uma vez, em até 15 s

// "10,5", "10.5", "R$ 1.234,5600" -> 4 casas inteiras; inválido, zero ou negativo -> null.
export function valor4(texto) {
  let s = String(texto ?? '').replace(/R\$|\s/g, '');
  if (!/^\d[\d.]*,\d{1,4}$|^\d+(\.\d{1,4})?$|^\d+$/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const [i, f = ''] = s.split('.');
  const n = BigInt(i + f.padEnd(4, '0'));
  return n > 0n ? n : null;
}
export const reais = n => `R$ ${String(n / 10000n).replace(/\B(?=(\d{3})+$)/g, '.')},${String(n % 10000n).padStart(4, '0')}`;
// Formato que o campo do portal recebe (mesmo do preencher proposta): vírgula, 4 casas, sem milhar.
export const campo4 = n => `${n / 10000n},${String(n % 10000n).padStart(4, '0')}`;

// Configuração de um item, digitada e confirmada pela pessoa. Piso vem do LicitaPlena (valor mínimo do item).
export function validarConfigItem({ piso, decremento, diferencaMinima, maxLances }) {
  const erros = [];
  const p = valor4(piso), d = valor4(decremento), dif = diferencaMinima ? valor4(diferencaMinima) : 0n;
  if (p === null) erros.push('piso ausente: cadastre o valor mínimo do item no LicitaPlena');
  if (d === null) erros.push('valor de cada redução precisa ser maior que zero');
  if (dif === null) erros.push('diferença mínima do edital inválida');
  const max = Number(maxLances);
  if (!Number.isInteger(max) || max < 1 || max > 50) erros.push('máximo de lances: número inteiro de 1 a 50');
  return erros.length ? { ok: false, erros } : { ok: true, item: { piso: p, decremento: d, diferencaMinima: dif, maxLances: max } };
}

// Por que parar tudo agora (o que exige decisão humana). Leitura vem de lerSala (sala-disputa.mjs).
const PARADAS = {
  sem_leitura: 'Não reconheço a sala de disputa nesta aba.',
  captcha: 'Apareceu uma verificação (captcha). Resolva você mesmo; parei os lances.',
  sessao_expirada: 'A sessão do portal expirou. Entre de novo; parei os lances.',
  suspensa: 'A sessão ou o item está suspenso. Parei os lances.',
  desempate: 'Fase de desempate / preferência ME-EPP: lance só manual. Parei os lances.',
  mensagem_pregoeiro: 'O pregoeiro escreveu no chat. Leia a mensagem; para continuar, ligue de novo.',
  anticonluio: 'Sua conta tem mais de uma empresa (CNPJ) neste pregão. Lance pelo LicitaPlena bloqueado: duas empresas da mesma conta disputando o mesmo pregão pode ser conluio (Código Penal, art. 337-F).',
  parado: 'Lances parados por você. Para continuar, confirme a configuração e ligue de novo.',
};
export const textoParada = m => PARADAS[m] || 'Parei os lances.';
export function motivoParada(leitura, { mensagensBase = 0, empresasNaCompra = 1, armado = false } = {}) {
  if (!armado) return 'parado';
  if (empresasNaCompra > 1) return 'anticonluio';
  if (!leitura?.ok) return leitura?.motivo === 'captcha' || leitura?.motivo === 'sessao_expirada' ? leitura.motivo : 'sem_leitura';
  for (const m of ['captcha', 'sessao_expirada', 'suspensa', 'desempate']) if (leitura.alertas?.includes(m)) return m;
  if (leitura.mensagens > mensagensBase) return 'mensagem_pregoeiro';
  return null;
}

// Próximo lance de UM item. Devolve { ok: true, valor } ou { ok: false, motivo, esperaMs? }.
//   cfg: { piso, decremento, diferencaMinima, maxLances } (BigInt, de validarConfigItem)
//   sala: { etapa, melhor, meu, situacao, diferencaMinima? } (melhor/meu já em BigInt 4 casas)
//   historico: { lancesEnviados, ultimoEnvioEm } (registro local; ultimoEnvioEm vale para a compra toda)
export function proximoLance(cfg, sala, { lancesEnviados = 0, ultimoEnvioEm = null } = {}, agora) {
  if (sala.etapa === 'fechada') return { ok: false, motivo: 'fase_fechada' }; // lance fechado é sempre manual
  if (sala.etapa !== 'aberta' && sala.etapa !== 'aleatoria') return { ok: false, motivo: 'item_fora_da_disputa' };
  if (typeof sala.melhor !== 'bigint' || typeof sala.meu !== 'bigint') return { ok: false, motivo: 'valor_ilegivel' };
  // "Melhor valor" da sala pode ser o seu; lance igual não vale (fica o 1º registrado), então meu <= melhor = líder.
  if (sala.situacao === 'ganhando' || sala.meu <= sala.melhor) return { ok: false, motivo: 'ja_lider' };
  if (lancesEnviados >= cfg.maxLances) return { ok: false, motivo: 'maximo_lances' };
  // O edital manda: a diferença mínima lida na sala vale se for maior que a digitada.
  const dif = [cfg.diferencaMinima, sala.diferencaMinima].filter(v => typeof v === 'bigint').reduce((a, b) => (b > a ? b : a), 0n);
  const reducao = cfg.decremento > dif ? cfg.decremento : dif;
  let valor = sala.melhor - reducao;
  if (valor < cfg.piso) valor = cfg.piso; // cobrir passaria do piso: o máximo que se oferece é o próprio piso
  // Portal recusa: igual ao melhor (Decreto 10.024 art. 30), sem cobrir o melhor pela diferença mínima, sem melhorar o próprio.
  const passo = dif > 0n ? dif : 1n;
  if (sala.melhor - valor < passo || sala.meu - valor < passo) return { ok: false, motivo: 'piso' };
  if (valor < cfg.piso) return { ok: false, motivo: 'piso' }; // trava final, redundante de propósito
  if (ultimoEnvioEm !== null && agora - ultimoEnvioEm < INTERVALO_PROPRIO_MS) {
    return { ok: false, motivo: 'intervalo', esperaMs: INTERVALO_PROPRIO_MS - (agora - ultimoEnvioEm), valor };
  }
  return { ok: true, valor };
}

const MOTIVOS = {
  fase_fechada: 'fase fechada: o lance fechado é só manual',
  item_fora_da_disputa: 'item fora da disputa aberta',
  valor_ilegivel: 'não consegui ler o melhor valor ou o seu valor',
  ja_lider: 'você está em 1º',
  maximo_lances: 'chegou ao máximo de lances que você definiu',
  piso: 'cobrir o melhor lance passaria do seu piso',
  intervalo: 'esperando o intervalo mínimo de 20 s entre seus lances',
};
export const textoMotivo = m => MOTIVOS[m] || m;

// Uma rodada: com a configuração confirmada (strings, como guardada no popup) e a leitura da sala, devolve
// { parada } (para tudo), ou { sugestao: {item, valor, piso, melhorLido, meuLido}, espera?, itens } ou { itens } sem lance.
// Uma sugestão por vez: o 1º item da sala que tem lance possível.
export function escolherLance(config, leitura, eventos, agora) {
  const parada = motivoParada(leitura, config || {});
  if (parada) return { parada };
  const itens = [];
  for (const s of leitura.itens) {
    const c = config.itens?.[s.itemId];
    if (!c) continue;
    const v = validarConfigItem(c);
    if (!v.ok) { itens.push({ item: s.itemId, motivo: v.erros[0] }); continue; }
    const r = proximoLance(v.item, { etapa: s.etapa, situacao: s.situacao, melhor: valor4(s.melhorValor), meu: valor4(s.meuValor), diferencaMinima: valor4(s.diferencaMinima) }, historicoDe(eventos, s.itemId), agora);
    if (r.ok || r.motivo === 'intervalo') {
      const sugestao = { item: s.itemId, valor: r.valor, piso: v.item.piso, melhorLido: s.melhorValor, meuLido: s.meuValor };
      return r.ok ? { sugestao, itens } : { sugestao, espera: r.esperaMs, itens };
    }
    itens.push({ item: s.itemId, motivo: textoMotivo(r.motivo) });
  }
  return { itens };
}

// Histórico do registro local, por compra: quantos lances enviados por item e quando foi o último envio (qualquer item).
// "incerto" (portal não confirmou) conta como enviado: na dúvida, espera os 20 s e gasta um do máximo.
export function historicoDe(eventos, item) {
  const enviados = (eventos || []).filter(e => e.situacao === 'enviado' || e.situacao === 'incerto');
  const ultimo = enviados.reduce((m, e) => Math.max(m, e.emMs || 0), 0);
  return { lancesEnviados: enviados.filter(e => e.item === item).length, ultimoEnvioEm: ultimo || null };
}
