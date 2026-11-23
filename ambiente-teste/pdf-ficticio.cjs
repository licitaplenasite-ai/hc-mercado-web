/* global Buffer */
// PDF mínimo com texto de verdade (Helvetica, WinAnsi), uma página por item; texto vazio = página sem texto (escaneado).
// Usado nos testes da leitura de contrato social (empresa-documento-leitura.test.js e e2e-contrato-longo.cjs).
function gerarPdf(paginas) {
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const fonte = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const raizPaginas = objs.length + 1; objs.push(null);
  const filhos = paginas.map(texto => {
    const linhas = texto.split('\n').flatMap(l => l.match(/.{1,95}(\s|$)/g) || ['']);
    // Sem texto: só um retângulo cinza, como a foto de uma página escaneada.
    const conteudo = texto.trim() ? 'BT /F1 9 Tf 40 800 Td 12 TL ' + linhas.map(l => `(${l.trim().replace(/[\\()]/g, c => '\\' + c)}) Tj T*`).join(' ') + ' ET' : '0.8 g 40 40 515 760 re f';
    const c = add(`<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`);
    return add(`<< /Type /Page /Parent ${raizPaginas} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fonte} 0 R >> >> /Contents ${c} 0 R >>`);
  });
  objs[raizPaginas - 1] = `<< /Type /Pages /Kids [${filhos.map(f => f + ' 0 R').join(' ')}] /Count ${filhos.length} >>`;
  const catalogo = add(`<< /Type /Catalog /Pages ${raizPaginas} 0 R >>`);
  let pdf = '%PDF-1.4\n'; const pos = [];
  objs.forEach((o, i) => { pos.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// Alteração contratual fictícia: preâmbulo com a sede antiga, sede atual na página 10 e administração na página 13.
function contratoFicticio({ total = 16, razao = 'HCM COMÉRCIO E SERVIÇOS LTDA', cnpj = '12.345.678/0001-95' } = {}) {
  const preambulo = `NONA ALTERAÇÃO CONTRATUAL DA SOCIEDADE ${razao}\nCNPJ nº ${cnpj} - NIRE 13200123456 (DOCUMENTO FICTÍCIO DE TESTE)\n`
    + 'JOÃO DA SILVA PEREIRA, brasileiro, casado, empresário, portador do RG 1234567 SSP/AM, inscrito no CPF sob o nº 529.982.247-25,\n'
    + 'residente e domiciliado na Rua das Flores, nº 10, Bairro Centro, Manaus/AM, CEP 69000-000; e MARIA SOUZA LIMA, brasileira, solteira,\n'
    + 'empresária, inscrita no CPF sob o nº 111.444.777-35, residente na Rua B, nº 20, Manaus/AM;\n'
    + `únicos sócios da sociedade empresária limitada denominada ${razao}, com sede na Rua Antiga, nº 5,\n`
    + `Bairro Velho, Manaus/AM, CEP 69010-000, inscrita no CNPJ sob o nº ${cnpj}, resolvem alterar o contrato social:`;
  const paginas = [preambulo, ...Array.from({ length: total - 1 }, (_, i) => `CLÁUSULA ${i + 1} - DAS DISPOSIÇÕES GERAIS: Os sócios declaram que a presente cláusula trata de matéria geral da sociedade,\nsem relação com a sede ou com a sua representação, e permanece como no contrato anterior.`)];
  paginas[Math.min(9, total - 1)] += '\nCLÁUSULA SEGUNDA - DA SEDE: A sociedade tem sede na Avenida Djalma Batista, nº 1000, Sala 5, Bairro Chapada,\nManaus/AM, CEP 69050-010, podendo abrir filiais em qualquer parte do país.';
  paginas[Math.min(12, total - 1)] += '\nCLÁUSULA DÉCIMA - DA ADMINISTRAÇÃO: A administração da sociedade caberá ao sócio JOÃO DA SILVA PEREIRA, com os poderes\ne atribuições de administrador, autorizado o uso do nome empresarial isoladamente, vedado o uso em atividades estranhas.';
  return paginas;
}

module.exports = { gerarPdf, contratoFicticio };
