/* global module, require */
// Robô de lances, modo ASSISTIDO: regras de tempo/valor da sala e simulador acelerado da disputa.
// Nada aqui envia lance nem lê o portal. A decisão de cada lance vem do cérebro (motor-lances.js, createMotor);
// este arquivo só decide QUANDO perguntar ao cérebro e simula concorrentes para treino antes da sessão.
// A estratégia "ficar até 10% do 1º" do aberto e fechado (ideia vista no Siga Pregão, _historico/siga-pregao-canal-analise-20261119.md
// seção 3) é regra própria (alvoDentroDe10): o cérebro só sabe cobrir o melhor lance.
// Fontes das regras: _historico/robo-lances-20261120.md (IN SEGES/ME 73/2022 arts. 21-25, Decreto 10.024/2019 arts. 30-33).
// Dinheiro sempre BigInt (centavos, ou décimo de milésimo com 4 casas); nada de float.
(function (global) {
  'use strict';
  const motorApi = () => global.LicitaMotorLances || (typeof module !== 'undefined' && module.exports ? require('./motor-lances.js') : null);

  // 20 s entre lances do mesmo fornecedor e 3 s depois do melhor lance de outro: IN SLTI 3/2011 com a IN 3/2013.
  // A IN 73/2022 não fixa segundos (só diferença em R$/%); usamos como piso conservador até ver a sala real.
  const REGRAS = Object.freeze({ intervaloProprioMs: 20000, intervaloMelhorMs: 3000, intervaloMaxMs: 600000 });
  const MIN = 60000;
  const TEMPOS = Object.freeze({ aberto: 10 * MIN, prorrogacao: 2 * MIN, abertoFechado: 15 * MIN, aleatorioMax: 10 * MIN, fechado: 5 * MIN, teto: 4 * 60 * MIN });
  const MODOS = Object.freeze({ aberto: 'Aberto', aberto_fechado: 'Aberto e fechado', fechado_aberto: 'Fechado e aberto' });
  const ESTRATEGIAS = Object.freeze({ dentro10: 'Ficar até 10% do 1º', cobrir: 'Cobrir o melhor lance' });
  // "Segundos finais": sem marcar "não aguardar", o robô só sugere quando faltam até 30 s para acabar a etapa.
  const JANELA_FINAL_MS = 30000;
  // Contexto fictício exigido pelo cérebro no modo 'simulado' (CNPJ de exemplo válido, compra zerada).
  const SIM = Object.freeze({ cnpj: '12345678000195', compra: '00000000000000000', fonte: 'simulador-licitaplena' });

  // Unidade do valor: 2 casas = centavos; 4 casas ("Permitir lances com 4 casas decimais") = décimos de milésimo de real.
  // Todo o resto (simulação, regras da sala) só compara BigInt e não depende da unidade.
  const unidade = (casas = 2) => (casas === 4 ? 10000n : 100n);
  // "12,34", "12.34", "1.234,56" → BigInt positivo na unidade de `casas`; inválido → null.
  function valorDe(texto, casas = 2) {
    let t = String(texto ?? '').trim().replace(/^R\$\s*/, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '');
    t = t.replace(',', '.');
    if (!new RegExp(`^(0|[1-9]\\d{0,12})(\\.\\d{1,${casas === 4 ? 4 : 2}})?$`).test(t)) return null;
    const [i, f = ''] = t.split('.');
    const n = BigInt(i + f.padEnd(casas === 4 ? 4 : 2, '0'));
    return n > 0n ? n : null;
  }
  const centavosDe = (texto) => valorDe(texto, 2);
  function reais(c, casas = 2) {
    const u = unidade(casas), sinal = c < 0n ? '-' : '', a = c < 0n ? -c : c;
    return `${sinal}R$ ${String(a / u).replace(/\B(?=(\d{3})+$)/g, '.')},${String(a % u).padStart(casas === 4 ? 4 : 2, '0')}`;
  }
  // O cérebro (motor-lances.js) sempre fala em 4 casas com ponto.
  const quatroCasas = (c, casas = 2) => (casas === 4 ? `${c / 10000n}.${String(c % 10000n).padStart(4, '0')}` : `${c / 100n}.${String(c % 100n).padStart(2, '0')}00`);
  const deQuatroCasas = (s, casas = 2) => (casas === 4 ? BigInt(s.replace('.', '')) : BigInt(s.replace('.', '')) / 100n);

  // Decremento por lance ("valor de cada redução"). % vale sobre a referência (proposta inicial) e é arredondado para cima.
  // Nunca fica abaixo da diferença mínima do edital: o portal recusaria o lance (IN 73 art. 21 §2º).
  // O campo de saída chama `centavos` por compatibilidade; com 4 casas o valor está em décimos de milésimo.
  // shortcut: % fixado sobre a referência, não recalculado a cada lance; recalcular exige política nova no cérebro.
  function decremento({ tipo, valor, referencia, diferencaMinima = null, casas = 2 }) {
    let c;
    if (tipo === 'percentual') {
      const t = String(valor ?? '').trim().replace(',', '.');
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return { ok: false, erro: 'Percentual: número de 0,01 a 50, com até 2 casas. Ex.: 0,5' };
      const [i, f = ''] = t.split('.'); const bp = BigInt(i + f.padEnd(2, '0'));
      if (bp <= 0n || bp > 5000n) return { ok: false, erro: 'Percentual: número de 0,01 a 50, com até 2 casas. Ex.: 0,5' };
      if (typeof referencia !== 'bigint' || referencia <= 0n) return { ok: false, erro: 'Sem proposta inicial para calcular o percentual. Use decremento em R$.' };
      c = (referencia * bp + 9999n) / 10000n;
    } else {
      c = valorDe(valor, casas);
      if (c === null) return { ok: false, erro: `Valor de cada redução: reais maior que zero, até ${casas === 4 ? 4 : 2} casas. Ex.: 0,50` };
    }
    if (typeof diferencaMinima === 'bigint' && c < diferencaMinima) return { ok: true, centavos: diferencaMinima, aviso: `Ajustado para a diferença mínima do edital (${reais(diferencaMinima, casas)}): não pode ser menor.` };
    return { ok: true, centavos: c, aviso: '' };
  }
  // Segundos digitados → ms, nunca abaixo de 20 s nem acima de 10 min.
  function intervaloMs(segundos) {
    const n = Number(String(segundos ?? '').trim());
    if (!Number.isInteger(n)) return REGRAS.intervaloProprioMs;
    return Math.min(Math.max(n * 1000, REGRAS.intervaloProprioMs), REGRAS.intervaloMaxMs);
  }
  // Pode lançar agora? Mesmo fornecedor: intervalo próprio; melhor lance de outro: 3 s.
  function podeLancar(agora, { ultimoProprioEm = null, melhorOutroEm = null } = {}, intervalo = REGRAS.intervaloProprioMs) {
    const espera = Math.max(ultimoProprioEm === null ? 0 : ultimoProprioEm + Math.max(intervalo, REGRAS.intervaloProprioMs) - agora,
      melhorOutroEm === null ? 0 : melhorOutroEm + REGRAS.intervaloMelhorMs - agora, 0);
    return espera === 0 ? { ok: true, esperaMs: 0 } : { ok: false, esperaMs: espera, motivo: ultimoProprioEm !== null && ultimoProprioEm + intervalo > agora ? 'intervalo_proprio' : 'intervalo_melhor' };
  }

  // Regras do portal para aceitar um lance (o que a sala recusaria, a simulação também recusa).
  function aceitaLance({ valor, ultimoProprio, melhor, diferencaMinima = null }) {
    if (ultimoProprio !== null && valor >= ultimoProprio) return { ok: false, motivo: 'nao_melhora_proprio' };
    if (melhor !== null && valor === melhor) return { ok: false, motivo: 'igual_ao_melhor' }; // Decreto 10.024 art. 30 §4º
    const dif = typeof diferencaMinima === 'bigint' ? diferencaMinima : 0n;
    if (dif > 0n && ultimoProprio !== null && ultimoProprio - valor < dif) return { ok: false, motivo: 'diferenca_minima' };
    if (dif > 0n && melhor !== null && valor < melhor && melhor - valor < dif) return { ok: false, motivo: 'diferenca_minima' };
    return { ok: true };
  }

  // Selo do item na tela: compara o seu lance com o melhor lance de OUTRO fornecedor (o que a pessoa lê no portal).
  function situacaoLance({ meu, melhorOutro }) {
    if (typeof meu !== 'bigint' || typeof melhorOutro !== 'bigint') return null;
    return meu < melhorOutro ? 'ganhando' : meu === melhorOutro ? 'empate' : 'perdendo';
  }

  // Estratégia do aberto e fechado: na fase aleatória, ficar até 10% do 1º colocado (são chamados ao lance fechado o 1º
  // e quem estiver até 10% acima; IN 73 art. 24) sem buscar o 1º lugar, e guardar o melhor preço para o lance fechado.
  // Devolve o MAIOR lance que ainda entra na faixa (o que menos sacrifica a margem), nunca abaixo do piso.
  function alvoDentroDe10({ melhor, meu, piso, diferencaMinima = null }) {
    const corte = (melhor * 110n) / 100n;
    if (meu <= corte) return { ok: false, motivo: 'ja_dentro', corte };
    const dif = typeof diferencaMinima === 'bigint' && diferencaMinima > 0n ? diferencaMinima : 1n;
    let alvo = corte;
    if (meu - alvo < dif) alvo = meu - dif;
    if (alvo === melhor) alvo -= dif; // o portal não aceita lance igual ao melhor
    if (alvo < piso) return { ok: false, motivo: 'piso', corte };
    return { ok: true, valor: alvo, corte };
  }

  // Cérebro (motor-lances.js) numa decisão avulsa: mesma regra do simulador (cobre o melhor, para no piso, não baixa se lidera).
  function decidirCobrir({ melhor, meu, piso, decremento: dec, lider, casas = 2, agora = 1793577600000 }) {
    const motor = motorApi().createMotor({ id: 'tela', version: 1, cnpj: SIM.cnpj, purchaseId: SIM.compra, itemId: 'item', criterion: 'menor_preco_unitario',
      mode: 'simulado', floor: quatroCasas(piso, casas), decrement: quatroCasas(dec, casas) }, { source: SIM.fonte, maxSnapshotAgeMs: 1000 });
    motor.authorize({ id: 'tela-auth', policyKey: motor.policyKey, notBefore: agora, expiresAt: agora + 1000 }, agora);
    const d = motor.decide({ cnpj: SIM.cnpj, purchaseId: SIM.compra, itemId: 'item', criterion: 'menor_preco_unitario', mode: 'simulado', source: SIM.fonte,
      observedAt: agora, observationId: 'o1', session: 'ativa', itemState: 'aberto', leading: lider, bestPrice: quatroCasas(melhor, casas), ownPrice: quatroCasas(meu, casas) }, agora);
    return d.status === 'candidata' ? { ok: true, valor: deQuatroCasas(d.price, casas) } : { ok: false, motivo: d.reason };
  }

  // Sugestão para o item "Em disputa" com o que a pessoa leu no portal (melhor lance de outro e o seu). Só sugere; não envia.
  function sugestaoAoVivo({ modo, estrategia = 'cobrir', meu, melhorOutro, piso, decremento: dec, diferencaMinima = null, casas = 2 }) {
    const selo = situacaoLance({ meu, melhorOutro });
    if (!selo) return { selo, valor: null, texto: 'Informe o melhor lance de outro fornecedor e o seu lance, como aparecem no portal.' };
    const fmt = (v) => reais(v, casas);
    if (modo === 'aberto_fechado' && estrategia === 'dentro10') {
      const melhor = meu < melhorOutro ? meu : melhorOutro;
      const a = alvoDentroDe10({ melhor, meu, piso, diferencaMinima });
      if (a.ok) return { selo, valor: a.valor, texto: `Sugestão: lance de ${fmt(a.valor)} para ficar até 10% do 1º (limite ${fmt(a.corte)}). Guarde seu melhor preço para o lance fechado.` };
      return { selo, valor: null, texto: a.motivo === 'ja_dentro'
        ? `Você está até 10% do 1º (limite ${fmt(a.corte)}): não precisa baixar agora. No fim, dê o lance fechado (até o piso ${fmt(piso)}).`
        : `Ficar até 10% do 1º passaria do seu piso (${fmt(piso)}). Se estiver entre os 3 melhores, ainda vai ao lance fechado.` };
    }
    if (selo === 'ganhando') return { selo, valor: null, texto: 'Você está em 1º: não baixe o próprio preço.' };
    const d = decidirCobrir({ melhor: melhorOutro, meu, piso, decremento: dec, lider: false, casas });
    if (d.ok) {
      const regra = aceitaLance({ valor: d.valor, ultimoProprio: meu, melhor: melhorOutro, diferencaMinima });
      if (regra.ok) return { selo, valor: d.valor, texto: `Sugestão: lance de ${fmt(d.valor)} (melhor de outro ${fmt(melhorOutro)} menos ${fmt(dec)}). Quem envia é você, no portal.` };
      return { selo, valor: null, texto: 'O portal recusaria: a redução fica abaixo da diferença mínima do edital.' };
    }
    return { selo, valor: null, texto: d.motivo === 'piso' ? `Cobrir o melhor lance passaria do seu piso (${fmt(piso)}): pare aqui.` : 'Sem lance possível abaixo do seu último lance.' };
  }

  // Gerador determinístico (mulberry32): mesma semente, mesma disputa — dá para repetir e comparar.
  function aleatorio(semente) {
    let a = (Number(semente) >>> 0) || 1;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const porcento = (c, p) => (c * BigInt(Math.round(p * 100)) + 5000n) / 10000n;
  // Concorrentes fictícios em torno do seu piso: alguns conseguem ir abaixo dele, outros não.
  function gerarConcorrentes({ semente, quantidade = 3, referencia, piso }) {
    const r = aleatorio(semente), lista = [];
    for (let k = 0; k < quantidade; k++) {
      const inicial = porcento(referencia, 100 + 5 + r() * 20);
      const pisoC = porcento(piso, 88 + r() * 22);
      lista.push({ nome: `Concorrente ${k + 1}`, inicial, piso: pisoC < inicial ? pisoC : inicial, decremento: porcento(referencia, 0.3 + r() * 1.2) || 1n, reacaoMs: 20000 + Math.floor(r() * 40) * 1000 });
    }
    return lista;
  }

  // Simula a disputa de UM item em tempo acelerado (passo de 1 s). O usuário simulado aceita cada sugestão
  // depois de reacaoUsuarioMs: é o "clique" que no modo assistido real a pessoa dá no portal.
  function simular({ itemId = 'item', modo = 'aberto', piso, inicial, decremento: dec, intervalo = REGRAS.intervaloProprioMs, diferencaMinima = null,
    concorrentes, semente = 1, reacaoUsuarioMs = 4000, casas = 2, aguardarFinal = false, estrategia = 'cobrir' }) {
    if (!MODOS[modo]) throw new TypeError('Modo de disputa inválido');
    if (!ESTRATEGIAS[estrategia]) throw new TypeError('Estratégia inválida');
    const fmt = (v) => reais(v, casas);
    // "Ficar até 10%" só existe no aberto e fechado; nos outros modos a estratégia é sempre cobrir o melhor.
    const dentro10 = modo === 'aberto_fechado' && estrategia === 'dentro10';
    // "Aguardar os segundos finais" (padrão da tela): no aberto o fim é conhecido e cada lance nos 2 min finais prorroga.
    // No aberto e fechado o fim é aleatório: esperar não faz sentido e a opção é ignorada.
    const esperarFim = aguardarFinal && modo !== 'aberto_fechado';
    for (const v of [piso, inicial, dec]) if (typeof v !== 'bigint' || v <= 0n) throw new TypeError('Piso, proposta e decremento precisam ser centavos positivos');
    if (piso > inicial) throw new TypeError('Piso acima da proposta inicial');
    const r = aleatorio(semente ^ 0x5bd1e995);
    const BASE = 1793577600000; // relógio fictício e fixo: a simulação não depende da hora do computador
    const log = [];
    const anotar = (t, tipo, texto, valor = null) => { if (log.length < 600) log.push({ t, tipo, texto, valor }); };
    const participantes = [{ id: 'voce', nome: 'Você', inicial, piso, decremento: dec, reacaoMs: intervalo, robo: true },
      ...concorrentes.map((c, k) => ({ id: `c${k + 1}`, ...c, robo: false }))].map((p) => ({ ...p, ultimo: p.inicial, ultimoEm: null }));
    const voce = participantes[0];
    let melhor = null, lider = null, melhorEm = null;
    const atualizarMelhor = () => {
      // Empate de valor: vale quem registrou primeiro (o portal não aceita lance igual).
      const ordem = participantes.filter((p) => p.ativo !== false).sort((a, b) => (a.ultimo < b.ultimo ? -1 : a.ultimo > b.ultimo ? 1 : (a.ultimoEm ?? -1) - (b.ultimoEm ?? -1)));
      melhor = ordem[0].ultimo; lider = ordem[0].id;
    };

    // Fechado e aberto: só vão à etapa aberta a melhor proposta e as até 10% acima (mínimo de 3). IN 73 art. 25.
    if (modo === 'fechado_aberto') {
      const ordem = [...participantes].sort((a, b) => (a.inicial < b.inicial ? -1 : a.inicial > b.inicial ? 1 : 0));
      const corte = porcento(ordem[0].inicial, 110);
      ordem.forEach((p, k) => { p.ativo = p.inicial <= corte || k < 3; });
      anotar(0, 'fase', `Propostas fechadas abertas. Na disputa aberta: ${ordem.filter((p) => p.ativo).map((p) => p.nome).join(', ')}.`);
      if (!voce.ativo) {
        anotar(0, 'fim', 'Sua proposta ficou fora da etapa aberta (mais de 10% acima da melhor e fora das 3 melhores).');
        return { log, resultado: { vencedor: ordem[0].nome, voceVenceu: false, melhor: ordem[0].inicial, seu: voce.inicial, posicao: ordem.indexOf(voce) + 1, fimMs: 0, prorrogacoes: 0, sugestoes: 0 } };
      }
    }
    atualizarMelhor();

    const M = motorApi();
    const motor = M.createMotor({ id: 'sim', version: 1, cnpj: SIM.cnpj, purchaseId: SIM.compra, itemId: /^[A-Za-z0-9_-]{1,80}$/.test(itemId) ? itemId : 'item',
      criterion: 'menor_preco_unitario', mode: 'simulado', floor: quatroCasas(piso, casas), decrement: quatroCasas(dec, casas) }, { source: SIM.fonte, maxSnapshotAgeMs: 1000 });
    motor.authorize({ id: 'sim-auth', policyKey: motor.policyKey, notBefore: BASE, expiresAt: BASE + TEMPOS.teto + 1000 }, BASE);

    let fim = modo === 'aberto_fechado' ? TEMPOS.abertoFechado : TEMPOS.aberto;
    const aleatorioMs = modo === 'aberto_fechado' ? Math.floor(r() * (TEMPOS.aleatorioMax / 1000)) * 1000 : 0;
    let avisoAleatorio = false, prorrogacoes = 0, sugestoes = 0, pendente = null, ultimoMotivo = null, obs = 0;
    anotar(0, 'fase', `Etapa aberta (${MODOS[modo]}): ${fim / MIN} min${modo === 'aberto_fechado' ? ' + tempo aleatório de até 10 min' : ', prorroga 2 min a cada lance nos 2 minutos finais'}.`);
    const registrar = (p, valor, t) => {
      const ok = aceitaLance({ valor, ultimoProprio: p.ultimo, melhor, diferencaMinima });
      if (!ok.ok) return ok;
      p.ultimo = valor; p.ultimoEm = t;
      const cobriu = valor < melhor;
      if (cobriu) { melhorEm = t; }
      atualizarMelhor();
      // Prorrogação só no modo aberto (e na etapa aberta do fechado e aberto). IN 73 art. 23.
      if (modo !== 'aberto_fechado' && fim - t <= TEMPOS.prorrogacao) { fim = t + TEMPOS.prorrogacao; prorrogacoes++; anotar(t, 'prorrogacao', 'Lance nos 2 minutos finais: etapa prorrogada por 2 min.'); }
      return { ok: true };
    };

    for (let t = 1000; t < TEMPOS.teto; t += 1000) {
      if (modo === 'aberto_fechado' && !avisoAleatorio && t >= fim) { avisoAleatorio = true; fim += aleatorioMs; anotar(t, 'fase', 'Aviso de fechamento iminente: a etapa aberta acaba a qualquer momento (até 10 min).'); }
      if (t >= fim) break;
      // Concorrentes: cobrem o melhor lance quando podem, até o piso deles.
      for (const p of participantes.slice(1)) {
        if (p.ativo === false || lider === p.id) continue;
        if (!podeLancar(t, { ultimoProprioEm: p.ultimoEm, melhorOutroEm: melhorEm }, p.reacaoMs).ok) continue;
        const valor = melhor - p.decremento;
        if (valor < p.piso) continue;
        if (registrar(p, valor, t).ok) anotar(t, 'concorrente', `${p.nome} deu lance.`, valor);
      }
      // Você: sugestão pendente vira lance quando o usuário simulado "clica".
      if (pendente && t >= pendente.t + reacaoUsuarioMs) {
        const valor = pendente.valor;
        const res = registrar(voce, valor, t);
        if (pendente.decisionId) motor.resolve({ decisionId: pendente.decisionId, outcome: res.ok ? 'aplicado' : 'rejeitado', price: pendente.price }, BASE + t);
        anotar(t, res.ok ? 'aceito' : 'recusado', res.ok ? 'Você confirmou a sugestão no portal (simulado).' : `O portal recusaria: ${res.motivo === 'diferenca_minima' ? 'diferença mínima do edital' : 'outro lance chegou antes'}.`, valor);
        pendente = null;
        continue;
      }
      if (pendente) continue;
      if (esperarFim && fim - t > JANELA_FINAL_MS) continue;
      if (dentro10 && !avisoAleatorio) {
        if (ultimoMotivo !== 'fase_inicial') { ultimoMotivo = 'fase_inicial'; anotar(t, 'bloqueado', 'Fase aberta inicial: o robô não dá lance (estratégia "ficar até 10% do 1º").'); }
        continue;
      }
      const janela = podeLancar(t, { ultimoProprioEm: voce.ultimoEm, melhorOutroEm: lider === 'voce' ? null : melhorEm }, intervalo);
      if (!janela.ok) continue;
      if (dentro10) {
        // Entre os 3 melhores também vai ao lance fechado: não precisa baixar.
        const posicao = participantes.filter((p) => p.ultimo < voce.ultimo).length + 1;
        const a = posicao <= 3 ? { ok: false, motivo: 'ja_dentro' } : alvoDentroDe10({ melhor, meu: voce.ultimo, piso, diferencaMinima });
        if (a.ok) {
          sugestoes++; ultimoMotivo = null;
          pendente = { t, decisionId: null, valor: a.valor };
          anotar(t, 'sugestao', `Robô sugere ${fmt(a.valor)} para ficar até 10% do 1º (melhor atual ${fmt(melhor)}); o melhor preço fica para o lance fechado.`, a.valor);
        } else if (a.motivo !== ultimoMotivo) {
          ultimoMotivo = a.motivo;
          anotar(t, 'bloqueado', a.motivo === 'ja_dentro' ? 'Você está até 10% do 1º ou entre os 3 melhores: o robô não baixa e guarda o preço para o lance fechado.'
            : `Ficar até 10% do 1º passaria do seu piso (${fmt(piso)}).`);
        }
        continue;
      }
      obs++;
      const d = motor.decide({ cnpj: SIM.cnpj, purchaseId: SIM.compra, itemId: /^[A-Za-z0-9_-]{1,80}$/.test(itemId) ? itemId : 'item', criterion: 'menor_preco_unitario', mode: 'simulado',
        source: SIM.fonte, observedAt: BASE + t, observationId: `o${obs}`, session: 'ativa', itemState: 'aberto', leading: lider === 'voce',
        bestPrice: quatroCasas(melhor, casas), ownPrice: quatroCasas(voce.ultimo, casas) }, BASE + t);
      if (d.status === 'candidata') {
        sugestoes++; ultimoMotivo = null;
        pendente = { t, decisionId: d.decisionId, price: d.price, valor: deQuatroCasas(d.price, casas) };
        anotar(t, 'sugestao', `Robô sugere lance de ${fmt(pendente.valor)} (melhor atual ${fmt(melhor)}).`, pendente.valor);
      } else if (d.reason !== ultimoMotivo) {
        ultimoMotivo = d.reason;
        const textos = { ja_lider: 'Você lidera: o robô não baixa o próprio preço.', piso: `Cobrir o melhor lance passaria do seu piso (${fmt(piso)}): o robô para de sugerir.`, sem_melhoria: 'Sem lance possível abaixo do seu último lance.' };
        anotar(t, 'bloqueado', textos[d.reason] || `Sem sugestão (${d.reason}).`);
      }
    }
    const fimMs = Math.min(fim, TEMPOS.teto);
    anotar(fimMs, 'fase', 'Etapa aberta encerrada.');

    // Aberto e fechado: melhor e até 10% acima (mínimo 3) dão um lance final fechado. IN 73 art. 24.
    if (modo === 'aberto_fechado') {
      const ordem = [...participantes].sort((a, b) => (a.ultimo < b.ultimo ? -1 : a.ultimo > b.ultimo ? 1 : 0));
      const corte = porcento(ordem[0].ultimo, 110);
      const aptos = ordem.filter((p, k) => p.ultimo <= corte || k < 3);
      for (const p of aptos) {
        if (p.robo) {
          // Lance único e sigiloso: não há "cobrir"; o menor preço aceitável é o piso. Quem decide é o usuário.
          anotar(fimMs, 'sugestao', `Lance final fechado: robô sugere ${fmt(piso)} (seu piso). Você pode manter ${fmt(p.ultimo)}.`, piso);
          sugestoes++;
          if (piso < p.ultimo) p.ultimo = piso;
        } else {
          const alvoFechado = p.ultimo - porcento(p.ultimo, r() * 4);
          p.ultimo = alvoFechado < p.piso ? p.piso : alvoFechado;
        }
      }
      if (!aptos.includes(voce)) anotar(fimMs, 'bloqueado', 'Você ficou fora do lance fechado (mais de 10% acima da melhor e fora das 3 melhores).');
      anotar(fimMs + TEMPOS.fechado, 'fase', 'Lances fechados abertos.');
    }
    const ranking = participantes.filter((p) => p.ativo !== false).sort((a, b) => (a.ultimo < b.ultimo ? -1 : a.ultimo > b.ultimo ? 1 : (a.ultimoEm ?? -1) - (b.ultimoEm ?? -1)));
    const posicao = ranking.indexOf(voce) + 1;
    const resultado = { vencedor: ranking[0].nome, voceVenceu: ranking[0] === voce, melhor: ranking[0].ultimo, seu: voce.ultimo, posicao, fimMs: modo === 'aberto_fechado' ? fimMs + TEMPOS.fechado : fimMs, prorrogacoes, sugestoes };
    anotar(resultado.fimMs, 'fim', resultado.voceVenceu ? `Você ficou em 1º com ${fmt(voce.ultimo)}.` : `Você ficou em ${posicao}º com ${fmt(voce.ultimo)}; melhor: ${fmt(ranking[0].ultimo)}.`, voce.ultimo);
    return { log, resultado };
  }

  // mm:ss a partir de ms (tempo da disputa simulada).
  const relogio = (ms) => `${String(Math.floor(ms / MIN)).padStart(2, '0')}:${String(Math.floor((ms % MIN) / 1000)).padStart(2, '0')}`;

  const api = { REGRAS, TEMPOS, MODOS, ESTRATEGIAS, JANELA_FINAL_MS, unidade, valorDe, centavosDe, reais, decremento, intervaloMs, podeLancar, aceitaLance,
    situacaoLance, alvoDentroDe10, sugestaoAoVivo, aleatorio, gerarConcorrentes, simular, relogio };
  global.LicitaRoboLances = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
