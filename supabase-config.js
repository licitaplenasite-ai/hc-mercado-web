// Configuração do Supabase (autenticação e banco de clientes) — chave "publishable"/"anon",
// segura pra ficar exposta no código do site público (não dá acesso administrativo).
const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb";
// Captcha do login (Cloudflare Turnstile): cole aqui a "Site Key" do painel da Cloudflare, entre as aspas.
// Vazia = captcha desligado e login normal. No localhost a chave de teste entra sozinha (senha-captcha-ui.js).
const TURNSTILE_SITEKEY = "";
// WhatsApp do suporte (botão da Central de ajuda, ajuda-ui.js): só dígitos com DDI 55, ex.: "55" + DDD + número.
// Vazio = botão "WhatsApp (em breve)" desligado. "var" de propósito: vira window.LICITAPLENA_WHATSAPP_SUPORTE.
var LICITAPLENA_WHATSAPP_SUPORTE = "";
