/* global document, window, getComputedStyle -- usados só dentro de p.evaluate (roda no navegador) */
// Pente fino da parte pública e das ferramentas: página de venda, login (com "Esqueci minha senha"), cadastro,
// Central de Ajuda, HC, extensão, SINAPI, BDI e Mão de obra, em 1280 e 375 px, deslogado e logado.
//   PORTA_TESTE=8815 node ambiente-teste/servidor.cjs   e depois   PORTA_TESTE=8815 node ambiente-teste/e2e-pente-fino-publico.cjs
// SO_ESTATICO=1: só o que não escreve no banco (para rodar sem o cadeado do Docker).
// Contas criadas aqui (cadastro e troca de senha) são apagadas no fim. Nenhum e-mail sai: o Supabase local guarda no Mailpit.
const path = require('node:path');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-publico';
const { passo, exigir, novaPagina, entrar, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const admin = (metodo, caminho, corpo) => fetch(chaves.API_URL + '/auth/v1/admin' + caminho, {
  method: metodo, body: corpo && JSON.stringify(corpo),
  headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json' },
}).then(async (r) => { const t = await r.text(); if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; });
// Erros de JavaScript da página (o 4xx de recurso de terceiros fica de fora; o Turnstile local usa a chave de teste).
const errosJs = (p) => p.erros.filter((e) => e.startsWith('pageerror') || (e.startsWith('console') && !/turnstile|challenges\.cloudflare|Failed to load resource/i.test(e)));
const PROIBIDO = /\b(JSON|RPC|fail-open|undefined|null|NaN|\[object|app\b)|\{'tipo'|5 dias (gr|de teste)|em breve\)/;
const semRolagemLateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function textoLimpo(p) {
  const t = await p.evaluate(() => document.body.innerText);
  const achado = t.match(PROIBIDO);
  exigir(!achado, `texto proibido na tela: "${achado && achado[0]}"`);
  return t;
}
// Todo link interno da página responde 200 (sem 404) e toda âncora "#x" tem destino.
async function linksVivos(p) {
  const links = await p.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
  const internos = [...new Set(links.filter((h) => !/^(https?:|mailto:|tel:|javascript:)/i.test(h) && h !== '#'))];
  const quebrados = [];
  for (const h of internos) {
    if (h.startsWith('#')) { if (!(await p.$(`[id="${h.slice(1)}"]`))) quebrados.push(h); continue; }
    const url = new URL(h, p.url()); url.hash = '';
    const r = await fetch(url.href, { redirect: 'manual' });
    if (r.status >= 400) quebrados.push(`${h} (${r.status})`);
  }
  exigir(quebrados.length === 0, 'links quebrados: ' + quebrados.join(', '));
  return internos.length;
}

async function main() {
  const navegador = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: process.env.VER !== '1' });
  const limpar = [];
  const comBanco = !process.env.SO_ESTATICO;
  try {
    for (const [largura, altura] of [[1280, 900], [375, 812]]) {
      const tam = `${largura}px`;
      const p = await novaPagina(navegador);
      await p.setViewportSize({ width: largura, height: altura });

      await passo(`${tam} página de venda: links, âncoras, texto e rolagem`, p, async () => {
        await p.goto(SITE + '/index.html');
        await p.waitForFunction(() => !/Carregando/.test(document.getElementById('cv-preview-lista').innerText), null, { timeout: 20000 });
        const n = await linksVivos(p);
        const t = await textoLimpo(p);
        exigir(/14 dias/.test(t) && !/\b5 dias/.test(t), 'dias de teste incoerentes');
        exigir(/(Chegou 1 nova|Chegaram \d+ novas) licitaç/.test(await p.innerText('#email-titulo')), 'boletim de exemplo fora do formato do e-mail');
        exigir(await semRolagemLateral(p), 'rolagem lateral');
        exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
        return `${n} links internos ok`;
      });
      await passo(`${tam} página de venda: busca vazia avisa, sugestão busca, tema e perguntas`, p, async () => {
        await p.click('#busca-botao');
        exigir(await p.isVisible('#busca-erro'), 'busca vazia sem aviso');
        await p.click('.sugestao >> nth=0');
        await p.waitForFunction(() => !/Consultando/.test(document.getElementById('busca-resultados').innerText) && document.getElementById('busca-resultados').innerText.trim(), null, { timeout: 20000 });
        const res = await p.innerText('#busca-resultados');
        exigir(/licitaç|Nenhuma licitação|não respondeu/i.test(res), 'busca sem resposta: ' + res.slice(0, 120));
        await p.click('#tema'); exigir(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'tema');
        await p.click('#tema');
        for (const s of await p.$$('#perguntas summary')) await s.click();
        exigir(await p.$$eval('#perguntas details[open]', (d) => d.length) === 6, 'perguntas não abriram');
        exigir(/Lance com 1 clique/.test(await p.innerText('#perguntas')), 'pergunta do lance incoerente com a extensão');
        exigir(await semRolagemLateral(p), 'rolagem lateral depois da busca');
        return res.split('\n')[0];
      });

      if (comBanco) await passo(`${tam} login: avisos, esqueci a senha sem e-mail e com e-mail`, p, async () => {
        await p.goto(SITE + '/login.html?aviso=analise');
        exigir(/em análise/.test(await p.innerText('#aviso')), 'aviso analise');
        await p.goto(SITE + '/login.html?aviso=%3Cb%3Ex');
        exigir(!(await p.isVisible('#aviso')), 'aviso desconhecido apareceu');
        await p.click('#btn-esqueci');
        exigir(/Digite o seu e-mail/.test(await p.innerText('#aviso')), 'esqueci sem e-mail');
        await p.fill('#email', `nao-existe-${Date.now()}@exemplo.test`);
        await p.click('#btn-esqueci');
        await p.waitForFunction(() => /enviamos um link|Aguarde/.test(document.getElementById('aviso').innerText), null, { timeout: 15000 });
        await linksVivos(p); await textoLimpo(p);
        exigir(await semRolagemLateral(p), 'rolagem lateral');
        exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
        return await p.innerText('#aviso');
      });
      if (comBanco) await passo(`${tam} login: senha errada mostra frase simples`, p, async () => {
        await p.goto(SITE + '/login.html');
        await p.fill('#email', seed.usuarios.gestor.email); await p.fill('#senha', 'senha-errada-123');
        await p.click('#btn-entrar');
        await p.waitForFunction(() => /incorretos/.test(document.getElementById('aviso').innerText), null, { timeout: 15000 });
        return 'ok';
      });

      await passo(`${tam} cadastro: validações, janelas de segmento e estados`, p, async () => {
        await p.goto(SITE + '/cadastro.html');
        const t = await textoLimpo(p);
        exigir(/14 dias/.test(t) && !/\b5 dias/.test(t), 'dias de teste incoerentes no cadastro');
        await p.fill('#nome', 'Teste Pente Fino'); await p.fill('#email', 'a@exemplo.test'); await p.fill('#email_confirmar', 'b@exemplo.test');
        await p.fill('#senha', 'abc12345'); await p.fill('#senha_confirmar', 'abc12345'); await p.check('#aceite_termos');
        await p.click('#btn-criar');
        exigir(/e-mails não coincidem/.test(await p.innerText('#aviso')), 'e-mails diferentes');
        await p.fill('#email_confirmar', 'a@exemplo.test');
        await p.click('#btn-criar');
        exigir(/Selecione o segmento/.test(await p.innerText('#aviso')), 'sem segmento');
        await p.click('#campo-segmento-display'); await p.click('#modal-segmento-adicionar');
        exigir(/ao menos um segmento/.test(await p.innerText('#aviso')), 'modal sem escolha');
        await p.check('.segmento-opcao >> nth=30'); await p.click('#modal-segmento-adicionar');
        exigir(/LIMPEZA/.test(await p.innerText('#campo-segmento-display')), 'segmento escolhido');
        await p.click('#campo-estados-display'); await p.check('#abr-nacional'); await p.click('#modal-abrangencia-selecionar');
        exigir(/Nacional/.test(await p.innerText('#campo-estados-display')), 'nacional');
        await p.click('#campo-estados-display'); await p.keyboard.press('Escape');
        exigir(!(await p.isVisible('#modal-abrangencia-fundo')), 'Esc não fechou');
        await linksVivos(p);
        exigir(await semRolagemLateral(p), 'rolagem lateral');
        exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
        return 'ok';
      });

      await passo(`${tam} Central de Ajuda: busca, artigos com imagem, sem WhatsApp vazio`, p, async () => {
        await p.goto(SITE + '/ajuda.html');
        await textoLimpo(p);
        exigir(!(await p.isVisible('#zap-fixo')), 'botão de WhatsApp sem número apareceu');
        await p.fill('#busca-ajuda', 'boletim');
        const visiveis = await p.$$eval('#tutoriais > ul > li:not([hidden])', (l) => l.length);
        exigir(visiveis >= 1 && visiveis < (await p.$$eval('#tutoriais > ul > li', (l) => l.length)), 'busca não filtrou');
        await p.fill('#busca-ajuda', 'palavrainexistentexyz');
        exigir(await p.isVisible('#sem-resultado') && await p.$('#sem-resultado a[href^="mailto:"]'), 'sem resultado sem contato');
        await p.fill('#busca-ajuda', '');
        for (const s of await p.$$('#tutoriais summary')) await s.click();
        await p.waitForTimeout(800);
        const quebradas = await p.$$eval('#tutoriais img', (is) => is.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
        exigir(quebradas.length === 0, 'imagens quebradas: ' + quebradas.join(', '));
        const n = await linksVivos(p);
        exigir(await semRolagemLateral(p), 'rolagem lateral');
        exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
        return `${visiveis} artigo(s) de boletim · ${n} links`;
      });
      await passo(`${tam} páginas de SEO (ferramentas, públicos, blog, glossário, assessoria) e 404 de verdade`, p, async () => {
        const paginas = ['/ferramentas/', '/ferramentas/orcamento-de-obras', '/para/mei-e-pequena-empresa', '/blog/', '/blog/mei-em-licitacao', '/blog/categoria/obras-e-engenharia', '/glossario', '/sobre', '/contato', '/assessoria-hc'];
        let links = 0;
        for (const caminho of paginas) {
          await p.goto(SITE + caminho); await textoLimpo(p); links += await linksVivos(p);
          exigir(await semRolagemLateral(p), `rolagem lateral em ${caminho}`);
          exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
        }
        const r = await fetch(SITE + '/pagina-que-nao-existe-' + Date.now());
        exigir(r.status === 404 && /Página não encontrada/.test(await r.text()), 'endereço inexistente devia dar 404: ' + r.status);
        return `${paginas.length} páginas · ${links} links`;
      });
      await passo(`${tam} HC e extensão: links, pacote da extensão e imagem`, p, async () => {
        await p.goto(SITE + '/hc.html'); await textoLimpo(p); await linksVivos(p);
        exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
        await p.goto(SITE + '/extensao.html'); await textoLimpo(p); await linksVivos(p);
        const zip = await fetch(SITE + '/' + await p.getAttribute('a.btn-baixar', 'href'));
        exigir(zip.ok && (zip.headers.get('content-type') || '').includes('zip'), 'zip da extensão: ' + zip.status);
        exigir(await p.$eval('main img', (i) => i.complete && i.naturalWidth > 0), 'imagem da extensão');
        exigir(await semRolagemLateral(p), 'rolagem lateral');
        exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
        return `zip ${(await zip.arrayBuffer()).byteLength} bytes`;
      });
      await passo(`${tam} ferramentas deslogado: SINAPI e Mão de obra pedem login com retorno interno`, p, async () => {
        for (const pg of ['sinapi', 'mao-de-obra']) {
          await p.goto(`${SITE}/${pg}.html`);
          await p.waitForURL(/login\.html/, { timeout: 15000 });
          exigir(new URL(p.url()).searchParams.get('voltar') === '/' + pg, 'voltar ' + p.url());
        }
        return 'ok';
      });

      // Logado
      if (!comBanco) { await p.context().close(); continue; }
      await entrar(p, seed.usuarios.gestor);
      for (const pg of ['sinapi', 'bdi', 'mao-de-obra', 'ajuda', 'extensao', 'index']) {
        await passo(`${tam} logado: ${pg} sem erro, menu e links vivos, sem rolagem lateral`, p, async () => {
          p.erros.length = 0;
          await p.goto(`${SITE}/${pg}.html`);
          await p.waitForLoadState('networkidle');
          if (pg === 'sinapi') await p.waitForFunction(() => !/…/.test(document.getElementById('data-base').innerText), null, { timeout: 20000 });
          await textoLimpo(p);
          const n = await linksVivos(p);
          if (largura < 768 && await p.$('#nav-gaveta-btn')) {
            await p.click('#nav-gaveta-btn');
            exigir(await p.isVisible('#menu-principal'), 'menu do celular não abriu');
            await p.keyboard.press('Escape');
          }
          exigir(await semRolagemLateral(p), 'rolagem lateral');
          exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
          return `${n} links`;
        });
      }
      await passo(`${tam} logado: SINAPI busca curta avisa, busca por descrição responde, título no topo`, p, async () => {
        p.erros.length = 0;
        await p.goto(SITE + '/sinapi.html');
        await p.waitForFunction(() => !/…/.test(document.getElementById('data-base').innerText), null, { timeout: 20000 });
        await p.fill('#f-busca', 'a'); await p.click('#form-busca button[type=submit]');
        exigir(/Digite o código/.test(await p.innerText('#aviso')), 'busca curta sem aviso');
        await p.fill('#f-busca', 'alvenaria'); await p.click('#form-busca button[type=submit]');
        await p.waitForFunction(() => !/Busque pelo código|Buscando/.test(document.getElementById('tabela-corpo').innerText), null, { timeout: 20000 });
        // Página curta: o título fica logo abaixo do topo (antes ficava centralizado, com um vão em cima).
        exigir(await p.evaluate(() => document.querySelector('main').getBoundingClientRect().top) < 120, 'vão acima do título');
        exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
        return (await p.innerText('#tabela-corpo')).split('\n')[0].slice(0, 100);
      });
      await p.context().close();
    }

    // Troca de senha de ponta a ponta com uma conta temporária (link gerado pelo Supabase local; nada sai por e-mail).
    const p = await novaPagina(navegador);
    if (comBanco) {
    const email = `pf-publico-${Date.now()}@exemplo.test`;
    await passo('esqueci a senha: link do e-mail abre "Criar nova senha", troca e entra com a nova', p, async () => {
      const u = await admin('POST', '/users', { email, password: 'SenhaAntiga123', email_confirm: true, user_metadata: { nome: 'Teste Pente Fino' } });
      limpar.push(u.id);
      const link = await admin('POST', '/generate_link', { type: 'recovery', email });
      const r = await fetch(link.action_link || link.properties.action_link, { redirect: 'manual' });
      const destino = r.headers.get('location') || '';
      exigir(/type=recovery/.test(destino), 'link sem recuperação: ' + destino.slice(0, 80));
      await p.goto(SITE + '/login.html' + destino.slice(destino.indexOf('#')));
      await p.waitForSelector('#form-nova-senha:not([hidden])', { timeout: 15000 });
      exigir(/Criar nova senha/.test(await p.innerText('h1')), 'título');
      await p.fill('#nova-senha', 'SenhaNova456'); await p.fill('#nova-senha-confirmar', 'outra-senha');
      await p.click('#btn-nova-senha');
      exigir(/não coincidem/.test(await p.innerText('#aviso')), 'senhas diferentes');
      await p.fill('#nova-senha-confirmar', 'SenhaNova456'); await p.click('#btn-nova-senha');
      await p.waitForFunction(() => /Senha alterada/.test(document.getElementById('aviso').innerText), null, { timeout: 15000 });
      exigir(await p.isVisible('#form-login'), 'formulário de login não voltou');
      await p.fill('#email', email); await p.fill('#senha', 'SenhaNova456'); await p.click('#btn-entrar');
      // Conta nova ainda não aprovada: a mensagem de análise prova que a senha nova foi aceita.
      await p.waitForFunction(() => /em análise|Redirecionando/.test(document.getElementById('aviso').innerText), null, { timeout: 15000 });
      exigir(errosJs(p).length === 0, errosJs(p).join(' | '));
      return await p.innerText('#aviso');
    });
    await passo('cadastro completo cria a conta e mostra a mensagem de análise', p, async () => {
      const novo = `pf-cadastro-${Date.now()}@exemplo.test`;
      await p.goto(SITE + '/cadastro.html');
      await p.fill('#nome', 'Teste Pente Fino'); await p.fill('#empresa', 'Empresa Fictícia de Teste');
      await p.click('#campo-segmento-display'); await p.check('.segmento-opcao >> nth=30'); await p.click('#modal-segmento-adicionar');
      await p.fill('#email', novo); await p.fill('#email_confirmar', novo);
      await p.fill('#senha', 'abc12345'); await p.fill('#senha_confirmar', 'abc12345'); await p.check('#aceite_termos');
      await p.click('#btn-criar');
      await p.waitForFunction(() => /Cadastro criado|Não foi possível/.test(document.getElementById('aviso').innerText), null, { timeout: 20000 });
      const aviso = await p.innerText('#aviso');
      const lista = await admin('GET', '/users?per_page=200');
      const criado = (lista.users || []).find((x) => x.email === novo);
      if (criado) limpar.push(criado.id);
      exigir(/Cadastro criado/.test(aviso) && criado, aviso);
      return aviso;
    });

    }
    // E-mail do boletim gerado localmente (scripts/boletim_editais.py): computador e celular.
    const pastaEmail = process.env.EMAIL_BOLETIM_DIR;
    if (pastaEmail) {
      for (const [nome, largura] of [['boletim-com', 1280], ['boletim-com', 375], ['boletim-sem', 375]]) {
        await passo(`e-mail do boletim ${nome} em ${largura}px: logo, botão, rodapé e sem rolagem`, p, async () => {
          await p.setViewportSize({ width: largura, height: 900 });
          await p.goto('file:///' + path.join(pastaEmail, nome + '.html').replace(/\\/g, '/'));
          const t = await p.innerText('body');
          exigir(/LicitaPlena/.test(t) && /HCM LTDA/.test(t) && /não responda/.test(t), 'rodapé');
          if (nome === 'boletim-com') exigir(await p.getAttribute('a:has-text("Acessar o boletim")', 'href') === 'https://licitaplena.com.br/painel.html?edicao=2026-11-20&filtro=principal#boletim', 'link do botão');
          exigir(await p.getAttribute('img', 'src') === 'https://licitaplena.com.br/logo.png', 'logo');
          exigir(await semRolagemLateral(p), 'rolagem lateral');
          return t.split('\n').filter(Boolean).slice(1, 3).join(' · ');
        });
      }
    }
  } finally {
    for (const id of limpar) await admin('DELETE', '/users/' + id).catch(() => {});
    await navegador.close();
    const falhas = resultados.filter((r) => !r.ok).length;
    require('node:fs').writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
    console.log(`\n${resultados.length - falhas}/${resultados.length} passos ok`);
    process.exitCode = falhas ? 1 : 0;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
