// Ícones ilustrados das ferramentas (desenho próprio do LicitaPlena, traço azul + preenchimento claro).
// Usados no index (bloco gerado:ferramentas) e em /ferramentas/. Cores vêm do CSS (marca.css):
// o traço usa currentColor e o preenchimento a classe "ac" (var(--ico-ac)).
const svg = (corpo) => `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${corpo}</svg>`;

const ICONES = {
  "boletim-e-busca-de-licitacoes": svg('<rect x="5" y="11" width="30" height="22" rx="3"/><path d="M5 14l15 10 15-10"/><circle class="ac" cx="34" cy="32" r="7"/><path d="M39 37l5 5"/>'),
  "resumo-de-edital-com-ia": svg('<path d="M12 5h16l8 8v29a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M28 5v8h8M16 21h14M16 27h9"/><path class="ac" d="M35 27l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>'),
  "vigia-do-chat-do-pregao": svg('<path d="M8 10h26a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H20l-8 7v-7H8a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z"/><path d="M13 21h0M21 21h0M29 21h0" stroke-width="3.5"/><circle class="ac" cx="40" cy="10" r="5"/>'),
  "orcamento-de-obras": svg('<path class="ac" d="M9 32a15 15 0 0 1 30 0z"/><path d="M24 17v-4M17 19l3 9M31 19l-3 9"/><rect x="5" y="32" width="38" height="6" rx="2"/>'),
  "contador-cbs-ibs": svg('<rect x="11" y="5" width="26" height="38" rx="3"/><rect class="ac" x="15" y="9" width="18" height="8" rx="1.5"/><path d="M17 24h0M24 24h0M31 24h0M17 30h0M24 30h0M31 30h0M17 36h0M24 36h0M31 36h0" stroke-width="3.5"/>'),
  "pesquisa-de-precos": svg('<path class="ac" d="M5 25L24 6h15a2 2 0 0 1 2 2v15L22 42a3 3 0 0 1-4.2 0L5 29.2a3 3 0 0 1 0-4.2z"/><circle cx="33" cy="14" r="3"/><path d="M16 27l7-7M19 31l7-7"/>'),
  "analise-de-concorrente": svg('<rect x="6" y="27" width="6" height="14" rx="1"/><rect class="ac" x="16" y="19" width="6" height="22" rx="1"/><rect x="26" y="31" width="6" height="10" rx="1"/><circle cx="35" cy="13" r="7"/><path d="M40 18l5 5"/>'),
  "minhas-empresas-e-documentos": svg('<path class="ac" d="M5 14a3 3 0 0 1 3-3h10l4 4h18a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M17 27l5 5 9-10"/>'),
};

module.exports = { ICONES };
