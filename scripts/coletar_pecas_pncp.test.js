const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./coletar_pecas_pncp.js');

// Formato da API pública do PNCP conferido em 20/11/2026 (dados fictícios).
const COMPRA = { orgaoEntidade: { cnpj: '89971758000180', razaoSocial: 'MUNICIPIO FICTICIO' }, unidadeOrgao: { codigoUnidade: '1' }, anoCompra: 2026, sequencialCompra: 1381,
  numeroCompra: '106', numeroControlePNCP: '89971758000180-1-001381/2026', amparoLegal: { nome: 'Lei 14.133/2021, Art. 28, I' } };
const DOC = (seq, titulo, tipoDocumentoId = 16) => ({ statusAtivo: true, sequencialDocumento: seq, titulo, tipoDocumentoId, dataPublicacaoPncp: '2026-11-10T03:12:40',
  url: `https://pncp.gov.br/pncp-api/v1/orgaos/89971758000180/compras/2026/1381/arquivos/${seq}` });
const TEXTO = 'Pedido de esclarecimento da EMPRESA FICTICIA LTDA, CNPJ 40.849.028/0001-12, assinado por Joaquim Barbosa Lima, CPF 123.456.789-09, '
  + 'e-mail joaquim@exemplo.com.br. O órgão (CNPJ 89.971.758/0001-80) responde que o item 3 aceita marca similar. ' + 'x'.repeat(200);

test('tipo pelo título do arquivo; recursos humanos/financeiros não são recurso', () => {
  assert.equal(P.tipoPeloTitulo('35784_ESCLARECIMENTO PREGAO 106 2026.pdf'), 'esclarecimento');
  assert.equal(P.tipoPeloTitulo('Resposta à Impugnação.pdf'), 'impugnacao');
  assert.equal(P.tipoPeloTitulo('CONTRARRAZOES_empresa.pdf'), 'contrarrazao');
  assert.equal(P.tipoPeloTitulo('Contra-razão recurso.pdf'), 'contrarrazao');
  assert.equal(P.tipoPeloTitulo('Decisão do Recurso Administrativo.pdf'), 'recurso');
  assert.equal(P.tipoPeloTitulo('Intenção de recurso.pdf'), 'intencao_recurso');
  assert.equal(P.tipoPeloTitulo('Declaração de recursos financeiros.pdf'), null);
  assert.equal(P.tipoPeloTitulo('Termo de Referência.pdf'), null);
});

test('coletarCompra: só Outros/Pareceres com título de peça, PDF com texto, anonimizado, sem CPF, link do PNCP', async () => {
  const pedidos = [];
  const fetchImpl = async (url) => {
    pedidos.push(url);
    if (url.endsWith('/arquivos')) return Response.json([DOC(1, 'Edital.pdf', 2), DOC(2, 'ESCLARECIMENTO 01.pdf'), DOC(3, 'Planilha.pdf'), DOC(4, 'Impugnacao escaneada.pdf')]);
    if (url.endsWith('/arquivos/2')) return new Response('%PDF-1.4 a');
    if (url.endsWith('/arquivos/4')) return new Response('%PDF-1.4 b');
    throw new Error(`inesperado ${url}`);
  };
  const cliente = P.criarCliente({ fetchImpl, esperar: async () => {}, pausaMs: 0, orcamento: 10 });
  const lerPdf = async (b) => ({ paginas: [{ texto: b.toString('latin1').endsWith('a') ? TEXTO : 'pouco texto' }] });
  const linhas = await P.coletarCompra(cliente, COMPRA, lerPdf);
  assert.deepEqual(pedidos.map((u) => u.replace(/^.*compras\/2026\/1381/, '')), ['/arquivos', '/arquivos/2', '/arquivos/4']);
  assert.equal(linhas.length, 1);
  const [l] = linhas;
  assert.equal(l.id, 'pncp-89971758000180-2026-1381-2');
  assert.equal(l.tipo, 'esclarecimento');
  assert.equal(l.lei, '14133');
  assert.equal(l.pregao, '106/2026');
  assert.equal(l.uasg, null);
  assert.equal(l.data, '2026-11-10');
  assert.equal(l.empresa_cnpj, '40849028000112');
  assert.equal(l.url, 'https://pncp.gov.br/app/editais/89971758000180/2026/1381');
  for (const proibido of ['123.456.789-09', 'joaquim@', 'Joaquim Barbosa']) assert.ok(!l.texto.includes(proibido), proibido);
  assert.match(l.busca, /marca similar/);
});

test('cliente: só PNCP, respeita o teto de pedidos e a pausa', async () => {
  const esperas = [];
  let t = 0;
  const cliente = P.criarCliente({ fetchImpl: async () => Response.json([]), esperar: async (ms) => { esperas.push(ms); t += ms; }, pausaMs: 1000, orcamento: 2, agora: () => t });
  await assert.rejects(cliente.json('https://evil.com/x'), /fora do PNCP/);
  await cliente.json('https://pncp.gov.br/api/a');
  await cliente.json('https://pncp.gov.br/api/b');
  assert.deepEqual(esperas, [1000]);
  await assert.rejects(cliente.json('https://pncp.gov.br/api/c'), /Orçamento/);
});

test('passo: anda pelas páginas, modalidades e dias; para a meio caminho quando o tempo acaba', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/contratacoes/atualizacao')) return Response.json({ data: [COMPRA, COMPRA], totalPaginas: url.includes('pagina=1&') ? 2 : 2 });
    return Response.json([]);
  };
  const cliente = P.criarCliente({ fetchImpl, esperar: async () => {}, pausaMs: 0, orcamento: 100 });
  const cursor = { dia: '2026-11-10', modalidade: 0, pagina: 1, indice: 0 };
  const opcoes = { lerPdf: async () => ({ paginas: [] }), gravar: async (l) => l.length, tempoAcabou: () => false };
  await P.passo(cliente, cursor, opcoes);
  assert.deepEqual(cursor, { dia: '2026-11-10', modalidade: 0, pagina: 2, indice: 0 });
  await P.passo(cliente, cursor, opcoes);
  assert.deepEqual(cursor, { dia: '2026-11-10', modalidade: 1, pagina: 1, indice: 0 });
  await P.passo(cliente, cursor, opcoes); await P.passo(cliente, cursor, opcoes);
  assert.deepEqual(cursor, { dia: '2026-11-11', modalidade: 0, pagina: 1, indice: 0 });
  let n = 0;
  await P.passo(cliente, cursor, { ...opcoes, tempoAcabou: () => n++ >= 1 });
  assert.deepEqual(cursor, { dia: '2026-11-11', modalidade: 0, pagina: 1, indice: 1 }, 'continua da contratação seguinte');
});
