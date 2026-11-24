# -*- coding: utf-8 -*-
# Cobranca diaria do LicitaPlena (.github/workflows/cobranca-diaria.yml, 08:00 de Brasilia).
# Chama public.cobranca_rodar_diario() (supabase/planos_e_recursos.sql, secao 10): o banco marca como "vencida" quem
# passou da carencia (so boletim, nada apagado) e devolve quem recebe lembrete hoje. Aqui so sai o e-mail:
#   - 3 dias antes do vencimento, no dia do vencimento e quando a conta e bloqueada.
# Envio pelo mesmo caminho dos lembretes de licitacao (ZeptoMail; sem o token, Gmail SMTP), remetente financeiro@licitaplena.com.br.
# Uso: python scripts/cobranca_diaria.py. Env: SUPABASE_SERVICE_ROLE_KEY (obrigatoria), ZEPTOMAIL_TOKEN ou EMAIL_REMETENTE +
# EMAIL_SENHA_APP, SITE_URL (padrao https://licitaplena.com.br), SUPABASE_URL (padrao producao).
# Local/teste: COBRANCA_SO_REGISTRAR=1 nao envia e-mail, so registra no log (o bloqueio no banco acontece igual).
import os
import html

from lembretes_licitacoes import (SITE_URL, _requisicao_supabase, enviar_mensagem, log, REMETENTE_FINANCEIRO, NOME_FINANCEIRO,
                                  moldura_email, email_paragrafo, email_destaque, email_botao)

TITULOS = {
    "vence_em_3_dias": "Sua assinatura vence em 3 dias",
    "vence_hoje": "Sua assinatura vence hoje",
    "bloqueado": "Seu acesso foi pausado",
}
ASSUNTOS = {
    "vence_em_3_dias": "Sua assinatura do LicitaPlena vence em 3 dias",
    "vence_hoje": "Sua assinatura do LicitaPlena vence hoje",
    "bloqueado": "Seu acesso ao LicitaPlena foi pausado",
}


def reais(centavos):
    v = f"{(centavos or 0) / 100:,.2f}"
    return "R$ " + v.replace(",", "X").replace(".", ",").replace("X", ".")


def data_br(iso):
    a, m, d = str(iso)[:10].split("-")
    return d + "/" + m + "/" + a


def montar_mensagem(item):
    tipo = item["tipo"]
    nome = (item.get("nome") or "cliente").split(" ")[0]
    plano = item.get("plano_nome") or "seu plano"
    valor, vence = reais(item.get("valor_centavos")), data_br(item["vence_em"])
    link = SITE_URL.rstrip("/") + "/assinar.html"
    if tipo == "vence_em_3_dias":
        corpo = f"Sua assinatura do plano {plano} ({valor}) vence em {vence}. Para renovar, pague pelo Pix na tela de planos."
    elif tipo == "vence_hoje":
        carencia = data_br(item["carencia_ate"]) if item.get("carencia_ate") else vence
        corpo = (f"Sua assinatura do plano {plano} ({valor}) vence hoje, {vence}. Você continua usando tudo até {carencia}; "
                 "renove pelo Pix na tela de planos para não perder o acesso.")
    else:
        corpo = (f"A assinatura do plano {plano} venceu em {vence} e não foi renovada. Você continua recebendo o boletim por "
                 "e-mail e tudo o que salvou continua guardado. Renove pelo Pix para voltar a usar tudo.")
    texto = f"Olá, {nome}!\n\n{corpo}\n\nRenovar: {link}\n\nJá pagou? Desconsidere este e-mail.\n\nEquipe LicitaPlena"
    corpo_html = (email_paragrafo(f"Olá, {html.escape(nome)}!") + email_paragrafo(html.escape(corpo))
                  + email_destaque(f"<strong>Plano {html.escape(plano)}</strong> · {html.escape(valor)}<br>Vencimento: <strong>{vence}</strong>")
                  + email_botao(link, "Renovar a assinatura") + email_paragrafo("Já pagou? Desconsidere este e-mail.")
                  + email_paragrafo("Equipe LicitaPlena"))
    html_corpo = moldura_email("Assinatura", TITULOS[tipo], corpo_html,
                               "Você recebe este aviso porque tem uma assinatura do LicitaPlena.")
    return ASSUNTOS[tipo], texto, html_corpo


def main():
    log("=== Cobrança diária ===")
    so_registrar = os.environ.get("COBRANCA_SO_REGISTRAR") == "1"
    r = _requisicao_supabase("/rest/v1/rpc/cobranca_rodar_diario", "POST", {}) or {}
    itens = list(r.get("lembretes") or []) + list(r.get("bloqueados") or [])
    log(f"Carência {r.get('carencia_dias')} dia(s): {len(r.get('bloqueados') or [])} bloqueada(s), {len(r.get('lembretes') or [])} lembrete(s).")
    enviados = 0
    for item in itens:
        email = item.get("email")
        if not email:
            continue
        assunto, texto, html_corpo = montar_mensagem(item)
        if so_registrar:
            log("[SO REGISTRAR] enviaria '" + assunto + "' para " + email)
            continue
        try:
            enviar_mensagem(email, item.get("nome") or "Cliente", assunto, texto, html_corpo, REMETENTE_FINANCEIRO, NOME_FINANCEIRO)
            enviados += 1
        except Exception as e:  # um e-mail com erro não impede os outros; o bloqueio já foi gravado
            log("ERRO ao enviar cobrança para " + email + ": " + str(e))
    log(f"=== Concluído: {enviados} e-mail(s) enviado(s) ===")


if __name__ == "__main__":
    main()
