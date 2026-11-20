/* global document, window, localStorage -- usados só dentro de p.evaluate/p.waitForFunction (rodam no navegador) */
// E2E local da busca v2 (ferramentas do Siga Pregão) e do Boletim por empresa. Ambiente: subir.cjs + servidor.cjs.
//   PORTA_TESTE=8892 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8892 node ambiente-teste/e2e-busca-v2.cjs
// PNCP simulado com fixture (page.route); o e-mail do boletim roda o robô de verdade contra o banco LOCAL com o
// envio SMTP e a busca do PNCP trocados por dublês (nada sai para a internet). Dado criado aqui é apagado no fim.
const path = require('node:path'), { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-busca-v2';
const { banco, passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const FUTURO = '2027-03-10T17:00:00';
const item = (num, objeto, extra = {}) => ({ numero_controle_pncp: `04312239000141-1-0002${num}/2026`, description: objeto, title: objeto, uf: 'AM', municipio_nome: 'Manaus',
  orgao_nome: 'Prefeitura de Manaus', data_fim_vigencia: FUTURO, data_publicacao_pncp: '2026-11-10T10:00:00', modalidade_licitacao_nome: 'Pregão - Eletrônico', ...extra });
const ITENS = [
  item(11, 'Papel sulfite A4 exclusiva para ME/EPP', { usuario_nome: 'Compras.gov.br', unidade_codigo: '158465', numero: '90012', ano: '2026' }),
  item(12, 'Papel toalha para escolas por registro de preços', { usuario_nome: 'BLL Compras' }),
  item(13, 'Papel sulfite colorido', { modalidade_licitacao_nome: 'Dispensa', data_fim_vigencia: '2027-04-01T10:00:00' }),
];
const psql = (sql) => { const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + r.stderr); return r.stdout.trim(); };
const cartoes = (p) => p.locator('#op-resultado .boletim-card');
async function buscar(p, palavras) {
  await p.fill('#op-palavras', palavras);
  await p.click('#op-buscar');
  await p.waitForSelector('#op-resultado .boletim-card, #op-resultado .aviso', { timeout: 20000 });
  await p.waitForTimeout(700);
}
async function irPara(p, alvo) { await p.locator(`nav button[data-alvo="${alvo}"]`).dispatchEvent('click'); await p.waitForTimeout(400); }
async function trocarEmpresa(p, id) {
  await p.selectOption('#bol-empresa', id);
  await p.waitForFunction((e) => window.__filtroBoletimEmpresa === e, id, { timeout: 15000 });
  await p.waitForTimeout(500);
}

(async () => {
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const g = seed.usuarios.gestor;
  const empresas = await banco(`operacao_empresas?select=id,razao_social,organizacao_id&razao_social=in.("Papelaria Aurora Teste LTDA","Materiais Horizonte Teste LTDA")&order=razao_social`);
  const [horizonte, aurora] = empresas; // ordem alfabética: Materiais Horizonte, Papelaria Aurora
  const limpar = () => psql(`delete from public.boletim_filtros_empresa where organizacao_id='${aurora.organizacao_id}'; delete from public.filtros_salvos where cliente_id='${g.id}';`);
  // Filtro antigo da conta (antes do boletim por empresa): tem que virar o da empresa ativa sem se perder.
  const legadoAntes = psql(`select coalesce(boletim_filtro::text,'null') from public.clientes where id='${g.id}';`);
  limpar();
  psql(`update public.clientes set boletim_filtro='{"ufs":["AM"],"uf":"AM","palavrasRaw":"papel legado"}' where id='${g.id}';`);
  const p = await novaPagina(nav, g);
  await p.evaluate((id) => localStorage.setItem('licitaplena_empresa_operacional_id', id), aurora.id);
  await p.route('**/api/pncp-proxy**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: ITENS, total: ITENS.length }) }));
  await p.goto(SITE + '/painel.html');
  await p.waitForFunction(() => window.__filtroBoletimEmpresa !== undefined && window.__filtroBoletimAtual, null, { timeout: 20000 });
  try {
    await passo('início mostra licitações publicadas hoje e a última novidade', p, async () => {
      await p.waitForFunction(() => document.getElementById('dash-faixa-publicadas').textContent.trim() !== '–', null, { timeout: 15000 });
      const faixa = await p.locator('#dash-faixa-hoje').innerText();
      exigir(/publicadas hoje/.test(faixa) && /Boletim e jornais por empresa/.test(faixa), faixa);
      return faixa.replace(/\s+/g, ' ');
    });
    await passo('migração: filtro antigo da conta vira o da empresa ativa (Aurora)', p, async () => {
      await irPara(p, 'boletim');
      exigir((await p.evaluate(() => window.__filtroBoletimAtual.filtro?.palavrasRaw)) === 'papel legado', 'filtro não migrou');
      const linhas = await banco(`boletim_filtros_empresa?select=empresa_id,filtro&organizacao_id=eq.${aurora.organizacao_id}`);
      exigir(linhas.length === 1 && linhas[0].empresa_id === aurora.id, JSON.stringify(linhas));
    });
    await passo('trocar para Horizonte: filtro vazio e oferta de copiar da Aurora', p, async () => {
      await trocarEmpresa(p, horizonte.id);
      exigir(await p.locator('#bol-config-painel').isVisible(), 'formulário não abriu para empresa sem filtro');
      exigir((await p.inputValue('#bol-palavras')) === '', 'Horizonte herdou filtro');
      exigir(await p.locator('#bol-copiar-campo').isVisible(), 'sem oferta de copiar');
      exigir(/Materiais Horizonte/.test(await p.locator('#bol-filtro-empresa').innerText()), 'nome da empresa não aparece');
    });
    await passo('Horizonte salva o próprio filtro (café/SP)', p, async () => {
      await p.evaluate(() => { const s = document.getElementById('bol-uf'); [...s.options].forEach((o) => { o.selected = o.value === 'SP'; }); });
      await p.fill('#bol-palavras', 'café');
      await p.click('#bol-salvar');
      await p.waitForFunction(() => window.__filtroBoletimAtual.filtro?.palavrasRaw === 'café', null, { timeout: 15000 });
      const linhas = await banco(`boletim_filtros_empresa?select=empresa_id,filtro&organizacao_id=eq.${aurora.organizacao_id}&order=empresa_id`);
      exigir(linhas.length === 2, JSON.stringify(linhas));
      exigir(linhas.find((l) => l.empresa_id === horizonte.id).filtro.palavrasRaw === 'café', 'Horizonte não gravou');
      exigir(linhas.find((l) => l.empresa_id === aurora.id).filtro.palavrasRaw === 'papel legado', 'Aurora mudou');
    });
    await passo('trocar e voltar: cada empresa mantém o seu filtro', p, async () => {
      await trocarEmpresa(p, aurora.id);
      exigir((await p.evaluate(() => window.__filtroBoletimAtual.filtro?.palavrasRaw)) === 'papel legado', 'Aurora perdeu filtro');
      await trocarEmpresa(p, horizonte.id);
      exigir((await p.evaluate(() => window.__filtroBoletimAtual.filtro?.palavrasRaw)) === 'café', 'Horizonte perdeu filtro');
      await p.reload();
      await p.waitForFunction(() => window.__filtroBoletimAtual?.filtro, null, { timeout: 20000 });
      exigir((await p.evaluate(() => window.__filtroBoletimAtual.filtro.palavrasRaw)) === 'café', 'recarregar não manteve a empresa ativa');
    });
    await irPara(p, 'oportunidades');
    await passo('sugestão de palavras enquanto digita', p, async () => {
      await p.fill('#op-palavras', 'papel s');
      await p.dispatchEvent('#op-palavras', 'input');
      await p.click('#op-sugestoes [data-termo="papel sulfite"]');
      exigir((await p.inputValue('#op-palavras')).startsWith('papel sulfite'), await p.inputValue('#op-palavras'));
    });
    await passo('pesquisa avançada: modalidade, portal, ME/EPP, SRP, limitar e abertura', p, async () => {
      await p.evaluate(() => { document.querySelector('#op-uf').querySelectorAll('option').forEach((o) => { o.selected = false; }); });
      await buscar(p, 'papel');
      const total = await cartoes(p).count();
      exigir(total === 3, 'busca base: ' + total);
      await p.locator('#op-mais-filtros > summary').click();
      const conta = async (prepara) => { await prepara(); await p.click('#op-buscar'); await p.waitForTimeout(900); const n = await cartoes(p).count(); await p.evaluate(() => {
        for (const id of ['op-modalidade', 'op-portal', 'op-periodo-por', 'op-data-de', 'op-data-ate']) document.getElementById(id).value = '';
        for (const id of ['op-me-epp', 'op-excluir-srp']) document.getElementById(id).checked = false;
        document.getElementById('op-limitar').value = ''; }); return n; };
      const r = {
        dispensa: await conta(() => p.selectOption('#op-modalidade', 'dispensa')),
        bll: await conta(() => p.selectOption('#op-portal', 'BLL')),
        mepp: await conta(() => p.check('#op-me-epp')),
        semSrp: await conta(() => p.check('#op-excluir-srp')),
        limitar: await conta(() => p.fill('#op-limitar', 'sulfite, colorido')),
        abertura: await conta(async () => { await p.selectOption('#op-periodo-por', 'abertura'); await p.fill('#op-data-de', '2027-03-31'); await p.fill('#op-data-ate', '2027-04-02'); }),
      };
      exigir(JSON.stringify(r) === JSON.stringify({ dispensa: 1, bll: 1, mepp: 1, semSrp: 2, limitar: 1, abertura: 1 }), JSON.stringify(r));
      return JSON.stringify(r);
    });
    await passo('jornal: salvar filtro com nome liga o e-mail diário na empresa ativa', p, async () => {
      await buscar(p, 'papel');
      await p.click('#op-salvos-salvar');
      await p.fill('#op-salvos-nome', 'Papel Manaus');
      await p.click('#op-salvos-confirmar');
      await p.waitForSelector('#op-jornais-lista li', { timeout: 10000 });
      const l = await banco(`filtros_salvos?select=nome,empresa_id,filtro&cliente_id=eq.${g.id}`);
      exigir(l.length === 1 && l[0].empresa_id === horizonte.id && l[0].filtro.jornal === true, JSON.stringify(l));
      exigir(await p.locator('#op-jornais-lista input[data-jornal="email"]').isChecked(), 'caixa do e-mail desligada');
    });
    await passo('jornal: desligar e religar o e-mail, ver resultado de hoje', p, async () => {
      await p.uncheck('#op-jornais-lista input[data-jornal="email"]'); await p.waitForTimeout(800);
      exigir((await banco(`filtros_salvos?select=filtro&cliente_id=eq.${g.id}`))[0].filtro.jornal === undefined, 'não desligou');
      await p.check('#op-jornais-lista input[data-jornal="email"]'); await p.waitForTimeout(800);
      exigir((await banco(`filtros_salvos?select=filtro&cliente_id=eq.${g.id}`))[0].filtro.jornal === true, 'não religou');
      await p.click('#op-jornais-lista button[data-jornal="hoje"]'); await p.waitForTimeout(1200);
      const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
      exigir((await p.inputValue('#op-data-de')) === hoje, 'data de hoje não aplicada');
    });
    await passo('jornal é da empresa: na Aurora a lista não mostra o jornal da Horizonte', p, async () => {
      await irPara(p, 'boletim'); await trocarEmpresa(p, aurora.id); await irPara(p, 'oportunidades');
      await p.waitForTimeout(800);
      exigir((await p.locator('#op-jornais-lista li').count()) === 0, 'jornal vazou para outra empresa');
      await irPara(p, 'boletim'); await trocarEmpresa(p, horizonte.id); await irPara(p, 'oportunidades');
      await p.waitForSelector('#op-jornais-lista li', { timeout: 10000 });
    });
    await passo('já tenho o número: UASG + pregão acha o edital e dá o link oficial', p, async () => {
      await p.locator('#op-numero > summary').click();
      await p.fill('#op-numero-uasg', '158465'); await p.fill('#op-numero-num', '90012/2026');
      await p.click('#op-numero-buscar');
      await p.waitForFunction(() => /Achamos|Não achamos/.test(document.getElementById('op-numero-status').textContent), null, { timeout: 15000 });
      exigir((await cartoes(p).count()) === 1, 'esperava 1 cartão');
      const link = await p.locator('#op-resultado .aviso a').getAttribute('href');
      exigir(/compra=15846505900122026$/.test(link), link);
    });
    await passo('órgãos compradores por UF com CAPAG', p, async () => {
      await p.locator('#op-orgaos > summary').click();
      await p.selectOption('#op-orgaos-uf', 'AM');
      await p.click('#op-orgaos-form button[type=submit]');
      await p.waitForFunction(() => /órgão\(s\)|Não foi possível/.test(document.getElementById('op-orgaos-status').textContent), null, { timeout: 20000 });
      const st = await p.locator('#op-orgaos-status').innerText();
      exigir(/órgão\(s\) com licitação aberta em AM/.test(st), st);
      return st.split('.')[0];
    });
    await passo('e-mail do boletim por empresa e do jornal (robô real, banco local, SMTP simulado)', null, async () => {
      const codigo = `
import sys, json
sys.path.insert(0, r"${path.join(__dirname, '..', 'scripts')}")
import boletim_editais as be
be.SUPABASE_URL = r"${chaves.API_URL}"
hoje = be.datetime.now(be.timezone(be.timedelta(hours=-3))).isoformat()
def ed(n, obj, uf):
    return {"numeroControlePNCP": "04312239000141-1-0003%02d/2026" % n, "objetoCompra": obj, "dataPublicacaoPncp": hoje, "unidadeOrgao": {"ufSigla": uf, "municipioNome": "Manaus" if uf == "AM" else "São Paulo"}, "orgaoEntidade": {"razaoSocial": "Prefeitura", "esferaId": "M"}, "modalidadeNome": "Pregão - Eletrônico"}
be.buscar_pool_por_uf = lambda ufs: {"AM": [ed(1, "Papel legado A4", "AM"), ed(2, "Papel sulfite", "AM")], "SP": [ed(3, "Café torrado", "SP")]}
be.carregar_historico = lambda: {}
be.salvar_historico = lambda h: None
be.registrar_log_boletim = lambda *a, **k: None
be.hoje_e_feriado_nacional = lambda: None
enviados = []
be.enviar_email = lambda email, nome, eds, prefixo="", *_resto, **_kw: enviados.append({"para": email, "assunto": prefixo, "n": len(eds)})
be.main()
print("ENVIADOS=" + json.dumps(enviados, ensure_ascii=False))
`;
      const r = spawnSync('python', ['-c', codigo], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', SUPABASE_SERVICE_ROLE_KEY: chaves.SERVICE_ROLE_KEY, JORNAIS_SEMPRE: '1', EMAIL_REMETENTE: '', EMAIL_SENHA_APP: '' } });
      const m = /ENVIADOS=(.*)/.exec(r.stdout || '');
      exigir(r.status === 0 && m, (r.stdout + r.stderr).slice(-800));
      const doGestor = JSON.parse(m[1]).filter((e) => e.para === g.email);
      const assuntos = doGestor.map((e) => `${e.assunto}(${e.n})`).sort();
      exigir(JSON.stringify(assuntos) === JSON.stringify(['[Materiais Horizonte Teste LTDA · Papel Manaus] (2)', '[Materiais Horizonte Teste LTDA] (1)', '[Papelaria Aurora Teste LTDA] (1)'].sort()), JSON.stringify(doGestor));
      return assuntos.join(' | ');
    });
    for (const [largura, nome] of [[1280, '1280'], [375, '375']]) {
      await passo(`prints ${nome}: início, busca avançada, jornais, órgãos e boletim`, null, async () => {
        await p.setViewportSize({ width: largura, height: 900 });
        await irPara(p, 'dashboard'); await p.waitForTimeout(500);
        await p.locator('#dashboard').screenshot({ path: path.join(PRINTS, `inicio-${nome}.png`) });
        await irPara(p, 'oportunidades');
        await p.evaluate(() => { for (const id of ['op-numero', 'op-mais-filtros', 'op-orgaos']) document.getElementById(id).open = true; });
        await p.screenshot({ path: path.join(PRINTS, `busca-${nome}.png`), fullPage: true });
        const largo = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        await irPara(p, 'boletim');
        await p.evaluate(() => { document.getElementById('bol-config-painel').style.display = 'flex'; });
        await p.locator('#boletim').screenshot({ path: path.join(PRINTS, `boletim-empresa-${nome}.png`) });
        exigir(!largo, 'rolagem lateral em ' + largura);
      });
    }
    await passo('sem erro de página no console', null, async () => {
      const erros = p.erros.filter((e) => !/favicon|404 GET \/data\/|pncp-proxy/.test(e));
      exigir(!erros.length, erros.join(' | '));
    });
  } finally {
    limpar();
    psql(`update public.clientes set boletim_filtro=${legadoAntes === 'null' ? 'null' : `'${legadoAntes.replace(/'/g, "''")}'`} where id='${g.id}';`);
    await nav.close();
    require('node:fs').writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 2));
    const falhas = resultados.filter((r) => !r.ok);
    console.log(falhas.length ? `FALHOU: ${falhas.map((f) => f.nome).join('; ')}` : `OK: ${resultados.length} passos. Prints em ${PRINTS}`);
    process.exit(falhas.length ? 1 : 0);
  }
})();
