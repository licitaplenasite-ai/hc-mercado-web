const {exigirUsuarioAprovado,cabecalhosPadrao}=require('./_auth');
const {carregarContextoIdentificacao}=require('./_empresa_identificacao_contexto');
const {falhar}=require('./_empresa_identificacao');
const {buscarFonteItem,numerosDaPagina,listarNumerosItens}=require('./_pncp_item_fonte');
// Itens por chamada de "Importar todos": ~12 subrequisições fixas + 1 lista + 2 por item (fonte e gravação) fica abaixo das 50 do Cloudflare gratuito.
const LOTE=15;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function referencia(p){
 let m;try{const u=new URL(p.url_origem);if(u.protocol==='https:'&&u.hostname==='pncp.gov.br'&&!u.username&&!u.password&&!u.search&&!u.hash)m=/^\/app\/editais\/(\d{14})\/(\d{4})\/(\d+)\/?$/.exec(u.pathname);}catch{}
 if(m)return {cnpj:m[1],ano:m[2],seq:String(Number(m[3]))};
 const id=[p.origem_externa_id,p.numero].find(v=>typeof v==='string'&&/^\d{14}-1-\d+\/\d{4}$/.test(v));
 if(!id)falhar('Processo sem referência PNCP utilizável. Confira o link oficial.',409);
 const a=/^(\d{14})-1-(\d+)\/(\d{4})$/.exec(id);return {cnpj:a[1],ano:a[3],seq:String(Number(a[2]))};
}
function criarHandler({enabled=()=>process.env.IMPORTACAO_PNCP_LOCAL==='1',serviceKey=()=>process.env.SUPABASE_SERVICE_ROLE_KEY,auth=exigirUsuarioAprovado,contexto=carregarContextoIdentificacao,fetchImpl=(...a)=>fetch(...a),timeoutMs=10000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Timeout inválido');
 return async event=>{const reply=(statusCode,data)=>({statusCode,headers:{...cabecalhosPadrao(event),'Cache-Control':'no-store'},body:JSON.stringify(data)});
 if(event.httpMethod!=='POST')return reply(405,{erro:'Método não permitido.'});if(!enabled())return reply(503,{erro:'Importação rastreável ainda não habilitada.'});
 try{
 const a=await auth(event);if(!a.ok)return reply(a.status,{erro:a.erro});
 if(typeof event.body!=='string'||Buffer.byteLength(event.body)>2048)falhar('Solicitação inválida.',400);
 let b;try{b=JSON.parse(event.body);}catch{falhar('Solicitação inválida.',400);}
 // Um item (numeroItem) ou uma página de LOTE itens (pagina): nunca os dois.
 const lote=!!b&&typeof b==='object'&&Object.hasOwn(b,'pagina');
 if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['empresaId','processoId',lote?'pagina':'numeroItem'].includes(k))||!uuid(b.empresaId)||!uuid(b.processoId)||(lote?!Number.isSafeInteger(b.pagina)||b.pagina<1||b.pagina>200:!Number.isSafeInteger(b.numeroItem)||b.numeroItem<1||b.numeroItem>2147483647))falhar('Seletores inválidos.',400);
 const c=await contexto(event,a.userId,b.empresaId),e=c.empresa;if(!e||e.id!==b.empresaId||!uuid(e.organizacao_id))falhar('Empresa indisponível.',403);
 const members=await c.rest(`operacao_membros?usuario_id=eq.${a.userId}&organizacao_id=eq.${e.organizacao_id}&select=usuario_id,organizacao_id,empresa_id,papel`);
 if(!members.some(m=>m.usuario_id===a.userId&&m.organizacao_id===e.organizacao_id&&['operador','gestor'].includes(m.papel)&&(m.empresa_id===null||m.empresa_id===e.id)))falhar('Acesso não autorizado.',403);
 const ps=await c.rest(`operacao_processos?id=eq.${b.processoId}&empresa_id=eq.${e.id}&organizacao_id=eq.${e.organizacao_id}&select=id,empresa_id,organizacao_id,url_origem,origem_externa_id,numero`),p=ps[0];
 if(ps.length!==1||p.id!==b.processoId||p.empresa_id!==e.id||p.organizacao_id!==e.organizacao_id)falhar('Processo indisponível.',404);
 const ref=referencia(p);if(!/^\d{1,12}$/.test(ref.seq)||Number(ref.seq)<1)falhar('Referência PNCP inválida.',409);
 const key=serviceKey();if(!key)falhar('Persistência de origem indisponível.',503);
 const rpc=async(name,args)=>{const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);try{return await(await c.request('/rest/v1/rpc/'+name,{method:'POST',signal:ctrl.signal,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args)})).json();}finally{clearTimeout(timer);}};
 const scope={p_usuario:a.userId,p_empresa:e.id,p_processo:p.id,p_organizacao:e.organizacao_id};
 if(await rpc('reservar_importacao_pncp',scope)!==true)falhar('Aguarde sete segundos antes de consultar outro item.',429);
 const p_referencia={url_origem:p.url_origem||null,origem_externa_id:p.origem_externa_id||null,numero:p.numero||null};
 const gravar=f=>rpc('gravar_importacao_pncp',{...scope,p_compra:f.compra,p_numero:f.item.numero,p_url:f.url,p_hash:f.hash,p_item:f.item,p_snapshot:f.snapshot,p_referencia});
 const confirmar=async()=>{const atual=await auth(event);if(!atual.ok)return reply(atual.status,{erro:atual.erro});if(atual.userId!==a.userId)falhar('Acesso não autorizado.',403);};
 const valido=r=>r&&typeof r.itemId==='string'&&['importado','inalterado','fonte_alterada'].includes(r.estado);
 if(lote){
  const numeros=await numerosDaPagina(ref.cnpj,ref.ano,ref.seq,b.pagina,LOTE,{fetch:fetchImpl,timeoutMs});
  const fontes=[],recusados=[];
  for(const n of numeros){try{fontes.push(await buscarFonteItem(ref,n,{fetchImpl,timeoutMs}));}catch(err){if(err.status!==422)throw err;recusados.push(n);}}
  const negado=await confirmar();if(negado)return negado;
  const contagem={importado:0,inalterado:0,fonte_alterada:0},colisoes=[];
  for(const f of fontes){const r=await gravar(f);if(r?.estado==='colisao_manual'){colisoes.push(f.item.numero);continue;}if(!valido(r))falhar(`Persistência do item ${f.item.numero} não confirmada.`,503);contagem[r.estado]++;}
  return reply(200,{lote:true,pagina:b.pagina,lidos:numeros.length,fim:numeros.length<LOTE,primeiro:numeros[0]??null,ultimo:numeros.at(-1)??null,importados:contagem.importado,inalterados:contagem.inalterado,alterados:contagem.fonte_alterada,colisoes,recusados});
 }
 let fonte;
 try{fonte=await buscarFonteItem(ref,b.numeroItem,{fetchImpl,timeoutMs});}
 catch(err){
  if(!err.itemInexistente)throw err;
  // Item inexistente: diz a faixa real (editais por lote numeram 10001, 10002…). Sem lista, só a primeira frase.
  let faixa='';try{const ns=await listarNumerosItens(ref.cnpj,ref.ano,ref.seq,{fetch:fetchImpl,timeoutMs});faixa=ns.length?` Os itens vão de ${Math.min(...ns)} a ${Math.max(...ns)}.`:' O PNCP não lista itens para este edital.';}catch{ /* mantém a primeira frase */ }
  falhar(err.message+faixa,404);
 }
 const negado=await confirmar();if(negado)return negado;
 const result=await gravar(fonte);
 if(result?.estado==='colisao_manual')falhar('Já existe item manual com esse número. Confira o cadastro e revise o vínculo antes de importar.',409);
 if(!valido(result))falhar('Persistência não confirmada.',503);
 return reply(200,{...result,fonte:'PNCP',mensagem:result.estado==='fonte_alterada'?'Fonte alterada. Oferta e conteúdo anterior preservados; confira antes de revisar.':'Item com origem PNCP armazenado. Informe sua oferta no cadastro; isso não confirma vínculo Compras.gov.'});
 }catch(error){
  // Sem .status é falha inesperada (TypeError, rede, RPC): a causa real fica no log do servidor, nunca na resposta.
  if(!error?.status)console.error('importar-item-pncp:',error?.stack||error);
  return reply([400,403,404,409,422,429,502].includes(error.status)?error.status:503,{erro:error.status?error.message:'Importação indisponível. Nenhum resultado foi confirmado.'});}
 };
}
module.exports={handler:criarHandler(),criarHandler,referencia};
