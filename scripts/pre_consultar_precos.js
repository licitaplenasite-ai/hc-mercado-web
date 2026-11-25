// Robô diário da pré-consulta da Pesquisa de Preços: de madrugada, consulta no Compras.gov os ~200 termos mais
// buscados no painel e guarda a resposta pronta em cache_consultas_publicas (supabase/cache_consultas_publicas.sql).
// De dia, /api/comprasgov-marcas-produto lê dessa tabela e responde na hora, com a data "Atualizado em".
//
// Por quê: a 1ª consulta de um produto na fonte leva 7-9 s (medido 23/11); depois dela, 0,1-0,6 s.
// Termos: os mais buscados nos últimos DIAS_HISTORICO dias (contagem anônima em buscas_termos: só o termo, nunca
// quem buscou) completados com TERMOS_INICIAIS (materiais e serviços comuns em licitação) e com os termos populares do
// dicionário de sinônimos (netlify/functions/_sinonimos_precos.js: geladeira, tv, micro-ondas, ar-condicionado...) até
// TOTAL_TERMOS. Depois, os TERMOS_POR_UF primeiros de novo com o filtro de cada UF de UFS_PRE_CONSULTA (a tela manda o
// estado à fonte; sem pré-consulta, a 1ª busca filtrada leva 7-9 s).
// Para cada termo: a busca (catálogo + 1 página de cada produto) e as PAGINAS_PRODUTO páginas do produto principal,
// que é exatamente o que a tela abre. A resposta é montada pela própria função (montarCorpo), com a mesma chave.
//
// Uso: node scripts/pre_consultar_precos.js
// Variáveis de ambiente:
//   SUPABASE_SERVICE_ROLE_KEY   -> obrigatória para ler os mais buscados e gravar (exceto com SIMULAR=1)
//   LIMITE_MINUTOS=35           -> orçamento total; para antes e grava o que já fez (cada termo é gravado ao terminar)
//   TOTAL_TERMOS=450            -> quantos termos consultar (sem contar os por UF)
//   UFS_PRE_CONSULTA=""         -> UFs com pré-consulta própria, separadas por vírgula (ex.: "AM,SP"); vazio = só nacional
//   TERMOS_POR_UF=30            -> quantos termos (os primeiros da lista) também são pré-consultados em cada UF
//   DIAS_HISTORICO=30           -> janela dos "mais buscados"
//   PAGINAS_PRODUTO=3           -> páginas do produto principal (a tela abre 3)
//   INTERVALO_MS=2500           -> pausa entre termos (a fonte devolve 429 com rajadas)
//   PAUSA_429_MS=15000          -> base do recuo depois de um 429: 15 s, 30 s, 60 s... (o Retry-After da fonte é o piso)
//   ESPERA_MAX_MS=120000        -> teto do recuo exponencial (o Retry-After pode passar dele: a fonte manda)
//   JITTER=0.3                  -> até +30% sorteado em cada espera, para os termos simultâneos não voltarem juntos
//   TENTATIVAS_429=3            -> novas tentativas do mesmo termo depois de 429 antes de deixá-lo para a próxima execução
//   MAX_BLOQUEIOS=4             -> 429 seguidos (somando todos os termos) que fazem o robô parar cedo
//   MAX_RETOMADAS=3             -> execuções seguidas em que um termo que falhou volta na frente da fila antes de desistir
//   PRAZO_TERMO_MS=40000        -> tempo máximo de um termo (a fonte fria leva até ~10 s por produto)
//   CONCORRENCIA_TERMOS=2       -> termos consultados ao mesmo tempo (cada um já abre ~12 consultas à fonte)
//   RETENCAO_DIAS_CACHE=7      -> respostas mais velhas são apagadas
//   RETENCAO_DIAS_BUSCAS=90     -> contagens mais velhas são apagadas
//   SO_TERMOS="papel a4,toner"  -> teste manual: só estes termos
//   SIMULAR=1                   -> consulta e mede, mas não lê nem grava no banco
// Retomada: termo que falhou (429 ou erro) ou que ficou de fora por tempo/parada cedo vai para dados_robo
// (chave pre_consulta_pendentes, só service_role lê) e entra primeiro na próxima execução.
// Status: o resumo de cada execução vai para dados_robo (chave pre_consulta_status), que a aba "Saúde do sistema" do
// admin mostra (admin_saude_robos em supabase/admin_painel.sql): quando rodou, quantos termos, 429, cobertura, próxima.

const { restFetch, upsertEmLotes, removerMaisAntigosQue, buscarBlob, salvarBlob } = require("./supabase_dados");
const { montarCorpo, chaveDaConsulta, termoParaContagem } = require("../netlify/functions/comprasgov-marcas-produto");
const { termosDoDicionario } = require("../netlify/functions/_sinonimos_precos");

const numero = (nome, padrao) => { const n = Number(process.env[nome]); return Number.isFinite(n) && n >= 0 ? n : padrao; };
const LIMITE_MINUTOS = numero("LIMITE_MINUTOS", 35);
const TOTAL_TERMOS = numero("TOTAL_TERMOS", 450);
const UFS_PRE_CONSULTA = (process.env.UFS_PRE_CONSULTA || "").split(",").map((u) => u.trim().toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u));
const TERMOS_POR_UF = numero("TERMOS_POR_UF", 30);
const CHAVE_STATUS = "pre_consulta_status";
const DIAS_HISTORICO = numero("DIAS_HISTORICO", 30);
const PAGINAS_PRODUTO = numero("PAGINAS_PRODUTO", 3);
const INTERVALO_MS = numero("INTERVALO_MS", 2500);
const PAUSA_429_MS = numero("PAUSA_429_MS", 15000);
const ESPERA_MAX_MS = numero("ESPERA_MAX_MS", 120000);
const JITTER = numero("JITTER", 0.3);
const TENTATIVAS_429 = numero("TENTATIVAS_429", 3);
const MAX_BLOQUEIOS = Math.max(1, numero("MAX_BLOQUEIOS", 4));
const MAX_RETOMADAS = numero("MAX_RETOMADAS", 3);
const CHAVE_PENDENTES = "pre_consulta_pendentes";
const PRAZO_TERMO_MS = numero("PRAZO_TERMO_MS", 40000);
const CONCORRENCIA_TERMOS = Math.max(1, numero("CONCORRENCIA_TERMOS", 2));
const RETENCAO_DIAS_CACHE = numero("RETENCAO_DIAS_CACHE", 7);
const RETENCAO_DIAS_BUSCAS = numero("RETENCAO_DIAS_BUSCAS", 90);

// Lista inicial (enquanto não há histórico de buscas): materiais e serviços comuns em licitação, como a pessoa digita.
const TERMOS_INICIAIS = [
  // Expediente e escritório
  "papel a4", "caneta", "caneta esferografica", "lapis", "borracha", "grampeador", "grampo", "clips", "envelope", "pasta",
  "arquivo morto", "fita adesiva", "cola", "tesoura", "marca texto", "pincel atomico", "corretivo", "caderno", "bloco de notas", "etiqueta",
  "toner", "cartucho", "papel cartao", "post it", "perfurador",
  // Limpeza e higiene
  "detergente", "agua sanitaria", "desinfetante", "sabao em po", "sabonete liquido", "alcool 70", "alcool em gel", "papel higienico", "papel toalha", "saco de lixo",
  "vassoura", "rodo", "pano de chao", "esponja", "luva de borracha", "limpador multiuso", "cera", "lustra moveis", "balde", "dispenser",
  "inseticida", "pa de lixo", "flanela", "hipoclorito", "limpa vidro",
  // Saúde e hospitalar
  "luva de procedimento", "mascara cirurgica", "seringa", "agulha", "gaze", "algodao", "atadura", "esparadrapo", "soro fisiologico", "dipirona",
  "paracetamol", "amoxicilina", "omeprazol", "termometro", "oximetro", "cateter", "equipo", "avental descartavel", "touca descartavel", "fralda geriatrica",
  "glicosimetro", "tira de glicemia", "estetoscopio", "esfigmomanometro", "cadeira de rodas",
  // Informática e tecnologia
  "notebook", "computador", "monitor", "impressora", "mouse", "teclado", "nobreak", "estabilizador", "hd externo", "pen drive",
  "roteador", "switch", "cabo de rede", "projetor", "tablet", "webcam", "headset", "memoria ram", "ssd", "servidor",
  // Alimentação e copa
  "cafe", "acucar", "agua mineral", "leite", "arroz", "feijao", "oleo de soja", "macarrao", "carne bovina", "frango",
  "biscoito", "suco", "achocolatado", "farinha de trigo", "sal", "copo descartavel", "guardanapo", "filtro de papel", "garrafa termica", "genero alimenticio",
  // Obras, manutenção e elétrica
  "cimento", "areia", "brita", "tijolo", "tinta", "tinta acrilica", "massa corrida", "telha", "tubo pvc", "conexao pvc",
  "fio eletrico", "cabo eletrico", "disjuntor", "lampada led", "tomada", "interruptor", "reator", "torneira", "registro", "vaso sanitario",
  "ferramenta", "furadeira", "parafuso", "prego", "madeira",
  // Combustível e veículos
  "gasolina", "oleo diesel", "etanol", "oleo lubrificante", "pneu", "bateria automotiva", "filtro de oleo", "pastilha de freio", "veiculo", "ambulancia",
  "motocicleta", "onibus", "caminhao", "arla 32", "gas de cozinha",
  // Mobiliário e eletrodomésticos
  "cadeira", "cadeira giratoria", "mesa", "armario", "arquivo de aco", "estante", "sofa", "longarina", "ar condicionado", "ventilador",
  "geladeira", "bebedouro", "fogao", "micro ondas", "freezer", "televisor", "colchao", "quadro branco", "cortina", "persiana",
  // EPI e segurança
  "bota de seguranca", "capacete", "oculos de protecao", "protetor auricular", "luva de seguranca", "colete refletivo", "extintor", "uniforme", "camiseta", "jaleco",
  "mascara pff2", "cone de sinalizacao", "fita zebrada", "cinto de seguranca", "protetor solar",
  // Educação, esporte e outros
  "material escolar", "mochila", "livro", "brinquedo", "bola", "kit escolar", "lapis de cor", "giz de cera", "cartolina", "tnt",
  "medalha", "trofeu", "banner", "carimbo", "bandeira",
];

// Lista final: mais buscados primeiro, depois a lista inicial e o dicionário, sem repetir (mesma normalização da contagem).
function escolherTermos(maisBuscados, total = TOTAL_TERMOS) {
  const vistos = new Set();
  const termos = [];
  for (const t of [...maisBuscados, ...TERMOS_INICIAIS, ...termosDoDicionario()]) {
    const n = termoParaContagem(t);
    if (!n || vistos.has(n)) continue;
    vistos.add(n);
    termos.push(n);
    if (termos.length >= total) break;
  }
  return termos;
}

const esperarPadrao = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Alvo do robô: "geladeira" (Brasil) ou "geladeira|AM" (só um estado, como a tela manda com o filtro de UF).
const separarAlvo = (alvo) => { const [termo, uf = ""] = String(alvo).split("|"); return { termo, uf }; };
const consultaDoTermo = (alvo) => ({ ...separarAlvo(alvo), codigoPdm: null, codigoItem: null, pagina: 1, produto: "" });
// Os primeiros "porUf" termos repetidos em cada UF.
const alvosPorUf = (termos, ufs = UFS_PRE_CONSULTA, porUf = TERMOS_POR_UF) => ufs.flatMap((uf) => termos.slice(0, porUf).map((t) => `${t}|${uf}`));
// Um 429 pode vir na busca do catálogo (lança) ou em parte dos produtos (resposta parcial com esperarS).
const esperaDoErro = (e) => (e && e.status === 429 ? Math.max(10, e.esperarS || 0) : null);

// Espera depois do n-ésimo 429 seguido do mesmo termo (n = 1, 2...): recuo exponencial com teto, nunca menos que o
// Retry-After, mais um sorteio de até JITTER (aleatorio() em [0, 1)).
function esperaDepoisDo429(n, retryAfterS, aleatorio = Math.random) {
  const recuo = Math.min(ESPERA_MAX_MS, PAUSA_429_MS * 2 ** Math.max(0, n - 1));
  return Math.round(Math.max(recuo, (retryAfterS || 0) * 1000) * (1 + JITTER * aleatorio()));
}

// Fila da próxima execução: { termo: execuções em que falhou }. Falhou de novo soma 1; não chegou a rodar (tempo, parada
// cedo) mantém a conta; completou sai. Chegou a MAX_RETOMADAS: desiste (a tela consulta ao vivo, como sem robô).
function proximosPendentes(anterior, resumo, max = MAX_RETOMADAS) {
  const fila = {};
  for (const t of resumo.falharam) if ((anterior[t] || 0) + 1 < max) fila[t] = (anterior[t] || 0) + 1;
  for (const t of resumo.naoRodaram) if ((anterior[t] || 0) < max) fila[t] = anterior[t] || 0;
  return fila;
}

// Um termo: a busca e as páginas do produto principal. Devolve { linhas, bloqueadoS } (bloqueadoS = 429 da fonte).
async function consultarTermo(alvo, { montar = montarCorpo, agora = () => new Date() } = {}) {
  const sinal = () => globalThis.AbortSignal.timeout(PRAZO_TERMO_MS);
  const { termo, uf } = separarAlvo(alvo);
  let busca;
  try {
    busca = await montar(consultaDoTermo(alvo), { signal: sinal(), prazoParcialMs: PRAZO_TERMO_MS });
  } catch (e) {
    return { linhas: [], bloqueadoS: esperaDoErro(e), erro: String(e?.message || e) };
  }
  if (busca.parcial) return { linhas: [], bloqueadoS: busca.esperarS || null, erro: "resposta parcial" };
  const linha = (consulta, corpo) => ({ chave: chaveDaConsulta(consulta), fonte: "precos", termo, corpo, atualizado_em: agora().toISOString() });
  const linhas = [linha(consultaDoTermo(alvo), busca.corpo)];
  const principal = JSON.parse(busca.corpo).catalogos?.[0];
  if (!principal) return { linhas, bloqueadoS: null };
  for (let pagina = 1; pagina <= PAGINAS_PRODUTO; pagina += 1) {
    const consulta = { termo, uf, codigoPdm: principal.codigo, codigoItem: null, pagina, produto: principal.descricao };
    try {
      const p = await montar(consulta, { signal: sinal() });
      linhas.push(linha(consulta, p.corpo));
      if (pagina >= (JSON.parse(p.corpo).paginas || 1)) break;
    } catch (e) {
      // A busca já serve a tela; página que falhou a tela pede ao vivo. 429 aqui também conta como bloqueio.
      return { linhas, bloqueadoS: esperaDoErro(e) };
    }
  }
  return { linhas, bloqueadoS: null };
}

// Próxima execução agendada: o cron do workflow (.github/workflows/pre-consultar-precos.yml, "41 5 * * *" = 05:41 UTC).
// O GitHub atrasa crons em horário cheio de fila (24/11 rodou às 16:19 UTC), então é "a partir de".
const HORA_CRON_UTC = [5, 41];
function proximaExecucao(agora = new Date()) {
  const p = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), ...HORA_CRON_UTC));
  if (p <= agora) p.setUTCDate(p.getUTCDate() + 1);
  return p.toISOString();
}

// O que a aba "Saúde do sistema" mostra do robô. Só termos de produto (dado público), nunca quem buscou.
function statusDaExecucao(resumo, fila, agora = new Date()) {
  return {
    em: agora.toISOString(), proxima: proximaExecucao(agora), minutos: resumo.minutos,
    consultas: resumo.termos, completos: resumo.completos, ufs: UFS_PRE_CONSULTA, falhas: resumo.falhas, bloqueios429: resumo.bloqueios,
    parouCedo: resumo.parouCedo, naoRodaram: resumo.naoRodaram.length, paraProxima: Object.keys(fila).length,
    megabytes: Math.round(resumo.bytes / 10485.76) / 100, falharam: resumo.falharam.slice(0, 20),
  };
}

async function lerMaisBuscados() {
  const r = await restFetch("rpc/termos_mais_buscados", { method: "POST", body: JSON.stringify({ p_fonte: "precos", p_dias: DIAS_HISTORICO, p_limite: TOTAL_TERMOS }) });
  return (await r.json()).map((l) => l.termo);
}

// deps injetáveis para o teste (sem rede nem banco).
// Medido 24/11 (fonte fria): ~17 s por termo um por vez, 200 termos passariam de 55 min. CONCORRENCIA_TERMOS termos
// andam juntos (2 = ~30 min). Um 429 em qualquer termo pausa todos (pausaAte): a fonte limita por origem, não por termo.
async function executar({ termos, montar, gravar, esperar = esperarPadrao, relogio = Date.now, limiteMs = LIMITE_MINUTOS * 60000, log = console.log,
  concorrencia = CONCORRENCIA_TERMOS, aleatorio = Math.random } = {}) {
  const inicio = relogio();
  const resumo = { termos: termos.length, completos: 0, linhas: 0, bytes: 0, falhas: 0, bloqueios: 0, parouCedo: null, falharam: [], naoRodaram: [] };
  let seguidos = 0, proximo = 0, pausaAte = 0;
  const aguardarPausa = async () => { const resta = pausaAte - relogio(); if (resta > 0) await esperar(resta); };
  const trabalhador = async () => {
    while (proximo < termos.length && !resumo.parouCedo) {
      if (relogio() - inicio > limiteMs) { resumo.parouCedo = "tempo"; break; }
      const termo = termos[proximo++];
      await aguardarPausa();
      let r = await consultarTermo(termo, { montar });
      for (let n = 1; r.bloqueadoS && !resumo.parouCedo; n += 1) {
        resumo.bloqueios += 1;
        seguidos += 1;
        if (seguidos >= MAX_BLOQUEIOS) { resumo.parouCedo = "429"; log(`[pre-consulta] ${seguidos} bloqueios (429) seguidos: parando para não insistir.`); break; }
        if (n > TENTATIVAS_429) break;
        const ms = esperaDepoisDo429(n, r.bloqueadoS, aleatorio);
        pausaAte = Math.max(pausaAte, relogio() + ms);
        log(`[pre-consulta] 429 em "${termo}" (tentativa ${n}/${TENTATIVAS_429}): pausa de ${Math.round(ms / 1000)} s.`);
        await aguardarPausa();
        r = await consultarTermo(termo, { montar });
      }
      if (!r.bloqueadoS) seguidos = 0;
      if (r.linhas.length) {
        await gravar(r.linhas);
        resumo.completos += 1;
        resumo.linhas += r.linhas.length;
        resumo.bytes += r.linhas.reduce((soma, l) => soma + l.corpo.length, 0);
      } else {
        resumo.falhas += 1;
        resumo.falharam.push(termo);
      }
      if (proximo < termos.length) await esperar(INTERVALO_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, termos.length)) }, trabalhador));
  resumo.naoRodaram = termos.slice(proximo);
  resumo.minutos = Math.round(((relogio() - inicio) / 60000) * 10) / 10;
  return resumo;
}

async function main() {
  const simular = process.env.SIMULAR === "1";
  const soTermos = (process.env.SO_TERMOS || "").split(",").map((t) => t.trim()).filter(Boolean);
  const manual = soTermos.length > 0 || simular;
  const maisBuscados = manual ? [] : await lerMaisBuscados();
  // Teste manual (SO_TERMOS/SIMULAR) não lê nem mexe na fila de retomada.
  const anterior = manual ? {} : (await buscarBlob("dados_robo", CHAVE_PENDENTES))?.termos || {};
  const pendentes = Object.keys(anterior);
  // Pendente com UF ("geladeira|AM") volta como está; o termo nacional passa pela normalização de sempre.
  const pendentesUf = pendentes.filter((p) => p.includes("|"));
  const nacionais = soTermos.length ? escolherTermos(soTermos, soTermos.length) : escolherTermos([...pendentes.filter((p) => !p.includes("|")), ...maisBuscados]);
  const termos = [...new Set([...nacionais, ...pendentesUf, ...(soTermos.length ? [] : alvosPorUf(nacionais))])];
  console.log(`[pre-consulta] ${termos.length} consulta(s): ${pendentes.length} retomada(s) da execução anterior, ${maisBuscados.length} do histórico de buscas, ${termos.length - nacionais.length} por UF (${UFS_PRE_CONSULTA.join(", ") || "nenhuma"}), o resto da lista inicial e do dicionário.`);
  const resumo = await executar({ termos, montar: montarCorpo, gravar: simular ? async () => {} : (linhas) => upsertEmLotes("cache_consultas_publicas", linhas, "chave", 10) });
  const fila = proximosPendentes(anterior, resumo);
  if (!manual) {
    await salvarBlob("dados_robo", CHAVE_PENDENTES, { termos: fila, em: new Date().toISOString() });
    await salvarBlob("dados_robo", CHAVE_STATUS, statusDaExecucao(resumo, fila));
  }
  if (!simular) {
    const dia = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
    await removerMaisAntigosQue("cache_consultas_publicas", "atualizado_em", dia(RETENCAO_DIAS_CACHE));
    await removerMaisAntigosQue("buscas_termos", "dia", dia(RETENCAO_DIAS_BUSCAS).slice(0, 10));
  }
  const { falharam, naoRodaram, ...contagem } = resumo;
  console.log(`[pre-consulta] ${JSON.stringify({ ...contagem, megabytes: Math.round(resumo.bytes / 10485.76) / 100, naoRodaram: naoRodaram.length, paraProxima: Object.keys(fila).length })}`);
  if (falharam.length) console.log(`[pre-consulta] falharam (${falharam.length}): ${falharam.slice(0, 30).join(", ")}${falharam.length > 30 ? "..." : ""}`);
  // Parar cedo por 429 não é falha do robô (a fonte pediu calma); nenhum termo completo, sim.
  if (!resumo.completos && termos.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { console.error(`[pre-consulta] ${String(e?.message || e)}`); process.exitCode = 1; });
}

module.exports = { escolherTermos, consultarTermo, executar, esperaDepoisDo429, proximosPendentes, alvosPorUf, proximaExecucao, statusDaExecucao, TERMOS_INICIAIS };
