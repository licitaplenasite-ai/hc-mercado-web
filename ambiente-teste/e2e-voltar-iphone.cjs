/* global document, window, history -- usados só dentro de p.evaluate (roda no navegador) */
// E2E 24/11 (dono, iPhone/Safari): link do e-mail -> login -> Boletim; "Resumir edital" -> gesto de voltar fecha o
// resumo e fica no Boletim logado (antes caía no login). WebKit com o perfil do iPhone 13.
//   PORTA_TESTE=8796 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8796 node ambiente-teste/e2e-voltar-iphone.cjs   (DISPOSITIVO="iPhone SE" para 375px)
// Edições e editais fictícios criados aqui são apagados no fim.
const path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-voltar-iphone';
const { passo, exigir, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { webkit, devices } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation', ...extra } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const dia = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const noBoletim = (p) => p.waitForSelector('#boletim.ativa #bol-resultado .boletim-card', { timeout: 30000 });
const modalAberto = (p) => p.evaluate(() => document.getElementById('modal-ia-fundo').classList.contains('aberto'));

async function main() {
  const u = seed.usuarios.gestor;
  const navegador = await webkit.launch({ headless: process.env.VER !== '1' });
  const numeros = ['99999999000199-1-000911/2026', '99999999000199-1-000912/2026'];
  try {
    await servico('POST', '/rest/v1/oportunidades_abertas?on_conflict=chave', numeros.map((n, i) => ({
      chave: n, numero_controle_pncp: n, objeto: `Aquisição fictícia de material de limpeza ${i + 1} (EXEMPLO de teste)`, uf: 'AM',
      publicacao: dia(0), encerramento: dia(-20),
      dado: { numeroControlePNCP: n, objeto: `Aquisição fictícia de material de limpeza ${i + 1} (EXEMPLO de teste)`, orgao: 'Órgão Fictício de Teste', uf: 'AM',
        municipio: 'Manaus', publicacao: dia(0), encerramento: dia(-20), modalidade: 'Pregão Eletrônico', valorEstimado: 1000 * (i + 1) },
    })), { Prefer: 'resolution=merge-duplicates,return=minimal' });
    await servico('POST', '/rest/v1/boletim_edicoes?on_conflict=cliente_id,edicao,filtro_id', [
      { cliente_id: u.id, edicao: dia(0), filtro_id: 'principal', filtro_nome: 'limpeza, higiene', empresa: 'Empresa Fictícia de Teste', quantidade: 2, numeros },
    ], { Prefer: 'resolution=merge-duplicates,return=minimal' });

    const contexto = await navegador.newContext({ ...devices[process.env.DISPOSITIVO || 'iPhone 13'], locale: 'pt-BR' });
    const p = await contexto.newPage();
    const erros = [];
    p.on('pageerror', (e) => erros.push(e.message));
    const link = `${SITE}/painel.html?edicao=${dia(0)}&filtro=principal#boletim`;

    await passo('link do e-mail sem sessão vai ao login guardando o #boletim', p, async () => {
      await p.goto(link);
      await p.waitForURL(/login\.html/, { timeout: 20000 });
      const voltar = new URL(p.url()).searchParams.get('voltar');
      exigir(voltar === `/painel.html?edicao=${dia(0)}&filtro=principal#boletim`, 'voltar sem o #boletim: ' + voltar);
      return 'voltar=' + voltar;
    });
    await p.screenshot({ path: path.join(PRINTS, '1-login-vindo-do-email.png') });

    await passo('depois do login cai no Boletim (edição do dia), sem o login no histórico', p, async () => {
      await p.fill('#email', u.email); await p.fill('#senha', u.senha);
      await p.click('#btn-entrar');
      await p.waitForURL(/painel\.html/, { timeout: 30000 });
      await noBoletim(p);
      const url = new URL(p.url());
      exigir(url.hash === '#boletim', 'hash: ' + url.hash);
      return 'history.length=' + await p.evaluate(() => history.length);
    });
    await p.screenshot({ path: path.join(PRINTS, '2-boletim-depois-do-login.png') });

    let rolagem = 0;
    await passo('Resumir edital abre o resumo', p, async () => {
      const botao = p.locator('#bol-resultado .boletim-card').nth(1).locator('.btn-ia-edital').first();
      await botao.scrollIntoViewIfNeeded();
      rolagem = await p.evaluate(() => window.scrollY);
      await botao.click();
      await p.waitForSelector('#modal-ia-fundo.aberto', { timeout: 10000 });
      return 'scrollY=' + rolagem;
    });
    await p.screenshot({ path: path.join(PRINTS, '3-resumo-aberto.png') });

    await passo('gesto de voltar fecha o resumo e fica no Boletim logado, na mesma posição', p, async () => {
      await p.goBack();
      await p.waitForFunction(() => !document.getElementById('modal-ia-fundo').classList.contains('aberto'), null, { timeout: 5000 });
      exigir(/painel\.html/.test(p.url()) && !/login/.test(p.url()), 'saiu do painel: ' + p.url());
      exigir(await p.isVisible('#boletim.ativa'), 'Boletim não está ativo');
      const y = await p.evaluate(() => window.scrollY);
      exigir(Math.abs(y - rolagem) < 40, `posição mudou: ${rolagem} -> ${y}`);
      return 'url=' + p.url().replace(SITE, '') + ' scrollY=' + y;
    });
    await p.screenshot({ path: path.join(PRINTS, '4-voltou-ao-boletim.png') });

    await passo('voltar fecha também o Lembrete e a gaveta do menu', p, async () => {
      // O card do Boletim não tem o botão Lembrete (fica no Encontrar licitações): abre o mesmo modal pela classe.
      await p.evaluate(() => document.getElementById('modal-lembrete-fundo').classList.add('aberto'));
      await p.waitForSelector('#modal-lembrete-fundo.aberto', { timeout: 10000 });
      await p.screenshot({ path: path.join(PRINTS, '4b-lembrete-aberto.png') });
      await p.goBack();
      await p.waitForSelector('#modal-lembrete-fundo:not(.aberto)', { state: 'attached', timeout: 5000 });
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.click('#nav-gaveta-btn');
      await p.waitForSelector('#menu-principal.gaveta-aberta', { timeout: 5000 });
      await p.goBack();
      await p.waitForSelector('#menu-principal:not(.gaveta-aberta)', { state: 'attached', timeout: 5000 });
      exigir(/painel\.html/.test(p.url()) && await p.isVisible('#boletim.ativa'), 'saiu do Boletim: ' + p.url());
      return 'Lembrete e gaveta fechados pelo voltar; url=' + p.url().replace(SITE, '');
    });

    await passo('fechar pelo X não deixa voltar extra; voltar de novo não cai no login', p, async () => {
      await p.locator('#bol-resultado .boletim-card .btn-ia-edital').first().click();
      await p.waitForSelector('#modal-ia-fundo.aberto');
      await p.click('#modal-ia-fechar');
      await p.waitForFunction(() => !(history.state && history.state.voltarFecha), null, { timeout: 5000 });
      exigir(!(await modalAberto(p)), 'resumo continuou aberto');
      await p.goBack().catch(() => null);
      await p.waitForTimeout(800);
      exigir(!/login\.html/.test(p.url()), 'voltar caiu no login: ' + p.url());
      return 'depois do voltar: ' + p.url();
    });

    await passo('com sessão, o link do e-mail abre direto o Boletim', p, async () => {
      const p2 = await contexto.newPage();
      await p2.goto(link);
      await noBoletim(p2);
      exigir(/painel\.html/.test(p2.url()) && new URL(p2.url()).hash === '#boletim', 'url: ' + p2.url());
      await p2.screenshot({ path: path.join(PRINTS, '5-link-com-sessao.png') });
      return p2.url().replace(SITE, '');
    });

    await passo('sem erro de JavaScript na página', null, async () => { exigir(!erros.length, erros.join(' | ')); });
  } finally {
    await servico('DELETE', `/rest/v1/boletim_edicoes?cliente_id=eq.${seed.usuarios.gestor.id}&numeros=cs.{${numeros[0]}}`).catch(() => null);
    await servico('DELETE', `/rest/v1/oportunidades_abertas?chave=in.(${numeros.map((n) => '"' + n + '"').join(',')})`).catch(() => null);
    await navegador.close();
  }
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(falhas ? `${falhas} passo(s) com falha` : 'tudo certo');
  process.exitCode = falhas ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
