// Capas do blog (desenho próprio do LicitaPlena, sem imagem de terceiros). 1200x630, o tamanho do og:image.
// Fundo: degradê da marca (#071b70 -> #2459e6) + brilho + malha de pontos + anéis; à direita o desenho
// do tema da categoria em traço branco com um detalhe âmbar (#ffb547). Cada artigo varia brilho, anéis e
// pontos a partir do próprio slug, então duas capas da mesma categoria não ficam iguais.
// O SVG vai para a tela; scripts/gerar_capas_blog.js converte em .jpg para o og:image (redes sociais não leem SVG).

// Número estável a partir do texto (FNV-1a), para a variação não mudar entre uma geração e outra.
function semente(texto) {
  let h = 2166136261;
  for (const c of texto) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
const faixa = (s, i, min, max) => min + ((s >>> (i * 3)) % 1000) / 1000 * (max - min);
const n = (v) => Math.round(v * 10) / 10;

const PAINEL = '<rect x="-200" y="-160" width="400" height="320" rx="32" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".28" stroke-width="3"/>';
const MOTIVOS = {
  // Escada com bandeira: primeiros passos.
  "primeiros-passos": `<path d="M-160 120h80v-60h80v-60h80v-60h80" stroke-width="12"/><path d="M-160 120h320" stroke-opacity=".4" stroke-width="6"/>
<path d="M160 -60v-110" stroke-width="8"/><path d="M160 -170l84 30-84 30z" fill="#ffb547" stroke="#ffb547" stroke-width="6"/>`,
  // Pasta de documentos com selo de conferido.
  "documentos-e-habilitacao": `<rect x="-150" y="-130" width="190" height="240" rx="18" fill="#fff" fill-opacity=".1" stroke-opacity=".55" stroke-width="6"/>
<rect x="-110" y="-150" width="190" height="240" rx="18" fill="#123aa8" stroke-width="8"/><path d="M-80 -100h120M-80 -60h130M-80 -20h90M-80 20h110" stroke-width="8"/>
<circle cx="90" cy="80" r="62" fill="#ffb547" stroke="#ffb547"/><path d="M62 80l20 20 36-40" stroke="#071b70" stroke-width="12"/>`,
  // Capacete de obra sobre planta quadriculada.
  "obras-e-engenharia": `<path d="M-180 -120h360M-180 -60h360M-180 0h360M-120 -150v180M-40 -150v180M40 -150v180M120 -150v180" stroke-opacity=".2" stroke-width="3"/>
<path d="M-160 70a160 160 0 0 1 320 0z" fill="#fff" fill-opacity=".14" stroke-width="10"/><path d="M0 -90v-24M-60 -70l24 60M60 -70l-24 60" stroke-width="10"/>
<rect x="-210" y="70" width="420" height="44" rx="18" fill="#123aa8" stroke-width="10"/><circle cx="170" cy="-110" r="16" fill="#ffb547" stroke="#ffb547"/>`,
  // Calculadora com sinal de porcentagem.
  "impostos-e-precos": `<rect x="-170" y="-160" width="210" height="320" rx="26" fill="#123aa8" stroke-width="10"/><rect x="-140" y="-130" width="150" height="64" rx="10" fill="#ffb547" stroke="#ffb547"/>
<path d="M-125 -20h0M-65 -20h0M-5 -20h0M-125 40h0M-65 40h0M-5 40h0M-125 100h0M-65 100h0M-5 100h0" stroke-width="26"/>
<circle cx="115" cy="-80" r="24" stroke-width="10"/><circle cx="195" cy="20" r="24" stroke-width="10"/><path d="M205 -100l-100 140" stroke-width="10"/>`,
  // Martelo do pregoeiro e balão de chat.
  "pregao-e-disputa": `<g transform="translate(-70 -30) rotate(35)"><rect x="40" y="-17" width="200" height="30" rx="14" fill="#fff" fill-opacity=".14" stroke-width="8"/><rect x="-40" y="-85" width="84" height="150" rx="18" fill="#123aa8" stroke-width="10"/></g>
<rect x="-200" y="112" width="220" height="36" rx="14" fill="#fff" fill-opacity=".14" stroke-width="8"/>
<path d="M70 -170h140a20 20 0 0 1 20 20v70a20 20 0 0 1-20 20h-80l-40 34v-34h-20a20 20 0 0 1-20-20v-70a20 20 0 0 1 20-20z" fill="#fff" fill-opacity=".12" stroke-width="8"/>
<circle cx="110" cy="-115" r="9" fill="#ffb547" stroke="#ffb547"/><circle cx="145" cy="-115" r="9" fill="#ffb547" stroke="#ffb547"/><circle cx="180" cy="-115" r="9" fill="#ffb547" stroke="#ffb547"/>`,
  // Megafone com brilhos: novidades.
  novidades: `<path d="M-170 -40h70l170-100v280l-170-100h-70z" fill="#123aa8" stroke-width="10"/><path d="M-140 40l30 90h44l-20-70" stroke-width="10"/>
<path d="M120 -60c30 20 30 100 0 120" stroke-width="10"/><path d="M165 -95c55 40 55 170 0 210" stroke-opacity=".6" stroke-width="10"/>
<path d="M200 -160l10 26 26 10-26 10-10 26-10-26-26-10 26-10z" fill="#ffb547" stroke="#ffb547" stroke-width="4"/>`,
};

function capaSvg(categoria, chave) {
  const motivo = MOTIVOS[categoria];
  if (!motivo) throw new Error(`capa: categoria sem desenho ${categoria}`);
  const s = semente(chave);
  const gx = n(faixa(s, 0, 0.6, 0.9)), gy = n(faixa(s, 1, 0.2, 0.6));
  const ax = n(faixa(s, 2, 760, 900)), ay = n(faixa(s, 3, 250, 380));
  const pontos = [0, 1, 2].map((i) => `<circle cx="${n(faixa(s, i + 4, 80, 560))}" cy="${n(faixa(s, i + 7, 70, 560))}" r="${i ? 5 : 8}" fill="#fff" fill-opacity="${i ? ".45" : ".7"}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071b70"/><stop offset=".55" stop-color="#123aa8"/><stop offset="1" stop-color="#2459e6"/></linearGradient>
<radialGradient id="b" cx="${gx}" cy="${gy}" r=".55"><stop offset="0" stop-color="#6f97ff" stop-opacity=".55"/><stop offset="1" stop-color="#6f97ff" stop-opacity="0"/></radialGradient>
<pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#fff" fill-opacity=".12"/></pattern></defs>
<rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="630" fill="url(#b)"/><rect width="1200" height="630" fill="url(#p)"/>
<g fill="none" stroke="#fff"><circle cx="${ax}" cy="${ay}" r="170" stroke-opacity=".2" stroke-width="3"/><circle cx="${ax}" cy="${ay}" r="270" stroke-opacity=".12" stroke-width="3"/><circle cx="${ax}" cy="${ay}" r="380" stroke-opacity=".07" stroke-width="3"/>
<path d="M0 540c160-50 260 40 430-10s300-70 480-20 240 10 290-10" stroke-opacity=".16" stroke-width="3"/></g>
${pontos}<circle cx="${n(faixa(s, 5, 120, 520))}" cy="${n(faixa(s, 6, 420, 580))}" r="10" fill="#ffb547"/>
<g transform="translate(830 315)" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">${PAINEL}${motivo}</g>
</svg>
`;
}

module.exports = { capaSvg, MOTIVOS };
