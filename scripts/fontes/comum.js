// Peças compartilhadas pelos adaptadores de "fontes fora do PNCP" (contrato em scripts/fontes/README.md):
// cliente HTTP educado (1 pedido por vez, intervalo mínimo, cookie de sessão, nova tentativa com espera),
// leitura de texto de PDF e a conversão do item normalizado para o registro que o painel e o boletim já leem
// (tabela oportunidades_abertas, mesmo formato de scripts/atualizar_dados.js).

// Genérico de propósito: identifica o projeto, sem nome nem contato de pessoa.
const USER_AGENT = "LicitaPlenaBot/1.0 (+https://licitaplena.com.br; coletor de licitacoes publicas)";
// Selo do cartão no painel (r.fonte em painel.html) e prefixo das chaves na tabela.
const ROTULO_FONTE = "Portal do órgão, fora do PNCP";
const PREFIXO_CHAVE = "fonte:";
const LIMITE_PDF_BYTES = 15 * 1024 * 1024;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const limparEspacos = (txt) => String(txt ?? "").replace(/\s+/g, " ").trim();

// Um pedido por vez e pelo menos intervaloMs entre o início de dois pedidos (o pedido do site: 1 por segundo).
function criarCliente({ intervaloMs = 1000, fetchImpl = fetch, tempoLimiteMs = 25000, tentativas = 3 } = {}) {
  const cookies = new Map();
  let fila = Promise.resolve();
  let ultimoInicio = 0;

  function guardarCookies(resp) {
    const brutos = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
    for (const bruto of brutos) {
      const [par] = bruto.split(";");
      const i = par.indexOf("=");
      if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  async function umPedido(url, opcoes) {
    for (let i = 0; i < tentativas; i++) {
      const falta = ultimoInicio + intervaloMs - Date.now();
      if (falta > 0) await esperar(falta);
      ultimoInicio = Date.now();
      const cabecalhos = { "User-Agent": USER_AGENT, ...(opcoes.headers || {}) };
      if (cookies.size) cabecalhos.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      try {
        const resp = await fetchImpl(url, { ...opcoes, headers: cabecalhos, signal: globalThis.AbortSignal.timeout(tempoLimiteMs) });
        guardarCookies(resp);
        if (resp.ok) return resp;
        if ((resp.status < 500 && resp.status !== 429) || i === tentativas - 1) throw new Error(`HTTP ${resp.status} em ${url}`);
      } catch (e) {
        if (/^HTTP \d+ em /.test(e.message) || i === tentativas - 1) throw e;
        console.log(`[fontes] Falha em ${url} (${e.name === "TimeoutError" ? "tempo esgotado" : e.message}); nova tentativa.`);
      }
      await esperar(2000 * (i + 1));
    }
    throw new Error(`sem resposta de ${url}`);
  }

  function pedir(url, opcoes = {}) {
    const resultado = fila.then(() => umPedido(url, opcoes));
    fila = resultado.catch(() => {});
    return resultado;
  }

  return {
    texto: async (url, opcoes) => (await pedir(url, opcoes)).text(),
    json: async (url, opcoes) => (await pedir(url, opcoes)).json(),
    async bytes(url) {
      const corpo = Buffer.from(await (await pedir(url)).arrayBuffer());
      if (corpo.length > LIMITE_PDF_BYTES) throw new Error(`arquivo maior que ${LIMITE_PDF_BYTES} bytes em ${url}`);
      return corpo;
    },
    // Formulário (application/x-www-form-urlencoded) com resposta JSON.
    postForm(url, campos, headers = {}) {
      const corpo = new URLSearchParams();
      for (const [k, v] of Object.entries(campos)) corpo.append(k, v ?? "");
      return pedir(url, { method: "POST", body: corpo, headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", ...headers } }).then((r) => r.json());
    },
  };
}

// Texto do PDF; "" quando o PDF é imagem escaneada (sem camada de texto) ou não abre.
async function textoDoPdf(bytes) {
  try {
    const pdfParse = require("pdf-parse");
    return (await pdfParse(bytes)).text || "";
  } catch (e) {
    console.log(`[fontes] PDF não lido (${e.message}).`);
    return "";
  }
}

// LGPD: CPF de pessoa citada no aviso (pregoeiro, contratado) não vai para o painel nem para a IA. Os limites de
// não-dígito evitam pegar pedaço de CNPJ (14 dígitos).
const mascararCpf = (txt) => (txt == null ? txt : String(txt).replace(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, "***.***.***-**"));
// Só endereço web vira link; "javascript:" ou texto solto, não.
const linkWeb = (url) => (/^https?:\/\//i.test(String(url || "").trim()) ? String(url).trim() : null);

const chaveFonte = (fonteId, idExterno) => `${PREFIXO_CHAVE}${fonteId}:${idExterno}`;

// "2026-11-13T09:00:00" -> "2026-11-13"; data inválida -> null (a coluna é date).
function dia(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}

// Item normalizado -> { linha } da tabela oportunidades_abertas. O "dado" segue o formato do robô do PNCP;
// numeroControlePNCP recebe a própria chave porque o painel abre a edição do boletim por ela (chave in numeros).
// numero_controle_pncp fica nulo: a linha não é do PNCP.
function paraLinha(fonte, item) {
  const chave = chaveFonte(fonte.id, item.idExterno);
  const dado = {
    objeto: mascararCpf(item.objeto),
    orgao: item.orgao.nome,
    uf: item.orgao.uf,
    municipio: item.orgao.municipio || "",
    encerramento: item.encerramento || null,
    publicacao: item.publicacao || null,
    numeroControlePNCP: chave,
    modalidadeNome: item.modalidade || null,
    srp: typeof item.srp === "boolean" ? item.srp : null,
    situacaoCompraNome: "Publicada no portal do órgão",
    numeroCompra: item.numero || null,
    anoCompra: item.ano || null,
    processo: mascararCpf(item.processo) || null,
    usuarioNome: fonte.portal,
    linkSistemaOrigem: item.linkOficial || fonte.paginaOficial,
    link: linkWeb(item.linkEdital || item.linkOficial || fonte.paginaOficial),
    fonte: ROTULO_FONTE,
    fonteId: fonte.id,
    cnpjOrgao: item.orgao.cnpj || null,
    anexos: item.anexos || [],
    versao: item.versao || null,
    pdfSemTexto: item.pdfSemTexto === true,
  };
  return { chave, numero_controle_pncp: null, objeto: dado.objeto || "", uf: dado.uf, publicacao: dia(dado.publicacao), encerramento: dia(dado.encerramento), dado };
}

module.exports = { USER_AGENT, ROTULO_FONTE, PREFIXO_CHAVE, criarCliente, textoDoPdf, chaveFonte, paraLinha, limparEspacos, dia, mascararCpf };
