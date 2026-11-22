"""Gera as planilhas de teste do Orçamento de obra (dados fictícios, sem nome, CPF ou CNPJ de ninguém).

Formato copiado de editais reais, reduzido a poucos itens:
- edital-reduzido.xlsx: orçamento sintético com preços (BDI no rodapé), aba de cronograma e itens SINAPI e próprios;
- edital-em-branco.xlsx: planilha em branco com várias bases (SINAPI, ORSE, SETOP, composição montada) e coluna com BDI;
- cpu-reduzida.xlsx: anexo de composições analíticas (3 composições SINAPI com coeficientes e preços de 09/2023, AM).
Gravado com openpyxl (textos compartilhados, como o Excel), para o leitor do Node não ler só o que ele mesmo grava.
    python scripts/fixtures/orcamento-obra/gerar_fixtures.py
"""
from pathlib import Path

import openpyxl

AQUI = Path(__file__).parent


def edital_reduzido():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Orçamento Sintético"
    linhas = [
        [None, None, "ÓRGÃO PÚBLICO FICTÍCIO"],
        ["OBRA:", None, "REFORMA DE PRÉDIO PÚBLICO EM MUNICÍPIO/AM"],
        ["PLANILHA ORÇAMENTÁRIA SINTÉTICA"],
        ["DATA BASE DO ORÇAMENTO SINAPI:  SETEMBRO/2023      LEIS SOCIAIS DESONERADAS: 83,73% (HORISTA) - 46,63% (MENSALISTA)"],
        [],
        ["ITEM", "CÓDIGO", "DESCRIÇÃO", "UNID.", "QUANT.", "PREÇO UNITÁRIO", "PREÇO TOTAL "],
        [" 1 ", None, "DEMOLIÇÕES E RETIRADAS", None, None, None, 1392.82],
        [" 1.1 ", " 97622 ", "DEMOLIÇÃO DE ALVENARIA DE BLOCO FURADO, DE FORMA MANUAL", "m³", 18.07, 53.2, 961.32],
        [" 1.2 ", " 97640 ", "REMOÇÃO DE FORROS DE DRYWALL, PVC E FIBROMINERAL", "m²", 219.04, 1.97, 431.5],
        [2, None, "CANTEIRO", None, None, None, 1679.29],
        [" 2.1 ", " 74209/001 ", "PLACA DE OBRA EM CHAPA DE ACO GALVANIZADO", "m²", 1.2, 344.16, 412.99],
        [" 2.2 ", " ORG - 0450 ", "TRANSPORTE DE MATERIAL (COMPOSIÇÃO DO ÓRGÃO)", "SV", 1, 1000, 1000],
        [" 2.3 ", " ORG - 0015 ", "LIMPEZA DE TERRENO", "m²", 10, 9.13, 91.3],
        [2.4, " ORG - 0016 ", "SERVIÇO A", "UN", 1, 10, 10],
        [2.5, " ORG - 0017 ", "SERVIÇO B", "UN", 1, 10, 10],
        [2.6, " ORG - 0018 ", "SERVIÇO C", "UN", 1, 10, 10],
        [2.7, " ORG - 0019 ", "SERVIÇO D", "UN", 1, 10, 10],
        [2.8, " ORG - 0020 ", "SERVIÇO E", "UN", 1, 10, 10],
        [2.9, " ORG - 0021 ", "SERVIÇO F", "UN", 1, 10, 10],
        [2.1, " ORG - 0022 ", "SERVIÇO G (o Excel guardou 2.10 como número)", "UN", 1, 115, 115],
        [],
        ["CUSTO DIRETO TOTAL", None, None, None, None, None, 3072.11],
        ["BDI (28,35%)", None, None, None, None, None, 870.94],
        ["PREÇO GLOBAL DA OBRA (ESTIMADO PELO CONTRATANTE)", None, None, None, None, None, 3943.05],
        ["DESCONTO OFERTADO ", None, None, None, None, None, None],
        ["PREÇO GLOBAL DA OBRA (OFERTADO PELO LICITANTE)", None, None, None, None, None, 3943.05],
    ]
    for linha in linhas:
        ws.append(linha)
    cr = wb.create_sheet("Cronog. Físico-Financeiro")
    cr.append(["CRONOGRAMA FÍSICO - FINANCEIRO (SEM BDI)"])
    cr.append(["Item", "Descrição", "Total Por Etapa", "30 DIAS", "60 DIAS"])
    cr.append([" 1 ", "DEMOLIÇÕES E RETIRADAS", "100,00%\n1.392,82", "100,00%\n1.392,82", None])
    cr.append([" 2 ", "CANTEIRO", "100,00%\n1.679,29", "40,00%\n671,72", "60,00%\n1.007,57"])
    cr.append(["Porcentagem", None, None, "67,12%", "32,88%"])
    wb.save(AQUI / "edital-reduzido.xlsx")


def edital_em_branco():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Planilha Orçamentária Sintética"
    ws.append(["Objeto: Contratação fictícia de sistema fotovoltaico", None, None, None, None, None, "BDI - Serviço", 0])
    ws.append(["Município: Cidade/PB"])
    ws.append([])
    ws.append(["Item", "Código", "Banco", "Descrição", "Unidade", "Quantidade", "Valor unitário", "Total unit sem BDI", "Valor Unit com BDI", "Total geral do Item"])
    ws.append([1, None, None, "Serviços preliminares", None, None, None, None, None, 0])
    ws.append([1.1, 13045, "ORSE", "Teste em malha de aterramento", "und", 1, 0, 0, 0, 0])
    ws.append([1.2, "CO-3317", "SETOP", "Projeto executivo de SPDA", "und", 1, 0, 0, 0, 0])
    ws.append([1.3, 97647, "SINAPI", "Remoção de telhas", "m2", 100, 0, 0, 0, 0])
    ws.append([2, None, None, "Sistema fotovoltaico", None, None, None, None, None, 0])
    ws.append([2.1, "1", "COMPOSIÇÃO MONTADA", "Estrutura metálica de suporte", "m2", 50, 0, 0, 0, 0])
    ws.append([2.2, "n/a", "CREA-PB", "ART de execução", "und", 1, 0, 0, 0, 0])
    ws.append([2.3, 9082084, "SIURB", "Módulo fotovoltaico 555 W", "und", 10, 0, 0, 0, 0])
    wb.save(AQUI / "edital-em-branco.xlsx")


def cpu_reduzida():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Orçamento Analítico"
    ws.append(["COMPOSIÇÃO DE PREÇO UNITÁRIO - CPU"])
    cabec = [None, "Código", "Banco", "Descrição", "Tipo", "Und", "Quant.", "Valor Unit", "Total"]
    blocos = [
        ("1.1", ["Composição", "97622", "SINAPI", "DEMOLIÇÃO DE ALVENARIA DE BLOCO FURADO", "SERP", "m³", 1, 53.2, 53.2], [
            ["Composição Auxiliar", "88309", "SINAPI", "PEDREIRO COM ENCARGOS COMPLEMENTARES", "SEDI", "H", 0.3541, 24.71, 8.74],
            ["Composição Auxiliar", "88316", "SINAPI", "SERVENTE COM ENCARGOS COMPLEMENTARES", "SEDI", "H", 2.1957, 20.25, 44.46],
        ]),
        ("1.2", ["Composição", "97640", "SINAPI", "REMOÇÃO DE FORROS DE DRYWALL", "SERP", "m²", 1, 1.97, 1.97], [
            ["Composição Auxiliar", "88278", "SINAPI", "MONTADOR DE ESTRUTURA METÁLICA", "SEDI", "H", 0.0229, 29.13, 0.66],
            ["Composição Auxiliar", "88316", "SINAPI", "SERVENTE COM ENCARGOS COMPLEMENTARES", "SEDI", "H", 0.0647, 20.25, 1.31],
        ]),
        ("2.1", ["Composição", "74209/001", "SINAPI", "PLACA DE OBRA EM CHAPA DE ACO GALVANIZADO", "CANT", "m²", 1, 344.16, 344.16], [
            ["Composição Auxiliar", "88262", "SINAPI", "CARPINTEIRO DE FORMAS", "SEDI", "H", 1, 24.37, 24.37],
            ["Composição Auxiliar", "88316", "SINAPI", "SERVENTE COM ENCARGOS COMPLEMENTARES", "SEDI", "H", 2, 20.25, 40.5],
            ["Composição Auxiliar", "94962", "SINAPI", "CONCRETO MAGRO PARA LASTRO", "FUES", "m³", 0.01, 555.34, 5.55],
            ["Insumo", "00004417", "SINAPI", "SARRAFO NAO APARELHADO 2,5 X 7 CM", "Material", "M", 1, 5.44, 5.44],
            ["Insumo", "00004491", "SINAPI", "PONTALETE 7,5 X 7,5 CM", "Material", "M", 4, 4.02, 16.08],
            ["Insumo", "00004813", "SINAPI", "PLACA DE OBRA EM CHAPA DE ACO GALVANIZADO", "Material", "m²", 1, 250, 250],
            ["Insumo", "00005075", "SINAPI", "PREGO DE ACO POLIDO COM CABECA 18 X 30", "Material", "KG", 0.11, 20.24, 2.22],
        ]),
    ]
    for item, comp, linhas in blocos:
        ws.append([item] + cabec[1:])
        ws.append(comp)
        for linha in linhas:
            ws.append(linha)
        ws.append(["MO sem LS =>", 0])
        ws.append([])
    wb.save(AQUI / "cpu-reduzida.xlsx")


if __name__ == "__main__":
    edital_reduzido()
    edital_em_branco()
    cpu_reduzida()
