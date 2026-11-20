import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { campo4, escolherLance, historicoDe, motivoParada, proximoLance, reais, validarConfigItem, valor4 } from './lance-regras.mjs';

const cfg = (o = {}) => validarConfigItem({ piso: '9,00', decremento: '0,10', diferencaMinima: '', maxLances: 5, ...o }).item;
const sala = (o = {}) => ({ etapa: 'aberta', melhor: valor4('10,00'), meu: valor4('10,50'), situacao: 'perdendo', ...o });
const AGORA = 1_800_000_000_000;

test('valores em 4 casas, sem float', () => {
  assert.equal(valor4('10,5'), 105000n);
  assert.equal(valor4('10.5'), 105000n);
  assert.equal(valor4('R$ 1.234,5600'), 12345600n);
  assert.equal(valor4('0,1') + valor4('0,2'), valor4('0,3'));
  for (const ruim of ['', '0', '-1', 'abc', '1,23456', '1.234.567']) assert.equal(valor4(ruim), null, ruim);
  assert.equal(reais(12345600n), 'R$ 1.234,5600');
  assert.equal(campo4(99000n), '9,9000');
});

test('configuração: piso obrigatório, redução > 0, máximo de lances 1..50', () => {
  assert.equal(validarConfigItem({ piso: '', decremento: '0,1', maxLances: 3 }).ok, false);
  assert.equal(validarConfigItem({ piso: '9', decremento: '0', maxLances: 3 }).ok, false);
  assert.equal(validarConfigItem({ piso: '9', decremento: '0,1', maxLances: 0 }).ok, false);
  assert.equal(validarConfigItem({ piso: '9', decremento: '0,1', maxLances: 51 }).ok, false);
  assert.equal(validarConfigItem({ piso: '9', decremento: '0,1', diferencaMinima: 'x', maxLances: 3 }).ok, false);
  assert.deepEqual(validarConfigItem({ piso: '9', decremento: '0,1', maxLances: '3' }).item, { piso: 90000n, decremento: 1000n, diferencaMinima: 0n, maxLances: 3 });
});

test('lance = melhor menos a redução', () => {
  assert.deepEqual(proximoLance(cfg(), sala(), {}, AGORA), { ok: true, valor: valor4('9,90') });
});

test('diferença mínima do edital: a maior entre a digitada e a da sala vence a redução menor', () => {
  assert.equal(proximoLance(cfg({ diferencaMinima: '0,30' }), sala(), {}, AGORA).valor, valor4('9,70'));
  assert.equal(proximoLance(cfg(), sala({ diferencaMinima: valor4('0,50') }), {}, AGORA).valor, valor4('9,50'));
});

test('nunca abaixo do piso: oferece o piso se ele ainda cobre o melhor, senão para', () => {
  assert.equal(proximoLance(cfg(), sala({ melhor: valor4('9,05') }), {}, AGORA).valor, valor4('9,00'));
  assert.deepEqual(proximoLance(cfg(), sala({ melhor: valor4('9,00') }), {}, AGORA), { ok: false, motivo: 'piso' });
  assert.deepEqual(proximoLance(cfg(), sala({ melhor: valor4('8,00') }), {}, AGORA), { ok: false, motivo: 'piso' });
  // piso cobre o melhor, mas não pela diferença mínima do edital
  assert.deepEqual(proximoLance(cfg({ diferencaMinima: '0,10' }), sala({ melhor: valor4('9,05') }), {}, AGORA), { ok: false, motivo: 'piso' });
  for (let m = 900; m <= 1100; m += 1) {
    const r = proximoLance(cfg(), sala({ melhor: BigInt(m) * 100n, meu: 120000n }), {}, AGORA);
    if (r.ok) assert.ok(r.valor >= valor4('9,00') && r.valor < BigInt(m) * 100n, `melhor ${m}`);
  }
});

test('não baixa se já é líder; fase fechada e item fora da disputa ficam manuais', () => {
  assert.equal(proximoLance(cfg(), sala({ situacao: 'ganhando', meu: valor4('9,95') }), {}, AGORA).motivo, 'ja_lider');
  assert.equal(proximoLance(cfg(), sala({ meu: valor4('10,00') }), {}, AGORA).motivo, 'ja_lider');
  assert.equal(proximoLance(cfg(), sala({ etapa: 'fechada' }), {}, AGORA).motivo, 'fase_fechada');
  for (const etapa of ['encerrada', 'aguardando', undefined]) assert.equal(proximoLance(cfg(), sala({ etapa }), {}, AGORA).motivo, 'item_fora_da_disputa');
  assert.equal(proximoLance(cfg(), sala({ melhor: null }), {}, AGORA).motivo, 'valor_ilegivel');
});

test('intervalo de 20 s entre lances do mesmo licitante e máximo de lances', () => {
  const r = proximoLance(cfg(), sala(), { ultimoEnvioEm: AGORA - 5000 }, AGORA);
  assert.equal(r.ok, false); assert.equal(r.motivo, 'intervalo'); assert.equal(r.esperaMs, 15000);
  assert.equal(proximoLance(cfg(), sala(), { ultimoEnvioEm: AGORA - 20000 }, AGORA).ok, true);
  assert.equal(proximoLance(cfg({ maxLances: 2 }), sala(), { lancesEnviados: 2 }, AGORA).motivo, 'maximo_lances');
});

test('histórico: conta enviados do item e o último envio de qualquer item da compra', () => {
  const ev = [{ item: '1', situacao: 'enviado', emMs: 10 }, { item: '2', situacao: 'enviado', emMs: 30 }, { item: '1', situacao: 'recusado', emMs: 40 }, { item: '1', situacao: 'sugerido', emMs: 50 }];
  assert.deepEqual(historicoDe(ev, '1'), { lancesEnviados: 1, ultimoEnvioEm: 30 });
  assert.deepEqual(historicoDe([], '1'), { lancesEnviados: 0, ultimoEnvioEm: null });
  assert.deepEqual(historicoDe([...ev, { item: '1', situacao: 'incerto', emMs: 60 }], '1'), { lancesEnviados: 2, ultimoEnvioEm: 60 });
});

test('paradas: desligado, anticonluio, captcha, sessão, suspensão, desempate, mensagem nova do pregoeiro', () => {
  const ok = { ok: true, alertas: [], mensagens: 3 };
  const base = { armado: true, mensagensBase: 3, empresasNaCompra: 1 };
  assert.equal(motivoParada(ok, base), null);
  assert.equal(motivoParada(ok, { ...base, armado: false }), 'parado');
  assert.equal(motivoParada(ok, { ...base, empresasNaCompra: 2 }), 'anticonluio');
  for (const a of ['captcha', 'sessao_expirada', 'suspensa', 'desempate']) assert.equal(motivoParada({ ...ok, alertas: [a] }, base), a);
  assert.equal(motivoParada({ ...ok, mensagens: 4 }, base), 'mensagem_pregoeiro');
  assert.equal(motivoParada({ ok: false, motivo: 'captcha' }, base), 'captcha');
  assert.equal(motivoParada({ ok: false, motivo: 'sem_itens' }, base), 'sem_leitura');
  assert.equal(motivoParada(null, base), 'sem_leitura');
});

test('rodada: para tudo na parada; sugere o 1º item com lance; respeita espera; itens sem configuração ficam fora', () => {
  const config = { armado: true, mensagensBase: 1, empresasNaCompra: 1, itens: {
    1: { piso: '9,0000', decremento: '0,10', diferencaMinima: '', maxLances: 3 },
    2: { piso: '3,0000', decremento: '0,10', diferencaMinima: '', maxLances: 3 } } };
  const leitura = { ok: true, mensagens: 1, alertas: [], itens: [
    { itemId: '2', etapa: 'aberta', situacao: 'ganhando', melhorValor: 'R$ 4,0000', meuValor: 'R$ 4,0000', diferencaMinima: null },
    { itemId: '1', etapa: 'aberta', situacao: 'perdendo', melhorValor: 'R$ 10,0000', meuValor: 'R$ 10,5000', diferencaMinima: 'R$ 0,0500' },
    { itemId: '3', etapa: 'aberta', situacao: 'perdendo', melhorValor: 'R$ 1,0000', meuValor: 'R$ 2,0000', diferencaMinima: null }] };
  const r = escolherLance(config, leitura, [], AGORA);
  assert.deepEqual(r.sugestao, { item: '1', valor: valor4('9,90'), piso: valor4('9'), melhorLido: 'R$ 10,0000', meuLido: 'R$ 10,5000' });
  assert.equal(r.espera, undefined);
  assert.deepEqual(r.itens, [{ item: '2', motivo: 'você está em 1º' }]);
  const e = escolherLance(config, leitura, [{ item: '2', situacao: 'enviado', emMs: AGORA - 1000 }], AGORA);
  assert.equal(e.espera, 19000);
  assert.deepEqual(escolherLance(config, { ...leitura, mensagens: 2 }, [], AGORA), { parada: 'mensagem_pregoeiro' });
  assert.deepEqual(escolherLance({ ...config, empresasNaCompra: 2 }, leitura, [], AGORA), { parada: 'anticonluio' });
  assert.deepEqual(escolherLance({ ...config, itens: { 1: { ...config.itens[1], piso: '' } } }, leitura, [], AGORA).itens[0].item, '1');
  assert.equal(escolherLance({ ...config, itens: { 1: { ...config.itens[1], piso: '' } } }, leitura, [], AGORA).sugestao, undefined);
});

test('regras não clicam, não fazem rede e não têm modo automático', () => {
  const fonte = readFileSync(new URL('./lance-regras.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const proibido of [/\.click\s*\(/, /fetch\s*\(/, /setInterval|setTimeout/, /MODO_AUTOMATICO\s*=\s*true/]) assert.doesNotMatch(fonte, proibido);
});
