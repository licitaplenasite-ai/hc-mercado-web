const test=require('node:test');
const assert=require('node:assert/strict');
const {decimal,totalItem,preparar,docx}=require('../netlify/functions/_kit_documentos');
const AdmZip=require('adm-zip');
const id='11111111-1111-1111-1111-111111111111';
const contexto={userId:'usuario',empresa:{id,organizacao_id:'org',razao_social:'Empresa & Filhos',cnpj:'11222333000181'},processo:{id,numero:'1/2026',orgao:'Órgão'},perfil:{versao:1,dados_confirmados:{endereco:'Rua A',representante:'Ana',cargo:'Sócia'},proveniencia:[]},itens:[{id,tipo:'item',identificador:'1',descricao:'Material <A>',quantidade:'0.500',valor_unitario_proposta:'0.01'}]};
const proposta={tipo:'proposta',proposta:{itemIds:[id],unidades:{[id]:'un'},validade:'30 dias',prazoEntrega:'10 dias',pagamento:'Após entrega'}};
test('decimal exato rejeita formatos e precisão inválidos; arredonda cada item',()=>{
 assert.equal(totalItem('0.500','0.01'),1n);
 assert.equal(totalItem('0.499','0.01'),0n);
 assert.equal(decimal('9999999999999.99',2),999999999999999n);
 for(const x of ['0','-1','Infinity','1e2','1,00','1.001','10000000000000.00',NaN])assert.throws(()=>decimal(x,2));
 assert.throws(()=>totalItem('999999999999.999','9999999999999.99'),e=>e.pendencias.some(p=>/limite/i.test(p)));
});
test('declaração mantém texto literal e recusa variáveis desconhecidas/XML inválido',()=>{
 const r=preparar(contexto,{tipo:'declaracao',declaracao:{titulo:'Declaração',texto:'{{razao_social}}\n\n{{cnpj}}',fonte:'Usuário'}});
 assert.match(r.previa.texto,/Empresa & Filhos\n\n11\.222\.333\/0001-81/);
 assert.match(r.previa.fontes.join(' '),/informada pelo usuário/i);
 for(const texto of ['{{regularidade}}','x\u0000','{{ cnpj }}'])assert.throws(()=>preparar(contexto,{tipo:'declaracao',declaracao:{titulo:'A',texto}}));
});
test('proposta usa somente item persistido, condições obrigatórias e hash estável',()=>{
 const a=preparar(contexto,proposta);assert.match(a.previa.texto,/0,01/);assert.match(a.previa.texto,/não informad/i);
 assert.equal(a.revisaoHash,preparar(contexto,proposta).revisaoHash);
 assert.notEqual(a.revisaoHash,preparar({...contexto,perfil:{...contexto.perfil,versao:2}},proposta).revisaoHash);
 for(const p of [{...proposta.proposta,itemIds:[id,id]},{...proposta.proposta,unidades:{}},{...proposta.proposta,pagamento:''}])assert.throws(()=>preparar(contexto,{tipo:'proposta',proposta:p}));
 assert.throws(()=>preparar({...contexto,itens:[{...contexto.itens[0],tipo:'lote'}]},proposta));
 assert.throws(()=>preparar({...contexto,itens:[{...contexto.itens[0],valor_unitario_proposta:null,valor_proposta:'1'}]},proposta));
});
test('extenso por item acompanha a própria linha depois da ordenação da tabela (prévia e blocos)',()=>{
 const id2='22222222-2222-2222-2222-222222222222';
 const c={...contexto,itens:[{...contexto.itens[0],identificador:'2',quantidade:'1.000',valor_unitario_proposta:'8.50'},{...contexto.itens[0],id:id2,identificador:'1',quantidade:'2.000',valor_unitario_proposta:'4.75'}]};
 const r=preparar(c,{tipo:'proposta',proposta:{...proposta.proposta,itemIds:[id,id2],unidades:{[id]:'un',[id2]:'un'}}});
 const b=r.documento(null).blocos.find(x=>x.t==='itens');
 assert.deepEqual(b.linhas.map(l=>l[0]),['1','2']);
 assert.deepEqual(b.extensos,['Valor unitário: quatro reais e setenta e cinco centavos (R$ 4,75) · Valor total do item: nove reais e cinquenta centavos (R$ 9,50)',
  'Valor unitário: oito reais e cinquenta centavos (R$ 8,50) · Valor total do item: oito reais e cinquenta centavos (R$ 8,50)']);
 assert.ok(r.previa.texto.includes('Total: R$ 8,50\nValor unitário: oito reais e cinquenta centavos (R$ 8,50)'));
 assert.ok(r.previa.texto.includes('Valor global da proposta: R$ 18,00 (dezoito reais)'));
});
test('quantidade apresentada em pt-BR conserva valor e total exato',()=>{
 for(const [quantidade,apresentada,total] of [['2.000','2','25,00'],['1.500','1,5','18,75'],['80.000','80','1.000,00']]){
 const c={...contexto,itens:[{...contexto.itens[0],quantidade,valor_unitario_proposta:'12.50'}]};
 const r=preparar(c,proposta);assert.match(r.previa.texto,new RegExp(`Quantidade: ${apresentada} \\|`));assert.ok(r.previa.texto.includes(`Valor global da proposta: R$ ${total}`));
 assert.ok(new AdmZip(docx(r)).readAsText('word/document.xml').includes(`Quantidade: ${apresentada} |`));
 }
});
test('DOCX reutilizado contém texto literal escapado e título',async()=>{
 const r=preparar(contexto,proposta);const zip=new AdmZip(docx(r));
 assert.match(zip.readAsText('word/document.xml'),/Material &lt;A&gt;/);
 assert.match(zip.readAsText('docProps/core.xml'),/Proposta de preços/);
 assert.ok(zip.getEntry('[Content_Types].xml'));
 const leitura=await require('mammoth').extractRawText({buffer:docx(r)});
 assert.match(leitura.value,/Material <A>/);
 assert.match(leitura.value,/Empresa & Filhos/);
 assert.match(leitura.value,/Valor global da proposta: R\$ 0,01/);
});
test('DOCX da declaração preserva linhas vazias e não altera minuta legada',()=>{
 const {montarDocx}=require('../netlify/functions/gerar-checklist');
 const a=new AdmZip(docx(preparar(contexto,{tipo:'declaracao',declaracao:{titulo:'Livre',texto:'A\n\nB'}}))).readAsText('word/document.xml');
 assert.match(a,/<w:jc w:val="center"\/><\/w:pPr><w:r><w:rPr>[^<]*<w:rFonts[^>]*\/><w:b\/>[^]*?<w:t xml:space="preserve">Livre</);
 // Parágrafos separados por linha vazia viram parágrafos justificados próprios.
 assert.match(a,/<w:jc w:val="both"\/><\/w:pPr><w:r>[^]*?>A<\/w:t>[^]*?<w:jc w:val="both"\/><\/w:pPr><w:r>[^]*?>B<\/w:t>/);
 const b=montarDocx({}, {}, {texto:'A\n\nB'});
 assert.equal((new AdmZip(b).readAsText('word/document.xml').match(/<w:br\/>/g)||[]).length,1);
 assert.match(new AdmZip(b).readAsText('docProps/core.xml'),/Checklist de Licitação/);
});
test('reais com milhar e DOCX com settings.xml (compatibilityMode 15) referenciado',()=>{
 const {dinheiro,quantidade}=require('../netlify/functions/_kit_documentos');
 assert.deepEqual([1n,99n,100n,775605n,100000000n,123456789012n].map(dinheiro),['0,01','0,99','1,00','7.756,05','1.000.000,00','1.234.567.890,12']);
 assert.deepEqual(['200','200.000','2.500','0.125','1.010'].map(quantidade),['200','200','2,5','0,125','1,01']);
 const zip=new AdmZip(docx(preparar(contexto,proposta)));
 assert.match(zip.readAsText('word/settings.xml'),/<w:defaultTabStop w:val="720"\/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http:\/\/schemas.microsoft.com\/office\/word" w:val="15"\/>/);
 assert.match(zip.readAsText('[Content_Types].xml'),/PartName="\/word\/settings.xml" ContentType="[^"]+settings\+xml"/);
 assert.match(zip.readAsText('word/_rels/document.xml.rels'),/Type="[^"]+\/settings" Target="settings.xml"/);
 assert.doesNotMatch(zip.readAsText('word/document.xml'),/defaultTabStop/);
});
test('formato 2: A4 com margens, cabeçalho da empresa, rodapé com página, tabela com total, extenso e assinatura',()=>{
 const zip=new AdmZip(docx(preparar(contexto,proposta),{formato:2}));const xml=zip.readAsText('word/document.xml');
 assert.match(xml,/<w:pgSz w:w="11906" w:h="16838"\/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1304"/);
 assert.match(zip.readAsText('word/header1.xml'),/Empresa &amp; Filhos[^]*CNPJ 11\.222\.333\/0001-81/);
 assert.match(zip.readAsText('word/footer1.xml'),/ PAGE [^]* NUMPAGES /);
 assert.match(xml,/À Órgão[^]*Pregão Eletrônico nº 1\/2026[^]*Agente de Contratação/);
 assert.match(xml,/<w:tblHeader\/>[^]*Unitário \(R\$\)[^]*>Valor global da proposta<[^]*>0,01</);
 assert.match(xml,/Valor global da proposta por extenso: um centavo\./);
 assert.match(xml,/\[CPF do representante\]/);assert.match(xml,/Validade da proposta[^]*30 dias/);
 // Sem logo: cabeçalho só com os dados, sem mídia.
 assert.equal(zip.getEntry('word/media/logo.png'),null);
});
