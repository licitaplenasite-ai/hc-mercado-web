/* global document, window -- usado só dentro de p.evaluate/waitForFunction (roda no navegador) */
// Corrigir razão social/CNPJ (operacao.html) e reconfirmar a identificação. Defeito real de 23/11: a HCM estava com
// CNPJ de 13 dígitos, não havia como corrigir pela tela e, depois da invalidação, endereço/representante/cargo sumiam.
// Fluxo: CNPJ errado -> corrigir -> identificação invalidada -> tela traz os dados -> confirmar -> proposta usa o CNPJ novo.
//   PORTA_TESTE=8815 node ambiente-teste/servidor.cjs   (outro terminal; subir.cjs antes, com empresa_editar.sql)
//   PORTA_TESTE=8815 PRINTS=<pasta> node ambiente-teste/e2e-empresa-editar.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-empresa-editar';
const { banco, chaves, comoUsuario, passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');

const EMPRESA = seed.ids.empA2, ORG = seed.ids.orgA;
const CNPJ_ORIGINAL = '12345678000195', CNPJ_ERRADO = '1222333000128', CNPJ_CERTO = '01222333000128';
const DADOS = { endereco: 'Rua Fictícia da Correção, 50 — Manaus/AM', representante: 'Pessoa Representante (exemplo)', cargo: 'Sócia administradora' };
const servico = (metodo, caminho, corpo) => fetch(chaves.API_URL + caminho, { method: metodo, headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: corpo ? JSON.stringify(corpo) : undefined })
  .then(async r => { if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${await r.text()}`); return r.status === 204 ? null : r.json(); });
const identificacao = async () => (await banco(`operacao_identificacao_empresa?empresa_id=eq.${EMPRESA}&select=*`))[0];

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  // Cenário: empresa com CNPJ de 13 dígitos e identificação já confirmada (como a HCM antes da correção no banco).
  await servico('DELETE', `/rest/v1/operacao_identificacao_empresa?empresa_id=eq.${EMPRESA}`);
  await servico('PATCH', `/rest/v1/operacao_empresas?id=eq.${EMPRESA}`, { cnpj: CNPJ_ERRADO });
  await servico('POST', '/rest/v1/operacao_identificacao_empresa', { empresa_id: EMPRESA, organizacao_id: ORG, dados_confirmados: DADOS, proveniencia: [], confirmado_por: seed.usuarios.gestor.id });
  const [processo] = await servico('POST', '/rest/v1/operacao_processos', { organizacao_id: ORG, empresa_id: EMPRESA, numero: '90001/2026 (exemplo)', orgao: 'Órgão Fictício de Teste', objeto: 'Processo de exemplo para a correção de CNPJ', status: 'preparacao' });
  const [item] = await servico('POST', '/rest/v1/operacao_itens_resultado', { organizacao_id: ORG, processo_id: processo.id, identificador: '1', descricao: 'Papel A4 (exemplo)', quantidade: 10, unidade: 'CX', valor_unitario_proposta: 25.5, marca: 'Marca Exemplo' });
  const proposta = async () => {
    const r = await comoUsuario(seed.usuarios.gestor, '/rest/v1/rpc/meu_acesso_operacao', { method: 'POST', body: '{}' });
    const resp = await fetch(`${SITE}/api/kit-documentos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r.token },
      body: JSON.stringify({ acao: 'preparar', empresaId: EMPRESA, processoId: processo.id, tipo: 'proposta', proposta: { itemIds: [item.id], unidades: { [item.id]: 'CX' }, validade: '60 dias', prazoEntrega: '10 dias', pagamento: '30 dias' } }) });
    return { status: resp.status, corpo: await resp.json() };
  };

  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const p = await novaPagina(navegador, seed.usuarios.gestor);
    await p.setViewportSize({ width: 1280, height: 900 });
    const abrir = async () => {
      await p.goto(`${SITE}/operacao.html?aba=identificacao&empresa=${EMPRESA}`);
      await p.waitForSelector('#perfil-salvar', { timeout: 30000 });
      await p.click('.aba[data-aba="identificacao"]');
      await p.waitForFunction(() => /Dados carregados|invalidada|Identificação confirmada/.test(document.querySelector('#identificacao-empresa [role=status]')?.textContent || ''), null, { timeout: 20000 });
    };

    await passo('antes: proposta sai com o CNPJ errado de 13 dígitos', null, async () => {
      const r = await proposta();
      exigir(r.status === 422 || (r.status === 200 && r.corpo.previa.texto.includes('CNPJ: ' + CNPJ_ERRADO)), `resposta: ${r.status} ${JSON.stringify(r.corpo).slice(0, 200)}`);
      return r.status === 200 ? 'prévia com CNPJ: ' + CNPJ_ERRADO : 'kit já recusa: ' + r.corpo.erro;
    });

    await passo('gestor vê "Corrigir razão social ou CNPJ" e o aviso do que acontece', p, async () => {
      await abrir();
      exigir(await p.isVisible('#btn-editar-empresa'), 'botão não aparece para o gestor');
      await p.click('#btn-editar-empresa');
      exigir(await p.isVisible('#modal-editar-empresa'), 'modal não abriu');
      const aviso = await p.innerText('#modal-editar-empresa .aviso-edicao');
      exigir(/invalida a identificação confirmada/.test(aviso) && /provas dos documentos/.test(aviso), 'aviso: ' + aviso);
      exigir(/14 dígitos; você digitou 13/.test(await p.innerText('#editar-empresa-cnpj-msg')), 'não avisou que o CNPJ atual está errado');
      return aviso;
    });

    await passo('CNPJ com 13 dígitos ou dígito errado é recusado na hora, com o que fazer', p, async () => {
      await p.fill('#editar-empresa-cnpj', '1222333000128'); await p.click('#modal-editar-empresa button[type=submit]');
      exigir(/falta um zero/.test(await p.innerText('#editar-empresa-cnpj-msg')), 'sem orientação para 13 dígitos');
      await p.fill('#editar-empresa-cnpj', '01.222.333/0001-29');
      const msg = await p.innerText('#editar-empresa-cnpj-msg');
      exigir(/dígito verificador/.test(msg), 'sem aviso de dígito: ' + msg);
      exigir((await p.getAttribute('#editar-empresa-cnpj', 'aria-invalid')) === 'true', 'campo não marcado como inválido');
      await p.click('#modal-editar-empresa button[type=submit]');
      exigir((await banco(`operacao_empresas?id=eq.${EMPRESA}&select=cnpj`))[0].cnpj === CNPJ_ERRADO, 'gravou CNPJ inválido');
      return msg;
    });

    await passo('salvar o CNPJ certo grava, invalida a identificação e guarda os dados anteriores', p, async () => {
      await p.fill('#editar-empresa-cnpj', '01.222.333/0001-28');
      exigir(!(await p.innerText('#editar-empresa-cnpj-msg')).trim(), 'aviso continua com CNPJ certo');
      await p.click('#modal-editar-empresa button[type=submit]');
      await p.waitForFunction(() => /Empresa corrigida/.test(document.getElementById('aviso').textContent), null, { timeout: 20000 });
      exigir((await banco(`operacao_empresas?id=eq.${EMPRESA}&select=cnpj`))[0].cnpj === CNPJ_CERTO, 'CNPJ não gravado');
      const id = await identificacao();
      exigir(id.invalidado_em && id.dados_confirmados.cargo === DADOS.cargo, 'identificação não invalidada ou dados perdidos');
      return await p.innerText('#aviso');
    });

    await passo('a tela traz endereço, representante e cargo para conferir (não dá como confirmados)', p, async () => {
      await p.click('.aba[data-aba="identificacao"]');
      await p.waitForFunction(() => /invalidada/.test(document.querySelector('#identificacao-empresa [role=status]')?.textContent || ''), null, { timeout: 20000 });
      for (const [k, v] of Object.entries(DADOS)) exigir(await p.inputValue('#empresa-identificacao-' + k) === v, k + ' não voltou');
      exigir(await p.inputValue('#empresa-identificacao-cnpj') === CNPJ_CERTO, 'CNPJ novo não aparece na identificação');
      const status = await p.innerText('#identificacao-empresa [role=status]');
      exigir(/confira e confirme de novo/.test(status), 'status: ' + status);
      exigir(!(await p.isChecked('#empresa-identificacao-revisao')), 'conferência já marcada');
      const r = await proposta();
      exigir(r.status === 422 && /Confirme a identificação/.test(r.corpo.erro || ''), 'proposta saiu sem reconfirmar: ' + r.status);
      return status;
    });

    await passo('"Carregar identificação salva" também traz os dados de volta', p, async () => {
      await p.fill('#empresa-identificacao-cargo', '');
      await p.click('text=Carregar identificação salva');
      await p.waitForFunction(c => document.getElementById('empresa-identificacao-cargo').value === c, DADOS.cargo, { timeout: 20000 });
      return 'cargo voltou';
    });

    await passo('marcar a conferência e salvar confirma de novo', p, async () => {
      await p.check('#empresa-identificacao-revisao');
      await p.click('#perfil-salvar');
      await p.waitForFunction(() => { const t = document.getElementById('perfil-aviso').textContent; return t && !/Salvando/.test(t); }, null, { timeout: 30000 });
      const aviso = await p.innerText('#perfil-aviso');
      const id = await identificacao();
      exigir(!id.invalidado_em && id.dados_confirmados.representante === DADOS.representante, 'não reconfirmou: ' + aviso);
      return aviso;
    });

    await passo('proposta usa o CNPJ novo', null, async () => {
      const r = await proposta();
      exigir(r.status === 200, 'proposta: ' + r.status + ' ' + JSON.stringify(r.corpo).slice(0, 200));
      exigir(r.corpo.previa.texto.includes('CNPJ: ' + CNPJ_CERTO) && !r.corpo.previa.texto.includes('CNPJ: ' + CNPJ_ERRADO + '\n'), 'CNPJ da prévia errado');
      return r.corpo.previa.texto.split('\n').find(l => l.startsWith('CNPJ'));
    });

    await passo('cadastro de empresa nova recusa CNPJ de 13 dígitos', p, async () => {
      if (!(await p.isVisible('#btn-nova-empresa'))) return 'plano sem "+ Empresa" (1 CNPJ): conferido só pelo teste unitário';
      const antes = (await banco(`operacao_empresas?organizacao_id=eq.${ORG}&select=id`)).length;
      await p.click('#btn-nova-empresa');
      await p.fill('#form-empresa [name=razao_social]', 'Empresa Nova (exemplo)');
      await p.fill('#nova-empresa-cnpj', '1222333000199'); await p.click('#form-empresa button[type=submit]');
      const msg = await p.innerText('#nova-empresa-cnpj-msg');
      exigir(/14 dígitos/.test(msg), 'sem aviso: ' + msg);
      exigir((await banco(`operacao_empresas?organizacao_id=eq.${ORG}&select=id`)).length === antes, 'criou empresa com CNPJ inválido');
      await p.click('#modal-empresa [data-fechar]');
      return msg;
    });

    await passo('celular 375 px: modal de correção sem rolagem lateral', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 }); await p.waitForTimeout(300);
      await p.click('#btn-editar-empresa');
      exigir(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'rolagem lateral');
      exigir((await p.getAttribute('#editar-empresa-cnpj', 'inputmode')) === 'numeric', 'sem teclado numérico');
      await p.screenshot({ path: path.join(PRINTS, 'modal-correcao-375.png') });
      await p.click('#modal-editar-empresa [data-fechar]');
      await p.setViewportSize({ width: 1280, height: 900 });
    });

    await passo('operador e leitura não veem o botão; o banco recusa operador', null, async () => {
      for (const u of ['operador', 'leitura']) {
        const q = await novaPagina(navegador, seed.usuarios[u]);
        await q.goto(`${SITE}/operacao.html?aba=identificacao`); await q.waitForSelector('#perfil-salvar', { timeout: 30000 }).catch(() => {});
        await q.waitForTimeout(800);
        exigir(!(await q.isVisible('#btn-editar-empresa')), u + ' vê o botão');
        await q.context().close();
      }
      const r = await comoUsuario(seed.usuarios.operador, `/rest/v1/operacao_empresas?id=eq.${seed.ids.empA1}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ cnpj: CNPJ_CERTO }) });
      exigir(r.status >= 400 || r.corpo === '[]', 'operador alterou CNPJ: ' + r.status + ' ' + r.corpo);
      return `operador: ${r.status} ${r.corpo.slice(0, 80)}`;
    });

    await passo('console sem erro de JavaScript', null, async () => {
      const js = p.erros.filter(e => /pageerror|console/.test(e) && !/Failed to load resource|favicon|hcaptcha/i.test(e));
      exigir(!js.length, js.join(' | '));
      return `${p.erros.length} avisos de rede/console no total: ${p.erros.slice(0, 5).join(' | ')}`;
    });
  } finally {
    await navegador.close();
    // Volta a empresa de teste ao estado do seed.
    await servico('DELETE', `/rest/v1/operacao_processos?id=eq.${processo.id}`).catch(e => console.log('limpeza processo:', e.message));
    await servico('DELETE', `/rest/v1/operacao_identificacao_empresa?empresa_id=eq.${EMPRESA}`).catch(e => console.log('limpeza identificação:', e.message));
    await servico('PATCH', `/rest/v1/operacao_empresas?id=eq.${EMPRESA}`, { cnpj: CNPJ_ORIGINAL }).catch(e => console.log('limpeza empresa:', e.message));
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : 'E2E CORRIGIR EMPRESA OK');
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
