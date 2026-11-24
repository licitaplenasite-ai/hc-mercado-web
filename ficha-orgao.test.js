'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./ficha-orgao.js');

test('identifica o órgão pelo CNPJ do número de controle do PNCP, ou pelo nome', () => {
  assert.equal(F.cnpjDeControle('12345678000190-1-000083/2026'), '12345678000190');
  assert.equal(F.cnpjDeControle('objeto|orgao|AM'), null, 'chave sem número de controle');
  assert.equal(F.cnpjDeControle(null), null);
  assert.equal(F.chaveOrgao({ cnpj: '12.345.678/0001-90', nome: 'X' }), 'cnpj:12345678000190', 'CNPJ vence o nome');
  assert.equal(F.chaveOrgao({ nome: '  Prefeitura Municipal de São Gabriel da Cachoeira – AM ' }), 'nome:prefeitura municipal de sao gabriel da cachoeira am');
  assert.equal(F.chaveOrgao({ nome: 'ab' }), null);
  assert.equal(F.chaveOrgao({ nome: '–––' }), null);
  assert.equal(F.chaveOrgao({}), null);
  // Mesmo formato do CHECK de operacao_orgaos_registros.orgao_chave.
  const check = /^(cnpj:[0-9]{14}|nome:[a-z0-9][a-z0-9 .,/()-]{2,219})$/;
  for (const nome of ['Secretaria de Saúde (SEMSA)', 'Câmara Municipal & Cia', 'x'.repeat(400)]) assert.match(F.chaveOrgao({ nome }), check, nome);
});

test('link da ficha e leitura dos parâmetros', () => {
  assert.equal(F.linkFicha({ controle: '12345678000190-1-000083/2026', nome: 'Prefeitura X' }), 'orgao.html?cnpj=12345678000190&nome=Prefeitura+X');
  assert.equal(F.linkFicha({ nome: 'Órgão & Cia' }), 'orgao.html?nome=%C3%93rg%C3%A3o+%26+Cia');
  assert.equal(F.linkFicha({}), null);
  // Link pronto das telas (Boletim, Pesquisa de Preços, Meu dia...): nome escapado, title e ícone "abrir".
  const h = F.linkFichaHtml({ nome: 'Pref <x>' }, { texto: 'Pref <x>', classe: 'extra' });
  assert.match(h, /^<a class="link-ficha-orgao extra" href="orgao\.html\?nome=Pref\+%3Cx%3E" title="Ver ficha do órgão">Pref <span class="link-ficha-fim">&lt;x&gt;<svg/);
  assert.match(h, /ph-arrow-square-out/);
  assert.equal(F.linkFichaHtml({}), '');
  assert.deepEqual(F.lerParametros('?cnpj=12.345.678/0001-90&nome=Prefeitura'), { cnpj: '12345678000190', nome: 'Prefeitura' });
  assert.deepEqual(F.lerParametros('?controle=12345678000190-1-000083/2026'), { cnpj: '12345678000190', nome: '' });
  assert.deepEqual(F.lerParametros('?cnpj=123'), { cnpj: null, nome: '' });
  assert.equal(F.formatarCnpj('12345678000190'), '12.345.678/0001-90');
  assert.equal(F.formatarCnpj(null), '');
});

test('situação da empresa em cada processo com o órgão', () => {
  const s = (p) => F.situacaoProcesso(p).chave;
  assert.equal(s({ status: 'homologado' }), 'ganhou');
  assert.equal(s({ status: 'sessao', situacao_resultado: 'vitoria_parcial' }), 'ganhou');
  assert.equal(s({ status: 'perdido' }), 'perdeu');
  assert.equal(s({ status: 'habilitacao', situacao_resultado: 'sem_vitoria' }), 'perdeu');
  assert.equal(s({ status: 'triagem', decisao: 'nao_participar' }), 'nao_participou');
  assert.equal(s({ status: 'arquivado' }), 'nao_participou');
  assert.equal(s({ status: 'sessao', situacao_resultado: 'revogado_anulado' }), 'nao_participou');
  assert.equal(s({ status: 'preparacao' }), 'andamento');
  assert.equal(F.situacaoProcesso({ status: 'perdido' }).texto, 'Perdeu');
});

test('resumo do relacionamento: vitórias, perdas, valor ganho e taxa', () => {
  const r = F.resumirRelacionamento([
    { status: 'homologado', valor_homologado: '1000.50' },
    { status: 'contratado', valor_homologado: null },
    { status: 'perdido', valor_homologado: 999 },
    { status: 'preparacao' },
    { status: 'arquivado' },
  ]);
  assert.deepEqual(r, { total: 5, ganhou: 2, perdeu: 1, andamento: 1, nao_participou: 1, valorGanho: 1000.5, ganhosSemValor: 1, taxaVitoria: 67 });
  assert.equal(F.resumirRelacionamento([{ status: 'preparacao' }]).taxaVitoria, null, 'sem disputa decidida, sem taxa');
  assert.equal(F.resumirRelacionamento(null).total, 0);
});

test('prazo da licitação aberta em texto e classe', () => {
  const hoje = '2026-11-24';
  assert.deepEqual(F.prazoAberta('2026-11-24', hoje), { classe: 'atencao', texto: 'Atenção: fecha hoje' });
  assert.deepEqual(F.prazoAberta('2026-11-25T10:00:00', hoje), { classe: 'atencao', texto: 'Atenção: fecha em 1 dia' });
  assert.equal(F.prazoAberta('2026-11-27', hoje).classe, 'atencao');
  assert.deepEqual(F.prazoAberta('2026-11-28', hoje), { classe: 'emdia', texto: 'Aberta: 4 dias para propostas' });
  assert.equal(F.prazoAberta('2026-11-23', hoje).classe, 'atrasado');
  assert.equal(F.prazoAberta(null, hoje).classe, 'neutro');
});

test('contato e anotação: mensagem que diz o que fazer, sem CPF', () => {
  assert.deepEqual(F.validarContato({ nome: ' Maria ', papel: 'Pregoeira', telefone: '(92) 3333-4444', email: 'maria@orgao.gov.br' }),
    { dados: { nome: 'Maria', papel: 'Pregoeira', telefone: '(92) 3333-4444', email: 'maria@orgao.gov.br', texto: null } });
  assert.equal(F.validarContato({ nome: '' }).campo, 'nome');
  assert.equal(F.validarContato({ nome: 'Ana', telefone: 'abc' }).campo, 'telefone');
  assert.equal(F.validarContato({ nome: 'Ana', email: 'ana@' }).campo, 'email');
  assert.match(F.validarContato({ nome: 'Ana', texto: 'CPF 123.456.789-09' }).erro, /CPF/);
  assert.equal(F.validarContato({ nome: 'Ana', texto: 'x'.repeat(2001) }).campo, 'texto');
  // LGPD (revisão 24/11): CPF também não entra pela função nem pelo telefone; celular de 11 dígitos continua valendo.
  assert.deepEqual(F.validarContato({ nome: 'Ana', papel: 'Fiscal 123.456.789-09' }), { erro: 'Não guardamos CPF. Tire o número e salve de novo.', campo: 'papel' });
  assert.equal(F.validarContato({ nome: 'Ana', telefone: '123.456.789-09' }).campo, 'telefone');
  assert.ok(F.validarContato({ nome: 'Ana', telefone: '92999998888' }).dados, 'celular com DDD sem formatação');
  assert.ok(F.validarContato({ nome: 'Ana', telefone: '(92) 99999-8888' }).dados);
  assert.deepEqual(F.validarAnotacao('  Pede amostra  '), { dados: { texto: 'Pede amostra' } });
  assert.match(F.validarAnotacao(' ').erro, /Escreva/);
  assert.match(F.validarAnotacao('12345678909').erro, /CPF/);
  assert.equal(F.padraoIlike('100%_ok\\'), '100\\%\\_ok\\\\');
});

test('link do PNCP só a partir de número de controle válido', () => {
  assert.equal(F.linkPncp('12345678000190-1-000083/2026'), 'https://pncp.gov.br/app/editais/12345678000190/2026/83');
  assert.equal(F.linkPncp('12345678000190-2-000001/2026'), 'https://pncp.gov.br/app/contratos/12345678000190/2026/1');
  assert.equal(F.linkPncp('12345678000190-1-000005/2025-000001'), 'https://pncp.gov.br/app/atas/12345678000190/2025/5/1');
  assert.equal(F.linkPncp('javascript:alert(1)'), null);
  assert.equal(F.linkPncp(null), null);
});
