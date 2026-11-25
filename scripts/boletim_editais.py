# -*- coding: utf-8 -*-
# Boletim diario de editais - versao para rodar no GitHub Actions (nuvem),
# em vez de na maquina do usuario. Mesma logica do busca_editais.py original,
# so mudou onde fica o "historico de editais ja vistos": agora vai em
# data/editais_vistos.json, dentro do repositorio, e o proprio workflow
# do GitHub Actions commita esse arquivo de volta a cada execucao - assim
# o historico persiste de um dia para o outro mesmo rodando num runner novo
# toda vez.
import os
import re
import json
import html
import time
import socket
import unicodedata
import smtplib
import urllib.request
import urllib.parse
import urllib.error
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from email.header import Header
from datetime import date, datetime, timedelta, timezone

PASTA_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_DADOS = os.path.join(PASTA_REPO, "data")
BASE_URL = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta"
ARQUIVO_HISTORICO = os.path.join(DIR_DADOS, "editais_vistos.json")
USER_AGENT_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

NOME_REMETENTE = "LicitaPlena - Alertas de Editais"
# Envio: SÓ pelo ZeptoMail (ZEPTOMAIL_TOKEN, o mesmo dos lembretes e do site), remetente boletim@licitaplena.com.br.
# Decisão do dono (23/11): o boletim nunca mais sai do Gmail pessoal. Falha do ZeptoMail = mais uma tentativa depois de
# ESPERA_ZEPTO_SEGUNDOS; se falhar de novo, o erro vai para o log e para logs_boletim, sem trocar de remetente.
# Variáveis de ambiente:
#   ZEPTOMAIL_TOKEN (obrigatória)       Send Mail token do Agent do ZeptoMail (com ou sem o prefixo "Zoho-enczapikey").
#   SUPABASE_SERVICE_ROLE_KEY (obrig.)  histórico, clientes, edições e logs.
#   BOLETIM_GMAIL_RESERVA (padrão vazio = desligado)  "1" liga a reserva pelo Gmail SMTP (EMAIL_REMETENTE e
#                                       EMAIL_SENHA_APP) depois das 2 falhas do ZeptoMail. Só para emergência.
#   BOLETIM_SOMENTE_EMAIL (padrão vazio) modo de teste: manda só para as contas com esse e-mail e não grava nada
#                                       (sem marcar editais como vistos, sem criar/numerar edição, sem logs_boletim,
#                                       sem Prospecta e sem WhatsApp). Input "somente_email" do workflow.
#   JORNAIS_SEMPRE (padrão vazio)       "1" manda os jornais em qualquer rodada (testes).
ZEPTOMAIL_URL = "https://api.zeptomail.com/v1.1/email"
TENTATIVAS_ZEPTO = 2
ESPERA_ZEPTO_SEGUNDOS = 15
# Remetente do boletim (domínio verificado no ZeptoMail; não precisa de caixa). Respostas vão ao dono (Reply-To).
REMETENTE_ZEPTO = "boletim@licitaplena.com.br"
NOME_ZEPTO = "LicitaPlena Boletim"
RESPONDER_PARA = "licitaplena@licitaplena.com.br"

TODAS_UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
             "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]

# ---- DESTINATARIOS (edite aqui so pra casos manuais, fora do fluxo normal do painel) ----
# Qualquer cliente aprovado no admin (Supabase) ja entra sozinho via carregar_clientes_aprovados(),
# usando o segmento/estado que ELE configurou em "Minha conta" - nao duplique o e-mail dele aqui
# tambem, porque um e-mail que aparecer nos dois lugares usa so a entrada fixa (ve montar_lista_
# destinatarios() abaixo) e ignora silenciosamente o que a pessoa configurou no painel. Foi
# exatamente isso que causou o Harreson (cadastrado no Supabase so com AM) receber editais de
# RR: sobrava aqui uma entrada fixa antiga dele com ["AM", "RR"]. Removida.
# ufs: lista de siglas (ex: ["AM","RR"]) ou None para buscar em todo o Brasil
# palavras_chave: use radicais de palavra (sem plural/genero fixo) para pegar mais variacoes
#
# whatsapp (opcional): alem do e-mail, tambem manda um resumo por WhatsApp via CallMeBot
# (API gratuita, nao-oficial). Pra ativar pra um destinatario:
#   1) Salve o numero +34 644 59 71 40 nos contatos do WhatsApp do destinatario.
#   2) Do WhatsApp desse numero, mande a mensagem: "I allow callmebot to send me messages"
#      pro contato salvo no passo 1.
#   3) O bot responde com um "apikey" (numero). Cole esse apikey aqui embaixo.
#   4) Preencha "telefone" com o numero completo do destinatario, com DDI+DDD, sem
#      espacos/traco/parenteses (ex: "5592912345678" pra um numero de Manaus/AM).
# Se "whatsapp" for None, o boletim desse destinatario continua indo so por e-mail.
DESTINATARIOS = []
# ---------------------------------------------------------------------

# Alem da lista fixa acima, o boletim tambem manda pra clientes aprovados no painel
# de admin (tabela public.clientes no Supabase, status="aprovado" - ver admin.html).
# Cada cliente escolhe um ou mais "segmento" no cadastro (lista fechada, ver
# SEGMENTOS_CADASTRO em cadastro.html); o mapa abaixo traduz cada segmento pros
# radicais de palavra que o filtro do boletim usa. Ajuste os radicais aqui se um
# segmento estiver trazendo edital errado ou de menos.
SEGMENTO_PARA_PALAVRAS_CHAVE = {
    "AGROPECUÁRIO": ["agropecuari", "agricola", "rural", "pecuaria", "fertilizante", "semente", "racao"],
    "ALIMENTAÇÃO": ["aliment", "merenda", "refeicao", "hortifruti", "genero aliment"],
    "ARMAZENAGEM": ["armazen", "deposito", "estoc", "prateleira"],
    "ASSESSORIAS": ["assessoria", "consultoria", "auditoria", "juridic", "contabil"],
    "CARTÕES": ["cartao"],
    "COMBUSTÍVEIS": ["combustivel", "gasolina", "diesel", "etanol", "gnv"],
    "COMUNICAÇÃO/IDENTIFICAÇÃO VISUAL": ["comunicacao visual", "sinalizacao", "placa", "adesivo", "grafica"],
    "CONCESSÕES/EXPLORAÇÃO/IMÓVEL": ["concessao", "locacao de imovel", "imobiliari"],
    "CONFECÇÕES/DECORAÇÃO": ["confeccao", "uniforme", "tecido", "decoracao", "enxoval"],
    "DIDÁTICO": ["didatico", "material escolar", "livro", "apostila"],
    "ELETRO ELETRÔNICOS/ÓTICA": ["eletroeletronic", "eletronico", "otica", "oculos"],
    "EMBALAGENS E LACRES": ["embalagem", "lacre"],
    "ENGENHARIA - Materiais": ["material de construcao", "cimento", "concreto", "ferragem"],
    "ENGENHARIA - Serviços": ["engenharia", "obra", "reforma", "construcao civil", "pavimentacao"],
    "EQUIPAMENTOS/FERRAMENTAS": ["equipamento", "ferramenta", "maquinario"],
    "ESCRITÓRIO E GRÁFICA": ["material de escritorio", "papelaria", "expediente", "grafica"],
    "ESPECIALIZADOS": [],  # generico demais - sem radical proprio, revise o cadastro manualmente
    "ESPORTIVOS/MUSICAIS": ["esportivo", "instrumento musical", "academia"],
    "EVENTOS": ["evento", "cerimonial"],
    "FERROVIÁRIOS": ["ferroviari"],
    "FUNERÁRIA": ["funerari", "funeral"],
    "HOSPEDAGEM": ["hospedagem", "hotel", "pousada"],
    "INFANTIL/PLAYGROUND": ["infantil", "playground", "brinquedo"],
    "INFORMÁTICA": ["informatica", "computador", "software", "notebook"],
    "INSTALAÇÕES": ["instalacao eletric", "instalacao hidraulic", "ar condicionado", "manutencao predial"],
    "LEILÕES": ["leilao"],
    "MOBILIÁRIOS": ["mobiliari", "movel planejado", "cadeira", "armario"],
    "PASSAGENS": ["passagem aerea", "passagem rodoviaria"],
    "PETROBRAS": ["petrobras", "petroleo"],
    "PRESTAÇÃO DE SERVIÇOS - Mão de Obra": ["mao de obra", "terceirizacao", "prestacao de servico"],
    "PRODUTOS DE LIMPEZA": ["limpeza", "higiene", "produto de limpeza"],
    "PUBLICIDADE": ["publicidade", "propaganda", "midia"],
    "QUÍMICOS": ["quimico", "reagente"],
    "SAÚDE": ["hospitalar", "saude", "medic", "medicament", "farmaceutic", "enfermagem", "clinic", "odontolog"],
    "SEGURANÇA/PROTEÇÃO": ["seguranca", "vigilancia", "alarme", "cftv"],
    "SEGUROS": ["seguro"],
    "SISTEMA DE VALES": ["vale alimentacao", "vale refeicao", "vale transporte", "cartao beneficio"],
    "TRANSPORTES AÉREOS": ["transporte aereo", "aviacao", "aeronave"],
    "TRANSPORTES NÁUTICOS": ["transporte nautico", "embarcacao", "naval"],
    "TRANSPORTES RODOVIÁRIOS": ["transporte rodoviario", "veiculo", "onibus", "frete"],
}


def mascarar_email(texto):
    # LGPD: o log do Actions é público (repositório público). "fulano@gmail.com" vira "fu***@gmail.com".
    return re.sub(r"([\w.+-]{1,2})[\w.+-]*@([\w-]+\.[\w.]+)", r"\1***@\2", str(texto))


def log(msg):
    linha = "[" + datetime.now().strftime("%d/%m/%Y %H:%M:%S") + "] " + mascarar_email(msg)
    print(linha, flush=True)
def hoje_e_feriado_nacional():
    try:
        import holidays
    except ImportError:
        log("AVISO: biblioteca 'holidays' nao encontrada, pulando checagem de feriado.")
        return None
    hoje = date.today()
    feriados_br = holidays.Brazil()
    if hoje in feriados_br:
        return feriados_br.get(hoje)
    return None


# O historico de editais ja vistos costumava ficar em data/editais_vistos.json,
# commitado no git a cada execucao do robo - isso disparava uma publicacao completa
# do site no Netlify toda vez (mesmo o historico sendo so um arquivinho de controle
# interno que ninguem ve). Agora ele mora na tabela public.dados_robo do Supabase
# (mesmo padrao usado pelos robos em Node - ver scripts/supabase_dados.js), entao
# o robo do boletim para de fazer commit/push no repositorio.
SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co"


def _chave_servico():
    chave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not chave:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY nao configurada (Settings > Secrets and "
            "variables > Actions no repositorio do GitHub)."
        )
    return chave


def carregar_historico():
    chave = _chave_servico()
    url = SUPABASE_URL + "/rest/v1/dados_robo?chave=eq.editais_vistos&select=dado"
    req = urllib.request.Request(url, headers={
        "apikey": chave,
        "Authorization": "Bearer " + chave,
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            linhas = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log("AVISO: falha ao carregar historico do Supabase (" + str(e) + "), comecando vazio.")
        return {}
    if not linhas:
        return {}
    dados = linhas[0].get("dado")
    if isinstance(dados, list):
        novo = {}
        for d in DESTINATARIOS:
            novo[d["email"]] = list(dados)
        return novo
    return dados or {}


def salvar_historico(vistos):
    chave = _chave_servico()
    url = SUPABASE_URL + "/rest/v1/dados_robo?on_conflict=chave"
    corpo = json.dumps([{
        "chave": "editais_vistos",
        "dado": vistos,
        "atualizado_em": datetime.utcnow().isoformat() + "Z",
    }]).encode("utf-8")
    req = urllib.request.Request(url, data=corpo, method="POST", headers={
        "apikey": chave,
        "Authorization": "Bearer " + chave,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        resp.read()


def carregar_clientes_aprovados():
    # Cliente aprovado no painel de admin (public.clientes, status="aprovado") passa a
    # entrar no boletim automaticamente - sem precisar editar DESTINATARIOS a mao. Se o
    # cadastro dele nao tiver segmento ou estado de interesse definido, ele fica de fora
    # (com aviso no log) ate o cadastro ser completado, em vez de mandar edital de
    # qualquer UF/assunto pra ele.
    chave = _chave_servico()
    url = (SUPABASE_URL + "/rest/v1/clientes?status=eq.aprovado"
           "&select=id,nome,empresa,email,segmento,estados_interesse")
    req = urllib.request.Request(url, headers={
        "apikey": chave,
        "Authorization": "Bearer " + chave,
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            clientes = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log("AVISO: falha ao carregar clientes aprovados do Supabase (" + str(e) + ").")
        return []

    destinatarios = []
    for c in clientes:
        email = (c.get("email") or "").strip()
        nome = (c.get("empresa") or c.get("nome") or email or "Cliente").strip()
        if not email:
            continue

        palavras = []
        for seg in (c.get("segmento") or []):
            palavras.extend(SEGMENTO_PARA_PALAVRAS_CHAVE.get(seg, []))
        palavras = list(dict.fromkeys(palavras))  # remove duplicatas mantendo a ordem
        if not palavras:
            log("AVISO: cliente '" + nome + "' (" + email + ") aprovado mas sem segmento "
                "reconhecido no cadastro - boletim nao enviado pra ele ate o cadastro ser revisado.")
            continue

        estados = c.get("estados_interesse") or []
        if not estados:
            log("AVISO: cliente '" + nome + "' (" + email + ") aprovado mas sem estado de "
                "interesse definido no cadastro - boletim nao enviado pra ele ate o cadastro ser revisado.")
            continue
        ufs = None if len(estados) >= len(TODAS_UFS) else estados

        destinatarios.append({
            "id": c.get("id"),
            "nome": nome,
            "email": email,
            "ufs": ufs,
            "palavras_chave": palavras,
            "whatsapp": None,
        })
    return destinatarios


# ---- Boletim por empresa e jornais (filtros salvos com nome) ----
# Pedido do dono (19-20/11): cada empresa (CNPJ) da organizacao tem o proprio filtro do Boletim
# (tabela boletim_filtros_empresa, supabase/boletim_por_empresa.sql) e recebe um e-mail proprio, com o
# nome da empresa no assunto. Quem ja tem filtro por empresa deixa de receber o boletim antigo da conta
# (segmento do cadastro). Cada filtro salvo com o e-mail ligado (filtro.jornal = true) vira mais um
# e-mail diario separado, so na primeira rodada do dia e so quando ha licitacao nova.
HORA_LIMITE_JORNAIS = int(os.environ.get("HORA_LIMITE_JORNAIS", "10"))  # rodada das 06h de Brasilia


def _get_json(caminho):
    chave = _chave_servico()
    req = urllib.request.Request(SUPABASE_URL + "/rest/v1/" + caminho, headers={"apikey": chave, "Authorization": "Bearer " + chave})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _clientes_aprovados_por_id(ids):
    ids = sorted({i for i in ids if i})
    if not ids:
        return {}
    linhas = _get_json("clientes?status=eq.aprovado&select=id,nome,empresa,email&id=in.(" + ",".join(ids) + ")")
    return {c["id"]: c for c in linhas if (c.get("email") or "").strip()}


def _palavras_do_texto(texto):
    return [p.strip() for p in str(texto or "").split(",") if p.strip()]


def _ufs_do_filtro(filtro):
    ufs = [str(u).upper() for u in (filtro.get("ufs") or []) if str(u).upper() in TODAS_UFS]
    return ufs or None


def carregar_boletins_por_empresa():
    # Devolve (destinatarios, ids de clientes que ja usam boletim por empresa). Sem a tabela, ([], set()).
    try:
        linhas = _get_json("boletim_filtros_empresa?select=empresa_id,cliente_id,filtro,operacao_empresas(razao_social,ativo)")
        clientes = _clientes_aprovados_por_id([l.get("cliente_id") for l in linhas])
    except Exception as e:
        log("AVISO: boletim por empresa indisponivel (" + str(e) + "); seguindo so com o boletim da conta.")
        return [], set()
    destinatarios = []
    for l in linhas:
        empresa = l.get("operacao_empresas") or {}
        c = clientes.get(l.get("cliente_id"))
        palavras = _palavras_do_texto((l.get("filtro") or {}).get("palavrasRaw"))
        if not c or not palavras or empresa.get("ativo") is False:
            continue
        nome_empresa = (empresa.get("razao_social") or "Empresa").strip()
        destinatarios.append({
            "id": c["id"], "nome": nome_empresa, "email": c["email"].strip(), "ufs": _ufs_do_filtro(l.get("filtro") or {}),
            "palavras_chave": palavras, "whatsapp": None,
            "chave_historico": "empresa:" + str(l.get("empresa_id")),
        })
    return destinatarios, {d["id"] for d in destinatarios}


def carregar_jornais():
    try:
        try:
            linhas = _get_json("filtros_salvos?select=id,nome,filtro,cliente_id,empresa_id,operacao_empresas(razao_social)&filtro->>jornal=eq.true&limit=2000")
        except urllib.error.HTTPError:
            linhas = _get_json("filtros_salvos?select=id,nome,filtro,cliente_id&filtro->>jornal=eq.true&limit=2000")  # sem boletim_por_empresa.sql
        clientes = _clientes_aprovados_por_id([l.get("cliente_id") for l in linhas])
    except Exception as e:
        log("AVISO: jornais indisponiveis (" + str(e) + ").")
        return []
    jornais = []
    for l in linhas:
        c = clientes.get(l.get("cliente_id"))
        filtro = l.get("filtro") or {}
        if not c or not _palavras_do_texto(filtro.get("palavrasRaw")):
            continue
        empresa = ((l.get("operacao_empresas") or {}).get("razao_social") or "").strip()
        jornais.append({"id": l["id"], "nome": (l.get("nome") or "Jornal").strip(), "empresa": empresa, "filtro": filtro,
                        "cliente_id": c["id"], "email": c["email"].strip()})
    return jornais


# Mesmos nomes de portal-origem.js (o primeiro padrao que casar vence).
PORTAIS_ORIGEM = [
    (r"compras\.gov|comprasnet|comprasgov|siasg|cnetmobile", "Compras.gov.br"),
    (r"ecustomize|portal de compras publicas|portaldecompraspublicas", "Portal de Compras Públicas"),
    (r"licitanet", "Licitanet"), (r"\bbll\b", "BLL"), (r"bolsa nacional de compras|\bbnc\b", "BNC"),
    (r"bbmnet|\bbbm\b", "BBMNET"), (r"br ?conectado", "BR Conectado"),
    (r"licitacoes-e\b|licitacoes e bb|banco do brasil", "Licitações-e (BB)"), (r"licitar digital", "Licitar Digital"),
    (r"licita ?\+ ?brasil|licita mais brasil", "Licita+Brasil"), (r"licitacon", "LicitaCon (TCE-RS)"),
]
MODALIDADES_JORNAL = ["pregao", "dispensa", "concorrencia", "inexigibilidade", "credenciamento", "leilao"]
ME_EPP = re.compile(r"exclusiv\w*\b.{0,60}\b(me|epp|mei|microempresas?|pequeno porte)\b|\b(me|epp)\s*/\s*(me|epp)\b.{0,30}exclusiv")
SRP = re.compile(r"registro de precos?\b|\bsrp\b|\bata de registro\b")


def _norm(texto):
    return " ".join(_normalizar(texto).split())


def portal_do_edital(e):
    n = _norm(e.get("usuarioNome"))
    if not n:
        return None
    for padrao, nome in PORTAIS_ORIGEM:
        if re.search(padrao, n):
            return nome
    return (e.get("usuarioNome") or "").strip()[:80]


def _numero(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _distancia_km(a, b):
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(min(1, math.sqrt(h)))


_CENTROIDES = None


def _centroides():
    global _CENTROIDES
    if _CENTROIDES is None:
        with open(os.path.join(DIR_DADOS, "municipios-centroides.json"), encoding="utf-8") as f:
            _CENTROIDES = {(_norm(m[0]), m[1]): (m[2], m[3]) for m in json.load(f)["m"]}
    return _CENTROIDES


def _passa_no_jornal(e, f):
    objeto = _norm(e.get("objetoCompra"))
    unidade, orgao = e.get("unidadeOrgao") or {}, e.get("orgaoEntidade") or {}
    if not any(_norm(p) in objeto for p in _palavras_do_texto(f.get("palavrasRaw"))):
        return False
    if any(_norm(p) in objeto for p in _palavras_do_texto(f.get("excluir"))):
        return False
    if not all(_norm(p) in objeto for p in _palavras_do_texto(f.get("limitar"))):
        return False
    if f.get("municipio") and _norm(f["municipio"]) not in _norm(unidade.get("municipioNome")):
        return False
    if f.get("orgaoTexto") and _norm(f["orgaoTexto"]) not in _norm(orgao.get("razaoSocial")):
        return False
    esfera = {"F": "federal", "E": "estadual", "D": "estadual", "M": "municipal"}.get(orgao.get("esferaId"), "")
    if f.get("esfera") and esfera != f["esfera"]:
        return False
    valor = _numero(e.get("valorTotalEstimado"))
    if (f.get("valorMin") or f.get("valorMax")) and valor is None:
        return False
    if f.get("valorMin") and _numero(f["valorMin"]) is not None and valor < _numero(f["valorMin"]):
        return False
    if f.get("valorMax") and _numero(f["valorMax"]) is not None and valor > _numero(f["valorMax"]):
        return False
    modalidade = next((m for m in MODALIDADES_JORNAL if m in _norm(e.get("modalidadeNome"))), "")
    if f.get("modalidade") and modalidade != f["modalidade"]:
        return False
    if f.get("portal") and portal_do_edital(e) != f["portal"]:
        return False
    if f.get("mePp") is True and not ME_EPP.search(objeto):
        return False
    if f.get("excluirSrp") is True and (e.get("srp") is True or SRP.search(objeto)):
        return False
    raio = f.get("raio")
    if raio:
        origem = _centroides().get((_norm(raio.get("municipio")), raio.get("uf")))
        destino = _centroides().get((_norm(unidade.get("municipioNome")), unidade.get("ufSigla")))
        if not origem or not destino or _distancia_km(origem, destino) > float(raio.get("km") or 0):
            return False
    return True


def filtrar_jornal(editais, filtro):
    return [e for e in filtrar_por_uf_exata(editais, _ufs_do_filtro(filtro)) if _passa_no_jornal(e, filtro)]


def e_rodada_dos_jornais(agora=None):
    agora = agora or datetime.now(timezone(timedelta(hours=-3)))
    return os.environ.get("JORNAIS_SEMPRE") == "1" or agora.hour < HORA_LIMITE_JORNAIS


def montar_lista_destinatarios():
    dinamicos = carregar_clientes_aprovados()
    por_empresa, com_empresa = carregar_boletins_por_empresa()
    emails_fixos = {d["email"].strip().lower() for d in DESTINATARIOS}
    # Quem ja tem filtro por empresa recebe um boletim por empresa no lugar do boletim da conta.
    extras = [d for d in dinamicos if d["email"].strip().lower() not in emails_fixos and d.get("id") not in com_empresa]
    return DESTINATARIOS + extras + por_empresa


def data_final_busca():
    # dataFinal filtra pelo prazo de encerramento da proposta (nao pela data de hoje).
    # Usar so a data de hoje faz a API devolver apenas editais que encerram HOJE.
    # Estendendo a janela pegamos todos os editais com proposta aberta atualmente.
    from datetime import timedelta
    return (date.today() + timedelta(days=365)).strftime("%Y%m%d")


def buscar_pagina(uf, pagina):
    params = {
        "uf": uf,
        "dataFinal": data_final_busca(),
        "pagina": pagina,
        "tamanhoPagina": 50,
    }
    url = BASE_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": USER_AGENT_NAVEGADOR,
    })
    tentativas_429 = 0
    esperas_retry = [3, 6, 12, 24]
    tentativas_retry = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                corpo = resp.read().decode("utf-8")
            if not corpo.strip():
                return {"data": [], "totalPaginas": 1}
            return json.loads(corpo)
        except urllib.error.HTTPError as e:
            if e.code == 429 and tentativas_429 < 5:
                tentativas_429 += 1
                time.sleep(3 * tentativas_429)
                continue
            if e.code == 503 and tentativas_retry < len(esperas_retry):
                time.sleep(esperas_retry[tentativas_retry])
                tentativas_retry += 1
                continue
            raise
        except (socket.timeout, urllib.error.URLError) as e:
            if tentativas_retry < len(esperas_retry):
                time.sleep(esperas_retry[tentativas_retry])
                tentativas_retry += 1
                continue
            raise


def buscar_todos_editais(uf):
    editais = []
    pagina = 1
    while True:
        try:
            dados = buscar_pagina(uf, pagina)
        except urllib.error.HTTPError as e:
            if e.code == 422:
                break
            raise
        itens = dados.get("data", [])
        if not itens:
            break
        editais.extend(itens)
        total_paginas = dados.get("totalPaginas", 1)
        if pagina >= total_paginas:
            break
        pagina += 1
        time.sleep(0.4)
    return editais


def buscar_pool_por_uf(lista_ufs):
    pool = {}
    for uf in lista_ufs:
        log("Buscando editais em " + uf + "...")
        try:
            pool[uf] = buscar_todos_editais(uf)
        except Exception as e:
            log("ERRO ao buscar UF " + uf + ": " + str(e))
            pool[uf] = []
        time.sleep(1.2)
    return pool


def _normalizar(texto):
    texto = texto or ""
    nfkd = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    return sem_acento.lower()


def filtrar_por_palavra_chave(editais, palavras):
    if not palavras:
        return editais
    resultado = []
    for e in editais:
        objeto = _normalizar(e.get("objetoCompra") or "")
        for p in palavras:
            if _normalizar(p) in objeto:
                resultado.append(e)
                break
    return resultado


# O boletim diario deve trazer so os editais publicados recentemente
# (nao todos os que ainda estao com proposta aberta, que pode incluir
# coisa publicada semanas atras). A busca no PNCP usa uma janela grande
# de dataFinal so para conseguir enxergar tudo que esta aberto; aqui a
# gente filtra pela data de publicacao para o e-mail ficar so com o que
# e novidade de fato.
DIAS_PUBLICACAO_BOLETIM = 2


def filtrar_por_publicacao_recente(editais, dias=DIAS_PUBLICACAO_BOLETIM, agora=None):
    fuso_brasilia = timezone(timedelta(hours=-3))
    agora = agora or datetime.now(fuso_brasilia)
    agora = agora.replace(tzinfo=fuso_brasilia) if agora.tzinfo is None else agora.astimezone(fuso_brasilia)
    limite = agora - timedelta(days=dias)
    # Na segunda, recupera também a sexta inteira, que ficava fora das 48 horas.
    if agora.weekday() == 0:
        sexta = (agora - timedelta(days=3)).replace(hour=0, minute=0, second=0, microsecond=0)
        limite = min(limite, sexta)
    resultado = []
    for e in editais:
        data_str = e.get("dataPublicacaoPncp") or e.get("dataInclusao")
        if not data_str:
            continue
        try:
            data_pub = datetime.fromisoformat(data_str.replace("Z", "+00:00"))
            if data_pub.tzinfo is None:
                data_pub = data_pub.replace(tzinfo=fuso_brasilia)
        except ValueError:
            continue
        if data_pub >= limite:
            resultado.append(e)
    return resultado


def filtrar_por_uf_exata(editais, ufs):
    # Camada de seguranca extra: o parametro "uf" que mandamos pro PNCP ja deveria
    # restringir a busca, mas essa API publica nem sempre e 100% confiavel nesse filtro.
    # Antes de mandar pro cliente, reconferimos a UF de cada edital de verdade (nunca
    # confiar so no que a API disse que filtrou) - evita um cliente de UF restrita
    # (ex: so AM) receber edital de outro estado por falha silenciosa da fonte.
    if not ufs:
        return editais
    ufs_normalizadas = {str(uf).strip().upper() for uf in ufs}
    resultado = []
    for e in editais:
        uf_edital = ((e.get("unidadeOrgao") or {}).get("ufSigla") or "").strip().upper()
        if uf_edital in ufs_normalizadas:
            resultado.append(e)
    return resultado


def montar_link_pncp(e):
    m = re.match(r"^(\d{14})-\d+-(\d+)/(\d{4})$", e.get("numeroControlePNCP") or "")
    if m:
        cnpj, seq, ano = m.group(1), str(int(m.group(2))), m.group(3)
        return "https://pncp.gov.br/app/editais/" + cnpj + "/" + ano + "/" + seq
    return "https://pncp.gov.br"


def link_pncp(e):
    return montar_link_pncp(e)


def link_origem_valido(e):
    link_origem = e.get("linkSistemaOrigem")
    if not link_origem:
        return None
    link_origem = link_origem.strip()
    if not link_origem or link_origem.lower() in ("http://", "https://"):
        return None
    if not link_origem.startswith("http"):
        link_origem = "https://" + link_origem
    return link_origem


def formatar_valor(v):
    if not v:
        return "Nao informado"
    return "R$ " + "{:,.2f}".format(v).replace(",", "X").replace(".", ",").replace("X", ".")


# O e-mail do boletim e so um AVISO (decisao do dono, igual ConLicitacao/Effecti): quantas
# licitações chegaram e um botao para o painel. A lista dos editais fica no painel, que exige
# login; por isso nada de edital no corpo (nem no texto puro) e nada pessoal na URL.
URL_PAINEL = "https://licitaplena.com.br/painel.html"
FILTRO_ID_PADRAO = "principal"
# Paleta A (23/11), a mesma de lembretes_licitacoes.py: marinho no topo, royal no botão, ciano só como fio de destaque.
MARINHO, ROYAL, CIANO, CLARO = "#0A1B4F", "#1F4FD8", "#22D3EE", "#F2F7FF"


FUSO_BRASILIA = timezone(timedelta(hours=-3))  # Brasilia sem horario de verao desde 2019
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def agora_brasilia():
    return datetime.now(FUSO_BRASILIA)


def hoje_brasilia():
    return agora_brasilia().date()


def data_por_extenso(d):
    return str(d.day) + " de " + MESES[d.month - 1] + " de " + str(d.year)


def montar_link_boletim(edicao, filtro_id=FILTRO_ID_PADRAO):
    # So data e id do filtro na URL: sem e-mail, CPF/CNPJ ou token.
    params = urllib.parse.urlencode({"edicao": edicao.isoformat(), "filtro": filtro_id})
    return URL_PAINEL + "?" + params + "#boletim"


def nome_filtro(destinatario):
    return ", ".join((destinatario.get("palavras_chave") or [])[:3]) or "Meu filtro"


def _titulo_quantidade(quantidade):
    if quantidade == 1:
        return "Chegou 1 nova licitação"
    return "Chegaram " + str(quantidade) + " novas licitações"


def montar_assunto(numero, agora):
    # Pedido do dono (23/11): "[<edição>] Boletim LicitaPlena de <data>, <hora>", como o ConLicitação. Sem número
    # (destinatário fixo ou falha ao gravar a edição) o assunto sai sem os colchetes.
    return (("[" + str(numero) + "] ") if numero else "") + "Boletim LicitaPlena de " + data_por_extenso(agora) + ", " + agora.strftime("%H:%M")


def _data_brasilia(valor):
    # timestamptz do PostgREST ("2026-12-07T13:00:00.12345+00:00"): tira a fração, que o fromisoformat antigo recusa.
    texto = re.sub(r"\.\d+", "", str(valor)).replace("Z", "+00:00")
    d = datetime.fromisoformat(texto)
    return (d.astimezone(FUSO_BRASILIA) if d.tzinfo else d).date()


def montar_vigencia(assinatura, hoje):
    # Linha "Vigência da assinatura" do cabeçalho (supabase/planos_e_recursos.sql). Sem dado confiável: None (a linha some).
    if not assinatura:
        return None
    plano = ((assinatura.get("planos") or {}).get("nome") or "Assinatura").strip()
    situacao = assinatura.get("situacao")
    try:
        if situacao == "teste" and assinatura.get("teste_ate"):
            ate = _data_brasilia(assinatura["teste_ate"])
            return ("Teste grátis até " if ate >= hoje else "Teste grátis encerrado em ") + data_por_extenso(ate)
        if situacao in ("ativa", "vencida") and assinatura.get("vence_em"):
            vence = date.fromisoformat(str(assinatura["vence_em"])[:10])
            return plano + (", válida até " if vence >= hoje else ", venceu em ") + data_por_extenso(vence)
    except ValueError:
        return None
    if situacao == "ativa":
        return plano + ", sem data de vencimento"
    return None


def carregar_cabecalhos(ids, hoje=None):
    # {cliente_id: {"codigo", "responsavel", "vigencia"}} para o cabeçalho do e-mail. Sem o SQL de 23/11
    # (coluna clientes.codigo) ou com erro: {} e o e-mail sai só sem esses dados.
    ids = sorted({i for i in ids if i})
    if not ids:
        return {}
    hoje = hoje or hoje_brasilia()
    lista = ",".join(ids)
    try:
        clientes = _get_json("clientes?select=id,nome,codigo&id=in.(" + lista + ")")
        # planos!assinaturas_plano_fkey: assinaturas tem 2 chaves para planos (plano e plano_solicitado); sem dizer qual,
        # o PostgREST responde 300 (Multiple Choices) e o boletim saiu sem cabeçalho de 21 a 23/11.
        assinaturas = _get_json("assinaturas?select=usuario_id,situacao,teste_ate,vence_em,planos!assinaturas_plano_fkey(nome)&usuario_id=in.(" + lista + ")")
    except Exception as e:
        log("AVISO: dados do cabecalho do boletim indisponiveis (" + str(e) + ").")
        return {}
    # shortcut: colaborador convidado não tem assinatura própria e fica sem a linha de vigência; ler a do titular se pedirem.
    por_id = {a.get("usuario_id"): a for a in assinaturas}
    return {c["id"]: {"codigo": c.get("codigo"), "responsavel": (c.get("nome") or "").strip(),
                      "vigencia": montar_vigencia(por_id.get(c["id"]), hoje)} for c in clientes if c.get("id")}


URL_LOGO = "https://licitaplena.com.br/logo.png"  # PNG branco 1000x1000, publicado por montar_publico.js (SVG nao abre no Gmail/Outlook)
URL_AJUSTAR_FILTROS = URL_PAINEL + "#boletim"
EMAIL_SUPORTE = "licitaplena@licitaplena.com.br"  # mesmo contato do site; WhatsApp de supabase-config.js ainda vazio
URL_PRIVACIDADE = "https://licitaplena.com.br/politica-privacidade.html"
# Texto próprio (23/11), com as mesmas garantias do boletim do ConLicitação: não substitui a publicação oficial,
# obrigação de meio, uso exclusivo do cliente identificado; mais LGPD e como parar de receber.
POLITICA_USO = [
    "Este boletim é um serviço de informação: reúne avisos de licitação publicados em fontes oficiais e incluídos na nossa base. "
    "Ele não substitui o edital nem a publicação oficial. Antes de participar, confira prazos, exigências e alterações no portal do órgão.",
    "Nosso compromisso é buscar e organizar as informações com cuidado (obrigação de meio). Não garantimos que todas as licitações "
    "sejam encontradas e não respondemos pelo resultado das disputas, que depende de cada participante e de cada órgão.",
    "O conteúdo é de uso exclusivo do cliente identificado acima e da sua equipe. Não é permitido repassar, reproduzir ou vender "
    "este boletim a terceiros.",
    "Usamos seu nome, e-mail, empresa e filtros só para montar e enviar este boletim, conforme a Lei Geral de Proteção de Dados "
    "(Lei nº 13.709/2018) e a nossa Política de Privacidade. Para parar de receber, use \"Parar ou gerenciar avisos\" abaixo ou "
    "escreva para o e-mail de apoio.",
]
RODAPE_EMPRESA = "LicitaPlena, uma solução HC Licitações, desenvolvida e operada pela HCM LTDA, CNPJ nº 28.786.260/0001-53, Manaus/AM."


def montar_resumo(editais):
    # So numeros, nunca o objeto dos editais: o e-mail continua sendo apenas um aviso.
    editais = editais or []
    partes = []
    ufs = {}
    for e in editais:
        uf = ((e.get("unidadeOrgao") or {}).get("ufSigla") or "").strip().upper()
        if uf:
            ufs[uf] = ufs.get(uf, 0) + 1
    for uf, n in sorted(ufs.items(), key=lambda x: (-x[1], x[0]))[:3]:
        partes.append(str(n) + " em " + uf)
    exclusivas = sum(1 for e in editais if ME_EPP.search(_norm(e.get("objetoCompra") or "")))
    if exclusivas:
        partes.append(str(exclusivas) + (" exclusiva ME/EPP" if exclusivas == 1 else " exclusivas ME/EPP"))
    valores = [v for v in (_numero(e.get("valorTotalEstimado")) for e in editais) if v]
    if valores:
        partes.append("maior valor " + formatar_valor(max(valores)))
    return partes


def _linhas_cabecalho(nome_empresa, filtro, cab):
    # Bloco do cliente, na ordem do boletim do ConLicitação. Linha sem dado não aparece.
    return [(rotulo, valor) for rotulo, valor in [
        ("Identificação do cliente", cab.get("codigo")), ("Empresa", nome_empresa), ("Filtro", filtro),
        ("Vigência da assinatura", cab.get("vigencia"))] if valor]


def _processado(cab):
    agora = cab.get("processado_em")
    return (data_por_extenso(agora) + ", " + agora.strftime("%H:%M")) if agora else ""


# Layout de 23/11 (dono: no Gmail do computador estava "bagunçado" e no Gmail escuro do iPhone a faixa e o botão
# viravam lilás). Coluna única de 600px em tabelas com estilo inline (Gmail/Outlook) e fontes do sistema. Mesmo
# arranjo do ConLicitação: faixa "Edição nº / Data do processamento", identificação do cliente em 2 colunas,
# "Aos cuidados de" e o botão.
# 25/11 (print do dono, Gmail iOS escuro): o Gmail calcula a cor do texto contra o background-color invertido e
# ignora o background-image, então texto branco sobre marinho "protegido" virava escuro sobre escuro. Cabeçalho e
# faixa passam a ser claros com texto marinho: o Gmail inverte os dois juntos e o texto continua legível. O marinho
# protegido fica só no quadrado da logo (imagem branca, que o Gmail não mexe).
FONTE_EMAIL = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
COR_TEXTO, COR_ROTULO, COR_LINHA, COR_CORPO = "#14213D", "#4A5878", "#DCE5F5", "#2B3A5C"


def _fundo_fixo(cor):
    # Cor que o modo escuro do Gmail (iOS/Android) não inverte: a imagem de fundo é preservada.
    return "background-color:" + cor + ";background-image:linear-gradient(" + cor + "," + cor + ");"


def _botao(link, rotulo, cheio=True):
    fundo = _fundo_fixo(ROYAL) if cheio else "background-color:#ffffff;"
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            '<td align="center" bgcolor="' + (ROYAL if cheio else "#ffffff") + '" style="' + fundo + 'border-radius:999px;border:2px solid ' + ROYAL + ';">'
            '<a href="' + html.escape(link, quote=True) + '" class="lp-fixo" style="display:inline-block;' + FONTE_EMAIL
            + 'font-size:16px;font-weight:bold;line-height:20px;color:' + ("#ffffff" if cheio else ROYAL)
            + ';text-decoration:none;padding:13px 30px;border-radius:999px;">' + rotulo + '</a></td></tr></table>')


def montar_email_html(nome_empresa, filtro, edicao, quantidade, link, resumo=None, cab=None):
    esc = html.escape
    cab = cab or {}
    f = FONTE_EMAIL
    faixa = ""
    if cab.get("numero") or cab.get("processado_em"):
        celula = '<td valign="top" style="' + f + 'font-size:13px;line-height:19px;color:' + MARINHO + ';padding:10px 28px;">'
        faixa = ('<tr><td bgcolor="' + CLARO + '" style="background-color:' + CLARO + ';border-top:1px solid ' + COR_LINHA + ';">'
                 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
                 + (celula.replace('valign="top"', 'valign="top" width="1%"').replace('padding:10px 28px', 'white-space:nowrap;padding:10px 28px')
                    + '<span style="color:' + COR_ROTULO + ';">Edição nº</span><br><b style="color:' + MARINHO + ';font-size:15px;">'
                    + esc(str(cab["numero"])) + '</b></td>' if cab.get("numero") else "")
                 + (celula.replace('padding:10px 28px', 'padding:10px 28px 10px 0') + '<span style="color:' + COR_ROTULO + ';">Data do processamento</span><br>'
                    '<b style="color:' + MARINHO + ';font-size:15px;">' + esc(_processado(cab)) + '</b></td>' if cab.get("processado_em") else "")
                 + '</tr></table></td></tr>')
    linhas = _linhas_cabecalho(nome_empresa, filtro, cab)
    borda = 'border-bottom:1px solid ' + COR_LINHA + ';'
    identificacao = "".join(
        '<tr><td width="38%" valign="top" style="' + f + 'font-size:13px;line-height:20px;color:' + COR_ROTULO + ';padding:8px 12px 8px 0;'
        + (borda if i < len(linhas) - 1 else '') + '">' + esc(r) + '</td>'
        '<td valign="top" style="' + f + 'font-size:14px;line-height:20px;font-weight:bold;color:' + COR_TEXTO + ';padding:8px 0;'
        + (borda if i < len(linhas) - 1 else '') + '">' + esc(str(v)) + '</td></tr>'
        for i, (r, v) in enumerate(linhas))
    bloco_id = ('<tr><td style="padding:18px 28px 6px 28px;">'
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + identificacao + '</table></td></tr>')
    if cab.get("responsavel"):
        bloco_id += ('<tr><td style="' + f + 'font-size:15px;line-height:22px;color:' + COR_TEXTO + ';padding:14px 28px 0 28px;">'
                     'Aos cuidados de <b>' + esc(cab["responsavel"]) + '</b>,</td></tr>')
    separador = '<tr><td style="padding:18px 28px 0 28px;"><div style="border-top:1px solid ' + COR_LINHA + ';font-size:0;line-height:0;">&nbsp;</div></td></tr>'
    if quantidade:
        resumo_html = ""
        if resumo:
            resumo_html = ('<div style="' + f + 'font-size:14px;line-height:20px;color:' + COR_CORPO + ';padding:0 0 18px 0;">'
                           + esc(" · ".join(resumo)) + '</div>')
        corpo = (
            '<tr><td style="padding:22px 28px 28px 28px;">'
            '<div style="' + f + 'font-size:24px;line-height:30px;font-weight:bold;color:' + COR_TEXTO + ';padding:0 0 6px 0;">'
            + _titulo_quantidade(quantidade) + '</div>'
            '<div style="' + f + 'font-size:15px;line-height:22px;color:' + COR_CORPO + ';padding:0 0 12px 0;">no filtro <b>' + esc(filtro)
            + '</b> da empresa <b>' + esc(nome_empresa) + '</b> · edição de ' + edicao.strftime("%d/%m/%Y") + '</div>'
            + resumo_html + _botao(link, "Acessar o boletim") +
            '<div style="' + f + 'font-size:12px;line-height:18px;color:' + COR_ROTULO + ';padding:10px 0 0 0;">'
            'Você entra com seu login e vê a lista completa.</div></td></tr>'
        )
    else:
        corpo = (
            '<tr><td style="padding:22px 28px 28px 28px;">'
            '<div style="' + f + 'font-size:20px;line-height:26px;font-weight:bold;color:' + COR_TEXTO + ';padding:0 0 6px 0;">'
            'Nenhuma licitação nova desde o último aviso</div>'
            '<div style="' + f + 'font-size:15px;line-height:22px;color:' + COR_CORPO + ';padding:0 0 16px 0;">no filtro <b>' + esc(filtro)
            + '</b> da empresa <b>' + esc(nome_empresa) + '</b>.</div>' + _botao(URL_AJUSTAR_FILTROS, "Abrir o painel", cheio=False)
            + '</td></tr>'
        )
    estilo_link = 'color:' + COR_ROTULO + ';text-decoration:underline;'
    link_privacidade = '<a href="' + URL_PRIVACIDADE + '" style="' + estilo_link + '">Política de Privacidade</a>'
    itens = "".join(
        '<tr><td width="20" valign="top" style="' + f + 'font-size:12px;line-height:19px;font-weight:bold;color:' + COR_ROTULO + ';padding:0 0 10px 0;">'
        + str(i) + '.</td><td valign="top" style="' + f + 'font-size:12px;line-height:19px;color:' + COR_ROTULO + ';padding:0 0 10px 0;">'
        + esc(t).replace("Política de Privacidade", link_privacidade) + '</td></tr>'
        for i, t in enumerate(POLITICA_USO, 1))
    politica = (
        '<tr><td style="padding:0 28px 28px 28px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + CLARO + '" '
        'style="background-color:' + CLARO + ';border:1px solid ' + COR_LINHA + ';border-radius:6px;"><tr><td style="padding:16px 18px 8px 18px;">'
        '<div style="' + f + 'font-size:11px;font-weight:bold;letter-spacing:1px;color:' + COR_CORPO + ';padding:0 0 10px 0;">POLÍTICA DE USO E RESPONSABILIDADE</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + itens + '</table>'
        '<div style="' + f + 'font-size:12px;line-height:19px;color:' + COR_ROTULO + ';padding:0 0 8px 0;">Apoio: <a href="mailto:'
        + EMAIL_SUPORTE + '" style="' + estilo_link + '">' + EMAIL_SUPORTE + '</a></div></td></tr></table></td></tr>'
    )
    rodape = (
        '<tr><td align="center" style="' + f + 'font-size:12px;line-height:19px;color:' + COR_ROTULO + ';padding:20px 16px 0 16px;">'
        'Você recebe este aviso porque cadastrou o filtro <b>' + esc(filtro) + '</b> no LicitaPlena.<br>'
        '<a href="' + esc(URL_AJUSTAR_FILTROS, quote=True) + '" style="' + estilo_link + '">Ajustar meus filtros</a>'
        ' &nbsp;|&nbsp; '
        '<a href="' + esc(URL_AJUSTAR_FILTROS, quote=True) + '" style="' + estilo_link + '">Parar ou gerenciar avisos</a><br>'
        'Dúvidas? Escreva para <a href="mailto:' + EMAIL_SUPORTE + '" style="' + estilo_link + '">' + EMAIL_SUPORTE + '</a>.<br>'
        'Este é um aviso automático: não responda este e-mail.<br><br>'
        + esc(RODAPE_EMPRESA) + '</td></tr>'
    )
    return (
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">'
        '<title>LicitaPlena</title>'
        # Apple Mail/Outlook escuros respeitam isto; [data-ogsc] é o Outlook.com escuro. Texto da faixa e do botão fica branco.
        '<style>:root{color-scheme:light dark;supported-color-schemes:light dark;}'
        '@media (prefers-color-scheme: dark){.lp-fixo{color:#ffffff !important;}}'
        '[data-ogsc] .lp-fixo{color:#ffffff !important;}</style></head>'
        '<body style="margin:0;padding:0;background-color:' + CLARO + ';">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + CLARO + '"><tr>'
        '<td align="center" style="padding:24px 10px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">'
        '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:16px 28px;border-radius:14px 14px 0 0;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        '<td valign="middle" bgcolor="' + MARINHO + '" style="' + _fundo_fixo(MARINHO) + 'padding:5px;border-radius:9px;">'
        '<img src="' + URL_LOGO + '" width="30" height="30" alt="LicitaPlena" '
        'style="display:block;border:0;width:30px;height:30px;"></td>'
        '<td valign="middle" style="' + f + 'color:' + MARINHO + ';font-size:20px;font-weight:bold;padding-left:10px;">LicitaPlena</td>'
        '</tr></table></td></tr>' + faixa +
        '<tr><td height="3" bgcolor="' + CIANO + '" style="' + _fundo_fixo(CIANO) + 'font-size:0;line-height:0;height:3px;">&nbsp;</td></tr>'
        '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:0 0 14px 14px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        + bloco_id + separador + corpo + politica + '</table></td></tr>'
        + rodape + '</table></td></tr></table></body></html>'
    )


def montar_email_texto(nome_empresa, filtro, edicao, quantidade, link, resumo=None, cab=None):
    cab = cab or {}
    topo = "LicitaPlena\n"
    if cab.get("numero"):
        topo += "Edição nº " + str(cab["numero"]) + "\n"
    if cab.get("processado_em"):
        topo += "Data do processamento: " + _processado(cab) + "\n"
    topo += "\n" + "".join(r + ": " + str(v) + "\n" for r, v in _linhas_cabecalho(nome_empresa, filtro, cab))
    if cab.get("responsavel"):
        topo += "\nAos cuidados de " + cab["responsavel"] + ",\n"
    politica = ("\nPOLÍTICA DE USO E RESPONSABILIDADE\n" + "".join(str(i) + ". " + t + "\n" for i, t in enumerate(POLITICA_USO, 1))
                + "Política de Privacidade: " + URL_PRIVACIDADE + "\nApoio: " + EMAIL_SUPORTE + "\n")
    rodape = politica + ("\n--\nVocê recebe este aviso porque cadastrou o filtro " + filtro + " no LicitaPlena.\n"
              "Ajustar meus filtros ou parar os avisos: " + URL_AJUSTAR_FILTROS + "\n"
              "Dúvidas: " + EMAIL_SUPORTE + "\nAviso automático: não responda este e-mail.\n" + RODAPE_EMPRESA + "\n")
    if not quantidade:
        return (topo + "\nNenhuma licitação nova desde o último aviso no filtro " + filtro + " da empresa " + nome_empresa + ".\n"
                "Abrir o painel: " + URL_AJUSTAR_FILTROS + "\n" + rodape)
    return (topo + "\n" + _titulo_quantidade(quantidade) + " no filtro " + filtro + " da empresa " + nome_empresa + ".\n"
            "Edição de " + edicao.strftime("%d/%m/%Y") + ".\n"
            + ((" · ".join(resumo) + "\n") if resumo else "") + "\n"
            "Acessar o boletim: " + link + "\n" + rodape)


def destinatarios_do_teste(teste, destinatarios, jornais):
    # Devolve f(email, cliente_id) -> bool. Com "@": compara o e-mail; sem "@": compara o código do cliente.
    if "@" in teste:
        return lambda email, _id: (email or "").strip().lower() == teste
    ids = [d.get("id") for d in destinatarios] + [j.get("cliente_id") for j in jornais]
    codigos = {i: str(c.get("codigo") or "").strip().lower() for i, c in carregar_cabecalhos(ids).items()}
    return lambda _email, cid: bool(cid) and codigos.get(cid) == teste


def somente_email():
    # Modo de teste do workflow (input somente_email): e-mail em minúsculas, ou "" na rodada normal.
    return (os.environ.get("BOLETIM_SOMENTE_EMAIL") or "").strip().lower()


def registrar_log_boletim(destinatario, status, quantidade, mensagem_erro=None):
    # Cada tentativa de envio (sucesso, sem novidades ou erro) vira uma linha em
    # public.logs_boletim - e o que a secao "Envios do Boletim" do admin.html le.
    # Falha ao registrar o log nao pode derrubar o boletim, que ja foi enviado/tentado.
    if somente_email():
        return
    try:
        chave = _chave_servico()
        url = SUPABASE_URL + "/rest/v1/logs_boletim"
        corpo = json.dumps([{
            "cliente_id": destinatario.get("id"),
            "cliente_email": destinatario["email"],
            "cliente_nome": destinatario["nome"],
            "status": status,
            "quantidade_editais": quantidade,
            "mensagem_erro": mensagem_erro,
        }]).encode("utf-8")
        req = urllib.request.Request(url, data=corpo, method="POST", headers={
            "apikey": chave,
            "Authorization": "Bearer " + chave,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
    except Exception as e:
        log("AVISO: falha ao registrar log do boletim para " + destinatario["email"] + " (" + str(e) + ").")


def enviar_zeptomail(token, destino_email, nome_destinatario, assunto, texto, html_corpo):
    token = re.sub(r"^Zoho-enczapikey\s+", "", token.strip()).strip("\"'").strip()
    # 25/11: o nginx do ZeptoMail devolvia 400 em HTML (token inválido dá 401 em JSON), sinal de cabeçalho malformado:
    # token colado com quebra de linha, espaço ou caractere invisível no meio. O token é base64: fica só com esses caracteres
    # e registra no log o que foi descartado (sem mostrar o token).
    descartados = sorted({repr(c) for c in token if not re.match(r"[A-Za-z0-9+/=_.-]", c)})
    if descartados:
        log("AVISO: ZEPTOMAIL_TOKEN tinha caracteres estranhos (removidos): " + ", ".join(descartados))
        token = re.sub(r"[^A-Za-z0-9+/=_.-]", "", token)
    # Limites do ZeptoMail (TM_8001/SM_129): nome até 250 e assunto até 500 caracteres; nome vazio vai sem a chave,
    # como no envio do site (enviar-resumo-edital.js), em vez de "name": "" ou null.
    nome = (nome_destinatario or "").strip()[:250]
    destino = {"address": destino_email.strip(), **({"name": nome} if nome else {})}
    corpo = {
        "from": {"address": REMETENTE_ZEPTO, "name": NOME_ZEPTO},
        "reply_to": [{"address": RESPONDER_PARA, "name": "LicitaPlena"}],
        "to": [{"email_address": destino}],
        "subject": assunto[:500],
        "textbody": texto,
        "htmlbody": html_corpo,
    }
    req = urllib.request.Request(
        ZEPTOMAIL_URL, data=json.dumps(corpo).encode("utf-8"), method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": "Zoho-enczapikey " + token},
    )
    try:
        with urllib.request.urlopen(req, timeout=20):
            pass
    except urllib.error.HTTPError as e:
        # Remetente recusado (SM_111/SM_113 ou "from"/"sender"): a mensagem diz qual endereço confirmar no Agent.
        corpo_erro = e.read().decode("utf-8", "replace")
        # O motivo do 400 vem no corpo (código TM_/SM_ e mensagem): vai sempre para o log, sem nenhum e-mail.
        motivo = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "<e-mail>", corpo_erro)[:300]
        dica = ""
        if re.search(r"SM_111|SM_113|sender|domain", corpo_erro, re.I):
            dica = "remetente recusado pelo ZeptoMail: confirme " + REMETENTE_ZEPTO + " no Agent — "
        elif re.search(r"SM_128|SM_133", corpo_erro):
            dica = "conta do ZeptoMail ainda em análise ou no limite do teste — "
        e.msg = dica + (e.msg or "") + " — " + motivo
        raise


def enviar_gmail(destino_email, assunto, texto, html_corpo):
    remetente = os.environ["EMAIL_REMETENTE"]
    senha_app = os.environ["EMAIL_SENHA_APP"]
    msg = MIMEMultipart("alternative")
    msg["Subject"] = assunto
    msg["From"] = formataddr((str(Header(NOME_REMETENTE, "utf-8")), remetente))
    msg["To"] = destino_email
    msg["Reply-To"] = RESPONDER_PARA
    msg.attach(MIMEText(texto, "plain", "utf-8"))
    msg.attach(MIMEText(html_corpo, "html", "utf-8"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as servidor:
        servidor.login(remetente, senha_app)
        servidor.sendmail(remetente, [destino_email], msg.as_string())


def enviar_email(destino_email, nome_destinatario, editais_novos, filtro="", filtro_id=FILTRO_ID_PADRAO, cab=None):
    # Aviso curto: so a quantidade e o link do painel (a lista fica la, atras do login). cab: numero da edicao e
    # dados do cliente (carregar_cabecalhos); a hora do processamento e a de agora em Brasilia.
    quantidade = len(editais_novos)
    agora = agora_brasilia()
    edicao = agora.date()
    cab = dict(cab or {}, processado_em=agora)
    link = montar_link_boletim(edicao, filtro_id)
    assunto = montar_assunto(cab.get("numero"), agora)
    resumo = montar_resumo(editais_novos)
    texto = montar_email_texto(nome_destinatario, filtro, edicao, quantidade, link, resumo, cab)
    html_corpo = montar_email_html(nome_destinatario, filtro, edicao, quantidade, link, resumo, cab)
    token = os.environ.get("ZEPTOMAIL_TOKEN")
    erro = RuntimeError("ZEPTOMAIL_TOKEN nao configurado (Settings > Secrets and variables > Actions no GitHub).")
    for tentativa in range(1, TENTATIVAS_ZEPTO + 1) if token else []:
        try:
            enviar_zeptomail(token, destino_email, nome_destinatario, assunto, texto, html_corpo)
            return
        except Exception as e:
            erro = e
            # Tipo, código HTTP e motivo do ZeptoMail (já sem e-mail); nunca o token.
            log("ZeptoMail falhou (tentativa " + str(tentativa) + "/" + str(TENTATIVAS_ZEPTO) + ": " + type(e).__name__
                + " " + str(getattr(e, "code", "")) + " " + str(getattr(e, "msg", e)) + ")")
            if tentativa < TENTATIVAS_ZEPTO:
                time.sleep(ESPERA_ZEPTO_SEGUNDOS)
    if os.environ.get("BOLETIM_GMAIL_RESERVA") == "1":
        log("BOLETIM_GMAIL_RESERVA=1: enviando pelo Gmail de reserva.")
        enviar_gmail(destino_email, assunto, texto, html_corpo)
        return
    raise erro


def registrar_edicao(destinatario, edicao, editais, filtro_id=FILTRO_ID_PADRAO, filtro_nome=None):
    # Guarda os numeros dos editais da edicao para o painel abrir pelo link do aviso e listar
    # os dias anteriores (supabase/boletim_edicoes.sql). Devolve o numero da edicao (None sem ele). Sem id de conta
    # (destinatario fixo) nao ha painel para abrir. Falha aqui nao pode derrubar o aviso.
    # Sem novidade a linha so e criada se o dia ainda nao tem edicao: nao apaga a lista de uma rodada anterior.
    if not destinatario.get("id") or somente_email():  # teste: não cria nem numera edição oficial
        return None
    try:
        numeros = [e.get("numeroControlePNCP") for e in editais if e.get("numeroControlePNCP")][:500]
        chave = _chave_servico()
        corpo = json.dumps([{
            "cliente_id": destinatario["id"],
            "edicao": edicao.isoformat(),
            "filtro_id": filtro_id,
            "filtro_nome": filtro_nome or nome_filtro(destinatario),
            "empresa": destinatario["nome"],
            "quantidade": len(editais),
            "numeros": numeros,
        }]).encode("utf-8")
        req = urllib.request.Request(SUPABASE_URL + "/rest/v1/boletim_edicoes?on_conflict=cliente_id,edicao,filtro_id",
            data=corpo, method="POST", headers={
                "apikey": chave, "Authorization": "Bearer " + chave, "Content-Type": "application/json",
                "Prefer": "resolution=" + ("merge-duplicates" if editais else "ignore-duplicates") + ",return=representation"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            linhas = json.loads(resp.read().decode("utf-8") or "[]")
        if not linhas:  # ja existia (ignore-duplicates nao devolve a linha): le o numero de antes
            linhas = _get_json("boletim_edicoes?select=numero&cliente_id=eq." + urllib.parse.quote(str(destinatario["id"]), safe="")
                               + "&edicao=eq." + edicao.isoformat() + "&filtro_id=eq." + urllib.parse.quote(filtro_id, safe=""))
        return (linhas[0] if linhas else {}).get("numero")
    except Exception as e:
        log("AVISO: falha ao registrar a edicao do boletim de " + destinatario["email"] + " (" + str(e) + ").")
        return None


# ---- WhatsApp via CallMeBot (API gratuita, nao-oficial) ----
# Manda so pro numero que autorizou o bot (ver instrucoes acima, junto de DESTINATARIOS).
CALLMEBOT_URL = "https://api.callmebot.com/whatsapp.php"


def montar_mensagem_whatsapp(nome_destinatario, editais_novos):
    # WhatsApp/CallMeBot nao tem HTML - mensagem em texto puro, com *negrito* (markdown do
    # proprio WhatsApp). Limita a quantidade de editais no corpo da mensagem pra nao ficar
    # gigante (o e-mail continua trazendo a lista completa).
    limite = 8
    linhas = [
        "🔔 *LicitaPlena* - Novas oportunidades",
        f"Ola, {nome_destinatario}! Encontramos {len(editais_novos)} nova(s) oportunidade(s):",
        "",
    ]
    for e in editais_novos[:limite]:
        orgao = e.get("orgaoEntidade", {}).get("razaoSocial") or "Orgao nao informado"
        objeto = e.get("objetoCompra") or "Objeto nao informado"
        if len(objeto) > 140:
            objeto = objeto[:140].rstrip() + "..."
        linhas.append(f"📌 *{orgao}*")
        linhas.append(objeto)
        linhas.append(link_pncp(e))
        linhas.append("")
    if len(editais_novos) > limite:
        linhas.append(f"...e mais {len(editais_novos) - limite} oportunidade(s). Lista completa no e-mail.")
    return "\n".join(linhas)


def enviar_whatsapp(telefone, apikey, mensagem):
    params = {"phone": telefone, "text": mensagem, "apikey": apikey}
    url = CALLMEBOT_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def main():
    log("=== Iniciando busca de editais ===")
    nome_feriado = hoje_e_feriado_nacional()
    if nome_feriado:
        log("Hoje e feriado nacional (" + nome_feriado + "), boletim nao sera enviado.")
        return
    historico = carregar_historico()

    destinatarios = montar_lista_destinatarios()
    log("Destinatarios do boletim: " + str(len(destinatarios)) + " (" + str(len(DESTINATARIOS)) +
        " fixo(s) + " + str(len(destinatarios) - len(DESTINATARIOS)) + " cliente(s) aprovado(s) no Supabase).")

    jornais = carregar_jornais() if e_rodada_dos_jornais() else []
    teste = somente_email()
    if teste:
        # O repositório é público e o input do workflow aparece na página da rodada: aceita também o CÓDIGO do
        # cliente (clientes.codigo, o "Identificação do cliente" do cabeçalho), para o teste não expor e-mail.
        alvo = destinatarios_do_teste(teste, destinatarios, jornais)
        destinatarios = [d for d in destinatarios if alvo(d.get("email"), d.get("id"))]
        jornais = [j for j in jornais if alvo(j.get("email"), j.get("cliente_id"))]
        log("MODO TESTE (somente_email): " + str(len(destinatarios)) + " boletim(ns) e " + str(len(jornais))
            + " jornal(is) para " + teste + "; nada sera gravado.")
    log("Jornais nesta rodada: " + str(len(jornais)) + ".")

    ufs_necessarias = set()
    precisa_todas = False
    for j in jornais:
        if _ufs_do_filtro(j["filtro"]) is None:
            precisa_todas = True
        else:
            ufs_necessarias.update(_ufs_do_filtro(j["filtro"]))
    for d in destinatarios:
        if d["ufs"] is None:
            precisa_todas = True
        else:
            ufs_necessarias.update(d["ufs"])
    if precisa_todas:
        ufs_para_buscar = TODAS_UFS
    else:
        ufs_para_buscar = sorted(ufs_necessarias)

    pool = buscar_pool_por_uf(ufs_para_buscar)
    prospecta = carregar_prospecta()
    cabecalhos = carregar_cabecalhos([d.get("id") for d in destinatarios] + [j["cliente_id"] for j in jornais])

    for d in destinatarios:
        try:
            if d["ufs"] is None:
                editais = []
                for uf in ufs_para_buscar:
                    editais.extend(pool.get(uf, []))
            else:
                editais = []
                for uf in d["ufs"]:
                    editais.extend(pool.get(uf, []))

            editais_recentes = filtrar_por_publicacao_recente(editais)
            editais_da_uf = filtrar_por_uf_exata(editais_recentes, d["ufs"])
            filtrados = filtrar_por_palavra_chave(editais_da_uf, d["palavras_chave"])

            log(d["nome"] + ": " + str(len(filtrados)) + " editais no filtro.")

            filtro_id = d.get("chave_historico") or FILTRO_ID_PADRAO
            numero = registrar_edicao(d, hoje_brasilia(), filtrados, filtro_id)  # antes do aviso: o link ja abre a edicao
            cab = dict(cabecalhos.get(d.get("id")) or {}, numero=numero)
            enviar_email(d["email"], d["nome"], filtrados, nome_filtro(d), filtro_id, cab)
            if filtrados:
                log("E-mail enviado para " + d["email"] + " com " + str(len(filtrados)) + " edital(is).")
                registrar_log_boletim(d, "enviado", len(filtrados))

                whatsapp_cfg = None if teste else d.get("whatsapp")
                if whatsapp_cfg and whatsapp_cfg.get("telefone") and whatsapp_cfg.get("apikey"):
                    try:
                        mensagem = montar_mensagem_whatsapp(d["nome"], filtrados)
                        enviar_whatsapp(whatsapp_cfg["telefone"], whatsapp_cfg["apikey"], mensagem)
                        log("WhatsApp enviado para " + whatsapp_cfg["telefone"] + ".")
                    except Exception as e:
                        # Falha no WhatsApp nao pode derrubar o e-mail, que ja foi enviado.
                        log("ERRO ao enviar WhatsApp para " + d["nome"] + ": " + str(e))
            else:
                log("E-mail enviado para " + d["email"] + " avisando que nao ha oportunidades novas.")
                registrar_log_boletim(d, "sem_novidades", 0)

            empresa_id = (d.get("chave_historico") or "").partition("empresa:")[2]
            if empresa_id in prospecta and filtrados and not teste:
                try:
                    n = sugerir_no_funil(empresa_id, itens_prospecta(filtrados, d["palavras_chave"], prospecta[empresa_id]))
                    log(d["nome"] + ": Prospecta pos " + str(n) + " licitacao(oes) no Funil.")
                except Exception as e:
                    # Falha no Prospecta nao pode derrubar o boletim, que ja foi enviado.
                    log("ERRO no Prospecta de " + d["nome"] + ": " + str(e))

            chave_hist = d.get("chave_historico") or d["email"]
            vistos_deste = set(historico.get(chave_hist, []))
            for e in filtrados:
                vistos_deste.add(e.get("numeroControlePNCP"))
            historico[chave_hist] = list(vistos_deste)
        except Exception as e:
            log("ERRO ao processar destinatario " + d["nome"] + ": " + str(e))
            registrar_log_boletim(d, "erro", 0, mensagem_erro=str(e))

    for j in jornais:
        enviar_jornal(j, pool, historico, cabecalhos)

    if teste:
        log("MODO TESTE: historico de editais vistos nao foi alterado.")
    else:
        salvar_historico(historico)
    log("=== Fim da execucao ===")


# ---- Prospecta (funil_v3.sql): as melhores do boletim entram sozinhas no Funil da empresa ----
# Ligado por empresa em "Metas e automacao" (operacao_funil_preferencias.prospecta_ativo). O robo so calcula a nota e
# manda a lista ordenada; a funcao prospecta_sugerir (service_role) aplica a nota minima, o limite do dia e nao duplica.
def nota_oportunidade(e, palavras, valor_minimo=0, agora=None):
    # Ate 60 pelas palavras do filtro achadas no objeto, 25 pelo valor, 15 se ha pelo menos 3 dias ate o fim das propostas.
    objeto = _normalizar(e.get("objetoCompra") or "")
    achadas = len({_normalizar(p) for p in (palavras or []) if _normalizar(p) and _normalizar(p) in objeto})
    nota = {0: 0, 1: 40, 2: 50}.get(achadas, 60)
    valor = _numero(e.get("valorTotalEstimado"))
    if valor and valor > 0 and valor >= (valor_minimo or 0):
        nota += 25
    agora = agora or datetime.now(timezone(timedelta(hours=-3)))
    try:
        fim = datetime.fromisoformat(str(e.get("dataEncerramentoProposta"))[:19]).replace(tzinfo=timezone(timedelta(hours=-3)))
        if fim - agora >= timedelta(days=3):
            nota += 15
    except ValueError:
        pass
    return min(nota, 100)


def carregar_prospecta():
    # {empresa_id: valor minimo da meta}. Sem a tabela (SQL nao aplicado) ou erro: {} e o boletim segue normal.
    try:
        linhas = _get_json("operacao_funil_preferencias?prospecta_ativo=eq.true&select=empresa_id,meta")
    except Exception as e:
        log("AVISO: Prospecta indisponivel (" + str(e) + ").")
        return {}
    return {l["empresa_id"]: (_numero((l.get("meta") or {}).get("valor_minimo")) or 0) for l in linhas if l.get("empresa_id")}


def itens_prospecta(editais, palavras, valor_minimo=0, agora=None, limite=20):
    itens = []
    for e in editais:
        n = e.get("numeroControlePNCP") or ""
        if not re.match(r"^\d{14}-\d-\d{6}/\d{4}$", n):
            continue
        valor = _numero(e.get("valorTotalEstimado"))
        itens.append({
            "numero_controle": n, "objeto": (e.get("objetoCompra") or "")[:1000],
            "orgao": ((e.get("orgaoEntidade") or {}).get("razaoSocial") or "")[:300], "modalidade": (e.get("modalidadeNome") or "")[:120],
            "link": link_pncp(e), "valor": ("%.2f" % valor) if valor and valor > 0 else None,
            "publicacao": str(e.get("dataPublicacaoPncp") or "")[:10], "encerramento": str(e.get("dataEncerramentoProposta") or "")[:19],
            "nota": nota_oportunidade(e, palavras, valor_minimo, agora),
        })
    itens.sort(key=lambda i: -i["nota"])
    return itens[:limite]


def sugerir_no_funil(empresa_id, itens):
    chave = _chave_servico()
    corpo = json.dumps({"p_empresa": empresa_id, "p_itens": itens}).encode("utf-8")
    req = urllib.request.Request(SUPABASE_URL + "/rest/v1/rpc/prospecta_sugerir", data=corpo, method="POST",
                                 headers={"apikey": chave, "Authorization": "Bearer " + chave, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return int(json.loads(resp.read().decode("utf-8")) or 0)


def enviar_jornal(j, pool, historico, cabecalhos=None):
    # Um e-mail por jornal, so com o que ainda nao foi mandado neste jornal.
    destino = {"id": j["cliente_id"], "email": j["email"], "nome": "Jornal " + j["nome"]}
    try:
        editais = []
        for uf in (_ufs_do_filtro(j["filtro"]) or TODAS_UFS):
            editais.extend(pool.get(uf, []))
        chave = "jornal:" + str(j["id"])
        vistos = set(historico.get(chave, []))
        novos = [e for e in filtrar_jornal(filtrar_por_publicacao_recente(editais), j["filtro"]) if e.get("numeroControlePNCP") not in vistos]
        if not novos:
            log("Jornal " + j["nome"] + ": nada novo, sem e-mail.")
            return
        numero = registrar_edicao({"id": j["cliente_id"], "email": j["email"], "nome": j["empresa"] or j["nome"], "palavras_chave": [j["nome"]]},
                                  hoje_brasilia(), novos, chave, j["nome"])
        cab = dict((cabecalhos or {}).get(j["cliente_id"]) or {}, numero=numero)
        enviar_email(j["email"], j["empresa"] or j["nome"], novos, j["nome"], chave, cab)
        registrar_log_boletim(destino, "enviado", len(novos))
        historico[chave] = list(vistos | {e.get("numeroControlePNCP") for e in novos})
        log("Jornal " + j["nome"] + ": " + str(len(novos)) + " edital(is) enviado(s).")
    except Exception as e:
        log("ERRO no jornal " + j["nome"] + ": " + str(e))
        registrar_log_boletim(destino, "erro", 0, mensagem_erro=str(e))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("ERRO FATAL: " + str(e))
        raise
