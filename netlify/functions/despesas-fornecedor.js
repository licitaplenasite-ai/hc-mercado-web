// Netlify Function: raio-X financeiro de um fornecedor (CNPJ) no Portal da Transparência.
// Mostra quanto o governo federal JÁ PAGOU de fato pra essa empresa (não o valor do
// edital/contrato, mas a execução financeira real) — complementa a aba Analisar Empresa,
// que hoje só mostra contratos assinados no PNCP, sem saber se foram realmente pagos.
//
// Uso: GET /.netlify/functions/despesas-fornecedor?cnpj=00000000000000
//
// Resposta: { totalPago, porAno: {2024: x, 2025: y, ...}, documentos: [...], erro }

const BASE_URL = "https://api.portaldatransparencia.gov.br/api-de-dados";
const FASE_PAGAMENTO = 3;
const ANOS_A_CONSULTAR = 4; // ano atual + 3 anteriores
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");
const { comCache, cabecalhosDoCache } = require("./_cache_publico");
// Sem prazo, uma página travada do Portal segurava a tela inteira (até 8 páginas em série por ano).
const PRAZO_PAGINA_MS = 8000;

// O Portal pagina a lista (só a 1ª página fazia o "total pago" sair bem menor que o real). Até MAX_PAGINAS por ano:
// 4 anos x 8 = 32 subrequisições, dentro do limite de 50 do Cloudflare gratuito. Passou disso, o total sai marcado como parcial.
const MAX_PAGINAS = 8;
async function consultarPagina(cnpj, ano, pagina, token) {
  try {
    const url = `${BASE_URL}/despesas/documentos-por-favorecido?codigoPessoa=${cnpj}&fase=${FASE_PAGAMENTO}&ano=${ano}&pagina=${pagina}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "chave-api-dados": token },
      signal: globalThis.AbortSignal.timeout(PRAZO_PAGINA_MS),
    });
    if (!resp.ok) return { ok: false, dados: [] };
    const texto = await resp.text();
    if (!texto) return { ok: true, dados: [] };
    const dados = JSON.parse(texto);
    return { ok: true, dados: Array.isArray(dados) ? dados : [] };
  } catch (e) {
    return { ok: false, dados: [] };
  }
}

async function consultarAno(cnpj, ano, token) {
  const todos = [];
  let tamanhoPagina = 0;
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const r = await consultarPagina(cnpj, ano, pagina, token);
    if (!r.ok) return { ok: pagina > 1, dados: todos, parcial: pagina > 1 };
    todos.push(...r.dados);
    tamanhoPagina = tamanhoPagina || r.dados.length;
    if (!r.dados.length || r.dados.length < tamanhoPagina) return { ok: true, dados: todos, parcial: false };
  }
  return { ok: true, dados: todos, parcial: true };
}

exports.handler = async (event) => {
  const headers = cabecalhosPadrao(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  const sessao = await exigirUsuarioAprovado(event);
  if (!sessao.ok) return { statusCode: sessao.status, headers, body: JSON.stringify({ erro: sessao.erro }) };
  const limite = await verificarLimiteDiario(sessao.userId, "despesas-fornecedor", 60);
  if (!limite.ok) return { statusCode: limite.status, headers, body: JSON.stringify({ erro: limite.erro }) };

  const token = process.env.TRANSPARENCIA_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erro: "A consulta ao Portal da Transparência está indisponível agora. Tente de novo mais tarde." }),
    };
  }

  const cnpj = (event.queryStringParameters && event.queryStringParameters.cnpj || "").replace(/\D/g, "");
  if (cnpj.length !== 14) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ erro: "Informe um CNPJ válido de 14 dígitos (parâmetro cnpj)." }),
    };
  }

  // Pagamentos de um CNPJ mudam no máximo 1 vez por dia: guardados 12 h entre clientes (poupa a cota do token do Portal)
  // e, com o Portal fora do ar, volta a última consulta com a data. Só resposta sem falha é guardada.
  let falhou = false;
  const r = await comCache(`despesas-fornecedor|${cnpj}`, async () => {
    const corpo = await consultarPagamentos(cnpj, token);
    falhou = corpo.falhouAlguma;
    return corpo.json;
  }, { frescoS: 12 * 3600, guardar: () => !falhou });
  return { statusCode: 200, headers: { ...headers, ...cabecalhosDoCache(r) }, body: r.valor };
};

async function consultarPagamentos(cnpj, token) {
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: ANOS_A_CONSULTAR }, (_, i) => anoAtual - i);

  const resultados = await Promise.all(anos.map((ano) => consultarAno(cnpj, ano, token)));

  let totalPago = 0;
  const porAno = {};
  const documentos = [];
  let falhouAlguma = false;
  let algumaOk = false;
  let parcial = false;

  resultados.forEach((r, i) => {
    const ano = anos[i];
    if (!r.ok) { falhouAlguma = true; return; }
    algumaOk = true;
    if (r.parcial) parcial = true;
    let somaAno = 0;
    for (const doc of r.dados) {
      const valor = Number(doc.valor || 0);
      somaAno += valor;
      documentos.push({
        ano,
        documento: doc.documento || doc.documentoResumido || null,
        data: doc.dataEmissao || doc.data || null,
        valor,
        orgao: (doc.orgaoSuperior && doc.orgaoSuperior.nome) || doc.nomeOrgao || null,
        unidadeGestora: (doc.unidadeGestora && doc.unidadeGestora.nome) || null,
      });
    }
    if (somaAno > 0) porAno[ano] = somaAno;
    totalPago += somaAno;
  });

  documentos.sort((a, b) => (b.data || "").localeCompare(a.data || ""));

  return {
    falhouAlguma,
    json: JSON.stringify({
      cnpj,
      totalPago,
      porAno,
      totalDocumentos: documentos.length,
      parcial,
      documentos: documentos.slice(0, 50),
      erro: !algumaOk && falhouAlguma ? "Não foi possível consultar o Portal da Transparência agora." : null,
    }),
  };
}
exports.consultarAno = consultarAno;
