/* global document -- usado só dentro de p.evaluate (roda no navegador) */
// E2E do aviso do Boletim: abre o link do e-mail deslogado -> login -> cai na edição daquele dia; edições dos dias
// anteriores listadas; ?volta=//evil.com não leva para fora. Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8794 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8794 node ambiente-teste/e2e-boletim-login.cjs
// Edições e editais fictícios criados aqui são apagados no fim.
const path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-boletim-login';
const { passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation', ...extra } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const errosJs = (p) => p.erros.filter((e) => e.startsWith('pageerror') || e.startsWith('console'));
const dia = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

async function entrarPeloFormulario(p, u) {
  await p.fill('#email', u.email); await p.fill('#senha', u.senha);
  await p.click('#btn-entrar');
}

async function main() {
  const u = seed.usuarios.gestor;
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const numeros = ['99999999000199-1-000901/2026', '99999999000199-1-000902/2026'];
  try {
    await servico('POST', '/rest/v1/oportunidades_abertas?on_conflict=chave', numeros.map((n, i) => ({
      chave: n, numero_controle_pncp: n, objeto: `Aquisição fictícia de material de limpeza ${i + 1} (teste do boletim)`, uf: 'AM',
      publicacao: dia(0), encerramento: dia(-20),
      dado: { numeroControlePNCP: n, objeto: `Aquisição fictícia de material de limpeza ${i + 1} (teste do boletim)`, orgao: 'Órgão Fictício de Teste', uf: 'AM',
        municipio: 'Manaus', publicacao: dia(0), encerramento: dia(-20), modalidade: 'Pregão Eletrônico', valorEstimado: 1000 * (i + 1) },
    })), { Prefer: 'resolution=merge-duplicates,return=minimal' });
    await servico('POST', '/rest/v1/boletim_edicoes?on_conflict=cliente_id,edicao,filtro_id', [
      { cliente_id: u.id, edicao: dia(0), filtro_id: 'principal', filtro_nome: 'limpeza, higiene', empresa: 'Empresa Fictícia de Teste', quantidade: 2, numeros },
      { cliente_id: u.id, edicao: dia(1), filtro_id: 'principal', filtro_nome: 'limpeza, higiene', empresa: 'Empresa Fictícia de Teste', quantidade: 1, numeros: [numeros[0]] },
    ], { Prefer: 'resolution=merge-duplicates,return=minimal' });

    const p = await novaPagina(navegador);
    const link = `${SITE}/painel.html?edicao=${dia(0)}&filtro=principal#boletim`;

    await passo('link do e-mail deslogado leva ao login com retorno só interno', p, async () => {
      await p.goto(link);
      await p.waitForURL(/login\.html/, { timeout: 20000 });
      const voltar = new URL(p.url()).searchParams.get('voltar');
      exigir(voltar && voltar.startsWith('/') && !voltar.startsWith('//'), 'voltar inválido: ' + voltar);
      exigir(!/@|token|cnpj/i.test(p.url()), 'dado pessoal na URL: ' + p.url());
      return `voltar=${voltar}`;
    });
    await p.screenshot({ path: path.join(PRINTS, 'login-vindo-do-link.png') });

    await passo('depois do login cai direto na edição do boletim', p, async () => {
      await entrarPeloFormulario(p, u);
      await p.waitForURL(/painel\.html/, { timeout: 30000 });
      await p.waitForSelector('#boletim.ativa', { timeout: 20000 });
      await p.waitForFunction(() => /Edição de/.test(document.getElementById('bol-meta')?.innerText || ''), null, { timeout: 20000 });
      await p.waitForSelector('#bol-resultado .boletim-card', { timeout: 20000 });
      const cards = await p.locator('#bol-resultado .boletim-card').count();
      const meta = await p.innerText('#bol-meta');
      exigir(cards === 2, `esperava 2 licitações da edição, vieram ${cards}`);
      const url = new URL(p.url());
      exigir(url.hash === '#boletim' && url.searchParams.get('edicao') === dia(0), 'URL após login: ' + p.url());
      return `${cards} licitações · ${meta}`;
    });
    await p.screenshot({ path: path.join(PRINTS, 'boletim-edicao-do-dia.png'), fullPage: true });

    await passo('edições dos dias anteriores por empresa e filtro; abrir a de ontem', p, async () => {
      const grupo = (await p.innerText('#bol-edicoes')).replace(/\s+/g, ' ');
      exigir(/Empresa Fictícia de Teste · filtro: limpeza, higiene/.test(grupo), 'grupo empresa/filtro ausente: ' + grupo);
      await p.click(`#bol-edicoes [data-edicao]:has-text("${dia(1).split('-').reverse().join('/')}")`);
      await p.waitForFunction(() => document.querySelectorAll('#bol-resultado .boletim-card').length === 1, null, { timeout: 15000 });
      return grupo.slice(0, 160);
    });
    await p.screenshot({ path: path.join(PRINTS, 'boletim-edicao-anterior.png'), fullPage: true });

    await passo('"Voltar ao boletim de hoje" sai do modo edição', p, async () => {
      await p.click('#bol-edicao-hoje');
      await p.waitForFunction(() => !/Edição de/.test(document.getElementById('bol-meta')?.innerText || ''), null, { timeout: 20000 });
      return (await p.innerText('#bol-meta')).slice(0, 120);
    });

    await passo('?volta=//evil.com não redireciona para fora (e demais destinos ruins)', null, async () => {
      const p2 = await novaPagina(navegador);
      await p2.goto(SITE + '/login.html?volta=' + encodeURIComponent('//evil.com/painel'));
      await entrarPeloFormulario(p2, u);
      await p2.waitForURL(/painel\.html/, { timeout: 30000 });
      exigir(new URL(p2.url()).origin === new URL(SITE).origin, 'saiu do site: ' + p2.url());
      const p3 = await novaPagina(navegador);
      await p3.goto(SITE + '/login.html');
      const r = await p3.evaluate(() => ['//evil.com', 'http://evil.com', 'https://evil.com/x', 'javascript:alert(1)', '/\\evil.com', '/\t/evil.com', 'evil.com', '/painel.html?edicao=2026-11-20#boletim']
        .map((v) => [v, destinoSeguro(v)])); // eslint-disable-line no-undef
      const ruins = r.slice(0, 7).filter(([, d]) => d !== 'painel.html');
      exigir(!ruins.length, 'destino ruim aceito: ' + JSON.stringify(ruins));
      exigir(r[7][1] === '/painel.html?edicao=2026-11-20#boletim', 'caminho interno recusado: ' + r[7][1]);
      return 'login com volta=//evil.com ficou em ' + p2.url().replace(SITE, '') + '; 7 destinos externos caem em painel.html';
    });

    const js = errosJs(p);
    await passo('sem erro de JavaScript na página', null, async () => { exigir(!js.length, js.join(' | ')); });
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
