// Robô das "fontes fora do PNCP": roda cada adaptador de scripts/fontes/ (contrato em scripts/fontes/README.md)
// e grava as oportunidades na mesma tabela que o painel ("Encontrar licitações", edições do boletim) e o
// boletim por e-mail já leem: oportunidades_abertas, com chave própria "fonte:<id>:<processo>" e o selo
// "Portal do órgão, fora do PNCP". Roda pelo .github/workflows/coletar-fontes-extras.yml (a cada 6 h).
//
// Incremental: só relê o PDF de um processo quando sai publicação nova dele (dado.versao); o resto vem do banco.
// Processo que ganhou resultado/homologação no portal sai da tabela; o que aparecer no PNCP (mesmo CNPJ,
// modalidade, número e ano) também sai daqui, para não duplicar no painel. Retenção: RETENCAO_DIAS pela publicação.
//
// Uso: node scripts/coletar_fontes_extras.js
//      SIMULAR=1 node scripts/coletar_fontes_extras.js   (consulta os portais e só imprime; não lê nem grava o banco)
// Variáveis de ambiente:
//   SUPABASE_SERVICE_ROLE_KEY  obrigatória fora do SIMULAR
//   FONTES=aadc                adaptadores a rodar, separados por vírgula (padrão: todos de ADAPTADORES)
//   SIMULAR=0                  1 = sem banco, imprime o que encontrou
//   LIMITE_MINUTOS=8           orçamento de tempo do robô inteiro
//   RETENCAO_DIAS=120          janela de publicação lida no portal e mantida na tabela (mesma das oportunidades do PNCP)
//   INTERVALO_MS=1000          intervalo mínimo entre pedidos ao mesmo portal (nunca abaixo de 1000)
//   MAX_PAGINAS=5              páginas (de 100 publicações) por modalidade
//   MAX_DETALHES=40            PDFs lidos por fonte em cada rodada (o resto fica para a próxima)
const { criarCliente, textoDoPdf, chaveFonte, paraLinha } = require("./fontes/comum");

const ADAPTADORES = {
  aadc: require("./fontes/aadc"),
  faepi: require("./fontes/faepi"),
  faepi_cotacoes: require("./fontes/faepi_cotacoes"),
  bll: require("./fontes/bll"),
  sebrae: require("./fontes/sebrae"),
};

const SIMULAR = process.env.SIMULAR === "1";
const LIMITE_MINUTOS = Number(process.env.LIMITE_MINUTOS || 8);
const RETENCAO_DIAS = Number(process.env.RETENCAO_DIAS || 120);
const INTERVALO_MS = Math.max(1000, Number(process.env.INTERVALO_MS || 1000));
const MAX_PAGINAS = Number(process.env.MAX_PAGINAS || 5);
const MAX_DETALHES = Number(process.env.MAX_DETALHES || 40);
const TABELA = "oportunidades_abertas";

const inicioExecucao = Date.now();
const tempoRestanteMs = () => LIMITE_MINUTOS * 60000 - (Date.now() - inicioExecucao);

// "Pregão - Presencial" e "PP" caem na mesma família: é o que compara o processo daqui com o do PNCP.
function familia(modalidade) {
  const n = String(modalidade || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return ["pregao", "concorrencia", "credenciamento", "dispensa", "convite", "chamamento", "tomada"].find((f) => n.includes(f)) || n;
}
// Aberto e com prazo não vencido (o prazo pode chegar só pelo PDF, em completarDetalhes). Dia em Brasília (UTC-3).
const hojeBrasilia = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const vigente = (item, hoje) => item.aberto && (!item.encerramento || String(item.encerramento).slice(0, 10) >= hoje);
const chaveComparacao = (modalidade, numero, ano) => (numero && ano ? `${familia(modalidade)}|${Number(String(numero).split("/")[0])}|${Number(ano)}` : null);

// Linhas que esta fonte já gravou: { chave -> dado }.
async function linhasAnteriores(banco, fonteId) {
  const linhas = await (await banco.restFetch(`${TABELA}?select=chave,dado&chave=like.${encodeURIComponent(chaveFonte(fonteId, "*"))}`)).json();
  return new Map(linhas.map((l) => [l.chave, l.dado]));
}

// Processos do mesmo órgão já publicados no PNCP (o robô do PNCP grava numero_controle_pncp "<cnpj>-...").
async function processosNoPncp(banco, cnpj) {
  if (!cnpj) return new Set();
  const linhas = await (await banco.restFetch(`${TABELA}?select=dado&numero_controle_pncp=like.${cnpj}-*`)).json();
  return new Set(linhas.map(({ dado }) => chaveComparacao(dado && dado.modalidadeNome, dado && dado.numeroCompra, dado && dado.anoCompra)).filter(Boolean));
}

async function apagarChaves(banco, chaves) {
  for (let i = 0; i < chaves.length; i += 50) {
    const lista = chaves.slice(i, i + 50).map((c) => `"${c.replace(/"/g, "")}"`).join(",");
    await banco.restFetch(`${TABELA}?chave=in.(${encodeURIComponent(lista)})`, { method: "DELETE" });
  }
}

// Lê os PDFs só do que mudou desde a última rodada, dentro do orçamento; falha num PDF não derruba a fonte.
async function completarDetalhes(adaptador, itens, anteriores, ctx) {
  let lidos = 0;
  const saida = [];
  for (const item of itens) {
    const antes = anteriores.get(chaveFonte(adaptador.FONTE.id, item.idExterno));
    if (antes && antes.versao === item.versao) {
      saida.push({ ...item, encerramento: antes.encerramento, modalidade: antes.modalidadeNome || item.modalidade, pdfSemTexto: antes.pdfSemTexto });
      continue;
    }
    if (lidos >= MAX_DETALHES || tempoRestanteMs() < 30000) { saida.push(item); continue; }
    lidos += 1;
    try {
      saida.push(await adaptador.detalhe(item, ctx));
    } catch (e) {
      console.log(`[${adaptador.FONTE.id}] Detalhe de ${item.idExterno} falhou (${e.message}); fica só com a listagem.`);
      saida.push(item);
    }
  }
  return { itens: saida, lidos };
}

async function coletarFonte(adaptador, { banco, simular, desdeIso, cliente }) {
  const fonte = adaptador.FONTE;
  const ctx = { cliente, textoDoPdf, desdeIso, tempoRestanteMs, maxPaginas: MAX_PAGINAS };
  const todos = await adaptador.listar(ctx);
  const hoje = hojeBrasilia();
  const abertos = todos.filter((i) => vigente(i, hoje));
  const anteriores = simular ? new Map() : await linhasAnteriores(banco, fonte.id);
  const noPncp = simular ? new Set() : await processosNoPncp(banco, adaptador.ORGAO && adaptador.ORGAO.cnpj);
  const { itens, lidos } = await completarDetalhes(adaptador, abertos, anteriores, ctx);

  const linhas = [];
  const sair = [];
  for (const item of itens) {
    const linha = paraLinha(fonte, item);
    if (!vigente(item, hoje)) sair.push(linha.chave);
    else if (noPncp.has(chaveComparacao(item.modalidade, item.numero, item.ano))) sair.push(linha.chave);
    else linhas.push(linha);
  }
  for (const item of todos.filter((i) => !vigente(i, hoje))) {
    const chave = chaveFonte(fonte.id, item.idExterno);
    if (anteriores.has(chave)) sair.push(chave);
  }
  const resumo = { fonte: fonte.id, publicadas: todos.length, abertas: linhas.length, encerradasOuNoPncp: sair.length, pdfsLidos: lidos };
  if (simular) return { ...resumo, linhas };

  if (linhas.length) await banco.upsertEmLotes(TABELA, linhas, "chave", 100);
  if (sair.length) await apagarChaves(banco, sair.filter((c) => anteriores.has(c)));
  // Retenção só das linhas desta fonte (o robô do PNCP poda por encerramento e preserva os nulos).
  await banco.restFetch(`${TABELA}?chave=like.${encodeURIComponent(chaveFonte(fonte.id, "*"))}&publicacao=lt.${desdeIso.slice(0, 10)}`, { method: "DELETE" });
  // Prazo vencido sai mesmo sem a fonte publicar resultado (mesmo padrão dos robôs de diário).
  await banco.restFetch(`${TABELA}?chave=like.${encodeURIComponent(chaveFonte(fonte.id, "*"))}&encerramento=lt.${hoje}`, { method: "DELETE" });
  return resumo;
}

function imprimir(linhas) {
  for (const { dado } of linhas.sort((a, b) => String(b.dado.publicacao).localeCompare(String(a.dado.publicacao)))) {
    const prazo = dado.encerramento ? dado.encerramento.replace("T", " ").slice(0, 16) : (dado.pdfSemTexto ? "no PDF escaneado" : "não informado");
    console.log(`- ${String(dado.publicacao).slice(0, 10)} | ${dado.processo || dado.modalidadeNome} | sessão/prazo: ${prazo}\n  ${dado.objeto.slice(0, 160)}\n  ${dado.link}`);
  }
}

async function main() {
  const banco = SIMULAR ? null : require("./supabase_dados");
  if (banco) banco.chaveServico(); // falha cedo, com a instrução de configuração
  const desdeIso = new Date(Date.now() - RETENCAO_DIAS * 86400000).toISOString().slice(0, 10);
  const pedidas = (process.env.FONTES || Object.keys(ADAPTADORES).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const status = { em: new Date().toISOString(), fontes: {} };
  let falhas = 0;
  console.log(`Fontes fora do PNCP: ${pedidas.join(", ")}. Publicações desde ${desdeIso}. ${SIMULAR ? "SIMULAR=1 (nada é gravado)." : ""}`);

  for (const id of pedidas) {
    const adaptador = ADAPTADORES[id];
    if (!adaptador) { console.log(`[${id}] Adaptador desconhecido.`); falhas += 1; continue; }
    try {
      // Cliente próprio por fonte: cada portal tem sua sessão e seu ritmo de 1 pedido por segundo.
      const r = await coletarFonte(adaptador, { banco, simular: SIMULAR, desdeIso, cliente: criarCliente({ intervaloMs: INTERVALO_MS }) });
      console.log(`[${id}] ${JSON.stringify({ ...r, linhas: undefined })}`);
      if (r.linhas) imprimir(r.linhas);
      // Portal que respondeu mas não trouxe nenhuma publicação na janela é sinal de estrutura mudada.
      if (r.publicadas === 0) { falhas += 1; console.log(`[${id}] AVISO: nenhuma publicação na janela; conferir se o portal mudou.`); }
      status.fontes[id] = { ok: r.publicadas > 0, abertas: r.abertas, publicadas: r.publicadas };
    } catch (e) {
      falhas += 1;
      console.error(`[${id}] ERRO: ${e.message}`);
      status.fontes[id] = { ok: false, erro: String(e.message).slice(0, 300) };
    }
  }
  if (!SIMULAR) await banco.salvarBlob("dados_robo", "fontes_extras_status", status);
  // Saída com erro faz o GitHub avisar por e-mail que a fonte parou (o que já foi gravado fica).
  if (falhas) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { console.error("Erro fatal no robô de fontes fora do PNCP:", e); process.exit(1); });
}

module.exports = { coletarFonte, familia, chaveComparacao };
