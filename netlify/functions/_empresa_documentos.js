const {LIMITES}=require('./_empresa_identificacao');
const {extrairDadosEmpresa}=require('../../empresa-documento-leitura.js');
// Servidor: só PDF de até 2 MiB/8 páginas (o plano gratuito da Cloudflare dá 10 ms de CPU por pedido). Documento maior
// volta como "manual" e a tela lê o PDF no navegador (empresa-documento-leitura.js), com as mesmas regras de texto.
async function extrairDocumento(bytes,empresa){
 const manual=aviso=>({modo:'manual',sugestoes:{},evidencias:[],avisos:[aviso]});
 if(bytes.length>LIMITES.extracao)return manual('Arquivo anexado. Preencha manualmente: extração limitada a 2 MiB.');
 if(bytes.subarray(0,5).toString()!=='%PDF-')return manual('Formato sem extração automática. Confira e preencha os dados manualmente.');
 try{
 const {lerPaginasPdf}=require('./_empresa_pdf_leitor');
 const resultado=await lerPaginasPdf(bytes);const {paginas}=resultado;
 if(resultado.numpages>LIMITES.paginas)return manual('Arquivo anexado. Confira manualmente: documento excede 8 páginas.');
 if(!paginas.some(p=>p.texto.trim().length>30))return manual('PDF sem texto legível. Confira o documento e preencha manualmente.');
 const {sugestoes,evidencias,avisos}=extrairDadosEmpresa(paginas,empresa);
 return {modo:'sugestoes',sugestoes,evidencias,avisos:['Sugestões de leitura, sem validação jurídica. Confira todos os campos antes de confirmar.',...avisos]};
 }catch{return manual('Não foi possível extrair texto deste PDF. O anexo foi preservado; preencha manualmente.');}
}
module.exports={extrairDocumento};
