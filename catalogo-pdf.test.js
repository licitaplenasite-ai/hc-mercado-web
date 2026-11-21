const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./catalogo-produtos');

// pdf-lib falso: registra textos, imagens e páginas (a biblioteca real só carrega no navegador).
function pdfLibFalso() {
  const log = { paginas: 0, textos: [], imagens: 0 };
  const fonte = { widthOfTextAtSize: (t, s) => t.length * s * 0.5 };
  const pagina = { drawText: (t) => log.textos.push(t), drawImage: () => { log.imagens += 1; }, drawLine() {}, drawRectangle() {} };
  return { log, lib: { StandardFonts: { Helvetica: 'h', HelveticaBold: 'hb' }, rgb: () => ({}),
    PDFDocument: { create: async () => ({ embedFont: async () => fonte, embedPng: async () => ({ width: 200, height: 100 }), embedJpg: async () => { throw new Error('jpeg ruim'); },
      addPage: () => { log.paginas += 1; return pagina; }, save: async () => new Uint8Array([1]) }) } } };
}

test('catálogo em PDF: cabeçalho da empresa, dados do produto, sem custo nem fornecedor', async () => {
  const { lib, log } = pdfLibFalso();
  const bytes = await C.montarPdfCatalogo(lib, {
    empresa: { razao_social: 'Empresa QA Ltda', cnpj: '11222333000181' }, perfil: { nome_fantasia: 'QA', telefone: '92 99999-0000', email: 'qa@qa.invalid' },
    logo: { bytes: new Uint8Array([1]), ext: 'png' }, hoje: '20/11/2026',
    produtos: [{ nome: 'Caneta azul', marca: 'Bic', modelo: 'Cristal', unidade: 'UN', descricao: 'Ponta média', custo_unitario: '1.20', fornecedor_nome: 'Distribuidora X', foto: { bytes: new Uint8Array([1]), ext: 'jpg' } }],
  });
  assert.deepEqual([...bytes], [1]);
  for (const t of ['QA', 'Empresa QA Ltda', 'CNPJ 11.222.333/0001-81', '92 99999-0000 · qa@qa.invalid', 'Catálogo de produtos · 20/11/2026', 'Caneta azul', 'Marca / modelo: Bic / Cristal', 'Unidade: UN', 'Ponta média']) assert.ok(log.textos.includes(t), t);
  assert.ok(!log.textos.some((t) => /1,20|1\.20|Distribuidora/.test(t)));
  assert.equal(log.imagens, 1); // logo entrou; foto JPEG ilegível vira quadro vazio, sem derrubar o PDF
});

test('catálogo em PDF: muitos produtos quebram página e repetem o cabeçalho', async () => {
  const { lib, log } = pdfLibFalso();
  await C.montarPdfCatalogo(lib, { empresa: { razao_social: 'E' }, produtos: Array.from({ length: 12 }, (_, k) => ({ nome: `P${k}` })) });
  assert.ok(log.paginas >= 2);
  assert.equal(log.textos.filter((t) => t === 'E').length, log.paginas);
});

test('PDF: selecionados ou todos os ativos; texto fora do WinAnsi vira "?"; quebra com reticências', () => {
  const ps = [{ id: 'a', ativo: true }, { id: 'b', ativo: false }, { id: 'c' }];
  assert.deepEqual(C.produtosDoPdf(ps, new Set()).map((p) => p.id), ['a', 'c']);
  assert.deepEqual(C.produtosDoPdf(ps, new Set(['b'])).map((p) => p.id), ['b']);
  assert.equal(C.textoPdf('Ação “ok”\n日本'), 'Ação “ok” ??');
  const m = (t) => t.length * 5;
  assert.deepEqual(C.quebrarLinhas('uma duas tres quatro', 50, m), ['uma duas', 'tres', 'quatro']);
  assert.deepEqual(C.quebrarLinhas('abcdefghijklmno', 50, m), ['abcdefghij', 'klmno']);
  assert.deepEqual(C.quebrarLinhas('a b c d e f g h', 20, m, 2), ['a b', 'c d…']);
  assert.deepEqual(C.quebrarLinhas('', 20, m), []);
});
