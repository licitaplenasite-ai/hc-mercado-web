/* global document, localStorage */
// E2E do chat com IA (chat-ia-ui.js + /api/chat-ia) no ambiente local. Sem chave de IA: o servidor de teste apaga
// GEMINI/GROQ do ambiente, então o chat responde no modo "base" (direto da base jurídica, dos tutoriais e dos dados).
//   PORTA_TESTE=8891 node ambiente-teste/servidor.cjs   (outro terminal; antes: subir.cjs ou supabase/ia_conversas.sql aplicado)
//   SITE_TESTE=http://127.0.0.1:8891 PRINTS=<pasta> node ambiente-teste/e2e-chat-ia.cjs
// Prova: botão nas telas logadas; dúvida de lei com fonte; "não sei" sem base; dados só da própria conta e da empresa
// ativa (outra organização nunca aparece); histórico salvo só quando ligado e só visível ao dono (RLS); CPF não é gravado.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { passo, exigir, novaPagina, comoUsuario, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');

// Zera a cota diária do chat dos usuários de teste (service_role LOCAL), para o roteiro rodar quantas vezes for preciso.
async function zerarCota() {
  const ids = [seed.usuarios.gestor.id, seed.usuarios.outra_org.id].join(',');
  const r = await fetch(`${chaves.API_URL}/rest/v1/uso_diario?funcao=eq.chat-ia&usuario_id=in.(${ids})`, { method: 'DELETE', headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY } });
  exigir(r.ok, `zerar cota: ${r.status}`);
}

async function perguntar(p, texto) {
  const antes = await p.locator('.lp-chat-msg.lp-chat-ia, .lp-chat-msg.lp-chat-erro').count();
  await p.fill('#lp-chat-campo', texto);
  await p.click('.lp-chat-form button[type=submit]');
  await p.waitForFunction((n) => document.querySelectorAll('.lp-chat-msg.lp-chat-ia, .lp-chat-msg.lp-chat-erro').length > n
    && !/Pensando/.test([...document.querySelectorAll('.lp-chat-msg')].pop().textContent), antes, { timeout: 30000 });
  return (await p.locator('.lp-chat-msg').last().textContent()) || '';
}

async function imprimir(p, nome) {
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: 900 });
    await p.waitForTimeout(300);
    const larguraDoc = await p.evaluate(() => document.documentElement.scrollWidth);
    exigir(larguraDoc <= largura, `${nome}: sem rolagem horizontal em ${largura}px (scrollWidth ${larguraDoc})`);
    await p.screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`) });
  }
  await p.setViewportSize({ width: 1366, height: 900 });
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  await zerarCota();
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(navegador, seed.usuarios.gestor);
  try {
    await passo('botão IA · BETA nas telas logadas', null, async () => {
      for (const tela of ['/painel.html', '/processos.html', '/sistema']) {
        await p.goto(SITE + tela);
        await p.waitForSelector('#chat-ia-btn', { timeout: 15000 });
        exigir(/BETA/.test(await p.textContent('#chat-ia-btn')), `${tela}: sem selo BETA`);
      }
    });
    await p.goto(SITE + '/painel.html');
    await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), seed.ids.empA1);
    await p.reload();
    await p.waitForSelector('#chat-ia-btn');
    await p.click('#chat-ia-btn');
    await p.waitForSelector('#lp-chat-campo');

    await passo('aviso de IA e dúvida de lei respondida com fonte (Lei 14.133)', null, async () => {
      exigir(/pode errar/.test(await p.textContent('.lp-chat-aviso')), 'sem aviso de que é IA');
      const r = await perguntar(p, 'Qual o prazo para apresentar recurso?');
      exigir(/3 dias úteis/.test(r), 'resposta sem o prazo: ' + r.slice(0, 200));
      exigir(/Lei 14\.133\/2021/.test(r), 'sem citar a fonte');
      exigir(await p.locator('.lp-chat-fontes a[href^="https://www.planalto.gov.br/"]').count() > 0, 'sem link oficial');
    });
    await passo('sem base: responde "não sei"', null, async () => {
      exigir(/^Não sei/.test((await perguntar(p, 'Qual a capital da Mongólia?')).trim()), 'não disse "não sei"');
    });
    await passo('dados da conta: certidão vencida da empresa ativa, nada da outra organização', null, async () => {
      const r = await perguntar(p, 'Quais certidões minhas estão vencendo?');
      exigir(/CND Federal/.test(r) && /vencido/.test(r), 'não trouxe a certidão vencida: ' + r.slice(0, 300));
      exigir(/Papelaria Aurora/.test(r), 'não respeitou a empresa ativa');
      exigir(!/Sigilos|Outra Org|Materiais Horizonte/.test(r), 'vazou dado fora da empresa ativa ou de outra organização');
      exigir(/Isso fica em/.test(r), 'sem indicar onde clicar');
      await imprimir(p, 'chat-ia-conversa');
    });
    await passo('histórico: só salva ligado, CPF removido, só o dono vê (RLS)', null, async () => {
      const antes = JSON.parse((await comoUsuario(seed.usuarios.gestor, '/rest/v1/ia_conversas?select=id')).corpo).length;
      await p.check('#lp-chat-salvar');
      await perguntar(p, 'Meu CPF é 123.456.789-09. Como faço impugnação do edital?');
      const meus = JSON.parse((await comoUsuario(seed.usuarios.gestor, '/rest/v1/ia_conversas?select=pergunta&order=criado_em.desc')).corpo);
      exigir(meus.length === antes + 1, `esperava ${antes + 1} conversas salvas, veio ${meus.length}`);
      exigir(!/123\.456\.789-09/.test(meus[0].pergunta), 'CPF gravado no histórico');
      const outro = JSON.parse((await comoUsuario(seed.usuarios.outra_org, '/rest/v1/ia_conversas?select=id')).corpo);
      exigir(Array.isArray(outro) && outro.length === 0, 'outra conta vê o histórico');
      await p.click('text=Ver histórico salvo');
      await p.waitForTimeout(800);
      exigir(/impugna/i.test(await p.textContent('.lp-chat-lista')), 'histórico salvo não aparece na tela');
    });
    await passo('tema escuro: gaveta do chat', null, async () => {
      await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.classList.remove('tema-claro'); });
      await imprimir(p, 'chat-ia-escuro');
    });
    await passo('outra organização: pergunta sobre "minhas certidões" não mostra a Organização A', null, async () => {
      const p2 = await novaPagina(navegador, seed.usuarios.outra_org);
      await p2.goto(SITE + '/painel.html');
      await p2.click('#chat-ia-btn');
      const r = await perguntar(p2, 'Quais certidões minhas estão vencendo?');
      exigir(!/Papelaria Aurora|Materiais Horizonte|CND Estadual/.test(r), 'vazou dado da Organização A: ' + r.slice(0, 300));
      await p2.context().close();
    });
    await passo('sem erro de console nem de rede inesperado', null, async () => {
      const erros = p.erros.filter((e) => !/favicon|sw\.js/.test(e));
      exigir(!erros.some((e) => /chat-ia|pageerror/.test(e)), erros.join(' | '));
    });
  } finally {
    await navegador.close();
    console.log(JSON.stringify(resultados.map(({ n, nome, ok, notas }) => ({ n, nome, ok, notas })), null, 1));
    if (resultados.some((r) => !r.ok)) process.exitCode = 1;
  }
}

main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
