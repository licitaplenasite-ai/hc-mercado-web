/* global document, window -- usados só dentro de p.evaluate (rodam no navegador) */
// E2E local do agente "Contador" (contador-ui.js + /api/contador). Ambiente: subir.cjs + servidor.cjs rodando.
//   PORTA_TESTE=8899 node ambiente-teste/servidor.cjs
//   SITE_TESTE=http://127.0.0.1:8899 node ambiente-teste/e2e-contador.cjs
// 1 chamada real à calculadora oficial da Receita (medicamento, 2027). BrasilAPI simulada (CNPJ do seed é fictício).
// Sem chave de IA no ambiente local: "Sugerir com IA" tem de dizer que a IA não está disponível, sem quebrar a tela.
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/prints-contador';
const { passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const psql = (sql) => {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const ID_TESTE = 'E2E-CONTADOR-1';
// Linhas reais da tabela oficial (V0073), no formato que o robô copiar_tabelas_rtc.js grava em dados_robo.
const TABELA = { versaoDb: 'V0073', dataVersaoDb: '2026-11-09', copiadoEm: new Date().toISOString(), linhas: [
  { codigo: '000001', descricao: 'Situações tributadas integralmente pelo IBS e CBS.', nomenclatura: 'NBS ou NCM', reducaoCbs: 0, reducaoIbsUf: 0, reducaoIbsMun: 0, tipoAliquota: 'Padrão', creditoCbs: true, baseLegal: 'LC 214/2025' },
  { codigo: '200003', descricao: 'Vendas de produtos destinados à alimentação humana (Anexo I)', nomenclatura: 'NCM', reducaoCbs: 100, reducaoIbsUf: 100, reducaoIbsMun: 100, tipoAliquota: 'Padrão', creditoCbs: true, baseLegal: 'Art. 125' },
  { codigo: '200032', descricao: 'Fornecimento dos medicamentos registrados na Anvisa ou produzidos por farmácias de manipulação, ressalvados os medicamentos sujeitos à alíquota zero', nomenclatura: 'NCM', reducaoCbs: 60, reducaoIbsUf: 60, reducaoIbsMun: 60, tipoAliquota: 'Padrão', creditoCbs: true, baseLegal: 'Art. 133' },
  { codigo: '200028', descricao: 'Fornecimento dos serviços de educação (Anexo II)', nomenclatura: 'NBS', reducaoCbs: 60, reducaoIbsUf: 60, reducaoIbsMun: 60, tipoAliquota: 'Padrão', creditoCbs: true, baseLegal: 'Art. 129' },
] };
const CNPJ_BRASILAPI = { cnpj: '11222333000181', uf: 'AM', codigo_municipio_ibge: 1302603, cnae_fiscal: 4644301, opcao_pelo_simples: false, opcao_pelo_mei: false,
  regime_tributario: [{ ano: 2025, forma_de_tributacao: 'LUCRO PRESUMIDO' }] };

(async () => {
  const { ids } = seed;
  const titular = psql(`select o.owner_id from operacao_processos p join operacao_organizacoes o on o.id=p.organizacao_id where p.id='${ids.procA}';`);
  const assinaturaAntes = psql(`select plano||'|'||situacao from assinaturas where usuario_id='${titular}';`);
  const premissasAntes = psql(`select coalesce(tributos_percentual::text,'')||'|'||coalesce(garantia_percentual::text,'')||'|'||coalesce(margem_percentual::text,'')||'|'||coalesce(margem_minima_percentual::text,'')||'|'||coalesce(frete::text,'') from operacao_processos where id='${ids.procA}';`);
  psql(`delete from operacao_itens_resultado where identificador='${ID_TESTE}';
    insert into operacao_itens_resultado (organizacao_id, processo_id, identificador, descricao, quantidade, unidade, custo_unitario)
    select organizacao_id, id, '${ID_TESTE}', 'Dipirona sódica 500 mg, comprimido, caixa com 10', 10, 'Caixa', 50.00 from operacao_processos where id='${ids.procA}';
    update operacao_processos set tributos_percentual=null, garantia_percentual=null, frete=null, margem_percentual=20, margem_minima_percentual=8 where id='${ids.procA}';
    update assinaturas set plano='empresa', situacao='ativa' where usuario_id='${titular}';
    insert into dados_robo(chave,dado,atualizado_em) values ('rtc_classificacoes','${JSON.stringify(TABELA).replace(/'/g, "''")}',now())
      on conflict (chave) do update set dado=excluded.dado, atualizado_em=now();
    delete from contador_oficial where chave='ncm:30049099|200032|2027';`);
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  const p = await novaPagina(nav, seed.usuarios.gestor);
  await p.route('https://brasilapi.com.br/api/cnpj/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CNPJ_BRASILAPI) }));
  await p.setViewportSize({ width: 1280, height: 900 });
  const li = () => p.locator('#itens-processo [data-item-lista] li', { hasText: ID_TESTE });
  const quadro = () => li().locator('.contador-corpo');
  try {
    await passo('Contador abre no item com aviso fixo, regime lido do CNPJ e tabela oficial', p, async () => {
      await p.goto(`${SITE}/sistema?empresa=${ids.empA1}&processo=${ids.procA}#aba=itens`);
      await p.evaluate(() => { for (const k of Object.keys(window.localStorage)) if (k.startsWith('licitaplena_contador_')) window.localStorage.removeItem(k); });
      await p.reload();
      await li().waitFor({ timeout: 30000 });
      await li().locator('details.itens-mais > summary').click(); // ferramentas de preço ficam fechadas por item
      await li().getByRole('button', { name: 'Contador: preço com impostos' }).click();
      await quadro().locator('.rotulo-agente', { hasText: 'Contador' }).waitFor();
      const aviso = await quadro().locator('.contador-aviso').first().innerText();
      exigir(aviso === 'Estimativa para formar preço. Confirme com o seu contador.', `aviso: ${aviso}`);
      await p.waitForFunction(() => /Lucro Presumido em 2025/.test(document.querySelector('.contador-corpo [data-regime-fonte]')?.textContent || ''), null, { timeout: 15000 });
      exigir(await quadro().locator('[data-contador="regime"]').inputValue() === 'presumido', 'regime não veio do CNPJ');
      exigir(await quadro().locator('[data-contador="origemUf"]').inputValue() === 'AM', 'UF de saída não veio do CNPJ');
      await quadro().getByRole('button', { name: 'Confirmar regime' }).click();
      await p.waitForFunction(() => document.querySelectorAll('.contador-corpo [data-contador="cclasstrib"] option').length > 2, null, { timeout: 15000 });
      return (await quadro().locator('[data-regime-fonte]').innerText());
    });
    await passo('Sugerir com IA sem IA no ambiente: mensagem simples, tela continua', p, async () => {
      await quadro().getByRole('button', { name: /Sugerir NCM/ }).click();
      await p.waitForFunction(() => /IA não está disponível|não respondeu|à mão/.test(document.querySelector('.contador-corpo [data-motivo]')?.textContent || ''), null, { timeout: 20000 });
      return await quadro().locator('[data-motivo]').innerText();
    });
    await passo('Medicamento 60% em 2027: calculadora oficial confere e o preço bate com a conta à mão (R$ 63,24)', p, async () => {
      await quadro().locator('[data-contador="codigo"]').fill('30049099');
      await quadro().locator('[data-contador="cclasstrib"]').selectOption('200032');
      await quadro().locator('[data-contador="ano"]').selectOption('2027');
      await quadro().locator('[data-contador="destinoUf"]').fill('AM');
      await quadro().locator('[data-contador="icms"]').fill('18');
      await quadro().locator('[data-contador="dias"]').fill('0');
      const classe = await quadro().locator('[data-classe]').innerText();
      exigir(/Redução de 60%: medicamento.*Art\. 133/.test(classe), `classe: ${classe}`);
      await quadro().getByRole('button', { name: 'Calcular' }).click();
      await quadro().locator('[data-oficial]').waitFor({ timeout: 30000 });
      const texto = await quadro().locator('[data-resultado]').innerText();
      exigir(/Preço mínimo sem prejuízo \(por unidade\)\s*R\$ 63,24/.test(texto), `preço mínimo: ${texto.slice(0, 400)}`);
      exigir(/Lucro por unidade/.test(texto) && /Ano da entrega\s*2027/.test(texto), 'sem lucro/ano');
      exigir(/redução de 60%/.test(texto) && /confira se o NCM do seu fornecedor/.test(texto), 'sem dica da redução');
      const oficial = await quadro().locator('[data-oficial]').innerText();
      exigir(/calculadora oficial/.test(oficial), `oficial: ${oficial}`);
      const cache = psql(`select resultado->>'estado' from contador_oficial where chave='ncm:30049099|200032|2027';`);
      await quadro().screenshot({ path: path.join(PRINTS, 'contador-1280.png') });
      return `${oficial} | cache: ${cache || 'sem cache (oficial fora)'}`;
    });
    await passo('Salvar no item grava o resumo para a proposta', p, async () => {
      await quadro().getByRole('button', { name: 'Salvar no item para a proposta' }).click();
      await p.waitForFunction(() => /Salvo no item/.test(document.querySelector('.contador-corpo .itens-acoes .itens-campo-estado')?.textContent || ''), null, { timeout: 15000 });
      const salvo = psql(`select concat_ws('|', contador_resumo->>'precoMinimo', contador_resumo->>'ano', contador_resumo->>'cClassTrib', contador_resumo->>'aviso') from operacao_itens_resultado where identificador='${ID_TESTE}';`);
      exigir(salvo.startsWith('63.24|2027|200032|Estimativa para formar preço'), `resumo: ${salvo}`);
      return salvo;
    });
    await passo('Contador em 375 px sem rolagem horizontal', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await p.waitForTimeout(400);
      const { largura, janela } = await p.evaluate(() => ({ largura: document.documentElement.scrollWidth, janela: window.innerWidth }));
      await quadro().screenshot({ path: path.join(PRINTS, 'contador-375.png') });
      exigir(largura <= janela, `rolagem horizontal: ${largura} > ${janela}`);
      await p.setViewportSize({ width: 1280, height: 900 });
      return `scrollWidth ${largura} / innerWidth ${janela}`;
    });
    // No Essencial a formação de preço (lista de itens do kit) já é barrada pelo plano; o Contador nem chega a aparecer.
    await passo('Essencial: sem Contador na tela e a rota recusa', p, async () => {
      psql(`update assinaturas set plano='essencial', situacao='ativa' where usuario_id='${titular}';`);
      await p.reload();
      await p.waitForTimeout(4000);
      const botoes = await p.locator('[data-contador-abrir]').count();
      const travas = await p.locator('.contador-caixa .trava-plano').count();
      exigir(botoes === 0 || travas === botoes, `Contador aberto no Essencial: ${botoes} botão(ões), ${travas} trava(s)`);
      const trava = botoes ? `${travas} quadro(s) travado(s)` : 'sem itens nem Contador na tela';
      const r = await p.evaluate(async () => { const x = await window.fetchComSessao('/api/contador', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'tabela' }) }); return { s: x.status, j: await x.json() }; });
      exigir(r.s === 403 && /não inclui/.test(r.j.erro), `rota: ${r.s} ${JSON.stringify(r.j)}`);
      await p.screenshot({ path: path.join(PRINTS, 'contador-essencial.png') });
      return `${trava.split('\n')[0]} | rota ${r.s}: ${r.j.erro}`;
    });
    await passo('sem erro de página nem de script no console', null, async () => {
      const graves = p.erros.filter((e) => /pageerror/.test(e) || (/^console:/.test(e) && !/Failed to load resource/.test(e)));
      exigir(!graves.length, graves.join(' | '));
      return `${p.erros.length} aviso(s) de rede (esperados: IA indisponível 503, rota recusada 403 no Essencial)`;
    });
  } finally {
    const [pl, si] = assinaturaAntes.split('|');
    const [tr, ga, ma, mm, fr] = premissasAntes.split('|').map((x) => (x === '' ? 'null' : x));
    psql(`delete from operacao_itens_resultado where identificador='${ID_TESTE}';
      update assinaturas set plano='${pl}', situacao='${si}' where usuario_id='${titular}';
      update operacao_processos set tributos_percentual=${tr}, garantia_percentual=${ga}, margem_percentual=${ma}, margem_minima_percentual=${mm}, frete=${fr} where id='${ids.procA}';`);
    await nav.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.map((f) => f.nome).join('; ')}` : 'OK');
  process.exit(falhas.length ? 1 : 0);
})();
