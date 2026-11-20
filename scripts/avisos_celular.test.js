const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { cifrar, cabecalhoVapid, gerarChaves } = require("./web_push");
const av = require("./avisos_celular");
const { validarInscricao, validarPreferencias } = require("../netlify/functions/avisos-celular");

// Decifra como o navegador (RFC 8291), para provar que o corpo enviado é legível só pelo aparelho.
function decifrar(corpo, uaEcdh, auth) {
  const sal = corpo.subarray(0, 16), idlen = corpo[20], asPublica = corpo.subarray(21, 21 + idlen), cifrado = corpo.subarray(21 + idlen);
  const uaPublica = uaEcdh.getPublicKey();
  const ikm = Buffer.from(crypto.hkdfSync("sha256", uaEcdh.computeSecret(asPublica), auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublica, asPublica]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cifrado.subarray(-16));
  const claro = Buffer.concat([d.update(cifrado.subarray(0, -16)), d.final()]);
  assert.equal(claro.at(-1), 2);
  return claro.subarray(0, -1).toString();
}

test("cifrar: o aparelho decifra o aviso e outro aparelho não", () => {
  const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const insc = { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
  const corpo = cifrar('{"titulo":"Olá"}', insc);
  assert.equal(corpo.readUInt32BE(16), 4096);
  assert.equal(decifrar(corpo, ua, auth), '{"titulo":"Olá"}');
  const outro = crypto.createECDH("prime256v1"); outro.generateKeys();
  assert.throws(() => decifrar(corpo, outro, auth));
  assert.throws(() => cifrar("x", { p256dh: "curto", auth: insc.auth }), /Inscrição inválida/);
});

test("VAPID: JWT ES256 assinado com a chave privada, aud = origem do serviço", () => {
  const { publica, privada } = gerarChaves();
  const h = cabecalhoVapid("https://fcm.googleapis.com/fcm/send/abc", { publica, privada, contato: "mailto:x@y.z" }, 1_700_000_000_000);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.equal(k, publica);
  const [cab, carga, ass] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(carga, "base64url")), { aud: "https://fcm.googleapis.com", exp: 1_700_000_000 + 43200, sub: "mailto:x@y.z" });
  const pub = Buffer.from(publica, "base64url");
  const chave = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") } });
  assert.ok(crypto.verify("sha256", Buffer.from(`${cab}.${carga}`), { key: chave, dsaEncoding: "ieee-p1363" }, Buffer.from(ass, "base64url")));
  assert.throws(() => cabecalhoVapid("https://x.y/", { publica: "x", privada, contato: "" }), /VAPID inválidas/);
});

test("rota: só aceita endpoint de serviço de push conhecido (sem SSRF) e chaves no formato", () => {
  const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
  assert.ok(validarInscricao({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }));
  assert.ok(validarInscricao({ endpoint: "https://wns2-par02p.notify.windows.com/w/?token=x", keys }));
  assert.ok(validarInscricao({ endpoint: "https://web.push.apple.com/abc", keys }));
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://evil.com/x", "https://fcm.googleapis.com.evil.com/x", "https://127.0.0.1/x",
    "https://u:p@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://a.b.notify.windows.com/x"]) {
    assert.equal(validarInscricao({ endpoint, keys }), null, endpoint);
  }
  assert.equal(validarInscricao({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, auth: "a b" } }), null);
  assert.equal(validarInscricao(null), null);
  // Tela antiga sem "boletim": fica ligado; com o campo, vale o que veio.
  assert.deepEqual(validarPreferencias({ edital: true, prazo: false, pregoeiro: true, certidao: false, extra: 1 }), { edital: true, prazo: false, pregoeiro: true, certidao: false, boletim: true });
  assert.equal(validarPreferencias({ edital: true, prazo: true, pregoeiro: true, certidao: true, boletim: false }).boletim, false);
  assert.equal(validarPreferencias({ edital: true, prazo: true, pregoeiro: true, certidao: true, boletim: "nao" }), null);
  assert.equal(validarPreferencias({ edital: "sim", prazo: true, pregoeiro: true, certidao: true }), null);
  assert.equal(validarPreferencias({ edital: true }), null);
});

test("lembrete: mesmo momento do e-mail (dia do prazo em Brasília - dias_antes, na hora escolhida)", () => {
  // Prazo 20/11 às 01:00 UTC = 19/11 22:00 em Brasília; 1 dia antes às 8h = 18/11 08:00 Brasília = 11:00 UTC.
  const l = { id: "l1", cliente_id: "u1", objeto_resumo: "Papel A4", data_final_proposta: "2026-11-20T01:00:00Z", dias_antes: 1, hora_aviso: 8 };
  assert.equal(new Date(av.momentoDoLembrete(l)).toISOString(), "2026-11-18T11:00:00.000Z");
  assert.equal(av.avisosDeLembretes([l], Date.parse("2026-11-18T10:59:00Z")).length, 0, "antes da hora");
  const [a] = av.avisosDeLembretes([l], Date.parse("2026-11-18T12:00:00Z"));
  assert.equal(a.tipo, "prazo");
  assert.match(a.corpo, /19\/11\/2026 às 22:00/);
  assert.equal(av.avisosDeLembretes([l], Date.parse("2026-11-20T02:00:00Z")).length, 0, "prazo vencido");
  assert.equal(av.momentoDoLembrete({ data_final_proposta: null }), null);
});

test("mudanças: chat vira aviso do pregoeiro, o resto aviso do edital; sem dono do processo não avisa", () => {
  const proc = { objeto: "Café", criado_por: "u1" };
  const avisos = av.avisosDeMudancas([
    { id: 1, processo_id: "p", empresa_id: "e", tipo: "chat", resumo: "Sessão suspensa", operacao_processos: proc },
    { id: 2, processo_id: "p", empresa_id: "e", tipo: "data", resumo: "Prazo mudou", operacao_processos: proc },
    { id: 3, processo_id: "p", empresa_id: "e", tipo: "data", resumo: "x", operacao_processos: { objeto: "y", criado_por: null } },
  ]);
  assert.deepEqual(avisos.map((a) => [a.tipo, a.chave]), [["pregoeiro", "mud:1"], ["edital", "mud:2"]]);
  assert.match(avisos[0].url, /\/sistema\?empresa=e&processo=p$/);
});

test("certidão: avisa gestor da organização e operador só da própria empresa", () => {
  const docs = [{ id: "d", organizacao_id: "o", empresa_id: "e1", tipo: "CND", titulo: null, vencimento: "2026-11-25", operacao_empresas: { razao_social: "ACME" } }];
  const membros = [{ organizacao_id: "o", usuario_id: "g", empresa_id: null }, { organizacao_id: "o", usuario_id: "op1", empresa_id: "e1" },
    { organizacao_id: "o", usuario_id: "op2", empresa_id: "e2" }, { organizacao_id: "x", usuario_id: "fora", empresa_id: null }];
  const avisos = av.avisosDeCertidoes(docs, membros);
  assert.deepEqual(avisos.map((a) => a.usuario), ["g", "op1"]);
  assert.match(avisos[0].corpo, /CND de ACME vence em 25\/11\/2026/);
});

test("preferências: tipo desligado não envia; sem preferência gravada envia tudo", () => {
  const avisos = [{ usuario: "u1", tipo: "certidao" }, { usuario: "u1", tipo: "edital" }, { usuario: "u2", tipo: "certidao" }];
  const r = av.filtrarPorPreferencia(avisos, [{ usuario_id: "u1", edital: true, prazo: true, pregoeiro: true, certidao: false }]);
  assert.deepEqual(r, [{ usuario: "u1", tipo: "edital" }, { usuario: "u2", tipo: "certidao" }]);
});

test("boletim: um aviso por rodada com oportunidade; sem oportunidade ou sem cliente não avisa", () => {
  const avisos = av.avisosDeBoletim([
    { cliente_id: "u1", quantidade_editais: 3, executado_em: "2026-11-20T10:05:00Z" },
    { cliente_id: "u1", quantidade_editais: 1, executado_em: "2026-11-20T16:05:00Z" },
    { cliente_id: "u2", quantidade_editais: 0, executado_em: "2026-11-20T10:05:00Z" },
    { cliente_id: null, quantidade_editais: 5, executado_em: "2026-11-20T10:05:00Z" },
  ]);
  assert.deepEqual(avisos.map((a) => [a.usuario, a.tipo, a.chave]), [["u1", "boletim", "bol:2026-11-20T10:05:00Z"], ["u1", "boletim", "bol:2026-11-20T16:05:00Z"]]);
  assert.match(avisos[0].corpo, /3 licitações no seu filtro/);
  assert.match(avisos[1].corpo, /1 licitação no seu filtro/);
  assert.match(avisos[0].url, /painel\.html#boletim$/);
  assert.deepEqual(av.filtrarPorPreferencia(avisos, [{ usuario_id: "u1", boletim: false }]), []);
});
