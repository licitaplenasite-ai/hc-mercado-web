# -*- coding: utf-8 -*-
from boletim_editais import filtrar_por_palavra_chave


def test_filtrar_por_palavra_chave_ignora_acentos_e_maiusculas():
    editais = [
        {"objetoCompra": "Aquisicao de Equipamentos de Informatica"},
        {"objetoCompra": "Contratacao de servicos de limpeza"},
    ]

    filtrados = filtrar_por_palavra_chave(editais, ["informática"])

    assert filtrados == [editais[0]]


def test_filtrar_por_palavra_chave_sem_palavras_retorna_todos():
    editais = [
        {"objetoCompra": "Aquisicao de Equipamentos de Informatica"},
        {"objetoCompra": "Contratacao de servicos de limpeza"},
    ]

    assert filtrar_por_palavra_chave(editais, []) == editais


# ---- Boletim por empresa e jornais (mock: sem rede, sem SMTP) ----
import boletim_editais as be


def _edital(n, objeto, uf="AM", municipio="Manaus", **extra):
    hoje = be.datetime.now(be.timezone(be.timedelta(hours=-3))).isoformat()
    return {"numeroControlePNCP": "11222333000181-1-%06d/2026" % n, "objetoCompra": objeto, "dataPublicacaoPncp": hoje,
            "unidadeOrgao": {"ufSigla": uf, "municipioNome": municipio}, "orgaoEntidade": {"razaoSocial": "Prefeitura", "esferaId": "M"}, **extra}


def test_filtrar_jornal_aplica_limitar_excluir_portal_srp_mepp_e_raio():
    eds = [
        _edital(1, "Papel sulfite A4 exclusiva para ME/EPP", usuarioNome="Compras.gov.br"),
        _edital(2, "Papel toalha registro de preços", usuarioNome="BLL Compras"),
        _edital(3, "Papel sulfite para obra", municipio="Iranduba"),
        _edital(4, "Papel sulfite", uf="SP", municipio="São Paulo"),
    ]
    ids = lambda f: [e["numeroControlePNCP"][-11:-5] for e in be.filtrar_jornal(eds, f)]
    assert ids({"palavrasRaw": "papel", "ufs": ["AM"]}) == ["000001", "000002", "000003"]
    assert ids({"palavrasRaw": "papel", "limitar": "sulfite", "excluir": "obra"}) == ["000001", "000004"]
    assert ids({"palavrasRaw": "papel", "portal": "BLL"}) == ["000002"]
    assert ids({"palavrasRaw": "papel", "excluirSrp": True, "mePp": True}) == ["000001"]
    assert ids({"palavrasRaw": "papel", "raio": {"municipio": "Manaus", "uf": "AM", "km": 50}}) == ["000001", "000002", "000003"]


def test_e_rodada_dos_jornais_so_de_manha():
    tz = be.timezone(be.timedelta(hours=-3))
    assert be.e_rodada_dos_jornais(be.datetime(2026, 11, 20, 7, tzinfo=tz))
    assert not be.e_rodada_dos_jornais(be.datetime(2026, 11, 20, 12, tzinfo=tz))


def test_boletim_por_empresa_e_jornal_viram_emails_separados(monkeypatch):
    respostas = {
        "clientes?status=eq.aprovado&select=id,nome,empresa,email,segmento,estados_interesse": [],
        "boletim_filtros_empresa": [
            {"empresa_id": "e1", "cliente_id": "c1", "filtro": {"ufs": ["AM"], "palavrasRaw": "papel"}, "operacao_empresas": {"razao_social": "HCM", "ativo": True}},
            {"empresa_id": "e2", "cliente_id": "c1", "filtro": {"ufs": ["SP"], "palavrasRaw": "café"}, "operacao_empresas": {"razao_social": "RYMO", "ativo": True}},
        ],
        "filtros_salvos": [{"id": "j1", "nome": "Sulfite", "filtro": {"palavrasRaw": "sulfite", "jornal": True}, "cliente_id": "c1", "empresa_id": "e1", "operacao_empresas": {"razao_social": "HCM"}}],
        "clientes?status=eq.aprovado&select=id,nome,empresa,email&": [{"id": "c1", "email": "dono@example.invalid", "nome": "Dono"}],
    }
    monkeypatch.setattr(be, "_get_json", lambda caminho: next(v for k, v in respostas.items() if caminho.startswith(k)))
    monkeypatch.setattr(be, "carregar_clientes_aprovados", lambda: [{"id": "c1", "nome": "Dono", "email": "dono@example.invalid", "ufs": None, "palavras_chave": ["x"], "whatsapp": None}])
    monkeypatch.setattr(be, "hoje_e_feriado_nacional", lambda: None)
    monkeypatch.setattr(be, "carregar_historico", lambda: {})
    monkeypatch.setattr(be, "salvar_historico", lambda h: None)
    monkeypatch.setattr(be, "registrar_log_boletim", lambda *a, **k: None)
    monkeypatch.setattr(be, "registrar_edicao", lambda *a, **k: None)
    monkeypatch.setattr(be, "buscar_pool_por_uf", lambda ufs: {"AM": [_edital(1, "Papel sulfite A4")], "SP": [_edital(2, "Café torrado", uf="SP", municipio="São Paulo")]})
    monkeypatch.setenv("JORNAIS_SEMPRE", "1")
    enviados = []
    monkeypatch.setattr(be, "enviar_email", lambda email, nome, eds, prefixo="", *a: enviados.append((prefixo, len(eds))))
    be.main()
    # Boletim antigo da conta some (a conta já usa filtro por empresa); um e-mail por empresa e um pelo jornal.
    assert enviados == [("[HCM] ", 1), ("[RYMO] ", 1), ("[HCM · Sulfite] ", 1)]


# ---- Prospecta (funil_v3.sql) ----
def test_nota_oportunidade_palavras_valor_e_prazo():
    tz = be.timezone(be.timedelta(hours=-3))
    agora = be.datetime(2026, 11, 20, 8, tzinfo=tz)
    e = _edital(1, "Papel sulfite A4 e papel toalha", valorTotalEstimado=20000, dataEncerramentoProposta="2026-11-30T09:00:00")
    assert be.nota_oportunidade(e, ["papel", "sulfite"], 10000, agora) == 50 + 25 + 15
    assert be.nota_oportunidade(e, ["papel", "sulfite", "toalha"], 10000, agora) == 100
    # Abaixo do valor mínimo da meta e com 2 dias de prazo: só as palavras.
    curto = _edital(2, "Papel", valorTotalEstimado=500, dataEncerramentoProposta="2026-11-22T09:00:00")
    assert be.nota_oportunidade(curto, ["papel"], 10000, agora) == 40
    assert be.nota_oportunidade(_edital(3, "Cadeira"), ["papel"], 0, agora) == 0


def test_prospecta_manda_lista_ordenada_so_da_empresa_ligada(monkeypatch):
    respostas = {
        "clientes?status=eq.aprovado&select=id,nome,empresa,email,segmento,estados_interesse": [],
        "boletim_filtros_empresa": [
            {"empresa_id": "e1", "cliente_id": "c1", "filtro": {"ufs": ["AM"], "palavrasRaw": "papel, sulfite"}, "operacao_empresas": {"razao_social": "HCM", "ativo": True}},
            {"empresa_id": "e2", "cliente_id": "c1", "filtro": {"ufs": ["AM"], "palavrasRaw": "papel"}, "operacao_empresas": {"razao_social": "RYMO", "ativo": True}},
        ],
        "clientes?status=eq.aprovado&select=id,nome,empresa,email&": [{"id": "c1", "email": "dono@example.invalid", "nome": "Dono"}],
        "operacao_funil_preferencias": [{"empresa_id": "e1", "meta": {"valor_minimo": 1000}}],
    }
    monkeypatch.setattr(be, "_get_json", lambda caminho: next(v for k, v in respostas.items() if caminho.startswith(k)))
    monkeypatch.setattr(be, "carregar_clientes_aprovados", lambda: [])
    monkeypatch.setattr(be, "hoje_e_feriado_nacional", lambda: None)
    monkeypatch.setattr(be, "carregar_historico", lambda: {})
    monkeypatch.setattr(be, "salvar_historico", lambda h: None)
    monkeypatch.setattr(be, "registrar_log_boletim", lambda *a, **k: None)
    monkeypatch.setattr(be, "registrar_edicao", lambda *a, **k: None)
    monkeypatch.setattr(be, "e_rodada_dos_jornais", lambda *a: False)
    monkeypatch.setattr(be, "enviar_email", lambda *a, **k: None)
    monkeypatch.setattr(be, "buscar_pool_por_uf", lambda ufs: {"AM": [_edital(1, "Papel toalha"), _edital(2, "Papel sulfite", valorTotalEstimado=5000)]})
    chamadas = []
    monkeypatch.setattr(be, "sugerir_no_funil", lambda empresa, itens: chamadas.append((empresa, [i["numero_controle"][-11:-5] for i in itens])) or len(itens))
    be.main()
    assert chamadas == [("e1", ["000002", "000001"])]


# ---- Envio: ZeptoMail primeiro, Gmail de reserva, mesmo conteudo nos dois ----
def _capturar_envios(monkeypatch, zepto_falha=False):
    envios = []

    def zepto(token, email, nome, assunto, texto, html_corpo):
        envios.append(("zepto", email, assunto, texto, html_corpo))
        if zepto_falha:
            raise be.urllib.error.HTTPError(be.ZEPTOMAIL_URL, 500, "erro", None, None)

    monkeypatch.setattr(be, "enviar_zeptomail", zepto)
    monkeypatch.setattr(be, "enviar_gmail", lambda email, assunto, texto, html_corpo: envios.append(("gmail", email, assunto, texto, html_corpo)))
    return envios


def test_enviar_email_usa_zeptomail_quando_ha_token(monkeypatch):
    envios = _capturar_envios(monkeypatch)
    monkeypatch.setenv("ZEPTOMAIL_TOKEN", "token-falso")
    be.enviar_email("a@b.com", "Ana", [], "[Teste] ")
    assert [e[0] for e in envios] == ["zepto"]
    assert envios[0][2] == "[Teste] Nenhuma oportunidade nova hoje"


def test_enviar_email_cai_no_gmail_sem_token_ou_com_falha_e_mantem_o_conteudo(monkeypatch):
    envios = _capturar_envios(monkeypatch, zepto_falha=True)
    monkeypatch.delenv("ZEPTOMAIL_TOKEN", raising=False)
    be.enviar_email("a@b.com", "Ana", [])
    assert [e[0] for e in envios] == ["gmail"]
    monkeypatch.setenv("ZEPTOMAIL_TOKEN", "token-falso")
    be.enviar_email("a@b.com", "Ana", [])
    assert [e[0] for e in envios] == ["gmail", "zepto", "gmail"]
    # Mesmo assunto, texto e HTML nos dois caminhos: o formato aprovado nao muda.
    assert envios[1][2:] == envios[2][2:] == envios[0][2:]


import re
from html import escape as html_escape
from datetime import date
import boletim_editais as b

EDICAO = date(2026, 11, 20)
LINK = b.montar_link_boletim(EDICAO)


def test_link_do_boletim_so_tem_data_e_filtro():
    assert LINK == "https://licitaplena.com.br/painel.html?edicao=2026-11-20&filtro=principal#boletim"
    assert "@" not in LINK and "token" not in LINK


def test_email_e_so_aviso_sem_lista_de_editais():
    html = b.montar_email_html("Empresa X", "limpeza, higiene", EDICAO, 7, LINK)
    texto = b.montar_email_texto("Empresa X", "limpeza, higiene", EDICAO, 7, LINK)
    assert "Chegaram 7 novas licitações" in html and "Chegaram 7 novas licitações" in texto
    assert "Empresa X" in html and "limpeza, higiene" in html and "20/11/2026" in html
    assert "Acessar o boletim" in html and html_escape(LINK) in html and LINK in texto
    # links: botao, ajustar filtros, gerenciar avisos e e-mail de suporte; sem PNCP, sem site do orgao
    hrefs = re.findall(r'href="([^"]+)"', html)
    assert hrefs[0] == html_escape(LINK) and set(hrefs[1:]) == {b.URL_AJUSTAR_FILTROS, "mailto:" + b.EMAIL_SUPORTE}
    assert "pncp" not in (html + texto).lower()
    # logo em PNG por URL absoluta, rodape com motivo, nao responder e CNPJ da HCM
    assert 'src="https://licitaplena.com.br/logo.png"' in html and 'alt="LicitaPlena"' in html
    assert "cadastrou o filtro" in html and "Ajustar meus filtros" in html and "não responda" in html
    assert "28.786.260/0001-53" in html and "cadastrou o filtro" in texto
    assert "@" not in "".join(h for h in hrefs if not h.startswith("mailto:"))


def test_resumo_so_numeros_sem_objeto():
    editais = [
        {"objetoCompra": "Papel A4", "unidadeOrgao": {"ufSigla": "AM"}, "valorTotalEstimado": 1500.5},
        {"objetoCompra": "Limpeza, exclusivo para ME/EPP", "unidadeOrgao": {"ufSigla": "AM"}, "valorTotalEstimado": 90000},
        {"objetoCompra": "Tinta", "unidadeOrgao": {"ufSigla": "PA"}},
    ]
    r = b.montar_resumo(editais)
    assert r[:2] == ["2 no AM", "1 no PA"] and "1 exclusiva ME/EPP" in r and r[-1].startswith("maior valor")
    html = b.montar_email_html("X", "f", EDICAO, 3, LINK, r)
    assert "2 no AM" in html and "Papel" not in html and b.montar_resumo([]) == []


def test_assunto_e_singular_ou_plural():
    assert b.montar_assunto(1) == "Chegou 1 nova licitação no seu boletim"
    assert b.montar_assunto(3) == "Chegaram 3 novas licitações no seu boletim"


def test_email_sem_novidade_nao_tem_botao():
    html = b.montar_email_html("Empresa X", "limpeza", EDICAO, 0, LINK)
    assert "Acessar o boletim" not in html and html_escape(LINK) not in html and "Ajustar meus filtros" in html


def test_nome_da_empresa_e_escapado_no_html():
    html = b.montar_email_html("<script>x</script>", "a", EDICAO, 2, LINK)
    assert "<script>" not in html


def test_enviar_email_manda_so_aviso_com_link_do_filtro(monkeypatch):
    envios = []
    monkeypatch.setattr(b, "enviar_zeptomail", lambda token, email, nome, assunto, texto, html_corpo: envios.append((assunto, texto, html_corpo)))
    monkeypatch.setenv("ZEPTOMAIL_TOKEN", "token-falso")
    editais = [{"objetoCompra": "Papel", "numeroControlePNCP": "11222333000181-1-000001/2026"}] * 3
    b.enviar_email("a@b.com", "HCM", editais, "[HCM] ", "papel", "empresa:e1")
    assunto, texto, html_corpo = envios[0]
    assert assunto == "[HCM] Chegaram 3 novas licitações no seu boletim"
    assert "filtro=empresa%3Ae1#boletim" in texto and "Papel" not in texto + html_corpo
