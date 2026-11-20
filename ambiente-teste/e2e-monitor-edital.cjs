/* global document */
// E2E do "Mudou algo no edital?" (monitor por processo). Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8891 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8891 node ambiente-teste/e2e-monitor-edital.cjs
// Usa uma compra REAL do PNCP (só leitura): cria o processo, roda o robô (1ª conferência = histórico sem alerta),
// simula a mudança voltando o retrato guardado (situação e prazo antigos) e uma mensagem gravada pela extensão,
// roda o robô de novo e tira prints do processo, do Hoje e do Funil em 1280 e 375. Apaga tudo o que criou no fim.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-monitor-edital';
const { passo, exigir, novaPagina, entrar, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const RAIZ = path.resolve(__dirname, '..');
const NUMERO = process.env.MONITOR_PNCP || '07237373000120-1-000084/2025';
const MSG = 'e2e00000000000000000000000000a01';

async function servico(metodo, caminho, corpo, prefer = 'return=representation') {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: prefer } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
function robo() {
  const r = spawnSync(process.execPath, ['-r', './ambiente-teste/redirecionar-fetch.cjs', 'scripts/monitor_processos.js'],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, AMBIENTE_TESTE_REDIRECIONAR: '1' } });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}

async function main() {
  const { usuarios: U, ids } = seed;
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  let proc = null, idCompra = null;
  try {
    proc = (await servico('POST', '/rest/v1/operacao_processos', { organizacao_id: ids.orgA, empresa_id: ids.empA1, objeto: 'Contact center (compra real do PNCP, e2e do monitor)',
      orgao: 'Banco do Nordeste do Brasil', numero: '90102/2025', modalidade: 'Pregão - Eletrônico', origem_externa_id: NUMERO, status: 'triagem', criado_por: U.gestor.id }))[0];
    await passo('robô: 1ª conferência grava o histórico sem alerta', null, async () => {
      const saida = robo();
      const [m] = await servico('GET', `/rest/v1/operacao_monitor_processos?processo_id=eq.${proc.id}&select=situacao,verificado_em,id_compra,retrato`);
      exigir(m?.verificado_em, 'processo não conferido: ' + saida);
      const ms = await servico('GET', `/rest/v1/operacao_monitor_mudancas?processo_id=eq.${proc.id}&select=tipo,alerta`);
      exigir(ms.length > 0 && ms.every((x) => !x.alerta), 'histórico inicial com alerta');
      idCompra = m.id_compra;
      // Simula o dia anterior: situação e prazo antigos no retrato; o robô compara com o PNCP de agora.
      const retrato = { ...m.retrato, compra: { ...m.retrato.compra, situacao: 'Divulgada no PNCP', encerramento: '2026-11-16T13:00:00.000Z' } };
      await servico('PATCH', `/rest/v1/operacao_monitor_processos?processo_id=eq.${proc.id}`, { retrato, proximo_em: new Date().toISOString() }, 'return=minimal');
      if (idCompra) {
        await servico('POST', '/rest/v1/pregoes_gravados?on_conflict=id_compra', { id_compra: idCompra, fonte: 'comprasgov' }, 'resolution=ignore-duplicates,return=minimal');
        await servico('POST', '/rest/v1/pregoes_gravados_mensagens', { chave: MSG, id_compra: idCompra, numero_item: 1, data_hora: '2026-11-19T10:15:00', autor: 'Pregoeiro',
          texto: 'Srs. licitantes, a sessão está suspensa para análise de impugnação. A nova data será informada.', tipo: 'outro' }, 'return=minimal');
      }
      return `${ms.length} registros do histórico real · situação no PNCP: ${m.situacao} · compra ${idCompra || '—'} · ${saida}`;
    });
    await passo('robô: 2ª conferência detecta situação, prazo e chat', null, async () => {
      const saida = robo();
      const ms = await servico('GET', `/rest/v1/operacao_monitor_mudancas?processo_id=eq.${proc.id}&alerta=eq.true&select=tipo,resumo`);
      exigir(ms.some((x) => x.tipo === 'data'), 'mudança de data não detectada');
      return ms.map((x) => `${x.tipo}: ${x.resumo}`).join(' | ') + ' · ' + saida;
    });

    const p = await novaPagina(navegador);
    await entrar(p, U.gestor);
    for (const largura of [1280, 375]) {
      await p.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
      await passo(`processo: Últimas atividades em ${largura}px`, null, async () => {
        await p.goto(`${SITE}/sistema?empresa=${ids.empA1}&processo=${proc.id}`);
        await p.waitForSelector('#monitor-processo .mp-contadores', { timeout: 30000 });
        const texto = await p.innerText('#monitor-processo');
        exigir(/Situação atual/.test(texto) && /Atualizado em/.test(texto) && /vira regra do edital/.test(texto), 'cartão incompleto');
        exigir(!(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)), 'rolagem horizontal');
        await p.locator('#monitor-processo').screenshot({ path: path.join(PRINTS, `monitor-${largura}-1-processo.png`) });
        return texto.replace(/\s+/g, ' ').slice(0, 300);
      });
      await passo(`Hoje: bloco "Mudou algo no edital?" em ${largura}px`, null, async () => {
        await p.goto(`${SITE}/sistema`);
        await p.waitForSelector('#hoje-monitor:not([hidden]) li', { timeout: 30000 });
        await p.locator('#hoje-monitor').screenshot({ path: path.join(PRINTS, `monitor-${largura}-2-hoje.png`) });
        return `${await p.locator('#hoje-monitor li').count()} linha(s)`;
      });
    }
    await passo('Funil: selo no cartão (painel)', null, async () => {
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.goto(`${SITE}/painel.html#kanban`);
      const selo = p.locator('.kanban-card-monitor').first();
      await selo.waitFor({ timeout: 30000 });
      await selo.locator('xpath=ancestor::div[contains(@class,"kanban-card")][1]').screenshot({ path: path.join(PRINTS, 'monitor-1280-3-funil-cartao.png') });
      return (await p.locator('.kanban-card-monitor').allInnerTexts()).join(' | ');
    });
    const erros = p.erros.filter((e) => e.startsWith('pageerror'));
    await passo('sem erro de JavaScript na página', null, async () => { exigir(!erros.length, erros.join(' | ')); });
  } finally {
    if (idCompra) await servico('DELETE', `/rest/v1/pregoes_gravados_mensagens?chave=eq.${MSG}`).catch(() => null);
    if (proc) await servico('DELETE', `/rest/v1/operacao_processos?id=eq.${proc.id}`).catch(() => null);
    await navegador.close();
  }
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(falhas ? `${falhas} passo(s) com falha` : 'tudo certo');
  process.exitCode = falhas ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
