/* global document, window -- usados só dentro de p.evaluate (rodam no navegador) */
// E2E do Orçamento de obra (agente Orçamentista): enviar a planilha do edital em branco -> conferir o Leitor ->
// montar com o SINAPI do banco -> preencher preço de outra tabela e 3 cotações -> alertas do Auditor -> baixar
// as planilhas. Também: trava no plano Essencial, 1280 e 375 px sem rolagem lateral e sem erro no console.
// Fase 2: "Bases no sistema", "o que costuma acontecer", data-base antiga pelo histórico (bases_preco_*), rascunho
// depois de recarregar, aba "Conferência antes de enviar", opção de motivos escondida (desligada) e normas-obra.html só do dono.
//   PORTA_TESTE=8851 node ambiente-teste/servidor.cjs   e depois   PORTA_TESTE=8851 node ambiente-teste/e2e-orcamento-obra.cjs
// Grava dados fictícios (SINAPI 9902xx, versões com fonte "E2E", recortes do estudo) e apaga no fim; aplica
// supabase/orcamento_obra_recurso.sql, bases_preco.sql, orcamento_normas.sql e orcamento_estudo.sql (idempotentes).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/orcamentista/prints-e2e';
const { passo, exigir, novaPagina, entrar, seed, chaves, PRINTS, SITE, resultados } = require('./e2e.cjs');
const { gravarXlsx, lerXlsx } = require('../scripts/xlsx_simples');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');

async function sv(m, c, corpo) {
  const r = await fetch(chaves.API_URL + c, { method: m, body: corpo === undefined ? undefined : JSON.stringify(corpo), headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=minimal' } });
  if (!r.ok) throw new Error(`${m} ${c}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
function psql(sql) {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('psql: ' + r.stderr);
  return r.stdout.trim();
}
const R = '2026-10-01';
const RECORTES_E2E = ['uf:AM|*|*', 'uf:AM|outra_obra|*', 'uf:AM|outra_obra|ate_1mi'];
async function limpar() {
  await sv('DELETE', '/rest/v1/bases_preco_versoes?fonte=like.E2E*');
  await sv('DELETE', `/rest/v1/orcamento_estudo_estatisticas?recorte=in.(${RECORTES_E2E.map((r) => `"${r}"`).join(',')})`);
  await sv('DELETE', '/rest/v1/sinapi_composicao_itens?composicao=like.9902*');
  await sv('DELETE', '/rest/v1/sinapi_custos?codigo=like.9902*');
  await sv('DELETE', '/rest/v1/sinapi_itens?codigo=like.9902*');
}

// Planilha em branco no jeito da dos Correios: várias bases, preços zerados, sem data-base no cabeçalho.
const EDITAL = path.join(os.tmpdir(), 'e2e-orcamento-obra-edital.xlsx');
fs.writeFileSync(EDITAL, gravarXlsx([{ nome: 'Planilha Orçamentária Sintética', linhas: [
  ['Objeto: obra fictícia de teste · SINAPI - AMAZONAS · NÃO DESONERADO · Data-base: 10/2026'], [],
  ['Item', 'Código', 'Banco', 'Descrição', 'Unidade', 'Quantidade', 'Valor unitário', 'Valor Unit com BDI', 'Total geral do Item'],
  ['1', '', '', 'Serviços preliminares', '', '', '', '', 0],
  ['1.1', '990201', 'SINAPI', 'ALVENARIA FICTÍCIA', 'm2', 10, 0, 0, 0],
  ['1.2', '13045', 'ORSE', 'TESTE EM MALHA DE ATERRAMENTO', 'und', 1, 0, 0, 0],
  ['1.3', '1', 'COMPOSIÇÃO MONTADA', 'ESTRUTURA DE SUPORTE', 'm2', 2, 0, 0, 0],
] }]));

(async () => {
  const nav = await chromium.launch({ channel: process.env.NAVEGADOR === 'chrome' ? 'chrome' : 'msedge', headless: true });
  let essencialOriginal = null;
  try {
    for (const f of ['orcamento_obra_recurso.sql', 'bases_preco.sql', 'orcamento_normas.sql', 'orcamento_estudo.sql']) psql(fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8'));
    await limpar();
    // Histórico: SINAPI 2026-10 (vigente, nas tabelas sinapi_*) e 2026-09 guardado nas partes, com outro preço.
    const versao = (data, versao) => ({ base: 'SINAPI', abrangencia: 'BR', data_base: data, versao, desonerado: 'ambos', arredondamento: 'edital', casas_decimais: 2, fonte: 'E2E CAIXA', situacao: 'precos', itens: 3, coletado_em: '2026-11-16T12:00:00Z' });
    await sv('POST', '/rest/v1/bases_preco_versoes', [versao('2026-10-01', '2026-10'), versao('2026-09-01', '2026-09')]);
    const v09 = psql("select id from public.bases_preco_versoes where fonte='E2E CAIXA' and data_base='2026-09-01'");
    await sv('POST', '/rest/v1/bases_preco_partes', [
      { versao_id: Number(v09), parte: 'precos:AM:99', conteudo: { 'composicao|990201': [80, 77], 'insumo|990202': [2.4, 2.4], 'insumo|990203': [20, 17] } },
      { versao_id: Number(v09), parte: 'analitico:99', conteudo: { 990201: [['insumo', '990202', 13.5], ['insumo', '990203', 0.8]] } },
      { versao_id: Number(v09), parte: 'itens:99', conteudo: { 'composicao|990201': ['ALVENARIA (FICTICIO)', 'M2'], 'insumo|990202': ['BLOCO (FICTICIO)', 'UN'], 'insumo|990203': ['PEDREIRO (FICTICIO)', 'H'] } }]);
    await sv('POST', '/rest/v1/orcamento_estudo_estatisticas', RECORTES_E2E.map((recorte, i) => ({ recorte, n: i ? 3 : 24, dados: { desconto_mediana: 17.38, desconto_p25: 12.6, desconto_p75: 21.58, pct_com_recusa_mais_barata: 70.83 } })));
    psql('update public.orcamento_motivos_config set ligado=false');
    await sv('POST', '/rest/v1/sinapi_itens', [
      { tipo: 'composicao', codigo: '990201', descricao: 'ALVENARIA (FICTICIO)', unidade: 'M2', referencia: R, busca: 'alvenaria ficticio' },
      { tipo: 'insumo', codigo: '990202', descricao: 'BLOCO (FICTICIO)', unidade: 'UN', referencia: R, busca: 'bloco ficticio' },
      { tipo: 'insumo', codigo: '990203', descricao: 'PEDREIRO (FICTICIO)', unidade: 'H', referencia: R, busca: 'pedreiro ficticio' }]);
    await sv('POST', '/rest/v1/sinapi_custos', [
      { uf: 'AM', tipo: 'composicao', codigo: '990201', preco_sd: 88.1, preco_cd: 85.4, referencia: R },
      { uf: 'AM', tipo: 'insumo', codigo: '990202', preco_sd: 2.55, preco_cd: 2.55, referencia: R },
      { uf: 'AM', tipo: 'insumo', codigo: '990203', preco_sd: 22.33, preco_cd: 18.1, referencia: R }]);
    await sv('POST', '/rest/v1/sinapi_composicao_itens', [
      { composicao: '990201', item_tipo: 'insumo', item_codigo: '990202', descricao: 'BLOCO', unidade: 'UN', coeficiente: 13.5, referencia: R },
      { composicao: '990201', item_tipo: 'insumo', item_codigo: '990203', descricao: 'PEDREIRO', unidade: 'H', coeficiente: 0.8, referencia: R }]);

    const p = await novaPagina(nav, seed.usuarios.gestor);
    await p.setViewportSize({ width: 1280, height: 900 });
    await passo('tela abre com o rótulo Orçamentista e o aviso fixo do engenheiro', p, async () => {
      await p.goto(SITE + '/orcamento-obra.html');
      await p.waitForSelector('#form-edital');
      const h1 = (await p.innerText('h1')).replace(/\s+/g, ' ').trim(), aviso = await p.innerText('.engenheiro');
      exigir(h1 === 'Orçamentista Orçamento de obra', h1);
      exigir(aviso === 'Revisão e assinatura de engenheiro ou arquiteto responsável são obrigatórias.', aviso);
      exigir(!(await p.locator('.trava-plano').count()), 'plano em teste travou a tela');
      return h1;
    });
    await passo('Leitor entende a planilha em branco com 3 bases', p, async () => {
      await p.setInputFiles('#f-edital', EDITAL);
      await p.click('#form-edital button[type=submit]');
      await p.waitForSelector('#passo-leitura:not([hidden])');
      const resumo = (await p.innerText('#l-resumo')).replace(/\s+/g, ' '), fontes = await p.innerText('#l-fontes');
      exigir(/3 serviços em 1 etapas/.test(resumo) && /planilha em branco/.test(resumo), resumo);
      exigir(/SINAPI: 1/.test(fontes) && /ORSE: 1/.test(fontes) && /Composição própria: 1/.test(fontes), fontes);
      exigir(await p.inputValue('#l-uf') === 'AM' && await p.inputValue('#l-data') === '2026-10' && await p.inputValue('#l-regime') === 'nao', 'cabeçalho lido errado');
      return `${resumo} | ${fontes.replace(/\s+/g, ' ')}`;
    });
    await passo('bases no sistema, data-base e "o que costuma acontecer" (amostra pequena sobe para a UF)', p, async () => {
      await p.waitForFunction(() => /SINAPI 2026-10/.test(document.getElementById('m-bases').textContent) && !document.getElementById('m-estudo').hidden);
      const bases = await p.innerText('#m-bases'), base = await p.innerText('#l-base'), estudo = (await p.innerText('#m-estudo')).replace(/\s+/g, ' ');
      exigir(/Bases no sistema: SINAPI 2026-10 \(atualizada em 16\/11\/2026\)/.test(bases), bases);
      exigir(/SINAPI 2026-10: o mais novo no sistema/.test(base), base);
      exigir(/O que costuma acontecer Em obras no AM \(24 concorrências concluídas\), o vencedor deu em geral 17,4% de desconto/.test(estudo), estudo);
      exigir(await p.locator('#m-ajudar').isHidden(), 'opção "Ajudar a melhorar o Auditor" apareceu com a coleta desligada');
      return `${bases} | ${estudo.slice(0, 140)}`;
    });
    await passo('montar busca o SINAPI do banco e lista o que falta', p, async () => {
      await p.selectOption('#b-tipo', 'edificios');
      await p.fill('#b-iss', '3');
      await p.fill('#m-desconto', '10');
      await p.click('#btn-montar');
      await p.waitForSelector('#passo-resultado:not([hidden])');
      const linha = (await p.innerText('#r-corpo tr:nth-child(1)')).replace(/\s+/g, ' ');
      exigir(/SINAPI 990201 · 2026-10 · AM · não desonerado/.test(linha) && /88,10/.test(linha), linha);
      exigir(await p.locator('#p-corpo tr').count() === 2, 'deviam faltar 2 itens (ORSE e composição montada)');
      const alertas = await p.innerText('#a-lista');
      exigir(/Item sem preço de referência/.test(alertas) && /art\. 23/.test(alertas), alertas.slice(0, 300));
      return linha;
    });
    await passo('preço da ORSE e 3 cotações fecham o orçamento', p, async () => {
      await p.fill('[data-man-p="1.2"]', '600,00'); await p.fill('[data-man-d="1.2"]', '09/2026');
      for (const [i, f, v] of [[0, 'Loja A', '230'], [1, 'Loja B', '241'], [2, 'Loja C', '253']]) {
        await p.fill(`[data-cot-f="1.3"][data-i="${i}"]`, f); await p.fill(`[data-cot-v="1.3"][data-i="${i}"]`, v);
      }
      await p.click('#btn-remontar');
      await p.waitForFunction(() => !document.querySelector('#r-corpo tr.falta') && /Cotações 1/.test(document.getElementById('r-totais').textContent));
      const tot = (await p.innerText('#r-totais')).replace(/\s+/g, ' '), cot = (await p.innerText('#r-corpo tr:nth-child(3)')).replace(/\s+/g, ' ');
      exigir(/Mediana de 3 cotação\(ões\): Loja A R\$ 230,00; Loja B R\$ 241,00; Loja C R\$ 253,00 → R\$ 241,00/.test(cot), cot);
      exigir(/Tabela 1 · Digitado 1 · Cotações 1/.test(tot), tot);
      // Só o preço digitado da ORSE fica sem CPU: o Auditor pede a composição (recusa confirmada no TRE-AM 2/2023).
      const r = (await p.innerText('#a-resumo')).replace(/\s+/g, ' '), lista = await p.innerText('#a-lista');
      exigir(/^1 alerta\(s\) que podem desclassificar/.test(r), r);
      exigir(/CPU incompleta[\s\S]*1 item\(ns\) sem a composição \(CPU\): 1\.2\./.test(lista), lista.slice(0, 400));
      exigir(/Antes da disputa/.test(lista), 'sem o lembrete do envio');
      return `${tot} | ${r}`;
    });
    await passo('valor do lance: a planilha é ajustada para caber no lance', p, async () => {
      await p.fill('#m-lance', '2.000,00');
      await p.click('#btn-montar');
      await p.waitForFunction(() => /Ajustado ao lance de R\$\s2\.000,00/.test(document.getElementById('r-totais').textContent));
      const t = (await p.innerText('#r-totais')).replace(/\s+/g, ' '), d = await p.inputValue('#m-desconto');
      const global = Number(/Preço global R\$\s([\d.,]+)/.exec(t)[1].replace(/\./g, '').replace(',', '.'));
      exigir(global <= 2000 && global > 1990, t);
      await p.fill('#m-lance', ''); await p.fill('#m-desconto', '10'); await p.click('#btn-montar');
      await p.waitForFunction(() => !/Ajustado ao lance/.test(document.getElementById('r-totais').textContent));
      return `${t} | desconto ${d}%`;
    });
    await passo('baixar a planilha completa (10 abas, com a conferência antes de enviar) e a do edital preenchida', p, async () => {
      const [d1] = await Promise.all([p.waitForEvent('download'), p.click('#btn-baixar-completa')]);
      const abas = lerXlsx(fs.readFileSync(await d1.path()));
      fs.copyFileSync(await d1.path(), path.join(PRINTS, d1.suggestedFilename()));
      exigir(abas.map((a) => a.nome).join('|') === 'Orçamento sintético|CPU|Composições próprias|BDI|Encargos sociais|Curva ABC|Cronograma|Carta-proposta|Alertas do Auditor|Conferência antes de enviar', abas.map((a) => a.nome).join('|'));
      exigir(abas.every((a) => a.linhas.flat().includes('Revisão e assinatura de engenheiro ou arquiteto responsável são obrigatórias.')), 'aba sem o aviso do engenheiro');
      const l13 = abas[0].linhas.find((l) => l[0] === '1.3');
      exigir(l13 && l13[6] === 241 && l13[8] === 0.1, `item 1.3: ${JSON.stringify(l13)}`);
      const [d2] = await Promise.all([p.waitForEvent('download'), p.click('#btn-baixar-edital')]);
      const ed = lerXlsx(fs.readFileSync(await d2.path()))[0].linhas, l12 = ed.find((l) => l[0] === '1.2');
      exigir(l12 && l12[6] === 540 && l12[7] > 540, `edital 1.2: ${JSON.stringify(l12)}`);
      exigir(abas[9].linhas.some((l) => l[0] === 'I03' && l[6] === '(   )'), 'conferência sem o item de envio');
      return `${d1.suggestedFilename()} + ${d2.suggestedFilename()}`;
    });
    await passo('data-base 09/2026: preços do histórico e aviso de referência mais nova', p, async () => {
      await p.fill('#l-data', '2026-09');
      await p.dispatchEvent('#l-data', 'change');
      exigir(/Existe referência mais nova: 2026-10/.test(await p.innerText('#l-base')), await p.innerText('#l-base'));
      await p.click('#btn-montar');
      await p.waitForFunction(() => /2026-09/.test(document.querySelector('#r-corpo tr:nth-child(1)')?.textContent || ''));
      const linha = (await p.innerText('#r-corpo tr:nth-child(1)')).replace(/\s+/g, ' '), ref = await p.innerText('#r-referencia');
      exigir(/SINAPI 990201 · 2026-09 · AM · não desonerado/.test(linha) && /80,00/.test(linha), linha);
      exigir(/Preços do SINAPI de 2026-09, a data-base do edital\. Existe referência mais nova: 2026-10\./.test(ref), ref);
      await p.fill('#l-data', '2026-10'); await p.dispatchEvent('#l-data', 'change'); await p.click('#btn-montar');
      await p.waitForFunction(() => /2026-10/.test(document.querySelector('#r-corpo tr:nth-child(1)')?.textContent || ''));
      return `${linha} | ${ref}`;
    });
    await passo('recarregar a página não perde o trabalho (rascunho no navegador)', p, async () => {
      await p.reload();
      // Volta sozinho, sem clique, e as contas são refeitas (23/11: o dono recarregou e achou que tinha perdido tudo).
      await p.waitForSelector('#rascunho:not([hidden])');
      const t = await p.innerText('#rascunho-texto');
      await p.waitForSelector('#passo-resultado:not([hidden])');
      exigir(await p.inputValue('#m-desconto') === '10' && await p.inputValue('#b-iss') === '3', 'campos não voltaram');
      exigir(/Digitado 1 · Cotações 1/.test(await p.innerText('#r-totais')), 'preço digitado e cotações não voltaram');
      return t;
    });
    await passo('1280 px: sem rolagem lateral', p, async () => {
      const larg = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      exigir(larg[0] <= larg[1], `rolagem lateral ${larg}`);
      await p.screenshot({ path: path.join(PRINTS, 'orcamento-1280.png'), fullPage: true });
      return larg.join(' ≤ ');
    });
    await passo('375 px: sem rolagem lateral, tabelas viram cartões', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 });
      await p.waitForTimeout(300);
      const larg = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      exigir(larg[0] <= larg[1], `rolagem lateral ${larg}`);
      await p.screenshot({ path: path.join(PRINTS, 'orcamento-375.png'), fullPage: true });
      return larg.join(' ≤ ');
    });
    await passo('sem erro no console nem resposta 4xx/5xx', p, async () => {
      const erros = p.erros.filter((e) => !/favicon/.test(e));
      exigir(!erros.length, erros.join(' | '));
    });
    await passo('normas-obra.html: cliente que não é o dono não vê a fila de normas', p, async () => {
      await p.goto(SITE + '/normas-obra.html');
      await p.waitForSelector('#aviso:not([hidden])');
      const t = await p.innerText('#aviso');
      exigir(/Página só do dono/.test(t), t);
      exigir(await p.locator('#lista-card').isHidden(), 'lista visível para quem não é dono');
      return t;
    });
    // Plano Essencial: a tela trava com o aviso fixo (sem pop-up).
    const u = seed.usuarios.outra_org;
    essencialOriginal = psql(`select plano||'|'||situacao||'|'||coalesce(vence_em::text,'') from public.assinaturas where usuario_id='${u.id}'`);
    psql(`update public.assinaturas set plano='essencial', situacao='ativa', vence_em=current_date+30 where usuario_id='${u.id}'`);
    const e = await novaPagina(nav); await entrar(e, u);
    await passo('plano Essencial vê a trava "Esta parte não está no seu plano"', e, async () => {
      await e.goto(SITE + '/orcamento-obra.html');
      await e.waitForSelector('.trava-plano', { timeout: 15000 });
      const t = (await e.innerText('.trava-plano')).replace(/\s+/g, ' ');
      exigir(/Esta parte não está no seu plano/.test(t) && /Orçamento de obra/.test(t), t);
      exigir(!(await e.locator('#form-edital').isVisible()), 'formulário visível no Essencial');
      return t.slice(0, 120);
    });
  } finally {
    if (essencialOriginal) {
      const [plano, situacao, vence] = essencialOriginal.split('|');
      psql(`update public.assinaturas set plano='${plano}', situacao='${situacao}', vence_em=${vence ? `'${vence}'` : 'null'} where usuario_id='${seed.usuarios.outra_org.id}'`);
    }
    await limpar().catch(() => {});
    await nav.close();
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(`${resultados.length - falhas}/${resultados.length} passos ok`);
    process.exitCode = falhas ? 1 : 0;
  }
})();
