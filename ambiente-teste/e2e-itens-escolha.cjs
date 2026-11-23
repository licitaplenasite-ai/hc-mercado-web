/* global document, window -- usados só dentro de p.evaluate (rodam no navegador) */
// E2E local da escolha de itens ("Vou participar") com um edital FICTÍCIO de 200 itens.
//   PORTA_TESTE=8897 node -r ./ambiente-teste/pncp-ficticio.cjs ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8897 node ambiente-teste/e2e-itens-escolha.cjs
// Fluxo: importar os 200 itens pelo botão, aviso para empresa não ME/EPP, filtrar exclusivos ME/EPP, marcar 5,
// digitar preços com vírgula, recarregar e conferir na tela e no banco; atalho "3, 7, 10-15"; celular 375 px.
// O processo fictício é criado aqui e apagado no fim.
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-itens-escolha';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const psql = (sql) => {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const PROC = 'e5c01ab0-0000-4000-8000-000000000077';
const URL_EDITAL = 'https://pncp.gov.br/app/editais/99999999000191/2026/77';
const PRECOS = ['52,00', '1.500,00', '0,75', '10', '2.345,67'];

(async () => {
  const { ids } = seed;
  const limpar = () => psql(`delete from operacao_observacoes_pncp where item_id in (select id from operacao_itens_resultado where processo_id='${PROC}');
    delete from operacao_origens_pncp where processo_id='${PROC}'; delete from operacao_itens_resultado where processo_id='${PROC}'; delete from operacao_processos where id='${PROC}';`);
  // Perfil da empresa do seed: guarda o porte de antes (ou a ausência da linha) para devolver no fim.
  const porteAntes = psql(`select coalesce(porte,'(nulo)') from operacao_perfil_empresa where empresa_id='${ids.empA1}';`);
  const porte = (v) => psql(`insert into operacao_perfil_empresa(empresa_id,organizacao_id,porte) select id,organizacao_id,${v === null ? 'null' : `'${v}'`} from operacao_empresas where id='${ids.empA1}'
    on conflict (empresa_id) do update set porte=excluded.porte;`);
  limpar();
  psql(`insert into operacao_processos(id,organizacao_id,empresa_id,objeto,numero,orgao,url_origem,status)
    select '${PROC}',organizacao_id,id,'Material de expediente (EDITAL FICTÍCIO de 200 itens, e2e)','PE 77/2026 (exemplo)','Órgão Fictício de Teste','${URL_EDITAL}','preparacao' from operacao_empresas where id='${ids.empA1}';`);
  porte('demais');
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  const quadro = p.locator('#itens-processo .itens-escolha');
  const contador = () => quadro.locator('[data-escolha-contador]').innerText();
  const linha = (n) => quadro.locator(`tbody tr:has(td:nth-child(2) strong:text-is("${n}"))`);
  try {
    await passo('Importar os 200 itens do edital fictício pelo botão', p, async () => {
      await p.goto(`${SITE}/sistema?empresa=${ids.empA1}&processo=${PROC}`);
      await p.getByRole('button', { name: 'Importar itens do edital (PNCP)' }).click();
      await p.getByRole('button', { name: 'Importar todos os itens do edital' }).click();
      await p.waitForFunction(() => /chegam desmarcados/.test(document.querySelector('[data-item-importar-estado]')?.textContent || ''), null, { timeout: 300000, polling: 1000 });
      const aviso = await p.locator('[data-item-importar-estado]').innerText();
      exigir(/200 importados/.test(aviso) && /chegam desmarcados/.test(aviso), `aviso: ${aviso}`);
      await quadro.waitFor();
      const c = await contador();
      exigir(c === '0 de 200 itens selecionados', `contador: ${c}`);
      const banco = psql(`select count(*)||'|'||count(*) filter (where participar)||'|'||count(*) filter (where tipo_beneficio=1)||'|'||count(*) filter (where tipo_beneficio=3) from operacao_itens_resultado where processo_id='${PROC}';`);
      exigir(banco === '200|0|40|23', `banco total|marcados|exclusivos|cota: ${banco}`);
      return `${aviso} | banco ${banco}`;
    });
    await passo('Empresa não ME/EPP: aviso no topo e no item; marcar pede confirmação e cancelar não grava', p, async () => {
      const selo = await quadro.locator('[data-escolha-porte]').innerText();
      exigir(/não é ME\/EPP/.test(selo), `selo: ${selo}`);
      await quadro.locator('[data-escolha-filtro]').selectOption('exclusivo');
      exigir(/Sua empresa não pode/.test(await linha(5).innerText()), 'item 5 sem aviso');
      let mensagem = '';
      p.once('dialog', (d) => { mensagem = d.message(); void d.dismiss(); });
      await linha(5).getByRole('checkbox').click();
      await p.waitForTimeout(500);
      exigir(/não é ME\/EPP/.test(mensagem), `diálogo: ${mensagem}`);
      exigir(!(await linha(5).getByRole('checkbox').isChecked()), 'marcou sem confirmar');
      exigir(psql(`select count(*) from operacao_itens_resultado where processo_id='${PROC}' and participar;`) === '0', 'gravou sem confirmar');
      return `${selo} | diálogo: ${mensagem.slice(0, 120)}`;
    });
    await passo('Empresa ME/EPP: filtrar exclusivos, marcar 5 e digitar preços com vírgula', p, async () => {
      porte('me');
      await p.reload();
      await quadro.waitFor();
      exigir(/Empresa ME: pode entrar/.test(await quadro.locator('[data-escolha-porte]').innerText()), 'selo ME ausente');
      await quadro.locator('[data-escolha-filtro]').selectOption('exclusivo');
      const linhas = await quadro.locator('tbody tr').count();
      exigir(linhas === 40, `exclusivos na tela: ${linhas}`);
      const numeros = [5, 10, 15, 20, 25];
      for (const [k, n] of numeros.entries()) {
        await linha(n).getByRole('checkbox').check();
        await p.waitForFunction((x) => document.querySelector('[data-escolha-contador]').textContent.startsWith(`${x} de 200`), k + 1);
        const preco = linha(n).getByRole('textbox', { name: `Preço unitário ofertado do item ${n} (R$)` });
        await preco.fill(PRECOS[k]);
        await linha(n).getByRole('textbox', { name: `Marca do item ${n}` }).fill(`Marca ${n}`);
        await linha(n).getByRole('textbox', { name: `Modelo do item ${n}` }).fill(`Modelo ${n}`);
        await preco.press('Tab');
      }
      await p.waitForFunction(() => /781\.684,00/.test(document.querySelector('[data-escolha-total]').textContent), null, { timeout: 20000 });
      const total = await quadro.locator('[data-escolha-total]').innerText();
      // 200 × (52 + 1500 + 0,75 + 10 + 2345,67) = 781.684,00
      exigir(total === 'Total da proposta: R$ 781.684,00.', `total: ${total}`);
      exigir(await linha(10).locator('td').nth(8).innerText().then((t) => t.startsWith('R$ 300.000,00')), 'total do item 10 sem milhar');
      await quadro.screenshot({ path: path.join(PRINTS, 'escolha-1366-marcados.png') });
      return `${await contador()} | ${total}`;
    });
    await passo('Recarregar: os 5 continuam marcados, com preço, marca e modelo; banco confere', p, async () => {
      await p.reload();
      await quadro.waitFor();
      exigir(await contador() === '5 de 200 itens selecionados', `contador: ${await contador()}`);
      await quadro.locator('[data-escolha-filtro]').selectOption('selecionados');
      const valores = await quadro.locator('[data-escolha-campo="valorUnitario"]').evaluateAll((l) => l.map((e) => e.value));
      exigir(JSON.stringify(valores) === JSON.stringify(['52,00', '1.500,00', '0,75', '10,00', '2.345,67']), `preços: ${valores}`);
      const banco = psql(`select string_agg(identificador||'='||valor_unitario_proposta||'/'||marca||'/'||modelo, ',' order by numero_ordem) from operacao_itens_resultado where processo_id='${PROC}' and participar;`);
      exigir(banco === '5=52.00/Marca 5/Modelo 5,10=1500.00/Marca 10/Modelo 10,15=0.75/Marca 15/Modelo 15,20=10.00/Marca 20/Modelo 20,25=2345.67/Marca 25/Modelo 25', `banco: ${banco}`);
      const cartao = await p.locator('#itens-processo [data-item-lista] li', { hasText: 'Item fictício 10:' }).first().innerText();
      exigir(/Unitário: R\$ 1\.500,00 · Total: R\$ 300\.000,00/.test(cartao), `cartão: ${cartao.slice(0, 200)}`);
      const fora = await p.locator('#itens-processo [data-item-lista] li', { hasText: 'Item fictício 1:' }).first().innerText();
      exigir(/Fora da proposta/.test(fora), 'item 1 sem selo Fora da proposta');
      return banco;
    });
    await passo('Formulário do item aceita "52,00" e mostra total com milhar', p, async () => {
      await p.locator('#itens-processo [data-item-lista] li', { hasText: 'Item fictício 10:' }).first().getByRole('button', { name: /^Editar/ }).click();
      const campo = p.locator('[data-item-form] [name="valorUnitario"]');
      exigir(await campo.inputValue() === '1.500,00', `valor no formulário: ${await campo.inputValue()}`);
      await campo.fill('52,00');
      const t = await p.locator('[data-item-total]').innerText();
      exigir(t === 'Total do item: R$ 10.400,00', `total: ${t}`);
      await p.getByRole('button', { name: 'Cancelar edição' }).click();
      return t;
    });
    await passo('Busca por número e atalho "Só quero os itens: 3, 7, 10-15"', p, async () => {
      await quadro.locator('[data-escolha-filtro]').selectOption('todos');
      await quadro.locator('[data-escolha-busca]').fill('12');
      exigir(await quadro.locator('tbody tr').first().locator('td').nth(1).innerText() === '12', 'busca por 12 não trouxe o item 12 primeiro');
      await quadro.locator('[data-escolha-busca]').fill('');
      await quadro.getByRole('textbox', { name: 'Só quero os itens' }).fill('3, 7, 10-15, 999');
      await quadro.getByRole('button', { name: 'Ficar só com estes itens' }).click();
      await p.waitForFunction(() => /^Pronto:/.test(document.querySelector('[data-escolha-estado]').textContent), null, { timeout: 20000 });
      const msg = await quadro.locator('[data-escolha-estado]').innerText();
      exigir(await contador() === '8 de 200 itens selecionados', `contador: ${await contador()}`);
      exigir(/Não existem no edital: 999/.test(msg), `msg: ${msg}`);
      const banco = psql(`select string_agg(identificador, ',' order by numero_ordem) from operacao_itens_resultado where processo_id='${PROC}' and participar;`);
      exigir(banco === '3,7,10,11,12,13,14,15', `banco: ${banco}`);
      return `${msg} | banco ${banco}`;
    });
    await passo('Celular 375 px: sem rolagem da página; a tabela rola dentro do quadro', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await p.waitForTimeout(400);
      const m = await p.evaluate(() => { const t = document.querySelector('.itens-escolha .tabela-rolagem'); return { largura: document.documentElement.scrollWidth, janela: window.innerWidth, quadro: t.scrollWidth > t.clientWidth }; });
      await quadro.scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(PRINTS, 'escolha-375.png') });
      exigir(m.largura <= m.janela && m.quadro, `página ${m.largura}/${m.janela}, quadro rola: ${m.quadro}`);
      await p.setViewportSize({ width: 1366, height: 900 });
      return JSON.stringify(m);
    });
    await passo('Console sem erro', null, async () => {
      exigir(!p.erros.length, p.erros.join(' | '));
      return 'sem erros';
    });
  } finally {
    await nav.close();
    if (process.env.MANTER !== '1') limpar();
    if (porteAntes === '') psql(`delete from operacao_perfil_empresa where empresa_id='${ids.empA1}';`);
    else porte(porteAntes === '(nulo)' ? null : porteAntes);
    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(`\n${resultados.length - falhas}/${resultados.length} passos ok. Prints: ${PRINTS}`);
    process.exit(falhas ? 1 : 0);
  }
})();
