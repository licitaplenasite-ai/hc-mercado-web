// Adaptador dos processos de compra da FAEPI no Portal da Transparência do Conveniar (contrato em
// scripts/fontes/README.md). É daqui que saem os "SM/798/2026" que o ConLicitação mostra: no portal o mesmo
// processo aparece como "Seleção de Fornecedores - SF 7982026" (número 798, ano 2026).
//
// De onde vêm os dados (conferido em 25/11/2026; página pública, sem login nem captcha; robots.txt inexistente):
//   GET https://faepi.conveniar.com.br/portaltransparencia/Default.aspx?rdbTipoExtrato=1&txtPeriodoProcessoCompra=
//       dd/mm/aaaa a dd/mm/aaaa&...&pagina=processocompra      (rdbTipoExtrato=1 = "Processos em andamento")
//   HTML com um bloco por processo: nº do processo, modalidade+número, categoria, financiadora, projeto e itens.
//   O portal não mostra data nem prazo por processo, só filtra por período. Por isso a busca é feita por dia nos
//   últimos JANELA_ABERTO_DIAS dias (a publicação vira esse dia) e num bloco só antes disso.
//
// Fora daqui de propósito:
//   - Inexigibilidade (IL): contratação direta, não há disputa.
//   - Concorrência (CO): é o edital publicado no site (faepi.js); conferido pelo projeto do CO 29/2026 = edital 2026-122.
//   - Nome do coordenador do projeto: dado pessoal, não é lido.
// shortcut: sem prazo no portal, "aberto" = processo em andamento com até JANELA_ABERTO_DIAS dias; se a FAEPI
// passar a publicar prazo, trocar pela data real.
const { decodificar, textoDoHtml } = require("./html_texto");

const BASE = "https://faepi.conveniar.com.br/portaltransparencia/Default.aspx";
const FONTE = {
  id: "faepi_cotacoes",
  nome: "FAEPI — Fundação de Apoio do IFAM (processos de compra no Conveniar)",
  portal: "Portal do Fornecedor FAEPI (Conveniar)",
  paginaOficial: `${BASE}#processocompra`,
};
const ORGAO = { nome: "FUNDACAO DE APOIO AO ENSINO, PESQUISA, EXTENSAO E INTERIORIZACAO DO IFAM - FAEPI", cnpj: "04623300000188", uf: "AM", municipio: "Manaus" };
const JANELA_ABERTO_DIAS = 30;
const MODALIDADES_IGNORADAS = /^(IL|CO)$/;
const MAX_ITENS_NO_OBJETO = 3;

const dataPt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const somarDias = (iso, dias) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);

function urlPeriodo(deIso, ateIso) {
  const q = new URLSearchParams({
    rdbTipoExtrato: "1", txtPeriodoProcessoCompra: `${dataPt(deIso)} a ${dataPt(ateIso)}`, txtReferenciaConvenio: "",
    ddlProcessoCompraCategoria: "0", ddlProcessoCompraModalidade: "0", pagina: "processocompra",
  });
  return `${BASE}?${q}#processocompra`;
}

// Períodos de busca, do mais novo ao mais velho: um por dia nos JANELA_ABERTO_DIAS dias (a publicação fica exata;
// o volume baixado é o mesmo de uma busca só) e um bloco com o resto até desdeIso, só para fechar o que envelheceu.
// O portal limita o período a 1 ano; o bloco fica abaixo disso (RETENCAO_DIAS do coletor = 120).
function periodos(hojeIso, desdeIso) {
  const saida = [];
  for (let i = 0; i < JANELA_ABERTO_DIAS; i++) {
    const dia = somarDias(hojeIso, -i);
    if (dia < desdeIso) return saida;
    saida.push({ de: dia, ate: dia });
  }
  const fimAntigos = somarDias(hojeIso, -JANELA_ABERTO_DIAS);
  if (fimAntigos >= desdeIso) saida.push({ de: desdeIso, ate: fimAntigos });
  return saida;
}

// "Seleção de Fornecedores - SF 7982026" -> { nome, sigla: "SF", numero: "798", ano: 2026 }.
function lerModalidade(txt) {
  const m = /^(.*?)\s*-\s*([A-Z]{2,4})\s*(\d+)(\d{4})\s*$/.exec(limpo(txt));
  return m ? { nome: m[1], sigla: m[2], numero: m[3], ano: Number(m[4]) } : null;
}
const limpo = (txt) => decodificar(String(txt || "")).replace(/\s+/g, " ").trim();
const campo = (bloco, nome) => {
  const m = new RegExp(`_${nome}"[^>]*>([^<]*)<`).exec(bloco);
  return m ? limpo(m[1]) : "";
};

// HTML da consulta -> processos [{ processo, modalidade, categoria, financiadora, projeto, itens: [produto] }].
function processosDaPagina(html) {
  const blocos = String(html).split('<div class="processocompra-info">').slice(1);
  return blocos.map((bloco) => ({
    processo: campo(bloco, "NumProcesso"),
    modalidade: campo(bloco, "Modalidade"),
    categoria: campo(bloco, "Categoria"),
    financiadora: campo(bloco, "Financiadora"),
    projeto: campo(bloco, "Projeto"),
    itens: [...bloco.matchAll(/<tr class="gridRow">\s*<td[^>]*>[^<]*<\/td><td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textoDoHtml(m[1])).filter(Boolean),
  })).filter((p) => p.processo && p.modalidade);
}

function itemDoProcesso(p, periodo, hojeIso) {
  const mod = lerModalidade(p.modalidade);
  if (!mod) return null;
  const unicos = [...new Set(p.itens)];
  const nomes = unicos.slice(0, MAX_ITENS_NO_OBJETO).join("; ");
  const mais = unicos.length > MAX_ITENS_NO_OBJETO ? ` e mais ${unicos.length - MAX_ITENS_NO_OBJETO} item(ns)` : "";
  const quem = p.financiadora ? ` Projeto financiado por: ${p.financiadora}.` : "";
  return {
    idExterno: `${mod.sigla}-${mod.numero}/${mod.ano}`,
    aberto: !MODALIDADES_IGNORADAS.test(mod.sigla) && periodo.de >= somarDias(hojeIso, -JANELA_ABERTO_DIAS),
    objeto: `${p.categoria || mod.nome}: ${nomes || "itens no portal"}${mais}.${quem}`,
    modalidade: mod.nome,
    processo: `${mod.sigla} ${mod.numero}/${mod.ano} (processo ${p.processo})`,
    numero: mod.numero,
    ano: mod.ano,
    publicacao: `${periodo.de}T00:00:00`,
    encerramento: null,
    orgao: ORGAO,
    linkOficial: urlPeriodo(periodo.de, periodo.ate),
    linkEdital: null,
    versao: `${p.processo}|${p.itens.length}`,
  };
}

async function listar({ cliente, desdeIso, tempoRestanteMs = () => Infinity, hojeIso = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10) }) {
  const vistos = new Map();
  let consultas = 0;
  for (const periodo of periodos(hojeIso, desdeIso)) {
    if (tempoRestanteMs() < 20000) break;
    const html = await cliente.texto(urlPeriodo(periodo.de, periodo.ate));
    consultas += 1;
    if (!/id="FormConsultaProcessoCompra"/.test(html)) throw new Error("FAEPI/Conveniar: formulário de processos de compra não encontrado (a estrutura mudou?)");
    for (const p of processosDaPagina(html)) {
      const item = itemDoProcesso(p, periodo, hojeIso);
      if (item && !vistos.has(item.idExterno)) vistos.set(item.idExterno, item);
    }
  }
  if (!consultas) throw new Error("FAEPI/Conveniar: sem tempo para nenhuma consulta");
  return [...vistos.values()];
}

// Tudo já vem da listagem (o portal não tem página por processo nem prazo).
const detalhe = async (item) => item;
const anexos = () => [];

module.exports = { FONTE, ORGAO, listar, detalhe, anexos, periodos, lerModalidade, processosDaPagina, itemDoProcesso, urlPeriodo };
