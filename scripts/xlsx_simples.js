// Ler e gravar .xlsx no Node sem biblioteca nova (adm-zip, já dependência). Usado pelo Orçamento de obra
// (scripts/orcamento_obra.js e testes). No navegador o mesmo papel é do SheetJS (orcamento-obra.html).
// Lê só valores (o que está em cache no arquivo), sem estilo; grava texto e número, sem fórmula nem formatação.
//   const { lerXlsx, gravarXlsx } = require("./xlsx_simples");
//   lerXlsx(buffer) -> [{ nome, linhas: [[celula, ...], ...] }]
//   gravarXlsx([{ nome, linhas }]) -> Buffer
const AdmZip = require("adm-zip");
const { textosCompartilhados, mapaAbas, xmlTexto } = require("./coletar_sinapi");

// Linhas da aba com o tipo de cada célula: texto (t="s", "inlineStr", "str") fica texto, mesmo que pareça número
// ("1.10", "00004813"); o resto é número. (linhasDaAba do robô do SINAPI devolve tudo como texto.)
function* linhasComTipo(xml, compartilhados) {
  const textoDe = (corpo) => xmlTexto([...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
  for (const r of xml.matchAll(/<row\s[^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas = {};
    for (const c of r[2].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = c[1], corpo = c[2] || "", ref = /\br="([A-Z]+)\d+"/.exec(attr)?.[1], tipo = /\bt="([^"]+)"/.exec(attr)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      if (!ref) continue;
      if (tipo === "s") celulas[ref] = compartilhados[Number(v)] ?? "";
      else if (tipo === "inlineStr") celulas[ref] = textoDe(corpo);
      else if (v !== undefined) celulas[ref] = tipo === "str" || tipo === "e" || tipo === "b" ? xmlTexto(v) : Number(v);
    }
    yield { n: Number(r[1]), celulas };
  }
}

// "A" -> 0, "AB" -> 27
const indiceColuna = (letras) => [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const letraColuna = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function lerXlsx(buffer) {
  const zip = new AdmZip(buffer);
  const ler = (caminho) => zip.getEntry(caminho)?.getData().toString("utf8") ?? null;
  const workbook = ler("xl/workbook.xml");
  if (!workbook) throw new Error("Arquivo não é um .xlsx (falta xl/workbook.xml). Se for .xls antigo, salve como .xlsx no Excel.");
  const compartilhados = textosCompartilhados(ler("xl/sharedStrings.xml"));
  return Object.entries(mapaAbas(workbook, ler("xl/_rels/workbook.xml.rels") || "")).map(([nome, caminho]) => {
    const linhas = [];
    for (const { n, celulas } of linhasComTipo(ler(caminho) || "", compartilhados)) {
      const linha = [];
      for (const [col, v] of Object.entries(celulas)) linha[indiceColuna(col)] = typeof v === "number" && !Number.isFinite(v) ? "" : v;
      linhas[n - 1] = Array.from(linha, (c) => (c === undefined ? "" : c));
    }
    return { nome, linhas: Array.from(linhas, (l) => l || []) };
  });
}

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[^\t\n\r\u0020-\uFFFF]/g, "") // caractere de controle invalida o XML;
// Nome de aba: até 31 caracteres, sem : \ / ? * [ ]
const nomeAba = (s, i) => String(s || `Aba ${i + 1}`).replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

function folha(linhas) {
  const rows = linhas.map((l, i) => `<row r="${i + 1}">${(l || []).map((v, j) => {
    if (v === "" || v === null || v === undefined) return "";
    const ref = `${letraColuna(j)}${i + 1}`;
    return typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function gravarXlsx(abas) {
  const zip = new AdmZip();
  const add = (nome, texto) => zip.addFile(nome, Buffer.from(texto, "utf8"));
  const lista = abas.map((a, i) => ({ ...a, nome: nomeAba(a.nome, i) }));
  add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${lista.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${lista.map((a, i) => `<sheet name="${xml(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${lista.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  lista.forEach((a, i) => add(`xl/worksheets/sheet${i + 1}.xml`, folha(a.linhas)));
  return zip.toBuffer();
}

module.exports = { lerXlsx, gravarXlsx, indiceColuna, letraColuna };
