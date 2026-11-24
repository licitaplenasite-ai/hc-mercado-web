/* global document, window, location, getComputedStyle */
// Pente fino da área "painel 1": topo, menu lateral, Início (Dashboard), Boletim, Encontrar Licitações e prospeccao.html.
// Clica em cada botão/link da área como cliente aprovado (gestor do seed), em 1280 e 375 px, e falha com:
// erro de JavaScript no console, rolagem lateral no celular, texto técnico na tela ou botão que não leva ao lugar certo.
// Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8811 node ambiente-teste/servidor.cjs
//   PORTA_TESTE=8811 node ambiente-teste/e2e-pente-fino-painel1.cjs
// A edição de boletim fictícia criada aqui é apagada no fim.
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-painel1/depois';
const { passo, exigir, novaPagina, entrar, seed, chaves, banco, SITE, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation', ...extra } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
// Só erro de JavaScript conta. A IA de montar busca não tem chave no ambiente local (503 esperado, tela mostra aviso amigável).
const errosJs = (p) => p.erros.filter((e) => (e.startsWith('pageerror') || e.startsWith('console')) && !/status of 503/.test(e));
// Palavras de robô/sistema que o cliente não pode ver (checklist do pente fino, item 4).
const JARGAO = /\brobô\b|na base\b|nossa base|da base\b|\bJSON\b|\bRPC\b|fail-open|undefined|\bNaN\b|\[object|\bnull\b|consulta ao PNCP|arquivo semanal|\bapp\b/i;
const textoDe = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
const rolagemLateral = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
// Quem passa da largura da tela (para a mensagem de erro dizer o culpado).
const largos = (p) => p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.offsetHeight && e.getBoundingClientRect().right > window.innerWidth + 2)
  .filter((e) => !e.closest('.tabela-rolavel, .dash-barras')).slice(0, 4).map((e) => `${e.tagName}#${e.id}.${String(e.className).slice(0, 40)}`).join(', '));
// A busca ao vivo pode levar até um minuto; o botão fica desativado enquanto isso.
const buscaLivre = async (p) => {
  await p.waitForSelector('#op-buscar:not([disabled])', { timeout: 120000 });
  const tampa = await p.evaluate(() => { const b = document.getElementById('op-buscar'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect();
    const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (!e || b.contains(e)) return '';
    const cadeia = []; for (let a = e; a && cadeia.length < 10; a = a.parentElement) cadeia.push(`${a.tagName}#${a.id}.${String(a.className).slice(0, 30)}`);
    return cadeia.join(' < ') + ` | botão em y=${Math.round(r.y)}`; });
  exigir(!tampa, 'botão Buscar coberto por ' + tampa);
};
async function semJargao(p, sel) {
  const t = await textoDe(p, sel);
  const m = t.match(JARGAO);
  exigir(!m, `texto técnico em ${sel}: "${m && t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}"`);
  return t;
}
async function abrirPainel(p, hash = '') {
  await p.goto(`${SITE}/painel.html${hash}`);
  await p.waitForFunction(() => window.__clienteIdAtual, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);
}
const secaoAtiva = (p) => p.evaluate(() => document.querySelector('main section.ativa')?.id || null);

async function main() {
  const U = seed.usuarios;
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const ctx = {};
  try {
    const p = await novaPagina(nav);
    await p.setViewportSize({ width: 1280, height: 900 });
    await entrar(p, U.gestor);

    await passo('1280 · Início: contadores, plano legível, sem texto técnico', p, async () => {
      await abrirPainel(p);
      exigir(await secaoAtiva(p) === 'dashboard', 'painel não abriu no Início');
      const plano = (await p.innerText('#header-badge-plano')).trim();
      exigir(/^Assessoria( \(teste\))?$/.test(plano), `plano no topo "${plano}" (esperado o nome, não o código)`);
      const t = await semJargao(p, '#dashboard');
      exigir(/Contratos públicos acompanhados/.test(t), 'rótulo do cartão de contratos não mudou');
      const perfil = await p.$$eval('#dash-perfil-itens > div', (d) => d.map((x) => x.innerText.trim()));
      exigir(perfil.length === 4, 'perfil sem os 4 itens: ' + perfil.join(','));
      return `plano "${plano}" · perfil: ${perfil.join(', ')}`;
    });

    await passo('1280 · Início: atalhos levam à seção certa e "ver todas" mostra o mural', p, async () => {
      const alvos = await p.$$eval('#dash-atalhos [data-alvo-dashboard]', (b) => b.map((x) => x.dataset.alvoDashboard));
      exigir(alvos.length === 6, 'atalhos: ' + alvos.join(','));
      for (const alvo of alvos) {
        await abrirPainel(p);
        await p.click(`#dash-atalhos [data-alvo-dashboard="${alvo}"]`); await p.waitForTimeout(600);
        exigir(await secaoAtiva(p) === alvo, `atalho ${alvo} abriu ${await secaoAtiva(p)}`);
      }
      await abrirPainel(p);
      await p.click('#dash-faixa-novidade a'); await p.waitForTimeout(600);
      exigir(await secaoAtiva(p) === 'dashboard', '"ver todas" saiu do Início');
      const visivel = await p.evaluate(() => { const r = document.getElementById('mural-novidades').getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
      exigir(visivel, 'mural de novidades não ficou à vista');
      return `${alvos.join(', ')} ok; mural à vista`;
    });

    await passo('1280 · Topo: sino, ajuda, tema e menu da conta', p, async () => {
      await abrirPainel(p);
      await p.click('#header-bell-btn');
      exigir(await p.isVisible('#header-bell-dropdown'), 'sino não abriu');
      const sino = await p.innerText('#header-bell-corpo');
      await p.mouse.click(700, 700);
      await p.click('#header-ajuda-btn'); await p.waitForTimeout(800);
      const ajuda = await p.evaluate(() => document.querySelector('.lp-gaveta-corpo')?.innerText || '');
      exigir(/Mandar dúvida/.test(ajuda), 'central de ajuda não abriu');
      exigir(!/em breve/i.test(ajuda.split('Tutoriais')[0]), 'ajuda ainda mostra botão "em breve"');
      await p.keyboard.press('Escape');
      await abrirPainel(p);
      const antes = await p.evaluate(() => document.documentElement.classList.contains('tema-claro'));
      await p.click('#header-tema-btn');
      const depois = await p.evaluate(() => document.documentElement.classList.contains('tema-claro'));
      await p.click('#header-tema-btn');
      exigir(antes !== depois, 'tema não alternou');
      const saidas = [];
      for (const acao of ['conta', 'lembretes', 'planos']) {
        await abrirPainel(p);
        await p.click('#header-user-btn'); await p.click(`#header-user-dropdown [data-acao=${acao}]`); await p.waitForTimeout(1200);
        const m = await p.innerText('#modal-conta-corpo');
        exigir(m.trim() && !JARGAO.test(m), `${acao}: modal vazio ou técnico: ${m.slice(0, 120)}`);
        saidas.push(`${acao}: ${m.replace(/\s+/g, ' ').slice(0, 50)}`);
      }
      exigir(/Assessoria/.test(await p.innerText('#modal-conta-corpo')), 'planos sem o nome do plano');
      await p.click('#planos-falar-equipe'); await p.waitForTimeout(800);
      exigir(await secaoAtiva(p) === 'juridico' && /planos/.test(await p.inputValue('#duvida-mensagem')), '"Falar com a equipe" não abriu o formulário');
      await abrirPainel(p);
      await p.click('#header-user-btn'); await p.click('#header-user-dropdown [data-acao=feedback]'); await p.waitForTimeout(800);
      exigir(await secaoAtiva(p) === 'juridico' && /feedback/.test(await p.inputValue('#duvida-mensagem')), 'feedback não abriu o formulário');
      return `sino: "${sino.replace(/\s+/g, ' ')}" · ${saidas.join(' | ')} · feedback e planos abrem o formulário da equipe`;
    });

    await passo('1280 · Menu lateral: cada item abre o lugar certo', p, async () => {
      const esperado = { Hoje: '/sistema', Dashboard: '#dashboard', Boletim: '#boletim', 'Calendário': '#boletim', 'Encontrar Licitações': '#oportunidades',
        'Inteligência de Mercado': '#diagnostico', 'Prospecção': '/prospeccao.html', 'Licitação anterior': '#diagnostico', 'Analisar concorrente': '#empresa',
        'Convênios e Emendas Federais': '#transparencia', 'Pesquisa de Preços': '#precos', 'Calculadora de BDI': '/bdi.html', 'Preços SINAPI': '/sinapi.html', 'Orçamento de obra': '/orcamento-obra.html',
        'Mão de obra': '/mao-de-obra.html', Funil: '#kanban', Quadros: '/quadros.html', Processos: '/processos.html', 'Minhas empresas e documentos': '/operacao.html',
        'Extensão': '/extensao.html', 'Jurídico & Dúvidas': '#juridico' };
      const itens = await p.$$eval('#menu-principal > a, #menu-principal > button', (e) => e.map((x) => ({ txt: x.querySelector('.nav-label')?.innerText.trim(), target: x.target })));
      const ok = [];
      for (const [i, it] of itens.entries()) {
        if (it.txt === 'Recolher' || it.txt === 'Expandir') continue;
        if (it.target === '_blank') { exigir((await fetch(SITE + '/hc.html')).ok, 'Consultoria (hc.html) fora do ar'); ok.push(it.txt); continue; }
        exigir(esperado[it.txt], 'item de menu sem destino conhecido: ' + it.txt);
        await abrirPainel(p);
        await (await p.$$('#menu-principal > a, #menu-principal > button'))[i].click(); await p.waitForTimeout(1500);
        const onde = await p.evaluate(() => (location.pathname.endsWith('painel.html') ? '' : location.pathname) + (document.querySelector('main section.ativa') ? '#' + document.querySelector('main section.ativa').id : ''));
        exigir(onde.includes(esperado[it.txt]), `${it.txt} levou a ${onde}`);
        if (it.txt === 'Licitação anterior') exigir(await p.isVisible('#dg-licitacao-anterior'), 'Licitação anterior não abriu a aba própria');
        ok.push(it.txt);
      }
      return `${ok.length} itens ok`;
    });

    await passo('1280 · Boletim: filtro por empresa, resultado, calendário e atualizar', p, async () => {
      await abrirPainel(p, '#boletim');
      if (!(await p.isVisible('#bol-config-painel'))) await p.click('#bol-config-toggle');
      await p.fill('#bol-palavras', 'limpeza, informática');
      await p.click('#bol-salvar');
      await p.waitForFunction(() => /Oportunidades encontradas|Nenhuma oportunidade/.test(document.getElementById('bol-resultado').innerText), null, { timeout: 60000 });
      const meta = await p.innerText('#bol-meta');
      exigir(!JARGAO.test(meta) && !/PNCP/.test(meta), 'meta do boletim técnica: ' + meta);
      await p.waitForSelector('.bol-cal-titulo', { timeout: 60000 });
      const titulo = await p.evaluate(() => document.querySelector('.bol-cal-titulo')?.innerText || '');
      exigir(/^[A-ZÇ][a-zç]+ de \d{4}$/.test(titulo), `título do calendário "${titulo}"`);
      await semJargao(p, '#boletim');
      const qtd = await p.$$eval('#bol-resultado .boletim-card', (c) => c.length);
      const opts = await p.$$eval('#bol-empresa option', (o) => o.map((x) => x.value));
      await p.selectOption('#bol-empresa', opts[1]); await p.waitForTimeout(3000);
      exigir(await p.inputValue('#bol-palavras') !== 'limpeza, informática', 'a outra empresa herdou o filtro da primeira');
      await p.selectOption('#bol-empresa', opts[0]); await p.waitForTimeout(3000);
      await p.click('#bol-atualizar'); await p.waitForTimeout(4000);
      await semJargao(p, '#boletim');
      return `${qtd} cartões · calendário "${titulo}" · meta: ${meta.slice(0, 110)}`;
    });

    await passo('1280 · Boletim: link do e-mail abre a edição; edição inexistente avisa', p, async () => {
      const ed = await banco('oportunidades_abertas?select=numero_controle_pncp&limit=3');
      ctx.edicao = (await servico('POST', '/rest/v1/boletim_edicoes?on_conflict=cliente_id,edicao,filtro_id', { cliente_id: U.gestor.id, edicao: '2026-11-18', filtro_id: 'principal',
        empresa: 'Materiais Horizonte Teste LTDA', quantidade: 4, numeros: ed.map((e) => e.numero_controle_pncp).concat(['00000000000000-1-000001/2020']) },
      { Prefer: 'resolution=merge-duplicates,return=representation' }))[0];
      await abrirPainel(p, '?edicao=2026-11-18&filtro=principal#boletim');
      await p.waitForFunction(() => /Edição de 18\/11\/2026/.test(document.getElementById('bol-meta').innerText), null, { timeout: 20000 });
      await p.waitForFunction(() => /Oportunidades encontradas/.test(document.getElementById('bol-resultado').innerText), null, { timeout: 20000 });
      const aviso = await p.innerText('#bol-resultado .aviso');
      exigir(/1 de 4/.test(aviso), 'conta de editais encerrados errada: ' + aviso);
      await semJargao(p, '#boletim');
      await p.click('#bol-edicao-hoje'); await p.waitForTimeout(3000);
      exigir(!/Edição de/.test(await p.innerText('#bol-meta')), '"Voltar ao boletim de hoje" não voltou');
      await abrirPainel(p, '?edicao=2025-01-01#boletim'); await p.waitForTimeout(3000);
      exigir(/Não encontramos essa edição/.test(await p.innerText('#bol-filtro-status')), 'edição inexistente sem aviso');
      return `aviso: "${aviso}"`;
    });

    await passo('1280 · Encontrar Licitações: busca, cartão, resumo do edital e Sem interesse', p, async () => {
      await abrirPainel(p, '#oportunidades');
      await buscaLivre(p);
      await p.fill('#op-palavras', 'informática');
      await p.click('#op-buscar');
      await p.waitForSelector('#op-resultado .boletim-card', { timeout: 60000 });
      await semJargao(p, '#oportunidades');
      const card = p.locator('#op-resultado .boletim-card').first();
      await card.locator('button', { hasText: 'Acompanhar' }).first().click();
      exigir(/Tenho interesse/.test(await card.innerText()), 'Acompanhar não mostrou os status');
      await card.locator('button', { hasText: 'Anotar' }).first().click();
      exigir(/Anotação/.test(await card.innerText()), 'Anotar não abriu o campo');
      await card.locator('summary, button', { hasText: 'Ver detalhes do edital' }).first().click().catch(() => {});
      await card.locator('button', { hasText: 'Resumir edital' }).first().click();
      await p.waitForFunction(() => [...document.querySelectorAll('.modal-ia-fundo')].some((m) => getComputedStyle(m).display !== 'none' && /Resumo do Edital/.test(m.innerText)), null, { timeout: 30000 });
      const resumo = await p.evaluate(() => [...document.querySelectorAll('.modal-ia-fundo')].find((m) => getComputedStyle(m).display !== 'none').innerText);
      exigir(!/Ã[\u0080-\u00bf]/.test(resumo), 'resumo com acento quebrado');
      await p.keyboard.press('Escape');
      exigir(!(await p.evaluate(() => document.getElementById('modal-ia-fundo').classList.contains('aberto'))), 'Esc não fechou o resumo');
      await abrirPainel(p, '#oportunidades');
      await buscaLivre(p);
      await p.click('#op-buscar'); await p.waitForSelector('#op-resultado .boletim-card', { timeout: 60000 });
      const antes = await p.$$eval('#op-resultado .boletim-card:not(.oculto)', (c) => c.length);
      // A lista de "sem interesse" fica salva na conta: conta a partir do que já havia.
      const jaHavia = Number(((await p.textContent('#op-sem-interesse-restaurar')) || '').match(/\d+/)?.[0] || 0);
      await p.locator('#op-resultado .boletim-card').first().locator('button', { hasText: 'Sem interesse' }).click(); await p.waitForTimeout(800);
      const restaurar = await p.innerText('#op-sem-interesse-restaurar');
      const n = jaHavia + 1;
      exigir(restaurar.trim() === `Restaurar ${n} ${n === 1 ? 'edital marcado' : 'editais marcados'} como sem interesse`, `botão restaurar: "${restaurar}" (esperado ${n})`);
      await p.click('#op-sem-interesse-restaurar'); await p.waitForTimeout(800);
      return `${antes} cartões · resumo abriu (${resumo.split('\n')[0]}) · "${restaurar.trim()}"`;
    });

    await passo('1280 · Encontrar Licitações: Já tenho o número, Mais filtros, órgãos, filtro salvo, receber no Boletim', p, async () => {
      await abrirPainel(p, '#oportunidades');
      await buscaLivre(p);
      await p.click('#op-numero summary');
      await p.click('#op-numero-buscar'); await p.waitForTimeout(500);
      exigir(/Confira/.test(await p.innerText('#op-numero-status')), 'número vazio sem orientação');
      await p.fill('#op-numero-uasg', '158465'); await p.fill('#op-numero-num', '90012/2026'); await p.click('#op-numero-buscar');
      await p.waitForFunction(() => !/Procurando|Buscando/i.test(document.getElementById('op-numero-status').innerText) && document.getElementById('op-numero-status').innerText.length > 10, null, { timeout: 30000 });
      const numero = await p.innerText('#op-numero-status');
      exigir(!/PNCP|base/.test(numero), 'número: texto técnico: ' + numero);
      await p.click('#op-mais-filtros summary');
      exigir(await p.isVisible('#op-modalidade'), 'Mais filtros não abriu');
      await semJargao(p, '#op-mais-filtros');
      await p.click('#op-orgaos summary');
      await p.selectOption('#op-orgaos-uf', 'AM'); await p.click('#op-orgaos-form button[type=submit]');
      await p.waitForFunction(() => /órgão\(s\)|Não foi possível/.test(document.getElementById('op-orgaos-status').innerText), null, { timeout: 30000 });
      const orgaos = await semJargao(p, '#op-orgaos');
      await p.fill('#op-palavras', 'limpeza');
      await p.click('#op-salvos-salvar'); await p.fill('#op-salvos-nome', `Limpeza e2e ${Date.now() % 100000}`); await p.click('#op-salvos-confirmar');
      await p.waitForFunction(() => /salvo/.test(document.getElementById('op-salvos-status').innerText), null, { timeout: 15000 });
      await p.click('#op-receber-boletim'); await p.waitForTimeout(3000);
      const receber = await p.innerText('#op-receber-boletim-status');
      exigir(/Pronto/.test(receber), 'receber no boletim: ' + receber);
      return `número: "${numero.replace(/\s+/g, ' ')}" · órgãos: ${orgaos.split('\n')[0].slice(0, 90)} · ${receber}`;
    });

    await passo('375 · celular: Início, Boletim e Busca sem rolagem lateral; gráfico do mês inteiro', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await abrirPainel(p);
      exigir(await rolagemLateral(p) <= 0, 'Início com rolagem lateral: ' + await largos(p));
      const barras = await p.evaluate(() => { const g = document.getElementById('dash-grafico-dias'); const cols = [...g.children]; const r = g.getBoundingClientRect();
        return { n: cols.length, fora: cols.filter((c) => c.getBoundingClientRect().right > r.right + 1).length }; });
      exigir(barras.n >= 28 && barras.fora === 0, `gráfico: ${barras.fora} de ${barras.n} dias escondidos`);
      await p.click('#nav-gaveta-btn'); await p.click('#menu-principal button[data-alvo="boletim"]'); await p.waitForTimeout(2500);
      exigir(await secaoAtiva(p) === 'boletim' && !(await p.evaluate(() => document.getElementById('menu-principal').classList.contains('gaveta-aberta'))), 'gaveta do menu não levou ao Boletim');
      exigir(await rolagemLateral(p) <= 0, 'Boletim com rolagem lateral: ' + await largos(p));
      await abrirPainel(p, '#oportunidades');
      await buscaLivre(p);
      await p.click('#op-buscar'); await buscaLivre(p);
      exigir(await rolagemLateral(p) <= 0, 'resultado da busca com rolagem lateral: ' + await largos(p));
      if (!(await p.evaluate(() => document.getElementById('op-orgaos').open))) await p.click('#op-orgaos summary'); await p.selectOption('#op-orgaos-uf', 'AM'); await p.click('#op-orgaos-form button[type=submit]');
      await p.waitForFunction(() => /órgão\(s\)/.test(document.getElementById('op-orgaos-status').innerText), null, { timeout: 30000 });
      const rol = await rolagemLateral(p);
      exigir(rol <= 0, `Busca com rolagem lateral de ${rol}px: ${await largos(p)}`);
      return `30 dias à vista (${barras.n} barras); sem rolagem lateral`;
    });

    await passo('Prospecção: estado do perfil, abas e menu', p, async () => {
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.goto(SITE + '/prospeccao.html');
      await p.waitForFunction(() => !/Carregando/.test(document.getElementById('tabela-corpo').innerText), null, { timeout: 30000 });
      const uf = await p.inputValue('#f-uf');
      exigir(uf === 'AM', `UF inicial "${uf}" (esperado o estado do perfil/boletim)`);
      const abas = [];
      for (const aba of ['irp', 'ata', 'contrato', 'pca']) {
        await p.click(`.aba[data-aba=${aba}]`);
        await p.waitForFunction(() => !/Carregando/.test(document.getElementById('tabela-corpo').innerText), null, { timeout: 30000 });
        const corpo = await p.innerText('#tabela-corpo');
        exigir(!/PNCP|módulo|PCA\/PGC com/.test(corpo), `aba ${aba} com texto técnico: ${corpo.slice(0, 120)}`);
        abas.push(`${aba}: ${corpo.split('\n')[0].slice(0, 50)}`);
      }
      exigir(!/Status/.test(await p.innerText('#menu-principal')), 'menu da Prospecção ainda mostra o Status das Ferramentas (é só do admin)');
      await p.setViewportSize({ width: 375, height: 812 }); await p.waitForTimeout(500);
      exigir(await rolagemLateral(p) <= 0, 'Prospecção com rolagem lateral');
      return `UF ${uf} · ${abas.join(' | ')} · origem: ${await p.innerText('#origem-filtro')}`;
    });

    await passo('Console: nenhum erro de JavaScript na área', p, async () => {
      const js = errosJs(p);
      exigir(!js.length, js.join(' | '));
      return `${p.erros.length} aviso(s) de rede ignorados (IA sem chave no local)`;
    });
    await p.context().close();
  } finally {
    if (ctx.edicao) await servico('DELETE', `/rest/v1/boletim_edicoes?id=eq.${ctx.edicao.id}`).catch(() => {});
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} passos ok`);
  if (falhas.length) process.exit(1);
}
if (require.main === module) main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
