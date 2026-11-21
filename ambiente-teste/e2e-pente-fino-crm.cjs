/* global document, window, getComputedStyle, MutationObserver */
// Pente fino da área CRM (sistema, processos, quadros, resumo, portal do cliente, decisão e convite).
// Abre cada tela com os papéis gestor, operador, leitura e outra organização, em 1280 e 375 px, e:
//  - clica em todos os botões, abas e links visíveis (menos os que apagam, enviam ou saem) e anota o que cada um fez;
//  - procura texto técnico ou de teste (JSON, RPC, .sql, undefined, NaN, null, "app", TESTE), CPF e rolagem lateral;
//  - junta erros de JavaScript do console.
// Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8813 node ambiente-teste/servidor.cjs
//   PORTA_TESTE=8813 node ambiente-teste/e2e-pente-fino-crm.cjs
// Saída: prints e cliques.json em PRINTS. Falha se houver erro de JavaScript, texto proibido, CPF, rolagem lateral,
// dado de outra organização ou botão que leva a página inexistente.
const fs = require('node:fs'), path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-crm';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const { usuarios: U, ids } = seed;
const PROIBIDO = /\bJSON\b|\bRPC\b|\.sql\b|\bsupabase\b|\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b|fail-open|\bapp\b|\bPGRST|row-level|\{'tipo'/i;
const PROIBIDO_EXATO = /\bTESTE\b/; // maiúsculo: dado de teste esquecido (o seed usa "Teste" nos nomes fictícios)
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const PERIGOSO = /excluir|apagar|remover|sair|arquivar|enviar|confirmar|desvincular|revogar|encerrar|descartar|limpar|resetar|zerar|recusar|aprovar|perdido|desistir|imprimir|baixar|exportar|gerar|word|pdf|copiar|whatsapp|e-mail|abrir no portal|pncp|compras\.gov|instalar|ativar aviso/i;
const TELAS = [
  { nome: 'sistema', url: () => `/sistema?empresa=${ids.empA1}&processo=${ids.procA}`, pronto: '#app-aviso, main' },
  { nome: 'processos', url: () => `/processos.html?empresa=${ids.empA1}`, pronto: '#empresa-atual' },
  { nome: 'processo-aberto', url: () => `/processos.html?empresa=${ids.empA1}&processo=${ids.procA}`, pronto: '#empresa-atual' },
  { nome: 'quadros', url: () => '/quadros.html', pronto: '#aviso' },
  { nome: 'resumo', url: () => `/resumo-processo.html?empresa=${ids.empA1}&processo=${ids.procA}`, pronto: '#resumo' },
];
const PUBLICAS = [
  { nome: 'cliente-link-invalido', url: '/cliente#t=' + 'x'.repeat(43), espera: /link|expirou|inválido|não/i },
  { nome: 'decisao-link-invalido', url: '/responder-oportunidade.html#token=abc', espera: /Link inválido/ },
  { nome: 'convite-sem-codigo', url: '/convite.html', espera: /convite|link/i },
];

const cliques = [];
const problemas = [];
const anotar = (tela, papel, largura, tipo, detalhe) => problemas.push({ tela, papel, largura, tipo, detalhe });

// Texto visível com rótulo: o que o usuário lê. Ignora <script>, <style> e campos escondidos.
const textoVisivel = (p) => p.evaluate(() => document.body.innerText);

async function revisarTexto(p, tela, papel, largura) {
  const texto = await textoVisivel(p);
  for (const linha of texto.split('\n').map((l) => l.replace(/https?:\/\/\S+/g, '<link>'))) {
    if (PROIBIDO.test(linha)) anotar(tela, papel, largura, 'texto técnico', linha.trim().slice(0, 200));
    if (PROIBIDO_EXATO.test(linha)) anotar(tela, papel, largura, 'texto de teste', linha.trim().slice(0, 200));
    if (CPF.test(linha)) anotar(tela, papel, largura, 'CPF na tela', linha.trim().slice(0, 120));
    if (papel === 'leitura' && /98765-4|4321|52998224725|529\.982\.247-25/.test(linha)) anotar(tela, papel, largura, 'dado bancário para leitura', linha.trim().slice(0, 120));
    if (papel === 'outra_org' && /Papelaria Aurora|Materiais Horizonte/.test(linha)) anotar(tela, papel, largura, 'dado de outra organização', linha.trim().slice(0, 120));
  }
  const larg = await p.evaluate(() => document.documentElement.scrollWidth);
  if (larg > largura + 2) anotar(tela, papel, largura, 'rolagem lateral', `${larg}px`);
}

// Clica em cada controle visível; anota o efeito (mudou a página, abriu janela, mudou a tela ou nada).
// Links do mesmo site: confere que o destino existe (sem sair da tela). Botões e abas: clica um por um.
const marcar = (p) => p.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.closest('[hidden]'); };
  let n = 0;
  return [...document.querySelectorAll('button, a[href], [role=tab], summary')].filter(vis).map((e) => {
    const id = 'pf' + (n++); e.dataset.pf = id;
    return { id, rotulo: (e.innerText || e.getAttribute('aria-label') || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 70), href: e.tagName === 'A' ? e.getAttribute('href') : null,
      absoluto: e.tagName === 'A' ? e.href : null, menu: Boolean(e.closest('nav, .nav-lateral, .menu-lateral')), desligado: e.disabled || e.getAttribute('aria-disabled') === 'true' };
  });
});
const linksVistos = new Map();
async function clicarTudo(p, tela, papel, largura, urlInicial) {
  const alvos = await marcar(p);
  for (const a of alvos.slice(0, 140)) {
    const r = { tela, papel, largura, rotulo: a.rotulo, href: a.href, efeito: '' };
    if (a.desligado) { r.efeito = 'desligado'; cliques.push(r); continue; }
    if (a.href && a.absoluto?.startsWith(SITE) && !a.href.startsWith('#')) {
      const destino = a.absoluto.split('#')[0];
      if (!linksVistos.has(destino)) linksVistos.set(destino, (await p.request.get(destino).catch(() => null))?.status() || 0);
      const st = linksVistos.get(destino);
      r.efeito = `link para ${destino.replace(SITE, '')} (${st})`;
      if (st >= 400 || st === 0) anotar(tela, papel, largura, 'link quebrado', `${a.rotulo} → ${destino} (${st})`);
      cliques.push(r); continue;
    }
    if (a.menu && /Recolher|«/.test(a.rotulo)) { r.efeito = 'pulado (recolhe o menu)'; cliques.push(r); continue; }
    if (PERIGOSO.test(a.rotulo) || (a.href && /^(mailto|tel|https?:\/\/)/.test(a.href))) { r.efeito = 'pulado (ação real ou site de fora)'; cliques.push(r); continue; }
    const el = p.locator(`[data-pf="${a.id}"]`);
    if (!(await el.count()) || !(await el.isVisible().catch(() => false))) { r.efeito = 'escondido (janela aberta ou seção fechada)'; cliques.push(r); continue; }
    await p.evaluate(() => { window.__mud = 0; window.__obs?.disconnect(); window.__obs = new MutationObserver((m) => { window.__mud += m.length; }); window.__obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); });
    const antes = p.url();
    const popup = p.context().waitForEvent('page', { timeout: 1500 }).catch(() => null);
    try { await el.click({ timeout: 3000 }); } catch {
      // Janela aberta por cima (ex.: o processo aberto pelo link): fecha e tenta de novo uma vez.
      await p.locator('.modal.aberto button:has-text("Fechar"), dialog[open] button:has-text("Fechar")').first().click({ timeout: 1500 }).catch(() => {});
      try { await el.click({ timeout: 3000 }); } catch (e) { r.efeito = 'não clicável: ' + e.message.split('\n')[0].slice(0, 80); cliques.push(r); continue; }
    }
    await p.waitForTimeout(700);
    const nova = await popup;
    if (nova) { await nova.waitForLoadState('domcontentloaded').catch(() => {}); const st = nova.url(); r.efeito = 'abriu janela ' + st.replace(SITE, ''); if (/404|não encontrad/i.test(await nova.title().catch(() => ''))) anotar(tela, papel, largura, 'link 404', a.rotulo + ' → ' + st); await nova.close(); }
    else if (p.url() !== antes) {
      r.efeito = 'foi para ' + p.url().replace(SITE, '');
      const resp = await p.evaluate(() => document.title + ' ' + (document.body.innerText || '').slice(0, 80)).catch(() => '');
      if (/404|not found|não encontrad/i.test(resp)) anotar(tela, papel, largura, 'link 404', a.rotulo + ' → ' + p.url());
      await p.goto(urlInicial); await p.waitForTimeout(3000); await marcar(p); // mesma ordem: os ids voltam aos mesmos controles
    } else {
      const mud = await p.evaluate(() => window.__mud || 0);
      r.efeito = mud ? `mudou a tela (${mud})` : 'NADA';
      await p.keyboard.press('Escape').catch(() => {});
    }
    cliques.push(r);
  }
}

async function visitar(nav, papel) {
  const p = await novaPagina(nav, U[papel]);
  p.on('dialog', (d) => d.dismiss());
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: largura === 375 ? 812 : 900 });
    for (const t of TELAS) {
      await passo(`${papel} ${largura}px ${t.nome}`, null, async () => {
        p.erros.length = 0;
        const url = SITE + t.url();
        await p.goto(url);
        await p.waitForSelector(t.pronto, { timeout: 30000, state: 'attached' });
        await p.waitForTimeout(3500);
        await p.screenshot({ path: path.join(PRINTS, `${papel}-${largura}-${t.nome}.png`), fullPage: largura === 375 });
        await revisarTexto(p, t.nome, papel, largura);
        if (largura === 1280 || papel === 'gestor') await clicarTudo(p, t.nome, papel, largura, url);
        await revisarTexto(p, t.nome + ' (depois dos cliques)', papel, largura);
        // Erros de rede 4xx esperados (leitura tentando gravar não acontece: não clicamos em salvar). Só JS conta aqui.
        for (const e of p.erros.filter((x) => /pageerror|console/.test(x) && !/Failed to load resource|favicon/.test(x))) anotar(t.nome, papel, largura, 'erro de JavaScript', e);
        return `${p.erros.length} avisos de rede/console`;
      });
    }
  }
  await p.context().close();
}

// Perfil da empresa A1 com CPF e banco fictícios: a tela do papel leitura não pode mostrar nenhum dos dois.
function semearPerfil() {
  const sql = `insert into operacao_perfil_empresa (empresa_id, organizacao_id, cpf_representante, banco) values ('${ids.empA1}', '${ids.orgA}', '52998224725', '{"banco":"Banco Ficticio","agencia":"4321","conta":"98765-4"}')
    on conflict (empresa_id) do update set cpf_representante = excluded.cpf_representante, banco = excluded.banco;`;
  const r = require('node:child_process').spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('perfil: ' + r.stderr);
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  semearPerfil();
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  try {
    for (const papel of (process.env.PAPEIS || 'gestor,operador,leitura,outra_org').split(',')) await visitar(nav, papel);
    const p = await novaPagina(nav);
    for (const largura of [1280, 375]) {
      await p.setViewportSize({ width: largura, height: 812 });
      for (const t of PUBLICAS) {
        await passo(`público ${largura}px ${t.nome}`, null, async () => {
          p.erros.length = 0;
          await p.goto(SITE + t.url);
          await p.waitForTimeout(2500);
          const texto = await textoVisivel(p);
          exigir(t.espera.test(texto), 'mensagem esperada não apareceu: ' + texto.slice(0, 200));
          await p.screenshot({ path: path.join(PRINTS, `publico-${largura}-${t.nome}.png`), fullPage: true });
          await revisarTexto(p, t.nome, 'público', largura);
          for (const e of p.erros.filter((x) => /pageerror/.test(x))) anotar(t.nome, 'público', largura, 'erro de JavaScript', e);
          return texto.replace(/\s+/g, ' ').slice(0, 120);
        });
      }
    }
  } finally { await nav.close(); }
  fs.writeFileSync(path.join(PRINTS, 'cliques.json'), JSON.stringify(cliques, null, 1));
  fs.writeFileSync(path.join(PRINTS, 'problemas.json'), JSON.stringify(problemas, null, 1));
  const mortos = cliques.filter((c) => c.efeito === 'NADA');
  console.log(`\n${cliques.length} controles vistos, ${mortos.length} sem efeito visível (revisar à mão em cliques.json)`);
  for (const m of mortos) console.log(`  NADA: ${m.papel} ${m.largura} ${m.tela} · "${m.rotulo}"`);
  for (const x of problemas) console.log(`  PROBLEMA ${x.tipo}: ${x.papel} ${x.largura} ${x.tela} · ${x.detalhe}`);
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length || problemas.length ? `FALHOU: ${falhas.length} passos, ${problemas.length} problemas` : `E2E PENTE-FINO-CRM OK (${resultados.length}/${resultados.length})`);
  process.exit(falhas.length || problemas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
