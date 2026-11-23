const {LIMITES,validarBudget}=require('./_kit_proposta_limites');
const {ordemItem}=require('./_kit_proposta_itens');
const {createHash}=require('node:crypto');
const {falhar}=require('./_empresa_identificacao');
const {montarDocx}=require('./gerar-checklist');
const doc=require('./_kit_proposta_doc');
const {textoDosBlocos,docxDosBlocos}=doc;
const {fonteModelo}=require('./_kit_modelo_edital');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function pendente(mensagem){const e=new Error('Confira as pendências antes de gerar.');e.status=422;e.pendencias=[mensagem];throw e;}
function texto(valor,rotulo,max=500){
 if(typeof valor!=='string'||!valor.trim()||valor.length>max||Array.from(valor).some(c=>{const n=c.codePointAt(0);return !(n===9||n===10||n===13||n>=32&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff);}))pendente(`Confira ${rotulo}.`);
 return valor;
}
function decimal(valor,escala){
 // numeric chega como texto via alias ::text no REST, evitando perda binária.
 if(typeof valor!=='string'||!new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${escala}})?$`).test(valor))pendente('Valor decimal inválido.');
 const [inteiro,fracao='']=valor.split('.');const n=BigInt(inteiro+fracao.padEnd(escala,'0'));
 if(n<=0n||n>999999999999999n)pendente('Valor fora do limite ou igual a zero.');return n;
}
function totalItem(q,p){const n=(decimal(q,3)*decimal(p,2)+500n)/1000n;if(n>999999999999999n)pendente('Total excede o limite.');return n;}
const dinheiro=n=>`${String(n/100n).replace(/\B(?=(\d{3})+$)/g,'.')},${String(n%100n).padStart(2,'0')}`;
// numeric(…,3) chega como texto: inteiro sem casas ("200"), fração só com as casas usadas ("2,5"); "200,000" parecia duzentos mil.
const quantidade=q=>{const [i,f='']=q.split('.');const c=f.replace(/0+$/,'');return c?`${i},${c}`:i;};
// Valor por extenso (proposta formato 2): centavos em BigInt, só aritmética inteira.
const UNIDADES=['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
const DEZENAS=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
const CENTENAS=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
const ESCALAS=[null,null,['milhão','milhões'],['bilhão','bilhões'],['trilhão','trilhões']];
function ate999(n){
 if(n===100)return 'cem';
 const c=Math.floor(n/100),r=n%100,partes=[];
 if(c)partes.push(CENTENAS[c]);
 if(r)partes.push(r<20?UNIDADES[r]:DEZENAS[Math.floor(r/10)]+(r%10?` e ${UNIDADES[r%10]}`:''));
 return partes.join(' e ');
}
function inteiroPorExtenso(n){
 const grupos=[];for(let i=0;n>0n;i++,n/=1000n)grupos.push([Number(n%1000n),i]);
 if(grupos.length>ESCALAS.length)throw new RangeError('Valor acima do suportado.');
 const ativos=grupos.filter(([v])=>v).reverse();
 return ativos.map(([v,i],k)=>{
  const palavra=i===0?ate999(v):i===1?(v===1?'mil':`${ate999(v)} mil`):`${ate999(v)} ${ESCALAS[i][v===1?0:1]}`;
  // "e" só antes do último grupo quando ele é < 100 ou centena redonda: "mil e um", "mil e duzentos", "mil duzentos e trinta".
  return k>0&&k===ativos.length-1&&(v<100||v%100===0)?`e ${palavra}`:palavra;
 }).join(' ');
}
function valorPorExtenso(centavos){
 const n=BigInt(centavos);if(n<0n)throw new RangeError('Valor negativo.');
 if(n===0n)return 'zero reais';
 const reais=n/100n,cent=Number(n%100n),partes=[];
 // Milhão/bilhão/trilhão redondo leva "de": "um milhão de reais".
 if(reais)partes.push(`${inteiroPorExtenso(reais)} ${reais%1000000n===0n?'de ':''}${reais===1n?'real':'reais'}`);
 if(cent)partes.push(`${ate999(cent)} ${cent===1?'centavo':'centavos'}`);
 return partes.join(' e ');
}
function canonico(v){if(Array.isArray(v))return v.map(canonico);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico(v[k])]));return v;}
const CPF_PREVIA='[CPF do representante]';
// Data e dados bancários seguem a regra do CPF: a prévia (que o papel leitura vê) leva só o rótulo; o arquivo leva o valor lido na hora.
const DATA_PREVIA='[data do download]';
const BANCO_PREVIA='[Banco, agência, conta e Pix do Perfil da empresa: entram só no arquivo baixado]';
const SEM_CPF_PROPOSTA='______________________';
const cnpjFormatado=c=>{const d=String(c||'');return /^\d{14}$/.test(d)?`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`:d;};
const PORTE_TEXTO={mei:'Microempreendedor individual (MEI)',me:'Microempresa (ME)',epp:'Empresa de pequeno porte (EPP)',demais:'Não enquadrada como ME/EPP'};
// "Optante pelo Simples Nacional: (X) Sim ( ) Não" pelo regime tributário do Perfil da empresa (MEI é do Simples). Sem regime,
// o porte decide só quando não deixa dúvida (MEI sim; acima de EPP não); ME/EPP sem regime ficam em branco para marcar à mão.
function optanteSimples(pe){
 const sim=['simples','mei'].includes(pe.regime_tributario)||(!pe.regime_tributario&&pe.porte==='mei');
 const nao=['presumido','real'].includes(pe.regime_tributario)||(!pe.regime_tributario&&pe.porte==='demais');
 return `(${sim?'X':' '}) Sim   (${nao?'X':' '}) Não`;
}
// Registro de preços só quando o edital diz: "Pregão para Registro de Preços" num pregão comum é erro de cópia que vira recurso.
function certame(processo,edital){
 const numero=doc.numeroEdital(processo.numero),modalidade=doc.modalidadeTexto(processo.modalidade);
 return {numero,orgao:processo.orgao,modalidade,srp:edital.srp===true,linha:`${modalidade}${edital.srp===true?' para Registro de Preços':''} nº ${numero}`};
}
const destinatario=c=>({t:'linhas',linhas:[`À ${c.orgao}`,c.linha,'A/C: Agente de Contratação / Pregoeiro(a)']});
function emitente(empresa,dados,pe){
 return {nome:empresa.razao_social,linhas:[`CNPJ ${cnpjFormatado(empresa.cnpj)}`,dados.endereco,[pe.telefone,pe.email].filter(Boolean).join(' · ')].filter(Boolean)};
}
function declaracao(empresa,processo,dados,body,fontes){
 const d=body.declaracao||{};const titulo=texto(d.titulo,'título',180);const modelo=texto(d.texto,'texto da declaração',20000);
 const variaveis={razao_social:empresa.razao_social,cnpj:cnpjFormatado(empresa.cnpj),endereco:dados.endereco,representante:dados.representante,cargo:dados.cargo,numero_edital:doc.numeroEdital(processo.numero),orgao:processo.orgao};
 // LGPD: o CPF só entra no texto exportado; prévia e revisaoHash cobrem o marcador. {{data}} = data do download.
 const precisaCpf=modelo.includes('{{cpf_representante}}');
 const montar=sens=>{if(sens&&precisaCpf&&!sens.cpf)return null;return modelo.replace(/{{([\s\S]*?)}}/g,(_,v)=>{if(v==='cpf_representante')return sens?sens.cpf:CPF_PREVIA;if(v==='data')return sens?.data||DATA_PREVIA;if(!Object.hasOwn(variaveis,v))pendente('Variável desconhecida na declaração.');return variaveis[v];});};
 const conteudo=montar(null);
 if(conteudo.includes('{{')||conteudo.includes('}}'))pendente('Variável inválida na declaração.');
 const fonte=d.fonte==null||d.fonte===''?'':texto(d.fonte,'fonte',1000);fontes.push(fonte?`Referência informada pelo usuário (não verificada): ${fonte}`:'Modelo informado pelo usuário; referência não informada.');
 return {titulo,campos:{titulo,modelo,fonte},itens:[],precisaCpf,blocos:(sens,c)=>{const t=montar(sens);return t===null?null:[{t:"titulo",texto:titulo},destinatario(c),{t:"texto",texto:t}];}};
}
// Declarações que acompanham a proposta quando o edital não traz modelo. Nada de "ata" ou "registro de preços" aqui.
function declaracoesPadrao(edital){
 return ['Nos preços ofertados estão incluídos todos os custos diretos e indiretos, tributos, encargos sociais, trabalhistas, previdenciários, fiscais e comerciais, frete, seguros, embalagens e quaisquer outras despesas necessárias ao cumprimento integral do objeto.',
  'A proposta atende a todas as especificações, quantidades e condições do edital e de seus anexos, que a proponente conhece e aceita integralmente.',
  'Os produtos ofertados atendem às especificações do Termo de Referência, nas marcas, modelos e fabricantes indicados, que não serão alterados durante a execução.',
  'A proponente aceita as condições de pagamento do edital, inclusive a apresentação da nota fiscal e das certidões de regularidade exigidas.',
  ...(edital.manualPortugues?['Os manuais e instruções de uso serão entregues em língua portuguesa.']:[]),
  'A proponente manterá, durante toda a execução do contrato, as condições de habilitação e qualificação exigidas na licitação.'];
}
const SEM_LOCAL='Local de entrega não encontrado no resumo do edital: confira no Termo de Referência e complete no arquivo.';
function proposta(ctx,body,fontes){
 const itens=[];const titulo='Proposta de preços';const p=body.proposta||{};const ids=p.itemIds;
 if(!Array.isArray(ids)||ids.length<1||ids.length>LIMITES.itens||ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)pendente('Selecione de 1 a 1000 itens sem duplicatas; o tamanho total também é limitado.');
 const campos={validade:texto(p.validade,'validade'),prazoEntrega:texto(p.prazoEntrega,'prazo de entrega'),pagamento:texto(p.pagamento,'pagamento'),unidades:{}};
 validarBudget(p); const indice=new Map(ctx.itens.map(i=>[i.id,i])); let total=0n;const tabela=[],textos=[],estrutura=[];
 const fabricantes=ctx.extra?.fabricantes||{};
 for(const id of [...ids].sort()){
 const i=indice.get(id);if(!i)falhar('Item indisponível.',404);if(i.tipo!=='item')pendente('Lote agregado requer detalhamento em itens individuais.');
 const unidade=texto(p.unidades?.[id],'unidade informada por item',40);campos.unidades[id]=unidade;
 texto(i.descricao,'descrição do item',10000);texto(i.identificador,'identificador do item',180);
 for(const c of ['marca','modelo'])if(i[c]!=null&&i[c]!=='')texto(i[c],c,500);
 const subtotal=totalItem(i.quantidade,i.valor_unitario_proposta);total+=subtotal;if(total>999999999999999n)pendente('Total excede o limite.');itens.push(i);
 const fabricante=typeof fabricantes[id]==='string'?fabricantes[id].slice(0,200):'';
 tabela.push([i.identificador,i.descricao,quantidade(i.quantidade),unidade,`${i.marca||'não informada'} / ${i.modelo||'não informado'}${fabricante?` / Fabricante: ${fabricante}`:''}`,dinheiro(decimal(i.valor_unitario_proposta,2)),dinheiro(subtotal)]);
 textos.push(`Item ${i.identificador}: ${i.descricao}\nQuantidade: ${quantidade(i.quantidade)} | Unidade informada pelo usuário: ${unidade}\nMarca: ${i.marca||'não informada'} | Modelo: ${i.modelo||'não informado'}${fabricante?` | Fabricante: ${fabricante}`:''}\nUnitário ofertado: R$ ${dinheiro(decimal(i.valor_unitario_proposta,2))} | Total: R$ ${dinheiro(subtotal)}`);
 estrutura.push({id,identificador:i.identificador,descricaoEdital:i.descricao,quantidade:i.quantidade,unidade,marca:i.marca||null,modelo:i.modelo||null,fabricante:fabricante||null,unitario:i.valor_unitario_proposta,total:dinheiro(subtotal)});
 }
 fontes.push('Descrição, quantidade e preço ofertado: itens persistidos do processo. Unidade e condições informadas pelo usuário (sugeridas pelo edital ou pela Proposta padrão).');
 tabela.sort((a,b)=>ordemItem({identificador:a[0],id:''},{identificador:b[0],id:''}));
 return {titulo,campos,itens,tabela,textos,total:dinheiro(total),extenso:valorPorExtenso(total),estrutura};
}
function blocosProposta({empresa,dados,processo,c,extra,r},sens){
 const pe=extra.perfilEmpresa||{},ed=extra.edital||{},modelo=ed.modelo||null;
 let n=0;const secao=t=>({t:'secao',texto:`${++n}. ${t}`});
 const proponente=[['Razão social',empresa.razao_social],['Nome fantasia',pe.nome_fantasia],['CNPJ',cnpjFormatado(empresa.cnpj)],['Inscrição estadual',pe.inscricao_estadual],['Inscrição municipal',pe.inscricao_municipal],
  ['Porte',PORTE_TEXTO[pe.porte]],...(modelo?.campos?.includes('simples')?[]:[['Optante pelo Simples Nacional',optanteSimples(pe)]]),['Endereço',dados.endereco],['Telefone',pe.telefone],['E-mail',pe.email],['Representante legal',`${dados.representante} – ${dados.cargo}`]].filter(([,v])=>v);
 // Garantia: um valor só para o documento inteiro (o do edital); sem garantia no edital nem no modelo, a linha não sai.
 const cond={validade:['Validade da proposta',r.campos.validade],prazoEntrega:['Prazo de entrega',r.campos.prazoEntrega],localEntrega:ed.localEntrega?['Local de entrega',ed.localEntrega]:null,
  pagamento:['Condições de pagamento',r.campos.pagamento],simples:modelo?.campos?.includes('simples')?['Optante pelo Simples Nacional',optanteSimples(pe)]:null,garantia:ed.garantia?['Garantia',ed.garantia]:modelo?.campos?.includes('garantia')?['Garantia','Conforme o Termo de Referência, contada do recebimento definitivo']:null};
 const ordem=[...(modelo?.campos||[]),'validade','prazoEntrega','localEntrega','pagamento','garantia'].filter((k,i,a)=>cond[k]&&a.indexOf(k)===i);
 const banco=sens?.banco||{};
 const linhasBanco=[['Banco',banco.banco],['Agência',banco.agencia],['Conta',banco.conta],['Chave Pix',banco.pix],['Favorecido',banco.favorecido||(banco.conta?empresa.razao_social:'')]].filter(([,v])=>v);
 const razao=empresa.razao_social;
 const declaracoes=modelo?.declaracoes?.length?modelo.declaracoes.map(t=>t.replace(/\b[xX]{3,}\b/g,razao)):declaracoesPadrao(ed);
 return [destinatario(c),{t:'titulo',texto:'PROPOSTA DE PREÇOS'},
  secao('Dados da proponente'),{t:'campos',linhas:proponente},
  ...(processo.objeto?[secao('Objeto'),{t:'texto',texto:processo.objeto}]:[]),
  secao('Itens e preços'),{t:'itens',linhas:r.tabela,textos:r.textos,total:r.total,extenso:r.extenso},
  secao('Condições da proposta'),{t:'campos',linhas:ordem.map(k=>cond[k])},
  secao('Dados bancários'),sens?(linhasBanco.length?{t:'campos',linhas:linhasBanco}:{t:'campos',linhas:[['Banco','____________'],['Agência','________'],['Conta','____________']]}):{t:'texto',texto:BANCO_PREVIA},
  secao('Declarações'),{t:'texto',texto:`${razao} declara, sob as penas da lei, que:`},{t:'lista',itens:declaracoes},
  {t:'assinatura',local:`${doc.localDoEndereco(dados.endereco,pe.uf_sede)}, ${sens?.data||DATA_PREVIA}`,nome:dados.representante,cargo:`${dados.cargo} – ${razao}`,cpf:sens?(sens.cpf||SEM_CPF_PROPOSTA):CPF_PREVIA}];
}
// Exigências do TR em linhas para o quadro de atendimento: ";" e fim de frase separam; frase única longa quebra por vírgula.
function exigenciasDoItem(descricao){
 let partes=String(descricao||'').split(/;|\.\s+(?=[A-ZÀ-Ú0-9])/).map(s=>s.trim().replace(/\.$/,'')).filter(Boolean);
 if(partes.length===1&&partes[0].length>160)partes=partes[0].split(/,\s+/).map(s=>s.trim()).filter(Boolean);
 return partes.slice(0,30);
}
// Ficha técnica / catálogo (estudo PE 467/2025, seção 4.3): um item por página; o texto do TR só entra na coluna "Exigência".
function blocosFicha({empresa,dados,c,extra,r},sens){
 const pe=extra.perfilEmpresa||{},ed=extra.edital||{};
 const licitante=[`${empresa.razao_social} – CNPJ ${cnpjFormatado(empresa.cnpj)}`,dados.endereco,[pe.telefone,pe.email].filter(Boolean).join(' – ')].filter(Boolean).join(' – ');
 const pagina=it=>{let n=0;const secao=t=>({t:'secao',texto:`${++n}. ${t}`});return [
  {t:'titulo',texto:'FICHA TÉCNICA'},
  {t:'linhas',linhas:[`${c.linha} – ${c.orgao}`,`Item ${it.identificador} | Quantidade: ${quantidade(it.quantidade)} ${it.unidade}`,`Licitante: ${licitante}`]},
  secao('Produto ofertado'),{t:'campos',linhas:[['Marca',it.marca||'____________'],['Modelo (como no catálogo)',it.modelo||'____________'],['Fabricante',it.fabricante||'____________'],['Procedência','____________ (nacional / importado)']]},
  secao('Descrição do fabricante'),{t:'texto',texto:'[Cole aqui a descrição do catálogo oficial do fabricante. Não repita o texto do Termo de Referência: ficha igual ao TR pode ser recusada.]'},
  secao('Quadro de atendimento ao Termo de Referência'),{t:'tabela',cabecalho:['Exigência do Termo de Referência','Especificação do produto ofertado','Atende?','Fonte (catálogo, página)'],larguras:[3600,3268,900,1700],linhas:exigenciasDoItem(it.descricaoEdital).map(e=>[e,'','',''])},
  secao('Itens inclusos e opcionais'),{t:'campos',linhas:[['Inclusos no preço','____________'],['Opcionais não ofertados','Nenhum']]},
  secao('Garantia e suporte'),{t:'campos',linhas:[['Garantia',ed.garantia||'Conforme o Termo de Referência, contada do recebimento definitivo'],['Manual em português',ed.manualPortugues?'Sim, entregue com o produto (exigido no edital)':'Sim, entregue com o produto'],['Assistência técnica','____________']]},
  secao('Anexos'),{t:'lista',itens:['Catálogo oficial do fabricante (PDF original)','Carta ou declaração do fabricante ou representante, se houver']},
  {t:'assinatura',local:`${doc.localDoEndereco(dados.endereco,pe.uf_sede)}, ${sens?.data||DATA_PREVIA}`,nome:dados.representante,cargo:`${dados.cargo} – ${empresa.razao_social}`,cpf:null}];};
 const ordenados=[...r.estrutura].sort(ordemItem);
 return ordenados.flatMap((it,k)=>[...(k?[{t:'quebra'}]:[]),...pagina(it)]);
}
function preparar(ctx,body){
 const {empresa,processo,perfil}=ctx;const extra=ctx.extra||{};
 if(!perfil||perfil.invalidado_em)pendente('Confirme a identificação empresarial no cadastro.');
 const dados=perfil.dados_confirmados||{};
 for(const campo of ['endereco','representante','cargo'])texto(dados[campo],campo);
 texto(empresa.razao_social,'razão social');if(!/^\d{14}$/.test(String(empresa.cnpj||'').replace(/\D/g,'')))pendente('Confira o CNPJ no cadastro.');
 texto(processo.numero,'número do edital');texto(processo.orgao,'órgão');
 const fontes=['Identificação empresarial confirmada; confira os dados e o edital.'];
 if(!['declaracao','proposta'].includes(body.tipo))pendente('Selecione o tipo de documento.');
 const c=certame(processo,extra.edital||{}),pe=extra.perfilEmpresa||{};
 const base={titulo:'',emitente:emitente(empresa,dados,pe),rodape:`${empresa.razao_social} · CNPJ ${cnpjFormatado(empresa.cnpj)}`};
 let r,blocos,ficha=null,estrutura=null;
 if(body.tipo==='declaracao'){
  r=declaracao(empresa,processo,dados,body,fontes);
  blocos=sens=>r.blocos(sens,c);
  if(!blocos(null))pendente('Declaração inválida.');
  base.titulo=r.titulo;
 }else{
  r=proposta(ctx,body,fontes);const args={empresa,dados,processo,c,extra,r};
  const modelo=extra.edital?.modelo;fontes.push(`${fonteModelo(modelo)}${modelo?' (campos e declarações seguem o anexo; confira com o original).':'.'}`);
  if(!extra.edital?.localEntrega)fontes.push(SEM_LOCAL);
  blocos=sens=>blocosProposta(args,sens);ficha=sens=>blocosFicha(args,sens);base.titulo=r.titulo;
  estrutura={certame:{...c,objeto:processo.objeto||null},modelo:modelo?{origem:'edital',fonte:fonteModelo(modelo),campos:modelo.campos}:{origem:'licitaplena'},
   condicoes:{validade:r.campos.validade,prazoEntrega:r.campos.prazoEntrega,pagamento:r.campos.pagamento,localEntrega:extra.edital?.localEntrega||null,garantia:extra.edital?.garantia||null},itens:r.estrutura,total:r.total};
 }
 // A prévia sai dos mesmos blocos do arquivo, com rótulos no lugar de CPF, data e banco (LGPD: a prévia fica gravada no rascunho).
 const previa={texto:textoDosBlocos(blocos(null)),fontes};
 texto(previa.texto,'conteúdo final',1000000);
 if(body.tipo==='proposta'&&Buffer.byteLength(previa.texto,'utf8')>LIMITES.previaBytes)pendente('Prévia excede o tamanho suportado. Reduza a seleção sem perder o rascunho.');
 const revisaoHash=createHash('sha256').update(JSON.stringify(canonico({userId:ctx.userId,empresa,processo,perfil,itens:r.itens,campos:r.campos,tipo:body.tipo,previa}))).digest('hex');
 const documento=(sens,qual='principal')=>{const b=qual==='ficha'?ficha?.(sens):blocos(sens);return b?{...base,...(qual==='ficha'?{titulo:'Ficha técnica'}:{}),blocos:b}:null;};
 const nome=(tipo,extensao)=>doc.nomeArquivo({tipo,razaoSocial:empresa.razao_social,numero:processo.numero,modalidade:processo.modalidade,orgao:processo.orgao,extensao});
 return {previa,revisaoHash,titulo:r.titulo,tipo:body.tipo,precisaCpf:Boolean(r.precisaCpf),documento,nome,...(estrutura?{estrutura:{...estrutura,declaracoesEmbutidas:blocos(null).find(b=>b.t==='lista')?.itens||[],avisos:fontes.slice(1)}}:{})};
}
// Texto do arquivo: a prévia com CPF, data e banco lidos na hora; null = a declaração pede CPF e o perfil não tem.
function textoFinal(resultado,cpf,{data=doc.dataPorExtenso(),banco=null}={}){const d=resultado.documento({cpf,data,banco});return d?textoDosBlocos(d.blocos):null;}
// Proposta antiga (formato 1) continua em texto corrido; formato 2, declarações e ficha saem no layout novo.
function docx(resultado,{formato=1,logo=null,sens,qual}={}){
 const d=resultado.documento(sens,qual);if(!d)return null;
 if(resultado.tipo==='proposta'&&formato!==2&&qual!=='ficha')return montarDocx({},{},{texto:textoDosBlocos(d.blocos),preservarLinhas:true,tituloNegrito:true},d.titulo,{logo});
 return docxDosBlocos(d,logo);
}
module.exports={quantidade,valorPorExtenso,uuid,decimal,totalItem,dinheiro,preparar,docx,pendente,textoFinal,CPF_PREVIA,DATA_PREVIA,BANCO_PREVIA,exigenciasDoItem,optanteSimples};
