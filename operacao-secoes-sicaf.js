/* global module */
// Quadro "Regularidade" (operacao.html): diz em qual seção do SICAF cai um documento pelo nome do tipo.
// Clientes já cadastraram nomes livres ("FGTS (CRF)", "CND Federal", "Certidão Trabalhista (CNDT)"...): sem este
// mapa o quadro mostraria "Não enviada" para eles. Só lê o nome; nada gravado é alterado.
(function (global) {
  'use strict';
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Ordem importa: o específico antes do genérico ("CND Estadual" é estadual, não federal; "SICAF" fica por último).
  const APELIDOS = [
    ['FGTS', /\b(fgts|crf)\b|regularidade do empregador/],
    ['CNDT', /\bcndt\b|trabalhist/],
    ['Certidão de falência', /falencia|recuperacao judicial|concordata/],
    ['Balanço patrimonial', /balanco|demonstracoes contabeis/],
    ['Certidão Estadual', /estadua|\bsefaz\b|\bicms\b/],
    ['Certidão Municipal', /municipa|prefeitura|\biss\b|mobiliario/],
    ['Certidão Federal', /federa|receita|\bpgfn\b|\buniao\b|^cnd( conjunta)?$/],
    ['SICAF', /\bsicaf\b/],
  ];
  function secaoDoTipo(tipo) {
    const n = normalizar(tipo);
    if (!n) return null;
    const achado = APELIDOS.find(([, re]) => re.test(n));
    return achado ? achado[0] : null;
  }
  const api = { secaoDoTipo };
  global.OperacaoSecoesSicaf = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
