const test=require('node:test');
const assert=require('node:assert/strict');
const {preparar,textoFinal}=require('../_kit_documentos');
// B1 (teste ponta a ponta 18/11): declaração de texto livre saía com "CNPJ: 12345678000195".
// Teste ao vivo 23/11: a prévia também mostrava o CNPJ cru; agora prévia e arquivo saem mascarados.
const ctx={userId:'u',empresa:{id:'e',razao_social:'Empresa QA',cnpj:'12345678000195'},processo:{numero:'1/2026',orgao:'Órgão'},perfil:{dados_confirmados:{endereco:'Rua A',representante:'Ana',cargo:'Sócia'}},itens:[]};
const body=texto=>({tipo:'declaracao',declaracao:{titulo:'Declaração',texto}});
test('declaração livre: CNPJ mascarado na prévia e no arquivo; cabeçalho do arquivo leva o CNPJ da empresa',()=>{
 const r=preparar(ctx,body('A {{razao_social}}, CNPJ {{cnpj}}, declara.'));
 assert.match(r.previa.texto,/CNPJ 12\.345\.678\/0001-95, declara/);
 const final=textoFinal(r,null);
 assert.match(final,/CNPJ 12\.345\.678\/0001-95, declara/);
 assert.doesNotMatch(r.previa.texto+final,/12345678000195/);
 assert.deepEqual(r.documento(null).emitente.linhas.slice(0,1),['CNPJ 12.345.678/0001-95']);
});
test('revisaoHash estável para o mesmo conteúdo',()=>{
 assert.equal(preparar(ctx,body('CNPJ {{cnpj}}.')).revisaoHash,preparar(ctx,body('CNPJ {{cnpj}}.')).revisaoHash);
});
test('com CPF: entra só no texto exportado; número maior que contém o CNPJ não é tocado; sem CPF a peça não sai',()=>{
 const r=preparar(ctx,body('CPF {{cpf_representante}}; protocolo 9123456780001950.'));
 assert.match(r.previa.texto,/CPF \[CPF do representante\]/);
 const final=textoFinal(r,'529.982.247-25');
 assert.match(final,/CPF 529\.982\.247-25; protocolo 9123456780001950/);
 assert.equal(textoFinal(r,null),null);
});
