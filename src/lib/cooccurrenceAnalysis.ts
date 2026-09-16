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

// `orders`: um array por pedido/estrutura, cada um com os códigos
// encontrados nele (duplicatas dentro do mesmo pedido são ignoradas — cada
// código conta no máximo uma vez por pedido, tanto pro suporte quanto pra
// coocorrência). Pedidos com menos de 2 códigos distintos não geram par
// nenhum (não há o que cruzar).
export function computeCooccurrence(orders: string[][], options: CooccurrenceOptions): CooccurrencePair[] {
  const suporte = new Map<string, number>()
  const coOcorrencia = new Map<string, number>() // chave "A|B", sempre A < B

  for (const codesRaw of orders) {
    const codes = Array.from(new Set(codesRaw))
    if (codes.length < 2) continue
    for (const c of codes) suporte.set(c, (suporte.get(c) || 0) + 1)
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const [a, b] = [codes[i], codes[j]].sort()
        const k = `${a}|${b}`
        coOcorrencia.set(k, (coOcorrencia.get(k) || 0) + 1)
      }
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
