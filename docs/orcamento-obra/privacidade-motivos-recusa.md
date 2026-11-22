# "Ajudar a melhorar o Auditor": motivos de recusa (versão 2026-11-22)

Rascunho para a política de privacidade. **Desligado por padrão.** Só vale depois que o dono aprovar este texto,
publicar na `politica-privacidade.html` e ligar a coleta (`admin_ligar_motivos_recusa(true)`).

## Texto para a política de privacidade (seção nova)

> **Motivos de recusa em licitações de obra (opcional).** Se você usar a extensão do LicitaPlena para gravar um
> pregão ou concorrência do Compras.gov e tiver marcado "Ajudar a melhorar o Auditor", o texto **público** que o
> agente de contratação escreveu no chat sobre a recusa, desclassificação ou inabilitação de uma proposta é copiado,
> **sem dado pessoal**, para uma base usada para melhorar as regras do Auditor do Orçamento de obra.
>
> - **O que entra:** o texto do motivo, o tipo (recusa, desclassificação, inabilitação), o tipo de obra e a data.
> - **O que sai antes de gravar:** CNPJ, CPF, e-mail, telefone, links, o nome das empresas participantes e o nome de
>   pessoas citadas depois de "Sr.", "Sra.", "pregoeiro(a)" ou "agente de contratação".
> - **O que nunca entra:** quem gravou, a sua empresa, o fornecedor recusado, o número da compra.
> - **Base legal:** legítimo interesse (LGPD, art. 7º, IX) sobre dado já público (art. 7º, §4º), com a sua
>   manifestação expressa ao marcar a opção. A mensagem já é pública no Compras.gov.
> - **Você pode desmarcar a qualquer hora** na tela do Orçamento de obra. O que já foi copiado continua na base porque
>   não identifica ninguém.
> - Só o texto lido na **sua própria aba**, quando você mesmo abriu o pregão. A extensão não resolve captcha, não
>   navega sozinha e não lê o chat de quem não marcou a opção.

## Como funciona por dentro (para auditoria)

| Peça | Onde |
|---|---|
| Interruptor geral (nasce desligado) | `orcamento_motivos_config.ligado`; só o dono com 2 fatores muda (`admin_ligar_motivos_recusa`) |
| Aceite de cada pessoa, com a versão deste texto | `orcamento_motivos_consentimento` (cada um vê, dá e retira só o próprio; aceitar só com a coleta ligada) |
| Filtro no banco | `orcamento_motivos_para_coletar()`: só mensagens de quem aceitou e só com a coleta ligada; só o robô chama |
| Anonimização | `scripts/estudo_obras.js` → `anonimizarMotivo()` (testado em `estudo_obras.test.js`) |
| Trava final | `orcamento_motivos_recusa.motivo` recusa texto com CNPJ, CPF ou "@" (CHECK) |

**Limite conhecido:** nome de pessoa solto no meio do texto, sem "Sr." ou "pregoeiro" antes, não é reconhecido.
Antes de ligar, o dono deve olhar uma amostra dos primeiros motivos coletados.
