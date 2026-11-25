// Robô dos diários oficiais do Amazonas: lê o Diário dos Municípios (AAM), o DOM Manaus e o DOE-AM, acha os avisos
// de licitação/dispensa/chamamento e grava na mesma tabela que o painel ("Encontrar licitações", edições do boletim)
// e o boletim por e-mail já leem: oportunidades_abertas, chave "fonte:diario-<diário>:<publicação>", no mesmo formato
// do robô de fontes fora do PNCP (scripts/fontes/comum.js#paraLinha), com o selo do diário em dado.fonte.
//
// Por que existe: município com até 20 mil habitantes pode publicar só em diário oficial até 01/04/2027
// (Lei 14.133, art. 176, parágrafo único), e todo edital ganha extrato em diário (art. 54, §1º).
//
// Como decide: o título classifica (scripts/fontes/diario_extracao.js); regras tiram objeto, número, abertura, valor e
// links; a IA (Gemini) só entra quando a regra não achou objeto, número ou data. Sem objeto mesmo depois da IA, a
// publicação vai para a fila de revisão (dados_robo "diarios_am_revisao") em vez do painel.
// Dedup: o que já está no PNCP (mesmo município + número/ano, ou mesmo objeto com abertura a até 2 dias) não entra;
// o que entrou e depois apareceu no PNCP sai daqui (o PNCP é mais completo). Tudo que fica tem
// dado.vistoPrimeiroNoDiario = true: o PNCP ainda não tinha o aviso quando o diário foi lido.
// Homologação/resultado publicado no diário tira o aviso correspondente do painel.
// Incremental: edição (DOE), caderno (DOM) e matéria (AAM) já lidos ficam em dados_robo "diarios_am_lidos".
//
// Uso: node scripts/coletar_diarios_am.js
//      SIMULAR=1 node scripts/coletar_diarios_am.js   (consulta os diários e só imprime; não grava nada)
// Variáveis de ambiente:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória fora do SIMULAR (no SIMULAR, se existir, só é usada para LER o PNCP no dedup)
//   GEMINI_API_KEY             opcional; sem ela só as regras extraem (o resto vai para a fila de revisão)
//   GEMINI_MODELO=gemini-3.8-flash  modelo principal (reserva: gemini-3.7-flash, como em gerar_dossies_gemini.js)
//   DIARIOS=diario-aam,diario-dom-manaus,diario-doe-am  diários a rodar (padrão: todos)
//   DIAS_DIARIO=               janela de leitura em dias (padrão por diário: AAM 3, DOM 7, DOE 7; o DOE publica atrasado)
//   LIMITE_MINUTOS=12          orçamento de tempo do robô inteiro
//   INTERVALO_MS=1000          intervalo mínimo entre pedidos ao mesmo diário (nunca abaixo de 1000)
//   MAX_IA=40                  chamadas de IA por rodada
//   RETENCAO_DIAS=90           publicação mais velha que isso sai da tabela (aviso sem data de abertura)
const { criarCliente, paraLinha, chaveFonte } = require("./fontes/comum");
const ext = require("./fontes/diario_extracao");

const DIARIOS = {
  "diario-aam": { modulo: require("./fontes/diario_aam"), dias: 3, semPublicacaoEhFalha: true },
  // O servidor do DOM derruba a conexão com frequência (ECONNRESET, visto em 25/11/2026): mais tentativas.
  "diario-dom-manaus": { modulo: require("./fontes/dom_manaus"), dias: 7, semPublicacaoEhFalha: false, tentativas: 6 },
  "diario-doe-am": { modulo: require("./fontes/doe_am"), dias: 7, semPublicacaoEhFalha: false },
};

const SIMULAR = process.env.SIMULAR === "1";
const LIMITE_MINUTOS = Number(process.env.LIMITE_MINUTOS || 12);
const INTERVALO_MS = Math.max(1000, Number(process.env.INTERVALO_MS || 1000));
const MAX_IA = Number(process.env.MAX_IA || 40);
const RETENCAO_DIAS = Number(process.env.RETENCAO_DIAS || 90);
const MODELOS_IA = [...new Set([process.env.GEMINI_MODELO || "gemini-3.8-flash", "gemini-3.7-flash"])];
const TABELA = "oportunidades_abertas";
const BLOB_LIDOS = "diarios_am_lidos";
const BLOB_REVISAO = "diarios_am_revisao";
const BLOB_STATUS = "diarios_am_status";
const PREFIXO_DIARIOS = "fonte:diario-";
const DIAS_GUARDAR_LIDOS = 20;
const MAX_REVISAO = 300;

const inicioExecucao = Date.now();
const tempoRestanteMs = () => LIMITE_MINUTOS * 60000 - (Date.now() - inicioExecucao);
const hojeIso = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10); // Manaus = UTC-4
const diasAtras = (n) => new Date(Date.parse(hojeIso()) - n * 86400000).toISOString().slice(0, 10);

// ---------- Publicação -> item ----------

// Regras e, se faltou campo essencial, a IA. ia: { apiKey, restantes, uso } (mutável de propósito: orçamento da rodada).
async function extrair(pub, ia) {
  const regras = ext.extrairPorRegras(pub);
  let campos = { ...regras, extraidoPor: "regras" };
  if (regras.confianca !== "alta" && ia.apiKey && ia.restantes > 0 && tempoRestanteMs() > 60000) {
    ia.restantes -= 1;
    try {
      const r = await ext.chamarIa({ texto: pub.texto, publicacao: pub.publicacao, apiKey: ia.apiKey, modelos: MODELOS_IA, fetchImpl: ia.fetchImpl });
      somarUso(ia.uso, r && r.uso);
      const v = r && ext.validarSaidaIa(r.saida, pub.texto, pub.publicacao);
      if (v && v.ehOportunidade === false && !regras.objeto) return { ...campos, descartadoPelaIa: true };
      if (v) campos = completarComIa(campos, v);
    } catch (e) {
      console.log(`[diarios] IA falhou em ${pub.idExterno} (${e.message}); fica com as regras.`);
    }
  }
  return campos;
}

// Tokens de raciocínio contam como saída: o Google cobra os dois como saída.
function somarUso(uso, meta) {
  uso.chamadas += 1;
  if (!meta) return;
  uso.entrada += meta.promptTokenCount || 0;
  uso.saida += (meta.candidatesTokenCount || 0) + (meta.thoughtsTokenCount || 0);
}

// A regra vence onde achou; a IA só completa o que faltou.
function completarComIa(campos, v) {
  const completo = { ...campos };
  for (const k of ["objeto", "abertura", "numero", "ano", "modalidade", "valorEstimado", "linkEdital"]) if (!completo[k] && v[k]) completo[k] = v[k];
  if (!completo.urlDisputa && v.localDisputa && /\.(com|gov|org|net)\b/i.test(v.localDisputa)) completo.urlDisputa = v.localDisputa;
  return { ...completo, extraidoPor: "regras+ia", confianca: ext.avaliarConfianca(completo) };
}

function montarLinha(fonte, pub, campos) {
  const processo = campos.numero ? `${campos.modalidade || "Processo"} nº ${campos.numero}/${campos.ano}` : null;
  const item = {
    idExterno: pub.idExterno, objeto: campos.objeto, aberto: true,
    orgao: { nome: pub.orgao.nome, uf: "AM", municipio: pub.orgao.municipio || "", cnpj: null },
    encerramento: campos.abertura, publicacao: pub.publicacao ? `${pub.publicacao}T00:00:00` : null,
    modalidade: campos.modalidade || ({ dispensa: "Dispensa", cotacao: "Cotação eletrônica", chamamento: "Chamamento público", credenciamento: "Credenciamento" }[campos.tipo] || null),
    numero: campos.numero, ano: campos.ano, processo,
    srp: /\bSRP\b|registro\s+de\s+pre[cç]os/i.test(`${pub.titulo} ${campos.objeto}`),
    linkOficial: pub.linkOficial,
  };
  const linha = paraLinha(fonte, item);
  // O link principal é a publicação no diário (sempre existe e é oficial); o edital/portal citado vai à parte.
  const dado = {
    ...linha.dado,
    fonte: fonte.rotulo,
    esferaId: pub.orgao.esfera,
    situacaoCompraNome: "Publicada no Diário Oficial",
    usuarioNome: fonte.portal,
    link: pub.linkOficial,
    linkSistemaOrigem: campos.urlDisputa || pub.linkOficial,
    linkEdital: campos.linkEdital || null,
    urlDisputa: campos.urlDisputa || null,
    linkEdicao: pub.linkEdicao || null,
    edicaoDiario: pub.edicao || null,
    paginaDiario: pub.pagina || null,
    tituloPublicacao: pub.titulo,
    tipoAviso: campos.tipo,
    valorTotalEstimado: campos.valorEstimado || null,
    confiancaExtracao: campos.confianca,
    extraidoPor: campos.extraidoPor,
    vistoPrimeiroNoDiario: true,
    vistoNoDiarioEm: hojeIso(),
  };
  return { ...linha, dado };
}

// ---------- Banco (leitura para dedup; escrita só fora do SIMULAR) ----------

async function lerPaginado(banco, caminho) {
  const linhas = [];
  for (let inicio = 0; ; inicio += 1000) {
    const pagina = await (await banco.restFetch(caminho, { headers: { Range: `${inicio}-${inicio + 999}` } })).json();
    linhas.push(...pagina);
    if (pagina.length < 1000) return linhas;
  }
}

// Oportunidades do PNCP no AM, só os campos da comparação.
async function lerPncpAm(banco) {
  const sel = "chave,objeto,publicacao,encerramento,municipio:dado->>municipio,orgao:dado->>orgao,esfera:dado->>esferaId,modalidade:dado->>modalidadeNome,numero:dado->>numeroCompra,ano:dado->>anoCompra";
  const linhas = await lerPaginado(banco, `${TABELA}?select=${encodeURIComponent(sel)}&uf=eq.AM&numero_controle_pncp=not.is.null`);
  return linhas.map((l) => ({ ...l, abertura: l.encerramento }));
}

// Todas as linhas "fora do PNCP" do AM (diários daqui, Querido Diário, DOU, portais): as de outro robô só servem
// para não duplicar; apagar, só as dos diários daqui.
async function lerFontesAm(banco) {
  return lerPaginado(banco, `${TABELA}?select=chave,publicacao,dado&uf=eq.AM&chave=like.${encodeURIComponent("fonte:*")}`);
}

async function apagarChaves(banco, chaves) {
  for (let i = 0; i < chaves.length; i += 50) {
    const lista = chaves.slice(i, i + 50).map((c) => `"${c.replace(/"/g, "")}"`).join(",");
    await banco.restFetch(`${TABELA}?chave=in.(${encodeURIComponent(lista)})`, { method: "DELETE" });
  }
}

// Registro mínimo de comparação a partir do dado gravado/montado.
const paraComparar = (dado) => ({ municipio: dado.municipio, orgao: dado.orgao, esfera: dado.esferaId, modalidade: dado.modalidadeNome, numero: dado.numeroCompra, ano: dado.anoCompra, objeto: dado.objeto, abertura: dado.encerramento });

// Índice de chaves forte/média -> registro, e busca fuzzy por município.
function indexar(registros) {
  const porChave = new Map();
  const porLocal = new Map();
  const indice = {
    incluir(r) {
      for (const k of ext.chavesDedup(r)) if (!porChave.has(k)) porChave.set(k, r);
      const grupo = ext.grupoDe(r);
      porLocal.set(grupo, [...(porLocal.get(grupo) || []), r]);
    },
    achar(alvo) {
      for (const k of ext.chavesDedup(alvo)) if (porChave.has(k)) return porChave.get(k);
      return (porLocal.get(ext.grupoDe(alvo)) || []).find((r) => ext.pareceMesmo(alvo, r)) || null;
    },
  };
  registros.forEach(indice.incluir);
  return indice;
}

// Decide o que entra, o que sai e o que fica de fora. Pura (testável): sem rede.
// novas: linhas montadas nesta rodada; resultados: publicações de homologação/resultado; gravadas: linhas de diário no banco.
// outras: linhas de outros robôs "fora do PNCP" (só para não duplicar).
function reconciliar({ novas, resultados, gravadas, pncp, outras = [] }) {
  const noPncp = indexar(pncp);
  const gravar = [];
  const apagar = new Set();
  const antecedencias = [];
  let jaNoPncp = 0;
  let repetidas = 0;

  // Linhas já gravadas que o PNCP passou a ter: saem (o PNCP traz itens, anexos e valor).
  for (const g of gravadas) {
    const p = noPncp.achar(paraComparar(g.dado));
    if (!p) continue;
    apagar.add(g.chave);
    if (p.publicacao && g.dado.publicacao) antecedencias.push(Math.round((Date.parse(p.publicacao) - Date.parse(String(g.dado.publicacao).slice(0, 10))) / 86400000));
  }
  const ficam = gravadas.filter((g) => !apagar.has(g.chave));
  // Mesmo aviso em dois diários (ex.: prefeitura que publica no AAM e no DOE): fica o primeiro visto.
  const jaNoDiario = indexar([...ficam, ...outras].map((g) => ({ ...paraComparar(g.dado), chave: g.chave })));
  const aceitas = [];
  for (const linha of novas) {
    const alvo = { ...paraComparar(linha.dado), chave: linha.chave };
    if (noPncp.achar(alvo)) { jaNoPncp += 1; continue; }
    const outro = jaNoDiario.achar(alvo);
    if (outro && outro.chave !== linha.chave) { repetidas += 1; continue; }
    jaNoDiario.incluir(alvo);
    aceitas.push(linha);
  }
  // Resultado/homologação publicado: o aviso do mesmo município + número/ano sai (gravado ou recém-montado).
  const encerrados = indexar(resultados.filter((r) => r.numero && r.ano));
  for (const g of ficam) if (encerrados.achar({ ...paraComparar(g.dado), objeto: "", abertura: null })) apagar.add(g.chave);
  for (const linha of aceitas) {
    if (encerrados.achar({ ...paraComparar(linha.dado), objeto: "", abertura: null })) { apagar.add(linha.chave); continue; }
    gravar.push(linha);
  }
  return { gravar, apagar: [...apagar].filter((c) => !gravar.some((l) => l.chave === c)), jaNoPncp, repetidas, antecedencias };
}

// ---------- Um diário ----------

async function processarDiario(id, cfg, { lidosDoDiario, ia, cliente }) {
  const fonte = cfg.modulo.FONTE;
  const dias = Number(process.env.DIAS_DIARIO || cfg.dias);
  const ctx = { cliente, desde: diasAtras(dias - 1), ate: hojeIso(), lidos: new Set(Object.keys(lidosDoDiario)), tempoRestanteMs };
  const { publicacoes, lidas } = await cfg.modulo.listar(ctx);
  const novas = [];
  const resultados = [];
  const revisao = [];
  const contagem = {};
  for (const pub of publicacoes) {
    contagem[pub.tipo] = (contagem[pub.tipo] || 0) + 1;
    const municipio = pub.orgao.municipio;
    if (!ext.TIPOS_OPORTUNIDADE.has(pub.tipo)) {
      if (pub.tipo === "resultado") resultados.push({ ...ext.modalidadeNumero(pub.titulo, pub.texto || ""), municipio, orgao: pub.orgao.nome, esfera: pub.orgao.esfera });
      continue;
    }
    if (pub.jaLida || !pub.texto) continue;
    if (ext.ehFomento(pub.tipo, pub.texto)) { contagem.fomentoCultural = (contagem.fomentoCultural || 0) + 1; continue; }
    const partes = ext.dividirAvisos(pub.texto);
    for (const [k, parte] of partes.entries()) {
      const umAviso = partes.length === 1 ? pub : { ...pub, idExterno: `${pub.idExterno}-${k + 1}`, titulo: parte.titulo, texto: parte.texto, contexto: parte.contexto };
      await lerAviso(umAviso, { id, fonte, ia, novas, revisao });
    }
  }
  return { novas, resultados, revisao, lidas, contagem, publicacoes: publicacoes.length };
}

// Um aviso -> linha pronta (novas) e/ou item da fila de revisão.
async function lerAviso(pub, { id, fonte, ia, novas, revisao }) {
  const campos = await extrair(pub, ia);
  if (campos.descartadoPelaIa) return;
  // Sem objeto não há o que mostrar ao cliente: só a fila. Com objeto mas sem data nem número: entra e vai à fila.
  const motivo = !campos.objeto ? "objeto não encontrado" : campos.confianca === "baixa" ? "sem data de abertura nem número" : null;
  if (motivo) revisao.push({ fonte: id, titulo: pub.titulo, orgao: pub.orgao.nome, link: pub.linkOficial, publicacao: pub.publicacao, motivo, inserido: Boolean(campos.objeto), campos: { objeto: campos.objeto, abertura: campos.abertura, numero: campos.numero, ano: campos.ano, modalidade: campos.modalidade } });
  if (campos.objeto) novas.push(montarLinha(fonte, pub, campos));
}

function imprimirExemplos(linhas, max = 10) {
  for (const { dado } of linhas.slice(0, max)) {
    const abertura = dado.encerramento ? dado.encerramento.replace("T", " ").slice(0, 16) : "não informada";
    console.log(`- [${dado.fonte}] ${dado.orgao}${dado.municipio ? ` (${dado.municipio})` : ""} | ${dado.processo || dado.modalidadeNome || "-"} | abertura ${abertura} | ${dado.extraidoPor}/${dado.confiancaExtracao}\n  ${String(dado.objeto).slice(0, 180)}\n  ${dado.link}`);
  }
}


function relatarDiario(id, cfg, r) {
  console.log(`[${id}] publicações de compra: ${r.publicacoes} ${JSON.stringify(r.contagem)} | avisos prontos: ${r.novas.length} | revisão: ${r.revisao.length} | lidas agora: ${r.lidas.length}`);
  // AAM publica avisos todo dia útil: zero numa janela de 3 dias é estrutura mudada, não "sem licitação".
  const suspeito = r.publicacoes === 0 && cfg.semPublicacaoEhFalha;
  if (suspeito) console.log(`[${id}] AVISO: nenhuma publicação de compra na janela; conferir se o site mudou.`);
  return { ok: !suspeito, publicacoes: r.publicacoes, avisos: r.novas.length, revisao: r.revisao.length, tipos: r.contagem };
}

// Lê cada diário pedido; erro num diário não derruba os outros (vira status ok:false e a rodada fica vermelha).
async function lerDiarios(pedidos, lidos, ia) {
  const juntos = { novas: [], resultados: [], revisao: [], status: {}, falhas: 0 };
  for (const id of pedidos) {
    const cfg = DIARIOS[id];
    if (!cfg) { console.log(`[${id}] Diário desconhecido.`); juntos.falhas += 1; continue; }
    try {
      const r = await processarDiario(id, cfg, { lidosDoDiario: lidos[id] || {}, ia, cliente: criarCliente({ intervaloMs: INTERVALO_MS, tentativas: cfg.tentativas || 3 }) });
      lidos[id] = { ...(lidos[id] || {}), ...Object.fromEntries(r.lidas.map((k) => [k, hojeIso()])) };
      juntos.novas.push(...r.novas);
      juntos.resultados.push(...r.resultados);
      juntos.revisao.push(...r.revisao);
      juntos.status[id] = relatarDiario(id, cfg, r);
      if (!juntos.status[id].ok) juntos.falhas += 1;
    } catch (e) {
      juntos.falhas += 1;
      console.error(`[${id}] ERRO: ${e.message}`);
      juntos.status[id] = { ok: false, erro: String(e.message).slice(0, 300) };
    }
  }
  return juntos;
}

function imprimirSimulacao(decisao, revisao) {
  const porFonte = {};
  for (const l of decisao.gravar) (porFonte[l.dado.fonte] = porFonte[l.dado.fonte] || []).push(l);
  const contagem = Object.fromEntries(Object.entries(porFonte).map(([f, ls]) => [f, ls.length]));
  console.log(`\nAvisos que entrariam no painel: ${decisao.gravar.length} ${JSON.stringify(contagem)}. Exemplos:`);
  // Alguns de cada diário, para conferir os três de uma vez.
  imprimirExemplos(Object.values(porFonte).flatMap((ls) => ls.slice(0, 4)));
  if (revisao.length) console.log(`\nIriam para a fila de revisão: ${revisao.length} (ex.: ${revisao.slice(0, 3).map((r) => `${r.titulo} — ${r.motivo}`).join("; ")})`);
}

// Ordem de propósito: linhas primeiro, estado de "já lido" por último. Se a gravação falhar, a próxima rodada relê.
async function gravar(banco, { decisao, lidos, revisao, status }) {
  if (decisao.gravar.length) await banco.upsertEmLotes(TABELA, decisao.gravar, "chave", 100);
  if (decisao.apagar.length) await apagarChaves(banco, decisao.apagar);
  // Retenção: aviso com abertura vencida há 3 dias ou publicação velha sai (só linhas de diário).
  const prefixo = encodeURIComponent(`${PREFIXO_DIARIOS}*`);
  await banco.restFetch(`${TABELA}?chave=like.${prefixo}&encerramento=lt.${diasAtras(3)}`, { method: "DELETE" });
  await banco.restFetch(`${TABELA}?chave=like.${prefixo}&publicacao=lt.${diasAtras(RETENCAO_DIAS)}`, { method: "DELETE" });
  const anterior = (await banco.buscarBlob("dados_robo", BLOB_REVISAO)) || [];
  const vistos = new Set(revisao.map((r) => r.link));
  await banco.salvarBlob("dados_robo", BLOB_REVISAO, [...revisao, ...anterior.filter((r) => !vistos.has(r.link) && r.publicacao >= diasAtras(30))].slice(0, MAX_REVISAO));
  await banco.salvarBlob("dados_robo", BLOB_STATUS, { ...status, gravados: decisao.gravar.length });
  const corte = diasAtras(DIAS_GUARDAR_LIDOS);
  const podado = Object.fromEntries(Object.entries(lidos).map(([id, m]) => [id, Object.fromEntries(Object.entries(m).filter(([, d]) => d >= corte))]));
  await banco.salvarBlob("dados_robo", BLOB_LIDOS, podado);
  console.log(`Gravados: ${decisao.gravar.length}; removidos: ${decisao.apagar.length}; fila de revisão: +${revisao.length}.`);
}

const media = (ns) => (ns.length ? +(ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(1) : null);

async function main() {
  const temChave = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!SIMULAR && !temChave) require("./supabase_dados").chaveServico(); // falha cedo, com a instrução de configuração
  const banco = temChave ? require("./supabase_dados") : null;
  const pedidos = (process.env.DIARIOS || Object.keys(DIARIOS).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const lidos = (!SIMULAR && banco && (await banco.buscarBlob("dados_robo", BLOB_LIDOS))) || {};
  const ia = { apiKey: process.env.GEMINI_API_KEY || "", restantes: MAX_IA, uso: { chamadas: 0, entrada: 0, saida: 0 } };
  console.log(`Diários do AM: ${pedidos.join(", ")}. ${SIMULAR ? "SIMULAR=1 (nada é gravado)." : ""} IA: ${ia.apiKey ? `ligada (até ${MAX_IA})` : "desligada (sem GEMINI_API_KEY)"}.`);

  const lidas = await lerDiarios(pedidos, lidos, ia);
  const pncp = banco ? await lerPncpAm(banco) : [];
  const fontesAm = banco ? await lerFontesAm(banco) : [];
  const decisao = reconciliar({
    novas: lidas.novas, resultados: lidas.resultados, pncp,
    gravadas: SIMULAR ? [] : fontesAm.filter((l) => l.chave.startsWith(PREFIXO_DIARIOS)),
    outras: fontesAm.filter((l) => !l.chave.startsWith(PREFIXO_DIARIOS)),
  });
  const dedup = { jaNoPncp: decisao.jaNoPncp, repetidasEntreDiarios: decisao.repetidas, saemPorPncpOuResultado: decisao.apagar.length, antecedenciaMediaDias: media(decisao.antecedencias) };
  console.log(`Dedup: ${JSON.stringify(dedup)}${banco ? "" : " (sem chave do Supabase: dedup com o PNCP não foi feito)"}. Custo de IA: ${JSON.stringify(ia.uso)}.`);

  if (SIMULAR) imprimirSimulacao(decisao, lidas.revisao);
  else await gravar(banco, { decisao, lidos, revisao: lidas.revisao, status: { em: new Date().toISOString(), diarios: lidas.status, ia: ia.uso, dedup } });
  // Saída com erro faz o GitHub avisar por e-mail que um diário parou (o que já foi gravado continua valendo).
  if (lidas.falhas) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { console.error("Erro fatal no robô dos diários do AM:", e); process.exit(1); });
}

module.exports = { reconciliar, montarLinha, extrair, chaveFonte };
