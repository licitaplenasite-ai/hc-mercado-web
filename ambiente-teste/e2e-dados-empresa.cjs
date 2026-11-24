/* global document, window -- usado só dentro de p.evaluate (roda no navegador) */
// Dados da empresa (operacao.html, aba Dados da empresa): tudo o que é digitado salva num botão só e volta ao recarregar.
// Regressão do problema real de 23/11: endereço/representante/cargo sumiam e a logo PNG 2000 px "não era aceita".
//   PORTA_TESTE=8814 node ambiente-teste/servidor.cjs   (outro terminal; subir.cjs antes)
//   PORTA_TESTE=8814 PRINTS=<pasta> LOGO_DONO=<png 2000x2000> node ambiente-teste/e2e-dados-empresa.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
process.env.PRINTS = process.env.PRINTS || 'C:/Users/harre/Desktop/LICITAPLENA/_historico/pente-fino/prints-dados-empresa';
const { banco, chaves, passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');

const EMPRESA = seed.ids.empA2;
async function abrir(p) {
  await p.goto(`${SITE}/operacao.html?aba=identificacao&empresa=${EMPRESA}`);
  await p.waitForSelector('#perfil-salvar', { timeout: 30000 });
  await p.click('.aba[data-aba="identificacao"]');
  await p.waitForFunction(() => /Dados carregados|Identificação confirmada/.test(document.querySelector('#identificacao-empresa [role=status]')?.textContent || ''), null, { timeout: 20000 });
}
const valor = (p, id) => p.inputValue('#' + id);
// Imagem gerada no próprio navegador (ruído = não comprime): devolve os bytes em base64.
const imagem = (p, largura, altura, tipo, ruido) => p.evaluate(async ([w, h, t, comRuido]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), d = g.createImageData(w, h);
  for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : comRuido ? (Math.random() * 256) | 0 : ((i >> 2) % w) * 255 / w;
  g.putImageData(d, 0, 0); g.fillStyle = '#123'; g.fillRect(0, 0, w / 3, h / 3);
  const b = await new Promise(ok => c.toBlob(ok, t, 1)); const u = new Uint8Array(await b.arrayBuffer());
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s);
}, [largura, altura, tipo, Boolean(ruido)]).then(b64 => Buffer.from(b64, 'base64'));
async function enviarLogo(p, nome, mimeType, buffer) {
  await p.evaluate(() => { document.getElementById('perfil-logo-aviso').textContent = ''; });
  await p.setInputFiles('#perfil-logo', { name: nome, mimeType, buffer });
  await p.waitForFunction(() => { const t = document.getElementById('perfil-logo-aviso').textContent; return t && !/Enviando|Ajustando/.test(t); }, null, { timeout: 30000 });
  return p.innerText('#perfil-logo-aviso');
}
const perfilNoBanco = async () => (await banco(`operacao_perfil_empresa?empresa_id=eq.${EMPRESA}&select=*`))[0];

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const p = await novaPagina(navegador, seed.usuarios.gestor);
    await p.setViewportSize({ width: 1280, height: 900 });
    // Começa do zero nesta empresa de teste (pode ser rodado de novo).
    for (const t of ['operacao_identificacao_empresa', 'operacao_premissas_empresa', 'operacao_perfil_empresa']) await fetch(`${chaves.API_URL}/rest/v1/${t}?empresa_id=eq.${EMPRESA}`, { method: 'DELETE', headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY } });

    await passo('dados: sem marcar a conferência, o botão único avisa e não perde o endereço', p, async () => {
      await abrir(p);
      await p.fill('#empresa-identificacao-endereco', 'Rua Fictícia de Teste, 200 — Manaus/AM');
      await p.fill('#empresa-identificacao-representante', 'Pessoa Representante Fictícia');
      await p.fill('#empresa-identificacao-cargo', 'Sócia administradora');
      await p.fill('#perfil-nome_fantasia', 'Horizonte (exemplo)');
      exigir(/^PNG, JPG, WEBP ou SVG, com até 10 MB/.test(await p.innerText('#perfil-logo-area .nota')), 'regra da logo não aparece');
      await p.click('#perfil-salvar');
      await p.waitForFunction(() => !/Salvando/.test(document.getElementById('perfil-aviso').textContent));
      const aviso = await p.innerText('#perfil-aviso');
      exigir(/NÃO foram salvos/.test(aviso) && /Conferi os dados/.test(aviso), 'aviso não explica: ' + aviso);
      exigir(await valor(p, 'empresa-identificacao-endereco') === 'Rua Fictícia de Teste, 200 — Manaus/AM', 'endereço sumiu da tela');
      exigir(!(await banco(`operacao_identificacao_empresa?empresa_id=eq.${EMPRESA}&select=empresa_id`)).length, 'gravou sem conferência');
      exigir((await perfilNoBanco())?.nome_fantasia === 'Horizonte (exemplo)', 'o restante do perfil não foi salvo');
      return aviso;
    });

    await passo('dados: trocar de empresa com alteração pendente pede confirmação', p, async () => {
      let mensagem = '';
      p.once('dialog', d => { mensagem = d.message(); d.dismiss(); });
      await p.selectOption('#empresa-atual', seed.ids.empA1);
      await p.waitForTimeout(500);
      exigir(/não salvas/.test(mensagem), 'sem aviso ao trocar de empresa');
      exigir(await p.inputValue('#empresa-atual') === EMPRESA, 'trocou de empresa mesmo cancelando');
      exigir(await valor(p, 'empresa-identificacao-cargo') === 'Sócia administradora', 'perdeu o cargo');
      return mensagem;
    });

    const campos = { 'perfil-telefone': '(92) 3333-0000', 'perfil-email': 'contato@exemplo.example.com', 'perfil-inscricao_estadual': '04.111.222-3',
      'perfil-inscricao_municipal': '998877', 'perfil-cpf_representante': '529.982.247-25', 'perfil-aliquota_efetiva': '6,5',
      'perfil-banco-banco': 'Banco Fictício', 'perfil-banco-agencia': '0001', 'perfil-banco-conta': '12345-6', 'perfil-banco-pix': 'pix@exemplo.example.com',
      'perfil-proposta_padrao-validade': '60 dias', 'perfil-proposta_padrao-pagamento': '30 dias após o aceite', 'perfil-proposta_padrao-prazo_entrega': '10 dias' };
    const selecoes = { 'perfil-uf_sede': 'AM', 'perfil-porte': 'me', 'perfil-regime_tributario': 'simples', 'perfil-tributos_fonte': 'contador' };
    await passo('dados: marcar a conferência e salvar grava identificação, contato, impostos, banco, proposta e premissas', p, async () => {
      await p.check('#empresa-identificacao-revisao');
      for (const [k, v] of Object.entries(campos)) await p.fill('#' + k, v);
      for (const [k, v] of Object.entries(selecoes)) await p.selectOption('#' + k, v);
      await p.fill('#perfil-premissas-0-margem_percentual', '12');
      await p.click('#perfil-add-premissa');
      await p.fill('#perfil-premissas-1-segmento', 'limpeza'); await p.fill('#perfil-premissas-1-uf', 'AM'); await p.fill('#perfil-premissas-1-frete_percentual', '3,5');
      await p.click('#perfil-salvar');
      await p.waitForFunction(() => !/Salvando/.test(document.getElementById('perfil-aviso').textContent));
      const aviso = await p.innerText('#perfil-aviso');
      exigir(/Dados salvos/.test(aviso), 'aviso: ' + aviso);
      const [id] = await banco(`operacao_identificacao_empresa?empresa_id=eq.${EMPRESA}&select=dados_confirmados`);
      exigir(id?.dados_confirmados?.cargo === 'Sócia administradora', 'identificação não gravada');
      return aviso;
    });

    await passo('dados: depois de recarregar, tudo continua preenchido', p, async () => {
      await p.reload(); await abrir(p);
      const faltando = [];
      for (const [k, v] of Object.entries({ 'empresa-identificacao-endereco': 'Rua Fictícia de Teste, 200 — Manaus/AM', 'empresa-identificacao-representante': 'Pessoa Representante Fictícia', 'empresa-identificacao-cargo': 'Sócia administradora', 'perfil-nome_fantasia': 'Horizonte (exemplo)', ...campos, ...selecoes, 'perfil-premissas-0-margem_percentual': '12', 'perfil-premissas-1-segmento': 'limpeza', 'perfil-premissas-1-frete_percentual': '3,5' })) {
        const atual = await valor(p, k);
        // CPF volta mascarado para quem não pediu "Mostrar CPF completo".
        if (k === 'perfil-cpf_representante' ? !/\*|•|529|25$/.test(atual) : atual !== v) faltando.push(`${k}="${atual}"`);
      }
      exigir(!faltando.length, 'não voltou: ' + faltando.join(', '));
      exigir(!(await p.evaluate(() => window.PerfilEmpresa && document.getElementById('perfil-aviso').textContent.includes('erro'))), 'erro ao reabrir');
      return 'todos os campos voltaram';
    });

    const logos = [];
    if (process.env.LOGO_DONO && fs.existsSync(process.env.LOGO_DONO)) logos.push(['PNG do dono 2000×2000', 'logo-dono.png', 'image/png', fs.readFileSync(process.env.LOGO_DONO)]);
    logos.push(['PNG pesado 1600×1200 (vários MB)', 'logo-pesada.png', 'image/png', await imagem(p, 1600, 1200, 'image/png', true)]);
    logos.push(['JPG grande 4000×3000', 'logo-grande.jpg', 'image/jpeg', await imagem(p, 4000, 3000, 'image/jpeg')]);
    logos.push(['WEBP 1500×800', 'logo.webp', 'image/webp', await imagem(p, 1500, 800, 'image/webp')]);
    logos.push(['SVG sem tamanho', 'logo.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><rect width="200" height="80" fill="#0b3d91"/><text x="20" y="50" font-size="30" fill="#fff">LOGO</text></svg>')]);
    for (const [nome, arquivo, mime, buffer] of logos) {
      await passo(`logo: ${nome} é aceita, aparece e fica salva`, p, async () => {
        const antes = (await perfilNoBanco())?.logo_hash;
        const aviso = await enviarLogo(p, arquivo, mime, buffer);
        exigir(/Logo salva/.test(aviso), 'aviso: ' + aviso);
        exigir(await p.isVisible('#perfil-logo-previa'), 'prévia não aparece');
        const perfil = await perfilNoBanco();
        exigir(perfil.logo_hash && perfil.logo_hash !== antes, 'logo não registrada no banco');
        return `${Math.round(buffer.length / 1024)} KB enviado → guardado ${perfil.logo_caminho.split('.').pop()}`;
      });
    }

    await passo('logo: depois de recarregar, a última logo aparece', p, async () => {
      await p.reload(); await abrir(p);
      await p.waitForFunction(() => { const i = document.getElementById('perfil-logo-previa'); return i && !i.hidden && i.src; }, null, { timeout: 20000 });
      // O servidor monta o link assinado com o endereço de produção; aqui ele é conferido no Supabase local.
      const src = await p.getAttribute('#perfil-logo-previa', 'src');
      exigir(/^https:\/\/[a-z]+\.supabase\.co\/storage\/v1\/object\/sign\/operacao-documentos\//.test(src), 'link da logo inesperado: ' + src.slice(0, 120));
      const r = await fetch(src.replace(/^https:\/\/[a-z]+\.supabase\.co/, chaves.API_URL));
      exigir(r.ok && /image\/(png|jpeg)/.test(r.headers.get('content-type') || ''), 'link assinado não abre a logo: ' + r.status);
      return `prévia com link assinado (${r.headers.get('content-type')}, ${(await r.arrayBuffer()).byteLength} bytes)`;
    });

    for (const [nome, arquivo, mime, buffer] of [['GIF', 'logo.gif', 'image/gif', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')], ['texto renomeado para .png', 'logo.png', 'image/png', Buffer.from('não sou imagem')]]) {
      await passo(`logo: ${nome} é recusada com mensagem clara`, p, async () => {
        const antes = (await perfilNoBanco()).logo_hash;
        const aviso = await enviarLogo(p, arquivo, mime, buffer);
        exigir(/PNG, JPG, WEBP ou SVG/.test(aviso) && /10 MB/.test(aviso), 'mensagem: ' + aviso);
        exigir((await perfilNoBanco()).logo_hash === antes, 'trocou a logo com arquivo inválido');
        return aviso;
      });
    }

    await passo('dados: celular 375 px sem rolagem lateral', p, async () => {
      await p.setViewportSize({ width: 375, height: 812 }); await p.waitForTimeout(500);
      exigir(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'rolagem lateral em 375 px');
      await p.screenshot({ path: path.join(PRINTS, 'dados-empresa-375.png'), fullPage: true });
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.screenshot({ path: path.join(PRINTS, 'dados-empresa-1280.png'), fullPage: true });
    });

    await passo('dados: console sem erro de JavaScript', p, async () => {
      const js = p.erros.filter(e => /pageerror|console/.test(e) && !/Failed to load resource|favicon|hcaptcha/i.test(e));
      exigir(!js.length, js.join(' | '));
      return `${p.erros.length} avisos de rede/console no total`;
    });
  } finally {
    await navegador.close();
  }
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : 'E2E DADOS DA EMPRESA OK');
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
