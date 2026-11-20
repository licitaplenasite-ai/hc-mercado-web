/* global module, require */
// Busca v2 do painel (pedido do dono, 19/11: ferramentas do Siga Pregão). Regras puras, sem DOM nem rede:
// "limitar" (todas as palavras), modalidade, portal, exclusiva ME/EPP, excluir SRP, período por abertura,
// sugestão de palavras, "já tenho o número" (UASG + pregão), sinais de "ninguém participando" no histórico
// e a lista de órgãos compradores. painel.html e busca-extra-ui.js usam; busca-extra.test.js testa.
(function (raiz) {
  "use strict";
  const Portal = raiz.PortalOrigem || (typeof require === "function" ? require("./portal-origem.js") : null);
  const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ'’]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const lista = (v) => String(v || "").split(",").map((s) => norm(s)).filter(Boolean);

  const MODALIDADES = { pregao: "Pregão", dispensa: "Dispensa", concorrencia: "Concorrência", inexigibilidade: "Inexigibilidade", credenciamento: "Credenciamento", leilao: "Leilão" };
  // Nomes que o PortalOrigem devolve para os portais conhecidos (mesma ordem de portal-origem.js).
  const PORTAIS = ["Compras.gov.br", "Portal de Compras Públicas", "Licitanet", "BLL", "BNC", "BBMNET", "BR Conectado", "Licitações-e (BB)", "Licitar Digital", "Licita+Brasil", "LicitaCon (TCE-RS)"];

  // "Limitar": cada termo precisa aparecer (o campo de palavras-chave aceita qualquer um deles).
  const temTodos = (objeto, limitar) => { const t = norm(objeto); return lista(limitar).every((p) => t.includes(p)); };
  // shortcut: ME/EPP e SRP pelo texto do objeto e pelo campo srp do robô; o PNCP só marca ME/EPP item a item.
  const ME_EPP = /exclusiv\w*\b.{0,60}\b(me|epp|mei|microempresas?|pequeno porte)\b|\b(me|epp)\s*\/\s*(me|epp)\b.{0,30}exclusiv/;
  const exclusivaMeEpp = (r) => ME_EPP.test(norm(r && r.objeto));
  const ehSrp = (r) => (r && r.srp === true) || /registro de precos?\b|\bsrp\b|\bata de registro\b/.test(norm(r && r.objeto));
  const modalidadeDe = (r) => Object.keys(MODALIDADES).find((k) => norm(r && r.modalidadeNome).includes(k)) || "";
  // Modo de disputa do PNCP (modoDisputaNome): "Aberto", "Fechado", "Aberto-Fechado", "Fechado-Aberto", "Dispensa Com Disputa".
  const MODOS_DISPUTA = { aberto: "Aberto", "aberto-fechado": "Aberto e fechado", fechado: "Fechado", "dispensa-com-disputa": "Dispensa com disputa", "nao-se-aplica": "Não se aplica" };
  function modoDisputaDe(r) {
    const n = norm(r && r.modoDisputaNome).replace(/[\s/]+/g, "-");
    if (!n) return "";
    if (n.includes("dispensa")) return "dispensa-com-disputa";
    if (/^(aberto-fechado|fechado-aberto)$/.test(n)) return "aberto-fechado";
    return Object.hasOwn(MODOS_DISPUTA, n) ? n : "";
  }

  // f = { limitar, modalidade, portal, mePp, excluirSrp }. Sem filtro, devolve a mesma lista.
  function filtrarExtra(resultados, f = {}) {
    let saida = resultados || [];
    if (f.limitar) saida = saida.filter((r) => temTodos(r.objeto, f.limitar));
    if (f.modalidade) saida = saida.filter((r) => modalidadeDe(r) === f.modalidade);
    if (f.portal) saida = saida.filter((r) => Portal && Portal.portalDe(r).nome === f.portal);
    if (f.mePp) saida = saida.filter(exclusivaMeEpp);
    if (f.excluirSrp) saida = saida.filter((r) => !ehSrp(r));
    if (f.modoDisputa) saida = saida.filter((r) => modoDisputaDe(r) === f.modoDisputa);
    return saida;
  }

  // --- Filtros que dependem dos itens (PNCP /itens): produto ou serviço e valor unitário estimado do item ---
  const temFiltroDeItem = (f = {}) => Boolean(f.tipoItem || f.itemMin || f.itemMax);
  // "12345678000190-1-000123/2026" -> { cnpj, ano, sequencial } para /api/pncp-itens.
  function partesControle(numeroControle) {
    const m = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/.exec(String(numeroControle || "").trim());
    return m ? { cnpj: m[1], sequencial: Number(m[2]), ano: Number(m[3]) } : null;
  }
  // Basta um item conferir: material/serviço pelo materialOuServico do PNCP; valor pela faixa em reais (centavos BigInt).
  // Item com orçamento sigiloso (sem valor) não entra quando há faixa de valor.
  function itensConferem(itens, f = {}) {
    const min = f.itemMin ? centavos(f.itemMin) : null, max = f.itemMax ? centavos(f.itemMax) : null;
    return (itens || []).some((i) => {
      if (f.tipoItem && !norm(i.materialOuServico).startsWith(f.tipoItem === "servico" ? "servico" : "material")) return false;
      if (min === null && max === null) return true;
      const v = centavos(i.valorUnitarioEstimado);
      return v !== null && v > 0n && (min === null || v >= min) && (max === null || v <= max);
    });
  }
  // Data usada no filtro de período: publicação (padrão) ou abertura (fim do prazo de propostas).
  const dataDoPeriodo = (r, periodoPor) => (periodoPor === "abertura" ? r.encerramento : r.publicacao) || null;

  // --- Sugestão de palavras enquanto digita (último termo depois da vírgula) ---
  const VOCABULARIO = ["material de limpeza", "material de expediente", "material escolar", "material hospitalar", "material de construção", "material elétrico", "material esportivo",
    "material odontológico", "material de higiene", "material gráfico", "medicamentos", "insumos hospitalares", "equipamentos médicos", "equipamentos de informática", "equipamentos de proteção individual",
    "gêneros alimentícios", "merenda escolar", "hortifrutigranjeiros", "carnes", "água mineral", "café", "lanches", "refeições", "combustível", "gasolina", "diesel", "lubrificantes", "pneus",
    "peças automotivas", "veículos", "locação de veículos", "transporte escolar", "fretamento", "manutenção de veículos", "manutenção predial", "manutenção de ar condicionado", "ar condicionado",
    "computadores", "notebooks", "impressoras", "toner", "cartuchos", "software", "licenças de software", "suporte técnico", "telefonia", "internet", "câmeras", "cftv", "segurança eletrônica",
    "vigilância", "limpeza predial", "conservação", "mão de obra", "terceirização", "recepção", "portaria", "jardinagem", "dedetização", "coleta de lixo", "resíduos sólidos", "obras", "reforma",
    "pavimentação", "engenharia", "construção civil", "cimento", "tintas", "ferramentas", "mobiliário", "cadeiras", "armários", "eletrodomésticos", "eletroeletrônicos", "uniformes", "fardamento",
    "tecidos", "calçados", "enxoval", "brinquedos", "playground", "livros", "material didático", "papel", "papel sulfite", "copos descartáveis", "descartáveis", "produtos de limpeza", "sacos de lixo",
    "eventos", "sonorização", "buffet", "hospedagem", "passagens aéreas", "publicidade", "gráfica", "sinalização", "placas", "comunicação visual", "consultoria", "assessoria", "auditoria",
    "treinamento", "cursos", "exames laboratoriais", "reagentes", "oxigênio", "gases medicinais", "próteses", "órteses", "fraldas", "seringas", "luvas", "máscaras", "energia solar", "fotovoltaica",
    "iluminação pública", "lâmpadas", "postes", "cabos", "instrumentos musicais", "academia", "agrícola", "sementes", "fertilizantes", "ração", "medicamentos veterinários", "drones", "baterias"];
  function sugerirPalavras(textoCampo, extras = [], max = 8) {
    const partes = String(textoCampo || "").split(",");
    const atual = norm(partes[partes.length - 1]);
    if (atual.length < 2) return [];
    const ja = new Set(partes.slice(0, -1).map(norm));
    const vistos = new Set(), saida = [];
    for (const termo of [...extras, ...VOCABULARIO]) {
      const n = norm(termo);
      if (vistos.has(n) || ja.has(n) || n === atual) continue;
      vistos.add(n);
      if (n.startsWith(atual) || n.includes(` ${atual}`)) saida.push(termo);
      if (saida.length >= max) break;
    }
    return saida;
  }
  // Troca o termo que está sendo digitado pela sugestão escolhida.
  function aplicarSugestao(textoCampo, sugestao) {
    const partes = String(textoCampo || "").split(",").map((s) => s.trim());
    partes[partes.length - 1] = sugestao;
    return partes.filter(Boolean).join(", ") + ", ";
  }

  // --- "Já tenho o número": UASG + número do pregão ---
  // id da compra no Compras.gov = UASG (6) + modalidade (2) + número (5) + ano (4). 05 = pregão, 06 = dispensa.
  const CODIGOS_MODALIDADE = { pregao: "05", dispensa: "06" };
  function lerNumero(texto) {
    const m = /^\s*(\d{1,3}(?:\.?\d{3})*|\d{1,5})\s*[/\-. ]\s*(\d{4})\s*$/.exec(String(texto || ""));
    if (!m) return null;
    const numero = m[1].replace(/\./g, "");
    return numero.length <= 5 && Number(numero) > 0 ? { numero: numero.padStart(5, "0"), ano: m[2] } : null;
  }
  function idCompraGov(uasg, modalidade, numeroTexto) {
    const u = String(uasg || "").trim();
    const n = lerNumero(numeroTexto);
    if (!/^\d{1,6}$/.test(u) || !n || !CODIGOS_MODALIDADE[modalidade]) return null;
    return `${u.padStart(6, "0")}${CODIGOS_MODALIDADE[modalidade]}${n.numero}${n.ano}`;
  }
  const linkComprasGov = (id) => (/^\d{17}$/.test(String(id)) ? `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=acompanhamento-compra&compra=${id}` : null);
  // O registro do robô guarda numeroCompra como veio do PNCP ("90012" ou "90012/2026"); compara só os dígitos.
  function mesmoNumero(r, uasg, numeroTexto) {
    const n = lerNumero(numeroTexto);
    if (!n || String(r.codigoUnidade || "").replace(/^0+/, "") !== String(uasg || "").trim().replace(/^0+/, "")) return false;
    const numeroR = String(r.numeroCompra || "").split("/")[0].replace(/\D/g, "").padStart(5, "0");
    return numeroR === n.numero && String(r.anoCompra || "") === n.ano;
  }
  // Item da busca do PNCP (api/search) no formato do cartão, só com os campos que ela traz.
  function editalDaBusca(item) {
    return {
      objeto: item.description || item.title || "", orgao: item.orgao_subrogado_nome || item.orgao_nome || "Órgão não informado",
      municipio: item.municipio_nome || "", uf: item.uf || "", encerramento: item.data_fim_vigencia || null, publicacao: item.data_publicacao_pncp || null,
      numeroControlePNCP: item.numero_controle_pncp || null, modalidadeNome: item.modalidade_licitacao_nome || null, codigoUnidade: item.unidade_codigo || null,
      numeroCompra: item.numero || null, anoCompra: item.ano || null, esferaId: item.esfera_id || null, usuarioNome: item.usuario_nome || null, linkSistemaOrigem: item.link_sistema_origem || null,
    };
  }

  // --- "Sem ninguém participando": histórico já coletado (licitação anterior / Compras.gov) ---
  // Dinheiro em centavos BigInt a partir do texto do número, sem passar por conta de ponto flutuante.
  function centavos(v) {
    if (typeof v === "number" && Number.isFinite(v)) v = v.toFixed(2);
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v ?? "").trim());
    if (!m) return null;
    const c = BigInt(m[2]) * 100n + BigInt(((m[3] || "") + "00").slice(0, 2));
    return m[1] ? -c : c;
  }
  const SEM_VENCEDOR = /desert|fracassad/;
  // compras = linhas de historico_compras com historico_itens(situacao_item, valor_estimado, historico_participacoes(valor_lance, valor_negociado)).
  // Devolve Map(uasg sem zeros à esquerda -> { itens, semVencedor, acimaEstimado }).
  function sinaisPorUasg(compras) {
    const mapa = new Map();
    for (const c of compras || []) {
      const uasg = String(c.uasg || "").replace(/^0+/, "");
      if (!uasg) continue;
      const s = mapa.get(uasg) || { itens: 0, semVencedor: 0, acimaEstimado: 0 };
      for (const it of c.historico_itens || []) {
        s.itens += 1;
        if (SEM_VENCEDOR.test(norm(it.situacao_item))) { s.semVencedor += 1; continue; }
        const estimado = centavos(it.valor_estimado);
        const lances = (it.historico_participacoes || []).map((p) => centavos(p.valor_negociado ?? p.valor_lance)).filter((v) => v !== null && v > 0n);
        if (estimado && estimado > 0n && lances.length && lances.reduce((a, b) => (b < a ? b : a)) > estimado) s.acimaEstimado += 1;
      }
      mapa.set(uasg, s);
    }
    return mapa;
  }
  const temSinal = (s) => Boolean(s && (s.semVencedor || s.acimaEstimado));

  // --- Órgãos compradores (base do robô: oportunidades abertas) ---
  // linhas = [{ orgao, municipio, uf, codigoUnidade, usuarioNome, esferaId }]; capag(linha) devolve o resultado de Capag.consultarCapag.
  function agruparOrgaos(linhas, capag) {
    const grupos = new Map();
    for (const l of linhas || []) {
      const chave = `${norm(l.orgao)}|${norm(l.municipio)}|${l.uf || ""}`;
      const g = grupos.get(chave) || { orgao: l.orgao || "Órgão não informado", municipio: l.municipio || "", uf: l.uf || "", esferaId: l.esferaId || null, uasgs: new Set(), portais: new Set(), abertas: 0 };
      g.abertas += 1;
      if (l.codigoUnidade) g.uasgs.add(String(l.codigoUnidade));
      const portal = Portal && Portal.portalDe(l).nome;
      if (portal) g.portais.add(portal);
      grupos.set(chave, g);
    }
    return [...grupos.values()].map((g) => {
      const c = capag ? capag(g) : null;
      return { ...g, uasgs: [...g.uasgs].sort(), portais: [...g.portais].sort(), capag: c && c.disponivel ? c.nota : null };
    }).sort((a, b) => b.abertas - a.abertas || a.orgao.localeCompare(b.orgao, "pt-BR"));
  }

  const api = { MODALIDADES, MODOS_DISPUTA, modoDisputaDe, temFiltroDeItem, partesControle, itensConferem, PORTAIS, norm, temTodos, exclusivaMeEpp, ehSrp, modalidadeDe, filtrarExtra, dataDoPeriodo, VOCABULARIO, sugerirPalavras, aplicarSugestao,
    lerNumero, idCompraGov, linkComprasGov, mesmoNumero, editalDaBusca, centavos, sinaisPorUasg, temSinal, agruparOrgaos };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.BuscaExtra = api;
})(globalThis);
