// Adaptador do Querido Diário (Open Knowledge Brasil): diários oficiais municipais já convertidos em texto, com busca
// por termo e trechos ("excerpts") em volta de cada ocorrência. Contrato de adaptador: scripts/fontes/README.md;
// quem roda é scripts/coletar_diarios_oficiais.js.
//
// Conferido em 25/11/2026:
//   - API pública sem chave: https://queridodiario.ok.org.br/api (OpenAPI 0.19.0 em /api/openapi.json).
//     O endereço antigo api.queridodiario.ok.org.br falha no aperto de mão TLS; não usar.
//   - GET /cities -> 5.570 municípios; level "0" = sem raspador, "1" = mapeado (sem diário na busca), "3" = com diários.
//     Norte com diários (level 3): Manaus (último diário 03/12/2025), Boa Vista (21/10/2026), Belém (13/05/2025),
//     Jaru/RO, Garrafão do Norte/PA, Santana do Araguaia/PA, Macapá, Santana e Tartarugalzinho/AP e ~22 cidades do TO.
//   - GET /gazettes?querystring=...&published_since=...&excerpt_size=&number_of_excerpts=&size=&offset=
//     querystring aceita "frase exata" e | (ou). Sem territory_ids busca o país todo numa chamada só.
//   - robots.txt: "Content-Signal: search=yes, ai-train=no". Uso aqui = índice de busca com trecho e link para o
//     diário original, dentro do permitido. Ritmo: 1 pedido por segundo (a referência pública é 60/min).
//   - Diário de associação (AMA/AL, AMM/MG...) aparece repetido em cada município membro: o município do aviso vem
//     do texto ("PREFEITURA MUNICIPAL DE X"), não do diário, e o coletor junta as repetições pelo número do processo.
const crypto = require("node:crypto");
const { limparEspacos } = require("./comum");
const T = require("./avisos_texto");

const BASE = "https://queridodiario.ok.org.br/api";
const NORTE = ["AM", "PA", "RR", "RO", "AC", "AP", "TO"];
// UF com robô próprio de diário (scripts/coletar_diarios_am.js: AAM, DOM Manaus, DOE-AM): o Querido Diário não
// repete. No AM ele só tem Manaus, com último diário em 03/12/2025.
const UFS_COM_DIARIO_PROPRIO = ["AM"];
const TERMOS = '"aviso de licitação" | pregão | "dispensa eletrônica" | "chamamento público" | "tomada de preços" | "cotação de preços" | concorrência';
const POR_PAGINA = 100;
const TRECHO = 1500;
const TRECHOS_POR_DIARIO = 20;

const FONTE = {
  id: "qd",
  nome: "Querido Diário (Open Knowledge Brasil)",
  portal: "Diário oficial do município",
  rotulo: "Diário municipal via Querido Diário",
  paginaOficial: "https://queridodiario.ok.org.br",
};

// Municípios por UF, para achar no texto o órgão do aviso: { "AL": [{ nome, chave }] } (maiores nomes primeiro).
function cidadesPorUf(cidades) {
  const saida = {};
  for (const c of cidades) (saida[c.state_code] = saida[c.state_code] || []).push({ nome: c.territory_name, chave: T.normalizar(c.territory_name) });
  for (const uf of Object.keys(saida)) saida[uf].sort((a, b) => b.chave.length - a.chave.length);
  return saida;
}

const ENTE = /(prefeitura\s+municipal|prefeitura|munic[ií]pio|c[aâ]mara\s+municipal)\s+d[eoa]s?\s+/gi;
// Último "PREFEITURA MUNICIPAL DE X" do trecho cujo X é município da UF -> { municipio, ente }.
function municipioNoTexto(trecho, cidadesDaUf) {
  let achado = null;
  const g = new RegExp(ENTE.source, "gi");
  for (let m = g.exec(trecho); m; m = g.exec(trecho)) {
    const depois = T.normalizar(trecho.slice(m.index + m[0].length, m.index + m[0].length + 50));
    const cidade = (cidadesDaUf || []).find((c) => depois === c.chave || depois.startsWith(`${c.chave} `) || depois.startsWith(`${c.chave}/`) || depois.startsWith(`${c.chave},`) || depois.startsWith(`${c.chave}-`));
    if (cidade) achado = { municipio: cidade.nome, ente: /c[aâ]mara/i.test(m[1]) ? "Câmara Municipal" : "Prefeitura Municipal" };
  }
  return achado;
}

const resumo = (texto) => crypto.createHash("sha1").update(texto).digest("hex").slice(0, 16);

// Diário (resposta de /gazettes) -> itens no contrato do adaptador.
function itensDoDiario(diario, cidadesUf, hojeIso) {
  const itens = [];
  if (UFS_COM_DIARIO_PROPRIO.includes(diario.state_code)) return itens;
  for (const trecho of diario.excerpts || []) {
    const limpo = limparEspacos(String(trecho).replace(/<[^>]+>/g, " "));
    for (const av of T.avisosDoTexto(limpo, diario.date)) {
      if (av.tipo === "ignorar") continue;
      // Ente citado antes do objeto (cabeçalho do aviso); se não houver, o do corpo ("A PREFEITA DO MUNICÍPIO DE PILAR").
      const cidadesDaUf = cidadesUf[diario.state_code];
      const corte = av.trecho.indexOf(" Objeto: ");
      const local = municipioNoTexto(av.trecho.slice(0, corte < 0 ? 500 : corte), cidadesDaUf) || municipioNoTexto(av.trecho, cidadesDaUf);
      const municipio = local ? local.municipio : diario.territory_name;
      const orgao = { nome: `${local ? local.ente : "Prefeitura Municipal"} de ${municipio}`, uf: diario.state_code, municipio };
      const chaves = T.chavesDoProcesso({ ...av, uf: orgao.uf, municipio });
      itens.push({
        idExterno: resumo(chaves[0] || `${orgao.uf}|${T.normalizar(municipio)}|${T.normalizar(av.objeto || av.trecho).slice(0, 200)}`),
        tipo: av.tipo,
        // Sem número não dá para comparar com o PNCP nem juntar repetições: fica de fora.
        // Fomento cultural/chamamento de OSC fica de fora (T.ehFomentoAviso).
        aberto: av.tipo === "oportunidade" && Boolean(av.objeto && av.numero) && !T.ehFomentoAviso(av.trecho) && (!av.encerramento || av.encerramento.slice(0, 10) >= hojeIso),
        objeto: av.objeto || "",
        orgao,
        uasg: av.uasg,
        modalidade: av.modalidade,
        numero: av.numero,
        ano: av.ano,
        publicacao: diario.date,
        encerramento: av.encerramento,
        linkOficial: diario.url,
        linkEdital: diario.url,
        versao: diario.date,
        trecho: av.trecho,
        precisaIa: Boolean(av.modalidade && av.numero) && (!av.objeto || !av.encerramento),
      });
    }
  }
  return itens;
}

// ---- Contrato do adaptador ----

function urlBusca(desdeIso, offset, territorios) {
  const p = new URLSearchParams({
    querystring: TERMOS, published_since: desdeIso, excerpt_size: String(TRECHO), number_of_excerpts: String(TRECHOS_POR_DIARIO),
    size: String(POR_PAGINA), offset: String(offset), sort_by: "descending_date", pre_tags: "", post_tags: "",
  });
  for (const id of territorios || []) p.append("territory_ids", id);
  return `${BASE}/gazettes?${p}`;
}

// Uma busca paginada (Norte ou país todo); diário já lido em outra busca não se repete.
async function lerBusca(ctx, territorios, vistos, cidadesUf, itens) {
  const { cliente, tempoRestanteMs = () => Infinity, maxDiarios = 1500 } = ctx;
  for (let offset = 0; vistos.size < maxDiarios && tempoRestanteMs() > 60000; offset += POR_PAGINA) {
    const resp = await cliente.json(urlBusca(ctx.desdeIso, offset, territorios));
    if (!resp || !Array.isArray(resp.gazettes)) throw new Error("Querido Diário: resposta de /gazettes sem lista");
    for (const g of resp.gazettes.filter((d) => !vistos.has(d.txt_url || d.url))) {
      vistos.add(g.txt_url || g.url);
      itens.push(...itensDoDiario(g, cidadesUf, ctx.hojeIso));
    }
    if (!resp.gazettes.length || offset + POR_PAGINA >= Number(resp.total_gazettes || 0)) return;
  }
}

// ctx: { cliente (scripts/fontes/comum.js), desdeIso, hojeIso, tempoRestanteMs, relatorio, maxDiarios }
async function listar(ctx) {
  const cidades = ((await ctx.cliente.json(`${BASE}/cities?city_name=`)) || {}).cities;
  if (!Array.isArray(cidades) || !cidades.length) throw new Error("Querido Diário: /cities sem municípios (a API mudou?)");
  const cidadesUf = cidadesPorUf(cidades);
  const norte = cidades.filter((c) => c.level !== "0" && NORTE.includes(c.state_code) && !UFS_COM_DIARIO_PROPRIO.includes(c.state_code)).map((c) => c.territory_id);
  const vistos = new Set();
  const itens = [];
  // Norte primeiro (prioridade comercial); depois o país todo.
  for (const territorios of norte.length ? [norte, null] : [null]) await lerBusca(ctx, territorios, vistos, cidadesUf, itens);
  if (ctx.relatorio) ctx.relatorio.atosLidos = vistos.size;
  return itens;
}

module.exports = { FONTE, listar, itensDoDiario, municipioNoTexto, cidadesPorUf, TERMOS, NORTE, UFS_COM_DIARIO_PROPRIO };
