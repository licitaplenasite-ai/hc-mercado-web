/* global window, module, TextEncoder -- navegador e Node (testes) */
// .zip simples montado no navegador (Baixar .zip dos documentos): sem compressão ("store"), porque PDF e imagem já vêm
// comprimidos e assim não precisa de biblioteca de fora. Pastas pelo nome do arquivo ("Fiscal/CND Federal.pdf").
// Nada é enviado: quem chama baixa os arquivos com a sessão do usuário e entrega os bytes aqui.
(function (global) {
  "use strict";
  const MAX_ARQUIVOS = 60;
  const MAX_BYTES = 100 * 1024 * 1024;

  const TABELA = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Caminho dentro do zip: sem "..", sem barra inicial, sem caractere que o Windows recusa; repetido ganha " (2)".
  function caminhoSeguro(caminho, usados) {
    // eslint-disable-next-line no-control-regex -- caracteres de controle são exatamente o que precisa sair do nome
    const partes = String(caminho || "").split("/").map((p) => p.replace(/[\\:*?"<>|\u0000-\u001f]/g, "-").replace(/^\.+$/, "").trim().slice(0, 80)).filter(Boolean);
    let nome = partes.join("/") || "arquivo";
    if (usados) {
      const base = nome.replace(/(\.[A-Za-z0-9]{1,5})?$/, ""), ext = nome.slice(base.length);
      for (let i = 2; usados.has(nome.toLowerCase()); i++) nome = `${base} (${i})${ext}`;
      usados.add(nome.toLowerCase());
    }
    return nome;
  }

  // arquivos: [{ nome, bytes: Uint8Array }] -> Uint8Array do .zip
  function montarZip(arquivos, agora = new Date()) {
    if (!Array.isArray(arquivos) || !arquivos.length) throw new Error("Nenhum arquivo para o .zip.");
    if (arquivos.length > MAX_ARQUIVOS) throw new Error(`No máximo ${MAX_ARQUIVOS} arquivos por .zip.`);
    const total = arquivos.reduce((s, a) => s + a.bytes.length, 0);
    if (total > MAX_BYTES) throw new Error("Os arquivos passam de 100 MB juntos. Escolha menos documentos.");
    const enc = new TextEncoder();
    const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
    const dia = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
    const usados = new Set();
    const locais = [], centrais = [];
    let offset = 0;
    for (const a of arquivos) {
      const nome = enc.encode(caminhoSeguro(a.nome, usados));
      const crc = crc32(a.bytes), n = a.bytes.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 no nome
      local.setUint16(8, 0, true); local.setUint16(10, hora, true); local.setUint16(12, dia, true);
      local.setUint32(14, crc, true); local.setUint32(18, n, true); local.setUint32(22, n, true);
      local.setUint16(26, nome.length, true); local.setUint16(28, 0, true);
      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true);
      central.setUint16(10, 0, true); central.setUint16(12, hora, true); central.setUint16(14, dia, true);
      central.setUint32(16, crc, true); central.setUint32(20, n, true); central.setUint32(24, n, true);
      central.setUint16(28, nome.length, true); central.setUint32(42, offset, true);
      locais.push(new Uint8Array(local.buffer), nome, a.bytes);
      centrais.push(new Uint8Array(central.buffer), nome);
      offset += 30 + nome.length + n;
    }
    const tamanhoCentral = centrais.reduce((s, p) => s + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamanhoCentral, true); fim.setUint32(16, offset, true);
    const partes = [...locais, ...centrais, new Uint8Array(fim.buffer)];
    const saida = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    for (const p of partes) { saida.set(p, pos); pos += p.length; }
    return saida;
  }

  const api = { montarZip, caminhoSeguro, crc32, MAX_ARQUIVOS };
  global.LicitaZip = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
