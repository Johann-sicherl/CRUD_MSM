// Padronização de texto (ex.: "Nome" em Cadastro de Componentes) — dado o
// que a pessoa está digitando, encontra os valores mais parecidos já
// cadastrados na mesma coluna, pra evitar duplicidade por variação de
// escrita ("MALETA DE TESTE" vs "MALETA DE TESTES"). Puro/isomórfico, sem
// dependência externa — roda no navegador a cada tecla sem round-trip.

export function normalizeText(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Distância de edição clássica (Levenshtein), O(len(a) × len(b)) com duas
// linhas de buffer — nomes de componente são curtos (poucas dezenas de
// caracteres), então isso roda em microssegundos por comparação.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la
  let prev = new Array<number>(lb + 1)
  let curr = new Array<number>(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j
  for (let i = 1; i <= la; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[lb]
}

function tokenSet(s: string): Set<string> {
  return new Set(s.split(' ').filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// 0..1 — combina similaridade por caractere (pega erro de digitação/variação
// singular-plural, tipo TESTE/TESTES) com similaridade por conjunto de
// palavras (pega reordenação ou uma palavra a mais/a menos).
export function similarity(a: string, b: string): number {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const maxLen = Math.max(na.length, nb.length)
  const charSim = 1 - levenshtein(na, nb) / maxLen
  const wordSim = jaccard(tokenSet(na), tokenSet(nb))
  return charSim * 0.55 + wordSim * 0.45
}

export interface SimilarMatch {
  text: string
  score: number
}

// Top matches (ordenados por score desc, só os >= minScore) para `query`
// dentro de `candidates`. Candidatos duplicados (mesmo texto normalizado)
// aparecem uma única vez.
export function findSimilarTexts(
  query: string,
  candidates: string[],
  opts: { limit?: number; minScore?: number } = {},
): SimilarMatch[] {
  const { limit = 5, minScore = 0.45 } = opts
  const nq = normalizeText(query)
  if (!nq) return []
  const seen = new Set<string>()
  const scored: SimilarMatch[] = []
  for (const c of candidates) {
    const nc = normalizeText(c)
    if (!nc || seen.has(nc)) continue
    seen.add(nc)
    const score = similarity(nq, nc)
    if (score >= minScore) scored.push({ text: c, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

// Sugestão "fantasma" (autocomplete estilo barra de endereço) — só
// candidatos que realmente COMEÇAM com o que já foi digitado (comparação
// sem acento/maiúscula) servem aqui, porque o texto sugerido precisa
// aparecer visualmente colado logo depois do que a pessoa já escreveu, na
// mesma linha; um candidato "parecido" mas que diverge no meio não dá pra
// mostrar assim sem confundir. Entre os que servem, o de maior similaridade
// vence. `normalizeText` não muda a quantidade de caracteres (só maiúscula/
// remove acento), então o índice `query.length` cai no lugar certo do texto
// original do candidato ao fatiar o restante.
export function bestGhostSuggestion(query: string, candidates: string[]): string | null {
  const nq = normalizeText(query)
  if (!nq) return null
  let best: { text: string; score: number } | null = null
  for (const c of candidates) {
    const nc = normalizeText(c)
    if (nc.length <= nq.length || !nc.startsWith(nq)) continue
    const score = similarity(query, c)
    if (!best || score > best.score) best = { text: c, score }
  }
  return best ? best.text : null
}
