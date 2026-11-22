// Orçamento de obra pela linha de comando: o mesmo fluxo da tela orcamento-obra.html (Leitor -> Orçamentista ->
// Auditor -> Montador), sem banco. Serve para o piloto com planilhas reais e para conferir um edital à mão.
//   node scripts/orcamento_obra.js --edital planilha.xlsx [--cpu cpu.xlsx] [--sinapi SINAPI-AAAA-MM-formato-xlsx.zip]
//        [--uf AM] [--desonerado sim|nao] [--bdi 28,35] [--desconto 17] [--modo truncar|arredondar]
//        [--modo-total truncar|arredondar] [--meses 6] [--saida orcamento.xlsx] [--formato-edital edital-preenchido.xlsx]
// --cpu: anexo de composições do edital (vira base de preços por fonte).
// --sinapi: ZIP mensal da CAIXA (formato de 2025 em diante, o mesmo do robô scripts/coletar_sinapi.js).
// Sem variáveis de ambiente: não grava em lugar nenhum além dos arquivos pedidos.
const fs = require("node:fs");
const { lerXlsx, gravarXlsx } = require("./xlsx_simples");
const { abrirReferencia, lerTabela, lerAnalitico } = require("./coletar_sinapi");
const Leitor = require("../orcamento-obra-leitor.js");
const Montador = require("../orcamento-obra-montador.js");

// SINAPI de uma UF e regime -> base { composicoes, precos, referencia, uf, desonerado } para o Orçamentista.
function baseSinapi(zipBuffer, uf, desonerado, referencia = "") {
  const pacote = abrirReferencia(zipBuffer);
  const precos = {};
  for (const aba of desonerado ? ["ICD", "CCD"] : ["ISD", "CSD"]) {
    for (const l of lerTabela(pacote.lerAba(aba), pacote.compartilhados, aba, [uf])) if (l.precos[uf] !== null) precos[`${l.tipo}|${l.codigo}`] = Number(l.precos[uf]);
  }
  const composicoes = {};
  for (const it of lerAnalitico(pacote.lerAba("Analítico"), pacote.compartilhados, referencia || "0000-00")) {
    (composicoes[it.composicao] ||= { descricao: "", unidade: "", itens: [] }).itens.push({ tipo: it.item_tipo, codigo: it.item_codigo, descricao: it.descricao, unidade: it.unidade, coeficiente: Number(it.coeficiente) });
  }
  return { composicoes, precos, referencia, uf, desonerado };
}

const numero = (s) => (s === undefined ? undefined : Number(String(s).replace(",", ".")));
function argumentos(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? "sim" : argv[++i];
  return a;
}

function rodar(a) {
  if (!a.edital) throw new Error("Informe --edital planilha.xlsx");
  const abas = lerXlsx(fs.readFileSync(a.edital));
  const leitura = Leitor.lerPasta(abas);
  if (leitura.erro) throw new Error(leitura.erro);
  const uf = a.uf || leitura.cabecalho.uf;
  const desonerado = a.desonerado ? a.desonerado === "sim" : leitura.cabecalho.desonerado === true;
  const bases = a.cpu ? Leitor.lerCpu(lerXlsx(fs.readFileSync(a.cpu)).flatMap((x) => x.linhas)).bases : {};
  if (a.sinapi) bases.SINAPI = baseSinapi(fs.readFileSync(a.sinapi), uf, desonerado, a.referencia || "");
  const orc = Montador.montarOrcamento(leitura, {
    bases, bdiFracao: a.bdi === undefined ? undefined : numero(a.bdi) / 100, desconto: a.desconto === undefined ? {} : { linear: numero(a.desconto) / 100 },
    modo: a.modo, modoTotal: a["modo-total"], meses: numero(a.meses) || 1, regime: { desonerado },
  });
  if (a.saida) fs.writeFileSync(a.saida, gravarXlsx(Montador.montarAbas(orc)));
  if (a["formato-edital"]) {
    const original = abas.find((x) => x.nome === leitura.aba);
    fs.writeFileSync(a["formato-edital"], gravarXlsx([{ nome: leitura.aba, linhas: Montador.formatoEdital(original.linhas, orc) }]));
  }
  return orc;
}

if (require.main === module) {
  try {
    const orc = rodar(argumentos(process.argv.slice(2)));
    const s = orc.linhas.filter((l) => l.tipo === "servico");
    console.log(JSON.stringify({ aba: orc.leitura.aba, cabecalho: orc.leitura.cabecalho, servicos: s.length, semPreco: s.filter((l) => l.referencia === null).length,
      total: orc.total, globalProposta: orc.globalProposta, globalReferencia: orc.globalReferencia, alertas: orc.resumoAlertas }, null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

module.exports = { baseSinapi, rodar, argumentos };
