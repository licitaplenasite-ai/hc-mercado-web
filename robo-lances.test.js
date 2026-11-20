const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./robo-lances.js');

const base = (o = {}) => ({ modo: 'aberto', piso: 8000n, inicial: 10000n, decremento: 50n, semente: 7,
  concorrentes: R.gerarConcorrentes({ semente: 7, quantidade: 3, referencia: 10000n, piso: 8000n }), ...o });

test('centavosDe aceita formatos de reais e recusa zero/negativo/lixo', () => {
  assert.equal(R.centavosDe('12,34'), 1234n);
  assert.equal(R.centavosDe('12.34'), 1234n);
  assert.equal(R.centavosDe('1.234,56'), 123456n);
  assert.equal(R.centavosDe('R$ 0,50'), 50n);
  for (const v of ['0', '0,00', '-1', '1e3', '12,345', '', null, 'abc']) assert.equal(R.centavosDe(v), null);
});

test('decremento em R$ e % nunca fica abaixo da diferença mínima do edital', () => {
  assert.deepEqual(R.decremento({ tipo: 'reais', valor: '0,50' }), { ok: true, centavos: 50n, aviso: '' });
  // 0,5% de R$ 100,00 = R$ 0,50; 0,33% de R$ 100,01 arredonda para cima.
  assert.equal(R.decremento({ tipo: 'percentual', valor: '0,5', referencia: 10000n }).centavos, 50n);
  assert.equal(R.decremento({ tipo: 'percentual', valor: '0,33', referencia: 10001n }).centavos, 34n);
  const ajustado = R.decremento({ tipo: 'reais', valor: '0,10', diferencaMinima: 100n });
  assert.equal(ajustado.centavos, 100n); assert.match(ajustado.aviso, /diferença mínima/);
  for (const valor of ['0', '51', 'x', '1,234']) assert.equal(R.decremento({ tipo: 'percentual', valor, referencia: 10000n }).ok, false);
  assert.equal(R.decremento({ tipo: 'percentual', valor: '1', referencia: null }).ok, false);
  assert.equal(R.decremento({ tipo: 'reais', valor: '0' }).ok, false);
});

test('intervalo nunca abaixo de 20 s nem acima de 10 min', () => {
  assert.equal(R.intervaloMs('5'), 20000);
  assert.equal(R.intervaloMs('30'), 30000);
  assert.equal(R.intervaloMs('99999'), 600000);
  assert.equal(R.intervaloMs('abc'), 20000);
});

test('podeLancar respeita 20 s do próprio lance e 3 s do melhor lance de outro', () => {
  assert.equal(R.podeLancar(1000, {}).ok, true);
  const proprio = R.podeLancar(15000, { ultimoProprioEm: 0 });
  assert.deepEqual([proprio.ok, proprio.esperaMs, proprio.motivo], [false, 5000, 'intervalo_proprio']);
  const melhor = R.podeLancar(31000, { ultimoProprioEm: 0, melhorOutroEm: 30000 });
  assert.deepEqual([melhor.ok, melhor.esperaMs, melhor.motivo], [false, 2000, 'intervalo_melhor']);
  assert.equal(R.podeLancar(33000, { ultimoProprioEm: 0, melhorOutroEm: 30000 }).ok, true);
  // Intervalo configurado abaixo de 20 s não fura a regra.
  assert.equal(R.podeLancar(10000, { ultimoProprioEm: 0 }, 5000).ok, false);
});

test('aceitaLance recusa o que a sala recusaria', () => {
  assert.equal(R.aceitaLance({ valor: 100n, ultimoProprio: 100n, melhor: 90n }).motivo, 'nao_melhora_proprio');
  assert.equal(R.aceitaLance({ valor: 90n, ultimoProprio: 100n, melhor: 90n }).motivo, 'igual_ao_melhor');
  assert.equal(R.aceitaLance({ valor: 89n, ultimoProprio: 100n, melhor: 90n, diferencaMinima: 5n }).motivo, 'diferenca_minima');
  assert.equal(R.aceitaLance({ valor: 85n, ultimoProprio: 100n, melhor: 90n, diferencaMinima: 5n }).ok, true);
  assert.equal(R.aceitaLance({ valor: 95n, ultimoProprio: 100n, melhor: 90n }).ok, true); // lance intermediário
});

test('simulação é determinística, nunca passa do piso e respeita 20 s entre seus lances', () => {
  for (const modo of Object.keys(R.MODOS)) {
    const a = R.simular(base({ modo })), b = R.simular(base({ modo }));
    assert.deepEqual(a.resultado, b.resultado);
    const seus = a.log.filter((e) => e.tipo === 'aceito');
    for (const e of seus) assert.ok(e.valor >= 8000n, `${modo}: lance abaixo do piso`);
    for (let k = 1; k < seus.length; k++) assert.ok(seus[k].t - seus[k - 1].t >= 20000, `${modo}: menos de 20 s entre lances`);
    assert.ok(a.resultado.seu >= 8000n);
    assert.equal(a.log.at(-1).tipo, 'fim');
  }
});

test('lance dos 2 minutos finais prorroga no aberto; aberto e fechado não prorroga e sugere o piso no lance fechado', () => {
  // Concorrente que só reage devagar empurra lances para o fim da etapa.
  const lento = [{ nome: 'C1', inicial: 10500n, piso: 7000n, decremento: 10n, reacaoMs: 530000 }];
  const aberto = R.simular(base({ concorrentes: lento }));
  assert.ok(aberto.resultado.prorrogacoes > 0);
  assert.ok(aberto.resultado.fimMs > R.TEMPOS.aberto);
  const af = R.simular(base({ modo: 'aberto_fechado', concorrentes: lento }));
  assert.equal(af.resultado.prorrogacoes, 0);
  assert.ok(af.log.some((e) => e.tipo === 'sugestao' && /fechado/.test(e.texto) && e.valor === 8000n));
});

test('líder não recebe sugestão e piso inalcançável bloqueia', () => {
  const fraco = [{ nome: 'C1', inicial: 20000n, piso: 19000n, decremento: 100n, reacaoMs: 20000 }];
  const s = R.simular(base({ concorrentes: fraco }));
  assert.equal(s.resultado.voceVenceu, true);
  assert.equal(s.resultado.sugestoes, 0);
  assert.ok(s.log.some((e) => e.tipo === 'bloqueado' && /lidera/.test(e.texto)));
  const forte = [{ nome: 'C1', inicial: 9000n, piso: 1000n, decremento: 500n, reacaoMs: 20000 }];
  assert.ok(R.simular(base({ concorrentes: forte })).log.some((e) => e.tipo === 'bloqueado' && /piso/.test(e.texto)));
});

test('fechado e aberto: proposta mais de 10% acima e fora das 3 melhores não disputa', () => {
  const melhores = [9000n, 9100n, 9200n].map((v, k) => ({ nome: `C${k + 1}`, inicial: v, piso: v, decremento: 10n, reacaoMs: 20000 }));
  const s = R.simular(base({ modo: 'fechado_aberto', concorrentes: melhores, inicial: 11000n }));
  assert.equal(s.resultado.posicao, 4);
  assert.match(s.log.at(-1).texto, /fora da etapa aberta/);
});

test('entradas inválidas são recusadas antes de simular', () => {
  assert.throws(() => R.simular(base({ modo: 'leilao' })));
  assert.throws(() => R.simular(base({ piso: 0n })));
  assert.throws(() => R.simular(base({ piso: 20000n })));
});

test('tela: item sem preço-limite, sem proposta ou com piso acima da proposta não simula', () => {
  const UI = require('./robo-lances-ui.js');
  const cfg = { tipo: 'reais', valor: '0,50', intervalo: '10' };
  assert.match(UI.parametrosItem({ piso: null, inicial: 10000n, cfg }).erro, /preço-limite/);
  assert.match(UI.parametrosItem({ piso: 8000n, inicial: null, cfg }).erro, /proposta/);
  assert.match(UI.parametrosItem({ piso: 12000n, inicial: 10000n, cfg }).erro, /passa da sua proposta/);
  const ok = UI.parametrosItem({ piso: 8000n, inicial: 10000n, cfg, diferencaMinima: 100n });
  assert.deepEqual([ok.ok, ok.decremento, ok.intervalo], [true, 100n, 20000]);
  const reg = UI.entradasRegistro([{ t: 0, tipo: 'concorrente', texto: 'x' }, { t: 5000, tipo: 'sugestao', texto: 'y' }], { itemId: 'i', rotulo: 'Item 1', modo: 'aberto', rodada: 2, em: 'agora' });
  assert.deepEqual(reg.map((e) => e.tipo), ['sugestao']);
});

test('4 casas decimais: lê, formata e simula na unidade de décimo de milésimo', () => {
  assert.equal(R.valorDe('1,2345', 4), 12345n);
  assert.equal(R.valorDe('1,23', 4), 12300n);
  assert.equal(R.valorDe('1,2345', 2), null);
  assert.equal(R.reais(12345n, 4), 'R$ 1,2345');
  assert.equal(R.decremento({ tipo: 'reais', valor: '0,0050', casas: 4 }).centavos, 50n);
  const s = R.simular(base({ casas: 4, piso: 800000n, inicial: 1000000n, decremento: 50n,
    concorrentes: R.gerarConcorrentes({ semente: 7, quantidade: 3, referencia: 1000000n, piso: 800000n }) }));
  const seus = s.log.filter((e) => e.tipo === 'aceito');
  assert.ok(seus.length > 0);
  for (const e of seus) assert.ok(e.valor >= 800000n);
  assert.match(s.log.find((e) => e.tipo === 'sugestao').texto, /R\$ \d+,\d{4}/);
});

test('sem "não aguardar os segundos finais", no aberto só sugere nos 30 s finais da etapa', () => {
  const c1 = [{ nome: 'C1', inicial: 10500n, piso: 9000n, decremento: 50n, reacaoMs: 20000 }];
  const s = R.simular(base({ aguardarFinal: true, concorrentes: c1 }));
  const sugeridas = s.log.filter((e) => e.tipo === 'sugestao');
  assert.ok(sugeridas.length > 0);
  assert.ok(sugeridas[0].t >= R.TEMPOS.aberto - R.JANELA_FINAL_MS, `sugeriu cedo: ${sugeridas[0].t}`);
  // Sem esperar, a primeira sugestão sai logo no início.
  assert.ok(R.simular(base({ concorrentes: c1 })).log.find((e) => e.tipo === 'sugestao').t < 60000);
  assert.equal(s.resultado.voceVenceu, true);
});

test('aberto e fechado "até 10% do 1º": parado na fase inicial, nunca mira o 1º lugar e guarda o piso para o lance fechado', () => {
  const s = R.simular(base({ modo: 'aberto_fechado', estrategia: 'dentro10' }));
  const sugeridas = s.log.filter((e) => e.tipo === 'sugestao');
  const fechado = sugeridas.at(-1);
  assert.match(fechado.texto, /fechado/);
  assert.equal(fechado.valor, 8000n);
  for (const e of sugeridas.slice(0, -1)) assert.ok(e.t >= R.TEMPOS.abertoFechado, 'sugeriu na fase aberta inicial');
  assert.ok(s.log.some((e) => e.tipo === 'bloqueado' && /fase aberta inicial/i.test(e.texto)));
  assert.throws(() => R.simular(base({ estrategia: 'chutar' })));
});

test('alvo dentro de 10%: maior lance na faixa, respeita diferença mínima e piso', () => {
  assert.deepEqual(R.alvoDentroDe10({ melhor: 10000n, meu: 12000n, piso: 8000n }), { ok: true, valor: 11000n, corte: 11000n });
  assert.equal(R.alvoDentroDe10({ melhor: 10000n, meu: 11000n, piso: 8000n }).motivo, 'ja_dentro');
  assert.equal(R.alvoDentroDe10({ melhor: 10000n, meu: 11050n, piso: 8000n, diferencaMinima: 100n }).valor, 10950n);
  assert.equal(R.alvoDentroDe10({ melhor: 10000n, meu: 12000n, piso: 11500n }).motivo, 'piso');
});

test('selo e sugestão ao vivo: ganhando não baixa, perdendo cobre até o piso, empate aparece', () => {
  assert.equal(R.situacaoLance({ meu: 90n, melhorOutro: 100n }), 'ganhando');
  assert.equal(R.situacaoLance({ meu: 100n, melhorOutro: 100n }), 'empate');
  assert.equal(R.situacaoLance({ meu: 110n, melhorOutro: 100n }), 'perdendo');
  assert.equal(R.situacaoLance({ meu: null, melhorOutro: 100n }), null);
  const base2 = { modo: 'aberto', piso: 8000n, decremento: 50n };
  assert.equal(R.sugestaoAoVivo({ ...base2, meu: 9000n, melhorOutro: 9500n }).valor, null);
  assert.equal(R.sugestaoAoVivo({ ...base2, meu: 9600n, melhorOutro: 9500n }).valor, 9450n);
  assert.equal(R.sugestaoAoVivo({ ...base2, meu: 9500n, melhorOutro: 9500n }).selo, 'empate');
  assert.match(R.sugestaoAoVivo({ ...base2, meu: 8100n, melhorOutro: 8020n }).texto, /piso/);
  const af = R.sugestaoAoVivo({ ...base2, modo: 'aberto_fechado', estrategia: 'dentro10', meu: 12000n, melhorOutro: 10000n });
  assert.equal(af.valor, 11000n);
  assert.match(R.sugestaoAoVivo({ ...base2, modo: 'aberto_fechado', estrategia: 'dentro10', meu: 10500n, melhorOutro: 10000n }).texto, /lance fechado/);
});
