# -*- coding: utf-8 -*-
from cobranca_diaria import montar_mensagem, reais

BASE = {"nome": "Maria <Silva>", "plano_nome": "Empresa", "valor_centavos": 134500, "vence_em": "2026-11-25", "carencia_ate": "2026-11-28"}


def test_reais_formato_brasileiro():
    assert reais(134500) == "R$ 1.345,00"
    assert reais(12700) == "R$ 127,00"


def test_tres_dias_antes():
    assunto, texto, _ = montar_mensagem({**BASE, "tipo": "vence_em_3_dias"})
    assert "3 dias" in assunto and "R$ 1.345,00" in texto and "25/11/2026" in texto and "/assinar.html" in texto


def test_vence_hoje_mostra_carencia():
    _, texto, _ = montar_mensagem({**BASE, "tipo": "vence_hoje"})
    assert "até 28/11/2026" in texto


def test_bloqueado_diz_que_nada_e_apagado_e_escapa_html():
    _, texto, html_corpo = montar_mensagem({**BASE, "tipo": "bloqueado"})
    assert "boletim" in texto and "guardado" in texto
    assert "<Silva>" not in html_corpo and "Olá, Maria!" in html_corpo
