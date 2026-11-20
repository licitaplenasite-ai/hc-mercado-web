# Segurança do LicitaPlena

O LicitaPlena guarda dados de clientes (empresas, processos, documentos, CPF do representante). Este arquivo
diz como reportar uma falha e o que toda mudança precisa cumprir antes de ir ao ar.

## Reportar uma falha

Não abra issue pública. Mande e-mail para o responsável pelo LicitaPlena (contato da página
`politica-privacidade.html`) com o passo a passo, sem dados reais de clientes. Resposta em até 5 dias úteis.

## Varredura automática (GitHub Actions)

`.github/workflows/seguranca.yml` roda a cada push, em todo PR e toda segunda-feira:

| Job | Ferramenta | O que procura |
| --- | --- | --- |
| Segredos | gitleaks (histórico inteiro, valor sempre mascarado) | chave, token ou senha commitados |
| Código | Semgrep (regras públicas JavaScript, Node, OWASP Top 10, segredos) | injeção, XSS, SSRF, uso inseguro de crypto etc. |
| Dependências | `npm audit` | pacote com vulnerabilidade conhecida |

`.github/dependabot.yml` abre PR semanal de atualização (npm e GitHub Actions). Merge é sempre manual.

**Fase 1 (agora): só avisa.** Os jobs têm `continue-on-error: true` e não travam a publicação.
**Fase 2 (quando a fila de avisos zerar):** apagar o `continue-on-error` de cada job e, em
Settings > Branches > main, marcar os três checks como obrigatórios.

Falso positivo do gitleaks: adicionar regra em `.gitleaks.toml` com o motivo. Do Semgrep: comentário
`// nosemgrep: <id-da-regra> -- <motivo>` na linha. Nunca silenciar sem motivo escrito.

## Portão de qualidade: checklist de toda mudança

Antes do merge na `main`, quem revisa confere:

- [ ] `npm run verify` passou (testes + lint).
- [ ] Varredura de segurança sem aviso novo (aba Actions).
- [ ] Nenhuma chave no código. Segredo só em variável de ambiente (Cloudflare/GitHub Secrets) ou `*.local.json` ignorado.
- [ ] Toda função que custa dinheiro, envia e-mail ou lê dado pago usa `exigirUsuarioAprovado` + `verificarLimiteDiario`
      (`netlify/functions/_auth.js`) e CORS por `origemPermitida()`, nunca `*`.
- [ ] Tabela nova com dado de cliente: RLS ligada, policy por organização/empresa e exige cadastro aprovado
      (`public.cliente_aprovado()`); teste em `supabase/testar_*.sql` provando acesso negado para outra org.
- [ ] Coluna sensível (CPF, dados bancários) não sai pelo PostgREST sem máscara.
- [ ] Upload: tipo e tamanho limitados no servidor e no bucket.
- [ ] HTML vindo de usuário ou de API externa entra na tela por `textContent`, não `innerHTML`.
- [ ] Mudança em login, permissão, RLS ou função paga: teste de ataque no ambiente local (`ambiente-teste/`),
      nunca contra produção ou site de terceiros.

## Testes de ataque

Só no ambiente local (`ambiente-teste/`: Supabase em Docker + `node ambiente-teste/servidor.cjs`). Relatórios
ficam fora do repositório, em `_historico/seguranca/`. Produção (`licitaplena.com.br`, `*.supabase.co`) e
domínios de terceiros nunca são alvo de varredura ou ataque.
