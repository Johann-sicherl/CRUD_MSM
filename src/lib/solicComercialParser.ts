// Depurador de Solic. Comercial — normaliza o texto bagunçado que chega do
// comercial (listas com nome/código misturados, blocos repetidos do tipo
// "Nome: X, Obs: Nome: X, Obs: X, Obs: Y" — artefato de exportação que
// duplica o campo Nome dentro do próprio Obs, quantidades soltas, rótulos
// tipo "Computador:"/"Cor:"/"Idioma:" sem valor útil, e parágrafos de
// especificação sem código nenhum) em duas listas: itens com código
// (deduplicados) e blocos de texto livre (observações/especificações).
//
// Heurística, não um parser perfeito: texto digitado por humanos em formatos
// diferentes não tem uma gramática única. Onde o nome de um item fica
// ambíguo o suficiente para não ter certeza, ele é marcado como
// "(nome não identificado)" em vez de arriscar um nome errado — o usuário
// revisa visualmente no lado direito da tela.

const CODE_RE = /\b\d{2}\.\d{2}\.\d{5}\b/g
const QTY_RE = /(\d{1,4})\s*UNIDADES?\b/i
const LABEL_ONLY_RE = /^[\p{L}À-ÿ ]{2,25}:\s*$/u

export interface ParsedItem {
  codes: string[]
  name: string
  qty: number | null
  label?: string
  occurrences: number
}

export interface FreeTextBlock {
  label?: string
  text: string
  occurrences: number
}

export interface ParseResult {
  items: ParsedItem[]
  freeText: FreeTextBlock[]
}

// "Nome: X, Obs: Nome: X, Obs: X, Obs: Y" -> { nome: X, obs: Y }, não importa
// quantas vezes o par "Nome: X, Obs:"/"X, Obs:" se repita na frente.
function collapseNomeObs(chunk: string): { nome: string; obs: string } | null {
  const m = chunk.match(/^Nome:\s*(.+?),\s*Obs:\s*/i)
  if (!m) return null
  const nome = m[1].trim()
  let rest = chunk.slice(m[0].length)
  if (!nome) return { nome, obs: rest.trim() }
  const escaped = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const repeatRe = new RegExp(`^(?:Nome:\\s*)?${escaped}\\s*,\\s*Obs:\\s*`, 'i')
  while (repeatRe.test(rest)) {
    rest = rest.replace(repeatRe, '')
  }
  return { nome, obs: rest.trim() }
}

interface RawItem {
  codes: string[]
  name: string
}

// Varre o texto atrás de todos os códigos (padrão XX.XX.XXXXX) e reconstrói
// os itens: "-" antes do código sempre fecha um item novo (mesmo em cadeias
// "NOME1 - COD1 / NOME2 - COD2"); "/" antes do código só fecha item novo se
// houver texto de nome real desde o último código — senão é só mais um
// código do mesmo item ("NOME / COD1 / COD2").
function extractItemsFromText(text: string): { items: RawItem[]; qty: number | null } {
  const matches = Array.from(text.matchAll(CODE_RE))
  if (matches.length === 0) return { items: [], qty: null }

  const items: RawItem[] = []
  let pendingName = ''
  let pendingCodes: string[] = []
  let cursor = 0

  const finalize = () => {
    if (pendingCodes.length === 0) return
    items.push({
      codes: pendingCodes,
      name: pendingName.trim() || '(nome não identificado)',
    })
    pendingCodes = []
    pendingName = ''
  }

  for (const m of matches) {
    const code = m[0]
    const idx = m.index ?? 0
    const textBefore = text.slice(cursor, idx)
    const delimMatch = textBefore.match(/([-/])\s*$/)
    let beforeDelim = delimMatch ? textBefore.slice(0, delimMatch.index) : textBefore
    beforeDelim = beforeDelim.replace(/^\s*[/-]\s*/, '').trim()
    const delim = delimMatch ? delimMatch[1] : null

    if (delim === '-' || delim === null) {
      finalize()
      pendingName = beforeDelim
      pendingCodes = [code]
    } else if (beforeDelim === '') {
      pendingCodes.push(code)
    } else {
      finalize()
      pendingName = beforeDelim
      pendingCodes = [code]
    }
    cursor = idx + code.length
  }
  finalize()

  const tail = text.slice(cursor)
  const qtyMatch = tail.match(QTY_RE)
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : null

  return { items, qty: items.length === 1 ? qty : null }
}

export function parseSolicComercial(raw: string): ParseResult {
  const chunks = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap(line => line.split(';'))
    .map(c => c.trim())
    .filter(c => c.length > 0 && c !== '-' && !LABEL_ONLY_RE.test(c))

  const itemsMap = new Map<string, ParsedItem>()
  const freeTextMap = new Map<string, FreeTextBlock>()

  for (const chunk of chunks) {
    let label: string | undefined
    let content = chunk

    if (/^Nome:/i.test(chunk)) {
      const nomeObs = collapseNomeObs(chunk)
      if (nomeObs) {
        label = nomeObs.nome
        content = nomeObs.obs
      }
    }

    if (!content) continue

    const { items, qty } = extractItemsFromText(content)

    if (items.length === 0) {
      const text = content.trim()
      if (!text) continue
      const key = `${label ?? ''}::${text}`
      const existing = freeTextMap.get(key)
      if (existing) existing.occurrences += 1
      else freeTextMap.set(key, { label, text, occurrences: 1 })
      continue
    }

    for (const it of items) {
      const key = it.codes.slice().sort().join('+')
      const existing = itemsMap.get(key)
      if (existing) {
        existing.occurrences += 1
        if (it.name !== '(nome não identificado)' && it.name !== existing.name) {
          // Quando um nome contém o outro por inteiro (ex.: sobra de um
          // separador malformado grudando um rótulo vizinho na frente,
          // como "ADESIVOS / CONJUNTO X"), o menor tende a ser o nome
          // real e o maior só carrega ruído — fica com o menor nesse
          // caso; fora isso, o mais descritivo (maior) vence.
          if (existing.name.includes(it.name)) {
            existing.name = it.name
          } else if (!it.name.includes(existing.name) && it.name.length > existing.name.length) {
            existing.name = it.name
          }
        }
        if (existing.qty === null && qty !== null) existing.qty = qty
        if (!existing.label && label) existing.label = label
      } else {
        itemsMap.set(key, { codes: it.codes, name: it.name, qty, label, occurrences: 1 })
      }
    }
  }

  return {
    items: Array.from(itemsMap.values()),
    freeText: Array.from(freeTextMap.values()),
  }
}
