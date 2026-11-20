// Pagômetro: "este ente costuma pagar em dia?" a partir do RREO Anexo 7 (Restos a Pagar) do SICONFI/Tesouro.
// Metodologia em _historico/pagometro-metodologia-20261120.md (fora do repositório). Funções puras, sem rede:
// a chamada ao Tesouro fica no handler (pagometro.js), aqui só a URL e a conta.
//
// Linha usada: "RESTOS A PAGAR (EXCETO INTRA-ORÇAMENTÁRIOS) (I)" do 6º bimestre (ano fechado), que soma
// todos os poderes e a administração indireta do ente. Contas que interessam ao fornecedor (o serviço já foi
// entregue/liquidado e ficou para pagar no ano seguinte):
//   a = processados de exercícios anteriores ao último   b = processados inscritos em 31/12 do ano anterior
//   c = processados pagos no ano   d = processados cancelados no ano
//   h = não processados que foram liquidados no ano   i = não processados pagos no ano
const URL_SICONFI = "https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo";
const LINHA = /^RESTOS A PAGAR \(EXCETO INTRA/i;
const CONTAS = {
  a: "RestosAPagarProcessadosENaoProcessadosLiquidadosInscritosEmExerciciosAnteriores",
  b: "RestosAPagarProcessadosENaoProcessadosLiquidadosInscritosEmExercicioAnterior",
  c: "RestosAPagarProcessadosENaoProcessadosLiquidadosPagos",
  d: "RestosAPagarProcessadosENaoProcessadosLiquidadosCancelados",
  h: "RestosAPagarNaoProcessadosLiquidados",
  i: "RestosAPagarNaoProcessadosPagos",
};
// Limites do semáforo (por quê: ver a metodologia). verde exige os três; vermelho basta um.
const LIMITES = { pagoVerde: 0.9, pagoVermelho: 0.7, canceladoVerde: 0.05, canceladoVermelho: 0.15, antigoVerde: 0.2, antigoVermelho: 0.5 };

// 7 dígitos = município (IBGE); 2 dígitos = estado ou DF (código IBGE da UF).
const esferaDoEnte = (id) => (/^\d{7}$/.test(String(id)) ? "M" : /^\d{2}$/.test(String(id)) ? "E" : null);

function urlRreo(idEnte, ano) {
  const q = new URLSearchParams({ an_exercicio: String(ano), nr_periodo: "6", co_tipo_demonstrativo: "RREO",
    no_anexo: "RREO-Anexo 07", co_esfera: esferaDoEnte(idEnte), id_ente: String(idEnte) });
  return `${URL_SICONFI}?${q}`;
}

const proporcao = (parte, todo) => (todo > 0 ? parte / todo : null);

// items = resposta .items do SICONFI. Devolve null se o ente não publicou o anexo (nenhuma linha útil).
function calcular(items, { idEnte, ano, fonte }) {
  const linhas = (Array.isArray(items) ? items : []).filter((l) => LINHA.test(String(l?.conta || "")));
  if (!linhas.length) return null;
  const v = {};
  for (const [k, conta] of Object.entries(CONTAS)) {
    const l = linhas.find((x) => x.cod_conta === conta);
    v[k] = Number.isFinite(Number(l?.valor)) ? Number(l.valor) : 0;
  }
  const inscritos = v.a + v.b;
  const devido = inscritos + v.h;
  const ind = {
    devido: round2(devido), pago: round2(v.c + v.i), cancelado: round2(v.d), antigos: round2(v.a),
    taxaPago: proporcao(v.c + v.i, devido), taxaCancelado: proporcao(v.d, inscritos), taxaAntigo: proporcao(v.a, inscritos),
  };
  return { id_ente: String(idEnte), esfera: esferaDoEnte(idEnte), nome: String(linhas[0].instituicao || "").slice(0, 300) || null,
    uf: /^[A-Z]{2}$/.test(linhas[0].uf) ? linhas[0].uf : null, exercicio: ano, semaforo: semaforo(ind), indicadores: ind, fonte };
}

function semaforo({ devido, taxaPago, taxaCancelado, taxaAntigo }) {
  // Nada deixado para o ano seguinte: pagou tudo o que foi entregue dentro do próprio ano.
  if (!(devido > 0)) return "verde";
  const L = LIMITES;
  if (taxaPago < L.pagoVermelho || (taxaCancelado ?? 0) > L.canceladoVermelho || (taxaAntigo ?? 0) > L.antigoVermelho) return "vermelho";
  if (taxaPago >= L.pagoVerde && (taxaCancelado ?? 0) <= L.canceladoVerde && (taxaAntigo ?? 0) <= L.antigoVerde) return "verde";
  return "amarelo";
}

function round2(n) { return Math.round(n * 100) / 100; }

// ---- Prazo de pagamento em dias (média de 24 e 36 meses) ----------------------------------------------------
// Conta: dias entre a liquidação (entrega atestada) e o pagamento da mesma despesa. Só onde há data de cada
// fase em dado aberto: órgão federal (Portal da Transparência, chave TRANSPARENCIA_TOKEN) e municípios de SP
// (TCE-SP, sem chave; a capital é do TCM-SP e fica de fora). Coleta pesada: robô scripts/coletar_pagometro_prazos.js.
const MIN_AMOSTRA = 10; // menos pagamentos que isso não vira média (não inventa prazo com 2 casos)
const IBGE_SAO_PAULO_CAPITAL = "3550308";

// chave = "F:<UG de 6 dígitos>" ou "M:<IBGE>"; devolve a fonte ou null (sem dado público de prazo).
function fontePrazo(chave) {
  const c = String(chave || "");
  if (/^F:\d{6}$/.test(c)) return "transparencia";
  if (/^M:35\d{5}$/.test(c) && c !== `M:${IBGE_SAO_PAULO_CAPITAL}`) return "tce-sp";
  return null;
}

// "dd/mm/aaaa" ou "aaaa-mm-dd..." -> "aaaa-mm-dd"; outra coisa -> null.
function dataIso(v) {
  const s = String(v || "");
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
const dias = (de, ate) => Math.round((Date.parse(ate) - Date.parse(de)) / 864e5);

// eventos: [{ chave, tipo: "liquidacao"|"pagamento", data: "aaaa-mm-dd" }]. Cada pagamento casa com a liquidação
// mais recente da mesma despesa (chave) até a data dele; pagamento sem liquidação conhecida fica de fora.
function prazosDePagamento(eventos, agora = Date.now()) {
  const liq = new Map();
  for (const e of eventos) if (e.tipo === "liquidacao" && e.data) (liq.get(e.chave) || liq.set(e.chave, []).get(e.chave)).push(e.data);
  const janela = (meses) => { const d = new Date(agora); d.setUTCMonth(d.getUTCMonth() - meses); return d.toISOString().slice(0, 10); };
  const [de24, de36] = [janela(24), janela(36)];
  const s = { m24: [], m36: [] };
  for (const e of eventos) {
    if (e.tipo !== "pagamento" || !e.data || e.data < de36) continue;
    const anteriores = (liq.get(e.chave) || []).filter((d) => d <= e.data);
    if (!anteriores.length) continue;
    const d = dias(anteriores.reduce((a, b) => (a > b ? a : b)), e.data);
    s.m36.push(d);
    if (e.data >= de24) s.m24.push(d);
  }
  const media = (l) => (l.length >= MIN_AMOSTRA ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null);
  return { dias_24m: media(s.m24), amostra_24m: s.m24.length, dias_36m: media(s.m36), amostra_36m: s.m36.length };
}

// Linhas da API do TCE-SP (/api/json/despesas/<municipio>/<ano>/<mes>): só fornecedor com CNPJ (fora folha e
// pessoa física). A despesa é órgão + número do empenho.
function eventosTceSp(linhas) {
  const tipo = { "Valor Liquidado": "liquidacao", "Valor Pago": "pagamento" };
  return (Array.isArray(linhas) ? linhas : [])
    .filter((l) => tipo[l?.evento] && /CNPJ/.test(String(l.id_fornecedor || "")))
    .map((l) => ({ chave: `${l.orgao}|${l.nr_empenho}`, tipo: tipo[l.evento], data: dataIso(l.dt_emissao_despesa) }));
}

// Portal da Transparência: um pagamento (/despesas/documentos, fase 3) e os documentos relacionados a ele
// (/despesas/documentos-relacionados): as liquidações viram eventos da mesma chave (o documento do pagamento).
function eventosFederal(pagamento, relacionados) {
  const chave = String(pagamento?.documento || "");
  const liquidacoes = (Array.isArray(relacionados) ? relacionados : [])
    .filter((r) => /liquida/i.test(String(r?.fase || "")))
    .map((r) => ({ chave, tipo: "liquidacao", data: dataIso(r.data) }));
  return [{ chave, tipo: "pagamento", data: dataIso(pagamento?.data) }, ...liquidacoes];
}

// Nome do município no endereço do TCE-SP ("Águas de Lindóia" -> "aguas-de-lindoia").
const slugTceSp = (nome) => String(nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

module.exports = { URL_SICONFI, CONTAS, LIMITES, esferaDoEnte, urlRreo, calcular, semaforo,
  MIN_AMOSTRA, fontePrazo, dataIso, prazosDePagamento, eventosTceSp, eventosFederal, slugTceSp };
