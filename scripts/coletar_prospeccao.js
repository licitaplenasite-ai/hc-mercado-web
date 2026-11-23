// Robô diário da Prospecção (Inteligência de Mercado): o que o órgão vai comprar ANTES do edital.
//   node scripts/coletar_prospeccao.js
// Grava a tabela enxuta prospeccao_itens (supabase/prospeccao.sql); a tela lê por /api/prospeccao.
//
// Por que robô e não consulta ao vivo: a busca do PNCP devolve ~3 KB por documento (4.094 atas vigentes só
// no AM = 9 páginas de 1,6 MB) e não filtra fim de vigência; o PCA é por órgão e unidade. Ler e filtrar isso
// numa requisição estoura os 10 ms de CPU e as 50 subrequisições do Cloudflare. Aqui é uma vez por dia.
//
// Fontes (todas grátis, sem login e sem captcha — ver _historico/pente-fino-pncp/02 e 03):
//   contrato  PNCP /api/search tipos_documento=contrato status=vigente ufs=UF; fica o que vence em até
//             DIAS_HORIZONTE dias (empenho fica fora: é compra pontual, não gera nova licitação). Inclui os
//             contratos do Contratos.gov.br, que o PNCP recebe com usuario_nome "Contratos.gov.br".
//   ata       PNCP /api/search tipos_documento=ata status=vigente permite_adesao=true ufs=UF; e, para as atas
//             do Compras.gov, os itens com fornecedor, quantidade, empenhado e máximo de adesão
//             (dadosabertos.compras.gov.br /modulo-arp/2_consultarARPItem, por unidade gerenciadora).
//   irp       PNCP /api/search tipos_documento=irp (nacional: o módulo é de 31/08/2026 e tem poucas IRPs) +
//             /api/pncp/v1/orgaos/{cnpj}/irp/{ano}/{seq}/itens. Só com prazo de manifestação a partir de hoje.
//   pca       por órgão visto nos contratos/atas da UF e só nas unidades da UF: federal pelo PGC do Compras.gov
//             (/modulo-pgc/1_consultarPgcDetalhe, traz o CATMAT e o DFD) e os demais pelo PCA do PNCP
//             (/api/pncp/v1/orgaos/{cnpj}/pca/{ano}/{seq}/itens). Ano atual e o próximo; só data a partir de hoje.
//
// Fonte que falhar no meio não apaga o que já estava gravado dela (a limpeza só roda para fonte completa).
// Rodar duas vezes no dia é seguro: upsert pela chave natural e limpeza por coletado_em.
//
// Variáveis (todas opcionais, menos a chave):
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória para gravar (scripts/supabase_dados.js)
//   PROSPECCAO_UFS             as 27 (lista separada por vírgula; o workflow divide em 3 grupos)
//   PROSPECCAO_GRUPO           nome do grupo da matriz (chaves prospeccao_estado_<grupo> e prospeccao_cobertura_<grupo>)
//   PROSPECCAO_TIPOS           contrato,ata,pca
//   PROSPECCAO_IRP             0 desliga a IRP (nacional: só um grupo da matriz coleta)
//   FRESCOR_HORAS              36 — etapa fechada há menos que isso não roda de novo
//   LIMITE_HORAS_SEM_COBERTURA 48 — etapa sem fechar há mais que isso faz o robô falhar (e-mail)
//   DIAS_HORIZONTE             400 — quanto à frente guardar (contratos vencendo, PCA)
//   PAUSA_MS                   250 entre chamadas às fontes públicas (429: Retry-After ou backoff com jitter)
//   LIMITE_MINUTOS             10 — tamanho da rodada: passou disso, para na próxima unidade e a rodada seguinte retoma
//   TAMANHO_LOTE_BANCO         500
//   ADESOES_POR_RODADA         1500 — teto de consultas a 5_consultarAdesoesItem por rodada (uma por item de ata)
//   ADESOES_VALIDADE_DIAS      3 — adesão consultada há menos que isso não é consultada de novo
//   ITENS_ATA_PNCP_MAX         30 — itens lidos por ata fora do Compras.gov
//   ATAS_PNCP_COM_ITENS        300 — atas fora do Compras.gov que ganham itens por UF e volta (as mais recentes)
//   PROSPECCAO_REINICIAR       1 — ignora o progresso salvo e recomeça
//   MODO_SECO=1 (+ AMOSTRA_SECO) rodada real sem chave e sem gravar nada (ver modoSeco())
//
// Rodadas: o trabalho é dividido em etapas (irp, UF:contrato, UF:ata, UF:pca) e, dentro delas, em unidades (UASG,
// ata, órgão/ano). O progresso fica em dados_robo (prospeccao_estado_<grupo>) e atravessa os dias: a rodada pega a
// etapa pela metade ou a mais antiga, grava as unidades que fecha e a seguinte pula o que já foi feito. A limpeza do
// que não voltou só roda quando a etapa fecha (corte = início da volta).
const supabase = require("./supabase_dados");
// Banco por indireção: o MODO_SECO troca por um banco em memória (nada é gravado; ver modoSeco()).
const banco = { ...supabase };
const restFetch = (...a) => banco.restFetch(...a);
const upsertEmLotes = (...a) => banco.upsertEmLotes(...a);
const buscarBlob = (...a) => banco.buscarBlob(...a);
const salvarBlob = (...a) => banco.salvarBlob(...a);
const { semCpf } = require("../netlify/functions/_cpf");

const PNCP = "https://pncp.gov.br";
const CG = "https://dadosabertos.compras.gov.br";
// Sem User-Agent de navegador a busca do PNCP reseta a conexão (WAF; ver netlify/functions/pncp-proxy.js).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TABELA = "prospeccao_itens";

const num = (v, padrao) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : padrao);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// A fonte às vezes devolve UTF-8 lido como Windows-1252 ("SAÃšDE", "FUNDAÃ‡ÃƒO"). Cada sequência líder+continuação
// que decodifica como UTF-8 válido volta ao caractere certo; texto já correto ("AÇÃO") não casa e passa intacto.
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
const CONT = "[\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]";
const MOJIBAKE = new RegExp(`[\u00C2-\u00DF]${CONT}|[\u00E0-\u00EF]${CONT}{2}|[\u00F0-\u00F4]${CONT}{3}`, "g");
function desfazerMojibake(v) {
  return String(v ?? "").replace(MOJIBAKE, (m) => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([...m].map((c) => CP1252[c.charCodeAt(0)] ?? c.charCodeAt(0)))); } catch { return m; }
  });
}
const txt = (v, max = 600) => {
  const s = desfazerMojibake(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const numero = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const dia = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : null);
const cnpjOuNulo = (v) => (/^\d{14}$/.test(String(v || "").replace(/\D/g, "")) ? String(v).replace(/\D/g, "") : null);
const catmat = (v) => (/^\d{1,12}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);
// Texto de busca: minúsculo e sem acento, para o ILIKE da function casar "cafe" com "CAFÉ". O nome do fornecedor
// fica fora: "papel" casava "X PAPELARIA LTDA" em ata de cadeira (visto no E2E de 19/11/2026).
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const busca = (...partes) => normalizar(semCpf(desfazerMojibake(partes.filter(Boolean).join(" ")), " ")).slice(0, 2000);
// Nome para a busca por texto: começo (90 caracteres) da descrição do item + começo do objeto da compra/demanda. A tela mostra
// primeiro quem casa aqui e recolhe quem só cita o termo mais adiante, na especificação ("papel a4" dentro da ficha da impressora).
const nomeBusca = (descricao, objeto) => [descricao, objeto].map((t) => normalizar(semCpf(desfazerMojibake(t || ""), " ")).slice(0, 90)).filter(Boolean).join(" ");
// Razão social de MEI traz o CPF do titular ("FULANA DE TAL 97048143215"): o CPF sai, o resto é público.
const nomeFornecedor = (v) => txt(semCpf(v, " "), 300);
// Objeto/descrição também: contrato com pessoa física vem com o CPF no objeto ("016.471.242-98", visto no E2E de 19/11/2026).
const livre = (v, max) => txt(semCpf(v), max);

// AAAA-MM-DD de Brasília (UTC-3 fixo), deslocado em dias.
function hojeBrasilia(agora = Date.now(), deslocamento = 0) {
  return new Date(agora - 3 * 36e5 + deslocamento * 864e5).toISOString().slice(0, 10);
}
const dentro = (d, de, ate) => Boolean(d) && d >= de && d <= ate;

// ---------- normalizadores (puros; testados em coletar_prospeccao.test.js) ----------

function linhaContrato(doc, coletadoEm) {
  return {
    id: `contrato:${doc.numero_controle_pncp}`, tipo: "contrato", fonte: "pncp", plataforma: txt(doc.usuario_nome, 120),
    uf: doc.uf, orgao_cnpj: cnpjOuNulo(doc.orgao_cnpj), orgao_nome: txt(doc.orgao_nome, 300),
    unidade_codigo: txt(doc.unidade_codigo, 30), unidade_nome: txt(doc.unidade_nome, 300), municipio: txt(doc.municipio_nome, 120),
    objeto: livre(doc.description, 1000), descricao: null, catmat: null,
    quantidade: null, valor_unitario: null, valor_total: numero(doc.valor_global),
    data_inicio: dia(doc.data_inicio_vigencia), data_ref: dia(doc.data_fim_vigencia),
    // LGPD: fornecedor pessoa física (CPF) não é gravado.
    fornecedor_cnpj: cnpjOuNulo(doc.fornecedor_ni), fornecedor_nome: cnpjOuNulo(doc.fornecedor_ni) ? nomeFornecedor(doc.fornecedor_nome) : null,
    saldo: null, maximo_adesao: null, permite_adesao: null,
    link: `${PNCP}/app${doc.item_url}`, busca: busca(doc.description, doc.orgao_nome), busca_nome: nomeBusca(null, doc.description), coletado_em: coletadoEm,
  };
}

// Contrato que importa: termo inicial/carta-contrato vigente que acaba dentro do horizonte. Empenho não.
function contratoInteressa(doc, hoje, ate) {
  return /^\d{14}-2-\d+\/\d{4}$/.test(String(doc.numero_controle_pncp || "")) && /^\/contratos\//.test(String(doc.item_url || ""))
    && !/empenho/i.test(String(doc.tipo_contrato_nome || "")) && !doc.cancelado && dentro(dia(doc.data_fim_vigencia), hoje, ate);
}

function linhaAta(doc, coletadoEm) {
  return {
    id: `ata:${doc.numero_controle_pncp}`, tipo: "ata", fonte: "pncp", plataforma: txt(doc.usuario_nome, 120),
    uf: doc.uf, orgao_cnpj: cnpjOuNulo(doc.orgao_cnpj), orgao_nome: txt(doc.orgao_nome, 300),
    unidade_codigo: txt(doc.unidade_codigo, 30), unidade_nome: txt(doc.unidade_nome, 300), municipio: txt(doc.municipio_nome, 120),
    objeto: livre(doc.description, 1000), descricao: null, catmat: null,
    quantidade: null, valor_unitario: null, valor_total: numero(doc.valor_global),
    data_inicio: dia(doc.data_inicio_vigencia), data_ref: dia(doc.data_fim_vigencia),
    fornecedor_cnpj: null, fornecedor_nome: null, saldo: null, maximo_adesao: null, permite_adesao: doc.permite_adesao === true,
    link: `${PNCP}/app${doc.item_url}`, busca: busca(doc.description, doc.orgao_nome), busca_nome: nomeBusca(null, doc.description), coletado_em: coletadoEm,
  };
}

// Item de ata do Compras.gov: herda órgão/UF/objeto da ata do PNCP. Saldo = homologado ao fornecedor - empenhado.
function linhaItemAta(item, ata, coletadoEm) {
  const qtd = numero(item.quantidadeHomologadaVencedor ?? item.quantidadeHomologadaItem);
  const empenhada = numero(item.quantidadeEmpenhada) || 0;
  const forn = cnpjOuNulo(item.niFornecedor);
  return {
    ...ata, id: `ata:${item.numeroControlePncpAta}#${item.numeroItem}#${forn || item.classificacaoFornecedor || ""}`, fonte: "comprasgov_arp",
    descricao: livre(item.descricaoItem, 600), catmat: catmat(item.codigoItem),
    quantidade: qtd, valor_unitario: numero(item.valorUnitario), valor_total: numero(item.valorTotal),
    data_inicio: dia(item.dataVigenciaInicial) || ata.data_inicio, data_ref: dia(item.dataVigenciaFinal) || ata.data_ref,
    fornecedor_cnpj: forn, fornecedor_nome: forn ? nomeFornecedor(item.nomeRazaoSocialFornecedor) : null,
    saldo: qtd === null ? null : Math.max(0, qtd - empenhada), maximo_adesao: numero(item.maximoAdesao),
    ata_numero: txt(item.numeroAtaRegistroPreco, 40),
    busca: busca(ata.objeto, item.descricaoItem, ata.orgao_nome), busca_nome: nomeBusca(item.descricaoItem, ata.objeto), coletado_em: coletadoEm,
  };
}

// Item de ata fora do Compras.gov: item da contratação de origem (PNCP) + resultado (fornecedor e valor homologado).
// O PNCP não divulga saldo nem limite de adesão: esses campos ficam nulos e a tela diz isso.
function linhaItemAtaPncp(item, res, ata, coletadoEm) {
  const forn = cnpjOuNulo(res.niFornecedor);
  return {
    ...ata, id: `${ata.id}#${item.numeroItem}#${forn || res.sequencialResultado || ""}`,
    descricao: livre(item.descricao, 600), catmat: catmat(item.catalogoCodigoItem),
    quantidade: numero(res.quantidadeHomologada ?? item.quantidade), valor_unitario: numero(res.valorUnitarioHomologado), valor_total: numero(res.valorTotalHomologado),
    fornecedor_cnpj: forn, fornecedor_nome: forn ? nomeFornecedor(res.nomeRazaoSocialFornecedor) : null,
    busca: busca(ata.objeto, item.descricao, ata.orgao_nome), busca_nome: nomeBusca(item.descricao, ata.objeto), coletado_em: coletadoEm,
  };
}

// Soma do que já foi aprovado de adesão ao item (5_consultarAdesoesItem devolve uma linha por órgão não participante).
const somarAdesoes = (linhas) => (linhas || []).reduce((t, a) => t + (numero(a.quantidadeAprovadaAdesao) || 0), 0);

function linhaIrp(doc, item, coletadoEm) {
  const [, cnpj, ano, seq] = String(doc.item_url || "").split("/").slice(1);
  return {
    id: `irp:${doc.numero_controle_pncp}#${item.numeroItem}`, tipo: "irp", fonte: "pncp", plataforma: txt(doc.usuario_nome, 120),
    uf: doc.uf, orgao_cnpj: cnpjOuNulo(doc.orgao_cnpj), orgao_nome: txt(doc.orgao_nome, 300),
    unidade_codigo: txt(doc.unidade_codigo, 30), unidade_nome: txt(doc.unidade_nome, 300), municipio: txt(doc.municipio_nome, 120),
    objeto: livre(doc.description, 1000), descricao: livre(item.descricao, 600), catmat: catmat(item.catalogoCodigoItem),
    quantidade: numero(item.quantidade), valor_unitario: numero(item.valorUnitarioEstimado), valor_total: numero(item.valorTotal),
    data_inicio: dia(doc.data_publicacao_pncp), data_ref: dia(doc.prazo_manifestacao_interesse || doc.data_fim_vigencia),
    fornecedor_cnpj: null, fornecedor_nome: null, saldo: null, maximo_adesao: null, permite_adesao: doc.permite_adesao ?? null,
    link: `${PNCP}/app/irps/${cnpj}/${ano}/${seq}`, busca: busca(doc.description, item.descricao, doc.orgao_nome), busca_nome: nomeBusca(item.descricao, doc.description), coletado_em: coletadoEm,
  };
}

function linhaPcaPncp(item, org, uf, coletadoEm) {
  return {
    id: `pca:${item.cnpj}-${item.anoPca}-${item.sequencialPca}#${item.numeroItem}`, tipo: "pca", fonte: "pncp", plataforma: null,
    uf, orgao_cnpj: cnpjOuNulo(item.cnpj), orgao_nome: txt(org.nome, 300),
    unidade_codigo: txt(item.codigoUnidade, 30), unidade_nome: txt(item.nomeUnidade, 300), municipio: null,
    objeto: livre(item.grupoContratacaoNome, 1000), descricao: livre(item.descricao || item.pdmDescricao || item.classificacaoSuperiorNome, 600),
    catmat: catmat(item.codigoItem), quantidade: numero(item.quantidade), valor_unitario: numero(item.valorUnitario), valor_total: numero(item.valorTotal),
    data_inicio: null, data_ref: dia(item.dataDesejada),
    fornecedor_cnpj: null, fornecedor_nome: null, saldo: null, maximo_adesao: null, permite_adesao: null,
    link: `${PNCP}/app/pca/${item.cnpj}/${item.anoPca}`,
    busca: busca(item.grupoContratacaoNome, item.descricao, item.classificacaoSuperiorNome, org.nome),
    busca_nome: nomeBusca(item.descricao || item.pdmDescricao || item.classificacaoSuperiorNome, item.grupoContratacaoNome), coletado_em: coletadoEm,
  };
}

// PGC (Compras.gov): a mesma demanda federal antes de virar PCA consolidado, com CATMAT e DFD.
function linhaPgc(item, org, uf, coletadoEm) {
  const chave = [item.codigoUasg, item.anoPcaProjetoCompra, item.numeroArtefato, item.ordemDfd, item.codigoItemCatalogo || item.numeroItemPncp].join("-");
  return {
    id: `pca:pgc:${chave}`, tipo: "pca", fonte: "pgc", plataforma: "Compras.gov.br (PGC)",
    uf, orgao_cnpj: cnpjOuNulo(item.orgao), orgao_nome: txt(org.nome, 300),
    unidade_codigo: txt(item.codigoUasg, 30), unidade_nome: txt(item.nomeUasg, 300), municipio: null,
    objeto: livre(item.descricaoObjetoDfd || item.tituloProjetoCompra, 1000),
    descricao: livre(item.descricaoItemCatalogo || item.nomePdmMaterial || item.nomeClasseServico, 600),
    catmat: catmat(item.codigoItemCatalogo), quantidade: numero(item.quantidadeItem), valor_unitario: numero(item.valorUnitarioItem), valor_total: numero(item.valorTotalItem),
    data_inicio: dia(item.dataInicioProcessoCompra), data_ref: dia(item.dataPrevistaFormalizacaoDemanda),
    fornecedor_cnpj: null, fornecedor_nome: null, saldo: null, maximo_adesao: null, permite_adesao: null,
    link: `${PNCP}/app/pca/${item.orgao}/${item.anoPcaProjetoCompra}`,
    busca: busca(item.descricaoObjetoDfd, item.tituloProjetoCompra, item.descricaoItemCatalogo, org.nome),
    busca_nome: nomeBusca(item.descricaoItemCatalogo || item.nomePdmMaterial || item.nomeClasseServico, item.descricaoObjetoDfd || item.tituloProjetoCompra), coletado_em: coletadoEm,
  };
}

// ---------- rede ----------

let chamadas = 0; // chamadas às fontes públicas na rodada (vai para o resumo do log)
async function obter(url, { fetch = globalThis.fetch, tentativas = 4, pausaMs = num(process.env.PAUSA_MS, 250) } = {}) {
  for (let t = 1; ; t++) {
    await esperar(pausaMs);
    chamadas++;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: globalThis.AbortSignal.timeout(60000) });
      if (r.status === 204 || r.status === 404) return null;
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`HTTP ${r.status}`), { definitivo: true });
      // 429: Retry-After do portal ou backoff exponencial com jitter (teto 60 s), como no robô do PNCP (a6ce839).
      throw Object.assign(new Error(`HTTP ${r.status}`), { esperaMs: r.status === 429 ? esperaAposLimite(r.headers?.get?.("retry-after"), t) : 2000 * t });
    } catch (e) {
      if (e.definitivo || t >= tentativas) throw new Error(`${url.split("?")[0]}: ${e.message}`);
      await esperar(e.esperaMs ?? 2000 * t);
    }
  }
}
const esperaAposLimite = (retryAfter, t) => (Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : Math.min(60000, 5000 * 2 ** (t - 1)) * (0.5 + Math.random() / 2));

// A busca do PNCP recusa pagina × tam_pagina acima de 10.000 (HTTP 400 "Janela de resultados muito grande"): em 22/11
// SP tinha 14.292 atas com adesão e 202.313 contratos vigentes, MG 28.176 atas. UF que não cabe é lida por município.
const JANELA_BUSCA = 10000;

// Todas as páginas de uma consulta à busca do PNCP (500 por página, até a janela). manter(doc) escolhe o que fica na
// memória: SP tem 200 mil contratos vigentes e só os que vencem no horizonte interessam.
async function buscarPncp(parametros, op, manter = () => true) {
  const itens = [];
  let vistos = 0;
  let total = 0;
  for (let pagina = 1; pagina * 500 <= JANELA_BUSCA; pagina++) {
    const q = new URLSearchParams({ ...parametros, ordenacao: "-data", pagina: String(pagina), tam_pagina: "500" });
    const j = await obter(`${PNCP}/api/search?${q}`, op);
    const lote = j?.items || [];
    total = Number(j?.total || 0);
    vistos += lote.length;
    for (const d of lote) if (manter(d)) itens.push(d);
    if (lote.length < 500 || vistos >= total) break;
  }
  if (total > JANELA_BUSCA) console.warn(`busca do PNCP com ${total} documentos (${new URLSearchParams(parametros)}): lidos só os ${vistos} mais recentes`);
  return itens;
}

// Lotes de uma consulta por UF: "todos" (a UF inteira) quando cabe na janela; senão um lote por município (código IBGE,
// o mesmo que a busca do PNCP aceita em "municipios"). Conferido em 22/11: no AM a soma dos 62 municípios dá 6.961 dos
// 6.964 contratos vigentes da UF.
const municipiosCache = new Map();
async function lotesDaUf(parametros, uf, op) {
  const j = await obter(`${PNCP}/api/search?${new URLSearchParams({ ...parametros, ufs: uf, pagina: "1", tam_pagina: "1" })}`, op);
  if (Number(j?.total || 0) <= JANELA_BUSCA) return ["todos"];
  if (!municipiosCache.has(uf)) {
    const lista = (await obter(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`, op)) || [];
    municipiosCache.set(uf, lista.map((m) => String(m.id)).filter((c) => /^\d{7}$/.test(c)));
  }
  if (!municipiosCache.get(uf).length) throw new Error(`${uf}: lista de municípios do IBGE vazia`);
  return municipiosCache.get(uf);
}
const parametrosDoLote = (parametros, uf, lote) => ({ ...parametros, ufs: uf, ...(lote === "todos" ? {} : { municipios: lote }) });

// Páginas do Compras.gov dados abertos ({resultado, paginasRestantes}).
async function paginasCompras(caminho, parametros, op, maxPaginas = 40) {
  const todos = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const j = await obter(`${CG}${caminho}?${new URLSearchParams({ ...parametros, pagina: String(pagina), tamanhoPagina: "500" })}`, op);
    todos.push(...(j?.resultado || []));
    if (!j || !(j.paginasRestantes > 0)) break;
  }
  return todos;
}


// ---------- progresso e rodízio (rodadas) ----------

// Rodízio pelas 27 UFs: cada etapa (irp, UF:contrato, UF:ata, UF:pca) guarda quando fechou pela última vez; a rodada
// pega primeiro a que está pela metade, depois a mais antiga (nunca feita = mais antiga). Etapa fechada há menos de
// FRESCOR_HORAS não roda de novo. Até 22/11 o progresso era "do dia" e recomeçava todo dia pelo AM: o PCA nunca
// chegava a ser coletado e as outras 26 UFs nunca entravam.
const UFS_BRASIL = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");
const TIPOS_UF = ["contrato", "ata", "pca"];
const venceu = (ctx) => Date.now() > ctx.prazoFinal;
const grupoAtual = () => String(process.env.PROSPECCAO_GRUPO || "todas").replace(/[^a-z0-9]/gi, "");
const chaveEstado = () => `prospeccao_estado_${grupoAtual()}`;
const chaveCobertura = () => `prospeccao_cobertura_${grupoAtual()}`;

// Progresso em dados_robo (uma chave por grupo de UFs da matriz do workflow): etapas (início da volta em andamento,
// último fechamento e linhas), unidades já feitas da volta em andamento, órgãos por UF (o PCA precisa) e atas que o
// Compras.gov cobriu (a ata precisa entre rodadas). O estado antigo "do dia" (sem versao) é descartado.
async function carregarEstado(inicio, ler = (chave) => buscarBlob("dados_robo", chave)) {
  const salvo = process.env.PROSPECCAO_REINICIAR ? null : await ler(chaveEstado()).catch(() => null);
  const base = salvo && salvo.versao === 2 ? salvo : { versao: 2, desde: new Date(inicio).toISOString(), feitos: [], orgaos: {}, comItens: {}, etapas: {} };
  return { ...base, feitos: new Set(base.feitos), orgaos: base.orgaos || {}, comItens: base.comItens || {}, etapas: base.etapas || {} };
}
const estadoSerializavel = (est) => ({ ...est, feitos: [...est.feitos] });

// Ordem da rodada: em andamento primeiro, depois a mais antiga; sai a que fechou há menos de frescorHoras.
function filaEtapas(chaves, etapas, agora, frescorHoras) {
  const ultima = (k) => Date.parse(etapas[k]?.concluidaEm) || 0;
  const prioridade = (k) => (etapas[k]?.inicio ? -1 : ultima(k));
  return chaves.filter((k) => etapas[k]?.inicio || agora - ultima(k) >= frescorHoras * 36e5).sort((a, b) => prioridade(a) - prioridade(b));
}

// Etapa fechada: grava quando e quantas linhas, e esquece as unidades dela (a próxima volta refaz tudo).
function fecharEtapa(est, chave, agora = Date.now()) {
  const e = est.etapas[chave];
  e.concluidaEm = new Date(agora).toISOString();
  e.linhas = e.linhasAndamento || 0;
  delete e.inicio; delete e.linhasAndamento; delete e.atasComItens;
  const [uf, tipo] = chave.split(":");
  if (tipo) for (const k of [...est.feitos]) if (k.startsWith(`${tipo}:${uf}:`)) est.feitos.delete(k);
  if (tipo === "ata") delete est.comItens[uf];
}

// Etapas sem fechar há mais de horas (quem nunca fechou conta do início do estado): é o que vira erro do robô.
function etapasAtrasadas(chaves, est, horas, agora = Date.now()) {
  return chaves.filter((k) => agora - (Date.parse(est.etapas[k]?.concluidaEm) || Date.parse(est.desde) || 0) > horas * 36e5);
}

// Resumo pequeno que a tela e o Status das Ferramentas leem (dados_robo, chave prospeccao_cobertura_<grupo>).
function resumoCobertura(est, chaves, agora = Date.now()) {
  return {
    atualizadoEm: new Date(agora).toISOString(), grupo: grupoAtual(),
    etapas: Object.fromEntries(chaves.map((k) => {
      const e = est.etapas[k] || {};
      return [k, { concluidaEm: e.concluidaEm || null, linhas: e.linhas ?? null, emAndamento: Boolean(e.inicio) }];
    })),
  };
}

// Roda fn(chave) nas unidades que ainda faltam, até o prazo da rodada. true = todas feitas. Cada unidade fechada
// entra no progresso na hora: se a rodada morrer, a próxima recomeça dali. ctx.amostra (só MODO_SECO) corta a lista.
async function unidades(chaves, est, ctx, fn) {
  for (const k of ctx.amostra ? chaves.slice(0, ctx.amostra) : chaves) {
    if (est.feitos.has(k)) continue;
    if (venceu(ctx)) return false;
    if ((await fn(k)) === false) return false; // unidade com subunidades que não couberam na rodada: não marca
    est.feitos.add(k);
    await ctx.salvar(est);
  }
  return true;
}

// ---------- coleta por fonte ----------

function anotarOrgao(mapa, d) {
  const cnpj = cnpjOuNulo(d.orgao_cnpj);
  if (!cnpj) return;
  const o = mapa[cnpj] || { nome: d.orgao_nome, esfera: d.esfera_id, unidades: [] };
  if (d.unidade_codigo && !o.unidades.includes(String(d.unidade_codigo))) o.unidades.push(String(d.unidade_codigo));
  mapa[cnpj] = o;
}

async function etapaContrato(uf, est, ctx) {
  const parametros = { tipos_documento: "contrato", status: "vigente" };
  const mapa = (est.orgaos[uf] = est.orgaos[uf] || {});
  const lotes = await lotesDaUf(parametros, uf, ctx.op);
  let vistos = 0;
  let guardados = 0;
  const ok = await unidades(lotes.map((l) => `contrato:${uf}:${l}`), est, ctx, async (k) => {
    const contratos = await buscarPncp(parametrosDoLote(parametros, uf, k.split(":")[2]), ctx.op, (d) => {
      vistos++;
      anotarOrgao(mapa, d);
      return d.uf === uf && contratoInteressa(d, ctx.hoje, ctx.ate);
    });
    guardados += contratos.length;
    await gravar(contratos.map((d) => linhaContrato(d, ctx.coletadoEm)), null, ctx, `${uf} contrato`);
  });
  console.log(`${uf} contratos: ${vistos} vigentes lidos nesta rodada (${lotes.length} lote(s)), ${guardados} vencem até ${ctx.ate}${ok ? "" : "; continua na próxima rodada"}`);
  if (ok) await limpar(`tipo=eq.contrato&uf=eq.${uf}`, ctx);
  return ok;
}

// Itens de uma ata que não está no Compras.gov: itens da contratação de origem + resultado de cada um (fornecedor e valor).
// Ata por fornecedor (doc.fornecedor_ni preenchido) só fica com o resultado dele. memo: a mesma contratação serve várias atas.
async function itensAtaPncp(doc, ata, ctx, memo = new Map()) {
  const [, , cnpj, ano, seq] = String(doc.item_url || "").split("/");
  if (!/^\d{14}$/.test(cnpj || "") || !/^\d{4}$/.test(ano || "") || !/^\d+$/.test(seq || "")) return [];
  const base = `${PNCP}/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
  let pares = memo.get(base);
  if (!pares) {
    const max = num(process.env.ITENS_ATA_PNCP_MAX, 30);
    const itens = ((await obter(`${base}/itens?pagina=1&tamanhoPagina=${Math.min(max, 500)}`, ctx.op)) || []).filter((i) => i.temResultado !== false).slice(0, max);
    pares = [];
    // Resultados de 3 em 3 itens: uma ata de 60 itens leva 20 voltas em vez de 60 (cada chamada ainda respeita PAUSA_MS).
    for (let i = 0; i < itens.length; i += 3) {
      const lote = itens.slice(i, i + 3);
      const resultados = await Promise.all(lote.map((item) => obter(`${base}/itens/${item.numeroItem}/resultados`, ctx.op).catch(() => null)));
      lote.forEach((item, j) => (resultados[j] || []).forEach((res) => pares.push([item, res])));
    }
    memo.set(base, pares);
  }
  const so = cnpjOuNulo(doc.fornecedor_ni);
  return pares.filter(([, r]) => !r.dataCancelamento && (!so || cnpjOuNulo(r.niFornecedor) === so)).map(([i, r]) => linhaItemAtaPncp(i, r, ata, ctx.coletadoEm));
}

async function etapaAta(uf, est, ctx) {
  const parametros = { tipos_documento: "ata", status: "vigente", permite_adesao: "true" };
  const mapa = (est.orgaos[uf] = est.orgaos[uf] || {});
  const comItens = new Set(est.comItens[uf] || []);
  const lotes = await lotesDaUf(parametros, uf, ctx.op);
  let total = 0;
  // Um lote (a UF inteira ou um município) por vez; dentro dele, as unidades de sempre (UASG do Compras.gov, ata do PNCP).
  const ok = await unidades(lotes.map((l) => `ata:${uf}:lote:${l}`), est, ctx, async (kLote) => {
    const atas = await buscarPncp(parametrosDoLote(parametros, uf, kLote.split(":")[3]), ctx.op,
      (d) => d.uf === uf && !d.cancelado && dia(d.data_fim_vigencia) >= ctx.hoje);
    total += atas.length;
    atas.forEach((d) => anotarOrgao(mapa, d));
    const porAta = new Map(atas.map((d) => [d.numero_controle_pncp, linhaAta(d, ctx.coletadoEm)]));
    // Compras.gov: itens com fornecedor, quantidade, empenhado e máximo de adesão, por UASG gerenciadora (código numérico de até 6 dígitos).
    const gerenciadoras = [...new Set(atas.map((d) => String(d.unidade_codigo || "")).filter((c) => /^\d{5,6}$/.test(c)))];
    const cg = await unidades(gerenciadoras.map((u) => `ata:${uf}:cg:${u}`), est, ctx, async (k) => {
      const itens = await paginasCompras("/modulo-arp/2_consultarARPItem", {
        codigoUnidadeGerenciadora: k.split(":")[3], dataVigenciaInicialMin: hojeBrasilia(Date.now(), -730), dataVigenciaInicialMax: ctx.hoje,
      }, ctx.op);
      const linhas = [];
      for (const it of itens) {
        const ata = porAta.get(it.numeroControlePncpAta);
        if (!ata || it.itemExcluido || dia(it.dataVigenciaFinal) < ctx.hoje) continue;
        comItens.add(it.numeroControlePncpAta);
        linhas.push(linhaItemAta(it, ata, ctx.coletadoEm));
      }
      est.comItens[uf] = [...comItens];
      await gravar(linhas, null, ctx, `${uf} ata (Compras.gov)`);
    });
    if (!cg) return false;
    // Resto (fora do Compras.gov, ou UASG sem item vigente): itens e resultados pelo PNCP; sem item, fica a linha da ata.
    // Itens pelo PNCP custam ~8 chamadas por ata (medido no AM em 22/11: 40 atas, 400 chamadas com as UASGs); no Brasil
    // são ~130 mil atas fora do Compras.gov. Só as ATAS_PNCP_COM_ITENS mais recentes de cada UF por volta ganham itens;
    // as outras ficam com a linha da ata (objeto, órgão, vigência), que a busca por texto já acha, gravadas em lote.
    const memo = new Map();
    const teto = num(process.env.ATAS_PNCP_COM_ITENS, 300);
    const semItem = [];
    const descarregar = () => gravar(semItem.splice(0), null, ctx, `${uf} ata (PNCP sem item)`);
    const resto = new Map(atas.filter((d) => !comItens.has(d.numero_controle_pncp)).map((d) => [`ata:${uf}:pncp:${d.numero_controle_pncp}`, d]));
    try {
      return await unidades([...resto.keys()], est, ctx, async (k) => {
        const d = resto.get(k);
        const ata = porAta.get(d.numero_controle_pncp);
        if ((ctx.etapa?.atasComItens || 0) >= teto) {
          semItem.push(ata);
          if (semItem.length >= 500) await descarregar();
          return;
        }
        if (ctx.etapa) ctx.etapa.atasComItens = (ctx.etapa.atasComItens || 0) + 1;
        const itens = await itensAtaPncp(d, ata, ctx, memo);
        await gravar(itens.length ? itens : [ata], null, ctx, `${uf} ata (PNCP${itens.length ? " com itens" : " sem item"})`);
      });
    } finally {
      await descarregar();
    }
  });
  console.log(`${uf} atas com adesão lidas nesta rodada: ${total} (${lotes.length} lote(s); ${comItens.size} com itens do Compras.gov)${ok ? "" : "; continua na próxima rodada"}`);
  if (ok) await limpar(`tipo=eq.ata&uf=eq.${uf}`, ctx);
  return ok;
}

async function coletarIrps(ctx) {
  const { hoje, coletadoEm, op } = ctx;
  const docs = (await buscarPncp({ tipos_documento: "irp", status: "todos" }, op))
    .filter((d) => dia(d.prazo_manifestacao_interesse || d.data_fim_vigencia) >= hoje && !d.cancelado);
  const linhas = [];
  for (const d of docs) {
    for (let pagina = 1; pagina <= 20; pagina++) {
      const itens = (await obter(`${PNCP}/api/pncp/v1/orgaos/${d.orgao_cnpj}/irp/${d.ano}/${d.numero_sequencial}/itens?pagina=${pagina}&tamanhoPagina=50`, op)) || [];
      linhas.push(...itens.map((i) => linhaIrp(d, i, coletadoEm)));
      if (itens.length < 50) break;
    }
  }
  console.log(`IRPs abertas (Brasil): ${docs.length}, itens ${linhas.length}`);
  return linhas;
}

// PCA/PGC por órgão e ano (a unidade da rodada). Só as unidades do órgão que estão na UF; só data a partir de hoje.
async function coletarPcaOrgao(uf, cnpj, org, a, ctx) {
  const { op, coletadoEm } = ctx;
  const linhas = [];
  const unidadesPca = (await obter(`${PNCP}/api/pncp/v1/orgaos/${cnpj}/pca/${a}/consolidado/unidades`, op).catch(() => null)) || [];
  for (const u of unidadesPca.filter((x) => org.unidades.includes(String(x.codigoUnidade)))) {
    if (org.esfera === "F") {
      const itens = await paginasCompras("/modulo-pgc/1_consultarPgcDetalhe", { orgao: cnpj, anoPcaProjetoCompra: String(a), codigoUasg: String(u.codigoUnidade) }, op);
      linhas.push(...itens.map((i) => linhaPgc(i, org, uf, coletadoEm)));
      if (itens.length) continue; // PGC vazio: cai no PCA consolidado do PNCP
    }
    for (let pagina = 1; pagina <= 40; pagina++) {
      const itens = (await obter(`${PNCP}/api/pncp/v1/orgaos/${cnpj}/pca/${a}/${u.sequencialPca}/itens?pagina=${pagina}&tamanhoPagina=500`, op)) || [];
      linhas.push(...itens.map((i) => linhaPcaPncp(i, org, uf, coletadoEm)));
      if (itens.length < 500) break;
    }
  }
  return linhas.filter((l) => dentro(l.data_ref, ctx.hoje, ctx.ate));
}

async function etapaPca(uf, est, ctx) {
  const orgaos = est.orgaos[uf] || {};
  const ano = Number(ctx.hoje.slice(0, 4));
  const chaves = Object.keys(orgaos).flatMap((cnpj) => [ano, ano + 1].map((a) => `pca:${uf}:${cnpj}:${a}`));
  const ok = await unidades(chaves, est, ctx, async (k) => {
    const [, , cnpj, a] = k.split(":");
    await gravar(await coletarPcaOrgao(uf, cnpj, orgaos[cnpj], Number(a), ctx), null, ctx, `${uf} pca`);
  });
  // Só roda depois de contrato e ata da UF fecharem ao menos uma vez (lista de órgãos completa): pode limpar.
  if (ok) await limpar(`tipo=eq.pca&uf=eq.${uf}`, ctx);
  return ok;
}

// Adesões já usadas: 5_consultarAdesoesItem, uma consulta por item (ata + UASG + item). Só item de ata vigente do Compras.gov
// com limite de adesão, da UF, e no máximo ADESOES_POR_RODADA por rodada: os nunca consultados primeiro, depois os mais velhos.
async function consultarAdesoes(l, op) {
  const numeroItem = String(l.id).split("#")[1];
  let total = 0;
  for (let pagina = 1; pagina <= 5; pagina++) {
    const j = await obter(`${CG}/modulo-arp/5_consultarAdesoesItem?${new URLSearchParams({
      numeroAta: l.ata_numero, unidadeGerenciadora: l.unidade_codigo, numeroItem, pagina: String(pagina), tamanhoPagina: "100",
    })}`, op);
    total += somarAdesoes(j?.resultado);
    if (!j || !(j.paginasRestantes > 0)) break;
  }
  return total;
}

async function etapaAdesoes(uf, ctx) {
  const teto = num(process.env.ADESOES_POR_RODADA, 1500);
  const corte = new Date(Date.now() - num(process.env.ADESOES_VALIDADE_DIAS, 3) * 864e5).toISOString();
  const rotulo = `${uf} adesões consultadas`;
  let feitas = 0;
  while (feitas < teto && !venceu(ctx)) {
    const pendentes = await (await restFetch(`${TABELA}?${new URLSearchParams({
      select: "*", tipo: "eq.ata", uf: `eq.${uf}`, fonte: "eq.comprasgov_arp", maximo_adesao: "gt.0", ata_numero: "not.is.null", data_ref: `gte.${ctx.hoje}`,
      or: `(adesoes_em.is.null,adesoes_em.lt.${corte})`, order: "adesoes_em.asc.nullsfirst,id.asc", limit: String(Math.min(50, teto - feitas)),
    })}`)).json();
    if (!pendentes.length) return true;
    const feitos = [];
    // 2 consultas por vez. 429 (limite do portal) encerra a etapa nesta rodada: o item não é marcado e volta na próxima.
    let limitado = false;
    for (let i = 0; i < pendentes.length && !venceu(ctx) && !limitado; i += 2) {
      await Promise.all(pendentes.slice(i, i + 2).map(async (l) => {
        try { l.adesoes_usadas = await consultarAdesoes(l, ctx.op); } catch (e) {
          if (/HTTP 429/.test(e.message)) { limitado = true; return; }
          // Outra falha em um item não trava a fila: fica marcado como consultado (adesoes_usadas nulo = "não consultada") e volta depois da validade.
          console.warn(`${uf} adesões ${l.id}: ${e.message}`);
        }
        l.adesoes_em = new Date().toISOString();
        feitos.push(l);
      }));
    }
    await upsertEmLotes(TABELA, feitos, "id", num(process.env.TAMANHO_LOTE_BANCO, 500));
    feitas += feitos.length;
    ctx.gravadas[rotulo] = (ctx.gravadas[rotulo] || 0) + feitos.length;
    if (limitado) { console.warn(`${uf} adesões: portal respondeu 429, retoma na próxima rodada`); return false; }
  }
  return false;
}

// Mesma chave pode vir duas vezes (item repetido no DFD, ata em duas páginas): a última vence.
const semRepetir = (linhas) => [...new Map(linhas.map((l) => [l.id, l])).values()];

async function gravar(linhas, filtroLimpeza, ctx, rotulo) {
  const unicas = semRepetir(linhas);
  await upsertEmLotes(TABELA, unicas, "id", num(process.env.TAMANHO_LOTE_BANCO, 500));
  if (rotulo) ctx.gravadas[rotulo] = (ctx.gravadas[rotulo] || 0) + unicas.length;
  if (ctx.etapa) ctx.etapa.linhasAndamento = (ctx.etapa.linhasAndamento || 0) + unicas.length;
  if (filtroLimpeza) await limpar(filtroLimpeza, ctx);
  return unicas.length;
}
const limpar = (filtro, ctx) => restFetch(`${TABELA}?${filtro}&coletado_em=lt.${encodeURIComponent(ctx.coletadoEm)}`, { method: "DELETE" });

// Apaga data_ref < hoje um dia de cada vez (o mais antigo primeiro): cada DELETE é uma faixa curta do índice de data_ref.
// comNulo: também as linhas sem UF (só um grupo da matriz, o da IRP, para não repetir).
async function limparVencidos(hoje, ufs, comNulo, maxDias = 400) {
  const filtros = [...(ufs.length ? [`uf=in.(${ufs.join(",")})`] : []), ...(comNulo ? ["uf=is.null"] : [])];
  let faixas = 0;
  for (const filtro of filtros) {
    for (let i = 0; i < maxDias; i++) {
      const r = await restFetch(`${TABELA}?select=data_ref&${filtro}&data_ref=lt.${hoje}&order=data_ref.asc&limit=1`);
      const [maisAntigo] = await r.json();
      if (!maisAntigo?.data_ref) break;
      const corte = new Date(Date.parse(`${maisAntigo.data_ref}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
      await restFetch(`${TABELA}?${filtro}&data_ref=lt.${corte < hoje ? corte : hoje}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      faixas++;
    }
  }
  return faixas;
}

async function main({ seco = false } = {}) {
  const inicio = Date.now();
  const hoje = hojeBrasilia(inicio);
  const est = await carregarEstado(inicio);
  let salvoEm = 0;
  const ctx = {
    hoje, ate: hojeBrasilia(inicio, num(process.env.DIAS_HORIZONTE, 400)), coletadoEm: null, etapa: null, op: {}, gravadas: {},
    amostra: seco ? num(process.env.AMOSTRA_SECO, 0) : 0, prazoFinal: inicio + num(process.env.LIMITE_MINUTOS, 10) * 60000,
    // O estado tem os órgãos de cada UF (centenas de KB): grava no máximo a cada 30 s, e sempre ao fechar etapa.
    salvar: async (e, sempre = false) => {
      if (!sempre && Date.now() - salvoEm < 30000) return;
      salvoEm = Date.now();
      await salvarBlob("dados_robo", chaveEstado(), estadoSerializavel(e));
    },
  };
  const lista = (v, padrao) => String(v || padrao).split(",").map((s) => s.trim()).filter(Boolean);
  const ufs = lista(process.env.PROSPECCAO_UFS, UFS_BRASIL.join(",")).map((s) => s.toUpperCase()).filter((s) => UFS_BRASIL.includes(s));
  const tipos = lista(process.env.PROSPECCAO_TIPOS, TIPOS_UF.join(",")).map((t) => t.toLowerCase()).filter((t) => TIPOS_UF.includes(t));
  const chaves = [...(process.env.PROSPECCAO_IRP !== "0" ? ["irp"] : []), ...ufs.flatMap((uf) => tipos.map((t) => `${uf}:${t}`))];
  const fila = filaEtapas(chaves, est.etapas, inicio, num(process.env.FRESCOR_HORAS, 36));
  const pendentes = [];
  let falhas = 0;
  const fechou = (k) => Boolean(est.etapas[k]?.concluidaEm);
  const salvarCobertura = () => salvarBlob("dados_robo", chaveCobertura(), resumoCobertura(est, chaves));
  const funcoes = {
    irp: async () => { await gravar(await coletarIrps(ctx), "tipo=eq.irp", ctx, "irp"); return true; },
    contrato: (uf) => etapaContrato(uf, est, ctx), ata: (uf) => etapaAta(uf, est, ctx), pca: (uf) => etapaPca(uf, est, ctx),
  };

  for (const chave of fila) {
    if (venceu(ctx)) { pendentes.push(chave); continue; }
    const [uf, tipo] = chave === "irp" ? [null, "irp"] : chave.split(":");
    // PCA precisa da lista de órgãos da UF: espera contrato e ata (os desta rodada) fecharem ao menos uma vez.
    if (tipo === "pca" && !["contrato", "ata"].filter((t) => tipos.includes(t)).every((t) => fechou(`${uf}:${t}`))) { pendentes.push(chave); continue; }
    const e = (est.etapas[chave] = est.etapas[chave] || {});
    if (!e.inicio) { e.inicio = new Date().toISOString(); e.linhasAndamento = 0; }
    // Corte da limpeza = início da volta: o que a volta regravou fica, o que não voltou sai quando ela fecha.
    ctx.coletadoEm = e.inicio; ctx.etapa = e;
    const [t0, c0] = [Date.now(), chamadas];
    try {
      if (await funcoes[tipo](uf)) fecharEtapa(est, chave); else pendentes.push(chave);
    } catch (err) {
      falhas++; pendentes.push(chave);
      console.warn(`${chave} falhou (mantido o que já estava gravado; retoma na próxima rodada):`, err.message);
    }
    ctx.etapa = null;
    console.log(`${chave}: ${Math.round((Date.now() - t0) / 1000)} s, ${chamadas - c0} chamadas, ${e.concluidaEm && !e.inicio ? `fechou com ${e.linhas} linhas` : "pela metade"}`);
    await ctx.salvar(est, true);
    await salvarCobertura().catch((err) => console.warn("cobertura não gravada:", err.message));
  }
  if (!seco) {
    for (const uf of ufs) {
      if (!fechou(`${uf}:ata`) || venceu(ctx)) continue;
      try { if (!(await etapaAdesoes(uf, ctx))) pendentes.push(`${uf}:adesoes`); } catch (e) { falhas++; console.warn(`${uf} adesões falhou:`, e.message); }
    }
    // O que já passou da data (prazo de IRP, fim de vigência, data desejada) sai da tabela. Só as UFs do grupo (os 3
    // jobs da matriz terminam juntos e brigavam pelas mesmas linhas) e um dia vencido por vez (DELETE único estourava
    // o statement timeout, 57014, em 22-23/11). Falhar aqui não perde dado: a tela já filtra data_ref >= hoje.
    try { await limparVencidos(hoje, ufs, process.env.PROSPECCAO_IRP !== "0"); } catch (e) {
      console.warn(`::warning::Limpeza dos vencidos ficou para a próxima rodada: ${e.message}`);
    }
  }
  await salvarCobertura().catch(() => {});
  const resumo = Object.entries(ctx.gravadas).map(([k, v]) => `${k}=${v}`).join("; ");
  console.log(`Prospecção ${hoje} (grupo ${grupoAtual()}), rodada de ${Math.round((Date.now() - inicio) / 1000)} s e ${chamadas} chamadas às fontes: ${resumo || "nada novo gravado"}. `
    + `Etapas com coleta completa: ${chaves.filter(fechou).length}/${chaves.length}. ${pendentes.length ? `Falta: ${pendentes.join(", ")} (a próxima rodada retoma).` : "Tudo em dia."}`);
  // Falha pontual ou etapa pela metade é o normal do rodízio (aviso). Erro do robô (e e-mail) só quando alguma etapa
  // passa de LIMITE_HORAS_SEM_COBERTURA sem fechar, como no robô do PNCP (a6ce839).
  const limiteHoras = num(process.env.LIMITE_HORAS_SEM_COBERTURA, 48);
  const atrasadas = etapasAtrasadas(chaves, est, limiteHoras);
  if (atrasadas.length && !seco) {
    console.error(`Sem coleta completa há mais de ${limiteHoras} h: ${atrasadas.join(", ")}`);
    process.exitCode = 1;
  } else if (falhas) console.warn(`${falhas} falha(s) nesta rodada; nenhuma etapa atrasada além de ${limiteHoras} h.`);
  return { est, chaves };
}

// MODO_SECO=1: rodada real contra PNCP/Compras.gov sem chave e sem gravar nada (banco em memória). Imprime as contagens.
//   MODO_SECO=1 PROSPECCAO_UFS=AM,SP PROSPECCAO_TIPOS=ata,pca PROSPECCAO_IRP=0 AMOSTRA_SECO=20 LIMITE_MINUTOS=15 node scripts/coletar_prospeccao.js
async function modoSeco() {
  const blobs = new Map();
  const linhas = new Map();
  Object.assign(banco, {
    buscarBlob: async (_t, k) => blobs.get(k) ?? null,
    salvarBlob: async (_t, k, d) => { blobs.set(k, JSON.parse(JSON.stringify(d))); },
    upsertEmLotes: async (_t, ls) => { ls.forEach((l) => linhas.set(l.id, l)); return ls.length; },
    restFetch: async () => ({ ok: true, json: async () => [] }),
  });
  const { est, chaves } = await main({ seco: true });
  const contagem = {};
  for (const l of linhas.values()) contagem[`${l.uf || "BR"} ${l.tipo}`] = (contagem[`${l.uf || "BR"} ${l.tipo}`] || 0) + 1;
  console.log("[seco] linhas por UF e tipo (nada foi gravado):", JSON.stringify(contagem));
  console.log("[seco] etapas:", chaves.map((k) => `${k}=${est.etapas[k]?.concluidaEm ? `fechou (${est.etapas[k].linhas} linhas)` : "pela metade"}`).join("; "));
  for (const [nome, re] of [["limpeza", /limpeza/], ["expediente", /expediente/], ["construção", /construc/]]) {
    const achou = [...linhas.values()].filter((l) => re.test(l.busca));
    console.log(`[seco] "${nome}": ${achou.length} linhas`, achou.slice(0, 2).map((l) => `${l.uf} ${l.tipo}: ${(l.descricao || l.objeto || "").slice(0, 70)}`));
  }
}

if (require.main === module) (process.env.MODO_SECO === "1" ? modoSeco() : main()).catch((e) => { console.error(e); process.exit(1); });

module.exports = {
  hojeBrasilia, normalizar, desfazerMojibake, nomeBusca, contratoInteressa, linhaContrato, linhaAta, linhaItemAta, linhaItemAtaPncp, somarAdesoes, linhaIrp, linhaPcaPncp, linhaPgc,
  semRepetir, obter, unidades, carregarEstado, estadoSerializavel, itensAtaPncp, consultarAdesoes,
  filaEtapas, fecharEtapa, etapasAtrasadas, limparVencidos, resumoCobertura, esperaAposLimite, UFS_BRASIL, buscarPncp, lotesDaUf, etapaAta, banco,
};
