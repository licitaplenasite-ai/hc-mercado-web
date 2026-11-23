const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  function dadosStatusOperacional(");
const fim = html.indexOf("  function classePrazoKanban(", inicio);
assert.ok(inicio > 0 && fim > inicio);
const codigo = html.slice(inicio, fim);

function criarBanco(existente = null, prazos = [], falhas = {}) {
  const gravacoes = [];
  const consultas = [];
  const banco = {
    from(tabela) {
      const consulta = { tabela, filtros: [], acao: "select", dados: null };
      consultas.push(consulta);
      const builder = {
        select() { return this; },
        eq(campo, valor) { consulta.filtros.push([campo, valor]); return this; },
        maybeSingle: async () => ({ data: existente, error: null }),
        single: async () => ({ data: { id: "processo-novo", objeto: consulta.dados.objeto }, error: null }),
        insert(dados) { consulta.acao = "insert"; consulta.dados = dados; return this; },
        update(dados) { consulta.acao = "update"; consulta.dados = dados; return this; },
        then(resolve) {
          const data = consulta.acao === "select" && tabela === "operacao_prazos_processo" ? prazos : null;
          resolve({ data, error: falhas[`${tabela}:${consulta.acao}`] || null });
        },
      };
      return builder;
    },
  };
  return { banco, gravacoes, consultas };
}

const avisosConsole = [];
function preparar(existente, prazos, etapas = null, falhas = {}) {
  const { banco, consultas } = criarBanco(existente, prazos, falhas);
  const contexto = {
    window: { __sbClient: banco },
    Map, Set, Promise, Object, Number, String, Date,
    localStorage: { getItem: () => "empresa" },
    document: {},
    console: { ...console, warn: (...args) => avisosConsole.push(args.join(" ")) },
    LicitaOperacaoEdital: { requisitosDaEstrutura: () => ["Certidão negativa de débitos federais"] },
    lerCacheLocalResumo: () => ({ estrutura: {} }),
    setTimeout,
    clearTimeout,
    aguardarSupabaseAutenticado: async () => {},
    linkPncp: numero => numero ? `https://pncp.gov.br/${numero}` : null,
    numeroOperacional: valor => valor == null ? null : Number(valor),
    dataOperacional: (valor, comHora) => valor ? (comHora ? new Date(valor).toISOString() : new Date(valor).toISOString().slice(0, 10)) : null,
  };
  // A consulta da empresa é isolada, para testar o contrato de sincronização sem
  // depender da rede ou da sessão real do usuário.
  const codigoTestavel = codigo.replace(
    "const { organizacaoId, empresa } = await empresaOperacionalParaDossie(empresaId);",
    'const organizacaoId = "org", empresa = { id: "empresa" };'
  );
  // etapas simula o Funil carregado do banco (null = tabela operacao_funil_etapas ainda não existe).
  contexto.__etapas = etapas;
  vm.runInNewContext(`${codigoTestavel}\netapasFunil = this.__etapas; this.sincronizar = sincronizarDossieOperacional; this.status = dadosStatusOperacional;`, contexto);
  return { sincronizar: contexto.sincronizar, status: contexto.status, consultas };
}

test("Kanban distingue interesse, participação, vitória sem itens e derrota", () => {
  const { status } = preparar();
  assert.deepEqual(JSON.parse(JSON.stringify(status("interesse"))), {
    estagio: "triagem", decisao: "em_analise", resultado: "nao_apurado",
  });
  assert.equal(status("participando").resultado, "em_disputa");
  assert.equal(status("ganhei").resultado, "vitoria_sem_detalhamento");
  assert.equal(status("perdi").decisao, "participar");
  assert.equal(status("perdi").resultado, "sem_vitoria");
});

test("usa o cliente Supabase autenticado do painel, não variável de outro escopo", async () => {
  const banco = {
    rpc: async nome => { assert.equal(nome, "bootstrap_operacao"); return { data: "org", error: null }; },
    from(tabela) {
      assert.equal(tabela, "operacao_empresas");
      return { select() { return this; }, eq() { return this; }, order: async () => ({ data: [{ id: "empresa", razao_social: "Empresa de teste" }], error: null }) };
    },
  };
  const contexto = {
    window: { __sbClient: banco },
    localStorage: { getItem: () => "empresa" },
    aguardarSupabaseAutenticado: async () => {},
  };
  vm.runInNewContext(`${codigo}\nthis.empresa = empresaOperacionalParaDossie;`, contexto);
  const resultado = await contexto.empresa();
  assert.equal(resultado.organizacaoId, "org");
  assert.equal(resultado.empresa.id, "empresa");
});

test("a empresa solicitada prevalece sobre a preferência salva no navegador", async () => {
  const banco = {
    rpc: async () => ({ data: "org", error: null }),
    from(tabela) {
      assert.equal(tabela, "operacao_empresas");
      return {
        select() { return this; }, eq() { return this; },
        order: async () => ({ data: [
          { id: "hcm", razao_social: "HCM" },
          { id: "rymo", razao_social: "RyMo" },
        ], error: null }),
      };
    },
  };
  const contexto = {
    window: { __sbClient: banco },
    localStorage: { getItem: () => "hcm" },
    aguardarSupabaseAutenticado: async () => {},
  };
  vm.runInNewContext(`${codigo}\nthis.empresa = empresaOperacionalParaDossie;`, contexto);
  assert.equal((await contexto.empresa("rymo")).empresa.id, "rymo");
  await assert.rejects(contexto.empresa("inexistente"), /não está mais disponível/);
});

test("cria dossiê pré-preenchido sem confundir prazo da proposta com sessão", async () => {
  const { sincronizar, consultas } = preparar();
  await sincronizar("PNCP-1", {
    objeto: "Aquisição de papel", orgao: "Órgão público", numeroControlePNCP: "PNCP-1",
    numeroCompra: "41", anoCompra: 2026, codigoUnidade: "12345", fonte: "PNCP",
    valorTotalEstimado: 2500, publicacao: "2026-10-01", encerramento: "2026-10-20T10:00:00Z",
  }, "interesse");
  const processo = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "insert").dados;
  assert.equal(processo.origem_externa_id, "PNCP-1");
  assert.equal(processo.numero, "41/2026");
  assert.equal(processo.uasg, "12345");
  assert.equal(processo.valor_estimado, 2500);
  assert.equal(processo.data_sessao, null);
  assert.equal(processo.situacao_resultado, "nao_apurado");
  const prazo = consultas.find(c => c.tabela === "operacao_prazos_processo" && c.acao === "insert").dados;
  assert.equal(prazo.categoria, "proposta");
  assert.equal(prazo.titulo, "Prazo de propostas (Boletim)");
  assert.equal(prazo.vencimento, "2026-10-20T10:00:00.000Z");
});

test("atualiza só os campos operacionais e conserva dados manuais", async () => {
  const existente = {
    id: "processo-existente", objeto: "Objeto ajustado manualmente", orgao: "Órgão revisado",
    preco_proposta: 1450, decisao: "participar", status: "preparacao",
    resultado: "Status informado no Kanban: Participando (informação do usuário; confira a fonte oficial).",
    data_sessao: "2026-10-20T10:00:00.000Z",
    observacoes: "Pré-preenchido automaticamente a partir do Boletim / Kanban.",
  };
  const prazoExistente = [{ id: "prazo-1", titulo: "Prazo do Boletim: Papel", concluido_em: null }];
  const { sincronizar, consultas } = preparar(existente, prazoExistente);
  await sincronizar("PNCP-1", { objeto: "Papel", orgao: "Outro órgão", encerramento: "2026-10-20T10:00:00Z" }, "perdi");
  const processo = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "update").dados;
  assert.equal(processo.status, "perdido");
  assert.equal(processo.decisao, "participar");
  assert.equal(processo.situacao_resultado, "sem_vitoria");
  assert.equal(processo.data_sessao, null);
  assert.equal(processo.objeto, undefined);
  assert.equal(processo.preco_proposta, undefined);
  const atualizacaoPrazo = consultas.find(c => c.tabela === "operacao_prazos_processo" && c.acao === "update").dados;
  assert.equal(atualizacaoPrazo.titulo, "Prazo de propostas (Boletim)");
  assert.equal(consultas.filter(c => c.tabela === "operacao_prazos_processo" && c.acao === "insert").length, 0);
});

test("fonte oficial registrada no dossiê não é substituída pelo Kanban", async () => {
  const existente = {
    id: "processo-existente", objeto: "Papel", fonte_resultado: "https://pncp.gov.br/resultado",
    situacao_resultado: "vitoria_parcial", valor_homologado: 350, resultado: "Conferido no portal",
  };
  const { sincronizar, consultas } = preparar(existente);
  await sincronizar("PNCP-1", { objeto: "Papel" }, "ganhei");
  const atualizacao = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "update").dados;
  assert.equal(atualizacao.status, "homologado");
  assert.equal(atualizacao.situacao_resultado, undefined);
  assert.equal(atualizacao.resultado, undefined);
  assert.equal(atualizacao.valor_homologado, undefined);
});

const ETAPAS = [
  { id: "etapa-interesse", nome: "Tenho interesse", ordem: 0, status_sistema: "triagem", chave_sistema: "interesse", cor: "#64748b" },
  { id: "etapa-participando", nome: "Participando", ordem: 1, status_sistema: "preparacao", chave_sistema: "participando", cor: "#2563eb" },
  { id: "etapa-sessao", nome: "Sessão marcada", ordem: 2, status_sistema: "sessao", chave_sistema: null, cor: "#7c3aed" },
];

test("etapa personalizada grava etapa_id e status_sistema", async () => {
  const existente = { id: "processo-existente", objeto: "Papel", status: "preparacao", resultado: "" };
  const { sincronizar, consultas } = preparar(existente, [], ETAPAS);
  await sincronizar("PNCP-1", { objeto: "Papel" }, "participando", null, ETAPAS[2]);
  const atualizacao = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "update").dados;
  assert.equal(atualizacao.status, "sessao");
  assert.equal(atualizacao.etapa_id, "etapa-sessao");
  assert.equal(atualizacao.decisao, "participar");

  const novo = preparar(null, [], ETAPAS);
  await novo.sincronizar("PNCP-2", { objeto: "Papel" }, "participando", null, ETAPAS[2]);
  const insercao = novo.consultas.find(c => c.tabela === "operacao_processos" && c.acao === "insert").dados;
  assert.equal(insercao.status, "sessao");
  assert.equal(insercao.etapa_id, "etapa-sessao");
});

test("sem etapa grava etapa_id null", async () => {
  const existente = { id: "processo-existente", objeto: "Papel", status: "sessao", etapa_id: "etapa-sessao", resultado: "" };
  const { sincronizar, consultas } = preparar(existente, [], ETAPAS);
  await sincronizar("PNCP-1", { objeto: "Papel" }, "participando");
  const atualizacao = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "update").dados;
  assert.equal(atualizacao.status, "preparacao");
  assert.ok("etapa_id" in atualizacao);
  assert.equal(atualizacao.etapa_id, null);
});

// O painel pode ir ao ar antes do SQL: sem a tabela, a coluna etapa_id também não existe.
test("sem a tabela de etapas no banco não envia etapa_id", async () => {
  const existente = { id: "processo-existente", objeto: "Papel", status: "triagem", resultado: "" };
  const { sincronizar, consultas } = preparar(existente);
  await sincronizar("PNCP-1", { objeto: "Papel" }, "participando");
  const atualizacao = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "update").dados;
  assert.equal(atualizacao.status, "preparacao");
  assert.equal("etapa_id" in atualizacao, false);
  const novo = preparar(null);
  await novo.sincronizar("PNCP-2", { objeto: "Papel" }, "interesse");
  assert.equal("etapa_id" in novo.consultas.find(c => c.tabela === "operacao_processos" && c.acao === "insert").dados, false);
});

// Regressão 23/11 (pregão 012/2026 da ALEPA): o processo era criado, um passo seguinte falhava e a tela
// desfazia o status; a segunda tentativa achava o processo e "funcionava". O status salvo não cai mais.
test("processo criado continua salvo quando o checklist ou o prazo falham depois", async () => {
  const erroBanco = { code: "42501", message: "new row violates row-level security policy", details: null, hint: null };
  const { sincronizar } = preparar(null, [], null, {
    "operacao_processos:update": erroBanco, "operacao_prazos_processo:insert": erroBanco,
  });
  avisosConsole.length = 0;
  const resultado = await sincronizar("00000000000191-1-000012/2026", {
    objeto: "Papel", numeroControlePNCP: "00000000000191-1-000012/2026", encerramento: "2026-12-01T10:00:00Z",
  }, "participando");
  assert.equal(resultado.id, "processo-novo");
  assert.match(resultado.pendencia, /prazo de propostas/);
  // O console mostra a mensagem real do banco, não "Object".
  assert.ok(avisosConsole.some(a => a.includes("Checklist") && a.includes("42501 | new row violates")));
  assert.ok(avisosConsole.some(a => a.includes("Prazo") && a.includes("row-level security")));
});

test("erro do banco vira texto claro na tela e completo no console", () => {
  const contexto = {};
  vm.runInNewContext(`${codigo}
this.tecnico = textoErroTecnico; this.tela = mensagemErroAcompanhamento;`, contexto);
  const rls = { code: "42501", message: "new row violates row-level security policy", details: null, hint: null };
  assert.equal(contexto.tecnico(rls), "42501 | new row violates row-level security policy");
  assert.match(contexto.tela(rls), /permissão/);
  assert.match(contexto.tela({ code: "PGRST301", message: "JWT expired" }), /sessão expirou/);
  assert.match(contexto.tela({ code: "", message: "TypeError: Failed to fetch" }), /sem conexão/);
  assert.match(contexto.tela({ code: "P0001", message: "Limite de 3 processos ativos atingido para esta conta", hint: "Plano Teste." }), /Limite de 3.*Plano Teste/);
  assert.match(contexto.tela({ code: "23505", message: "duplicate key value" }), /código 23505/);
  assert.equal(contexto.tela(new Error("Escolha uma empresa antes de acompanhar o edital.")), "Escolha uma empresa antes de acompanhar o edital.");
});

// Voltar para a aba recarrega as empresas e desliga empresaAcompanhamentoPronta por instantes, com o seletor na tela.
test("escolher o status durante a recarga das empresas espera a recarga e grava", async () => {
  const gravados = [];
  const contexto = {
    Map, Set, Promise, Object, Date, String, console,
    empresaAcompanhamentoPronta: false, empresaOperacionalId: "empresa", semEmpresaCadastrada: false, etapasFunil: null,
    definirNoMapa: (...args) => gravados.push(args), salvarSnapshotKanban() {},
  };
  vm.runInNewContext(`${codigo}
    sincronizarDossieOperacional = async () => ({ id: "p1", empresa: "HCM" }); atualizarStatusAcompanhamentoNaTela = () => {};
    let terminar; carregamentoAcompanhamento = new Promise(ok => { terminar = () => { empresaAcompanhamentoPronta = true; ok(); }; });
    this.terminar = () => terminar(); this.salvar = salvarStatusAcompanhamento;`, contexto);
  const salvando = contexto.salvar("edital-1", { objeto: "Papel" }, "participando");
  await new Promise(ok => setImmediate(ok));
  assert.equal(gravados.length, 0);
  contexto.terminar();
  assert.deepEqual(JSON.parse(JSON.stringify(await salvando)), { empresaNome: "HCM", pendencia: null });
  assert.deepEqual(gravados[0], ["status-licitacao", "edital-1", "participando", "empresa"]);
});
