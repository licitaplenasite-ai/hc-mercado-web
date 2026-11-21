const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./planilha-itens');

test('arquivo para o portal: colunas genéricas, total em centavos, antifórmula e aspas', () => {
  const csv = P.gerarCsvPortal([
    { identificador: '1', descricao: 'Caneta; azul', marca: 'X', modelo: 'Y', unidade: 'UN', quantidade: '500.000', valorUnitario: '1.10' },
    { identificador: '2', descricao: '=cmd', quantidade: '2.500', valorUnitario: '0.33' },
    { identificador: '3', descricao: 'Sem oferta', quantidade: '3.000', valorUnitario: null },
  ]);
  assert.equal(csv, '﻿item;descricao;marca;modelo;unidade;quantidade;valor_unitario;valor_total\r\n'
    + '1;"Caneta; azul";X;Y;UN;500;1,10;550,00\r\n'
    + "2;'=cmd;;;;2,5;0,33;0,83\r\n" // 2,5 × 0,33 = 0,825 → meio para cima
    + '3;Sem oferta;;;;3;;\r\n');
  assert.equal(P.gerarCsvPortal([]), '﻿item;descricao;marca;modelo;unidade;quantidade;valor_unitario;valor_total\r\n');
});
