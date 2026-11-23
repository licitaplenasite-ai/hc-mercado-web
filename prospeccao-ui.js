/* global document, window, location, localStorage, fetch, URLSearchParams, module -- script de navegador (e funções puras testadas no Node) */
// Tela Prospecção (prospeccao.html): o que o órgão vai comprar antes do edital. Lê /api/prospeccao, uma aba por
// vez (cada aba = uma subrequisição), e pré-preenche UF e palavras com o filtro salvo do boletim
// (clientes.boletim_filtro, o mesmo que painel.html grava).
(function () {
  'use strict';
  const ABAS = {
    pca: { titulo: 'Planos de contratação', data: 'Data prevista' },
    irp: { titulo: 'IRP abertas', data: 'Prazo para participar' },
    ata: { titulo: 'Atas para adesão', data: 'Vigente até' },
    contrato: { titulo: 'Contratos vencendo', data: 'Vence em' },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moeda = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const qtd = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  const dataBr = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
  // Instante (ISO em UTC) visto como dia de Brasília: coleta às 22h de 22/11 não pode aparecer como 23/11.
  const diaBr = (iso) => (Number.isFinite(Date.parse(iso)) ? dataBr(new Date(Date.parse(iso) - 3 * 36e5).toISOString()) : '—');
  // Dias corridos de hoje (Brasília) até a data; negativo = já passou.
  function diasAte(d, agora = Date.now()) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(d || ''))) return null;
    const hoje = new Date(agora - 3 * 36e5).toISOString().slice(0, 10);
    return Math.round((Date.parse(String(d).slice(0, 10)) - Date.parse(hoje)) / 864e5);
  }
  // Só link oficial (o robô e o banco já restringem; aqui é a última barreira antes do href).
  const linkOficial = (u) => (/^https:\/\/(pncp\.gov\.br|dadosabertos\.compras\.gov\.br|contratos\.comprasnet\.gov\.br)\//.test(String(u || '')) ? String(u) : null);

  function celulaData(l, agora) {
    const n = diasAte(l.data_ref, agora);
    const urg = n !== null && n <= 30 ? ' urgente' : '';
    return `<td data-rotulo="${esc(ABAS[l.tipo].data)}"><b>${esc(dataBr(l.data_ref))}</b>${n === null ? '' : `<small class="dias${urg}">${n === 0 ? 'hoje' : `em ${n} dia${n === 1 ? '' : 's'}`}</small>`}</td>`;
  }
  function celulaItem(l) {
    const principal = l.descricao || l.objeto || '—';
    const extra = l.descricao && l.objeto && l.objeto !== l.descricao ? `<small>${esc(l.objeto)}</small>` : '';
    return `<td data-rotulo="Item / objeto" class="item">${esc(principal)}${extra}${l.catmat ? `<small>Catálogo ${esc(l.catmat)}</small>` : ''}</td>`;
  }
  // Adesão de um item de ata do Compras.gov: limite (máximo de adesão), já aderido (5_consultarAdesoesItem) e o que sobra.
  function textoAdesao(l) {
    if (!l.maximo_adesao) return '';
    const limite = `limite de adesão ${qtd(l.maximo_adesao)}`;
    if (l.adesoes_usadas === null || l.adesoes_usadas === undefined || !l.adesoes_em) return `<small class="adesao">${limite} · adesões ainda não consultadas</small>`;
    const livre = Math.max(0, Number(l.maximo_adesao) - Number(l.adesoes_usadas));
    return `<small class="adesao${livre === 0 ? ' esgotada' : ''}">${limite} · já aderido ${qtd(l.adesoes_usadas)} · <b>disponível ${qtd(livre)}</b></small>`;
  }
  function detalheAta(l) {
    if (l.fonte === 'comprasgov_arp') {
      const saldo = l.saldo === null || l.saldo === undefined ? 'saldo não informado' : `saldo ${qtd(l.saldo)} de ${qtd(l.quantidade)}`;
      return `<small>${esc(saldo)}</small>${textoAdesao(l)}`;
    }
    // Item de ata fora do Compras.gov: o PNCP traz fornecedor, quantidade e valor homologados, mas não saldo nem adesões.
    if (l.fornecedor_nome || l.valor_unitario) return `<small>${l.quantidade ? `${esc(qtd(l.quantidade))} homologado${Number(l.quantidade) === 1 ? '' : 's'} · ` : ''}saldo e adesões não divulgados no PNCP</small>`;
    return '<small>itens na ata do PNCP</small>';
  }
  function celulaValores(l) {
    if (l.tipo === 'ata') return `<td data-rotulo="Preço / saldo / adesão">${l.valor_unitario ? `${moeda(l.valor_unitario)} un.` : moeda(l.valor_total)}${detalheAta(l)}</td>`;
    if (l.tipo === 'contrato') return `<td data-rotulo="Valor global">${moeda(l.valor_total)}</td>`;
    return `<td data-rotulo="Quantidade / valor">${qtd(l.quantidade)} × ${moeda(l.valor_unitario)}<small>total ${moeda(l.valor_total)}</small></td>`;
  }
  function linhaHtml(l, agora = Date.now()) {
    const link = linkOficial(l.link);
    const fornecedor = l.tipo === 'ata' || l.tipo === 'contrato'
      ? `<td data-rotulo="Fornecedor">${esc(l.fornecedor_nome || '—')}${l.fornecedor_cnpj ? `<small>${esc(l.fornecedor_cnpj)}</small>` : ''}</td>` : '';
    const fonte = { pgc: 'PGC (Compras.gov)', comprasgov_arp: 'Compras.gov ARP' }[l.fonte] || (l.plataforma ? `PNCP · ${l.plataforma}` : 'PNCP');
    return `<tr>${celulaData(l, agora)}<td data-rotulo="Órgão">${esc(l.orgao_nome || '—')}<small>${esc([l.unidade_nome, l.municipio, l.uf].filter(Boolean).join(' · '))}</small></td>`
      + `${celulaItem(l)}${fornecedor}${celulaValores(l)}`
      + `<td data-rotulo="Fonte">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver no ${l.fonte === 'pncp' || /pncp\.gov\.br/.test(link) ? 'PNCP' : 'portal'}</a>` : '—'}<small>${esc(fonte)}</small></td></tr>`;
  }
  function cabecalhoHtml(tipo) {
    const fornecedor = tipo === 'ata' || tipo === 'contrato' ? '<th>Fornecedor</th>' : '';
    const valores = { ata: 'Preço / saldo / adesão', contrato: 'Valor global' }[tipo] || 'Quantidade / valor';
    return `<tr><th>${esc(ABAS[tipo].data)}</th><th>Órgão</th><th>Item / objeto</th>${fornecedor}<th>${valores}</th><th>Fonte oficial</th></tr>`;
  }

  // Corpo da tabela: o que casa no nome do item vem primeiro; o que só cita o termo na especificação fica recolhido
  // atrás de um botão (linhas hidden), para "papel a4" não abrir a lista com impressoras.
  function corpoHtml(linhas, agora = Date.now()) {
    const nome = linhas.filter((l) => !l.so_especificacao);
    const espec = linhas.filter((l) => l.so_especificacao);
    const texto = `Mostrar ${espec.length} resultado${espec.length === 1 ? '' : 's'} que só cit${espec.length === 1 ? 'a' : 'am'} o termo na especificação`;
    const botao = espec.length
      ? `<tr class="espec-cab"><td colspan="6"><button type="button" class="btn" id="btn-espec" aria-expanded="false" data-texto="${esc(texto)}">${esc(texto)}</button></td></tr>` : '';
    return nome.map((l) => linhaHtml(l, agora)).join('') + botao + espec.map((l) => linhaHtml(l, agora).replace('<tr>', '<tr class="so-espec" hidden>')).join('');
  }

  // Cobertura da coleta (resposta da API: { UF: { concluidaEm, emAndamento } }; IRP é nacional, chave BR).
  const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
  const NOME_TIPO = { pca: 'o plano de compras (PCA)', irp: 'as intenções de registro de preço (IRP)', ata: 'as atas para adesão', contrato: 'os contratos vencendo' };
  const coletadas = (cob) => UFS.filter((uf) => cob && cob[uf] && cob[uf].concluidaEm);

  // Uma linha sobre a coleta, sempre visível: com UF, a data dela; com "Todas", quantas UFs já entraram.
  function textoCobertura(tipo, uf, cob) {
    if (!cob) return '';
    if (tipo === 'irp') return cob.BR && cob.BR.concluidaEm ? `IRP do Brasil todo coletada em ${diaBr(cob.BR.concluidaEm)}.` : 'IRP: primeira coleta em andamento.';
    if (uf) {
      const c = cob[uf];
      if (c && c.concluidaEm) return `Última coleta completa de ${uf}: ${diaBr(c.concluidaEm)}${c.emAndamento ? ' (atualização em andamento)' : ''}.`;
      return `${uf} ainda não tem coleta completa${c && c.emAndamento ? ' (em andamento)' : ''}.`;
    }
    const ok = coletadas(cob);
    if (!ok.length) return 'Primeira coleta em andamento: ainda nenhuma UF completa.';
    const maisAntiga = ok.map((u) => cob[u].concluidaEm).sort()[0];
    return ok.length === UFS.length ? `Todas as 27 UFs coletadas; a mais antiga em ${diaBr(maisAntiga)}.` : `${ok.length} de 27 UFs já coletadas (a mais antiga em ${diaBr(maisAntiga)}); as outras estão em andamento.`;
  }

  // Lista "UF: data" da aba, recolhida num <details> abaixo do contador.
  function coberturaHtml(tipo, cob) {
    if (!cob || tipo === 'irp') return '';
    const itens = UFS.map((uf) => {
      const c = cob[uf];
      const quando = c && c.concluidaEm ? diaBr(c.concluidaEm) : (c && c.emAndamento ? 'em andamento' : 'aguardando');
      return `<li><b>${uf}</b> ${esc(quando)}</li>`;
    }).join('');
    return `<summary>Data da última coleta por UF</summary><ul class="cobertura-lista">${itens}</ul>`;
  }

  // Tela vazia nunca parece quebrada: diz por quê e o que fazer, em português simples.
  function mensagemVazio(tipo, f, cob) {
    const nome = NOME_TIPO[tipo];
    const temTexto = Boolean((f.palavras || '').trim() || (f.catmat || '').trim());
    const sugestao = temTexto
      ? ' Tente outra palavra (uma só, como "limpeza" em vez de "material de limpeza"), confira a grafia ou apague o CATMAT.'
      : '';
    const outros = tipo === 'ata' ? '' : ' Também dá para aumentar o período.';
    if (tipo === 'irp') return `Nenhuma IRP aberta agora com esse filtro. O módulo de IRP do PNCP é novo (31/08/2026) e ainda tem poucas IRPs no Brasil todo.${sugestao}`;
    if (cob && f.uf && !(cob[f.uf] && cob[f.uf].concluidaEm)) {
      return `Ainda não temos ${nome} de ${f.uf}: a coleta está em andamento e fica pronta em até 3 dias. Enquanto isso, veja outra UF ou escolha "Todas".`;
    }
    if (cob && !f.uf) {
      const n = coletadas(cob).length;
      if (n === 0) return `Ainda não temos ${nome} de nenhuma UF: a primeira coleta está em andamento e fica pronta em até 3 dias.`;
      if (n < UFS.length) return `Nada encontrado nas ${n} UFs já coletadas; as outras ${UFS.length - n} ainda estão em andamento.${sugestao}${outros}`;
    }
    return `Nada encontrado ${f.uf ? `em ${f.uf}` : 'no Brasil'} com esse filtro.${sugestao || ' Tente uma palavra do seu ramo (ex.: limpeza, expediente, construção).'}${outros}`;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { diasAte, linhaHtml, cabecalhoHtml, corpoHtml, linkOficial, esc, textoCobertura, coberturaHtml, mensagemVazio };
  if (typeof document === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // eslint-disable-line no-undef -- globais de supabase-config.js
  let abaAtual = 'pca';
  let carga = 0; // só a última consulta pinta a tela: resposta atrasada (carga inicial x busca do usuário) não sobrescreve
  const cache = new Map();

  function aviso(texto, tipo) { const a = $('aviso'); a.textContent = texto || ''; a.className = texto ? `aviso ${tipo || 'info'}` : 'aviso'; }
  function filtros() {
    return { uf: $('f-uf').value, palavras: $('f-palavras').value.trim(), catmat: $('f-catmat').value.trim(), dias: $('f-dias').value };
  }

  async function autenticar() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('login.html?voltar=/prospeccao'); return null; }
    const { data: cliente } = await sb.from('clientes').select('status,boletim_filtro,estados_interesse').eq('id', session.user.id).maybeSingle();
    if (!cliente || cliente.status !== 'aprovado') { await sb.auth.signOut(); location.replace('login.html?voltar=/prospeccao'); return null; }
    return cliente;
  }

  async function carregar(tipo) {
    abaAtual = tipo;
    const minha = ++carga;
    document.querySelectorAll('.aba').forEach((b) => { const ativa = b.dataset.aba === tipo; b.classList.toggle('ativa', ativa); b.setAttribute('aria-selected', ativa ? 'true' : 'false'); });
    $('tabela-cabecalho').innerHTML = cabecalhoHtml(tipo);
    $('tabela-corpo').innerHTML = '<tr><td colspan="6" class="vazio">Carregando…</td></tr>';
    const f = filtros();
    const q = new URLSearchParams({ tipo, dias: f.dias });
    if (f.uf) q.set('uf', f.uf);
    if (f.palavras) q.set('palavras', f.palavras);
    if (f.catmat) q.set('catmat', f.catmat);
    const chave = q.toString();
    try {
      let dados = cache.get(chave);
      if (!dados) {
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
        const r = await fetch(`/api/prospeccao?${chave}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        dados = await r.json();
        if (!r.ok) throw new Error(dados.erro || 'Consulta indisponível.');
        cache.set(chave, dados);
      }
      if (minha !== carga) return;
      const linhas = dados.linhas || [];
      $('tabela-corpo').innerHTML = linhas.length ? corpoHtml(linhas) : `<tr><td colspan="6" class="vazio">${esc(mensagemVazio(tipo, f, dados.cobertura))}</td></tr>`;
      const soEspec = linhas.filter((l) => l.so_especificacao).length;
      $('contador').textContent = linhas.length
        ? `${linhas.length}${dados.truncado ? '+ (mostrando os primeiros ' + dados.limite + '; refine o filtro)' : ''} resultado${linhas.length === 1 ? '' : 's'}${soEspec ? ` (${soEspec} só na especificação, recolhido${soEspec === 1 ? '' : 's'})` : ''} · coletado em ${diaBr(dados.coletadoEm)}`
        : '';
      $('cobertura-texto').textContent = textoCobertura(tipo, f.uf, dados.cobertura);
      $('cobertura').innerHTML = coberturaHtml(tipo, dados.cobertura);
      $('cobertura').hidden = !$('cobertura').innerHTML;
      aviso('');
    } catch (e) {
      if (minha !== carga) return;
      $('tabela-corpo').innerHTML = '<tr><td colspan="6" class="vazio">Não deu para consultar agora. Espere um instante e clique em Buscar de novo.</td></tr>';
      $('contador').textContent = '';
      $('cobertura-texto').textContent = '';
      $('cobertura').hidden = true;
      aviso(e.message || 'Não foi possível consultar.', 'erro');
    }
  }

  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => carregar(b.dataset.aba)));
  $('tabela-corpo').addEventListener('click', (ev) => {
    const b = ev.target.closest('#btn-espec');
    if (!b) return;
    const abrir = b.getAttribute('aria-expanded') !== 'true';
    document.querySelectorAll('#tabela-corpo tr.so-espec').forEach((tr) => { tr.hidden = !abrir; });
    b.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    b.textContent = abrir ? 'Recolher os que só citam o termo na especificação' : b.dataset.texto;
  });
  $('form-filtros').addEventListener('submit', (ev) => { ev.preventDefault(); carregar(abaAtual); });
  $('btn-tema').addEventListener('click', () => {
    const claro = document.documentElement.classList.toggle('tema-claro');
    document.documentElement.dataset.theme = claro ? 'light' : 'dark';
    try { localStorage.setItem('licitaplena_tema', claro ? 'claro' : 'escuro'); } catch { /* segue sem persistir */ }
  });

  autenticar().then(async (cliente) => {
    if (!cliente) return;
    // O filtro do Boletim agora fica por empresa (boletim_filtros_empresa); o da conta é o formato antigo.
    let filtro = cliente.boletim_filtro;
    if (!filtro || !filtro.palavrasRaw) {
      const { data } = await sb.from('boletim_filtros_empresa').select('filtro').limit(1);
      filtro = (data && data[0] && data[0].filtro) || filtro;
    }
    const estados = Array.isArray(cliente.estados_interesse) ? cliente.estados_interesse : [];
    if (estados.length === 1 && !(filtro && Array.isArray(filtro.ufs) && filtro.ufs[0])) $('f-uf').value = String(estados[0]).toUpperCase();
    if (filtro && Array.isArray(filtro.ufs) && filtro.ufs[0]) $('f-uf').value = filtro.ufs[0];
    if (filtro && filtro.palavrasRaw) {
      $('f-palavras').value = filtro.palavrasRaw.slice(0, 300);
      $('origem-filtro').textContent = 'Estado e palavras vieram do filtro do seu Boletim. Ajuste à vontade.';
    }
    carregar('pca');
  }).catch(() => aviso('Não foi possível validar a sessão. Recarregue a página.', 'erro'));
})();
