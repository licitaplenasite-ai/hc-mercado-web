import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerSala } from './sala-disputa.mjs';

// A leitura de verdade (DOM da sala modelada) é conferida no Edge: ambiente-teste/e2e-extensao.cjs.
test('fora da sala do fornecedor logado não lê nada (nunca devolve leitura inventada)', () => {
  for (const href of ['https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=16013705000332026',
    'http://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/lances?compra=16013705000332026',
    'https://outro.gov.br/comprasnet-web/seguro/fornecedor/lances?compra=16013705000332026',
    'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/lances?compra=123']) {
    globalThis.location = { href };
    assert.deepEqual(lerSala(), { ok: false, motivo: 'pagina_nao_suportada' }, href);
  }
  delete globalThis.location;
});

test('leitor da sala e regras não clicam, não preenchem, não navegam e não fazem rede', () => {
  for (const arq of ['./sala-disputa.mjs', './lance-regras.mjs']) {
    const fonte = readFileSync(new URL(arq, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const proibido of [/\.click\s*\(/, /dispatchEvent/, /\.submit\s*\(/, /\.value\s*=/, /location\s*=|location\.(assign|replace|href\s*=)/, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/]) {
      assert.doesNotMatch(fonte, proibido, `${arq} ${proibido}`);
    }
  }
});

test('ações na sala: só o botão "Enviar lance" é clicado; nunca Salvar, termo, captcha, exclusão ou rede', () => {
  const fonte = readFileSync(new URL('./lance-sala.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((fonte.match(/\.click\s*\(/g) || []).length, 1);
  assert.match(fonte, /const campo = q\('input-valor-lance'\), botao = q\('btn-enviar-lance'\);[\s\S]*botao\.click\(\)/);
  for (const proibido of [/salvar[^']*'\)\??\.click|btn-salvar/i, /hcaptcha[\s\S]{0,80}\.click|captcha.*token/i, /excluir/i, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/, /setInterval/]) {
    assert.doesNotMatch(fonte, proibido, String(proibido));
  }
});

test('popup: lance só sai do clique em "Sim, dar lance"; modo automático continua desligado', () => {
  const fonte = readFileSync(new URL('./lance.mjs', import.meta.url), 'utf8');
  const usos = [...fonte.matchAll(/enviarLanceNaSala/g)].length;
  assert.equal(usos, 2); // import + a chamada dentro do clique de #lanceSim
  const clique = fonte.slice(fonte.indexOf("$('lanceSim').addEventListener('click'"), fonte.indexOf("$('lanceNao')"));
  assert.match(clique, /executar\(s\.tabId, enviarLanceNaSala/);
  assert.doesNotMatch(fonte.slice(fonte.indexOf('async function rodada'), fonte.indexOf('function rodar()')), /enviarLanceNaSala/);
  assert.match(readFileSync(new URL('./pregao-leitor.mjs', import.meta.url), 'utf8'), /export const MODO_AUTOMATICO = false;/);
});
