/* global module */
// Pagômetro (BETA) no resumo do edital: "este ente costuma pagar em dia?". Descobre o ente (município ou estado)
// do órgão, pede /api/pagometro e mostra o semáforo com data e fonte. Órgão federal não tem semáforo (o RREO do
// SICONFI é por ente, e a União paga pela Conta Única; ver _historico/pagometro-metodologia-20261120.md).
// Prazo médio de pagamento em dias (24 e 36 meses): /api/pagometro?prazo=F:<UG> (federal, pela UASG do edital)
// ou M:<IBGE> (município). Onde não há fonte pública de datas, a tela diz "sem dado".
// O código IBGE do município sai da base CAPAG já servida (data/capag-municipios.json): nada novo para baixar.
// Visual novo (20/11/2026): aguarda aprovação.
(function (global) {
  "use strict";
  const UF_IBGE = { RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26",
    AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53" };
  const normalizar = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ'’]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const SELOS = {
    verde: ["Costuma pagar em dia", "#1e7b3a", "#e6f4ea"],
    amarelo: ["Paga, mas deixa parte das contas atrasar", "#8a5a00", "#fff4d6"],
    vermelho: ["Histórico de atraso relevante", "#a3221b", "#fde8e6"],
    sem_dados: ["Sem dados recentes no Tesouro", "#4a5565", "#eef0f3"],
  };

  // Esfera do PNCP (M/E/D/F); sem ela, só o nome do órgão quando não deixa dúvida.
  function esferaDe(edital) {
    const e = String(edital.esferaId || "").toUpperCase();
    if (e) return e === "D" ? "E" : e;
    const orgao = normalizar(edital.orgao);
    if (/^(municipio|prefeitura)\b/.test(orgao)) return "M";
    if (/^(estado|governo do estado)\b/.test(orgao)) return "E";
    return "";
  }

  function enteDoEdital(edital = {}, baseCapag = null) {
    const uf = String(edital.uf || "").toUpperCase();
    const esfera = esferaDe(edital);
    // UASG do PNCP = código da UG no SIAFI na maior parte do governo federal (shortcut: sem tabela UASG->UG; ver metodologia).
    if (esfera === "F") return { motivo: "Órgão federal: o semáforo de restos a pagar (SICONFI) é só de municípios e estados.",
      prazo: /^\d{6}$/.test(String(edital.codigoUnidade || "")) ? `F:${edital.codigoUnidade}` : null };
    if (esfera === "E") return UF_IBGE[uf] ? { id: UF_IBGE[uf], rotulo: `Governo do estado (${uf})` } : { motivo: "Estado do órgão não identificado." };
    if (esfera !== "M") return { motivo: "Não foi possível saber se o órgão é municipal ou estadual." };
    if (/^\d{7}$/.test(String(edital.codigoMunicipioIbge || ""))) return { id: String(edital.codigoMunicipioIbge), prazo: `M:${edital.codigoMunicipioIbge}`, rotulo: `Município de ${edital.municipio || ""} (${uf})` };
    const nome = normalizar(edital.municipio);
    const achados = (baseCapag?.municipios || []).filter((m) => m.uf === uf && normalizar(m.municipio) === nome);
    if (achados.length !== 1) return { motivo: "Município do órgão não localizado de forma inequívoca." };
    return { id: achados[0].ibge, prazo: `M:${achados[0].ibge}`, rotulo: `Município de ${achados[0].municipio} (${uf})` };
  }

  const pct = (v) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "—");
  const reais = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

  // Frases do painel a partir da resposta da API (puras, testadas).
  function linhas(r) {
    const i = r.indicadores || {};
    if (r.semaforo === "sem_dados") return ["O ente não entregou ao Tesouro o relatório de restos a pagar do fim de ano nos dois últimos anos. Falta de dado é sinal de atenção, não prova de atraso."];
    if (!(i.devido > 0)) return [`Em ${r.exercicio}, não ficaram contas de entregas já feitas para pagar no ano seguinte.`];
    return [
      `Pagou ${pct(i.taxaPago)} das contas de entregas já feitas que estavam pendentes em ${r.exercicio} (${reais(i.pago)} de ${reais(i.devido)}).`,
      `Cancelou ${pct(i.taxaCancelado)} das contas já entregues que vinham do ano anterior.`,
      `${pct(i.taxaAntigo)} dessas contas pendentes eram de antes de ${r.exercicio - 1}.`,
    ];
  }

  const FONTES_PRAZO = { "tce-sp": "TCE-SP (dados abertos de despesas municipais)", transparencia: "Portal da Transparência do governo federal (CGU)" };
  // Frase do prazo médio de pagamento (pura, testada). Nunca estima: sem amostra suficiente, diz quantos casos há.
  function linhaPrazo(p) {
    const s = p?.situacao;
    if (s === "sem_fonte" || !p) return "Prazo médio de pagamento em dias: sem dado público de datas de pagamento para este ente (hoje há para órgãos federais e municípios de SP).";
    if (s === "fila_cheia") return "Prazo médio de pagamento: a fila de cálculo está cheia agora. Tente de novo mais tarde.";
    const temNumero = p.coletado_em && (p.amostra_24m > 0 || p.amostra_36m > 0 || s === "pronto");
    if (!temNumero) return s === "falhou" ? "Prazo médio de pagamento: a fonte pública não respondeu no último cálculo. Nova tentativa em 1 dia."
      : "Prazo médio de pagamento: calculando com dados públicos. Abra o resumo de novo em algumas horas.";
    const janela = (d, n) => (d != null ? `${d} dias (${n} pagamentos)` : `amostra pequena (${n} pagamentos), sem média`);
    return `Prazo médio entre a entrega atestada (liquidação) e o pagamento: em 24 meses, ${janela(p.dias_24m, p.amostra_24m)}; em 36 meses, ${janela(p.dias_36m, p.amostra_36m)}.`
      + (s === "pendente" ? " Atualizando." : "");
  }

  async function montarPrazo(caixa, chave, requisitar, texto) {
    const bloco = texto("Consultando o prazo médio de pagamento...");
    caixa.append(bloco);
    let p;
    try {
      const resp = await requisitar(`/api/pagometro?prazo=${encodeURIComponent(chave)}`);
      p = await resp.json().catch(() => null);
      if (!resp.ok || !p?.situacao) throw new Error(p?.erro || "O prazo de pagamento não respondeu agora.");
    } catch (e) { bloco.textContent = e.message; return; }
    bloco.textContent = linhaPrazo(p) + (FONTES_PRAZO[p.fonte] && p.coletado_em && p.situacao !== "falhou" ? ` Fonte: ${FONTES_PRAZO[p.fonte]}${p.nome ? `, ${p.nome}` : ""}; calculado em ${dataBr(p.coletado_em)}.` : "");
    bloco.className = "pagometro-prazo";
  }

  function estilo(doc) {
    if (doc.getElementById("pagometro-estilo")) return;
    const s = doc.createElement("style");
    s.id = "pagometro-estilo";
    s.textContent = ".pagometro{border:1px solid #d8dde6;border-radius:10px;padding:12px 14px;margin:10px 0;background:#fff;overflow-wrap:anywhere}"
      + ".pagometro h4{margin:0 0 6px;font-size:14px}.pagometro .pagometro-selo{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;font-size:13px}"
      + ".pagometro ul{margin:8px 0;padding-left:18px;font-size:13px}.pagometro small{display:block;color:#4a5565;font-size:12px;line-height:1.4}"
      + ".pagometro small.pagometro-prazo{color:#1f2937;font-size:13px;margin-top:8px;padding-top:8px;border-top:1px solid #e5e8ee}";
    doc.head.appendChild(s);
  }

  async function montar({ alvo, edital, baseCapag, requisitar, doc = global.document }) {
    if (!alvo) return;
    estilo(doc);
    alvo.innerHTML = "";
    const caixa = doc.createElement("div"); // <section> não: o painel esconde toda section fora da aba ativa
    caixa.className = "pagometro";
    caixa.setAttribute("aria-live", "polite");
    const titulo = doc.createElement("h4");
    titulo.textContent = "Pagômetro (BETA): este ente costuma pagar em dia?";
    const corpo = doc.createElement("div");
    caixa.append(titulo, corpo);
    alvo.append(caixa);
    const texto = (t) => { const s = doc.createElement("small"); s.textContent = t; return s; };
    const ente = enteDoEdital(edital, baseCapag);
    if (!ente.prazo) caixa.append(texto(linhaPrazo(null)));
    const prazo = ente.prazo ? montarPrazo(caixa, ente.prazo, requisitar, texto) : null;
    if (!ente.id) { corpo.append(texto(ente.motivo)); return prazo; }
    corpo.append(texto(`Consultando dados públicos do Tesouro para ${ente.rotulo}...`));
    let r;
    try {
      const resp = await requisitar(`/api/pagometro?ente=${encodeURIComponent(ente.id)}`);
      r = await resp.json().catch(() => null);
      if (!resp.ok || !r?.semaforo) throw new Error(r?.erro || "O Pagômetro não respondeu agora.");
    } catch (e) { corpo.replaceChildren(texto(e.message)); return prazo; }
    const [rotulo, cor, fundo] = SELOS[r.semaforo] || SELOS.sem_dados;
    const selo = doc.createElement("span");
    selo.className = "pagometro-selo";
    selo.style.color = cor; selo.style.background = fundo;
    selo.textContent = rotulo;
    const ul = doc.createElement("ul");
    for (const l of linhas(r)) { const li = doc.createElement("li"); li.textContent = l; ul.append(li); }
    const fonte = doc.createElement("a");
    fonte.href = /^https:\/\/apidatalake\.tesouro\.gov\.br\//.test(r.fonte) ? r.fonte : "https://siconfi.tesouro.gov.br/";
    fonte.target = "_blank"; fonte.rel = "noopener noreferrer"; fonte.textContent = "Ver dado bruto no Tesouro";
    const rodape = texto(`Indicador com base em dados públicos que o próprio ente declara ao Tesouro Nacional (SICONFI, RREO Anexo 7 - Restos a Pagar${r.exercicio ? `, exercício ${r.exercicio}` : ""}). `
      + `Vale para ${r.nome || ente.rotulo} como um todo, não para um contrato. Consultado em ${dataBr(r.coletado_em)}. `);
    rodape.append(fonte);
    corpo.replaceChildren(selo, ul, rodape);
    return prazo;
  }

  const api = { enteDoEdital, linhas, linhaPrazo, montar, UF_IBGE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.LicitaPagometro = api;
})(globalThis);
