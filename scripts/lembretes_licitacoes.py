# -*- coding: utf-8 -*-
# Verifica lembretes de licitacao pendentes (tabela public.lembretes, ver painel.html)
# e manda e-mail quando chega o momento do aviso: (dia do prazo - dias_antes) na hora_aviso,
# horario de Brasilia. Roda de hora em hora (.github/workflows/lembretes-licitacoes.yml) e
# avisa tudo que ja passou do momento e ainda nao venceu, entao uma rodada perdida nao perde aviso.
# Envio: ZeptoMail (ZEPTOMAIL_TOKEN, o mesmo do site); sem o token cai no Gmail SMTP do boletim.
# Tambem envia o aviso "Mudou algo no edital?" (operacao_monitor_mudancas, gravadas por scripts/monitor_processos.js),
# um e-mail por processo para quem cadastrou o processo, com a mesma reserva antes de enviar.
# Local/teste: LEMBRETES_SO_REGISTRAR=1 nao envia nem marca nada, so registra no log;
# SUPABASE_URL aponta para o banco de teste (o padrao e producao).
import os
import re
import html
import json
import smtplib
import urllib.request
import urllib.parse
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from email.header import Header
from datetime import datetime, timedelta, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL") or "https://lsqjamqvmrcyrvowndiu.supabase.co"
ZEPTOMAIL_URL = "https://api.zeptomail.com/v1.1/email"
REMETENTE_ZEPTO = "licitaplena@licitaplena.com.br"
BRASILIA = timezone(timedelta(hours=-3))
NOME_REMETENTE = "LicitaPlena - Lembretes de Licitação"
SITE_URL = os.environ.get("SITE_URL") or "https://licitaplena.com.br"
ASSUNTO_LEMBRETE = "Lembrete: prazo de proposta se aproxima"
# Mudanca mais velha que isto sem e-mail (robo parado, banco novo): fecha sem enviar, como o lembrete expirado.
AVISO_MUDANCA_MAX_HORAS = 72
AVISO_ESCLARECIMENTO = ("Atenção: a resposta a um pedido de esclarecimento vira regra do edital. "
                        "Leia antes de montar a proposta e os documentos.")


def log(msg):
    print("[" + datetime.now().strftime("%d/%m/%Y %H:%M:%S") + "] " + msg, flush=True)


def _chave_servico():
    chave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not chave:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY nao configurada (Settings > Secrets and "
            "variables > Actions no repositorio do GitHub)."
        )
    return chave


def _requisicao_supabase(caminho, metodo="GET", corpo=None, headers_extra=None):
    chave = _chave_servico()
    headers = {
        "apikey": chave,
        "Authorization": "Bearer " + chave,
    }
    if headers_extra:
        headers.update(headers_extra)
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    if dados is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(SUPABASE_URL + caminho, data=dados, method=metodo, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        bruto = resp.read()
        return json.loads(bruto.decode("utf-8")) if bruto else None


def carregar_lembretes_pendentes():
    # Filtra so por enviado=false na query (o calculo de "vence hoje" - que depende de
    # dias_antes, um valor por linha - e feito aqui em Python, mais simples e legivel
    # que expressar aritmetica de data no querystring do PostgREST).
    return _requisicao_supabase(
        "/rest/v1/lembretes?enviado=eq.false"
        "&select=id,cliente_id,numero_controle_pncp,objeto_resumo,data_final_proposta,dias_antes,hora_aviso,nota"
    ) or []


def _prazo(lembrete):
    bruto = lembrete.get("data_final_proposta")
    if not bruto:
        return None
    try:
        prazo = datetime.fromisoformat(bruto.replace("Z", "+00:00"))
    except ValueError:
        return None
    return prazo if prazo.tzinfo else prazo.replace(tzinfo=timezone.utc)


def momento_do_aviso(lembrete):
    # Mesma conta de busca-avancada.js (momentoDoAviso): dia do prazo em Brasilia menos dias_antes, na hora escolhida.
    prazo = _prazo(lembrete)
    if prazo is None:
        return None
    dia = prazo.astimezone(BRASILIA).date() - timedelta(days=lembrete.get("dias_antes") or 0)
    hora = lembrete.get("hora_aviso")
    return datetime(dia.year, dia.month, dia.day, 8 if hora is None else hora, tzinfo=BRASILIA)


def situacao(lembrete, agora):
    # "aguardar" = ainda nao e a hora; "enviar" = passou da hora e o prazo nao venceu; "expirado" = prazo ja passou.
    aviso, prazo = momento_do_aviso(lembrete), _prazo(lembrete)
    if aviso is None:
        return "aguardar"
    if agora >= prazo:
        return "expirado"
    return "enviar" if agora >= aviso else "aguardar"


def buscar_cliente(cliente_id):
    linhas = _requisicao_supabase(
        "/rest/v1/clientes?id=eq." + urllib.parse.quote(cliente_id) + "&select=nome,empresa,email"
    )
    return linhas[0] if linhas else None


def montar_link_pncp(numero_controle_pncp):
    m = re.match(r"^(\d{14})-\d+-(\d+)/(\d{4})$", numero_controle_pncp or "")
    if m:
        cnpj, seq, ano = m.group(1), str(int(m.group(2))), m.group(3)
        return "https://pncp.gov.br/app/editais/" + cnpj + "/" + ano + "/" + seq
    return "https://pncp.gov.br"


def montar_corpo_email(nome_destinatario, lembrete):
    link = montar_link_pncp(lembrete.get("numero_controle_pncp"))
    objeto = lembrete.get("objeto_resumo") or lembrete.get("numero_controle_pncp") or "Licitação"
    dias_antes = lembrete.get("dias_antes")
    nota = (lembrete.get("nota") or "").strip()
    prazo = _prazo(lembrete)
    prazo_msg = " Prazo: " + prazo.astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M") + " (Brasília)." if prazo else ""

    texto = (
        "Olá, " + nome_destinatario + "!\n\n"
        "Lembrete: faltam " + str(dias_antes) + " dia(s) para o prazo final de propostas "
        "desta licitação que você está acompanhando." + prazo_msg + "\n\n"
        "- " + objeto + "\n"
        "  Link PNCP: " + link + "\n"
    )
    if nota:
        texto += "\n  Sua nota: " + nota + "\n"

    nota_html = (
        "<p><strong>Sua nota:</strong> " + html.escape(nota) + "</p>" if nota else ""
    )
    html_corpo = (
        "<p>Olá, " + html.escape(nome_destinatario) + "!</p>"
        "<p>Faltam <strong>" + str(dias_antes) + " dia(s)</strong> para o prazo final de propostas "
        "desta licitação que você está acompanhando." + html.escape(prazo_msg) + "</p>"
        "<p><strong>" + html.escape(objeto) + "</strong><br>"
        "<a href=\"" + html.escape(link) + "\">Ver no PNCP →</a></p>"
        + nota_html
    )
    return texto, html_corpo


def enviar_zeptomail(token, destino_email, nome_destinatario, texto, html_corpo, assunto=ASSUNTO_LEMBRETE):
    token = re.sub(r"^Zoho-enczapikey\s+", "", token.strip()).strip("\"'").strip()
    corpo = {
        "from": {"address": REMETENTE_ZEPTO, "name": "LicitaPlena"},
        "to": [{"email_address": {"address": destino_email, "name": nome_destinatario}}],
        "subject": assunto,
        "textbody": texto,
        "htmlbody": html_corpo,
    }
    req = urllib.request.Request(
        ZEPTOMAIL_URL, data=json.dumps(corpo).encode("utf-8"), method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": "Zoho-enczapikey " + token},
    )
    with urllib.request.urlopen(req, timeout=20):
        pass


def enviar_email(destino_email, nome_destinatario, lembrete):
    texto, html_corpo = montar_corpo_email(nome_destinatario, lembrete)
    enviar_mensagem(destino_email, nome_destinatario, ASSUNTO_LEMBRETE, texto, html_corpo)


def enviar_mensagem(destino_email, nome_destinatario, assunto, texto, html_corpo):
    token = os.environ.get("ZEPTOMAIL_TOKEN")
    if token:
        enviar_zeptomail(token, destino_email, nome_destinatario, texto, html_corpo, assunto)
        return
    remetente = os.environ["EMAIL_REMETENTE"]
    senha_app = os.environ["EMAIL_SENHA_APP"]

    msg = MIMEMultipart("alternative")
    msg["Subject"] = assunto
    msg["From"] = formataddr((str(Header(NOME_REMETENTE, "utf-8")), remetente))
    msg["To"] = destino_email
    msg.attach(MIMEText(texto, "plain", "utf-8"))
    msg.attach(MIMEText(html_corpo, "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as servidor:
        servidor.login(remetente, senha_app)
        servidor.sendmail(remetente, [destino_email], msg.as_string())


def reservar_envio(lembrete_id):
    # PATCH condicional (enviado=eq.false): so uma rodada ganha a linha. Evita e-mail duplicado entre rodadas
    # simultaneas e reenvio de hora em hora se a gravacao pos-envio falhasse.
    ganhou = _requisicao_supabase(
        "/rest/v1/lembretes?id=eq." + urllib.parse.quote(lembrete_id) + "&enviado=eq.false",
        metodo="PATCH",
        corpo={"enviado": True, "enviado_em": datetime.now(timezone.utc).isoformat()},
        headers_extra={"Prefer": "return=representation"},
    )
    return bool(ganhou)


def liberar_envio(lembrete_id):
    # Envio falhou: devolve o lembrete para a fila (proxima hora tenta de novo).
    _requisicao_supabase(
        "/rest/v1/lembretes?id=eq." + urllib.parse.quote(lembrete_id),
        metodo="PATCH",
        corpo={"enviado": False, "enviado_em": None},
        headers_extra={"Prefer": "return=minimal"},
    )


def marcar_como_enviado(lembrete_id, enviado=True):
    _requisicao_supabase(
        "/rest/v1/lembretes?id=eq." + urllib.parse.quote(lembrete_id),
        metodo="PATCH",
        corpo={"enviado": True, **({"enviado_em": datetime.now(timezone.utc).isoformat()} if enviado else {})},
        headers_extra={"Prefer": "return=minimal"},
    )


# ---------- "Mudou algo no edital?" ----------

def carregar_mudancas_pendentes():
    return _requisicao_supabase(
        "/rest/v1/operacao_monitor_mudancas?alerta=eq.true&avisado_em=is.null&order=detectado_em.asc&limit=500"
        "&select=id,processo_id,empresa_id,tipo,resumo,detectado_em,operacao_processos(objeto,numero,criado_por)"
    ) or []


def _ids_filtro(ids):
    return "(" + ",".join(urllib.parse.quote(i) for i in ids) + ")"


def reservar_mudancas(ids):
    # PATCH condicional (avisado_em=is.null): so as linhas que esta rodada ganhou voltam; as outras ja foram avisadas.
    ganhas = _requisicao_supabase(
        "/rest/v1/operacao_monitor_mudancas?id=in." + _ids_filtro(ids) + "&avisado_em=is.null&select=id",
        metodo="PATCH",
        corpo={"avisado_em": datetime.now(timezone.utc).isoformat()},
        headers_extra={"Prefer": "return=representation"},
    ) or []
    return [g["id"] for g in ganhas]


def liberar_mudancas(ids):
    _requisicao_supabase(
        "/rest/v1/operacao_monitor_mudancas?id=in." + _ids_filtro(ids),
        metodo="PATCH", corpo={"avisado_em": None}, headers_extra={"Prefer": "return=minimal"},
    )


def _mudanca_recente(m, agora):
    try:
        detectado = datetime.fromisoformat(str(m.get("detectado_em")).replace("Z", "+00:00"))
    except ValueError:
        return False
    return agora - detectado <= timedelta(hours=AVISO_MUDANCA_MAX_HORAS)


def montar_corpo_mudancas(nome_destinatario, processo, empresa_id, processo_id, mudancas):
    objeto = (processo or {}).get("objeto") or "Licitação"
    numero = (processo or {}).get("numero") or ""
    link = SITE_URL + "/sistema?empresa=" + urllib.parse.quote(empresa_id or "") + "&processo=" + urllib.parse.quote(processo_id or "")
    tem_esclarecimento = any(m.get("tipo") in ("esclarecimento", "impugnacao") for m in mudancas)
    linhas = [(m.get("resumo") or "").strip() for m in mudancas]
    texto = (
        "Olá, " + nome_destinatario + "!\n\n"
        "Mudou algo no edital de um processo que você acompanha:\n"
        "- " + objeto + ((" (" + numero + ")") if numero else "") + "\n\n"
        + "".join("  - " + linha + "\n" for linha in linhas)
        + ("\n" + AVISO_ESCLARECIMENTO + "\n" if tem_esclarecimento else "")
        + "\nAbrir o processo: " + link + "\n"
    )
    html_corpo = (
        "<p>Olá, " + html.escape(nome_destinatario) + "!</p>"
        "<p>Mudou algo no edital de um processo que você acompanha:</p>"
        "<p><strong>" + html.escape(objeto) + "</strong>" + ((" (" + html.escape(numero) + ")") if numero else "") + "</p>"
        "<ul>" + "".join("<li>" + html.escape(linha) + "</li>" for linha in linhas) + "</ul>"
        + ("<p><strong>" + html.escape(AVISO_ESCLARECIMENTO) + "</strong></p>" if tem_esclarecimento else "")
        + "<p><a href=\"" + html.escape(link) + "\">Abrir o processo no LicitaPlena</a></p>"
    )
    return texto, html_corpo


def avisar_mudancas_edital(so_registrar=False, agora=None):
    agora = agora or datetime.now(timezone.utc)
    pendentes = carregar_mudancas_pendentes()
    velhas = [m["id"] for m in pendentes if not _mudanca_recente(m, agora)]
    if velhas and not so_registrar:
        reservar_mudancas(velhas)  # fecha sem enviar
    por_processo = {}
    for m in pendentes:
        if m["id"] not in velhas:
            por_processo.setdefault(m["processo_id"], []).append(m)
    enviados = 0
    for processo_id, mudancas in por_processo.items():
        processo = mudancas[0].get("operacao_processos") or {}
        cliente = buscar_cliente(processo["criado_por"]) if processo.get("criado_por") else None
        email = (cliente or {}).get("email")
        if not email:
            log("AVISO: processo " + processo_id + " sem e-mail de quem cadastrou; a mudança fica só no sistema.")
            continue
        nome = (cliente or {}).get("empresa") or (cliente or {}).get("nome") or "Cliente"
        if so_registrar:
            log("[SO REGISTRAR] enviaria " + str(len(mudancas)) + " mudança(s) do processo " + processo_id + " para " + email + ".")
            enviados += 1
            continue
        try:
            ganhas = set(reservar_mudancas([m["id"] for m in mudancas]))
        except Exception as e:
            log("ERRO ao reservar mudanças do processo " + processo_id + ": " + str(e) + " (nada enviado)")
            continue
        mudancas = [m for m in mudancas if m["id"] in ganhas]
        if not mudancas:
            continue
        texto, html_corpo = montar_corpo_mudancas(nome, processo, mudancas[0].get("empresa_id"), processo_id, mudancas)
        try:
            enviar_mensagem(email, nome, "Mudou algo no edital: " + (processo.get("objeto") or "licitação")[:80], texto, html_corpo)
            enviados += 1
            log("Aviso de mudança enviado para " + email + " (processo " + processo_id + ", " + str(len(mudancas)) + " mudança(s)).")
        except Exception as e:
            log("ERRO ao enviar aviso do processo " + processo_id + ": " + str(e))
            try:
                liberar_mudancas([m["id"] for m in mudancas])
            except Exception as e2:
                log("ERRO ao devolver mudanças do processo " + processo_id + " para a fila: " + str(e2))
    return enviados


def main():
    log("=== Verificando lembretes de licitação pendentes ===")
    so_registrar = os.environ.get("LEMBRETES_SO_REGISTRAR") == "1"
    agora = datetime.now(timezone.utc)
    pendentes = carregar_lembretes_pendentes()
    expirados = [l for l in pendentes if situacao(l, agora) == "expirado"]
    hoje_lista = [l for l in pendentes if situacao(l, agora) == "enviar"]
    log(str(len(pendentes)) + " pendente(s): " + str(len(hoje_lista)) + " no momento do aviso, " + str(len(expirados)) + " com prazo vencido.")

    # Prazo vencido sem aviso (rodada perdida ou lembrete criado tarde): so fecha, sem e-mail fora de hora.
    if not so_registrar:
        for lembrete in expirados:
            marcar_como_enviado(lembrete["id"], enviado=False)

    enviados = 0
    for lembrete in hoje_lista:
        cliente = buscar_cliente(lembrete["cliente_id"])
        email = (cliente or {}).get("email")
        if not email:
            log("AVISO: lembrete " + lembrete["id"] + " sem e-mail de cliente encontrado, pulando.")
            continue
        nome = (cliente or {}).get("empresa") or (cliente or {}).get("nome") or "Cliente"
        if so_registrar:
            log("[SO REGISTRAR] enviaria para " + email + ": licitação " + str(lembrete.get("numero_controle_pncp")) + ", aviso " + str(lembrete.get("dias_antes")) + " dia(s) antes às " + str(lembrete.get("hora_aviso")) + "h.")
            enviados += 1
            continue
        try:
            reservado = reservar_envio(lembrete["id"])
        except Exception as e:
            log("ERRO ao reservar lembrete " + lembrete["id"] + ": " + str(e) + " (nada enviado)")
            continue
        if not reservado:
            log("Lembrete " + lembrete["id"] + " já reservado por outra rodada, pulando.")
            continue
        try:
            enviar_email(email, nome, lembrete)
            enviados += 1
            log("Lembrete enviado para " + email + " (licitação " + str(lembrete.get("numero_controle_pncp")) + ").")
        except Exception as e:
            log("ERRO ao enviar lembrete " + lembrete["id"] + " para " + email + ": " + str(e))
            try:
                liberar_envio(lembrete["id"])
            except Exception as e2:
                log("ERRO ao devolver lembrete " + lembrete["id"] + " para a fila: " + str(e2))

    log("=== Concluído: " + str(enviados) + " lembrete(s) " + ("registrado(s), nada enviado" if so_registrar else "enviado(s)") + " ===")
    # Falha aqui (tabela ainda não criada, rede) não derruba os lembretes já enviados.
    try:
        avisos = avisar_mudancas_edital(so_registrar)
        log("=== Mudanças de edital: " + str(avisos) + " aviso(s) " + ("registrado(s)" if so_registrar else "enviado(s)") + " ===")
    except Exception as e:
        log("ERRO no aviso de mudanças de edital: " + str(e))


if __name__ == "__main__":
    main()
