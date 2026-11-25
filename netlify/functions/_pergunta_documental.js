const { paginasDaFonte, clausulasDaFonte } = require('./_edital_operacional');
const normalizar = (v) => v.normalize('NFC').replace(/\s+/g, ' ').trim();

function prepararFontesPergunta(texto, pergunta, limite = 22000) {
  // shortcut: a seleção lexical por páginas pode omitir contexto; ampliar a recuperação quando perguntas reais exigirem outros trechos.
  const termos = pergunta.toLocaleLowerCase('pt-BR').match(/[\p{L}]{4,}/gu) || [];
  const paginas = texto.split(/(?=^--- .+ ---$)/m).filter((parte) => parte.trim()).flatMap((parte) => {
    const lidas = paginasDaFonte(parte);
    return lidas.length ? lidas : [{ documento: parte.match(/^--- (.+) ---$/m)?.[1] || 'Documento oficial', pagina: '', texto: parte.replace(/^--- .+ ---$/m, '') }];
  }).map((p, i) => ({ ...p, id: `F${i + 1}`, texto: normalizar(p.texto), ordem: i }));
  const candidatas = paginas.filter((p) => p.texto).map((p) => ({ ...p,
    pontos: termos.reduce((n, t) => n + Number(p.texto.toLocaleLowerCase('pt-BR').includes(t)), 0) }));
  let restante = limite;
  const fontes = [];
  for (const p of candidatas.sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem)) {
    if (restante < 200) break;
    const trecho = p.texto.slice(0, restante);
    fontes.push({ ...p, texto: trecho }); restante -= trecho.length;
  }
  fontes.sort((a, b) => a.ordem - b.ordem);
  return { fontes, selecaoParcial: fontes.reduce((n, p) => n + p.texto.length, 0) < paginas.reduce((n, p) => n + p.texto.length, 0) };
}

function clausulasPagamento(texto, pergunta) {
  if (!/pagamento|liquida[cç][aã]o/i.test(pergunta) || /banco|ag[eê]ncia|conta (?:banc[aá]ria|corrente)/i.test(pergunta)) return null;
  const clausulas = clausulasDaFonte(texto);
  const ancoras = clausulas.filter((c) => /pagamento ser[aá] efetuado|prazo de \d+(?:\s*\([^)]*\))? dias [uú]teis para (?:fins de )?liquida[cç][aã]o/i.test(c.texto));
  if (!ancoras.length) return null;
  // Inclui o capítulo inteiro para conservar condições e exceções junto dos prazos.
  const grupos = new Set(ancoras.map((c) => JSON.stringify([c.documento, c.numero.split('.')[0]])));
  return clausulas.filter((c) => grupos.has(JSON.stringify([c.documento, c.numero.split('.')[0]])));
}

function responderPagamento(texto, pergunta) {
  const trechos = clausulasPagamento(texto, pergunta);
  if (!trechos) return null;
  return 'Trechos das regras de pagamento, separados por fonte. Confira com o órgão o alcance de cada regra; não foi escolhida uma regra de prevalência.\n\n' +
    trechos.map((c) => `${c.texto}\n[${c.documento}${c.pagina ? `, página ${c.pagina}` : ''}, cláusula ${c.numero}]`).join('\n\n');
}

// Mesmas cláusulas de responderPagamento, como citações da Plena (resposta sem IA: o texto é o da própria fonte).
function citacoesPagamento(texto, pergunta, numeroControlePNCP) {
  return (clausulasPagamento(texto, pergunta) || []).map((c) => ({ trecho: c.texto, documento: c.documento, pagina: c.pagina || '', clausula: c.numero || '', url: urlDocumentoPncp(numeroControlePNCP, c.documento) }));
}

const NAO_LOCALIZADO = 'Não encontrei no edital a resposta para esta pergunta (nos trechos analisados). Isso não comprova que ela inexista no edital. Confira os documentos oficiais.';

// Confere a saída da IA contra as fontes: null = inválida; [] = não localizado; senão os trechos literais, cada um
// com documento/página/cláusula da FONTE (nunca do texto da IA). Base da resposta em texto e das citações da Plena.
function evidenciasValidadas(texto, fontes) {
  if (typeof texto !== 'string' || texto.length > 30000) return null;
  let dados;
  try { dados = JSON.parse(texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch (_) { return null; }
  if (!dados || typeof dados.naoLocalizado !== 'boolean' || !Array.isArray(dados.evidencias) || dados.evidencias.length > 6) return null;
  if (dados.naoLocalizado) return dados.evidencias.length ? null : [];
  if (!dados.evidencias.length) return null;
  const itens = [];
  for (const e of dados.evidencias) {
    const fonte = fontes.find((f) => f.id === e?.id);
    if (!fonte || typeof e.trecho !== 'string') return null;
    const trecho = normalizar(e.trecho);
    if (trecho.length < 15 || trecho.length > 3500 || !fonte.texto.includes(trecho)) return null;
    itens.push({ trecho, documento: fonte.documento, pagina: fonte.pagina || '', clausula: fonte.numero || '' });
  }
  return itens;
}
const rotuloFonte = (c) => `${c.documento}${c.pagina ? `, página ${c.pagina}` : ''}${c.clausula ? `, cláusula ${c.clausula}` : ''}`;

function formatarRespostaDocumental(texto, fontes) {
  const itens = evidenciasValidadas(texto, fontes);
  if (!itens) return null;
  if (!itens.length) return NAO_LOCALIZADO;
  return `Trechos localizados para sua pergunta:\n\n${[...new Set(itens.map((c) => `${c.trecho}\n[${rotuloFonte(c)}]`))].join('\n\n')}`;
}

// Link oficial do arquivo no PNCP a partir do rótulo "Título (#3)" que buscarTextoEdital grava na fonte.
function urlDocumentoPncp(numeroControlePNCP, documento) {
  const id = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(String(numeroControlePNCP || ''));
  const seq = /\(#(\d{1,4})\)/.exec(String(documento || ''));
  return id && seq ? `https://pncp.gov.br/pncp-api/v1/orgaos/${id[1]}/compras/${id[3]}/${Number(id[2])}/arquivos/${seq[1]}` : null;
}

// Citações estruturadas para a Plena: montadas aqui, no servidor, a partir das fontes validadas.
function citacoesDocumentais(texto, fontes, numeroControlePNCP) {
  const itens = evidenciasValidadas(texto, fontes) || [];
  const vistos = new Set();
  return itens.filter((c) => !vistos.has(c.trecho) && vistos.add(c.trecho))
    .map((c) => ({ ...c, url: urlDocumentoPncp(numeroControlePNCP, c.documento) }));
}

function avisosDeCobertura(leituraParcial, selecaoParcial) {
  const avisos = [];
  if (leituraParcial) avisos.push('Atenção: a leitura dos documentos é parcial. Confira também o material não lido.');
  if (selecaoParcial) avisos.push('Esta resposta usa uma seleção de trechos da fonte armazenada; não equivale à análise integral do edital.');
  return avisos;
}

function avisarCobertura(resposta, leituraParcial, selecaoParcial) {
  return [...avisosDeCobertura(leituraParcial, selecaoParcial), resposta].join('\n\n');
}

module.exports = { prepararFontesPergunta, responderPagamento, citacoesPagamento, formatarRespostaDocumental, citacoesDocumentais, urlDocumentoPncp, avisosDeCobertura, avisarCobertura };
