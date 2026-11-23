// Dados que enriquecem a peça do kit sem mudar o select fixo dos itens: perfil (contato, porte, UF), edital já lido
// (dossies_editais: condições, modelo de proposta, SRP, manual) e fabricante dos itens. Leituras com o token do usuário (RLS);
// qualquer falha vira "sem o dado" e o documento sai com o padrão, como antes.
const {condicoesDoEdital,detectarModeloProposta,fonteModelo,limpo}=require('./_kit_modelo_edital');
const opcional=async promessa=>{try{return await promessa;}catch{return null;}};
const SRP=/registro\s+de\s+pre[cç]os|\bSRP\b/i;
// "Garantia" do resumo às vezes é a contratual (caução/seguro): essa não é a do produto.
const GARANTIA_CONTRATUAL=/contratual|cau[cç][aã]o|seguro[\s-]garantia|fian[cç]a|n[aã]o\s+(?:h[aá]|ser[aá]|ser[aã]o|exig)/i;
function editalDoDossie(estrutura,texto,processo){
 const e=estrutura&&typeof estrutura==='object'?estrutura:{};const t=typeof texto==='string'?texto:'';
 const garantia=limpo(e.detalhes?.garantia,300);
 const ident=[processo.objeto,processo.modalidade,e.identificacao?.contratacao,e.identificacao?.modalidade,e.identificacao?.objeto,e.prazos?.tipoFornecimento].filter(v=>typeof v==='string').join(' ');
 return {...condicoesDoEdital(e),garantia:garantia&&!GARANTIA_CONTRATUAL.test(garantia)?garantia:'',
  srp:SRP.test(ident)||SRP.test(t.slice(0,4000)),manualPortugues:/manua(?:l|is)[^.\n]{0,120}portugu/i.test(t),modelo:detectarModeloProposta(t)};
}
async function carregarExtra(c,empresa,processo,comFabricantes=false){
 const filtro=`empresa_id=eq.${empresa.id}&organizacao_id=eq.${empresa.organizacao_id}`;
 // uf_sede veio depois (perfil antigo sem a coluna): tenta sem ela antes de desistir do perfil.
 const perfilEmpresa=(await opcional(c.rest(`operacao_perfil_empresa?${filtro}&select=nome_fantasia,telefone,email,inscricao_estadual,inscricao_municipal,porte,uf_sede`)))?.[0]
  ||(await opcional(c.rest(`operacao_perfil_empresa?${filtro}&select=nome_fantasia,telefone,email,inscricao_estadual,inscricao_municipal,porte`)))?.[0]||{};
 const id=processo.origem_externa_id;
 const dossie=typeof id==='string'&&id?(await opcional(c.rest(`dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(id)}&select=estrutura:dossie->estrutura,texto:dossie->>textoEdital`)))?.[0]:null;
 const fabricantes={};
 if(comFabricantes){
  const linhas=await opcional(c.rest(`operacao_itens_resultado?processo_id=eq.${processo.id}&organizacao_id=eq.${empresa.organizacao_id}&select=id,fabricante&limit=1000`));
  for(const l of Array.isArray(linhas)?linhas:[])if(typeof l?.fabricante==='string'&&l.fabricante.trim())fabricantes[l.id]=l.fabricante.trim();
 }
 return {perfilEmpresa,edital:editalDoDossie(dossie?.estrutura,dossie?.texto,processo),fabricantes};
}
// Banco só para o arquivo exportado (o papel leitura não vê banco; a prévia gravada leva só um rótulo).
async function lerBanco(c,empresa){
 const b=(await opcional(c.rest(`operacao_perfil_empresa?empresa_id=eq.${empresa.id}&organizacao_id=eq.${empresa.organizacao_id}&select=banco`)))?.[0]?.banco;
 if(!b||typeof b!=='object')return null;
 return Object.fromEntries(['banco','agencia','conta','pix','favorecido'].map(k=>[k,typeof b[k]==='string'?b[k].slice(0,120):'']));
}
// O que a tela mostra na consulta: condições sugeridas pelo edital, de onde veio o modelo e o porte (escolhe a declaração ME/EPP).
function condicoesPublicas(extra){
 const e=extra.edital;
 return {propostaEdital:{validade:e.validade,prazoEntrega:e.prazoEntrega,pagamento:e.pagamento,localEntrega:e.localEntrega,garantia:e.garantia,srp:e.srp,
  modelo:e.modelo?{origem:'edital',fonte:fonteModelo(e.modelo),declaracoes:e.modelo.declaracoes.length}:{origem:'licitaplena',fonte:fonteModelo(null)}},porte:extra.perfilEmpresa.porte||null};
}
module.exports={carregarExtra,lerBanco,condicoesPublicas,editalDoDossie};
