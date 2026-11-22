const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./contador-tributario.js');

// Linhas reais da tabela oficial (GET dados-abertos/classificacoes-tributarias/cbs-ibs, versão V0073), no formato do robô.
const TABELA = [
  { codigo: '000001', descricao: 'Situações tributadas integralmente pelo IBS e CBS.', nomenclatura: 'NBS ou NCM', reducaoCbs: 0, reducaoIbsUf: 0, reducaoIbsMun: 0, tipoAliquota: 'Padrão', baseLegal: 'Art. 4º' },
  { codigo: '200003', descricao: 'Vendas de produtos destinados à alimentação humana (Anexo I)', nomenclatura: 'NCM', reducaoCbs: 100, reducaoIbsUf: 100, reducaoIbsMun: 100, tipoAliquota: 'Padrão', baseLegal: 'Art. 125' },
  { codigo: '200028', descricao: 'Fornecimento dos serviços de educação (Anexo II)', nomenclatura: 'NBS', reducaoCbs: 60, reducaoIbsUf: 60, reducaoIbsMun: 60, tipoAliquota: 'Padrão' },
  { codigo: '200032', descricao: 'Fornecimento dos medicamentos registrados na Anvisa ou produzidos por farmácias de manipulação', nomenclatura: 'NCM', reducaoCbs: 60, reducaoIbsUf: 60, reducaoIbsMun: 60, tipoAliquota: 'Padrão', baseLegal: 'Art. 133' },
  { codigo: '410004', descricao: 'Exportações de bens e serviços', nomenclatura: 'NBS ou NCM', reducaoCbs: 0, reducaoIbsUf: 0, reducaoIbsMun: 0, tipoAliquota: 'Sem alíquota' },
];

test('regime pelo CNPJ: MEI, Simples, excluído do Simples, Presumido declarado e sem dado (pergunta)', () => {
  const hoje = '2026-11-22';
  assert.equal(C.regimePeloCnpj({ opcao_pelo_mei: true, opcao_pelo_simples: true, data_opcao_pelo_mei: '2020-01-01' }, hoje).regime, 'mei');
  const s = C.regimePeloCnpj({ opcao_pelo_mei: false, opcao_pelo_simples: true, cnae_fiscal: 4771701, uf: 'AM', codigo_municipio_ibge: 1302603 }, hoje);
  assert.equal(s.regime, 'simples'); assert.equal(s.anexo, 'I'); assert.equal(s.uf, 'AM'); assert.equal(s.municipioIbge, '1302603');
  assert.match(s.fonte, /Receita Federal/);
  // Exclusão já vigente: não é mais Simples; sem regime_tributario → pergunta só o Presumido/Real.
  const ex = C.regimePeloCnpj({ opcao_pelo_simples: true, data_exclusao_do_simples: '2025-12-31' }, hoje);
  assert.equal(ex.regime, null); assert.match(ex.pergunta, /Presumido ou do Lucro Real/);
  // Exclusão futura ainda não vale.
  assert.equal(C.regimePeloCnpj({ opcao_pelo_simples: true, data_exclusao_do_simples: '2027-01-01' }, hoje).regime, 'simples');
  const pr = C.regimePeloCnpj({ opcao_pelo_simples: false, regime_tributario: [{ ano: 2022, forma_de_tributacao: 'LUCRO REAL' }, { ano: 2024, forma_de_tributacao: 'LUCRO PRESUMIDO' }] }, hoje);
  assert.equal(pr.regime, 'presumido'); assert.match(pr.fonte, /2024/);
  assert.equal(C.regimePeloCnpj(null).regime, null);
  assert.equal(C.anexoSugerido('2511000'), 'II'); assert.equal(C.anexoSugerido('6201501'), null);
});

test('Simples: alíquota efetiva pela LC 123 (Anexo I, R$ 500 mil = 6,728%), faixa 1, sublimite e teto', () => {
  const r = C.aliquotaEfetivaSimples('I', 50000000n);
  assert.equal(r.ok, true); assert.equal(r.aliquota, 6728n); assert.equal(r.faixa, 3); assert.equal(r.sublimite, false);
  assert.equal(C.aliquotaEfetivaSimples('III', 10000000n).aliquota, 6000n); // R$ 100 mil: 1ª faixa = nominal
  assert.equal(C.aliquotaEfetivaSimples('I', 400000000n).sublimite, true);  // R$ 4 milhões
  assert.equal(C.aliquotaEfetivaSimples('I', 480000001n).ok, false);
  assert.equal(C.aliquotaEfetivaSimples('VI', 100n).ok, false);
});

test('ICMS interestadual: 7% do Sul/Sudeste para o Norte, 12% no resto, 4% importado, 0 na mesma UF', () => {
  assert.equal(C.icmsInterestadual('SP', 'AM').aliquota, 7000n);
  assert.equal(C.icmsInterestadual('SP', 'ES').aliquota, 7000n);
  assert.equal(C.icmsInterestadual('AM', 'SP').aliquota, 12000n);
  assert.equal(C.icmsInterestadual('SP', 'RJ').aliquota, 12000n);
  assert.equal(C.icmsInterestadual('SP', 'AM', true).aliquota, 4000n);
  assert.equal(C.icmsInterestadual('AM', 'AM').mesmaUf, true);
  assert.equal(C.icmsInterestadual('XX', 'AM').ok, false);
});

test('cClassTrib: redução e base legal da tabela oficial; recusa a que não cabe no tipo ou não é venda comum', () => {
  const cesta = C.classificacaoDe(TABELA, '200003', 'bem');
  assert.equal(cesta.ok, true); assert.equal(cesta.cst, '200'); assert.equal(cesta.reducaoCbs, 100);
  assert.equal(cesta.rotulo, 'Alíquota zero: cesta básica'); assert.equal(cesta.baseLegal, 'LC 214/2025, Art. 125');
  assert.equal(C.classificacaoDe(TABELA, '200032', 'bem').rotulo, 'Redução de 60%: medicamento');
  assert.equal(C.classificacaoDe(TABELA, '200028', 'servico').rotulo, 'Redução de 60%: educação');
  assert.equal(C.classificacaoDe(TABELA, '000001', 'servico').rotulo, 'Sem redução');
  assert.match(C.classificacaoDe(TABELA, '200028', 'bem').erro, /só para serviço/);
  assert.match(C.classificacaoDe(TABELA, '200032', 'servico').erro, /só para mercadoria/);
  assert.match(C.classificacaoDe(TABELA, '410004', 'bem').erro, /não é de venda comum/);
  assert.equal(C.classificacaoDe(TABELA, '999999', 'bem').ok, false);
});

const base = (x) => ({ tipo: 'bem', regime: 'real', ano: 2027, origemUf: 'AM', destinoUf: 'AM', aliquotas: { icms: 18000n }, ...x });

// Conta à mão 1 (cesta básica): custo R$ 10,00, ICMS 18%, CBS/IBS zero. 10 ÷ 0,82 = 12,195 → R$ 12,20.
test('à mão 1: arroz da cesta básica (alíquota zero) no Lucro Real em 2027', () => {
  const classe = C.classificacaoDe(TABELA, '200003', 'bem');
  const r = C.formarPreco(base({ custoUnitarioCentavos: 1000n, quantidade: 100000n, classe, margem: 10000n }));
  assert.equal(r.ok, true);
  assert.equal(r.custos.custoUnidade, 1000n);
  assert.equal(r.minimo.valor, 1220n); assert.equal(r.minimo.cbs, 0n); assert.equal(r.minimo.ibs, 0n); assert.equal(r.minimo.final, 1220n);
  assert.equal(r.alvo.valor, 1389n); // 10 ÷ 0,72 = 13,888 → 13,89
  assert.equal(r.aviso, 'Estimativa para formar preço. Confirme com o seu contador.');
  assert.ok(r.dicas.some((d) => /Alíquota zero: cesta básica.*confira se o NCM do seu fornecedor/.test(d)));
  assert.ok(r.dicas.some((d) => /PIS e a Cofins deixam de existir/.test(d)));
});

// Conta à mão 2 (medicamento 60%): V = 50 ÷ 0,82 = 60,98; ICMS 10,98; base 50,00; CBS 4,48% = 2,24; IBS 0,04% = 0,02; final 63,24.
test('à mão 2: medicamento com redução de 60% no Presumido em 2027', () => {
  const classe = C.classificacaoDe(TABELA, '200032', 'bem');
  const r = C.formarPreco(base({ regime: 'presumido', custoUnitarioCentavos: 5000n, quantidade: 10000n, classe }));
  assert.equal(r.minimo.valor, 6098n); assert.equal(r.minimo.base, 5000n);
  assert.equal(r.cbsIbs.cbs, 4480n); assert.equal(r.cbsIbs.ibs, 40n);
  assert.equal(r.minimo.cbs, 224n); assert.equal(r.minimo.ibs, 2n); assert.equal(r.minimo.final, 6324n);
  assert.ok(r.dicas.some((d) => /redução de 60% \(LC 214\/2025, Art. 133\)/.test(d)));
  assert.ok(r.dicas.some((d) => /Preço mínimo para não ter prejuízo: R\$ 63,24/.test(d)));
});

// Conta à mão 3 (normal, margem 20%): V = 100 ÷ 0,62 = 161,30; base 132,27; CBS 11,2% = 14,81; IBS 0,1% = 0,13; final 176,24.
test('à mão 3: item normal no Lucro Real em 2027 com margem de 20%', () => {
  const classe = C.classificacaoDe(TABELA, '000001', 'bem');
  const r = C.formarPreco(base({ custoUnitarioCentavos: 10000n, quantidade: 1000n, classe, margem: 20000n }));
  assert.equal(r.minimo.valor, 12196n); assert.equal(r.minimo.final, 13326n);
  assert.equal(r.alvo.valor, 16130n); assert.equal(r.alvo.cbs, 1481n); assert.equal(r.alvo.ibs, 13n); assert.equal(r.alvo.final, 17624n);
  // Do final de volta ao valor (para baixo): 16129; lucro 161,29 − 29,03 − 100 = 32,26; margem 20,00% do valor.
  assert.deepEqual(r.alvoLucro, { valor: 16129n, lucro: 3226n, margem: 2000n });
});

// Conta à mão 4 (outra UF + DIFAL + dinheiro): 5 un. a R$ 200 + frete R$ 100 = R$ 1.100; 1% ao mês por 60 dias = R$ 22,00;
// custo por unidade 1.122 ÷ 5 = 224,40. SP→AM: interestadual 7% + DIFAL 13% (interna AM 20% informada) = 20% por dentro.
// V = 224,40 ÷ 0,80 = 280,50; ICMS 19,64 + DIFAL 36,47 = 56,10 (fora da base); base 224,40; CBS 25,13; IBS 0,22; final 305,85.
test('à mão 4: mercadoria de SP para órgão do AM, com DIFAL e custo do dinheiro parado', () => {
  const classe = C.classificacaoDe(TABELA, '000001', 'bem');
  const r = C.formarPreco(base({ origemUf: 'SP', destinoUf: 'AM', aliquotas: { icmsDestino: 20000n }, custoUnitarioCentavos: 20000n, quantidade: 5000n,
    custosItem: { frete: 10000n }, dinheiro: { taxaMensal: 1000n, dias: 60 }, classe,
    referencias: { vencedor: 30000n, mercado: 32000n } }));
  assert.equal(r.custos.dinheiro, 2200n); assert.equal(r.custos.totalCustos, 112200n); assert.equal(r.custos.custoUnidade, 22440n);
  assert.deepEqual(r.tributos.map((l) => [l.rotulo, l.pct]), [['ICMS interestadual', 7000n], ['DIFAL para AM', 13000n]]);
  assert.equal(r.minimo.valor, 28050n); assert.equal(r.minimo.base, 22440n);
  assert.equal(r.minimo.cbs, 2513n); assert.equal(r.minimo.ibs, 22n); assert.equal(r.minimo.final, 30585n);
  const [venc, merc] = r.valeAPena;
  assert.equal(venc.veredito, 'nao');
  assert.equal(venc.texto, 'Não vale: o último vencedor ganhou a R$ 300,00, abaixo do seu custo de R$ 305,85.');
  // Mercado R$ 320,00 → valor 293,47; lucro 293,47 − 58,69 − 224,40 = 10,38; margem 3,53% (< 5%): apertado.
  assert.equal(merc.veredito, 'apertado'); assert.equal(merc.lucro, 1038n); assert.equal(merc.margem, 353n);
  assert.ok(r.dicas.some((d) => /DIFAL\) vai para a UF do órgão/.test(d)));
  assert.ok(r.dicas.some((d) => /Esperar o pagamento custa R\$ 22,00/.test(d)));
});

test('vale a pena: "Vale" com margem acima da mínima das premissas', () => {
  const r = C.formarPreco(base({ custoUnitarioCentavos: 10000n, quantidade: 1000n, classe: C.classificacaoDe(TABELA, '000001', 'bem'), margemMinima: 8000n, referencias: { mercado: 17624n } }));
  assert.equal(r.valeAPena[0].veredito, 'vale'); assert.match(r.valeAPena[0].texto, /^Vale: margem de 20,00%/);
});

test('Simples: DAS por dentro, sem CBS/IBS por fora, dicas do Simples e do DIFAL suspenso', () => {
  const das = C.aliquotaEfetivaSimples('I', 50000000n);
  const r = C.formarPreco({ tipo: 'bem', regime: 'simples', ano: 2027, origemUf: 'SP', destinoUf: 'AM', custoUnitarioCentavos: 10000n, quantidade: 1000n,
    aliquotas: { das: das.aliquota, dasFonte: das.fonte } });
  assert.deepEqual(r.tributos.map((l) => l.rotulo), ['DAS do Simples']);
  assert.equal(r.minimo.cbs, 0n); assert.equal(r.minimo.valor, 10722n); // 100 ÷ (1 − 0,06728) = 107,21 → 107,22
  assert.ok(r.dicas.some((d) => /não gera crédito cheio/.test(d)));
  assert.ok(r.dicas.some((d) => /ADI 5464/.test(d)));
});

test('falta de alíquota sem fonte: pede o número em vez de inventar', () => {
  const r = C.formarPreco({ tipo: 'servico', regime: 'presumido', ano: 2027, custoUnitarioCentavos: 10000n, quantidade: 1000n });
  assert.deepEqual(r.faltando, ['ISS do município (2% a 5%, LC 116/2003)']);
  assert.ok(r.dicas.some((d) => /Falta informar: ISS/.test(d)));
  const sem = C.formarPreco({ tipo: 'bem', regime: 'real', ano: 2027, origemUf: 'SP', destinoUf: 'AM', custoUnitarioCentavos: 100n, quantidade: 1000n });
  assert.match(sem.faltando[0], /alíquota interna de ICMS de AM/);
});

test('transição: PIS/Cofins só até 2026 (padrão em lei) e ICMS a 80% em 2030', () => {
  const r26 = C.formarPreco(base({ ano: 2026, regime: 'presumido', custoUnitarioCentavos: 10000n, quantidade: 1000n }));
  assert.deepEqual(r26.tributos.map((l) => [l.rotulo, l.pct]), [['PIS/Cofins', 3650n], ['ICMS', 18000n]]);
  assert.equal(r26.minimo.cbs, 0n);
  const r30 = C.formarPreco(base({ ano: 2030, custoUnitarioCentavos: 10000n, quantidade: 1000n }));
  assert.deepEqual(r30.tributos.map((l) => l.pct), [14400n]);
  assert.ok(r30.dicas.some((d) => /80% da alíquota/.test(d)));
});

test('entradas inválidas viram mensagem simples', () => {
  assert.match(C.formarPreco({ tipo: 'bem', regime: 'x', ano: 2027 }).erro, /regime/);
  assert.match(C.formarPreco(base({ ano: 2040, custoUnitarioCentavos: 1n, quantidade: 1n })).erro, /ano da entrega/);
  assert.match(C.formarPreco(base({ custoUnitarioCentavos: 1n, quantidade: 0n })).erro, /quantidade/);
  assert.match(C.formarPreco(base({ custoUnitarioCentavos: 1n, quantidade: 1n, custosItem: { frete: -1n } })).erro, /planilha/);
  assert.match(C.formarPreco(base({ custoUnitarioCentavos: 1n, quantidade: 1n, pctPreco: { comissao: 90000n } })).erro, /100%/);
});

test('status oficiais viram frases simples', () => {
  assert.match(C.fraseStatusOficial('CALCULO_SIMULADO'), /provisórias/);
  assert.match(C.fraseStatusOficial('INCONSISTENCIA_ENTRADA', [{ code: 'REG-011' }]), /não está na lista/);
  assert.match(C.fraseStatusOficial('NAO_IMPLEMENTADO'), /ainda não calcula/);
  assert.match(C.fraseStatusOficial('FALHA_TECNICA'), /conta local/);
  assert.match(C.fraseStatusOficial(undefined), /conta local/);
});
