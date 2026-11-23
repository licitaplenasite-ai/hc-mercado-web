/* global module */
// Calculadora de prazos do Jurídico (juridico-ui.js, aba "Prazos"). Mesmo módulo no navegador e no Node (testes).
// Regras conferidas no texto oficial da Lei 14.133/2021 (planalto.gov.br, 22/11/2026):
//   art. 55  prazo mínimo entre a divulgação do edital e a sessão (dias úteis);
//   art. 164 esclarecimento e impugnação até 3 dias úteis antes da abertura; resposta até o último dia útil antes dela;
//   art. 165 recurso em 3 dias úteis da intimação ou da ata; contrarrazões no mesmo prazo, da divulgação do recurso (§ 4º);
//   art. 157/158 defesa em processo de sanção, 15 dias úteis; art. 166 recurso contra sanção, 15 dias úteis;
//   art. 167 reconsideração da inidoneidade, 15 dias úteis;
//   art. 183 exclui o dia do começo, inclui o do vencimento e só conta dia com expediente no órgão.
// Feriados: os nacionais, pela mesma regra do Funil (funil-tarefas-ui.js: datas fixas + Sexta-feira Santa).
// Carnaval (segunda e terça) e Corpus Christi não são feriado nacional, mas muito órgão fecha. A conta fica sempre do
// lado seguro: no prazo "antes da abertura" esses dias NÃO contam (o último dia sai mais cedo); no prazo "depois" eles
// contam (o último dia também sai mais cedo). Feriado estadual ou municipal do órgão não entra: o aviso da tela pede para
// conferir. Ninguém perde prazo porque a conta deu um dia a mais.
(function (global) {
  'use strict';
  const L14133 = 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm';
  const DIA = /^\d{4}-\d{2}-\d{2}$/;
  const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
  const UM_DIA = 864e5;

  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return Date.UTC(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  }
  const diaDe = (ms) => new Date(ms).toISOString().slice(0, 10);
  const ms = (dia) => Date.parse(`${dia}T12:00:00Z`);
  const deslocar = (ano, dias) => diaDe(pascoa(ano) + dias * UM_DIA);

  function feriadoNacional(dia) {
    return FIXOS.includes(dia.slice(5)) || dia === deslocar(Number(dia.slice(0, 4)), -2);
  }
  // Carnaval (Páscoa − 48 e − 47) e Corpus Christi (Páscoa + 60).
  function pontoFacultativo(dia) {
    const ano = Number(dia.slice(0, 4));
    return [-48, -47, 60].some((n) => deslocar(ano, n) === dia);
  }
  function diaUtil(dia, { semPontoFacultativo = false } = {}) {
    const semana = new Date(ms(dia)).getUTCDay();
    return semana !== 0 && semana !== 6 && !feriadoNacional(dia) && !(semPontoFacultativo && pontoFacultativo(dia));
  }
  // n > 0: n dias úteis depois (o dia do evento não conta, art. 183); n < 0: n dias úteis antes.
  function somarDiasUteis(dia, n, opcoes) {
    let t = ms(dia);
    for (let falta = Math.abs(n); falta > 0;) {
      t += Math.sign(n) * UM_DIA;
      if (diaUtil(diaDe(t), opcoes)) falta -= 1;
    }
    return diaDe(t);
  }

  const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const formatar = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)} (${SEMANA[new Date(ms(dia)).getUTCDay()]})`;
  const base = (dispositivo) => ({ norma: 'Lei 14.133/2021', dispositivo, url: L14133 });
  const ANTES = { semPontoFacultativo: true };

  // Cada evento: o que a pessoa informa e a lista de prazos que saem dele.
  const EVENTOS = Object.freeze({
    publicacao: {
      rotulo: 'Publicação do edital',
      ajuda: 'A sessão não pode ser marcada antes destas datas. Se foi, é motivo de impugnação.',
      prazos: [
        ['Compra de bens, menor preço ou maior desconto', 8, 'art. 55, I, a'],
        ['Compra de bens, outros critérios', 15, 'art. 55, I, b'],
        ['Serviço comum ou obra comum de engenharia, menor preço ou maior desconto', 10, 'art. 55, II, a'],
        ['Serviço especial ou obra especial de engenharia, menor preço ou maior desconto', 25, 'art. 55, II, b'],
        ['Contratação semi-integrada e outros casos de serviço e obra', 35, 'art. 55, II, d'],
        ['Contratação integrada', 60, 'art. 55, II, c'],
      ].map(([titulo, dias, disp]) => ({ codigo: `sessao-${dias}`, titulo: `Sessão no mínimo em: ${titulo}`, dias, base: base(disp), regra: `${dias} dias úteis depois da publicação` })),
    },
    abertura: {
      rotulo: 'Data da sessão (abertura)',
      ajuda: 'Protocole no canal que o edital indicar. Se puder, envie um dia antes do último dia.',
      prazos: [
        { codigo: 'esclarecimento', titulo: 'Último dia para pedir esclarecimento', dias: -3, opcoes: ANTES, modelo: 'esclarecimento', base: base('art. 164'), regra: '3 dias úteis antes da abertura' },
        { codigo: 'impugnacao', titulo: 'Último dia para impugnar o edital', dias: -3, opcoes: ANTES, modelo: 'impugnacao', base: base('art. 164'), regra: '3 dias úteis antes da abertura' },
        { codigo: 'resposta', titulo: 'O órgão tem de responder até', dias: -1, opcoes: ANTES, base: base('art. 164, parágrafo único'), regra: 'até 3 dias úteis, no máximo até o último dia útil antes da abertura' },
      ],
    },
    ata: {
      rotulo: 'Intenção de recurso / ata da habilitação ou do julgamento',
      ajuda: 'A intenção de recorrer é na hora, na sessão (art. 165, § 1º, I). Daqui conta o prazo das razões.',
      prazos: [
        { codigo: 'recurso', titulo: 'Último dia para enviar as razões do recurso', dias: 3, modelo: 'recurso', base: base('art. 165, I e § 1º, I'), regra: '3 dias úteis da intimação ou da ata' },
        { codigo: 'contrarrazao-estimada', titulo: 'Contrarrazões, se o recurso for divulgado no fim do prazo (estimativa)', dias: 6, modelo: 'contrarrazao', base: base('art. 165, § 4º'), regra: '3 dias úteis depois do fim do prazo do recurso. Confira a data da divulgação no portal.' },
      ],
    },
    recurso: {
      rotulo: 'Divulgação do recurso de outra empresa',
      ajuda: 'Conta da intimação pessoal ou da divulgação do recurso no portal.',
      prazos: [
        { codigo: 'contrarrazao', titulo: 'Último dia para enviar contrarrazões', dias: 3, modelo: 'contrarrazao', base: base('art. 165, § 4º'), regra: '3 dias úteis, o mesmo prazo do recurso' },
      ],
    },
    sancao_defesa: {
      rotulo: 'Intimação para defesa em processo de sanção',
      ajuda: 'Vale para multa, impedimento e inidoneidade. Junte provas e peça as que quiser produzir.',
      prazos: [
        { codigo: 'defesa-sancao', titulo: 'Último dia para a defesa', dias: 15, base: base('arts. 157 e 158'), regra: '15 dias úteis da intimação' },
      ],
    },
    sancao_decisao: {
      rotulo: 'Intimação da decisão que aplicou a sanção',
      ajuda: 'Advertência, multa e impedimento: recurso. Inidoneidade: só pedido de reconsideração.',
      prazos: [
        { codigo: 'recurso-sancao', titulo: 'Último dia para recorrer (advertência, multa ou impedimento)', dias: 15, base: base('art. 166'), regra: '15 dias úteis da intimação' },
        { codigo: 'reconsideracao-inidoneidade', titulo: 'Último dia para pedir reconsideração (inidoneidade)', dias: 15, base: base('art. 167'), regra: '15 dias úteis da intimação' },
      ],
    },
  });

  // evento: chave de EVENTOS; dia: "AAAA-MM-DD". Devolve null se faltar algo.
  function calcular(evento, dia) {
    const e = EVENTOS[evento];
    if (!e || !DIA.test(String(dia || '')) || Number.isNaN(ms(dia))) return null;
    return e.prazos.map((p) => {
      const ultimo = somarDiasUteis(dia, p.dias, p.opcoes);
      return { ...p, ultimoDia: ultimo, texto: formatar(ultimo) };
    });
  }

  const AVISO = 'A conta usa os feriados nacionais. Feriado do estado ou da cidade do órgão, ponto facultativo ou sistema fora do ar '
    + 'podem mudar o prazo (art. 183, § 2º). Confira o edital e o portal e, se puder, protocole antes do último dia.';

  const api = { EVENTOS, AVISO, calcular, somarDiasUteis, diaUtil, feriadoNacional, pontoFacultativo, formatar };
  global.JuridicoPrazos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
