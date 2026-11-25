// Peças de texto dos adaptadores FAEPI, BLL e SEBRAE (scripts/fontes/): entidades HTML, texto sem tags e data
// brasileira -> formato do PNCP. Separado de comum.js para não mexer no arquivo compartilhado do AADC.
const { limparEspacos } = require("./comum");

const NOMEADAS = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", ordm: "º", ordf: "ª", deg: "°", ndash: "–", mdash: "—" };

function decodificar(txt) {
  return String(txt ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NOMEADAS[n.toLowerCase()] ?? m);
}

const textoDoHtml = (html) => limparEspacos(decodificar(String(html ?? "").replace(/<[^>]+>/g, " ")));

// "24/11/2026 13:54" ou "24/11/2026 às 13:54" ou "24/11/2026" -> "2026-11-24T13:54:00"; inválida -> null.
function dataBr(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})(?:\D{1,6}(\d{1,2})[:h](\d{2}))?/.exec(String(txt ?? ""));
  if (!m) return null;
  const [, d, mes, a, h = "00", min = "00"] = m;
  const data = new Date(Date.UTC(+a, +mes - 1, +d));
  if (data.getUTCMonth() !== +mes - 1 || data.getUTCDate() !== +d || +h > 23 || +min > 59) return null;
  return `${a}-${mes}-${d}T${h.padStart(2, "0")}:${min}:00`;
}

// Agora em Brasília (UTC-3, sem horário de verão) no mesmo formato, para comparar com dataBr().
const agoraBrasilia = (ms = Date.now()) => new Date(ms - 3 * 3600000).toISOString().slice(0, 19);

module.exports = { decodificar, textoDoHtml, dataBr, agoraBrasilia };
