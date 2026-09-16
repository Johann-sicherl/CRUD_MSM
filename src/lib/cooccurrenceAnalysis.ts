// Mineração de coocorrência genérica — "este componente sempre saiu com
// este outro" — extraída/generalizada a partir da regra R080 de
// productIntelligence.ts (Inteligência do Produto), pra ser reusada tanto
// por ela (mantida no código, fora da navegação — ver
// specs/telas-auxiliares.md) quanto pela tela dedicada "Pesquisa de Itens
// Dependentes Avançada". Módulo 100% puro (sem I/O, sem Protheus/Supabase):
// recebe conjuntos de código já resolvidos (um por pedido/estrutura),
// nunca fica sabendo de onde eles vieram.

export interface CooccurrencePair {
  codigoA: string
  codigoB: string
  coOcorrencias: number
  suporteA: number
  suporteB: number
  // conjuntas / suporteA e conjuntas / suporteB — confiança nos dois
  // sentidos (A→B e B→A). Um par só é retornado se os dois baterem o
  // limiar mínimo, exatamente como R080 já exigia.
  confiancaAparaB: number
  confiancaBparaA: number
}

export interface CooccurrenceOptions {
  // Piso mínimo de amostra por código — sem isso, "coocorreu 1 de 1 vez"
  // vira par "100% confiável" garantido, mesmo sendo uma amostra de 1.
  minSupport: number
  // Confiança mínima exigida nos dois sentidos (0–1) — um acessório
  // genérico que entra em quase todo pedido não deve virar "candidato a
  // dependência" só por aparecer muito, se ele não for exclusivo do outro
  // lado do par.
  minConfidence: number
}

export interface CooccurrenceOrder {
  // Códigos "âncora" de um pedido — os itens de verdade ofertados/
  // escolhidos (ex.: NIVEL 3 na hierarquia 26.xx/27.13). Pares são
  // gerados âncora×âncora normalmente.
  anchors: string[]
  // Códigos "profundos" opcionais (ex.: subárvore de cada âncora, nível
  // 4 em diante) — só formam par CONTRA uma âncora, NUNCA entre si.
  //
  // Achado real, pedido explícito do usuário ("a consulta está
  // extremamente demorada"): a versão original passava todo o conjunto
  // achatado (âncoras + subárvore inteira) pra um único all-pairs O(n²).
  // Um pedido cuja subárvore explode em centenas/milhares de parafusos,
  // cabos e suportes fazia esse n² virar um número absurdo — e nenhuma
  // outra tela do app faz esse tipo de cruzamento O(n²) (Busc. Avanç.
  // Acessórios Protheus só lista, nunca cruza pares), por isso as outras
  // consultas de estrutura eram tão mais rápidas mesmo lendo a mesma
  // tabela ESTRUTURAS. Separar "âncora" de "profundo" e nunca parear
  // profundo×profundo derruba a complexidade de O((A+D)²) pra
  // O(A×(A+D)) — como A (itens de verdade escolhidos) é tipicamente uma
  // fração pequena de D (toda a subestrutura), a diferença é enorme. É
  // também mais correto pro negócio: dois parafusos que só existem porque
  // estão dentro do mesmo conjunto não são um "candidato a item
  // dependente" — isso é só composição de BOM, não uma decisão comercial;
  // o sinal que interessa é "este componente profundo sempre acompanha
  // ESTE item escolhido".
  others?: string[]
}

function bump(map: Map<string, number>, x: string, y: string) {
  if (x === y) return
  const [a, b] = [x, y].sort()
  const k = `${a}|${b}`
  map.set(k, (map.get(k) || 0) + 1)
}

// `orders`: um array por pedido/estrutura. Duplicatas dentro do mesmo
// pedido são ignoradas (cada código conta no máximo uma vez por pedido,
// tanto pro suporte quanto pra coocorrência) — um código que aparece nos
// dois papéis (âncora e profundo) no mesmo pedido conta só como âncora.
// Pedidos com menos de 2 códigos distintos no total não geram par nenhum.
export function computeCooccurrence(orders: CooccurrenceOrder[], options: CooccurrenceOptions): CooccurrencePair[] {
  const suporte = new Map<string, number>()
  const coOcorrencia = new Map<string, number>() // chave "A|B", sempre A < B

  for (const order of orders) {
    const anchors = Array.from(new Set(order.anchors))
    const anchorSet = new Set(anchors)
    const others = Array.from(new Set(order.others || [])).filter(c => !anchorSet.has(c))
    if (anchors.length + others.length < 2) continue

    for (const c of anchors) suporte.set(c, (suporte.get(c) || 0) + 1)
    for (const c of others) suporte.set(c, (suporte.get(c) || 0) + 1)

    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) bump(coOcorrencia, anchors[i], anchors[j])
      for (const o of others) bump(coOcorrencia, anchors[i], o)
    }
  }

  const pares: CooccurrencePair[] = []
  for (const [par, conjuntas] of coOcorrencia) {
    const [a, b] = par.split('|')
    const suporteA = suporte.get(a) || 0
    const suporteB = suporte.get(b) || 0
    if (suporteA < options.minSupport || suporteB < options.minSupport) continue
    const confiancaAparaB = conjuntas / suporteA
    const confiancaBparaA = conjuntas / suporteB
    if (confiancaAparaB < options.minConfidence || confiancaBparaA < options.minConfidence) continue
    pares.push({ codigoA: a, codigoB: b, coOcorrencias: conjuntas, suporteA, suporteB, confiancaAparaB, confiancaBparaA })
  }
  return pares
}
