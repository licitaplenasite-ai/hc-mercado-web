/* global window, module -- script de navegador (assinar.html) e funções puras testadas no Node */
// Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central, Manual de Padrões para Iniciação do Pix):
// campos ID + tamanho (2 dígitos) + valor, e no fim o CRC16-CCITT (polinômio 0x1021, início 0xFFFF) do texto inteiro,
// incluindo "6304". Sem QR em imagem: isso pediria uma biblioteca de fora; o código copia e cola já paga no banco.
(function () {
  'use strict';

  function crc16(texto) {
    let crc = 0xffff;
    for (const b of new TextEncoder().encode(texto)) {
      crc ^= b << 8;
      for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  const campo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;
  // Nome e cidade do recebedor: só letras sem acento, números e espaço, em maiúsculas (os bancos recusam acento).
  const limpar = (t, max) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max).trim();

  // Vazio quando falta chave, nome, cidade ou valor: a tela mostra "Fale com a equipe" no lugar.
  function montarPixCopiaCola({ chave, nome, cidade, valorCentavos }) {
    const k = String(chave || '').trim(), n = limpar(nome, 25), c = limpar(cidade, 15);
    if (!k || k.length > 77 || !n || !c || !(Number.isInteger(valorCentavos) && valorCentavos > 0)) return '';
    const corpo = campo('00', '01')
      + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', k))
      + campo('52', '0000') + campo('53', '986')
      + campo('54', (valorCentavos / 100).toFixed(2))
      + campo('58', 'BR') + campo('59', n) + campo('60', c)
      + campo('62', campo('05', '***'))
      + '6304';
    return corpo + crc16(corpo);
  }

  const api = { crc16, montarPixCopiaCola };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PixCopiaCola = api;
})();
