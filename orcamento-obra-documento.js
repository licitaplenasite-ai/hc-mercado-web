/* global module, TextEncoder -- script de navegador (orcamento-obra.html) e módulo do Node (testes) */
// Documento do orçamento (v2): o que é guardado no navegador e na nuvem (supabase/orcamento_obra_salvos.sql) para
// reabrir o orçamento igual, em qualquer computador. Só o necessário para voltar ao ponto: a aba lida (a única que o
// "Baixar no formato do edital" usa), a leitura, CPU, cronograma, preços digitados, cotações, os campos da tela e se
// já tinha sido montado (ao abrir, as contas são refeitas). Cada item da leitura ganha um id que não muda ao salvar
// de novo (a edição da planilha, na fase 3, vai renumerar itens: o id é que liga preço digitado e cotação ao item).
// Puro: sem tela, sem rede. v1 = o rascunho do navegador de antes (licitaplena_orcamento_obra_rascunho).
(function () {
  'use strict';
  const VERSAO = 2;
  // Mesmo limite do banco (check em orcamento_obra_salvos.sql): o Santo Antônio (346 itens + CPU de 216) dá ~0,4 MB.
  const LIMITE_BYTES = 6 * 1024 * 1024;

  // Itens sem id ganham o próximo número livre ("i1", "i2"…); os que já têm ficam como estão.
  function comIds(leitura) {
    if (!leitura || !Array.isArray(leitura.itens)) return leitura;
    let maior = 0;
    for (const i of leitura.itens) { const n = /^i(\d+)$/.exec(i?.id || ''); if (n) maior = Math.max(maior, Number(n[1])); }
    return { ...leitura, itens: leitura.itens.map((i) => (i && i.id ? i : { ...i, id: `i${++maior}` })) };
  }

  // Estado da tela + campos -> documento v2 (objeto). agora: para o teste não depender do relógio.
  function documentoDoEstado(estado, campos, agora = new Date()) {
    return { versao: VERSAO, salvoEm: agora.toISOString(), nomeArquivo: estado.nomeArquivo || '',
      abas: (estado.abas || []).filter((a) => a.nome === estado.leitura?.aba), leitura: comIds(estado.leitura),
      cpu: estado.cpu ?? null, crono: estado.crono ?? null, manuais: estado.manuais || {}, cotacoes: estado.cotacoes || {},
      montado: Boolean(estado.montado), campos: campos || {} };
  }

  // Texto (localStorage) ou objeto (jsonb da nuvem) -> documento v2, ou null se estragado / de versão desconhecida.
  // v1 tinha os mesmos campos: só ganha os ids e passa a v2.
  function lerDocumento(entrada) {
    let d = entrada;
    if (typeof entrada === 'string') { try { d = JSON.parse(entrada); } catch { return null; } }
    if (!d || typeof d !== 'object' || ![1, VERSAO].includes(d.versao)) return null;
    if (!d.leitura || typeof d.leitura !== 'object' || !Array.isArray(d.leitura.itens) || !Array.isArray(d.abas) || !d.campos || typeof d.campos !== 'object') return null;
    return { ...d, versao: VERSAO, leitura: comIds(d.leitura), manuais: d.manuais || {}, cotacoes: d.cotacoes || {}, montado: d.montado === true };
  }

  // Documento -> pedaço do estado da tela (as contas são refeitas por quem abre).
  function estadoDoDocumento(d) {
    return { abas: d.abas, leitura: d.leitura, cpu: d.cpu ?? null, crono: d.crono ?? null, manuais: d.manuais || {}, cotacoes: d.cotacoes || {},
      nomeArquivo: d.nomeArquivo || '', montado: d.montado === true, orc: null, similares: {} };
  }

  // Nome na lista "Meus orçamentos": o arquivo do edital ou o objeto lido, até 200 letras (check do banco).
  function tituloDoDocumento(d) {
    const t = String(d?.nomeArquivo || d?.leitura?.cabecalho?.objeto || 'Orçamento sem nome').replace(/\s+/g, ' ').trim();
    return (t || 'Orçamento sem nome').slice(0, 200);
  }

  // Tamanho em bytes do JSON (UTF-8), o mesmo que o banco mede.
  const bytes = (d) => new TextEncoder().encode(JSON.stringify(d)).length;

  const api = { VERSAO, LIMITE_BYTES, comIds, documentoDoEstado, lerDocumento, estadoDoDocumento, tituloDoDocumento, bytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.OrcObra = Object.assign(globalThis.OrcObra || {}, { documento: api });
})();
