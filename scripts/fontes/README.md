# Fontes fora do PNCP

Órgãos que publicam licitação só no próprio site, em portal próprio ou em diário oficial, e não no PNCP. Cada
portal é um **adaptador** nesta pasta; três robôs rodam os adaptadores e gravam o resultado onde o painel e o
boletim já leem (`oportunidades_abertas`, chave `fonte:<id>:...`).

## Adaptadores atuais

| Arquivo | `FONTE.id` (prefixo da chave) | O que lê | Robô |
|---|---|---|---|
| `aadc.js` | `aadc` | AADC — Agência Amazonense de Desenvolvimento Cultural (portal SISTP) | `coletar_fontes_extras.js` |
| `faepi.js` | `faepi` | FAEPI — Fundação de Apoio do IFAM (editais) | `coletar_fontes_extras.js` |
| `faepi_cotacoes.js` | `faepi_cotacoes` | FAEPI — processos de compra no Conveniar | `coletar_fontes_extras.js` |
| `bll.js` | `bll` | BLL Compras — processos do AM fora do PNCP | `coletar_fontes_extras.js` |
| `sebrae.js` | `sebrae` | SEBRAE — Canal do Fornecedor (todas as UFs) | `coletar_fontes_extras.js` |
| `diario_aam.js` | `diario-aam` | Diário Oficial dos Municípios do Amazonas (AAM) | `coletar_diarios_am.js` |
| `doe_am.js` | `diario-doe-am` | Diário Oficial do Estado do Amazonas (Imprensa Oficial) | `coletar_diarios_am.js` |
| `dom_manaus.js` | `diario-dom-manaus` | Diário Oficial do Município de Manaus (DOM) | `coletar_diarios_am.js` |
| `dou.js` | `dou` | Diário Oficial da União — Seção 3 (INLABS) | `coletar_diarios_oficiais.js` |
| `querido_diario.js` | `qd` | Diários municipais do Querido Diário (Open Knowledge Brasil) | `coletar_diarios_oficiais.js` |

Apoio (não são adaptadores): `comum.js` (cliente HTTP, PDF, `paraLinha`), `diario_extracao.js`, `avisos_texto.js`,
`html_texto.js` (extração de avisos dos diários).

## Robôs e workflows

| Robô | Workflow (cron UTC) | Adaptadores | Situação da rodada |
|---|---|---|---|
| `scripts/coletar_fontes_extras.js` | `coletar-fontes-extras.yml` (`37 3,9,15,20 * * *`) | portais: `aadc`, `faepi`, `faepi_cotacoes`, `bll`, `sebrae` | `dados_robo` `fontes_extras_status` |
| `scripts/coletar_diarios_am.js` | `coletar-diarios-am.yml` (`23 9,14 * * *`) | `diario-aam`, `diario-dom-manaus`, `diario-doe-am` | ver cabeçalho do robô (`diarios_am_lidos`, `diarios_am_revisao`) |
| `scripts/coletar_diarios_oficiais.js` | `coletar-diarios-oficiais.yml` (`41 9 * * *`) | `dou`, `qd` | ver cabeçalho do robô (`diarios_visto_primeiro`) |

O contrato abaixo (`listar`/`detalhe`/`anexos`) é o dos portais (`coletar_fontes_extras.js`). Os diários seguem o
cabeçalho dos próprios robôs, mas gravam no mesmo formato (`comum.paraLinha`).

## Fluxo

```
adaptador.listar()  ->  itens normalizados (1 por processo, com "aberto")
adaptador.detalhe() ->  só para item novo ou com publicação nova (dado.versao mudou): lê o PDF/página do aviso
comum.paraLinha()   ->  linha de public.oportunidades_abertas
```

- Chave da linha: `fonte:<id>:<idExterno>` (ex.: `fonte:aadc:PP-014/2026`). A mesma chave vai em
  `dado.numeroControlePNCP`, porque o painel abre a edição do boletim por ela; `numero_controle_pncp`
  (coluna) fica nulo.
- `dado` segue o formato do robô do PNCP (`objeto`, `orgao`, `uf`, `municipio`, `publicacao`,
  `encerramento`, `modalidadeNome`, `link`...) mais `fonte: "Portal do órgão, fora do PNCP"`, que o painel
  mostra como selo, com o rótulo "Abertura" e o botão "Ver edital completo (...)".
- Onde aparece: "Encontrar licitações" e as edições do boletim no painel (leem `oportunidades_abertas`), e o
  boletim por e-mail, os jornais e o aviso no celular (`scripts/boletim_editais.py`, `somar_fontes_fora_pncp`,
  pega as chaves `fonte:*` publicadas nos últimos 7 dias nas UFs dos clientes, paginando por chave de 1.000 em
  1.000; falha só registra no log e o boletim do PNCP segue).
- Duplicata: se o mesmo órgão (CNPJ) publicar o processo no PNCP (mesma família de modalidade, número e
  ano), a linha da fonte sai e fica só a do PNCP.
- Encerrado: processo cuja publicação mais nova é resultado (homologação, resultado, recurso...) sai da
  tabela. Retenção: `RETENCAO_DIAS` (120) pela data de publicação, só das linhas da fonte.
- Não precisa de SQL novo: a tabela já existe (`supabase/schema_oportunidades.sql`).

## Contrato do adaptador

Um módulo CommonJS em `scripts/fontes/<id>.js` que exporta:

| Nome | O que é |
|---|---|
| `FONTE` | `{ id, nome, portal, paginaOficial }`. `id` curto e estável (vira parte da chave). `portal` aparece no selo "Portal: ..." do cartão. |
| `ORGAO` | `{ nome, cnpj, uf, municipio }` quando a fonte é de um órgão só. `cnpj` (só dígitos) liga a deduplicação contra o PNCP. Fonte com vários órgãos (diário oficial, portal agregador) põe o órgão em cada item e deixa `ORGAO` sem `cnpj`. |
| `listar(ctx)` | `Promise<Item[]>`. Lê a listagem do portal desde `ctx.desdeIso` (AAAA-MM-DD), agrupa por processo e devolve itens normalizados. Lança erro com mensagem clara se a estrutura do portal mudou: o robô marca a fonte como falha e a rodada fica vermelha. |
| `detalhe(item, ctx)` | `Promise<Item>`. Completa o item (data da sessão, modalidade exata) lendo o aviso. Pode falhar: o robô segue com o item da listagem. Não muda `idExterno` nem `versao`. |
| `anexos(item)` | `Array<{ nome, url, publicadoEm }>`. Documentos públicos do processo. |

`ctx` = `{ cliente, textoDoPdf, desdeIso, tempoRestanteMs, maxPaginas }`:

- `cliente` (de `comum.criarCliente`): `texto(url)`, `json(url)`, `bytes(url)` (até 15 MB) e
  `postForm(url, campos, headers)`. Um pedido por vez, pelo menos 1 s entre pedidos, cookie de sessão
  guardado, nova tentativa com espera em 5xx/429/rede, User-Agent `LicitaPlenaBot/1.0` (sem dado pessoal).
  O adaptador nunca chama `fetch` direto.
- `textoDoPdf(bytes)`: texto do PDF, ou `""` se for imagem escaneada ou não abrir.
- `tempoRestanteMs()`: pare de paginar abaixo de ~20 s.

### Item normalizado

| Campo | Obrigatório | Observação |
|---|---|---|
| `idExterno` | sim | Estável por processo (`PP-014/2026`). Sem número no portal: `PUB-<id da publicação>`. |
| `aberto` | sim | `false` quando a publicação mais nova é resultado/encerramento. |
| `objeto` | sim | Sem o prefixo do número do processo. |
| `publicacao` | sim | `AAAA-MM-DDTHH:MM:SS`, hora de Brasília (mesmo formato do PNCP). É o que o boletim usa para "novidade". |
| `orgao` | sim | `{ nome, cnpj, uf, municipio }`. |
| `encerramento` | não | Data da sessão ou fim do prazo de proposta, mesmo formato. `null` se o portal não informa. |
| `modalidade`, `processo`, `numero`, `ano`, `srp` | não | `numero` + `ano` + `modalidade` ligam a deduplicação. |
| `linkOficial` | sim | Página pública do processo/modalidade no portal (vira "Acessar local da disputa"). |
| `linkEdital` | não | Documento do aviso/edital (vira "Ver edital completo"). Só http(s) do próprio portal. |
| `versao` | sim | Muda quando sai publicação nova do processo (ex.: id da publicação mais recente). Controla a releitura do `detalhe`. |
| `anexos` | não | Ver `anexos(item)`. |
| `pdfSemTexto` | não | `true` quando o aviso é escaneado (sem data legível). |

## Como criar um adaptador novo

1. Conferir `robots.txt` e os termos do site; anotar no cabeçalho do arquivo a data, as URLs e o formato.
2. Salvar a listagem real em `scripts/fixtures/fontes/<id>/` (sem token, cookie, link assinado nem CPF).
3. Escrever `scripts/fontes/<id>.js` com as peças puras exportadas e `scripts/fontes/<id>.test.js` lendo a
   fixture (mais um teste `TESTE_AO_VIVO=1` opcional).
4. Registrar em `ADAPTADORES` no topo do robô (`scripts/coletar_fontes_extras.js` para portal) e na tabela "Adaptadores atuais" acima.
5. Conferir ao vivo sem gravar: `SIMULAR=1 FONTES=<id> node scripts/coletar_fontes_extras.js`.

## Operação

- Portais: `.github/workflows/coletar-fontes-extras.yml` (03:37, 09:37, 15:37 e 20:37 UTC, ~30 min antes do boletim).
  Rodar uma fonte só, à mão: Actions > "Coletar fontes fora do PNCP" > Run workflow > `fontes = aadc`.
- Diários: `coletar-diarios-am.yml` e `coletar-diarios-oficiais.yml` (horários na tabela acima).
- Situação da última rodada: `dados_robo`, chave `fontes_extras_status` (`{ em, fontes: { aadc: { ok, abertas, publicadas, erro } } }`).
