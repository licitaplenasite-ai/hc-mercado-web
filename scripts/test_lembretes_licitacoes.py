# -*- coding: utf-8 -*-
from datetime import datetime, timezone

import os
from unittest.mock import patch

import lembretes_licitacoes as lic
from lembretes_licitacoes import momento_do_aviso, montar_corpo_email, situacao

# Prazo 20/11/2026 17:00 em Brasília (UTC-3) = 20:00Z.
LEMBRETE = {"data_final_proposta": "2026-11-20T20:00:00+00:00", "dias_antes": 2, "hora_aviso": 7,
            "numero_controle_pncp": "11222333000181-1-000001/2026", "objeto_resumo": "Limpeza <b>x</b>", "nota": "<script>"}


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def test_momento_do_aviso_usa_hora_de_brasilia_e_dias_antes():
    assert momento_do_aviso(LEMBRETE).astimezone(timezone.utc) == utc(2026, 11, 18, 10)


def test_prazo_na_madrugada_utc_conta_o_dia_de_brasilia():
    # 01:00Z de 21/11 ainda é 20/11 em Brasília: 1 dia antes = 19/11 às 08h = 11:00Z.
    lembrete = {"data_final_proposta": "2026-11-21T01:00:00+00:00", "dias_antes": 1, "hora_aviso": 8}
    assert momento_do_aviso(lembrete).astimezone(timezone.utc) == utc(2026, 11, 19, 11)


def test_situacao_aguardar_enviar_expirado():
    assert situacao(LEMBRETE, utc(2026, 11, 18, 9, 59)) == "aguardar"
    assert situacao(LEMBRETE, utc(2026, 11, 18, 10, 0)) == "enviar"
    # Rodada perdida: horas depois ainda envia, desde que o prazo não tenha vencido.
    assert situacao(LEMBRETE, utc(2026, 11, 20, 19, 59)) == "enviar"
    assert situacao(LEMBRETE, utc(2026, 11, 20, 20, 0)) == "expirado"


def test_lembrete_antigo_sem_hora_avisa_as_8h_e_sem_prazo_nunca_envia():
    antigo = {"data_final_proposta": "2026-11-20T20:00:00+00:00", "dias_antes": 0}
    assert momento_do_aviso(antigo).astimezone(timezone.utc) == utc(2026, 11, 20, 11)
    assert situacao({"data_final_proposta": None, "dias_antes": 1}, utc(2030, 1, 1)) == "aguardar"


def test_corpo_do_email_escapa_html_e_mostra_o_prazo():
    texto, html_corpo = montar_corpo_email("Empresa <A>", LEMBRETE)
    assert "20/11/2026 17:00" in texto
    assert "<script>" not in html_corpo and "&lt;script&gt;" in html_corpo
    assert "<b>x</b>" not in html_corpo and "Empresa &lt;A&gt;" in html_corpo


def _rodar_main(reserva, envio_falha=False):
    chamadas = []
    lembrete = {**LEMBRETE, "id": "L1", "cliente_id": "C1", "enviado": False}

    def enviar(*a):
        chamadas.append("enviar")
        if envio_falha:
            raise RuntimeError("smtp")
    with patch.multiple(
        lic,
        carregar_lembretes_pendentes=lambda: [lembrete],
        situacao=lambda l, agora: "enviar",
        buscar_cliente=lambda _id: {"email": "a@b.c", "nome": "A"},
        reservar_envio=lambda i: chamadas.append("reservar") or reserva,
        liberar_envio=lambda i: chamadas.append("liberar"),
        enviar_email=enviar,
        avisar_mudancas_edital=lambda *a, **k: 0,
    ), patch.dict(os.environ, {"LEMBRETES_SO_REGISTRAR": "0"}):
        lic.main()
    return chamadas


def test_reserva_antes_de_enviar():
    assert _rodar_main(True) == ["reservar", "enviar"]


def test_outra_rodada_ja_reservou_nao_envia():
    assert _rodar_main(False) == ["reservar"]


def test_envio_falho_devolve_lembrete_para_a_fila():
    assert _rodar_main(True, envio_falha=True) == ["reservar", "enviar", "liberar"]


# ---------- "Mudou algo no edital?" ----------
AGORA = utc(2026, 11, 19, 12)
PROC = {"objeto": "Contact center <b>", "numero": "90102/2025", "criado_por": "U1"}


def _mudanca(i, processo="P1", tipo="situacao", detectado="2026-11-19T11:00:00+00:00"):
    return {"id": i, "processo_id": processo, "empresa_id": "E1", "tipo": tipo, "resumo": "Mudou " + i, "detectado_em": detectado, "operacao_processos": PROC}


def _avisar(pendentes, ganhas, envio_falha=False):
    chamadas = []

    def enviar(email, nome, assunto, texto, html_corpo):
        chamadas.append(("enviar", assunto, texto))
        if envio_falha:
            raise RuntimeError("zepto")
    with patch.multiple(
        lic,
        carregar_mudancas_pendentes=lambda: pendentes,
        buscar_cliente=lambda _id: {"email": "a@b.c", "nome": "A"},
        reservar_mudancas=lambda ids: chamadas.append(("reservar", sorted(ids))) or [i for i in ids if i in ganhas],
        liberar_mudancas=lambda ids: chamadas.append(("liberar", sorted(ids))),
        enviar_mensagem=enviar,
    ):
        n = lic.avisar_mudancas_edital(agora=AGORA)
    return n, chamadas


def test_mudancas_um_email_por_processo_so_com_as_reservadas():
    n, ch = _avisar([_mudanca("m1"), _mudanca("m2", tipo="esclarecimento"), _mudanca("m3", processo="P2")], ganhas={"m1", "m2"})
    assert n == 1
    assert ch[0] == ("reservar", ["m1", "m2"]) and ch[2] == ("reservar", ["m3"])
    envio = ch[1]
    assert envio[0] == "enviar" and "Mudou m1" in envio[2] and "vira regra do edital" in envio[2]


def test_mudanca_velha_fecha_sem_enviar():
    n, ch = _avisar([_mudanca("m1", detectado="2026-11-10T11:00:00+00:00")], ganhas={"m1"})
    assert n == 0 and ch == [("reservar", ["m1"])]


def test_envio_falho_devolve_mudancas_para_a_fila():
    n, ch = _avisar([_mudanca("m1")], ganhas={"m1"}, envio_falha=True)
    assert n == 0 and ch[-1] == ("liberar", ["m1"])


def test_corpo_das_mudancas_escapa_html_e_so_avisa_regra_com_esclarecimento():
    texto, html_corpo = lic.montar_corpo_mudancas("Empresa <A>", PROC, "E1", "P1", [_mudanca("m1")])
    assert "vira regra" not in texto and "&lt;b&gt;" in html_corpo and "Empresa &lt;A&gt;" in html_corpo
    assert "/sistema?empresa=E1&processo=P1" in texto
