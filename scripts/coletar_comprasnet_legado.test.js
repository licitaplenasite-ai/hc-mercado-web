// Cursor do ComprasNet Legado: só vai pro Supabase depois do push (23/11/2026: push falhou por token vencido e o
// cursor já tinha avançado, abrindo buraco no histórico).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const robo = require("./coletar_comprasnet_legado");

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), "comprasnet-"));

test("salvarCursor com arquivo pendente não toca no Supabase; sem arquivo grava direto (rodada local)", async () => {
  const gravados = [];
  const salvar = async (...a) => { gravados.push(a); };
  const arquivo = path.join(pasta(), "cursor.json");
  const cursor = { anoAtual: 2017, paginaAtual: 42, anosCompletos: [2015, 2016] };
  await robo.salvarCursor(cursor, arquivo, salvar);
  assert.equal(gravados.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(arquivo, "utf8")), cursor);
  await robo.salvarCursor(cursor, "", salvar);
  assert.deepEqual(gravados, [["dados_robo", "comprasnet_progresso", cursor]]);
});

test("confirmarCursor: grava o pendente; sem arquivo não faz nada; cursor quebrado falha sem gravar", async () => {
  const gravados = [];
  const salvar = async (...a) => { gravados.push(a); };
  const dir = pasta();
  assert.equal(await robo.confirmarCursor(path.join(dir, "nao-existe.json"), salvar), null);
  const ok = path.join(dir, "ok.json");
  fs.writeFileSync(ok, JSON.stringify({ anoAtual: 2018, paginaAtual: 1, anosCompletos: [2015, 2016, 2017] }));
  assert.equal((await robo.confirmarCursor(ok, salvar)).anoAtual, 2018);
  const ruim = path.join(dir, "ruim.json");
  fs.writeFileSync(ruim, JSON.stringify({ anoAtual: "2018" }));
  await assert.rejects(robo.confirmarCursor(ruim, salvar), /Cursor pendente inválido/);
  assert.equal(gravados.length, 1);
});
