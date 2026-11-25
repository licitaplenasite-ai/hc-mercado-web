// Robô dos diários oficiais: lê o Diário Oficial da União, Seção 3 (scripts/fontes/dou.js, via INLABS) e os diários
// municipais do Querido Diário (scripts/fontes/querido_diario.js), separa os avisos de licitação e grava os que ainda
// NÃO estão no PNCP na mesma tabela que o painel ("Encontrar licitações", edições do boletim) e o boletim por e-mail já
// leem: oportunidades_abertas, chave "fonte:dou:<matéria>" / "fonte:qd:<processo>", selo "Diário Oficial da União" ou
// "Diário municipal via Querido Diário". Roda pelo .github/workflows/coletar-diarios-oficiais.yml (1 vez por dia).
//
// Comparação com o PNCP (o mesmo processo costuma estar lá via Compras.gov): pela UASG + modalidade + número + ano
// e pelo município + modalidade + número + ano (T.chavesDoProcesso). O que já está no PNCP não entra; o que entrou
// antes e depois apareceu no PNCP sai da tabela e fica registrado em dados_robo "diarios_visto_primeiro" (quantos
// dias o diário chegou antes). Resultado/homologação/revogação no diário tira o processo da tabela.
// Diário municipal publicado também no DOU entra uma vez só (DOU primeiro, depois Querido Diário). Aviso que o robô dos
// diários do AM (scripts/coletar_diarios_am.js, chaves "fonte:diario-*") já gravou não entra de novo: mesma comparação
// dele (scripts/fontes/diario_extracao.js: município + modalidade + número/ano, ou objeto parecido com abertura a ±2 dias).
//
// Uso: node scripts/coletar_diarios_oficiais.js
//      SIMULAR=1 node scripts/coletar_diarios_oficiais.js   (consulta as fontes e só imprime; não lê nem grava o banco)
//      SIMULAR=1 DOU_ARQUIVO=caminho/2026-11-25-DO3.zip node scripts/coletar_diarios_oficiais.js   (DOU de um zip local)
// Variáveis de ambiente:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória fora do SIMULAR
//   INLABS_EMAIL, INLABS_SENHA conta grátis do INLABS (https://inlabs.in.gov.br); sem elas o DOU é pulado com aviso
//   FONTES=dou,qd              fontes a rodar (padrão: as duas)
//   SIMULAR=0                  1 = sem banco, imprime contagens e exemplos
//   LIMITE_MINUTOS=15          orçamento de tempo do robô inteiro
//   DOU_DIAS=3                 edições do DOU relidas (hoje e os 2 dias anteriores: cobre rodada perdida e edição extra)
//   QD_DIAS=7                  diários municipais publicados nos últimos N dias (o Querido Diário raspa com atraso)
//   MAX_DIARIOS_QD=1500        teto de diários municipais lidos por rodada
//   INTERVALO_MS=1000          intervalo mínimo entre pedidos ao Querido Diário (nunca abaixo de 1000)
//   RETENCAO_DIAS=60           linhas destas fontes mais velhas que isso (pela publicação) saem da tabela
//   JANELA_PNCP_DIAS=180       oportunidades do PNCP consideradas na comparação (pela publicação)
//   IA_EXTRAIR=0               1 = completa objeto/data com Gemini quando a regra não achou (precisa GEMINI_API_KEY)
//   MAX_IA=40                  teto de chamadas de IA por rodada
//   GEMINI_MODELO=gemini-3.8-flash
//   DOU_ARQUIVO=               zip ou XML do INLABS salvo localmente (teste sem conta; só com SIMULAR=1)
const { criarCliente, chaveFonte, paraLinha } = require("./fontes/comum");
const T = require("./fontes/avisos_texto");
const ext = require("./fontes/diario_extracao");

const ADAPTADORES = { dou: require("./fontes/dou"), qd: require("./fontes/querido_diario") };

const SIMULAR = process.env.SIMULAR === "1";
const LIMITE_MINUTOS = Number(process.env.LIMITE_MINUTOS || 15);
const DOU_DIAS = Number(process.env.DOU_DIAS || 3);
const QD_DIAS = Number(process.env.QD_DIAS || 7);
const MAX_DIARIOS_QD = Number(process.env.MAX_DIARIOS_QD || 1500);
const INTERVALO_MS = Math.max(1000, Number(process.env.INTERVALO_MS || 1000));
const RETENCAO_DIAS = Number(process.env.RETENCAO_DIAS || 60);
const JANELA_PNCP_DIAS = Number(process.env.JANELA_PNCP_DIAS || 180);
const IA_EXTRAIR = process.env.IA_EXTRAIR === "1";
const MAX_IA = Number(process.env.MAX_IA || 40);
// Modelo do projeto e reserva, como em scripts/gerar_dossies_gemini.js.
const MODELOS_IA = [...new Set([process.env.GEMINI_MODELO || "gemini-3.8-flash", "gemini-3.7-flash"])];
const TABELA = "oportunidades_abertas";
const PREFIXO_OUTROS_DIARIOS = "fonte:diario-";
const LIMITE_VISTO_PRIMEIRO = 2000;
const TAMANHO_PAGINA = 1000;

const inicioExecucao = Date.now();
const tempoRestanteMs = () => LIMITE_MINUTOS * 60000 - (Date.now() - inicioExecucao);
// Dia em Brasília (UTC-3, sem horário de verão): o diário de "hoje" é o de Brasília.
const diaBrasilia = (deslocamentoDias = 0) => new Date(Date.now() - 3 * 3600000 + deslocamentoDias * 86400000).toISOString().slice(0, 10);

// ---- Decisão (pura, testada em scripts/fontes/diarios_oficiais.test.js) ----

function linhaDoItem(fonte, item, chaves, anterior) {
  const base = paraLinha(fonte, item);
  const dado = {
    ...base.dado,
    fonte: fonte.rotulo,
    situacaoCompraNome: "Publicada em diário oficial",
    codigoUnidade: item.uasg || null,
    chavesProcesso: chaves,
    vistoNoDiarioEm: (anterior && anterior.vistoNoDiarioEm) || item.publicacao || null,
  };
  return { ...base, dado };
}

// Registros dos diários do AM -> função "já está lá?" para um item. Mesmas peças de scripts/coletar_diarios_am.js.
function indiceOutrosDiarios(registros) {
  const porChave = new Set();
  const porGrupo = new Map();
  for (const r of registros) {
    ext.chavesDedup(r).forEach((k) => porChave.add(k));
    porGrupo.set(ext.grupoDe(r), [...(porGrupo.get(ext.grupoDe(r)) || []), r]);
  }
  return (alvo) => ext.chavesDedup(alvo).some((k) => porChave.has(k)) || (porGrupo.get(ext.grupoDe(alvo)) || []).some((r) => ext.pareceMesmo(alvo, r));
}
const paraComparar = (item) => ({
  municipio: item.orgao.municipio, orgao: item.orgao.nome, esfera: item.orgao.municipio ? "M" : null,
  modalidade: item.modalidade, numero: item.numero, ano: item.ano, objeto: item.objeto, abertura: item.encerramento,
});

// fontes: [{ fonte, itens }] na ordem de prioridade; pncp: Map chaveProcesso -> { controle, publicacao };
// anteriores: Map chave -> { chaves, vistoNoDiarioEm, fonteId }; outrosDiarios: registros dos diários do AM
// ({ municipio, orgao, esfera, modalidade, numero, ano, objeto, abertura }). Devolve o que gravar, o que apagar e as contagens.
function decidir(fontes, pncp, anteriores, outrosDiarios = []) {
  const jaEmOutroDiario = indiceOutrosDiarios(outrosDiarios);
  const doProcesso = new Map();
  for (const [chave, a] of anteriores) for (const k of a.chaves || []) doProcesso.set(k, chave);
  const encerrar = new Set();
  const novas = [];
  const contagem = {};
  for (const { fonte, itens } of fontes) {
    const c = { avisos: 0, encerramentos: 0, vencidosOuIncompletos: 0, jaNoPncp: 0, repetidos: 0, gravar: 0 };
    contagem[fonte.id] = c;
    for (const item of itens) {
      const chaves = T.chavesDoProcesso({ ...item, uf: item.orgao.uf, municipio: item.orgao.municipio });
      if (item.tipo === "encerramento") { c.encerramentos += 1; chaves.forEach((k) => encerrar.add(k)); continue; }
      c.avisos += 1;
      if (!item.aberto) { c.vencidosOuIncompletos += 1; continue; }
      if (chaves.some((k) => pncp.has(k))) { c.jaNoPncp += 1; continue; }
      if (jaEmOutroDiario(paraComparar(item))) { c.repetidos += 1; continue; }
      const chave = chaveFonte(fonte.id, item.idExterno);
      const outra = chaves.map((k) => doProcesso.get(k)).find((dona) => dona && dona !== chave);
      if (outra) { c.repetidos += 1; continue; }
      chaves.forEach((k) => doProcesso.set(k, chave));
      novas.push(linhaDoItem(fonte, item, chaves, anteriores.get(chave)));
    }
  }
  const encerrada = (chaves) => (chaves || []).some((k) => encerrar.has(k));
  // A mesma linha pode vir de dois dias relidos: fica a última versão.
  const porChave = new Map(novas.filter((l) => !encerrada(l.dado.chavesProcesso)).map((l) => [l.chave, l]));
  const linhas = [...porChave.values()];
  for (const l of linhas) contagem[l.dado.fonteId].gravar += 1;

  const apagar = [];
  const vistoPrimeiro = [];
  for (const [chave, a] of anteriores) {
    const noPncp = (a.chaves || []).map((k) => pncp.get(k)).find(Boolean);
    if (noPncp) {
      apagar.push(chave);
      vistoPrimeiro.push({ chave, fonte: a.fonteId, vistoNoDiarioEm: a.vistoNoDiarioEm || null, numeroControlePNCP: noPncp.controle, publicacaoPncp: noPncp.publicacao || null });
    } else if (encerrada(a.chaves)) apagar.push(chave);
  }
  return { linhas, apagar, vistoPrimeiro, contagem };
}

// ---- Banco ----

// Lê em páginas pela chave (offset sobre jsonb estoura o statement timeout; ver supabase_dados.js).
async function paginas(banco, caminho) {
  const linhas = [];
  for (let ultima = null; ;) {
    const resp = await banco.restFetch(`${caminho}&order=chave.asc&limit=${TAMANHO_PAGINA}${ultima ? `&chave=gt.${encodeURIComponent(ultima)}` : ""}`);
    const pagina = await resp.json();
    linhas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) return linhas;
    ultima = pagina[pagina.length - 1].chave;
  }
}

async function indicePncp(banco, desdeIso) {
  const sel = "chave,numero_controle_pncp,publicacao,uf,mod:dado->>modalidadeNome,num:dado->>numeroCompra,ano:dado->>anoCompra,uasg:dado->>codigoUnidade,mun:dado->>municipio";
  const linhas = await paginas(banco, `${TABELA}?select=${encodeURIComponent(sel)}&numero_controle_pncp=not.is.null&publicacao=gte.${desdeIso}`);
  const indice = new Map();
  for (const l of linhas) {
    for (const k of T.chavesDoProcesso({ uasg: l.uasg, uf: l.uf, municipio: l.mun, modalidade: l.mod, numero: l.num, ano: l.ano })) {
      indice.set(k, { controle: l.numero_controle_pncp, publicacao: l.publicacao });
    }
  }
  return indice;
}

async function linhasAnteriores(banco) {
  const sel = "chave,chaves:dado->chavesProcesso,visto:dado->>vistoNoDiarioEm,fonteId:dado->>fonteId";
  const mapa = new Map();
  for (const id of Object.keys(ADAPTADORES)) {
    for (const l of await paginas(banco, `${TABELA}?select=${encodeURIComponent(sel)}&chave=like.${encodeURIComponent(chaveFonte(id, "*"))}`)) {
      mapa.set(l.chave, { chaves: Array.isArray(l.chaves) ? l.chaves : [], vistoNoDiarioEm: l.visto, fonteId: l.fonteId || id });
    }
  }
  return mapa;
}

// Avisos já gravados pelo robô dos diários do AM, no formato de comparação de scripts/fontes/diario_extracao.js.
async function linhasOutrosDiarios(banco) {
  const sel = "chave,municipio:dado->>municipio,orgao:dado->>orgao,esfera:dado->>esferaId,modalidade:dado->>modalidadeNome,numero:dado->>numeroCompra,ano:dado->>anoCompra,objeto:dado->>objeto,abertura:dado->>encerramento";
  return paginas(banco, `${TABELA}?select=${encodeURIComponent(sel)}&chave=like.${encodeURIComponent(`${PREFIXO_OUTROS_DIARIOS}*`)}`);
}

async function apagarChaves(banco, chaves) {
  for (let i = 0; i < chaves.length; i += 50) {
    const lista = chaves.slice(i, i + 50).map((c) => `"${c.replace(/"/g, "")}"`).join(",");
    await banco.restFetch(`${TABELA}?chave=in.(${encodeURIComponent(lista)})`, { method: "DELETE" });
  }
}

async function gravar(banco, { linhas, apagar, vistoPrimeiro }, hojeIso) {
  if (linhas.length) await banco.upsertEmLotes(TABELA, linhas, "chave", 100);
  if (apagar.length) await apagarChaves(banco, apagar);
  const corte = new Date(Date.parse(hojeIso) - RETENCAO_DIAS * 86400000).toISOString().slice(0, 10);
  for (const id of Object.keys(ADAPTADORES)) {
    const prefixo = `chave=like.${encodeURIComponent(chaveFonte(id, "*"))}`;
    await banco.restFetch(`${TABELA}?${prefixo}&publicacao=lt.${corte}`, { method: "DELETE" });
    // Abertura que já passou: o processo não é mais oportunidade.
    await banco.restFetch(`${TABELA}?${prefixo}&encerramento=lt.${hojeIso}`, { method: "DELETE" });
  }
  if (vistoPrimeiro.length) {
    const antes = (await banco.buscarBlob("dados_robo", "diarios_visto_primeiro")) || [];
    await banco.salvarBlob("dados_robo", "diarios_visto_primeiro", [...antes, ...vistoPrimeiro].slice(-LIMITE_VISTO_PRIMEIRO));
  }
}

// ---- IA (opcional): só o que a regra não achou ----
// Mesma chamada e mesma validação dos diários do AM (scripts/fontes/diario_extracao.js): saída JSON com esquema, objeto
// só vale se as palavras estiverem no texto, data só entre a publicação e 1 ano depois.

async function completarComIa(itens, hojeIso, fetchImpl = fetch) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!IA_EXTRAIR || !apiKey) return 0;
  let usadas = 0;
  for (const [i, item] of itens.entries()) {
    if (!item.precisaIa || item.tipo !== "oportunidade" || usadas >= MAX_IA || tempoRestanteMs() < 90000) continue;
    usadas += 1;
    try {
      const r = await ext.chamarIa({ texto: item.trecho, publicacao: item.publicacao, apiKey, modelos: MODELOS_IA, fetchImpl });
      const v = r && ext.validarSaidaIa(r.saida, item.trecho, item.publicacao);
      if (!v || v.ehOportunidade === false) continue;
      const objeto = item.objeto || v.objeto || "";
      const encerramento = item.encerramento || v.abertura || null;
      itens[i] = { ...item, objeto, encerramento, aberto: Boolean(objeto) && (!encerramento || encerramento.slice(0, 10) >= hojeIso), extraidoPorIa: true };
    } catch (e) {
      console.log(`[ia] Falha (${e.message}); segue sem IA.`);
      break;
    }
  }
  return usadas;
}

// ---- Execução ----

function imprimirExemplos(linhas, quantos = 10) {
  for (const { dado } of linhas.slice(0, quantos)) {
    const abertura = dado.encerramento ? dado.encerramento.replace("T", " ").slice(0, 16) : "não informada";
    console.log(`- ${dado.publicacao} | ${dado.orgao} (${dado.municipio || "-"}/${dado.uf || "-"}) | ${dado.modalidadeNome || "?"} ${dado.numeroCompra || "?"}/${dado.anoCompra || "?"} | abertura ${abertura}\n  ${String(dado.objeto).slice(0, 160)}\n  ${dado.link}`);
  }
}

// Uma fonte -> { coletada (fonte + itens) ou null, status, falhou }. Erro de uma fonte não derruba a outra.
async function coletarUma(id, hojeIso) {
  const adaptador = ADAPTADORES[id];
  if (!adaptador) { console.log(`[${id}] Fonte desconhecida.`); return { coletada: null, status: { ok: false, erro: "fonte desconhecida" }, falhou: true }; }
  const relatorio = { atosLidos: 0 };
  const ctx = {
    cliente: criarCliente({ intervaloMs: INTERVALO_MS }), hojeIso, relatorio, tempoRestanteMs, maxDiarios: MAX_DIARIOS_QD,
    desdeIso: diaBrasilia(-QD_DIAS), dias: Array.from({ length: DOU_DIAS }, (_, i) => diaBrasilia(-i)).reverse(),
    arquivoLocal: SIMULAR && id === "dou" ? process.env.DOU_ARQUIVO || null : null,
  };
  try {
    const itens = await adaptador.listar(ctx);
    const ia = await completarComIa(itens, hojeIso);
    // DOU sem edição é normal no fim de semana; Querido Diário sem nenhum diário em 7 dias é sinal de API mudada.
    if (!relatorio.atosLidos) console.log(`[${id}] AVISO: nenhum ato/diário lido na janela.`);
    const status = { ok: relatorio.atosLidos > 0, atosLidos: relatorio.atosLidos, itens: itens.length, chamadasIa: ia };
    return { coletada: { fonte: adaptador.FONTE, itens }, status, falhou: !relatorio.atosLidos && id === "qd" };
  } catch (e) {
    if (e.semCadastro) { console.log(`[${id}] PULADO: ${e.message}`); return { coletada: null, status: { ok: false, pendente: e.message }, falhou: false }; }
    console.error(`[${id}] ERRO: ${e.message}`);
    return { coletada: null, status: { ok: false, erro: String(e.message).slice(0, 300) }, falhou: true };
  }
}

async function main() {
  const banco = SIMULAR ? null : require("./supabase_dados");
  if (banco) banco.chaveServico(); // falha cedo, com a instrução de configuração
  const hojeIso = diaBrasilia();
  const pedidas = (process.env.FONTES || Object.keys(ADAPTADORES).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  console.log(`Diários oficiais: ${pedidas.join(", ")}. Hoje (Brasília) ${hojeIso}. ${SIMULAR ? "SIMULAR=1 (nada é lido nem gravado no banco)." : ""}`);

  const pncp = banco ? await indicePncp(banco, diaBrasilia(-JANELA_PNCP_DIAS)) : new Map();
  const anteriores = banco ? await linhasAnteriores(banco) : new Map();
  const outrosDiarios = banco ? await linhasOutrosDiarios(banco) : [];
  if (banco) console.log(`[pncp] ${pncp.size} chave(s) de processo do PNCP para comparar; ${anteriores.size} linha(s) já gravadas destas fontes; ${outrosDiarios.length} dos diários do AM.`);

  const status = { em: new Date().toISOString(), fontes: {} };
  const coletadas = [];
  let falhas = 0;
  for (const id of pedidas) {
    const r = await coletarUma(id, hojeIso);
    status.fontes[id] = r.status;
    if (r.coletada) coletadas.push(r.coletada);
    if (r.falhou) falhas += 1;
  }

  const decisao = decidir(coletadas, pncp, anteriores, outrosDiarios);
  for (const { fonte } of coletadas) {
    Object.assign(status.fontes[fonte.id], decisao.contagem[fonte.id]);
    console.log(`[${fonte.id}] ${JSON.stringify(status.fontes[fonte.id])}`);
    if (SIMULAR) imprimirExemplos(decisao.linhas.filter((l) => l.dado.fonteId === fonte.id));
  }
  console.log(`Gravar ${decisao.linhas.length}; apagar ${decisao.apagar.length} (resultado no diário ou já no PNCP); visto primeiro no diário: ${decisao.vistoPrimeiro.length}.`);
  if (!SIMULAR) {
    await gravar(banco, decisao, hojeIso);
    await banco.salvarBlob("dados_robo", "diarios_oficiais_status", status);
  }
  // Saída com erro faz o GitHub avisar por e-mail que a fonte parou (o que já foi gravado fica).
  if (falhas) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { console.error("Erro fatal no robô dos diários oficiais:", e); process.exit(1); });
}

module.exports = { decidir, linhaDoItem, completarComIa };
