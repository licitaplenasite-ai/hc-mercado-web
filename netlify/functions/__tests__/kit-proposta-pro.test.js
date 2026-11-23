// Proposta profissional, declarações prontas, ficha técnica e PDF (teste ao vivo de 23/11, PE 012/2026 da ALEPA).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const AdmZip=require('adm-zip');
const {handler}=require('../kit-documentos');
const doc=require('../_kit_proposta_doc');
const {detectarModeloProposta,condicoesDoEdital,fonteModelo}=require('../_kit_modelo_edital');
const {editalDoDossie}=require('../_kit_extra');
require('../../../kit-documentos-ui.js');const UI=globalThis.LicitaKitDocumentos;
const PDF=require('../../../documento-pdf.js');

test('número do edital: ano duplicado na origem ("012/2026/2026") vira "012/2026"; o resto fica igual',()=>{
 assert.equal(doc.numeroEdital('012/2026/2026'),'012/2026');
 assert.equal(doc.numeroEdital('012/2026'),'012/2026');
 assert.equal(doc.numeroEdital('90001/2026'),'90001/2026');
 assert.equal(doc.numeroEdital('12/2025/2026'),'12/2025/2026');
});
test('nome do arquivo: tipo, empresa, pregão e órgão curto; nunca UUID nem caractere proibido',()=>{
 assert.equal(doc.nomeArquivo({razaoSocial:'HCM LTDA',numero:'012/2026/2026',modalidade:'Pregão - Eletrônico',orgao:'ASSEMBLEIA LEGISLATIVA DO ESTADO DO PARA'}),'Proposta - HCM LTDA - Pregão 012-2026 - Assembleia Legislativa do Estado do Para.docx');
 assert.equal(doc.nomeArquivo({tipo:'Ficha técnica',razaoSocial:'A/B: C',numero:'5/2026',modalidade:null,orgao:'Prefeitura Municipal de Manaus (PMM)',extensao:'pdf'}),'Ficha técnica - A-B- C - Pregão 5-2026 - PMM.pdf');
 assert.equal(doc.orgaoCurto('Câmara Municipal de São Paulo - CMSP'),'CMSP');
});
test('local e data: cidade/UF do endereço; sem cidade, lacuna com a UF da sede; data por extenso no fuso de Brasília',()=>{
 assert.equal(doc.localDoEndereco('Av. Nazaré, 100, Nazaré, Belém/PA, CEP 66035-000'),'Belém/PA');
 assert.equal(doc.localDoEndereco('Rua A, 10 - Centro - Manaus - AM'),'Manaus/AM');
 assert.equal(doc.localDoEndereco('Rua Itambé, 77','PA'),'____________________/PA');
 assert.equal(doc.dataPorExtenso(new Date('2026-11-23T12:00:00Z')),'23 de novembro de 2026');
 assert.equal(doc.dataPorExtenso(new Date('2026-12-01T02:00:00Z')),'30 de novembro de 2026');
});
test('modelo de proposta do edital real: acha o anexo (não o índice), campos na ordem e declarações embutidas',()=>{
 const raiz=path.join(__dirname,'../../..');
 const a=detectarModeloProposta(fs.readFileSync(path.join(raiz,'docs/qa/editais-reais-novos/88124961000159-125/fonte-produto.txt'),'utf8'));
 assert.equal(a.anexo,'Anexo II');assert.equal(a.pagina,12);assert.ok(a.campos.includes('validade'));
 assert.equal(fonteModelo(a),'Modelo do edital: Anexo II, pág. 12');
 const b=detectarModeloProposta(fs.readFileSync(path.join(__dirname,'fixtures/ux28-fonte-publica.txt'),'utf8'));
 assert.deepEqual(b.campos.slice(0,4),['marca','prazoEntrega','banco','localEntrega']);
 assert.equal(b.declaracoes.length,7);assert.match(b.declaracoes[1],/^Sob penas da lei/);assert.match(b.declaracoes.at(-1),/de acordo com todas as condições/);
 assert.ok(b.declaracoes.every(d=>!/\{\{|\}\}/.test(d)));
 assert.equal(detectarModeloProposta('ANEXO II – Modelo de Proposta;\nANEXO III – Minuta'),null);
 assert.equal(fonteModelo(null),'Modelo LicitaPlena');
});
test('condições do edital: "Não informado" vira vazio; garantia contratual não vira garantia do produto; SRP e manual',()=>{
 assert.deepEqual(condicoesDoEdital({criteriosProposta:{validadeProposta:'Não informado'},detalhes:{prazoEntrega:''},entregaExecucao:{prazo:'Até 10 dias',local:'Sede da ALEPA, Belém/PA'},condicoesPagamento:'Até 30 dias após o atesto'}),
  {validade:'',prazoEntrega:'Até 10 dias',pagamento:'Até 30 dias após o atesto',localEntrega:'Sede da ALEPA, Belém/PA'});
 const e=editalDoDossie({detalhes:{garantia:'Garantia contratual de 5%'}},'PREGÃO ELETRÔNICO\nOs manuais deverão ser entregues em língua portuguesa.',{objeto:'Material'});
 assert.equal(e.garantia,'');assert.equal(e.srp,false);assert.equal(e.manualPortugues,true);
 assert.equal(editalDoDossie({detalhes:{garantia:'12 meses contra defeitos'}},'',{objeto:'Registro de preços para aquisição'}).garantia,'12 meses contra defeitos');
 assert.equal(editalDoDossie({},'',{objeto:'Registro de preços para aquisição'}).srp,true);
});
test('tela: validade, prazo e pagamento vêm do edital; sem edital, da Proposta padrão; ME/EPP pelo porte',()=>{
 const s=UI.sugestaoProposta({validade:'60 (sessenta) dias',prazoEntrega:'',pagamento:'30 dias'},{validade:'90 dias',prazoEntrega:'10 dias',pagamento:''});
 assert.deepEqual(s.valores,{validade:'60 (sessenta) dias',prazoEntrega:'10 dias',pagamento:'30 dias'});
 assert.deepEqual(s.origem,{validade:'edital',prazoEntrega:'perfil',pagamento:'edital'});
 assert.match(UI.textoOrigemProposta(s,{fonte:'Modelo do edital: Anexo II, pág. 12'}),/^Modelo do edital: Anexo II, pág\. 12 · Do edital: validade, pagamento · Da Proposta padrão do perfil: prazo de entrega/);
 assert.match(UI.textoOrigemProposta(UI.sugestaoProposta({},{}),null),/^Modelo LicitaPlena · Preencha: validade, prazo de entrega, pagamento/);
 assert.ok(UI.declaracoesMarcadas('me').includes('ME_EPP_ENQUADRAMENTO'));assert.ok(!UI.declaracoesMarcadas('me').includes('ME_EPP_NAO_ENQUADRAMENTO'));
 assert.ok(UI.declaracoesMarcadas('demais').includes('ME_EPP_NAO_ENQUADRAMENTO'));
 assert.ok(!UI.declaracoesMarcadas(null).some(c=>c.startsWith('ME_EPP')));
 assert.ok(!UI.declaracoesMarcadas('me').some(c=>c.startsWith('DESEMP_')),'desempate só quem pode provar: desmarcado');
});
test('telefone no padrão brasileiro: tira +55/55/0, celular e fixo; 0800 agrupado; o que não reconhece volta como veio',()=>{
 for(const [entrada,esperado] of [['+5592991257297','(92) 99125-7297'],['92991257297','(92) 99125-7297'],['5592991257297','(92) 99125-7297'],
  ['9232345678','(92) 3234-5678'],['+55 (92) 3234-5678','(92) 3234-5678'],['092991257297','(92) 99125-7297'],['(92) 99125-7297','(92) 99125-7297'],
  ['08001234567','0800 123 4567'],['0800 123 4567','0800 123 4567'],['','' ],['abc','abc'],['12','12'],['92 3333-4444 / 92 99999-0000','92 3333-4444 / 92 99999-0000'],['9212345678','9212345678']])
  assert.equal(doc.telefoneFormatado(entrada),esperado,entrada);
 assert.equal(doc.telefoneFormatado(null),null);assert.equal(doc.telefoneFormatado(undefined),undefined);
});
test('PDF: quebra de linha respeita a largura e caractere fora da fonte padrão vira "?"',()=>{
 const fonte={widthOfTextAtSize:(t,s)=>t.length*s*0.5};
 const linhas=PDF.quebrar('Proposta de preços para a Assembleia Legislativa',fonte,10,100);
 assert.ok(linhas.every(l=>l.length*5<=100));assert.equal(linhas.join(' '),'Proposta de preços para a Assembleia Legislativa');
 assert.deepEqual(PDF.quebrar('x'.repeat(45),fonte,10,100),['x'.repeat(20),'x'.repeat(20),'x'.repeat(5)]);
 assert.equal(PDF.seguro('Até ≤ 35 – “ok” 😀'),'Até ? 35 – “ok” ?');
 // Regressão: a quebra de linha do texto não pode virar "?" (destinatário e assinatura em várias linhas).
 assert.deepEqual(PDF.quebrar('À ÓRGÃO\nPregão nº 1',fonte,10,500),['À ÓRGÃO','Pregão nº 1']);
 assert.match(PDF.PDF_LIB.integrity,/^sha512-/);
});

// ---- Fluxo pelo handler ----
const ids={empresa:'11111111-1111-1111-1111-111111111111',processo:'22222222-2222-2222-2222-222222222222',item:'33333333-3333-3333-3333-333333333333',org:'44444444-4444-4444-4444-444444444444',doc:'55555555-5555-5555-5555-555555555555'};
const CPF='52998224725';
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13]),Buffer.from('IHDR'),Buffer.from([0,0,1,0x2c,0,0,0,100,8,6,0,0,0])]);
const sha=b=>createHash('sha256').update(b).digest('hex');
function projetar(url,rows){const sel=new URL(url).searchParams.get('select');if(!sel)return rows;const campos=sel.split(',').map(c=>c.split(':')[0]);return rows.map(r=>Object.fromEntries(campos.filter(c=>c in r).map(c=>[c,r[c]])));}
const TEXTO_EDITAL='--- Edital (#1) ---\n[Página 1]\nPREGÃO ELETRÔNICO Nº 012/2026\n[Página 30]\nANEXO II – MODELO DE PROPOSTA\n\nRazão social, CNPJ, endereço, telefone e e-mail.\n\nValidade da proposta: mínimo de 60 dias.\n\nDados bancários: banco, agência e conta.\n\nA empresa XXXX declara, sob as penas da Lei:\n\nQue nos preços propostos estão incluídas todas as despesas com tributos, fretes e encargos.\n\nQue está de acordo com todas as condições do edital e de seus anexos, sem ressalvas.\n\nLocal e data\n\nANEXO III – MINUTA';
function fixture(t,{dossie=true}={}){
 const logoCaminho=`${ids.org}/${ids.empresa}/perfil/logo-${sha(PNG)}.png`;
 const state={empresa:{id:ids.empresa,organizacao_id:ids.org,razao_social:'HCM LTDA',cnpj:'28786260000153'},
  perfil:{empresa_id:ids.empresa,organizacao_id:ids.org,versao:1,confirmado_em:'2026-11-20',dados_confirmados:{endereco:'Rua Itambé, 77, Centro, Belém/PA, CEP 66000-000',representante:'Representante QA',cargo:'Sócio Diretor'},proveniencia:[]},
  perfilEmpresa:{nome_fantasia:null,telefone:'+559133334444',email:'contato@example.invalid',inscricao_estadual:'15.123.456-7',inscricao_municipal:null,porte:'demais',uf_sede:'PA',cpf_representante:CPF,banco:{banco:'Banco QA',agencia:'0001',conta:'12345-6',pix:'28786260000153',favorecido:''},proposta_padrao:{validade:'90 dias',prazo_entrega:'15 dias',pagamento:'30 dias'},logo_caminho:logoCaminho,logo_hash:sha(PNG)},
  membro:{usuario_id:'usuario',organizacao_id:ids.org,empresa_id:ids.empresa,papel:'gestor'},
  processo:{id:ids.processo,organizacao_id:ids.org,empresa_id:ids.empresa,numero:'012/2026/2026',orgao:'ASSEMBLEIA LEGISLATIVA DO ESTADO DO PARA',modalidade:'Pregão - Eletrônico',objeto:'Aquisição de agendas permanentes',origem_externa_id:'05054937000163-1-000012/2026',documentos_exigidos:[]},
  itens:[{id:ids.item,organizacao_id:ids.org,processo_id:ids.processo,tipo:'item',identificador:'10001',descricao:'AGENDA PERMANENTE 13,5X19,2CM; CAPA COURVIN; 352 PÁGINAS',quantidade:'200.000',valor_unitario_proposta:'52.00',marca:'Tilibra',modelo:'Permanente',fabricante:'Tilibra Produtos de Papelaria'}],
  dossie:dossie?{estrutura:{criteriosProposta:{validadeProposta:'60 (sessenta) dias'},detalhes:{prazoEntrega:'Até 10 (dez) dias após o empenho'},entregaExecucao:{local:'Palácio Cabanagem, Belém/PA'},condicoesPagamento:'Até 30 (trinta) dias após o atesto da nota fiscal'},texto:TEXTO_EDITAL}:null,
  kit:[],urls:[]};
 t.mock.method(global,'fetch',async(url,op={})=>{
  state.urls.push(url);let data;
  if(url.includes('/auth/v1/user'))data={id:'usuario'};
  else if(url.includes('/rpc/gravar_kit')){
   const p=JSON.parse(op.body);let d=state.kit.find(d=>d.id===p.p_documento);
   if(!d){d={id:p.p_documento,empresa_id:p.p_empresa,processo_id:p.p_processo,organizacao_id:p.p_organizacao,tipo:p.p_tipo||'declaracao',dados:p.p_dados,versao:1,criado_por:p.p_usuario,atualizado_por:p.p_usuario,criado_em:'x',atualizado_em:'x',revisao_hash:null,modelo_codigo:p.p_modelo||null,formato:2};state.kit.push(d);}
   else if(p.p_acao==='confirmarRevisao')Object.assign(d,{revisao_hash:p.p_hash,revisao_previa:p.p_previa,revisado_por:p.p_usuario,revisado_em:'x',revisao_versao:d.versao});
   data=d;
  }
  else if(url.includes('/operacao_kit_documentos?')){const q=new URL(url).searchParams;data=state.kit.filter(d=>['id','empresa_id','organizacao_id','processo_id'].every(k=>!q.has(k)||q.get(k)==='eq.'+d[k]));}
  else if(url.includes('/rpc/identificacao_empresa_habilitada'))data=true;
  else if(url.includes('/clientes?'))data=[{status:'aprovado'}];
  else if(url.includes('/operacao_empresas?'))data=[state.empresa];
  else if(url.includes('/operacao_membros?'))data=[state.membro];
  else if(url.includes('/operacao_identificacao_empresa?'))data=[state.perfil];
  else if(url.includes('/operacao_documentos?'))data=[];
  else if(url.includes('/operacao_perfil_empresa?'))data=projetar(url,[state.perfilEmpresa]);
  else if(url.includes('/operacao_processos?'))data=projetar(url,[state.processo]);
  else if(url.includes('/dossies_editais?'))data=state.dossie?[state.dossie]:[];
  else if(url.includes('/operacao_origens_pncp?'))return new Response('[]',{headers:{'Content-Range':'*/0','Preference-Applied':'count=exact'}});
  else if(url.includes('/operacao_itens_resultado?')){const q=new URL(url).searchParams;data=projetar(url,state.itens.filter(i=>!q.get('id')?.startsWith('in.(')||q.get('id').slice(4,-1).split(',').includes(i.id)));
   if(op.headers?.Prefer==='count=exact')return new Response(JSON.stringify(data),{headers:{'Content-Range':`0-${data.length-1}/${data.length}`,'Preference-Applied':'count=exact'}});}
  else if(url.includes('/storage/v1/object/authenticated/operacao-documentos/'))return new Response(PNG,{headers:{'content-length':String(PNG.length)}});
  else throw new Error('URL inesperada '+url);
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 });
 for(const [k,v] of [['IDENTIFICACAO_EMPRESA_LOCAL','1'],['SUPABASE_SERVICE_ROLE_KEY','QA_SERVICE']]){const old=process.env[k];process.env[k]=v;t.after(()=>{if(old===undefined)delete process.env[k];else process.env[k]=old;});}
 const run=async patch=>{const r=await handler({httpMethod:'POST',headers:{authorization:'Bearer QA'},body:JSON.stringify({empresaId:ids.empresa,processoId:ids.processo,...patch})});return {...r,json:JSON.parse(r.body)};};
 return {state,run};
}
const propostaBody={itemIds:[ids.item],unidades:{[ids.item]:'UNIDADE'},validade:'60 (sessenta) dias',prazoEntrega:'Até 10 (dez) dias após o empenho',pagamento:'Até 30 (trinta) dias após o atesto da nota fiscal'};
async function propostaRevisada(f){
 assert.equal((await f.run({acao:'salvar',documentoId:ids.doc,versaoEsperada:0,tipo:'proposta',proposta:propostaBody})).statusCode,200);
 const p=await f.run({acao:'preparar',documentoId:ids.doc,versaoEsperada:1});assert.equal(p.statusCode,200,p.body);
 assert.equal((await f.run({acao:'confirmarRevisao',documentoId:ids.doc,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,200);
 return {p,exportar:extra=>f.run({acao:'exportar',documentoId:ids.doc,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash,...extra})};
}
test('consulta sugere condições do edital e diz de onde veio o modelo; porte vai para a escolha ME/EPP',async t=>{
 const f=fixture(t);const r=await f.run({acao:'consultar',itensPaginados:true,soParticipar:true});assert.equal(r.statusCode,200,r.body);
 assert.equal(r.json.propostaEdital.validade,'60 (sessenta) dias');assert.equal(r.json.propostaEdital.pagamento,'Até 30 (trinta) dias após o atesto da nota fiscal');
 assert.equal(r.json.propostaEdital.modelo.fonte,'Modelo do edital: Anexo II, pág. 30');assert.equal(r.json.porte,'demais');
 assert.ok(f.state.urls.some(u=>u.includes('participar=is.true')),'lista só itens marcados para participar');
 assert.ok(!JSON.stringify(r.json).includes('12345-6'),'banco não vai para a tela');
 const sem=fixture(t,{dossie:false});const s=await sem.run({acao:'consultar',itensPaginados:true});
 assert.equal(s.json.propostaEdital.validade,'');assert.equal(s.json.propostaEdital.modelo.fonte,'Modelo LicitaPlena');
});
test('proposta: prévia com destinatário, objeto, edital sem ano duplicado, CNPJ mascarado e declarações do modelo; CPF e banco só no arquivo',async t=>{
 const f=fixture(t);const {p,exportar}=await propostaRevisada(f);const previa=p.json.previa.texto;
 assert.match(previa,/^À ASSEMBLEIA LEGISLATIVA DO ESTADO DO PARA\nPregão Eletrônico nº 012\/2026\nA\/C: Agente de Contratação \/ Pregoeiro\(a\)\n\nPROPOSTA DE PREÇOS/);
 assert.doesNotMatch(previa,/2026\/2026|Registro de Preços/);
 assert.match(previa,/CNPJ: 28\.786\.260\/0001-53/);assert.match(previa,/Objeto\n\nAquisição de agendas permanentes/);
 assert.match(previa,/Marca: Tilibra \| Modelo: Permanente \| Fabricante: Tilibra Produtos de Papelaria/);
 assert.match(previa,/Valor global da proposta: R\$ 10\.400,00 \(dez mil e quatrocentos reais\)/);
 // Pedido do dono (23/11): extenso por item, também no modelo do edital; telefone no padrão brasileiro.
 const EXT='Valor unitário: cinquenta e dois reais (R$ 52,00) · Valor total do item: dez mil e quatrocentos reais (R$ 10.400,00)';
 assert.ok(previa.includes(`Total: R$ 10.400,00\n${EXT}`));
 assert.match(previa,/Telefone: \(91\) 3333-4444/);assert.ok(!previa.includes('+55'));
 assert.match(previa,/Local de entrega: Palácio Cabanagem, Belém\/PA/);
 assert.match(previa,/HCM LTDA declara, sob as penas da lei, que:\n\n- Que nos preços propostos/);
 assert.match(previa,/Belém\/PA, \[data do download\]/);assert.match(previa,/\[CPF do representante\]/);assert.match(previa,/\[Banco, agência, conta e Pix/);
 assert.ok(!previa.includes('529.982')&&!previa.includes('12345-6'));
 assert.match(p.json.previa.fontes.join(' '),/Modelo do edital: Anexo II, pág\. 30/);
 assert.equal(p.json.estrutura.itens[0].fabricante,'Tilibra Produtos de Papelaria');assert.equal(p.json.estrutura.condicoes.localEntrega,'Palácio Cabanagem, Belém/PA');
 assert.equal(p.json.estrutura.certame.srp,false);assert.ok(!JSON.stringify(p.json.estrutura).includes(CPF));
 const w=await exportar();assert.equal(w.statusCode,200,w.body);
 assert.equal(w.json.nome,'Proposta - HCM LTDA - Pregão 012-2026 - Assembleia Legislativa do Estado do Para.docx');
 const zip=new AdmZip(Buffer.from(w.json.arquivoBase64,'base64')),xml=zip.readAsText('word/document.xml');
 assert.ok(xml.includes(`>${EXT}<`));assert.match(xml,/<w:gridSpan w:val="7"\/>/);assert.match(xml,/>Valor global da proposta</);
 assert.match(zip.readAsText('word/header1.xml'),/\(91\) 3333-4444 · contato@example\.invalid/);
 assert.match(xml,/CPF: 529\.982\.247-25/);assert.match(xml,/>12345-6</);assert.match(xml,/Belém\/PA, \d{1,2} de [a-zç]+ de \d{4}/);
 assert.ok(zip.getEntry('word/media/logo.png'));assert.match(zip.readAsText('word/footer1.xml'),/HCM LTDA · CNPJ 28\.786\.260\/0001-53/);
 const pdf=await exportar({saida:'pdf'});assert.equal(pdf.statusCode,200,pdf.body);assert.equal(pdf.json.mime,'application/pdf');
 assert.match(pdf.json.nome,/\.pdf$/);assert.equal(pdf.json.logo.tipo,'image/png');
 assert.equal(pdf.json.documento.blocos.find(b=>b.t==='assinatura').cpf,'529.982.247-25');
 assert.deepEqual(pdf.json.documento.blocos.find(b=>b.t==='itens').extensos,[EXT]);
 assert.ok(!JSON.stringify(f.state.kit).includes(CPF)&&!JSON.stringify(f.state.kit).includes('12345-6'),'rascunho e revisão sem CPF nem banco');
 const ficha=await exportar({peca:'ficha'});assert.equal(ficha.statusCode,200,ficha.body);
 assert.equal(ficha.json.nome,'Ficha técnica - HCM LTDA - Pregão 012-2026 - Assembleia Legislativa do Estado do Para.docx');
 const fx=new AdmZip(Buffer.from(ficha.json.arquivoBase64,'base64')).readAsText('word/document.xml');
 assert.match(fx,/FICHA TÉCNICA/);assert.match(fx,/Exigência do Termo de Referência/);assert.match(fx,/>CAPA COURVIN</);assert.match(fx,/Tilibra Produtos de Papelaria/);assert.doesNotMatch(fx,/12345-6/);
 assert.equal((await exportar({peca:'outra'})).statusCode,400);
});
test('sem modelo no edital: declarações padrão LicitaPlena, sem "ata" nem "registro de preços"; sem local no edital vira aviso',async t=>{
 const f=fixture(t,{dossie:false});const {p}=await propostaRevisada(f);const previa=p.json.previa.texto;
 assert.match(previa,/aceita as condições de pagamento do edital/);assert.doesNotMatch(previa,/\bata\b|registro de preços/i);
 assert.doesNotMatch(previa,/Local de entrega:/);assert.match(p.json.previa.fontes.join(' '),/Local de entrega não encontrado/);
 assert.match(p.json.previa.fontes.join(' '),/Modelo LicitaPlena/);
});
test('declarações prontas: enquadramento pelo porte, data do download, um arquivo com nome da licitação e PDF',async t=>{
 const f=fixture(t);
 const l=await f.run({acao:'gerarDeclaracoesLote',declaracoes:[{modeloCodigo:'HAB_ART63_I'},{modeloCodigo:'ME_EPP_NAO_ENQUADRAMENTO'}]});assert.equal(l.statusCode,200,l.body);
 for(const d of f.state.kit){const p=await f.run({acao:'preparar',documentoId:d.id,versaoEsperada:1});assert.equal(p.statusCode,200,p.body);
  assert.match(p.json.previa.texto,/Belém\/PA, \[data do download\]\./);assert.doesNotMatch(p.json.previa.texto,/PREENCHER/);
  assert.equal((await f.run({acao:'confirmarRevisao',documentoId:d.id,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,200);}
 const x=await f.run({acao:'exportarDeclaracoes'});assert.equal(x.statusCode,200,x.body);
 assert.equal(x.json.nome,'Declarações - HCM LTDA - Pregão 012-2026 - Assembleia Legislativa do Estado do Para.docx');
 const xml=new AdmZip(Buffer.from(x.json.arquivoBase64,'base64')).readAsText('word/document.xml');
 assert.match(xml,/não se enquadra como microempresa ou empresa de pequeno porte/);assert.match(xml,/CPF sob o nº 529\.982\.247-25/);assert.doesNotMatch(xml,/\{\{data\}\}|data do download/);
 const pdf=await f.run({acao:'exportarDeclaracoes',saida:'pdf'});assert.equal(pdf.json.mime,'application/pdf');assert.equal(pdf.json.documento.blocos.filter(b=>b.t==='quebra').length,1);
 const um=await f.run({acao:'exportarDeclaracoes',documentoIds:[f.state.kit[0].id]});assert.match(um.json.nome,/^Declaração de cumprimento dos requisitos de habilitação - HCM LTDA - Pregão 012-2026/);
});
test('Optante pelo Simples Nacional: pelo regime do Perfil; sem regime, só o porte que não deixa dúvida; senão em branco',()=>{
 const {optanteSimples}=require('../_kit_documentos');
 const SIM='(X) Sim   ( ) Não',NAO='( ) Sim   (X) Não',BRANCO='( ) Sim   ( ) Não';
 assert.equal(optanteSimples({regime_tributario:'simples',porte:'epp'}),SIM);
 assert.equal(optanteSimples({regime_tributario:'mei'}),SIM);
 assert.equal(optanteSimples({regime_tributario:'presumido',porte:'me'}),NAO);
 assert.equal(optanteSimples({regime_tributario:'real'}),NAO);
 assert.equal(optanteSimples({porte:'mei'}),SIM);
 assert.equal(optanteSimples({porte:'demais'}),NAO);
 assert.equal(optanteSimples({porte:'me'}),BRANCO);
 assert.equal(optanteSimples({}),BRANCO);
});
test('Simples Nacional na proposta: sem modelo vai nos dados da proponente; com modelo que pergunta, na posição do modelo',async t=>{
 const sem=fixture(t,{dossie:false});const a=(await propostaRevisada(sem)).p.json.previa.texto;
 assert.match(a,/Porte: Não enquadrada como ME\/EPP\nOptante pelo Simples Nacional: \( \) Sim {3}\(X\) Não/);
 const m=detectarModeloProposta('ANEXO II – MODELO DE PROPOSTA\n\nRazão social, CNPJ.\n\nValidade da proposta: 60 dias.\n\nOptante pelo Simples Nacional: ( ) Sim ( ) Não\n\nDados bancários: banco, agência e conta.\n\nPrazo de entrega: 10 dias.\n');
 assert.deepEqual(m.campos,['validade','simples','banco','prazoEntrega']);
 const f=fixture(t);f.state.dossie.texto=f.state.dossie.texto.replace(/(Validade da proposta[^\n]*\n)/,'$1\nOptante pelo Simples Nacional: ( ) Sim ( ) Não\n');
 f.state.perfilEmpresa.regime_tributario='simples';
 const b=(await propostaRevisada(f)).p.json.previa.texto;
 assert.doesNotMatch(b.slice(0,b.indexOf('Itens e preços')),/Optante/,'com o modelo, a pergunta sai dos dados da proponente');
 assert.match(b,/Validade da proposta: 60 \(sessenta\) dias\nOptante pelo Simples Nacional: \(X\) Sim {3}\( \) Não/);
});
