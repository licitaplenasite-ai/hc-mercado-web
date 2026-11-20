/* global window, localStorage, location, URLSearchParams, module -- script de navegador (e funções puras testadas no Node) */
// Programa "Indique e ganhe" (supabase/indicacoes.sql). Este arquivo:
// - guarda o código do link licitaplena.com.br/?ind=CODIGO no navegador (index.html e cadastro.html o carregam);
//   o primeiro clique vale; um código guardado há mais de DIAS_LINK dias pode ser trocado por outro;
// - dá ao cadastro o código e a data do clique (o banco confere de novo com indicacao_regras.dias_validade_link);
// - tem as contas e textos da tela indique.html (indique-ui.js).
(function () {
  'use strict';
  const CHAVE = 'licitaplena_indicacao';
  // shortcut: prazo fixo no navegador; o valor que vale é o do admin (o banco recusa clique vencido). Igualar se o dono mudar.
  const DIAS_LINK = 60;
  const SITE = 'https://licitaplena.com.br';
  const DIA = 86400000;

  const normalizar = (c) => String(c || '').trim().toUpperCase();
  const codigoValido = (c) => /^[A-Z0-9]{6,12}$/.test(normalizar(c));

  // guardada: {codigo, em} já salvo (ou null); codigoUrl: o ?ind= desta visita. Devolve o que deve ficar guardado.
  function escolherIndicacao(guardada, codigoUrl, agora) {
    const valida = guardada && codigoValido(guardada.codigo) && Number.isFinite(Date.parse(guardada.em))
      && agora - Date.parse(guardada.em) <= DIAS_LINK * DIA ? guardada : null;
    if (valida || !codigoValido(codigoUrl)) return valida;
    return { codigo: normalizar(codigoUrl), em: new Date(agora).toISOString() };
  }

  const linkIndicacao = (codigo) => `${SITE}/?ind=${encodeURIComponent(normalizar(codigo))}`;
  function textoConvite(link, descontoPct, descontoMeses) {
    const desconto = Number(descontoPct) > 0 && Number(descontoMeses) > 0
      ? ` e ganhe ${String(Number(descontoPct)).replace('.', ',')}% de desconto ${Number(descontoMeses) === 1 ? 'na 1ª mensalidade' : `nas ${Number(descontoMeses)} primeiras mensalidades`}`
      : '';
    return `Eu uso o LicitaPlena para achar e organizar licitações. Faça seu cadastro pelo meu link${desconto}: ${link}`;
  }
  const linkWhatsApp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;
  const reais = (centavos) => (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // Somas da tela: aguardando garantia, liberado (e se já dá para pedir o saque) e pago. Cancelada não conta.
  function resumirComissoes(lista, saqueMinimoCentavos) {
    const t = { pendente: 0, liberada: 0, paga: 0, liberadaSemPedido: 0 };
    for (const c of lista || []) {
      const v = Number(c.valor_centavos) || 0;
      if (c.situacao === 'pendente') t.pendente += v;
      else if (c.situacao === 'liberada') { t.liberada += v; if (!c.saque_pedido_em) t.liberadaSemPedido += v; }
      else if (c.situacao === 'paga') t.paga += v;
    }
    t.podePedirSaque = t.liberadaSemPedido > 0 && t.liberadaSemPedido >= (Number(saqueMinimoCentavos) || 0);
    return t;
  }

  function lerGuardada() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; }
  }
  // O que o cadastro manda no metadado do signUp (vazio quando não há indicação válida).
  function dadosParaCadastro(agora) {
    const g = escolherIndicacao(lerGuardada(), null, agora);
    return g ? { indicacao_codigo: g.codigo, indicacao_em: g.em } : {};
  }
  function esquecer() { try { localStorage.removeItem(CHAVE); } catch { /* sem armazenamento */ } }

  const api = { escolherIndicacao, codigoValido, linkIndicacao, textoConvite, linkWhatsApp, reais, resumirComissoes, dadosParaCadastro, lerGuardada, esquecer, DIAS_LINK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;
  window.LicitaPlenaIndicacao = api;
  try {
    const codigoUrl = new URLSearchParams(location.search).get('ind');
    const atual = lerGuardada();
    const escolhida = escolherIndicacao(atual, codigoUrl, Date.now());
    if (escolhida && escolhida !== atual) localStorage.setItem(CHAVE, JSON.stringify(escolhida));
  } catch { /* sem armazenamento: o cadastro segue sem indicação */ }
})();
