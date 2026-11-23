// Configuração do Supabase (autenticação e banco de clientes) — chave "publishable"/"anon",
// segura pra ficar exposta no código do site público (não dá acesso administrativo).
const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";
// Captcha do login (Cloudflare Turnstile): cole aqui a "Site Key" do painel da Cloudflare, entre as aspas.
// Vazia = captcha desligado e login normal. No localhost a chave de teste entra sozinha (senha-captcha-ui.js).
const TURNSTILE_SITEKEY = "0x4AAAAAAGOHw4eqvTE4OuHB";
// WhatsApp do suporte: TROCAR pelo número de suporte (botão da Central de ajuda, ajuda-ui.js): só dígitos com DDI 55, ex.: "55" + DDD + número.
// Vazio = botão "WhatsApp (em breve)" desligado. "var" de propósito: vira window.LICITAPLENA_WHATSAPP_SUPORTE.
var LICITAPLENA_WHATSAPP_SUPORTE = "5592981937781"; // mesmo número da HC/HCM (decisão do dono, 22/11)
// HC Licitações (parceira, página hc.html e chamadas "Fale com a HC"): TROCAR pelo número e site da HC. Vazio = botões somem.
// WhatsApp: só dígitos com DDI 55. Site: endereço completo começando com https://.
var LICITAPLENA_HC_WHATSAPP = "5592981937781";
var LICITAPLENA_HC_SITE = "https://www.hclicitacoes.com";
// Pagamento manual por Pix (assinar.html, tela "Como pagar"): TROCAR pela chave Pix, nome e cidade do recebedor (como
// aparecem no banco) e pelo WhatsApp que recebe o comprovante (só dígitos com DDI 55). Vazio = a tela diz "Fale com a
// equipe" e não mostra chave nem código. Nada daqui sai do navegador: o código Pix é montado na própria tela.
var LICITAPLENA_PIX_CHAVE = "28786260000153";
var LICITAPLENA_PIX_NOME = "HCM LTDA";
var LICITAPLENA_PIX_CIDADE = "MANAUS";
var LICITAPLENA_WHATSAPP_PAGAMENTO = "5592981937781";
