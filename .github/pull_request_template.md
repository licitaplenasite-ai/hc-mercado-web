## O que muda

## Checklist de segurança (SECURITY.md)

- [ ] `npm run verify` passou
- [ ] Varredura de segurança sem aviso novo
- [ ] Sem chave/senha no código
- [ ] Função paga ou de envio: `exigirUsuarioAprovado` + limite diário + CORS restrito
- [ ] Tabela/coluna nova com dado de cliente: RLS por organização + cadastro aprovado + teste de acesso negado
- [ ] Upload com tipo e tamanho limitados
- [ ] Dado externo na tela via `textContent`
