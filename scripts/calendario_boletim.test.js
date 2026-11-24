const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  let bolResultadosCompletos = [];");
const fim = html.indexOf("  function filtrarResultadosDoBoletim(", inicio);
assert.ok(inicio >= 0 && fim > inicio, "Bloco do calendário deve existir no painel");
const codigoCalendario = html.slice(inicio, fim);
const codigoFormatarData = html.match(/ {2}function formatarDataIso\(s\) \{[\s\S]*?\n {2}\}/)[0];

function criarCalendario(resultados) {
  const elementos = new Map();
  const renderizacoes = [];
  const calendario = {
    set innerHTML(valor) {
      this.html = valor;
      elementos.clear();
      this.dias = [...valor.matchAll(/<(?:button|div)\b[^>]*class="([^"]*bol-cal-dia[^"]*)"[^>]*data-dia="([^"]+)"/g)]
        .map((match) => ({
          classe: match[1], dataset: { dia: match[2] },
          addEventListener(evento, callback) { this[evento] = callback; },
        }));
      for (const id of ["bol-cal-limpar"]) {
        if (valor.includes(`id="${id}"`)) {
          elementos.set(id, { addEventListener(evento, callback) { this[evento] = callback; } });
        }
      }
    },
    querySelectorAll(seletor) {
      return seletor.includes(".tem-dados")
        ? this.dias.filter((dia) => dia.classe.includes("tem-dados")) : this.dias;
    },
  };
  // Botões dos 4 últimos meses (no lugar das setas) e o título "Boletins de <Mês> de <Ano>".
  const meses = {
    set innerHTML(valor) {
      this.html = valor;
      this.botoes = [...valor.matchAll(/data-mes="([^"]+)"[^>]*>([^<]+)</g)].map(([, mes, nome]) => ({
        nome, dataset: { mes }, addEventListener(evento, callback) { this[evento] = callback; },
      }));
    },
    querySelectorAll() { return this.botoes; },
  };
  const titulo = { textContent: "" };
  const fixos = { "bol-calendario": calendario, "bol-meses": meses, "bol-mes-titulo": titulo };
  const contexto = vm.createContext({
    window: {},
    document: { getElementById(id) { return fixos[id] || elementos.get(id); } },
    renderizarPainelBoletim: (_alvo, lista, aviso) => renderizacoes.push({ lista, aviso }),
    resultados,
  });
  vm.runInContext(codigoFormatarData + codigoCalendario, contexto);
  vm.runInContext('bolMesReferencia = new Date(2026, 8, 1); renderizarBoletimComCalendario(resultados, "");', contexto);
  return { contexto, calendario, elementos, renderizacoes, meses, titulo };
}

test("calendário abre dia sem dados e permite limpar o filtro", () => {
  const { calendario, elementos, renderizacoes } = criarCalendario([{ publicacao: "2026-09-10T12:00:00" }]);
  const dia11 = calendario.dias.find((dia) => dia.dataset.dia === "2026-09-11");
  assert.equal(typeof dia11.click, "function", "Dia 11 sem dados precisa responder ao clique");
  dia11.click();
  assert.equal(renderizacoes.at(-1).lista.length, 0);
  assert.match(renderizacoes.at(-1).aviso, /Nenhuma oportunidade publicada/);
  elementos.get("bol-cal-limpar").click();
  assert.equal(renderizacoes.at(-1).lista.length, 1);
});

test("calendário filtra dias com dados, desmarca e navega entre meses", () => {
  const { calendario, renderizacoes, meses, titulo } = criarCalendario([
    { publicacao: "2026-09-11T12:00:00" }, { publicacao: "2026-09-10T12:00:00" },
  ]);
  calendario.dias.find((dia) => dia.dataset.dia === "2026-09-11").click();
  assert.equal(renderizacoes.at(-1).lista.length, 1);
  assert.equal(renderizacoes.at(-1).lista[0].publicacao, "2026-09-11T12:00:00");
  calendario.dias.find((dia) => dia.dataset.dia === "2026-09-11").click();
  assert.equal(renderizacoes.at(-1).lista.length, 2);
  assert.equal(meses.botoes.length, 4, "4 últimos meses");
  const primeiro = meses.botoes[0];
  primeiro.click();
  const [ano, mes] = primeiro.dataset.mes.split("-").map(Number);
  assert.equal(titulo.textContent, `${primeiro.nome} de ${ano}`);
  assert.match(calendario.html, new RegExp(`data-dia="${ano}-${String(mes + 1).padStart(2, "0")}-01"`));
  assert.match(meses.html, new RegExp(`class="bol-mes ativo" data-mes="${primeiro.dataset.mes}"`));
});

test("datas sem horário mantêm o dia de publicação no fuso de Manaus", () => {
  const anterior = process.env.TZ;
  process.env.TZ = "America/Manaus";
  try {
    const { contexto, calendario } = criarCalendario([]);
    assert.equal(vm.runInContext('bolChaveDia("2026-09-11")', contexto), "2026-09-11");
    assert.equal(vm.runInContext('bolChaveDia("2026-09-11T02:00:00Z")', contexto), "2026-09-10");
    assert.equal(vm.runInContext('bolChaveDia("inválida")', contexto), null);
    assert.match(calendario.html, /data-dia="2026-09-11"[^>]*aria-label="11\/09\/2026:/);
    calendario.dias.find((dia) => dia.dataset.dia === "2026-09-11").click();
    assert.match(calendario.html, /Mostrando oportunidades de 11\/09\/2026/);
  } finally {
    if (anterior === undefined) delete process.env.TZ;
    else process.env.TZ = anterior;
  }
});

test("todos os dias reais são botões acessíveis, incluindo dias sem dados", () => {
  const { calendario } = criarCalendario([]);
  assert.equal([...calendario.html.matchAll(/<button\b[^>]*data-dia=/g)].length, 30);
  assert.match(calendario.html, /aria-pressed="false"/);
});

test("edições viram etiquetas no dia, verdes quando todas as licitações foram lidas", () => {
  const { contexto, calendario } = criarCalendario([]);
  vm.runInContext(`escapeHtml = String; lerConjunto = () => new Set(["A", "B"]);
    window.__bolEdicoesLista = [
      { id: "e1", edicao: "2026-09-10", numero: 1744, quantidade: 2, numeros: ["A", "B"], empresa: "X", filtro_nome: "principal" },
      { id: "e2", edicao: "2026-09-10", numero: 1745, quantidade: 3, numeros: ["A", "C"] }];
    window.__bolRedesenharCalendario();`, contexto);
  assert.match(calendario.html, /class="bol-cal-edicao lida"[^>]*>✓ Boletim 1744 · 2</);
  assert.match(calendario.html, /class="bol-cal-edicao nova"[^>]*>Boletim 1745 · 3</);
  assert.match(calendario.html, /aria-label="Boletim 1745, 3 editais, não lido"/);
});

test("o calendário não posiciona edital sem data de publicação pela data de abertura", () => {
  const resultados = [{ publicacao: null, encerramento: "2026-10-15", fonte: "SENAC/AM" }];
  const { contexto, renderizacoes } = criarCalendario(resultados);
  const dias = vm.runInContext("[...bolAgruparPorDia(bolResultadosCompletos).keys()]", contexto);
  assert.equal(dias.length, 0);
  assert.equal(renderizacoes.at(-1).lista.length, 1, "o edital continua na lista geral");
});
