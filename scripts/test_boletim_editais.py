import pytest
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
    monkeypatch.setattr(be, "enviar_email", lambda email, nome, eds, filtro="", *a: enviados.append((nome, filtro, len(eds))))
    be.main()
    # Boletim antigo da conta some (a conta já usa filtro por empresa); um e-mail por empresa e um pelo jornal.
    assert enviados == [("HCM", "papel", 1), ("RYMO", "café", 1), ("HCM", "Sulfite", 1)]


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


# ---- Envio: só ZeptoMail (2 tentativas); Gmail apenas com BOLETIM_GMAIL_RESERVA=1 ----
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
    monkeypatch.setattr(be, "agora_brasilia", lambda: be.datetime(2026, 11, 23, 9, 30, tzinfo=be.FUSO_BRASILIA))
    be.enviar_email("a@b.com", "Ana", [], "papel", "principal", {"numero": 1768})
    assert [e[0] for e in envios] == ["zepto"]
    assert envios[0][2] == "[1768] Boletim LicitaPlena de 23 de novembro de 2026, 09:30"


def test_falha_do_zeptomail_tenta_de_novo_e_nunca_cai_no_gmail(monkeypatch):
    # Regressão 23/11: o 400 do ZeptoMail mandou o boletim pelo Gmail pessoal do dono.
    envios = _capturar_envios(monkeypatch, zepto_falha=True)
    esperas = []
    monkeypatch.setattr(be.time, "sleep", esperas.append)
    monkeypatch.delenv("BOLETIM_GMAIL_RESERVA", raising=False)
    monkeypatch.setenv("ZEPTOMAIL_TOKEN", "token-falso")
    with pytest.raises(be.urllib.error.HTTPError):
        be.enviar_email("a@b.com", "Ana", [])
    assert [e[0] for e in envios] == ["zepto", "zepto"] and esperas == [be.ESPERA_ZEPTO_SEGUNDOS]
    # sem token: erro claro, nada pelo Gmail
    monkeypatch.delenv("ZEPTOMAIL_TOKEN")
    with pytest.raises(RuntimeError, match="ZEPTOMAIL_TOKEN"):
        be.enviar_email("a@b.com", "Ana", [])
    assert [e[0] for e in envios] == ["zepto", "zepto"]


def test_segunda_tentativa_do_zeptomail_resolve(monkeypatch):
    tentativas = []

    def zepto(*a):
        tentativas.append(1)
        if len(tentativas) == 1:
            raise be.urllib.error.HTTPError(be.ZEPTOMAIL_URL, 500, "erro", None, None)
    monkeypatch.setattr(be, "enviar_zeptomail", zepto)
    monkeypatch.setattr(be, "enviar_gmail", lambda *a: pytest.fail("nao pode usar o Gmail"))
    monkeypatch.setattr(be.time, "sleep", lambda s: None)
    monkeypatch.setenv("ZEPTOMAIL_TOKEN", "token-falso")
    be.enviar_email("a@b.com", "Ana", [])
    assert len(tentativas) == 2


def test_gmail_so_com_reserva_ligada_e_mesmo_conteudo(monkeypatch):
    envios = _capturar_envios(monkeypatch, zepto_falha=True)
    monkeypatch.setattr(be.time, "sleep", lambda s: None)
    monkeypatch.setenv("ZEPTOMAIL_TOKEN", "token-falso")
    monkeypatch.setenv("BOLETIM_GMAIL_RESERVA", "1")
    be.enviar_email("a@b.com", "Ana", [])
    assert [e[0] for e in envios] == ["zepto", "zepto", "gmail"]
    # Mesmo assunto, texto e HTML nos dois caminhos: o formato aprovado nao muda.
    assert envios[0][2:] == envios[2][2:]


def test_payload_do_zeptomail_respeita_limites_e_omite_nome_vazio(monkeypatch):
    import json as _json
    enviados = []

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False
    monkeypatch.setattr(be.urllib.request, "urlopen", lambda req, timeout=None: enviados.append((req, _json.loads(req.data))) or _Resp())
    be.enviar_zeptomail("Zoho-enczapikey abc", " a@b.c ", "", "A" * 600, "t", "<p>x</p>")
    be.enviar_zeptomail("abc", "a@b.c", "N" * 300, "Assunto", "t", "<p>x</p>")
    assert enviados[0][1]["to"] == [{"email_address": {"address": "a@b.c"}}] and len(enviados[0][1]["subject"]) == 500
    assert len(enviados[1][1]["to"][0]["email_address"]["name"]) == 250
    assert enviados[0][0].get_header("Authorization") == "Zoho-enczapikey abc"
    assert set(enviados[0][1]) == {"from", "reply_to", "to", "subject", "textbody", "htmlbody"}


def test_erro_do_zeptomail_mostra_codigo_sem_email(monkeypatch):
    import io

    def recusa(req, timeout=None):
        corpo = b'{"error":{"code":"TM_4001","details":[{"code":"SM_128","message":"account not reviewed","target":"cliente@x.com"}]}}'
        raise be.urllib.error.HTTPError(be.ZEPTOMAIL_URL, 400, "Bad Request", None, io.BytesIO(corpo))
    monkeypatch.setattr(be.urllib.request, "urlopen", recusa)
    with pytest.raises(be.urllib.error.HTTPError) as erro:
        be.enviar_zeptomail("abc", "cliente@x.com", "A", "S", "t", "<p>x</p>")
    assert "SM_128" in str(erro.value) and "em análise" in str(erro.value) and "cliente@x.com" not in str(erro.value)


def test_modo_somente_email_manda_so_para_ele_e_nao_grava_nada(monkeypatch):
    monkeypatch.setattr(be, "montar_lista_destinatarios", lambda: [
        {"id": "c1", "nome": "HCM", "email": "Dono@Example.invalid", "ufs": ["AM"], "palavras_chave": ["papel"], "whatsapp": {"telefone": "1", "apikey": "2"}},
        {"id": "c2", "nome": "Outro", "email": "cliente@example.invalid", "ufs": ["AM"], "palavras_chave": ["papel"], "whatsapp": None}])
    monkeypatch.setattr(be, "hoje_e_feriado_nacional", lambda: None)
    monkeypatch.setattr(be, "carregar_historico", lambda: {})
    monkeypatch.setattr(be, "salvar_historico", lambda h: pytest.fail("teste nao marca vistos"))
    monkeypatch.setattr(be, "_chave_servico", lambda: pytest.fail("teste nao grava no Supabase"))
    monkeypatch.setattr(be, "enviar_whatsapp", lambda *a: pytest.fail("teste nao manda WhatsApp"))
    monkeypatch.setattr(be, "carregar_prospecta", lambda: {})
    monkeypatch.setattr(be, "carregar_cabecalhos", lambda ids, hoje=None: {})
    monkeypatch.setattr(be, "e_rodada_dos_jornais", lambda agora=None: False)
    monkeypatch.setattr(be, "buscar_pool_por_uf", lambda ufs: {"AM": [_edital(1, "Papel sulfite A4")]})
    monkeypatch.setenv("BOLETIM_SOMENTE_EMAIL", " dono@example.invalid ")
    enviados = []
    monkeypatch.setattr(be, "enviar_email", lambda email, nome, eds, filtro="", filtro_id="", cab=None: enviados.append((email, len(eds), cab)))
    be.main()
    assert enviados == [("Dono@Example.invalid", 1, {"numero": None})]


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
    # links: botao, privacidade, ajustar filtros, gerenciar avisos e e-mail de suporte; sem PNCP, sem site do orgao
    hrefs = re.findall(r'href="([^"]+)"', html)
    assert hrefs[0] == html_escape(LINK) and set(hrefs[1:]) == {b.URL_AJUSTAR_FILTROS, b.URL_PRIVACIDADE, "mailto:" + b.EMAIL_SUPORTE}
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
    assert r[:2] == ["2 em AM", "1 em PA"] and "1 exclusiva ME/EPP" in r and r[-1].startswith("maior valor")
    html = b.montar_email_html("X", "f", EDICAO, 3, LINK, r)
    assert "2 em AM" in html and "Papel" not in html and b.montar_resumo([]) == []


def test_assunto_tem_edicao_data_e_hora_de_brasilia():
    agora = b.datetime(2026, 11, 3, 6, 5, tzinfo=b.FUSO_BRASILIA)
    assert b.montar_assunto(1768, agora) == "[1768] Boletim LicitaPlena de 3 de novembro de 2026, 06:05"
    assert b.montar_assunto(None, agora) == "Boletim LicitaPlena de 3 de novembro de 2026, 06:05"
    # 23h30 de Brasilia ja e o dia seguinte em UTC: vale o dia de Brasilia.
    assert b.agora_brasilia().utcoffset() == b.timedelta(hours=-3)


CAB = {"numero": 1768, "processado_em": b.datetime(2026, 11, 23, 9, 30, tzinfo=b.FUSO_BRASILIA), "codigo": 1042,
       "responsavel": "Maria Souza", "vigencia": "Empresa, válida até 22 de janeiro de 2027"}


def test_cabecalho_e_politica_no_html_e_no_texto():
    html = b.montar_email_html("HCM LTDA", "papel, sulfite", EDICAO, 7, LINK, None, CAB)
    texto = b.montar_email_texto("HCM LTDA", "papel, sulfite", EDICAO, 7, LINK, None, CAB)
    for t in (html, texto):
        assert "Edição nº" in t and "1768" in t and "23 de novembro de 2026, 09:30" in t
        assert "Identificação do cliente" in t and "1042" in t and "HCM LTDA" in t and "papel, sulfite" in t
        assert "Empresa, válida até 22 de janeiro de 2027" in t and "Aos cuidados de" in t and "Maria Souza" in t
        assert "POLÍTICA DE USO E RESPONSABILIDADE" in t and "não substitui o edital" in t
        assert "obrigação de meio" in t and "uso exclusivo do cliente identificado" in t and "13.709/2018" in t
    # o aviso continua o mesmo: quantidade e botao para a edicao
    assert "Chegaram 7 novas licitações" in html and "Acessar o boletim" in html and LINK in texto
    assert texto.index("Edição nº") < texto.index("Chegaram 7") < texto.index("POLÍTICA DE USO")


def test_cabecalho_sem_dados_some_sem_deixar_rotulo_vazio():
    html = b.montar_email_html("HCM", "papel", EDICAO, 2, LINK)
    assert "Edição nº" not in html and "Identificação do cliente" not in html and "Aos cuidados" not in html
    assert ">Empresa</td>" in html and "POLÍTICA DE USO" in html
    html = b.montar_email_html("HCM", "papel", EDICAO, 2, LINK, None, {"responsavel": "<b>x</b>"})
    assert "<b>x</b>" not in html


def test_vigencia_por_situacao_da_assinatura():
    hoje = date(2026, 11, 23)
    plano = {"nome": "Empresa"}
    assert b.montar_vigencia({"situacao": "teste", "teste_ate": "2026-12-07T02:30:00.12345+00:00"}, hoje) == "Teste grátis até 6 de dezembro de 2026"
    assert b.montar_vigencia({"situacao": "teste", "teste_ate": "2026-11-20T15:00:00+00:00"}, hoje) == "Teste grátis encerrado em 20 de novembro de 2026"
    assert b.montar_vigencia({"situacao": "ativa", "vence_em": "2027-01-22", "planos": plano}, hoje) == "Empresa, válida até 22 de janeiro de 2027"
    assert b.montar_vigencia({"situacao": "vencida", "vence_em": "2026-11-10", "planos": plano}, hoje) == "Empresa, venceu em 10 de novembro de 2026"
    assert b.montar_vigencia({"situacao": "ativa", "planos": {"nome": "Dono (ilimitado)"}}, hoje) == "Dono (ilimitado), sem data de vencimento"
    assert b.montar_vigencia({"situacao": "suspensa", "vence_em": "2027-01-22"}, hoje) is None
    assert b.montar_vigencia({"situacao": "ativa", "vence_em": "lixo"}, hoje) is None
    assert b.montar_vigencia(None, hoje) is None


def test_carregar_cabecalhos_junta_cliente_e_assinatura_e_falha_sem_derrubar(monkeypatch):
    respostas = {
        "clientes?select=id,nome,codigo": [{"id": "c1", "nome": " Maria ", "codigo": 1042}],
        "assinaturas?": [{"usuario_id": "c1", "situacao": "ativa", "vence_em": "2027-01-22", "planos": {"nome": "Empresa"}}],
    }
    monkeypatch.setattr(b, "_get_json", lambda caminho: next(v for k, v in respostas.items() if caminho.startswith(k)))
    cab = b.carregar_cabecalhos(["c1", None, "c1"], date(2026, 11, 23))
    assert cab == {"c1": {"codigo": 1042, "responsavel": "Maria", "vigencia": "Empresa, válida até 22 de janeiro de 2027"}}
    assert b.carregar_cabecalhos([]) == {}

    def falha(caminho):
        raise RuntimeError("coluna codigo nao existe")
    monkeypatch.setattr(b, "_get_json", falha)
    assert b.carregar_cabecalhos(["c1"]) == {}


class _RespJson:
    def __init__(self, corpo):
        self.corpo = corpo

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.corpo.encode("utf-8")


def test_registrar_edicao_devolve_numero_e_dia_sem_novidade_nao_apaga_a_lista(monkeypatch):
    import json as _json
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "chave-falsa")
    pedidos = []
    respostas = iter(['[{"numero": 1768}]', '[]'])
    monkeypatch.setattr(b.urllib.request, "urlopen", lambda req, timeout=None: pedidos.append(req) or _RespJson(next(respostas)))
    lidos = []
    monkeypatch.setattr(b, "_get_json", lambda caminho: lidos.append(caminho) or [{"numero": 1768}])
    d = {"id": "c1", "email": "a@b.c", "nome": "HCM", "palavras_chave": ["papel"]}
    assert b.registrar_edicao(d, EDICAO, [{"numeroControlePNCP": "x1"}], "empresa:e1") == 1768
    assert "merge-duplicates" in pedidos[0].get_header("Prefer")
    # rodada seguinte sem novidade: so cria se nao existe e le o numero que ja estava
    assert b.registrar_edicao(d, EDICAO, [], "empresa:e1") == 1768
    assert "ignore-duplicates" in pedidos[1].get_header("Prefer") and _json.loads(pedidos[1].data)[0]["quantidade"] == 0
    assert lidos == ["boletim_edicoes?select=numero&cliente_id=eq.c1&edicao=eq.2026-11-20&filtro_id=eq.empresa%3Ae1"]
    assert b.registrar_edicao({"email": "fixo@b.c", "nome": "X"}, EDICAO, []) is None


def test_email_sem_novidade_nao_tem_botao_da_edicao():
    html = b.montar_email_html("Empresa X", "limpeza", EDICAO, 0, LINK)
    assert "Acessar o boletim" not in html and html_escape(LINK) not in html and "Ajustar meus filtros" in html
    assert "Abrir o painel" in html


def test_nome_da_empresa_e_escapado_no_html():
    html = b.montar_email_html("<script>x</script>", "a", EDICAO, 2, LINK)
    assert "<script>" not in html


def test_enviar_email_manda_so_aviso_com_link_do_filtro(monkeypatch):
    envios = []
    monkeypatch.setattr(b, "enviar_zeptomail", lambda token, email, nome, assunto, texto, html_corpo: envios.append((assunto, texto, html_corpo)))
    monkeypatch.setenv("ZEPTOMAIL_TOKEN", "token-falso")
    editais = [{"objetoCompra": "Papel", "numeroControlePNCP": "11222333000181-1-000001/2026"}] * 3
    b.enviar_email("a@b.com", "HCM", editais, "papel", "empresa:e1", {"numero": 9})
    assunto, texto, html_corpo = envios[0]
    assert assunto.startswith("[9] Boletim LicitaPlena de ") and "Chegaram 3 novas licitações" in texto
    assert "filtro=empresa%3Ae1#boletim" in texto and "Papel" not in texto + html_corpo


def test_boletim_sai_de_boletim_com_resposta_para_o_dono(monkeypatch):
    import json as _json
    enviados = []

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False
    monkeypatch.setattr(b.urllib.request, "urlopen", lambda req, timeout=None: enviados.append(_json.loads(req.data)) or _Resp())
    b.enviar_zeptomail("token-falso", "a@b.c", "A", "Assunto", "texto", "<p>x</p>")
    assert enviados[0]["from"] == {"address": "boletim@licitaplena.com.br", "name": "LicitaPlena Boletim"}
    assert enviados[0]["reply_to"] == [{"address": "licitaplena.site@gmail.com", "name": "LicitaPlena"}]


# ---- 23/11: log público sem e-mail e cabeçalho com a chave certa de planos ----
def test_mascarar_email_esconde_endereco_no_log():
    import boletim_editais as b
    assert b.mascarar_email("E-mail enviado para fulano.tal@gmail.com com 3") == "E-mail enviado para fu***@gmail.com com 3"
    assert b.mascarar_email("sem e-mail aqui") == "sem e-mail aqui"


def test_cabecalho_usa_chave_explicita_de_planos(monkeypatch):
    import boletim_editais as b
    pedidos = []

    def falso(caminho):
        pedidos.append(caminho)
        if caminho.startswith("clientes"):
            return [{"id": "c1", "nome": "Fulano", "codigo": "LP-0001"}]
        return [{"usuario_id": "c1", "situacao": "ativa", "vence_em": "2027-01-10", "planos": {"nome": "Empresa"}}]

    monkeypatch.setattr(b, "_get_json", falso)
    cab = b.carregar_cabecalhos(["c1"], hoje=b.date(2026, 11, 23))
    # Sem "!assinaturas_plano_fkey" o PostgREST responde 300 (duas chaves para planos) e o cabeçalho some.
    assert any("planos!assinaturas_plano_fkey(nome)" in p for p in pedidos)
    assert cab["c1"]["codigo"] == "LP-0001"
    assert "Empresa" in cab["c1"]["vigencia"]


def test_layout_resiste_ao_gmail_escuro_e_tem_cabecalho_em_tabela():
    # 23/11: no Gmail escuro do iPhone a faixa e o botão viravam lilás; no computador o cabeçalho ficava desalinhado.
    html = b.montar_email_html("HCM LTDA", "papel", EDICAO, 3, LINK, ["2 em AM"], CAB)
    fixo = "background-image:linear-gradient(" + b.COR_MARCA + "," + b.COR_MARCA + ")"
    assert html.count(fixo) == 2  # faixa do topo e botão "Acessar o boletim"
    assert '<meta name="color-scheme" content="light dark">' in html and 'width="600"' in html
    assert "Arial" in html and "font-family:-apple-system" in html
    # identificação em 2 colunas (rótulo | valor), Edição e Data na mesma faixa, nessa ordem
    rotulos = re.findall(r'<td width="38%"[^>]*>([^<]+)</td>', html)
    assert rotulos == ["Identificação do cliente", "Empresa", "Filtro", "Vigência da assinatura"]
    assert html.index("Edição nº") < html.index("Data do processamento") < html.index("Identificação do cliente") < html.index("Aos cuidados de") < html.index("Acessar o boletim")


def test_modo_teste_aceita_codigo_do_cliente(monkeypatch):
    import boletim_editais as b
    monkeypatch.setattr(b, "carregar_cabecalhos", lambda ids: {"c1": {"codigo": "LP-0001"}, "c2": {"codigo": "LP-0002"}})
    alvo = b.destinatarios_do_teste("lp-0002", [{"id": "c1"}, {"id": "c2"}], [])
    assert [cid for cid in ("c1", "c2", None) if alvo("x@y.com", cid)] == ["c2"]
    por_email = b.destinatarios_do_teste("x@y.com", [], [])
    assert por_email("X@Y.com ", None) and not por_email("z@y.com", "c1")
