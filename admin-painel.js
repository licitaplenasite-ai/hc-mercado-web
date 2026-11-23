/* global window, module -- script de navegador (admin.html) e funções puras testadas no Node */
// Regras do painel do dono que dá para errar: quando um robô está atrasado, a cobertura dos estados e o motivo de
// uma falha do boletim em português simples. O resto do admin é tela (admin.html).
(function () {
  'use strict';

  // prazoHoras = de quanto em quanto tempo o robô roda (o boletim não roda no fim de semana; as bases e o vigia, 1 vez por semana).
  const ROBOS = [
    { codigo: 'pncp', nome: 'Editais do governo', faz: 'Busca os editais novos no portal nacional de compras do governo (PNCP).', prazoHoras: 24 },
    { codigo: 'ufs', nome: 'Editais por estado', faz: 'A cada 3 horas, busca de novo os estados que o portal do governo não entregou.', prazoHoras: 3 },
    { codigo: 'mercado', nome: 'Contratos e atas (Mercado)', faz: 'Traz os contratos assinados e as atas que alimentam o Mercado e o Analisar concorrente.', prazoHoras: 24 },
    { codigo: 'prospeccao', nome: 'Prospecção', faz: 'Junta os planos de compra dos órgãos, as atas com saldo e os contratos perto do fim.', prazoHoras: 24 },
    { codigo: 'sancoes', nome: 'Empresas punidas (Sanções)', faz: 'Baixa a lista do governo de empresas proibidas de contratar (CGU).', prazoHoras: 24 },
    { codigo: 'boletim', nome: 'Boletim por e-mail', faz: 'Manda os editais novos para cada cliente, de segunda a sexta.', prazoHoras: 72 },
    { codigo: 'lembretes', nome: 'Lembretes de prazo', faz: 'Avisa o cliente por e-mail e no celular quando o prazo da proposta está perto.', prazoHoras: 2 },
    { codigo: 'cobranca', nome: 'Cobrança', faz: 'Toda manhã, bloqueia quem passou da carência e manda os lembretes de vencimento.', prazoHoras: 24 },
    { codigo: 'bases_obra', nome: 'Tabelas de preço de obra', faz: 'Confere se saiu tabela nova do SINAPI, SICRO e outras bases oficiais.', prazoHoras: 168 },
    { codigo: 'vigia_normas', nome: 'Vigia de normas de obra', faz: 'Toda terça, procura decisões do TCU e normas novas sobre orçamento de obra.', prazoHoras: 168 },
  ];
  const TOTAL_UFS = 27;

  function haQuanto(iso, agora) {
    const horas = (agora - new Date(iso).getTime()) / 3600000;
    if (!(horas >= 0)) return 'agora';
    if (horas < 1) return 'há menos de 1 hora';
    if (horas < 48) return `há ${Math.round(horas)} hora${Math.round(horas) === 1 ? '' : 's'}`;
    return `há ${Math.round(horas / 24)} dias`;
  }

  // Em dia até o prazo + 6 h (fila do GitHub atrasa); atenção até 2 × o prazo (no mínimo + 24 h); depois, parado.
  // Robô diário: em dia até 30 h, atenção de 30 a 48 h, parado depois de 48 h.
  function classificarRobo(ultimoSucesso, prazoHoras, agora) {
    if (!ultimoSucesso || Number.isNaN(new Date(ultimoSucesso).getTime())) {
      return { nivel: 'sem_registro', texto: 'Ainda sem registro: aparece depois da primeira rodada com a versão nova' };
    }
    const horas = (agora - new Date(ultimoSucesso).getTime()) / 3600000;
    const quando = haQuanto(ultimoSucesso, agora);
    if (horas <= prazoHoras + 6) return { nivel: 'ok', texto: `Em dia: último sucesso ${quando}` };
    if (horas <= Math.max(prazoHoras * 2, prazoHoras + 24)) return { nivel: 'atencao', texto: `Atenção: último sucesso ${quando}` };
    return { nivel: 'parado', texto: `Parado: último sucesso ${quando}. Veja o robô no GitHub (aba Actions)` };
  }

  // null = o robô dos editais ainda não deixou registro: não dá para dizer que está tudo em dia.
  function coberturaEstados(ufsComFalha) {
    if (ufsComFalha === null) return { emDia: null, total: TOTAL_UFS, pendentes: [], texto: 'Estados com editais em dia: ainda sem registro da busca de editais.' };
    const pendentes = Array.isArray(ufsComFalha) ? ufsComFalha.filter((u) => /^[A-Z]{2}$/.test(u)) : [];
    const emDia = Math.max(TOTAL_UFS - pendentes.length, 0);
    const texto = pendentes.length
      ? `Editais em dia de ${emDia} dos ${TOTAL_UFS} estados. Faltam: ${pendentes.join(', ')} (o robô "Editais por estado" tenta de novo sozinho).`
      : `Editais em dia dos ${TOTAL_UFS} estados.`;
    return { emDia, total: TOTAL_UFS, pendentes, texto };
  }

  // A mensagem crua vem do servidor de e-mail (inglês, código SMTP). A ordem importa: o mais específico primeiro.
  const MOTIVOS = [
    [/remetente recusado|SM_11[13]/i, 'O endereço que envia o e-mail não está confirmado no ZeptoMail. Confirme o remetente lá.'],
    [/\b535\b|authenticat|username and password|application-specific password/i, 'A senha do e-mail que envia foi recusada. Confira a senha de app do Gmail.'],
    [/\b55[03]\b|5\.1\.1|user unknown|does not exist|mailbox (unavailable|not found)|no such user|invalid (recipient|address)/i, 'O e-mail do cliente não existe ou recusou a mensagem. Confira o e-mail no cadastro dele.'],
    [/quota|rate limit|daily (user )?sending limit|too many|\b421\b|\b452\b/i, 'O limite diário de envios foi atingido. O que faltou sai na próxima rodada.'],
    [/timed? ?out|timeout/i, 'O servidor de e-mail demorou demais para responder. O robô tenta de novo na próxima rodada.'],
    [/getaddrinfo|connection|network|ECONN|refused|reset by peer|name or service/i, 'Falhou a conexão com o servidor de e-mail. O robô tenta de novo na próxima rodada.'],
  ];
  function motivoFalhaBoletim(mensagem) {
    const t = String(mensagem || '').trim();
    if (!t) return 'Erro sem detalhe.';
    for (const [padrao, texto] of MOTIVOS) if (padrao.test(t)) return texto;
    return `Erro no envio: ${t.slice(0, 160)}`;
  }

  // Alarmes do incidente 23/11 (processo do cliente horas em "Na fila…"): pedido de processo sem dossiê há mais
  // de 1 h e coleta do PNCP com cobertura atrasada (que antes derrubava o robô e travava a fila sem ninguém ver).
  // dados = retorno de admin_saude_robos (dossies_interesse_atrasados, coleta_alarme); campos ausentes = banco antigo.
  const FASES_COLETA = { oportunidades: 'Busca de editais', contratos: 'Contratos assinados' };
  function alarmesSaude(dados, agora) {
    const alarmes = [];
    const fila = dados && dados.dossies_interesse_atrasados;
    const n = Number(fila && fila.esperando) || 0;
    if (n > 0) {
      alarmes.push(`${n === 1 ? '1 processo de cliente espera' : `${n} processos de clientes esperam`} a leitura do edital há mais de 1 hora` +
        `${fila.mais_antigo ? ` (o mais antigo chegou ${haQuanto(fila.mais_antigo, agora)})` : ''}. Veja o robô "Gerar dossiês" no GitHub (aba Actions).`);
    }
    const coleta = dados && dados.coleta_alarme;
    for (const [fase, nome] of Object.entries(FASES_COLETA)) {
      const lista = coleta && Array.isArray(coleta[fase]) ? coleta[fase] : [];
      for (const item of lista) if (typeof item === 'string' && item) alarmes.push(`${nome} atrasada: ${item}. O robô continua rodando e tenta recuperar sozinho.`);
    }
    return alarmes;
  }

  const api = { ROBOS, TOTAL_UFS, haQuanto, classificarRobo, coberturaEstados, motivoFalhaBoletim, alarmesSaude };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AdminPainel = api;
})();
