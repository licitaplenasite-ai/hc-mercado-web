// Leitura do contrato social / alteração contratual (sem IA). Regressão 23/11: alteração contratual real de 9+ páginas
// respondia "documento excede 8 páginas" e nada era sugerido.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./empresa-documento-leitura');
const { lerPaginasPdf } = require('./netlify/functions/_empresa_pdf_leitor');
const { extrairDocumento } = require('./netlify/functions/_empresa_documentos');
const { gerarPdf, contratoFicticio } = require('./ambiente-teste/pdf-ficticio.cjs');

const EMPRESA = { razao_social: 'HCM Comércio e Serviços Ltda', cnpj: '12345678000195' };
const paginasDoContrato = total => contratoFicticio({ total });
const PREAMBULO = paginasDoContrato(2)[0];

test('contrato de 16 páginas: sede atual, sócio-administrador e cargo, com razão social e CNPJ conferidos', async () => {
  const bytes = gerarPdf(paginasDoContrato(16));
  const { numpages, paginas } = await lerPaginasPdf(bytes, 10000, Infinity);
  assert.equal(numpages, 16);
  const r = L.extrairDadosEmpresa(paginas, EMPRESA);
  assert.equal(r.sugestoes.endereco, 'Avenida Djalma Batista, nº 1000, Sala 5, Bairro Chapada, Manaus/AM, CEP 69050-010');
  assert.equal(r.sugestoes.representante, 'JOÃO DA SILVA PEREIRA');
  assert.equal(r.sugestoes.cargo, 'Sócio-administrador');
  assert.equal(r.sugestoes.cnpj, '12345678000195');
  assert.equal(r.sugestoes.razaoSocial, EMPRESA.razao_social);
  assert.deepEqual(r.evidencias.map(e => [e.campo, e.pagina]), [['endereco', 10], ['representante', 13], ['cargo', 13]]);
  assert.match(r.evidencias[1].trecho, /administração da sociedade caberá ao sócio JOÃO/);
  assert.deepEqual(r.avisos, []);
  // O servidor continua parando em 8 páginas (CPU do plano gratuito); a tela lê o resto no navegador.
  assert.match((await extrairDocumento(bytes, EMPRESA)).avisos[0], /excede 8 páginas/);
});

test('contrato curto: o servidor já sugere pelas mesmas regras (com prova da página)', async () => {
  const r = await extrairDocumento(gerarPdf(paginasDoContrato(6)), EMPRESA);
  assert.equal(r.modo, 'sugestoes');
  assert.equal(r.sugestoes.representante, 'JOÃO DA SILVA PEREIRA');
  assert.equal(r.evidencias.find(e => e.campo === 'endereco').pagina, 6);
});

test('texto todo em maiúsculas, administradora não sócia e mais de um administrador', () => {
  const maiusculas = [{ pagina: 1, texto: (PREAMBULO + '\nMARIA SOUZA LIMA, BRASILEIRA, SOLTEIRA.\nA SOCIEDADE SERÁ ADMINISTRADA PELA SÓCIA MARIA SOUZA LIMA COM OS PODERES DE ADMINISTRADORA. O SÓCIO ADMINISTRADOR PODERÁ ASSINAR SOZINHO.').toUpperCase() }];
  const a = L.extrairDadosEmpresa(maiusculas, EMPRESA);
  assert.equal(a.sugestoes.representante, 'MARIA SOUZA LIMA');
  assert.equal(a.sugestoes.cargo, 'Sócia-administradora');
  assert.equal(a.sugestoes.endereco, 'RUA ANTIGA, Nº 5, BAIRRO VELHO, MANAUS/AM, CEP 69010-000');

  const naoSocio = [{ pagina: 1, texto: PREAMBULO + '\nCARLOS ALBERTO NUNES, brasileiro, casado, administrador.\nFica designado como administrador não sócio CARLOS ALBERTO NUNES, com mandato por prazo indeterminado.' }];
  const b = L.extrairDadosEmpresa(naoSocio, EMPRESA);
  assert.equal(b.sugestoes.representante, 'CARLOS ALBERTO NUNES');
  assert.equal(b.sugestoes.cargo, 'Administrador');

  const dois = [{ pagina: 1, texto: PREAMBULO + '\nA administração da sociedade caberá aos sócios JOÃO DA SILVA PEREIRA e MARIA SOUZA LIMA, isoladamente.' }];
  const c = L.extrairDadosEmpresa(dois, EMPRESA);
  assert.equal(c.sugestoes.representante, 'JOÃO DA SILVA PEREIRA');
  assert.match(c.avisos.join(' '), /mais de um administrador/);
});

test('nome sem qualificação no documento não vira representante; cartão CNPJ segue pelos rótulos', () => {
  const solto = L.extrairDadosEmpresa([{ pagina: 1, texto: 'A administração da sociedade caberá ao sócio PEDRO ALVES ROCHA, isoladamente.' }], EMPRESA);
  assert.equal(solto.sugestoes.representante, undefined);
  const cartao = L.extrairDadosEmpresa([{ pagina: 1, texto: 'NOME EMPRESARIAL: HCM Comércio e Serviços Ltda\nENDEREÇO: Av. Djalma Batista, 1000, Manaus/AM\nREPRESENTANTE LEGAL: João da Silva Pereira\nCARGO: Sócio-administrador\nCNPJ 12.345.678/0001-95' }], EMPRESA);
  assert.deepEqual([cartao.sugestoes.endereco, cartao.sugestoes.representante, cartao.sugestoes.cargo, cartao.sugestoes.cnpj], ['Av. Djalma Batista, 1000, Manaus/AM', 'João da Silva Pereira', 'Sócio-administrador', '12345678000195']);
});

test('documento de outra empresa avisa; PDF escaneado é detectado', () => {
  const outra = L.extrairDadosEmpresa([{ pagina: 1, texto: 'XYZ LTDA, inscrita no CNPJ sob o nº 11.444.777/0001-61, com sede na Rua C, nº 3, Belém/PA, CEP 66000-000.' }], EMPRESA);
  assert.equal(outra.sugestoes.cnpj, undefined);
  assert.match(outra.avisos.join(' '), /CNPJ do cadastro/);
  assert.match(outra.avisos.join(' '), /razão social do cadastro/);
  assert.equal(L.semTexto([{ pagina: 1, texto: ' \n ' }, { pagina: 2, texto: 'p. 2' }]), true);
  assert.equal(L.semTexto([{ pagina: 1, texto: PREAMBULO }]), false);
});
