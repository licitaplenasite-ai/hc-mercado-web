/* global module */
(function (raiz) {
  "use strict";
  function renderizar(host, contexto) {
    const doc = host.ownerDocument || globalThis.document;
    const criar = (tag, texto) => { const e = doc.createElement(tag); if (texto) e.textContent = texto; return e; };
    const estado = {}; host._identificacaoEmpresa = estado;
    const ativo = () => host._identificacaoEmpresa === estado && contexto.ativo?.() !== false;
    let cadastro, ocupado = false, alterado = false, reconfirmar = false;
    const provas = new Map();
    const secao = criar('details'); secao.open = contexto.aberto === true;
    secao.append(criar('summary', contexto.titulo || 'Dados da empresa'));
    const aviso = criar('p'); aviso.setAttribute('role', 'status');
    secao.append(criar('p', 'Confira os poderes do representante no contrato social. A confirmação registra sua conferência; não certifica os documentos. Estes dados e arquivos não são enviados à IA.'), aviso);
    const campos = {};
    for (const [nome, titulo, limite] of [['razao','Razão social',180],['cnpj','CNPJ',18],['endereco','Endereço',500],['representante','Representante legal',180],['cargo','Cargo',120]]) {
      const label = criar('label', titulo), input = criar('input'); input.id = `empresa-identificacao-${nome}`; input.maxLength = limite;
      input.readOnly = nome === 'razao' || nome === 'cnpj'; label.htmlFor = input.id; secao.append(label,input); campos[nome] = input;
      input.oninput = () => { provas.delete(nome); alterado = true; revisao.checked = false; atualizar(); };
    }
    const documentos = criar('select'); documentos.id = 'empresa-identificacao-documento';
    const labelDocumento = criar('label','Documento da empresa'); labelDocumento.htmlFor = documentos.id;
    const tipo = criar('select'); tipo.setAttribute('aria-label','Tipo de documento');
    for (const [value, titulo] of [['contrato_social','Contrato social'],['cartao_cnpj','Cartão CNPJ']]) { const o = criar('option',titulo); o.value = value; tipo.append(o); }
    tipo.value = 'contrato_social';
    const arquivo = criar('input'); arquivo.type = 'file'; arquivo.accept = '.pdf,application/pdf'; arquivo.setAttribute('aria-label','Selecionar PDF da empresa');
    const botao = titulo => { const b = criar('button',titulo); b.type = 'button'; b.className = 'defesa-botao'; return b; };
    const recarregar = botao('Carregar identificação salva'), anexar = botao('Anexar PDF'), extrair = botao('Extrair sugestões do PDF selecionado');
    const sugestoes = criar('div');
    const revisao = criar('input'); revisao.type = 'checkbox'; revisao.id = 'empresa-identificacao-revisao';
    const labelRevisao = criar('label','Conferi os dados e os poderes do representante.'); labelRevisao.htmlFor = revisao.id;
    const salvar = botao('Salvar identificação confirmada'), aplicar = botao('Aplicar identificação confirmada à minuta');
    // salvarPorFora (operacao.html): um único botão no fim do quadro salva identificação e perfil juntos (salvarPendente).
    secao.append(recarregar,labelDocumento,documentos,tipo,arquivo,anexar,extrair,sugestoes,revisao,labelRevisao);
    if (!contexto.salvarPorFora) secao.append(salvar);
    if (!contexto.semMinuta) secao.append(aplicar);
    host.append(secao);
    function atualizar() {
      for (const b of [recarregar,anexar,extrair]) b.disabled = ocupado;
      salvar.disabled = ocupado || !cadastro?.empresa?.razao_social || !/^\d{14}$/.test(String(cadastro?.empresa?.cnpj || '').replace(/\D/g,'')) || !revisao.checked || ['endereco','representante','cargo'].some(k => !campos[k].value.trim());
      aplicar.disabled = ocupado || alterado || cadastro?.perfil?.status !== 'confirmado' || !cadastro?.perfil?.dados;
    }
    async function executar(tarefa) {
      if (!ativo() || ocupado) return;
      ocupado = true; atualizar(); aviso.textContent = 'Aguarde…';
      try { await tarefa(); } catch (e) { if (ativo()) aviso.textContent = e.message || 'Não foi possível concluir. Tente novamente.'; }
      finally { if (ativo()) { ocupado = false; atualizar(); } }
    }
    async function consultar() {
      const r = await contexto.solicitar({acao:'consultar'});
      if (!ativo()) return null;
      if (r?.empresa?.id !== contexto.empresaId) throw new Error('A empresa ativa mudou. Abra novamente a Central.');
      contexto.atualizado?.(r); return r;
    }
    function preencher(r) {
      cadastro = r; campos.razao.value = r.empresa.razao_social || ''; campos.cnpj.value = r.empresa.cnpj || '';
      // Invalidada (ex.: CNPJ corrigido): traz os dados anteriores para conferir; só vale depois de marcar a conferência e salvar.
      const anteriores = r.perfil?.status === 'invalidado' ? r.perfil.dadosAnteriores : null; reconfirmar = !!anteriores;
      for (const k of ['endereco','representante','cargo']) campos[k].value = (r.perfil?.status === 'confirmado' ? r.perfil.dados?.[k] : anteriores?.[k]) || '';
      const selecionado = documentos.value;
      documentos.replaceChildren();
      for (const d of r.documentos || []) { const o = criar('option',d.arquivo_nome || d.titulo || 'PDF'); o.value = d.id; documentos.append(o); }
      documentos.value = r.documentos?.some(d => d.id === selecionado) ? selecionado : r.documentos?.[0]?.id || ''; provas.clear(); alterado = false; revisao.checked = false;
      aviso.textContent = !campos.razao.value || !campos.cnpj.value ? 'Complete a razão social e o CNPJ em Minhas empresas e documentos, aba Dados da empresa, botão Corrigir razão social ou CNPJ.' : r.perfil?.status === 'invalidado' ? (reconfirmar ? 'Atenção: a identificação foi invalidada (o cadastro ou um documento mudou). Trouxemos os dados anteriores: confira e confirme de novo marcando a conferência e salvando.' : 'A identificação foi invalidada. Confira os documentos e confirme novamente.') : contexto.semMinuta ? 'Dados carregados. Confira a identificação antes de usá-la nos documentos.' : 'Dados carregados. A aplicação à minuta depende de sua ação.';
      aviso.setAttribute('data-situacao', reconfirmar ? 'atencao' : 'normal');
      atualizar();
    }
    const carregar = () => executar(async () => { const r = await consultar(); if (r) preencher(r); });
    recarregar.onclick = carregar; secao.ontoggle = () => { if (secao.open && !cadastro) carregar(); };
    revisao.onchange = atualizar;
    async function confirmar() {
      if (!cadastro) throw new Error('A identificação ainda não carregou. Use Carregar identificação salva.');
      if (['endereco','representante','cargo'].some(k => !campos[k].value.trim())) throw new Error('Preencha endereço, representante legal e cargo (os três) para salvar a identificação.');
      if (!revisao.checked) throw new Error('Marque “Conferi os dados e os poderes do representante” para salvar endereço, representante e cargo.');
      const dados = Object.fromEntries(['endereco','representante','cargo'].map(k => [k,campos[k].value.trim()]));
      const agrupadas = new Map();
      for (const prova of provas.values()) {
        const chave = JSON.stringify([prova.documentoId,prova.hash,prova.pagina,prova.trecho]);
        if (agrupadas.has(chave)) agrupadas.get(chave).campos.push(...prova.campos);
        else agrupadas.set(chave,{...prova,campos:[...prova.campos]});
      }
      const proveniencia = [...agrupadas.values()];
      if (proveniencia.length > 3 || new Set(proveniencia.map(p => p.documentoId)).size > 2) throw new Error('Use até dois documentos para comprovar os três campos.');
      const r = await contexto.solicitar({acao:'confirmar',revisado:true,razaoSocial:cadastro.empresa.razao_social,cnpj:cadastro.empresa.cnpj,dados,proveniencia});
      if (!ativo()) return; if (r?.empresa?.id !== contexto.empresaId) throw new Error('A empresa ativa mudou.');
      cadastro = {...cadastro,...r}; alterado = false; reconfirmar = false; revisao.checked = false; aviso.setAttribute('data-situacao', 'normal'); contexto.atualizado?.(cadastro); aviso.textContent = contexto.semMinuta ? 'Identificação confirmada. Nenhum documento foi aprovado; prepare uma nova prévia no processo.' : 'Identificação confirmada. A minuta permanece como você a editou.';
    }
    salvar.onclick = () => executar(confirmar);
    // Chamado pelo botão único: sem alteração não faz nada; com alteração, salva ou devolve o motivo (o que digitou fica na tela).
    async function salvarPendente() {
      if ((!alterado && !pendenteReconfirmar()) || !ativo()) return { ok: true, salvou: false };
      if (ocupado) return { ok: false, erro: 'Aguarde a identificação terminar de carregar e salve de novo.' };
      ocupado = true; atualizar();
      try { await confirmar(); return { ok: true, salvou: true }; }
      catch (e) { const erro = e.message || 'Não foi possível salvar a identificação.'; if (ativo()) { aviso.textContent = erro; if (!revisao.checked) revisao.focus?.(); } return { ok: false, erro }; }
      finally { if (ativo()) { ocupado = false; atualizar(); } }
    }
    aplicar.onclick = () => executar(async () => { const r = await consultar(); if (!r) return; preencher(r); if (r.perfil?.status !== 'confirmado' || !r.perfil.dados) throw new Error('Confirme a identificação antes de aplicar.'); contexto.aplicar?.(r); aviso.textContent = 'Identificação aplicada. Revise novamente a minuta.'; });
    // Contrato social longo ou escaneado: o servidor só lê até 8 páginas; o resto o navegador lê (pdf.js), sem IA.
    // Sugestão lida no navegador não leva prova da fonte: vale a conferência marcada pelo usuário.
    async function lerNoNavegador(documentoId) {
      const leitor = raiz.EmpresaDocumentoLeitura, manual = aviso => ({modo:'manual',sugestoes:{},evidencias:[],avisos:[aviso]});
      const b = await contexto.solicitar({acao:'baixar',documentoId}); if (!ativo()) return null;
      if (b?.documentoId !== documentoId || typeof b.conteudoBase64 !== 'string') throw new Error('Não foi possível abrir o PDF. Tente de novo.');
      const bin = raiz.atob(b.conteudoBase64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (String.fromCharCode(...bytes.slice(0,5)) !== '%PDF-') return manual('Este arquivo não é um PDF com texto. Preencha os dados manualmente.');
      const paginas = await leitor.lerPdf(bytes); if (!ativo()) return null;
      if (leitor.semTexto(paginas)) return manual('Este PDF é uma imagem escaneada, sem texto para ler. Preencha endereço, representante e cargo olhando o documento.');
      const r = leitor.extrairDadosEmpresa(paginas, cadastro.empresa);
      const achou = ['endereco','representante','cargo'].some(k => r.sugestoes[k]);
      return {modo: achou ? 'sugestoes' : 'manual', sugestoes: r.sugestoes, evidencias: r.evidencias.map(e => ({...e, local: true})),
        avisos: [achou ? `Lemos as ${paginas.length} páginas no seu computador. São sugestões de leitura, sem validação jurídica: confira cada campo.` : `Lemos as ${paginas.length} páginas, mas não achamos a sede nem a administração. Preencha olhando o documento.`, ...r.avisos]};
    }
    extrair.onclick = () => executar(async () => {
      if (!documentos.value) throw new Error('Selecione um documento.');
      const documentoId = documentos.value;
      let r = await contexto.solicitar({acao:'extrair',documentoId}); if (!ativo()) return;
      if (r.documentoId !== documentoId) throw new Error('A extração não corresponde ao documento selecionado.');
      if (raiz.EmpresaDocumentoLeitura?.lerPdf && ['endereco','representante','cargo'].some(k => !r.sugestoes?.[k])) {
        aviso.textContent = 'Lendo o PDF no seu computador…';
        const local = await lerNoNavegador(documentoId); if (!ativo() || !local) return;
        const doServidor = r.sugestoes || {};
        r = {...r, modo: r.modo === 'sugestoes' || local.modo === 'sugestoes' ? 'sugestoes' : 'manual', sugestoes: {...local.sugestoes, ...doServidor},
          evidencias: [...(r.evidencias || []), ...local.evidencias.filter(e => !doServidor[e.campo])], avisos: r.modo === 'manual' ? local.avisos : [...(r.avisos || []), ...local.avisos]};
      }
      sugestoes.replaceChildren();
      for (const t of r.avisos || []) sugestoes.append(criar('p',t));
      if ((r.sugestoes?.razaoSocial && r.sugestoes.razaoSocial.trim() !== cadastro.empresa.razao_social?.trim()) || (r.sugestoes?.cnpj && r.sugestoes.cnpj.replace(/\D/g,'') !== cadastro.empresa.cnpj.replace(/\D/g,''))) throw new Error('O documento diverge do cadastro. Se o cadastro estiver errado, use Corrigir razão social ou CNPJ em Dados da empresa; os campos manuais continuam disponíveis.');
      for (const k of ['endereco','representante','cargo']) {
        const valor = r.sugestoes?.[k]; if (!valor) continue;
        const evidencia = r.evidencias?.find(e => e.campo === k && (e.valor === undefined || e.valor === valor));
        const usar = botao(`Usar ${{endereco:"endereço",representante:"representante",cargo:"cargo"}[k]}: ${valor}`);
        usar.onclick = () => { if (!ativo() || ocupado) return; campos[k].value = valor; provas.delete(k); if (evidencia && !evidencia.local && /^[a-f0-9]{64}$/.test(r.hash || '')) provas.set(k,{documentoId:r.documentoId,hash:r.hash,campos:[k],pagina:evidencia.pagina,trecho:evidencia.trecho}); alterado = true; revisao.checked = false; atualizar(); };
        sugestoes.append(usar); if (evidencia) sugestoes.append(criar('p',`Página ${evidencia.pagina}: ${evidencia.trecho}`));
      }
      aviso.textContent = r.modo === 'manual' ? 'O anexo foi preservado. Preencha os dados manualmente.' : 'Confira cada sugestão antes de usar.';
    });
    anexar.onclick = () => executar(async () => {
      const f = arquivo.files?.[0]; if (!f || f.size > 4*1024*1024 || !/\.pdf$/i.test(f.name)) throw new Error('Selecione um PDF de até 4 MiB.');
      const bytes = new Uint8Array(await f.arrayBuffer()); if (!ativo()) return;
      if (String.fromCharCode(...bytes.slice(0,5)) !== '%PDF-') throw new Error('O arquivo não é um PDF válido.');
      let binario = ''; for (let i=0;i<bytes.length;i+=32768) binario += String.fromCharCode(...bytes.subarray(i,i+32768));
      const anexo = await contexto.solicitar({acao:'anexar',tipo:tipo.value,nome:f.name,conteudoBase64:raiz.btoa(binario)}); if (!ativo()) return;
      const r = await consultar(); if (r) { cadastro = {...cadastro,documentos:r.documentos}; documentos.replaceChildren(); for (const d of r.documentos || []) { const o=criar('option',d.arquivo_nome || d.titulo); o.value=d.id; documentos.append(o); } documentos.value = r.documentos?.some(d => d.id === anexo?.documento?.id) ? anexo.documento.id : ''; sugestoes.replaceChildren(); aviso.textContent='PDF anexado. Confira as sugestões ou preencha manualmente.'; }
    });
    // Dados anteriores pré-preenchidos contam como pendentes só depois que a pessoa marca a conferência.
    function pendenteReconfirmar() { return reconfirmar && revisao.checked; }
    atualizar(); return {carregar,consultar,salvarPendente,temAlteracoesNaoSalvas: () => alterado || pendenteReconfirmar()};
  }
  const api = {renderizar}; if (typeof module !== 'undefined' && module.exports) module.exports = api; raiz.EmpresaIdentificacaoUI = api;
})(globalThis);
