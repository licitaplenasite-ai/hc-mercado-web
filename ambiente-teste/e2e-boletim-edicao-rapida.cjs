/* global window -- usado só dentro de p.evaluate (roda no navegador) */
// E2E 23/11: o link "Acessar o boletim" tem de abrir a edição na hora, no computador (1280) e no celular (375).
// Põe 200 mil oportunidades fictícias no banco LOCAL (tamanho parecido com produção) e mede, já logado:
//   antes  = busca antiga por numero_controle_pncp (sem índice)
//   depois = busca nova pela chave primária (o que painel.html faz agora)
// e o tempo do link até os cartões aparecerem. Tudo o que cria é apagado no fim.
//   PORTA_TESTE=8795 node ambiente-teste/servidor.cjs
//   PORTA_TESTE=8795 PRINTS=<pasta> node ambiente-teste/e2e-boletim-edicao-rapida.cjs
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const FICTICIAS = 200000;
async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=minimal', ...extra } });
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${(await r.text()).slice(0, 300)}`);
}
// psql no contêiner do Supabase local (subir.cjs); nunca o projeto de produção.
function psqlLocal(sql) {
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_licitaplena-teste', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}
const dia = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

async function main() {
  const u = seed.usuarios.gestor;
  const numeros = Array.from({ length: 3 }, (_, i) => `99999999000199-1-00095${i}/2026`);
  psqlLocal(`insert into public.oportunidades_abertas (chave, numero_controle_pncp, objeto, uf, publicacao, encerramento, dado)
    select 'BENCH-' || g, 'BENCH-' || g, 'filler', 'SP', current_date, current_date + 30,
      jsonb_build_object('objeto', repeat('aquisicao de material de consumo ', 30), 'orgao', 'Orgao ficticio de carga')
    from generate_series(1, ${FICTICIAS}) g on conflict do nothing; analyze public.oportunidades_abertas;`);
  const navegador = await chromium.launch({ channel: 'msedge' });
  try {
    await servico('POST', '/rest/v1/oportunidades_abertas?on_conflict=chave', numeros.map((n, i) => ({
      chave: n, numero_controle_pncp: n, objeto: `Aquisição fictícia de papel A4 ${i + 1}`, uf: 'AM', publicacao: dia(0), encerramento: dia(-15),
      dado: { numeroControlePNCP: n, objeto: `Aquisição fictícia de papel A4 ${i + 1} (teste do boletim)`, orgao: 'Prefeitura Fictícia de Teste', uf: 'AM',
        municipio: 'Manaus', publicacao: dia(0), encerramento: dia(-15), modalidade: 'Pregão Eletrônico', valorEstimado: 15000 * (i + 1) },
    })), { Prefer: 'resolution=merge-duplicates,return=minimal' });
    await servico('POST', '/rest/v1/boletim_edicoes?on_conflict=cliente_id,edicao,filtro_id', [
      { cliente_id: u.id, edicao: dia(0), filtro_id: 'principal', filtro_nome: 'papel, sulfite', empresa: 'Empresa Fictícia de Teste', quantidade: 3, numeros },
    ], { Prefer: 'resolution=merge-duplicates,return=minimal' });

    for (const [rotulo, viewport] of [['computador', { width: 1280, height: 900 }], ['celular', { width: 375, height: 812 }]]) {
      const p = await novaPagina(navegador, u);
      await p.setViewportSize(viewport);
      await passo(`${rotulo}: link do e-mail abre a edição na hora`, p, async () => {
        const inicio = Date.now();
        await p.goto(`${SITE}/painel.html?edicao=${dia(0)}&filtro=principal#boletim`);
        await p.waitForSelector('#bol-resultado .boletim-card', { timeout: 30000 });
        const total = Date.now() - inicio;
        const cards = await p.locator('#bol-resultado .boletim-card').count();
        exigir(cards === 3, `esperava 3 licitações, vieram ${cards}`);
        exigir(/Edição de/.test(await p.innerText('#bol-meta')), 'não abriu em modo edição');
        // Só a consulta da edição, logado, as duas formas (mesmo navegador, mesma sessão).
        const ms = await p.evaluate(async (lista) => {
          const medir = async (coluna) => {
            const t = performance.now();
            const { data, error } = await window.__sbClient.from('oportunidades_abertas').select('dado').in(coluna, lista);
            return { ms: Math.round(performance.now() - t), linhas: (data || []).length, erro: error && error.message };
          };
          await medir('chave');
          return { antes: await medir('numero_controle_pncp'), depois: await medir('chave') };
        }, numeros);
        exigir(ms.depois.linhas === 3 && !ms.depois.erro, 'consulta nova falhou: ' + JSON.stringify(ms.depois));
        exigir(ms.depois.ms < 1000, 'consulta nova lenta: ' + ms.depois.ms + ' ms');
        return `página até os cartões: ${total} ms · consulta antes (numero_controle_pncp): ${ms.antes.ms} ms${ms.antes.erro ? ' ERRO ' + ms.antes.erro : ''} · depois (chave): ${ms.depois.ms} ms`;
      });
      await p.screenshot({ path: path.join(PRINTS, `painel-edicao-${rotulo}.png`), fullPage: false });
      await p.close();
    }
  } finally {
    await servico('DELETE', `/rest/v1/boletim_edicoes?cliente_id=eq.${u.id}&numeros=cs.{${numeros[0]}}`).catch(() => null);
    await servico('DELETE', `/rest/v1/oportunidades_abertas?chave=in.(${numeros.map((n) => '"' + n + '"').join(',')})`).catch(() => null);
    psqlLocal("delete from public.oportunidades_abertas where chave like 'BENCH-%';");
    await navegador.close();
  }
  process.exitCode = resultados.some((r) => !r.ok) ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
