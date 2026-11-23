// Fotos das capas do blog e da primeira tela (rodada 2 do visual, 23/11: o dono achou fracas as capas em desenho).
// Fotos do Unsplash (licença Unsplash: uso comercial permitido, sem atribuição obrigatória; créditos em img/CREDITOS.md).
// scripts/gerar_imagens_site.js recorta e converte: .webp para a tela e .jpg com título para o og:image.
// "foco" é o object-position do recorte (o que não pode sair da imagem).

const CAPAS_CATEGORIA = {
  "primeiros-passos": { foto: "topo-planejamento", foco: "50% 50%" },
  "documentos-e-habilitacao": { foto: "documentos", foco: "55% 45%" },
  "obras-e-engenharia": { foto: "construcao", foco: "60% 35%" },
  "impostos-e-precos": { foto: "expediente", foco: "30% 60%" },
  "pregao-e-disputa": { foto: "topo-contrato", foco: "50% 50%" },
  novidades: { foto: "topo-predio-publico", foco: "50% 60%" },
};

const CAPAS_ARTIGO = {
  "cbs-ibs-2027-quem-vende-ao-governo": { foto: "expediente", foco: "20% 70%" },
  "como-achar-licitacao-da-sua-area": { foto: "topo-planejamento", foco: "40% 40%" },
  "como-montar-planilha-de-obra": { foto: "construcao", foco: "70% 30%" },
  "documentos-que-mais-desclassificam": { foto: "documentos", foco: "50% 55%" },
  "limite-75-preco-inexequivel-obras": { foto: "industria", foco: "50% 50%" },
  "mei-em-licitacao": { foto: "papelaria", foco: "60% 50%" },
  "pesquisa-de-precos-antes-do-lance": { foto: "alimentos", foco: "50% 40%" },
  "pregoeiro-sumiu-chat-e-prazos": { foto: "escritorio", foco: "55% 50%" },
  "recurso-e-contrarrazao-prazos": { foto: "topo-contrato", foco: "45% 55%" },
  "sicx-compras-expressas-contrata-mais-brasil": { foto: "transporte", foco: "40% 60%" },
};

// Primeira tela do index: fotos que se alternam atrás do texto (a primeira carrega junto com a página).
const FOTOS_TOPO = [
  ["topo-predio-publico", "50% 60%"],
  ["servicos", "50% 40%"],
  ["documentos", "50% 50%"],
  ["armazem", "50% 50%"],
];

module.exports = { CAPAS_CATEGORIA, CAPAS_ARTIGO, FOTOS_TOPO };
