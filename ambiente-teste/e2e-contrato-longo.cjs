/* global document, window */
// Regressão 23/11: alteração contratual real (9+ páginas) respondia "documento excede 8 páginas". Agora o navegador lê o PDF
// com o pdf.js (CDN, mesma versão e SRI do Orçamento de obra) e sugere sede, representante e cargo, sem IA.
//   PORTA_TESTE=8814 node ambiente-teste/servidor.cjs   (outro terminal; subir.cjs antes)
//   PORTA_TESTE=8814 PRINTS=<pasta> node ambiente-teste/e2e-contrato-longo.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-contrato-longo';
const { banco, chaves, passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { gerarPdf, contratoFicticio } = require('./pdf-ficticio.cjs');

const EMPRESA = seed.ids.empA2; // Materiais Horizonte Teste LTDA, CNPJ 12345678000195 (seed.cjs)
const RAZAO = 'Materiais Horizonte Teste LTDA', CNPJ = '12.345.678/0001-95';
const status = p => p.innerText('#identificacao-empresa [role=status]');
async function abrir(p) {
  await p.goto(`${SITE}/operacao.html?aba=identificacao&empresa=${EMPRESA}`);
  await p.waitForSelector('#perfil-salvar', { timeout: 30000 });
  await p.click('.aba[data-aba="identificacao"]');
  await p.waitForFunction(() => /Dados carregados|Identificação/.test(document.querySelector('#identificacao-empresa [role=status]')?.textContent || ''), null, { timeout: 20000 });
}
async function anexarEExtrair(p, nome, bytes) {
  await p.setInputFiles('#identificacao-empresa input[type=file]', { name: nome, mimeType: 'application/pdf', buffer: bytes });
  await p.click('#identificacao-empresa >> text=Anexar PDF');
  await p.waitForFunction(() => /PDF anexado/.test(document.querySelector('#identificacao-empresa [role=status]')?.textContent || ''), null, { timeout: 20000 });
  await p.click('#identificacao-empresa >> text=Extrair sugestões do PDF selecionado');
  await p.waitForFunction(() => /Confira cada sugestão|Preencha os dados manualmente|diverge|Não conseguimos|não carregou/.test(document.querySelector('#identificacao-empresa [role=status]')?.textContent || ''), null, { timeout: 45000 });
  return { status: await status(p), texto: await p.innerText('#identificacao-empresa') };
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const t of ['operacao_identificacao_empresa']) await fetch(`${chaves.API_URL}/rest/v1/${t}?empresa_id=eq.${EMPRESA}`, { method: 'DELETE', headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY } });
    const p = await novaPagina(navegador, seed.usuarios.gestor);
    await p.setViewportSize({ width: 1280, height: 900 });

    await passo('contrato longo: alteração contratual de 16 páginas é lida e sugere sede, representante e cargo', p, async () => {
      await abrir(p);
      const { status: s, texto } = await anexarEExtrair(p, 'alteracao-contratual-ficticia-16-paginas.pdf', gerarPdf(contratoFicticio({ total: 16, razao: RAZAO.toUpperCase(), cnpj: CNPJ })));
      exigir(!/excede 8 páginas/.test(texto), 'ainda mostra o limite de 8 páginas');
      exigir(/Lemos as 16 páginas/.test(texto), 'não leu no navegador: ' + texto.slice(0, 400));
      for (const b of ['Usar endereço: Avenida Djalma Batista, nº 1000, Sala 5, Bairro Chapada, Manaus/AM, CEP 69050-010', 'Usar representante: JOÃO DA SILVA PEREIRA', 'Usar cargo: Sócio-administrador']) {
        exigir(await p.getByRole('button', { name: b }).count() === 1, `falta o botão "${b}"; tela: ${texto.slice(0, 600)}`);
        await p.getByRole('button', { name: b }).click();
      }
      exigir(/Página 13:/.test(texto) && /Página 10:/.test(texto), 'sem a página de onde veio cada sugestão');
      return s;
    });

    await passo('contrato longo: conferir, salvar e recarregar mantém os três campos', p, async () => {
      await p.check('#empresa-identificacao-revisao');
      await p.click('#perfil-salvar');
      await p.waitForFunction(() => !/Salvando/.test(document.getElementById('perfil-aviso').textContent));
      const aviso = await p.innerText('#perfil-aviso');
      exigir(/Dados salvos/.test(aviso), 'aviso: ' + aviso);
      const [id] = await banco(`operacao_identificacao_empresa?empresa_id=eq.${EMPRESA}&select=dados_confirmados`);
      exigir(id?.dados_confirmados?.representante === 'JOÃO DA SILVA PEREIRA', 'não gravou: ' + JSON.stringify(id));
      await p.reload(); await abrir(p);
      exigir(await p.inputValue('#empresa-identificacao-cargo') === 'Sócio-administrador', 'cargo não voltou');
      exigir(/Avenida Djalma Batista/.test(await p.inputValue('#empresa-identificacao-endereco')), 'endereço não voltou');
      return aviso;
    });

    await passo('contrato longo escaneado (sem texto): mensagem clara', p, async () => {
      const { texto } = await anexarEExtrair(p, 'contrato-escaneado-ficticio.pdf', gerarPdf(Array.from({ length: 12 }, () => '')));
      exigir(/imagem escaneada, sem texto para ler/.test(texto), 'mensagem: ' + texto.slice(0, 400));
    });

    await passo('contrato longo: celular 375 px e console sem erro', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 }); await p.waitForTimeout(500);
      exigir(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'rolagem lateral em 375 px');
      const js = p.erros.filter(e => /pageerror|console/.test(e) && !/Failed to load resource|favicon|hcaptcha/i.test(e));
      exigir(!js.length, js.join(' | '));
    });
  } finally {
    await navegador.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : 'E2E CONTRATO LONGO OK');
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
