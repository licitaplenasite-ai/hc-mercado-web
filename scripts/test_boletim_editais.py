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
    monkeypatch.setattr(be, "buscar_pool_por_uf", lambda ufs: {"AM": [_edital(1, "Papel sulfite A4")], "SP": [_edital(2, "Café torrado", uf="SP", municipio="São Paulo")]})
    monkeypatch.setenv("JORNAIS_SEMPRE", "1")
    enviados = []
    monkeypatch.setattr(be, "enviar_email", lambda email, nome, eds, prefixo="": enviados.append((prefixo, len(eds))))
    be.main()
    # Boletim antigo da conta some (a conta já usa filtro por empresa); um e-mail por empresa e um pelo jornal.
    assert enviados == [("[HCM] ", 1), ("[RYMO] ", 1), ("[HCM · Sulfite] ", 1)]
