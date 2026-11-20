const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./coletar_pecas_juridicas.js');
const { criarLeitor } = require('../netlify/functions/_comprasnet_antigo');

// HTML sintético no mesmo formato das páginas públicas conferidas em 19/11/2026 (dados fictícios).
const ATA2 = `<td>UASG &nbsp;&nbsp; 158142-INSTITUTO FICTICIO DO NORTE</td><td>Pregão nº: N° 00023/2022 (SRP) - (Decreto N° 10.024/2019)</td>
<script>window.open('VisualizarRecursosPregao.asp?prgCod=1099276')</script>`;
const AVISOS_E = `<table><tr><td class="tex3b">Esclarecimento:<br><span class="mensagem2">(26/05/2021 12:22:32 )</span></td>
<td><a OnClick="window.open('avisos4.asp?qaCod=111&texto=T','Aviso')">Pedido</a><a OnClick="window.open('avisos4.asp?qaCod=111&texto=R','Aviso')">Resp</a></td></tr></table>`;
const AVISO4 = (t) => `<body><p class="tex3b">Esclarecimento <span class="mensagem2">26/05/2021</span></p><p class="tex3">${t}</p></body>`;
const RECURSOS = `<b>Sessões: </b><a href="VisualizarRecursosPregao.asp?prgCod=1099276">1</a>
<td class="tex3a"><hr /><b>Item: </b>7</td>
<td class="tex3b"><b>CNPJ: </b>40.849.028/0001-12 - <b>Razão Social/Nome:&nbsp;</b>EMPRESA FICTICIA LTDA  </td>
<a href="#" onclick="javascript:window.open('Termojulg2.asp?prgCod=1099276&ipgCod=55&reCod=9&Tipo=R&Tipo1=S','R')"> Recurso </a>
<a href="#" onclick="javascript:window.open('Termojulg2.asp?prgCod=1099276&ipgCod=55&Tipo=CR&Cliente_ID=FRN1&reCod=9','R')"> Contra-Razão do Fornecedor:&nbsp;33.633.561/0001-87 - OUTRA FICTICIA SA </a>
<a href="#" onclick="javascript:window.open('Termojulg2.asp?prgCod=1099276&ipgCod=55&Tipo=DP&seqSessao=1','R')">Decisão do Pregoeiro </a>`;
const PECA = (cab, corpo) => `<td colspan=4 class="mensagem">${cab}</td></tr><tr><td></td><td colspan=4 class="tex3">${corpo}</td>`;

test('anonimizar apaga CPF, contato, OAB e nome de pessoa; mantém empresa e CNPJ', () => {
  const t = P.anonimizar('EMPRESA FICTICIA LTDA, CNPJ 40.849.028/0001-12, neste ato representada por seu sócio Joaquim Barbosa Lima, CPF 123.456.789-09,\ne-mail joaquim@exemplo.com.br, tel. (92) 98123-4567, OAB/AM nº 1234.\nO atestado do Sr. Pedro Alves de Souza não vale.\nNestes termos,\nPede deferimento.\nMaria Clara Fonseca\nDiretora');
  assert.match(t, /EMPRESA FICTICIA LTDA, CNPJ 40\.849\.028\/0001-12/);
  for (const proibido of ['Joaquim', '123.456.789-09', 'joaquim@', '98123', '1234', 'Pedro Alves', 'Maria Clara']) assert.ok(!t.includes(proibido), proibido);
  assert.match(t, /Pede deferimento\.\n\[nome removido\]\nDiretora/);
  // Órgão e conector não são nome de pessoa.
  assert.match(P.anonimizar('ILMO. SR. PREGOEIRO DA COMISSÃO DE LICITAÇÃO'), /COMISSÃO DE LICITAÇÃO/);
});

test('leitores reconhecem avisos, recursos com fornecedor e decisão', () => {
  assert.deepEqual(P.lerAvisos(AVISOS_E), [{ tipo: 'esclarecimento', data: '2021-05-26', qaCod: '111', temResposta: true }]);
  assert.equal(P.lerTextoAviso(AVISO4('Linha 1<br>Linha 2')), 'Linha 1\nLinha 2');
  const { links } = P.lerRecursos(RECURSOS);
  assert.deepEqual(links.map((l) => [l.tipo, l.item, l.cnpj]), [['R', 7, '40849028000112'], ['CR', 7, '33633561000187'], ['DP', 7, null]]);
  assert.equal(links[1].nome, 'OUTRA FICTICIA SA');
  assert.deepEqual(P.lerPeca(PECA('DECISÃO DO PREGOEIRO: NÃO PROCEDE', 'Texto')), { cabecalho: 'DECISÃO DO PREGOEIRO: NÃO PROCEDE', resultado: 'NÃO PROCEDE', texto: 'Texto' });
  assert.deepEqual(P.lerCabecalhoPregao(ATA2), { orgao: 'INSTITUTO FICTICIO DO NORTE', lei: '10520' });
  assert.equal(P.leiDe('nos termos da Lei nº 14.133/2021'), '14133');
});

test('coletarPregao monta peças com resposta e decisão, sem CPF, só por páginas permitidas', async () => {
  const pedidos = [];
  const paginas = (url) => {
    if (/ata2\.asp/.test(url)) return ATA2;
    if (/avisos2\.asp.*Tipo=E/.test(url)) return AVISOS_E;
    if (/avisos2\.asp/.test(url)) return '<html></html>';
    if (/qaCod=111&texto=T/.test(url)) return AVISO4('Pedimos esclarecer o item 3. Responsável: João da Silva Neto, CPF 123.456.789-09.');
    if (/qaCod=111&texto=R/.test(url)) return AVISO4('O item 3 aceita marca similar.');
    if (/VisualizarRecursosPregao/.test(url)) return RECURSOS;
    if (/Tipo=DP/.test(url)) return PECA('DECISÃO DO PREGOEIRO: NÃO PROCEDE', 'Mantida a decisão, conforme Lei 14.133.');
    if (/Tipo=CR/.test(url)) return PECA('CONTRA-RAZÃO:', 'A recorrida pede manter a decisão.');
    if (/Tipo=R/.test(url)) return PECA('RECURSO:', 'A recorrente pede reformar a inabilitação.');
    throw new Error(`inesperado ${url}`);
  };
  const leitor = criarLeitor({ pausaMs: 0, esperar: async () => {}, fetchImpl: async (url) => { pedidos.push(url); return new Response(Buffer.from(paginas(url), 'latin1')); } }); // o portal responde em windows-1252
  const linhas = await P.coletarPregao(leitor, { uasg: '158142', numprp: '232022' });
  assert.deepEqual(linhas.map((l) => [l.id, l.tipo]), [['cn-1099276-qa-111', 'esclarecimento'], ['cn-1099276-55-9-R', 'recurso'], ['cn-1099276-55-9-CR-FRN1', 'contrarrazao']]);
  assert.equal(linhas[0].resposta, 'O item 3 aceita marca similar.');
  assert.ok(!/123\.456|João/.test(linhas[0].texto));
  assert.equal(linhas[1].resultado, 'NÃO PROCEDE');
  assert.equal(linhas[1].lei, '14133');
  assert.equal(linhas[2].empresa_cnpj, '33633561000187');
  assert.equal(linhas[0].pregao, '23/2022');
  assert.match(linhas[0].url, /^https:\/\/www\.comprasnet\.gov\.br\/livre\/pregao\/ata2\.asp/);
  assert.match(linhas[1].busca, /reformar a inabilitacao/);
  assert.ok(pedidos.every((u) => !/AtaEletronico/i.test(u)));
});
