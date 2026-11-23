const test=require('node:test');
const assert=require('node:assert/strict');
const {lerEscolha,salvarEscolha,salvarOferta}=require('../_itens_processo');
// Escolha dos itens (operacao_itens_participar.sql): PostgREST simulado, sem rede. Escopo sempre do servidor.
const org='44444444-4444-4444-4444-444444444444',proc='22222222-2222-2222-2222-222222222222',emp='33333333-3333-3333-3333-333333333333';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const linha=(n,extra={})=>({id:id(n),organizacao_id:org,processo_id:proc,tipo:'item',identificador:String(n),descricao:'Item '+n,quantidade:'200.000',valor_unitario_proposta:null,marca:null,modelo:null,valor_unitario_minimo:null,participar:false,tipo_beneficio:null,...extra});
function simular(responder){
 const chamadas=[],original=globalThis.fetch;
 globalThis.fetch=async(url,op={})=>{chamadas.push({url:String(url),metodo:op.method||'GET',corpo:op.body?JSON.parse(op.body):null});return responder(String(url),op);};
 return {chamadas,restaurar:()=>{globalThis.fetch=original;}};
}
const json=(v,status=200,headers={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json',...headers}});
const base={token:'Bearer T',organizacaoId:org,processoId:proc,empresaId:emp};

test('lerEscolha: itens em ordem natural, participar/tipoBeneficio e porte do perfil',async()=>{
 const rows=[linha(10,{participar:true}),linha(2,{tipo_beneficio:1}),linha(1)];
 const s=simular(url=>url.includes('operacao_perfil_empresa')?json([{porte:'epp'}]):json(rows,200,{'content-range':'0-2/3'}));
 try{
  const r=await lerEscolha({...base,body:{}});
  assert.deepEqual(r.body.itens.map(i=>[i.identificador,i.participar,i.tipoBeneficio]),[['1',false,null],['2',false,1],['10',true,null]]);
  assert.equal(r.body.porte,'epp');
  assert.match(s.chamadas[0].url,new RegExp(`processo_id=eq.${proc}&organizacao_id=eq.${org}&tipo=eq.item`));
 }finally{s.restaurar();}
});
test('lerEscolha: banco sem a coluna responde 503 com aviso; lista incompleta é recusada; perfil ausente = porte null',async()=>{
 let s=simular(()=>json({code:'42703'},400));
 try{await assert.rejects(lerEscolha({...base,body:{}}),{status:503,message:/escolha de itens ainda não está disponível/});}finally{s.restaurar();}
 s=simular(()=>json([linha(1)],200,{'content-range':'0-0/1500'}));
 try{await assert.rejects(lerEscolha({...base,body:{}}),{status:503,message:/mais de 1000 itens/});}finally{s.restaurar();}
 s=simular(url=>url.includes('operacao_perfil_empresa')?json({code:'42P01'},404):json([linha(1)],200,{'content-range':'0-0/1'}));
 try{assert.equal((await lerEscolha({...base,body:{}})).body.porte,null);}finally{s.restaurar();}
});
test('salvarEscolha: lotes de 100 com escopo do servidor; id de outro processo falha com 404',async()=>{
 const ids=Array.from({length:150},(_,k)=>id(k+1));
 const s=simular((url,op)=>{const lote=/id=in\.\(([^)]*)\)/.exec(url)[1].split(',');return json(lote.map(i=>({id:i,organizacao_id:org,processo_id:proc,participar:JSON.parse(op.body).participar})));});
 try{
  const r=await salvarEscolha({...base,body:{itemIds:ids,participar:true}});
  assert.equal(r.body.gravados,150);
  assert.equal(s.chamadas.length,2);
  for(const c of s.chamadas){assert.equal(c.metodo,'PATCH');assert.deepEqual(c.corpo,{participar:true});assert.match(c.url,new RegExp(`processo_id=eq.${proc}&organizacao_id=eq.${org}`));}
 }finally{s.restaurar();}
 const s2=simular(()=>json([]));
 try{await assert.rejects(salvarEscolha({...base,body:{itemIds:[id(1)],participar:false}}),{status:404});}finally{s2.restaurar();}
 for(const body of [{itemIds:[id(1)],participar:'sim'},{itemIds:[],participar:true},{itemIds:['x'],participar:true},{itemIds:[id(1),id(1)],participar:true},{itemIds:Array.from({length:1001},(_,k)=>id(k)),participar:true},{participar:true}])
  await assert.rejects(salvarEscolha({...base,body}),{status:400});
});
test('salvarOferta: grava preço/marca/modelo com atualizado_em; recusa abaixo do mínimo e valor fora do formato',async()=>{
 const s=simular((url,op)=>op.method==='PATCH'?json([{...linha(1),...JSON.parse(op.body)}]):json([linha(1,{valor_unitario_minimo:'40.00'})]));
 try{
  const r=await salvarOferta({...base,body:{itemId:id(1),valorUnitario:'52.00',marca:' Marca X ',modelo:null}});
  assert.equal(r.body.item.valorUnitario,'52.00');assert.equal(r.body.item.marca,'Marca X');
  const patch=s.chamadas.find(c=>c.metodo==='PATCH');
  assert.equal(patch.corpo.valor_unitario_proposta,'52.00');assert.ok(patch.corpo.atualizado_em);
  assert.match(patch.url,/valor_unitario_minimo\.lte\.52\.00/);
  await assert.rejects(salvarOferta({...base,body:{itemId:id(1),valorUnitario:'39.99',marca:null,modelo:null}}),{status:422,message:/abaixo do seu preço mínimo R\$ 40,00/});
  await assert.rejects(salvarOferta({...base,body:{itemId:id(1),valorUnitario:'52,00',marca:null,modelo:null}}),{status:400});
  await assert.rejects(salvarOferta({...base,body:{itemId:id(1),valorUnitario:'52.00',marca:null}}),{status:400});
  await assert.rejects(salvarOferta({...base,body:{itemId:id(1),valorUnitario:null,marca:null,modelo:null,participar:true}}),{status:400});
  // null limpa o preço (item que a pessoa ainda vai cotar).
  assert.equal((await salvarOferta({...base,body:{itemId:id(1),valorUnitario:null,marca:null,modelo:null}})).body.item.valorUnitario,null);
 }finally{s.restaurar();}
});
