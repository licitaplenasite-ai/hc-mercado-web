// Web Push (aviso no celular) só com node:crypto: criptografia aes128gcm (RFC 8291) e assinatura VAPID (RFC 8292).
// Por quê sem a biblioteca web-push: são ~60 linhas de padrão aberto e o robô roda sem npm ci (GitHub Actions).
// Chaves no formato padrão VAPID (base64url): pública = ponto P-256 sem compressão (65 bytes), privada = d (32 bytes).
// Geradas por scripts/gerar_chaves_vapid.js, fora do repositório.
const crypto = require("node:crypto");

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const deB64u = (txt) => Buffer.from(String(txt || ""), "base64url");

function chavePrivadaObj(publica, privada) {
  const pub = deB64u(publica);
  if (pub.length !== 65 || pub[0] !== 4 || deB64u(privada).length !== 32) throw new Error("Chaves VAPID inválidas.");
  return crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: privada, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
}

// JWT ES256 (assinatura crua r||s, como o JWT exige). aud = origem do serviço de push; vale 12 h.
function cabecalhoVapid(endpoint, { publica, privada, contato }, agora = Date.now()) {
  const corpo = `${b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(agora / 1000) + 12 * 3600, sub: contato }))}`;
  const assinatura = crypto.sign("sha256", Buffer.from(corpo), { key: chavePrivadaObj(publica, privada), dsaEncoding: "ieee-p1363" });
  return `vapid t=${corpo}.${b64u(assinatura)}, k=${publica}`;
}

// Corpo cifrado para a inscrição do aparelho (p256dh + auth). Um registro só (aviso cabe em < 4 KB).
function cifrar(texto, { p256dh, auth }) {
  const uaPublica = deB64u(p256dh);
  const segredoAuth = deB64u(auth);
  if (uaPublica.length !== 65 || segredoAuth.length !== 16) throw new Error("Inscrição inválida.");
  const efemera = crypto.createECDH("prime256v1");
  const asPublica = efemera.generateKeys();
  const ecdh = efemera.computeSecret(uaPublica);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdh, segredoAuth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublica, asPublica]), 32));
  const sal = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cifra = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const cifrado = Buffer.concat([cifra.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([65]), asPublica, cifrado]);
}

// Envia um aviso. Devolve o status HTTP: 201/200 entregue ao serviço; 404/410 = inscrição morta (apagar).
async function enviarPush(inscricao, dados, vapid, { ttl = 86400, urgencia = "normal" } = {}) {
  const r = await fetch(inscricao.endpoint, {
    method: "POST",
    signal: globalThis.AbortSignal.timeout(15000),
    headers: { TTL: String(ttl), Urgency: urgencia, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
      Authorization: cabecalhoVapid(inscricao.endpoint, vapid) },
    body: cifrar(JSON.stringify(dados), inscricao),
  });
  return r.status;
}

function gerarChaves() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publica: b64u(ecdh.getPublicKey()), privada: b64u(ecdh.getPrivateKey()) };
}

module.exports = { cifrar, cabecalhoVapid, enviarPush, gerarChaves };
