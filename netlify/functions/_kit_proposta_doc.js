// Documento profissional do kit (proposta e declarações): blocos -> texto da prévia (entra no revisaoHash) e DOCX A4.
// O mesmo array de blocos vai para o navegador gerar o PDF (documento-pdf.js), então prévia, Word e PDF têm o mesmo conteúdo.
// Blocos: {t:'linhas',linhas,alinhar} {t:'titulo',texto} {t:'secao',texto} {t:'texto',texto} {t:'campos',linhas:[[rótulo,valor]]}
// {t:'itens',linhas,total,extenso} {t:'lista',itens} {t:'assinatura',local,nome,cargo,cpf} {t:'quebra'}.
const AdmZip=require('adm-zip');
const {UFS}=require('./_empresa_identificacao');

const xml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// PNCP grava "012/2026" em numeroCompra e o painel ainda soma o ano: "012/2026/2026". Corrige na leitura (dado antigo também).
const numeroEdital=n=>String(n??'').trim().replace(/(\/\d{4})(?:\s*\1)+$/,'$1');
const MODALIDADES=[[/preg[aã]o/i,/eletr/i,'Pregão Eletrônico'],[/preg[aã]o/i,/presencial/i,'Pregão Presencial'],[/concorr/i,/eletr/i,'Concorrência Eletrônica'],[/concorr/i,null,'Concorrência'],[/dispensa/i,null,'Dispensa de Licitação'],[/inexig/i,null,'Inexigibilidade']];
function modalidadeTexto(m){
 const t=String(m||'');for(const [a,b,nome] of MODALIDADES)if(a.test(t)&&(!b||b.test(t)))return nome;
 // Sem modalidade gravada o kit só é usado em pregão eletrônico na prática; o usuário corrige no Word se for outro.
 return t.trim()||'Pregão Eletrônico';
}
const PEQUENAS=new Set(['de','do','da','dos','das','e','a','o','em']); // sem 'para': PARA é o estado em nomes de órgão
const tituloCaso=t=>t.toLowerCase().split(/\s+/).map((p,i)=>i&&PEQUENAS.has(p)?p:p.charAt(0).toUpperCase()+p.slice(1)).join(' ');
// Nome curto do órgão para o arquivo: sigla entre parênteses ou depois de " - "; senão as primeiras palavras.
function orgaoCurto(orgao){
 const t=String(orgao||'').replace(/\s+/g,' ').trim();if(!t)return '';
 const sigla=/\(([A-Z][A-Z0-9-]{1,14})\)|\s[-–]\s([A-Z][A-Z0-9-]{1,14})$/.exec(t);if(sigla)return sigla[1]||sigla[2];
 let curto='';for(const p of tituloCaso(t).split(' ')){if((curto+' '+p).trim().length>40)break;curto=(curto+' '+p).trim();}
 return curto;
}
// eslint-disable-next-line no-control-regex -- nome de arquivo não pode ter caractere de controle
const seguroArquivo=t=>String(t).replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,' ').trim();
// "Proposta - HCM LTDA - Pregão 012-2026 - Assembleia Legislativa do Estado do Para.docx"
function nomeArquivo({tipo='Proposta',razaoSocial,numero,modalidade,orgao,extensao='docx'}){
 const mod=modalidadeTexto(modalidade).split(' ')[0];
 const partes=[tipo,razaoSocial,numero?`${mod} ${numeroEdital(numero).replace(/\//g,'-')}`:'',orgaoCurto(orgao)].map(seguroArquivo).filter(Boolean);
 return `${partes.join(' - ').slice(0,150)}.${extensao}`;
}
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function dataPorExtenso(d=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(d).map(x=>[x.type,x.value]));
 return `${Number(p.day)} de ${MESES[Number(p.month)-1]} de ${p.year}`;
}
// "Av. X, 10, Centro, Belém/PA, CEP 66000-000" -> "Belém/PA". Sem cidade reconhecível: lacuna para escrever à mão.
function localDoEndereco(endereco,ufSede){
 const t=String(endereco||'');
 const achados=[...t.matchAll(/(?:^|[,–-]\s*)([\p{L}][\p{L}' .]{1,40}?)\s*[/–-]\s*([A-Z]{2})(?=\s*(?:$|[,.;)]|\s*[–-]?\s*(?:CEP|\d{2}\.?\d{3}-?\d{3})))/gu)].filter(m=>UFS.includes(m[2]));
 const m=achados.at(-1);if(m)return `${m[1].trim()}/${m[2]}`;
 return `____________________${UFS.includes(ufSede)?'/'+ufSede:''}`;
}

// ---- Texto da prévia ----
function textoDosBlocos(blocos){
 return blocos.map(b=>{
  switch(b.t){
   case 'linhas':return b.linhas.join('\n');
   case 'titulo':case 'secao':case 'texto':return b.texto;
   case 'campos':return b.linhas.map(([r,v])=>`${r}: ${v}`).join('\n');
   case 'lista':return b.itens.map(i=>`- ${i}`).join('\n');
   case 'tabela':return [b.cabecalho,...b.linhas].map(l=>l.join(' | ')).join('\n');
   // Mesmo texto por item da proposta em texto corrido (formato 1), para a prévia ler igual nos dois formatos.
   case 'itens':return [...b.textos,`Total da proposta: R$ ${b.total} (${b.extenso})`].join('\n\n');
   case 'assinatura':return `${b.local}\n\n\n______________________________\n${b.nome}\n${b.cargo}${b.cpf?`\nCPF: ${b.cpf}`:''}`;
   case 'quebra':return '';
   default:throw new Error('Bloco desconhecido.');
  }
 }).join('\n\n');
}

// ---- DOCX ----
const LARGURA=9468; // A4 (11906) menos margens de 1304 + 1134 twips
const COR='17243A',COR_SUAVE='5B6B80',COR_FAIXA='1F3A5F',COR_LINHA='C9D3DF';
function run(texto,{negrito=false,tamanho=21,cor=COR,italico=false}={}){
 const pr=`<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${negrito?'<w:b/>':''}${italico?'<w:i/>':''}<w:color w:val="${cor}"/><w:sz w:val="${tamanho}"/></w:rPr>`;
 return String(texto).split('\n').map((l,i)=>`<w:r>${pr}${i?'<w:br/>':''}<w:t xml:space="preserve">${xml(l)}</w:t></w:r>`).join('');
}
function par(texto,{alinhar='left',antes=0,depois=120,keep=false,borda=false,...r}={}){
 const jc={left:'left',center:'center',right:'right',justificar:'both'}[alinhar];
 return `<w:p><w:pPr>${keep?'<w:keepNext/>':''}${borda?`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${COR_FAIXA}"/></w:pBdr>`:''}<w:spacing w:before="${antes}" w:after="${depois}" w:line="276" w:lineRule="auto"/><w:jc w:val="${jc}"/></w:pPr>${run(texto,r)}</w:p>`;
}
const bordas=(cor,int=true)=>`<w:tblBorders>${['top','left','bottom','right',...(int?['insideH','insideV']:[])].map(l=>`<w:${l} w:val="single" w:sz="4" w:color="${cor}"/>`).join('')}</w:tblBorders>`;
function celula(conteudo,largura,{fundo,span}={}){return `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>${span?`<w:gridSpan w:val="${span}"/>`:''}${fundo?`<w:shd w:val="clear" w:color="auto" w:fill="${fundo}"/>`:''}<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tcMar></w:tcPr>${conteudo}</w:tc>`;}
const tabela=(larguras,linhas,borda)=>`<w:tbl><w:tblPr><w:tblW w:w="${LARGURA}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borda}<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${larguras.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${linhas}</w:tbl>`;
// Unid. larga o bastante para "UNIDADE" sem quebrar; mesma proporção em documento-pdf.js (COLUNAS_ITENS).
const COLUNAS=[['Item',700,'left'],['Descrição',3288,'left'],['Qtd.',700,'right'],['Unid.',1000,'left'],['Marca / modelo',1560,'left'],['Unitário (R$)',1110,'right'],['Total (R$)',1110,'right']];
function tabelaItens(b){
 const cab=`<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${COLUNAS.map(([n,w,a])=>celula(par(n,{alinhar:a,depois:0,negrito:true,tamanho:17,cor:'FFFFFF'}),w,{fundo:COR_FAIXA})).join('')}</w:tr>`;
 const linhas=b.linhas.map((l,k)=>`<w:tr><w:trPr><w:cantSplit/></w:trPr>${l.map((v,i)=>celula(par(v,{alinhar:COLUNAS[i][2],depois:0,tamanho:17}),COLUNAS[i][1],{fundo:k%2?'F4F7FA':null})).join('')}</w:tr>`).join('');
 const total=`<w:tr><w:trPr><w:cantSplit/></w:trPr>${celula(par('Valor total da proposta',{alinhar:'right',depois:0,negrito:true,tamanho:18}),LARGURA-1110,{span:6,fundo:'EEF3F8'})}${celula(par(b.total,{alinhar:'right',depois:0,negrito:true,tamanho:18}),1110,{fundo:'EEF3F8'})}</w:tr>`;
 return tabela(COLUNAS.map(c=>c[1]),cab+linhas+total,bordas(COR_LINHA))+par(`Valor total por extenso: ${b.extenso}.`,{antes:120,depois:200,italico:true});
}
function tabelaCampos(linhas){
 const w=[2900,LARGURA-2900];
 return tabela(w,linhas.map(([r,v])=>`<w:tr><w:trPr><w:cantSplit/></w:trPr>${celula(par(r,{depois:0,negrito:true,tamanho:19,cor:COR_SUAVE}),w[0],{fundo:'F4F7FA'})}${celula(par(v,{depois:0,tamanho:19}),w[1])}</w:tr>`).join(''),bordas(COR_LINHA))+par('',{depois:80});
}
function corpo(blocos){
 return blocos.map(b=>{
  switch(b.t){
   case 'linhas':return par(b.linhas.join('\n'),{alinhar:b.alinhar||'left',depois:200,negrito:b.negrito,tamanho:b.tamanho||21});
   case 'titulo':return par(b.texto,{alinhar:'center',antes:120,depois:240,negrito:true,tamanho:28,cor:COR_FAIXA});
   case 'secao':return par(b.texto,{antes:200,depois:100,negrito:true,tamanho:22,cor:COR_FAIXA,keep:true,borda:true});
   case 'texto':return b.texto.split(/\n{2,}/).map(t=>/^_{5,}/.test(t)?par(t,{alinhar:'center',antes:240}):par(t,{alinhar:'justificar'})).join('');
   case 'campos':return tabelaCampos(b.linhas);
   case 'tabela':return tabela(b.larguras,`<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${b.cabecalho.map((n,i)=>celula(par(n,{depois:0,negrito:true,tamanho:17,cor:'FFFFFF'}),b.larguras[i],{fundo:COR_FAIXA})).join('')}</w:tr>${b.linhas.map(l=>`<w:tr><w:trPr><w:cantSplit/></w:trPr>${l.map((v,i)=>celula(par(v,{depois:0,tamanho:17}),b.larguras[i])).join('')}</w:tr>`).join('')}`,bordas(COR_LINHA))+par('',{depois:80});
   case 'lista':return b.itens.map(i=>par(`•  ${i}`,{alinhar:'justificar',depois:80})).join('');
   case 'itens':return tabelaItens(b);
   case 'assinatura':return par(b.local,{alinhar:'right',antes:240,depois:720})+par('______________________________________',{alinhar:'center',depois:0,keep:true})+par(b.nome,{alinhar:'center',depois:0,negrito:true,keep:true})+par(b.cargo+(b.cpf?`\nCPF: ${b.cpf}`:''),{alinhar:'center',depois:120});
   case 'quebra':return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
   default:throw new Error('Bloco desconhecido.');
  }
 }).join('');
}
// Logo escalada para caber em 4,5 x 1,8 cm sem distorcer.
function imagemLogo(logo){
 const e=Math.min(1620000/logo.largura,648000/logo.altura),cx=Math.max(1,Math.round(logo.largura*e)),cy=Math.max(1,Math.round(logo.altura*e));
 return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
const NS='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
// Cabeçalho: logo à esquerda, dados da empresa à direita, linha embaixo. Sem logo, só os dados.
function cabecalho(emitente,logo){
 const dados=par(`${emitente.nome}\n${emitente.linhas.join('\n')}`,{alinhar:'right',depois:0,tamanho:16,cor:COR_SUAVE});
 const w=[3000,LARGURA-3000];
 const t=tabela(w,`<w:tr>${celula(logo?`<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${imagemLogo(logo)}</w:p>`:par('',{depois:0}),w[0])}${celula(dados,w[1])}</w:tr>`,'<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>');
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${t}${par('',{depois:120,borda:true,tamanho:4})}</w:hdr>`;
}
const campo=(instr,tamanho)=>`<w:r><w:rPr><w:sz w:val="${tamanho}"/><w:color w:val="${COR_SUAVE}"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="${tamanho}"/></w:rPr><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:rPr><w:sz w:val="${tamanho}"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="${tamanho}"/><w:color w:val="${COR_SUAVE}"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="${tamanho}"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;
function rodape(texto){
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="${COR_LINHA}"/></w:pBdr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr>${run(`${texto}  ·  Página `,{tamanho:15,cor:COR_SUAVE})}${campo('PAGE',15)}${run(' de ',{tamanho:15,cor:COR_SUAVE})}${campo('NUMPAGES',15)}</w:p></w:ftr>`;
}
// documento: {titulo, blocos, emitente:{nome,linhas}, rodape}; logo opcional {bytes,tipo,largura,altura} já validada.
function docxDosBlocos(documento,logo=null){
 const zip=new AdmZip(),ext=logo?.tipo==='image/png'?'png':'jpeg';
 const add=(n,c)=>zip.addFile(n,Buffer.isBuffer(c)?c:Buffer.from(c));
 add('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logo?`<Default Extension="${ext}" ContentType="image/${ext}"/>`:''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
 add('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
 add('word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>');
 add('word/header1.xml',cabecalho(documento.emitente,logo));
 if(logo){add('word/_rels/header1.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.${ext}"/></Relationships>`);add(`word/media/logo.${ext}`,logo.bytes);}
 add('word/footer1.xml',rodape(documento.rodape));
 add('word/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="21"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`);
 // compatibilityMode 15: sem ele o Word abre em "Modo de Compatibilidade" (auditoria Word 16, 20/11). updateFields: total de páginas certo ao abrir.
 add('word/settings.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>');
 add('docProps/core.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(documento.titulo)}</dc:title><dc:creator>${xml(documento.emitente.nome)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`);
 add('docProps/app.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>LicitaPlena</Application></Properties>');
 add('word/document.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${corpo(documento.blocos)}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1304" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
 return zip.toBuffer();
}

// Texto livre (declaração) em blocos: 1º parágrafo é o título; linha de assinatura ("_____") fica centralizada.
function blocosDeTexto(texto){
 const [titulo,...resto]=String(texto).split(/\n{2,}/);
 return [{t:'titulo',texto:titulo.trim()},...(resto.length?[{t:'texto',texto:resto.join('\n\n')}]:[])];
}
module.exports={numeroEdital,modalidadeTexto,orgaoCurto,nomeArquivo,dataPorExtenso,localDoEndereco,textoDosBlocos,docxDosBlocos,blocosDeTexto};
