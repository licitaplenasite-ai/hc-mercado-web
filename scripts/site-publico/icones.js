// Mini-telas das ferramentas (rodada 2 do visual, 23/11). O dono recusou "iconezinho" em quadradinho: cada cartão
// mostra um pedaço trabalhado do que a ferramenta entrega (janela do sistema com camadas, sombra e um selo flutuante),
// no estilo da janela do pregão do site da HC. Desenho próprio, dados fictícios. Usado no index (bloco gerado:ferramentas)
// e em /ferramentas/. Decorativo (aria-hidden): o texto do cartão diz o que a ferramenta faz.
const W = 320, H = 190;

function arte(id, corpo) {
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false" font-family="Inter, system-ui, sans-serif">
<defs><filter id="s-${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#071b70" flood-opacity=".22"/></filter>
<pattern id="p-${id}" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#2255e0" fill-opacity=".18"/></pattern></defs>
<rect x="8" y="8" width="110" height="80" fill="url(#p-${id})"/>${corpo.replace(/FILTRO/g, `url(#s-${id})`)}</svg>`;
}
// Janela do sistema: barra azul-marinho com 3 pontos e título.
const janela = (x, y, w, h, titulo) => `<g filter="FILTRO"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#ffffff"/></g>
<path d="M${x} ${y + 10}a10 10 0 0 1 10-10h${w - 20}a10 10 0 0 1 10 10v12H${x}z" fill="#071b70"/>
<circle cx="${x + 12}" cy="${y + 11}" r="2.6" fill="#3b5bb8"/><circle cx="${x + 21}" cy="${y + 11}" r="2.6" fill="#3b5bb8"/><circle cx="${x + 30}" cy="${y + 11}" r="2.6" fill="#3b5bb8"/>
<text x="${x + 42}" y="${y + 15}" font-size="9" fill="#c9d6ff">${titulo}</text>`;
// Bloco âmbar deslocado atrás da janela (profundidade, como a moldura das fotos).
const fundo = (x, y, w, h) => `<rect x="${x + 12}" y="${y + 12}" width="${w}" height="${h}" rx="10" fill="#ffb547"/>`;
const selo = (x, y, w, texto, cor = "#071b70", corTexto = "#ffffff", ponto = "#ffb547") => `<g filter="FILTRO"><rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="${cor}"/></g>
<circle cx="${x + 14}" cy="${y + 13}" r="4" fill="${ponto}"/><text x="${x + 24}" y="${y + 17}" font-size="10" font-weight="600" fill="${corTexto}">${texto}</text>`;
const linha = (x, y, w, cor = "#e3e8f0") => `<rect x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="${cor}"/>`;

const ICONES = {
  "boletim-e-busca-de-licitacoes": arte("bol", `${fundo(40, 30, 236, 136)}${janela(40, 30, 236, 136, "Boletim de hoje · 7h")}
<rect x="50" y="62" width="216" height="30" rx="6" fill="#e8effe"/><rect x="50" y="62" width="3" height="30" rx="1.5" fill="#2255e0"/>
<rect x="60" y="70" width="40" height="13" rx="4" fill="#2255e0"/><text x="64" y="80" font-size="8" font-weight="700" fill="#fff">Pregão</text>${linha(106, 73, 90, "#9fb3e8")}<text x="258" y="81" font-size="9" font-weight="700" fill="#071b70" text-anchor="end">R$ 48.900</text>
<rect x="60" y="102" width="40" height="13" rx="4" fill="#dbe5ff"/>${linha(106, 105, 80)}<text x="258" y="113" font-size="9" font-weight="600" fill="#58657a" text-anchor="end">R$ 12.300</text>
<rect x="60" y="130" width="40" height="13" rx="4" fill="#dbe5ff"/>${linha(106, 133, 96)}<text x="258" y="141" font-size="9" font-weight="600" fill="#58657a" text-anchor="end">R$ 230.000</text>
${selo(196, 14, 98, "12 novas hoje")}`),

  "resumo-de-edital-com-ia": arte("res", `<g filter="FILTRO"><rect x="34" y="22" width="150" height="150" rx="8" fill="#ffffff"/></g>
${linha(50, 40, 90, "#071b70")}${linha(50, 56, 118)}${linha(50, 68, 104)}<rect x="48" y="80" width="118" height="10" rx="2" fill="#ffb547" fill-opacity=".45"/>${linha(50, 82, 110, "#c48a2a")}
${linha(50, 98, 116)}${linha(50, 110, 92)}<rect x="48" y="122" width="96" height="10" rx="2" fill="#ffb547" fill-opacity=".45"/>${linha(50, 124, 88, "#c48a2a")}${linha(50, 140, 110)}${linha(50, 152, 70)}
${janela(150, 58, 150, 108, "Resumo do edital")}
<circle cx="164" cy="96" r="3" fill="#2255e0"/>${linha(172, 93, 110, "#c7d3f3")}<circle cx="164" cy="114" r="3" fill="#2255e0"/>${linha(172, 111, 96, "#c7d3f3")}
<circle cx="164" cy="132" r="3" fill="#2255e0"/>${linha(172, 129, 104, "#c7d3f3")}<text x="162" y="155" font-size="8.5" fill="#58657a">Página 14 · item 8.2</text>
${selo(204, 28, 86, "Leu o PDF")}`),

  "vigia-do-chat-do-pregao": arte("chat", `${fundo(36, 34, 220, 132)}${janela(36, 34, 220, 132, "Chat do pregão · Compras.gov")}
<rect x="48" y="66" width="150" height="34" rx="8" fill="#f1f4fa"/><text x="58" y="79" font-size="8" font-weight="700" fill="#071b70">Pregoeiro · 14:32</text>${linha(58, 86, 120, "#c9d2e3")}
<rect x="48" y="108" width="176" height="44" rx="8" fill="#e8effe"/><text x="58" y="121" font-size="8" font-weight="700" fill="#1a3fc4">Pregoeiro · 14:35</text>${linha(58, 128, 150, "#9fb3e8")}${linha(58, 140, 96, "#9fb3e8")}
${selo(132, 12, 174, "Pregoeiro escreveu agora")}`),

  "orcamento-de-obras": arte("obra", `${fundo(34, 28, 240, 140)}${janela(34, 28, 240, 140, "Orçamento · SINAPI 10/2026")}
<rect x="44" y="58" width="220" height="16" rx="4" fill="#e8effe"/><text x="52" y="69" font-size="8" font-weight="700" fill="#1a3fc4">Código</text><text x="104" y="69" font-size="8" font-weight="700" fill="#1a3fc4">Serviço</text><text x="256" y="69" font-size="8" font-weight="700" fill="#1a3fc4" text-anchor="end">Total</text>
<text x="52" y="90" font-size="8.5" fill="#071b70">87503</text>${linha(104, 84, 90)}<text x="256" y="90" font-size="8.5" font-weight="600" fill="#071b70" text-anchor="end">18.420,00</text>
<text x="52" y="110" font-size="8.5" fill="#071b70">94965</text>${linha(104, 104, 70)}<text x="256" y="110" font-size="8.5" font-weight="600" fill="#071b70" text-anchor="end">7.315,40</text>
<text x="52" y="130" font-size="8.5" fill="#071b70">92873</text>${linha(104, 124, 84)}<text x="256" y="130" font-size="8.5" font-weight="600" fill="#071b70" text-anchor="end">31.902,10</text>
<rect x="44" y="140" width="220" height="1" fill="#e3e8f0"/><text x="52" y="156" font-size="8.5" font-weight="700" fill="#071b70">Total com BDI</text><text x="256" y="156" font-size="9" font-weight="700" fill="#1a3fc4" text-anchor="end">R$ 71.204,30</text>
${selo(206, 10, 88, "BDI 24,1%")}`),

  "contador-cbs-ibs": arte("cbs", `${fundo(40, 30, 232, 130)}${janela(40, 30, 232, 130, "Formação de preço · item 3")}
<text x="52" y="72" font-size="8.5" fill="#58657a">Custo, impostos e margem</text>
<g><rect x="52" y="80" width="88" height="22" rx="4" fill="#071b70"/><rect x="142" y="80" width="38" height="22" rx="0" fill="#2255e0"/><rect x="182" y="80" width="30" height="22" fill="#7fa2ff"/><rect x="214" y="80" width="46" height="22" rx="4" fill="#ffb547"/></g>
<text x="56" y="95" font-size="8" font-weight="700" fill="#fff">Custo</text><text x="146" y="95" font-size="8" font-weight="700" fill="#fff">CBS</text><text x="186" y="95" font-size="8" font-weight="700" fill="#071b70">IBS</text><text x="218" y="95" font-size="8" font-weight="700" fill="#071b70">Margem</text>
<text x="52" y="126" font-size="8.5" fill="#58657a">Preço mínimo</text><text x="52" y="146" font-size="17" font-weight="700" fill="#071b70">R$ 1.284,00</text>
${selo(160, 116, 106, "Regime: Simples", "#e8effe", "#1a3fc4", "#2255e0")}`),

  "pesquisa-de-precos": arte("preco", `${fundo(36, 30, 236, 136)}${janela(36, 30, 236, 136, "Quanto o governo pagou")}
<path d="M54 140h204" stroke="#e3e8f0"/><path d="M54 92h204" stroke="#ffb547" stroke-width="1.6" stroke-dasharray="4 4"/>
<g fill="#2255e0"><rect x="62" y="104" width="16" height="36" rx="3" fill-opacity=".35"/><rect x="88" y="86" width="16" height="54" rx="3" fill-opacity=".55"/><rect x="114" y="96" width="16" height="44" rx="3" fill-opacity=".45"/><rect x="140" y="72" width="16" height="68" rx="3"/><rect x="166" y="100" width="16" height="40" rx="3" fill-opacity=".45"/><rect x="192" y="90" width="16" height="50" rx="3" fill-opacity=".6"/><rect x="218" y="110" width="16" height="30" rx="3" fill-opacity=".35"/></g>
<text x="56" y="156" font-size="8" fill="#58657a">12 compras · últimos 12 meses</text>
${selo(170, 12, 124, "Mediana R$ 21,40", "#071b70", "#ffffff", "#ffb547")}`),

  "analise-de-concorrente": arte("conc", `${fundo(38, 28, 234, 138)}${janela(38, 28, 234, 138, "Concorrente · CNPJ")}
<circle cx="66" cy="76" r="15" fill="#e8effe"/><path d="M59 84v-12l7-5 7 5v12z" fill="#2255e0"/>${linha(88, 68, 110, "#071b70")}${linha(88, 80, 76)}
<rect x="50" y="102" width="62" height="48" rx="8" fill="#f3f7ff"/><text x="58" y="124" font-size="15" font-weight="700" fill="#071b70">38</text><text x="58" y="140" font-size="7.5" fill="#58657a">contratos</text>
<rect x="120" y="102" width="62" height="48" rx="8" fill="#f3f7ff"/><text x="128" y="124" font-size="15" font-weight="700" fill="#071b70">9</text><text x="128" y="140" font-size="7.5" fill="#58657a">órgãos</text>
<rect x="190" y="102" width="70" height="48" rx="8" fill="#f3f7ff"/><path d="M198 136l12-8 10 4 12-14 14 6" fill="none" stroke="#2255e0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
${selo(184, 10, 104, "Sem sanções", "#e7f5ee", "#0e6b4a", "#0e6b4a")}`),

  "minhas-empresas-e-documentos": arte("doc", `<g filter="FILTRO"><rect x="214" y="44" width="80" height="104" rx="8" fill="#071b70"/></g><rect x="224" y="56" width="60" height="78" rx="4" fill="#ffffff" fill-opacity=".1"/><text x="254" y="102" font-size="13" font-weight="700" fill="#ffb547" text-anchor="middle">PDF</text><text x="254" y="118" font-size="7.5" fill="#c9d6ff" text-anchor="middle">único</text>
${janela(30, 30, 200, 138, "Certidões · Empresa Exemplo")}
<circle cx="46" cy="72" r="5" fill="#16a36a"/><text x="58" y="75" font-size="8.5" fill="#071b70">Federal</text><text x="218" y="75" font-size="8" fill="#0e6b4a" text-anchor="end">vale até 12/03</text>
<circle cx="46" cy="96" r="5" fill="#16a36a"/><text x="58" y="99" font-size="8.5" fill="#071b70">FGTS</text><text x="218" y="99" font-size="8" fill="#0e6b4a" text-anchor="end">vale até 02/01</text>
<circle cx="46" cy="120" r="5" fill="#f0a020"/><text x="58" y="123" font-size="8.5" fill="#071b70">Estadual</text><text x="218" y="123" font-size="8" font-weight="700" fill="#8a4b00" text-anchor="end">vence em 7 dias</text>
<circle cx="46" cy="144" r="5" fill="#d64535"/><text x="58" y="147" font-size="8.5" fill="#071b70">Trabalhista</text><text x="218" y="147" font-size="8" font-weight="700" fill="#b42318" text-anchor="end">vencida</text>`),
};

module.exports = { ICONES };
