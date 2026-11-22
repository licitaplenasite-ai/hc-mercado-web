/* global module -- funções puras do estudo de quem ganha e quem perde (navegador e Node) */
// Usado pelo robô scripts/estudo_obras.js (classifica e agrupa as disputas) e pela tela do Orçamentista ("o que
// costuma acontecer"): o mesmo tipo de obra e a mesma faixa dos dois lados, para a frase bater com o banco.
(function () {
  'use strict';
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Tipo de obra pelo objeto (o primeiro que casar). null = não é obra (fica fora do estudo).
  const TIPOS = [
    ['pavimentacao', /paviment|asfalt|recapeament|tapa.buraco|calcament|meio.fio/],
    ['drenagem_saneamento', /drenag|esgot|saneament|abastecimento de agua|rede de agua|galeria pluvial/],
    ['eletrica', /eletric|subesta|iluminac|fotovolt|usina solar|spda|cabeament/],
    ['reforma', /reform|requalific|revitaliz|recupera|restaura|manutenc|adequac|readequac|retrofit/],
    ['ampliacao', /amplia/],
    ['construcao', /constru|edifica|implantac/],
    ['rodovia_ponte', /rodovi|estrada|ponte|viadut|terraplen/],
  ];
  const NOMES_TIPO = { pavimentacao: 'pavimentação', drenagem_saneamento: 'drenagem e saneamento', eletrica: 'elétrica', reforma: 'reforma', ampliacao: 'ampliação', construcao: 'construção', rodovia_ponte: 'rodovia e ponte', outra_obra: 'obra' };
  // Palavras do recorte do estudo (obra, reforma, construção, engenharia, pavimentação, terraplanagem, elétrica, drenagem,
  // ampliação) e as que apareceram na amostra de 22/11 (projeto, recuperação, acessibilidade, cobertura, ciclovia...).
  const OBRA = /\bobra|engenharia|constru|reform|paviment|terraplen|eletric|drenag|amplia|edifica|saneament|rodovi|ponte|projet|recupera|acessibilidade|cobertura|ciclovia|passeio|talude|conclusao/;
  function tipoDeObra(objeto) {
    const s = semAcento(objeto);
    if (!OBRA.test(s)) return null;
    return (TIPOS.find(([, re]) => re.test(s)) || ['outra_obra'])[0];
  }
  function faixaDeValor(v) {
    if (v <= 1e6) return 'ate_1mi';
    if (v <= 5e6) return '1a5mi';
    if (v <= 20e6) return '5a20mi';
    if (v <= 100e6) return '20a100mi';
    return 'acima_100mi';
  }
  const NOMES_FAIXA = { ate_1mi: 'até R$ 1 milhão', '1a5mi': 'de R$ 1 a 5 milhões', '5a20mi': 'de R$ 5 a 20 milhões', '20a100mi': 'de R$ 20 a 100 milhões', acima_100mi: 'acima de R$ 100 milhões' };
  const REGIAO = { N: 'AC AM AP PA RO RR TO', NE: 'AL BA CE MA PB PE PI RN SE', CO: 'DF GO MS MT', SE: 'ES MG RJ SP', S: 'PR RS SC' };
  const NOMES_REGIAO = { N: 'no Norte', NE: 'no Nordeste', CO: 'no Centro-Oeste', SE: 'no Sudeste', S: 'no Sul' };
  const regiaoDe = (uf) => Object.keys(REGIAO).find((r) => REGIAO[r].split(' ').includes(uf)) || null;

  // Do mais específico ao mais geral: a tela usa o primeiro recorte com amostra suficiente.
  function recortesCandidatos(uf, tipo, faixa) {
    const r = regiaoDe(uf), t = tipo || '*', f = faixa || '*';
    const c = [];
    if (uf && r) c.push(`uf:${uf}|${t}|${f}`, `uf:${uf}|${t}|*`, `uf:${uf}|*|*`, `regiao:${r}|${t}|*`, `regiao:${r}|*|*`);
    c.push(`BR|${t}|${f}`, `BR|${t}|*`, 'BR|*|*');
    return [...new Set(c)];
  }

  const pct = (v) => `${Number(v).toFixed(1).replace('.', ',')}%`;
  // Estatísticas do banco ({ recorte: { n, dados } }) -> o recorte usado e a frase em português simples. Mínimo de
  // MINIMO disputas: com menos, sobe para um recorte mais geral (e a frase diz qual).
  const MINIMO = 10;
  function fraseDoEstudo(estatisticas, uf, tipo, faixa) {
    for (const recorte of recortesCandidatos(uf, tipo, faixa)) {
      const e = estatisticas[recorte];
      if (!e || e.n < MINIMO || e.dados?.desconto_mediana === null || e.dados?.desconto_mediana === undefined) continue;
      const [escopo, t, f] = recorte.split('|');
      const onde = escopo === 'BR' ? 'no Brasil' : escopo.startsWith('uf:') ? `no ${escopo.slice(3)}` : NOMES_REGIAO[escopo.slice(7)] || '';
      const oque = t === '*' ? 'obras' : `obras de ${NOMES_TIPO[t] || t}`;
      const valor = f === '*' ? '' : ` ${NOMES_FAIXA[f]}`;
      const d = e.dados;
      let frase = `Em ${oque}${valor} ${onde} (${e.n} concorrências concluídas), o vencedor deu em geral ${pct(d.desconto_mediana)} de desconto`
        + `${d.desconto_p25 !== null && d.desconto_p75 !== null ? ` (metade ficou entre ${pct(d.desconto_p25)} e ${pct(d.desconto_p75)})` : ''}`
        + ` e em ${pct(d.pct_com_recusa_mais_barata)} delas ao menos uma proposta mais barata caiu antes dele.`;
      const faixas = d.recusa_por_faixa || {};
      const acima = faixas['25a30'];
      if (acima) frase += ` Entre 25% e 30% de desconto, ${pct(acima.pct_recusadas)} das propostas foram recusadas.`;
      return { recorte, n: e.n, frase, dados: d };
    }
    return null;
  }

  const api = { tipoDeObra, faixaDeValor, regiaoDe, recortesCandidatos, fraseDoEstudo, MINIMO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { estudo: api });
})();
