// Dados da proposta tirados do edital já lido (dossies_editais): condições do resumo e o anexo "Modelo de Proposta".
// Texto do edital é externo: só vira texto (sem controle, chaves escapadas, teto de tamanho) e o usuário revisa na prévia.
const NAO_INFORMADO=/^\s*(?:n[ãa]o\s+(?:informad|localizad|encontrad|identificad|consta)|nenhum\b|[—-]+\s*$)/i;
const limpo=(v,max=500)=>{
 // eslint-disable-next-line no-control-regex -- texto extraído de PDF
 const t=typeof v==='string'?v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').replace(/\{(?=\{)/g,'{ ').replace(/\}(?=\})/g,'} ').replace(/[ \t]+/g,' ').trim():'';
 if(!t||NAO_INFORMADO.test(t))return '';
 return t.length>max?t.slice(0,max-1).replace(/\s+\S*$/,'')+'…':t;
};
// Condições da proposta no resumo do edital (SCHEMA_ESTRUTURA de lib/ia-edital.js). Vazio quando o edital não diz.
function condicoesDoEdital(estrutura){
 const e=estrutura&&typeof estrutura==='object'?estrutura:{};
 return {validade:limpo(e.criteriosProposta?.validadeProposta),prazoEntrega:limpo(e.detalhes?.prazoEntrega)||limpo(e.entregaExecucao?.prazo),
  pagamento:limpo(e.condicoesPagamento),localEntrega:limpo(e.entregaExecucao?.local)};
}

// Campos que um modelo de proposta costuma pedir; a ordem em que aparecem no anexo vira a ordem das condições.
const CAMPOS=[['validade',/validade/i],['prazoEntrega',/prazo\s+(?:de|para)\s+(?:a\s+)?entrega/i],['pagamento',/pagamento/i],['localEntrega',/(?:local|endere[cç]o)\s+de\s+entrega/i],
 ['banco',/banc[aá]ri|\bbanco\b|ag[eê]ncia|conta\s+corrente/i],['garantia',/prazo\s+de\s+garantia|\bgarantia\b/i],['marca',/\bmarca\b/i],['fabricante',/fabricante/i],
 ['telefone',/\bfone\b|telefone/i],['simples',/optante\s+(?:pelo\s+)?simples|simples\s+nacional/i],['email',/e-?mail/i],['representante',/representante|respons[aá]vel/i],['cpf',/\bcpf\b/i]];
const TITULO=/^[ \t]*(?:ANEXO\b[^\n]{0,60})?["“]?\s*MODELO\s*(?:[-–—]\s*)?(?:D[EA]\s+)?(?:CARTA\s+)?PROPOSTA\b[^\n]{0,60}$/gim;
const FIM=/^[ \t]*ANEXO(?:[ \t]*[-–—]?[ \t]*(?:[IVXLC]+|\d+)\b)/gm;
const DECLARA=/\bdeclar|\bcomprometo|\bcomprometemo|os\s+pre[cç]os\s+propostos|est[aá]\s+de\s+acordo|sob\s+as\s+penas/i;
// Anexo "MODELO DE PROPOSTA" com mais sinais de campos (o índice do edital também cita o anexo, mas sem campos).
// Devolve {documento, pagina, titulo, campos[ordem], declaracoes[texto literal]} ou null.
function detectarModeloProposta(textoEdital){
 const t=typeof textoEdital==='string'?textoEdital:'';if(!t)return null;
 let melhor=null;
 for(const m of t.matchAll(TITULO)){
  if(/;\s*$/.test(m[0]))continue; // linha do índice ("ANEXO II – Modelo de Proposta;")
  const ini=m.index+m[0].length;FIM.lastIndex=ini;const prox=FIM.exec(t);
  const bloco=t.slice(ini,Math.min(prox?prox.index:t.length,ini+15000));
  const achados=CAMPOS.map(([k,re])=>[k,bloco.search(re)]).filter(([,p])=>p>=0).sort((a,b)=>a[1]-b[1]);
  const pontos=achados.length+(/cnpj/i.test(bloco)?1:0);
  if(pontos>=3&&(!melhor||pontos>melhor.pontos))melhor={pontos,pos:m.index,titulo:m[0],bloco,campos:achados.map(([k])=>k)};
 }
 if(!melhor)return null;
 const antes=t.slice(0,melhor.pos);
 const pagina=Number([...antes.matchAll(/^\[Página (\d+)\]\s*$/gm)].pop()?.[1])||null;
 const documento=([...antes.matchAll(/^--- (.+?)(?: \(#\d+\))? ---$/gm)].pop()?.[1]||'Edital').slice(0,120);
 // Do primeiro parágrafo que declara até "Local e data"/linha de assinatura: o bloco de declarações do modelo, na ordem.
 const pars=melhor.bloco.replace(/^\[Página \d+\]\s*$/gm,'').split(/\n[ \t]*\n/).map(p=>limpo(p.replace(/\s*\n\s*/g,' '),1500)).filter(Boolean);
 const ini=pars.findIndex(p=>DECLARA.test(p)&&!/^proposta\s+que\s+faz/i.test(p));
 const declaracoes=[];
 for(const p of ini<0?[]:pars.slice(ini)){
  if(/^(?:local\b|_{3,}|raz[aã]o\s+social|nome\s+do\s+proponente|representante\s+legal)/i.test(p))break;
  // "A empresa X declara, sob as penas da Lei:" só introduz a lista.
  if(p.length>=40&&!/:\s*$/.test(p))declaracoes.push(p);
  if(declaracoes.length>=12)break;
 }
 const anexo=/ANEXO\s*[-–—]?\s*([IVXLC]+|\d+)/i.exec(melhor.titulo)?.[1];
 return {documento,pagina,titulo:limpo(melhor.titulo,120).replace(/^["“]|["”]$/g,''),anexo:anexo?`Anexo ${anexo.toUpperCase()}`:null,campos:melhor.campos,declaracoes};
}
// "Modelo do edital: Anexo II, pág. 12" (o que a tela e as referências mostram).
const fonteModelo=m=>m?`Modelo do edital: ${[m.anexo||m.titulo,m.pagina?`pág. ${m.pagina}`:''].filter(Boolean).join(', ')}`:'Modelo LicitaPlena';
module.exports={condicoesDoEdital,detectarModeloProposta,fonteModelo,limpo};
