// Edital FICTÍCIO de 200 itens no PNCP, só para o e2e da escolha de itens (e2e-itens-escolha.cjs).
//   node -r ./ambiente-teste/pncp-ficticio.cjs ambiente-teste/servidor.cjs
// Intercepta só o órgão 99999999000191 (CNPJ inexistente) compra 2026/77; o resto da rede segue normal.
// tipoBeneficio como o PNCP: múltiplos de 5 = 1 (exclusivo ME/EPP), múltiplos de 7 (não de 5) = 3 (cota reservada), resto = 4.
const BASE = 'https://pncp.gov.br/api/pncp/v1/orgaos/99999999000191/compras/2026/77/itens';
const TOTAL = 200;
const OBJETOS = ['Papel A4 sulfite 75 g, resma com 500 folhas', 'Caneta esferográfica azul', 'Grampeador de mesa', 'Pasta suspensa', 'Toner para impressora', 'Café torrado e moído 500 g', 'Copo descartável 200 ml'];
const beneficio = (n) => (n % 5 === 0 ? [1, 'Participação exclusiva para ME/EPP'] : n % 7 === 0 ? [3, 'Cota reservada para ME/EPP'] : [4, 'Sem benefício']);
const item = (n) => ({ numeroItem: n, descricao: `Item fictício ${n}: ${OBJETOS[n % OBJETOS.length]}`, quantidade: 200, unidadeMedida: 'UNIDADE',
  tipoBeneficio: beneficio(n)[0], tipoBeneficioNome: beneficio(n)[1], materialOuServicoNome: 'Material', valorUnitarioEstimado: 10, catalogoCodigoItem: null });
const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
const original = globalThis.fetch;
globalThis.fetch = async (url, op) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.startsWith(BASE)) return original(url, op);
  const resto = u.slice(BASE.length);
  const um = /^\/(\d+)$/.exec(resto);
  if (um) { const n = Number(um[1]); return n >= 1 && n <= TOTAL ? json(item(n)) : new Response('', { status: 404 }); }
  const q = new URL(u).searchParams, pagina = Number(q.get('pagina') || 1), tam = Number(q.get('tamanhoPagina') || 500);
  const lista = Array.from({ length: TOTAL }, (_, k) => item(k + 1)).slice((pagina - 1) * tam, pagina * tam);
  return lista.length ? json(lista) : new Response(null, { status: 204 });
};
