const test = require("node:test");
const assert = require("node:assert/strict");
const { handler, _interno } = require("../contador");

const TABELA = { versaoDb: "V0073", linhas: [
  { codigo: "000001", descricao: "Tributação integral", nomenclatura: "NBS ou NCM", reducaoCbs: 0, reducaoIbsUf: 0, tipoAliquota: "Padrão" },
  { codigo: "200003", descricao: "Vendas de produtos destinados à alimentação humana (Anexo I)", nomenclatura: "NCM", reducaoCbs: 100, reducaoIbsUf: 100, tipoAliquota: "Padrão", baseLegal: "Art. 125" },
  { codigo: "200032", descricao: "Fornecimento dos medicamentos registrados na Anvisa", nomenclatura: "NCM", reducaoCbs: 60, reducaoIbsUf: 60, tipoAliquota: "Padrão" },
  { codigo: "410004", descricao: "Exportações", nomenclatura: "NBS ou NCM", reducaoCbs: 0, reducaoIbsUf: 0, tipoAliquota: "Sem alíquota" },
] };
// Resposta real (formato) da calculadora oficial, 22/11/2026, POST observabilidade/regime-geral.
const OBJ_MEDICAMENTO = { nObj: 1, estadoItem: "CALCULO_SIMULADO", tribCalc: { IBSCBS: { CST: "200", cClassTrib: "200032", gIBSCBS: { vBC: "1000.00",
  gIBSUF: { pIBSUF: "0.05", gRed: { pRedAliq: "60.00", pAliqEfet: "0.02" }, vIBSUF: "0.20" }, gIBSMun: { pIBSMun: "0.05", gRed: { pRedAliq: "60.00", pAliqEfet: "0.02" }, vIBSMun: "0.20" },
  vIBS: "0.40", gCBS: { pCBS: "11.20", gRed: { pRedAliq: "60.00", pAliqEfet: "4.48" }, vCBS: "44.80" } },
  memoriaCalculo: { cbs: "Operação de consumo com enquadramento legal em Art. 133, tributada conforme Alíquota reduzida em 60%." } } } };

process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
const resposta = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
// Supabase falso (dados_robo + caches) e Receita falsa; registra o que saiu para fora.
function ambiente({ oficial = () => resposta({ objetos: [OBJ_MEDICAMENTO] }), cacheOficial = [], cacheClass = [] } = {}) {
  const saidas = [], gravados = [];
  const fetch = async (url, op = {}) => {
    const u = String(url);
    if (u.includes("dados_robo")) return resposta([{ dado: TABELA }]);
    if (u.includes("contador_oficial") && op.method === "POST") { gravados.push(JSON.parse(op.body)); return resposta(null, 201); }
    if (u.includes("contador_oficial")) return resposta(cacheOficial);
    if (u.includes("contador_classificacoes") && op.method === "POST") { gravados.push(JSON.parse(op.body)); return resposta(null, 201); }
    if (u.includes("contador_classificacoes")) return resposta(cacheClass);
    if (u.includes("piloto-cbs.tributos.gov.br")) { saidas.push(JSON.parse(op.body)); return oficial(); }
    throw new Error(`rede inesperada: ${u}`);
  };
  return { saidas, gravados, fetch };
}
const deps = (amb, extra = {}) => ({ fetch: amb.fetch, autenticar: async () => ({ ok: true, userId: "u1" }), limitar: async () => ({ ok: true }),
  ritmoOficial: async () => ({ ok: true }), env: { GEMINI_API_KEY: "x" }, ...extra });
const pedir = async (corpo, d) => { const r = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(corpo) }, d); return { status: r.statusCode, j: JSON.parse(r.body) }; };
const ITEM = { numero: "1", tipo: "bem", codigo: "30049099", cClassTrib: "200032" };

test("calcular: só NCM, cClassTrib e base fixa de R$ 1.000 saem para a Receita; resultado vai para o cache", async () => {
  const amb = ambiente();
  const { status, j } = await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [ITEM, { ...ITEM, numero: "2" }] }, deps(amb));
  assert.equal(status, 200);
  assert.equal(amb.saidas.length, 1); // dois itens iguais = 1 item na chamada
  const enviado = amb.saidas[0];
  assert.equal(enviado.itens.length, 1); assert.equal(enviado.municipio, 1302603); // capital do AM
  assert.deepEqual(enviado.itens[0], { numero: 1, ncm: "30049099", cst: "200", cClassTrib: "200032", baseCalculo: 1000, quantidade: 1, unidade: "UN",
    aliquotasNominais: { cbs: 11.2, ibsEstadual: 0.05, ibsMunicipal: 0.05 } });
  assert.equal(j.itens[0].estado, "CALCULO_SIMULADO"); assert.equal(j.itens[0].reducaoCbs, 60); assert.equal(j.itens[1].fonte, "oficial");
  assert.equal(amb.gravados[0][0].chave, "ncm:30049099|200032|2027"); assert.equal(amb.gravados[0][0].versao_db, "V0073");
});

test("cache por NCM + cClassTrib + ano: não chama a Receita de novo; versão velha do cache é ignorada", async () => {
  const guardado = { chave: "ncm:30049099|200032|2027", resultado: { estado: "CALCULO_SIMULADO", reducaoCbs: 60 }, versao_db: "V0073" };
  const amb = ambiente({ cacheOficial: [guardado] });
  const { j } = await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [ITEM] }, deps(amb));
  assert.equal(amb.saidas.length, 0); assert.equal(j.itens[0].reducaoCbs, 60);
  const velho = ambiente({ cacheOficial: [{ ...guardado, versao_db: "V0060" }] });
  await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [ITEM] }, deps(velho));
  assert.equal(velho.saidas.length, 1);
});

test("fila: passou do ritmo da Receita, não chama e devolve conta local com aviso", async () => {
  const amb = ambiente();
  const { j } = await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [ITEM] }, deps(amb, { ritmoOficial: async () => ({ ok: false }) }));
  assert.equal(amb.saidas.length, 0); assert.equal(j.itens[0].fonte, "local"); assert.match(j.aviso, /fila/);
});

test("falha da API oficial (HTTP 503, rede ou falha técnica) vira conta local, sem gravar falha no cache", async () => {
  const caiu = ambiente({ oficial: () => resposta({}, 503) });
  const r1 = await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [ITEM] }, deps(caiu));
  assert.equal(r1.status, 200); assert.equal(r1.j.itens[0].fonte, "local"); assert.match(r1.j.aviso, /conta local/);
  const rede = ambiente({ oficial: () => { throw new Error("timeout"); } });
  assert.equal((await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [ITEM] }, deps(rede))).j.itens[0].fonte, "local");
  const tecnica = ambiente({ oficial: () => resposta({ objetos: [{ nObj: 1, estadoItem: "FALHA_TECNICA" }] }) });
  const r3 = await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [ITEM] }, deps(tecnica));
  assert.equal(r3.j.itens[0].estado, "FALHA_TECNICA"); assert.equal(tecnica.gravados.length, 0);
});

test("calcular recusa entrada fora do formato antes de qualquer chamada", async () => {
  const amb = ambiente();
  assert.equal((await pedir({ acao: "calcular", ano: 2040, uf: "AM", itens: [ITEM] }, deps(amb))).status, 400);
  assert.equal((await pedir({ acao: "calcular", ano: 2027, uf: "XX", itens: [ITEM] }, deps(amb))).status, 400);
  assert.equal((await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [{ ...ITEM, codigo: "3004" }] }, deps(amb))).status, 400);
  assert.equal((await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: Array(21).fill(ITEM) }, deps(amb))).status, 400);
  assert.equal(amb.saidas.length, 0);
  // 2026: alíquotas nominais são proibidas no corpo oficial.
  assert.equal(_interno.corpoOficial([ITEM], 2026, "AM", 1302603).itens[0].aliquotasNominais, undefined);
});

test("classificar: IA sugere, a tabela oficial valida; do edital grava no cache, texto digitado não", async () => {
  let pergunta = "";
  const responder = async (msgs) => { pergunta = msgs[1].content; return { ok: true, texto: '{"tipo":"bem","codigo":"1006.30.21","cClassTrib":"200003","motivo":"Arroz é da cesta básica."}' }; };
  const amb = ambiente();
  const r = await pedir({ acao: "classificar", descricao: "Arroz tipo 1, pacote 5 kg", doEdital: true }, deps(amb, { responder }));
  assert.deepEqual(r.j, { tipo: "bem", codigo: "10063021", cClassTrib: "200003", motivo: "Arroz é da cesta básica.", fonte: "ia" });
  assert.equal(pergunta, "<item>Arroz tipo 1, pacote 5 kg</item>");
  assert.equal(amb.gravados[0][0].cclasstrib, "200003");
  const digitado = ambiente();
  await pedir({ acao: "classificar", descricao: "Arroz tipo 1", doEdital: false }, deps(digitado, { responder }));
  assert.equal(digitado.gravados.length, 0);
});

test("classificar reaproveita o cache sem gastar IA; IA com código fora da lista cai para sem redução", async () => {
  const amb = ambiente({ cacheClass: [{ tipo: "bem", codigo: "10063021", cclasstrib: "200003", motivo: "Cesta." }] });
  const r = await pedir({ acao: "classificar", descricao: "Arroz", doEdital: true }, deps(amb, { responder: async () => { throw new Error("não devia chamar"); }, limitar: async () => { throw new Error("não devia contar"); } }));
  assert.equal(r.j.fonte, "reaproveitada");
  assert.equal(_interno.validarSugestao({ tipo: "bem", codigo: "10063021", cClassTrib: "410004", motivo: "x" }, TABELA).cClassTrib, "000001");
  assert.equal(_interno.validarSugestao({ tipo: "bem", codigo: "123", cClassTrib: "000001" }, TABELA), null);
  assert.equal(_interno.validarSugestao({ tipo: "outro" }, TABELA), null);
});

test("barreiras: sem login, fora do plano (cota) e ação desconhecida", async () => {
  const amb = ambiente();
  assert.equal((await pedir({ acao: "tabela" }, deps(amb, { autenticar: async () => ({ ok: false, status: 401, erro: "Faça login." }) }))).status, 401);
  const fora = await pedir({ acao: "calcular", ano: 2027, uf: "AM", itens: [ITEM] }, deps(amb, { limitar: async () => ({ ok: false, status: 403, erro: "O plano Essencial não inclui Contador." }) }));
  assert.equal(fora.status, 403); assert.equal(amb.saidas.length, 0);
  assert.equal((await pedir({ acao: "apagar" }, deps(amb))).status, 400);
  const t = await pedir({ acao: "tabela" }, deps(amb));
  assert.equal(t.j.versaoDb, "V0073"); assert.equal(t.j.linhas.length, 4);
});
