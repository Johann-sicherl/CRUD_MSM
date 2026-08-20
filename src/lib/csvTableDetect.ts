import { tables, getRealColumnFields, type Field, type TableSchema } from './schema'
import { isBlankCell } from './globalUpdateConvert'

// Compartilhado entre o Atualizador Global de Tabelas MSM (substitui os
// dados reais no Supabase) e o Importador de Custos Locais (só alimenta o
// arquivo local de custos, nunca toca o Supabase) — as duas telas recebem o
// mesmo tipo de CSV oficial e precisam identificar a tabela e auditar as
// colunas exatamente da mesma forma.

export interface DetectionResult {
  tableName: string
  schema: TableSchema
  realFields: Field[]
  headerByLowerName: Map<string, string>
  missingRequired: Field[]
  missingOptional: Field[]
  extraColumns: string[]
}

export interface SelectInvalidDetail {
  field: string
  label: string
  options: string[]
  values: { value: string; count: number }[]
}

export const isRequiredField = (f: Field) =>
  !f.isPk && !f.isReadonly && !f.autoIncrement && !f.nullable && f.defaultValue === undefined

// Hand-written CSV parser (RFC4180-style quoting) instead of the xlsx/SheetJS
// library: SheetJS auto-detects date-looking cells and silently reformats
// them (e.g. "2025-02-14 10:52:43.648996-03" becomes "2/14/25"), which would
// corrupt created_at/updated_at on import. Every cell here stays exact text.
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0
  const len = text.length
  while (i < len) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      cell += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(cell); cell = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue }
    cell += c; i++
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

export async function parseCsvRaw(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const text = await file.text()
  const matrix = parseCsvText(text).filter(r => !(r.length === 1 && r[0].trim() === ''))
  if (matrix.length === 0) return { headers: [], rows: [] }
  const headers = matrix[0].map(h => h.trim())
  const rows = matrix.slice(1)
    .filter(r => r.some(c => c.trim() !== ''))
    .map(r => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i] : '' })
      return obj
    })
  return { headers, rows }
}

// Picks the table whose real column set is the CLOSEST match to the CSV
// header set — not just whichever table contains the most matching column
// names. A table with many columns (e.g. equipments) can "contain" every
// column of a smaller table (e.g. accessory_groups: id, legacy_id, name,
// created_at, updated_at) as a subset without actually being the right
// table, so we rank by total mismatch (missing + extra columns combined) and
// take the smallest — an exact match scores 0 and always wins.
export function detectTable(headers: string[]): DetectionResult | null {
  const headerLowerSet = new Set(headers.map(h => h.toLowerCase()))
  let best: { tableName: string; schema: TableSchema; realFields: Field[]; diff: number } | null = null
  for (const [tableName, schema] of Object.entries(tables)) {
    const realFields = getRealColumnFields(schema)
    const fieldLowerSet = new Set(realFields.map(f => f.name.toLowerCase()))
    const overlap = realFields.filter(f => headerLowerSet.has(f.name.toLowerCase())).length
    if (overlap === 0) continue // completely unrelated table — not a candidate
    const missingCount = realFields.length - overlap
    const extraCount = headers.filter(h => !fieldLowerSet.has(h.toLowerCase())).length
    const diff = missingCount + extraCount
    if (!best || diff < best.diff) best = { tableName, schema, realFields, diff }
  }
  if (!best) return null

  const headerByLowerName = new Map(headers.map(h => [h.toLowerCase(), h]))
  const fieldLowerSet = new Set(best.realFields.map(f => f.name.toLowerCase()))
  const present = (f: Field) => headerByLowerName.has(f.name.toLowerCase())

  return {
    tableName: best.tableName,
    schema: best.schema,
    realFields: best.realFields,
    headerByLowerName,
    missingRequired: best.realFields.filter(f => !present(f) && isRequiredField(f)),
    missingOptional: best.realFields.filter(f => !present(f) && !isRequiredField(f)),
    extraColumns: headers.filter(h => !fieldLowerSet.has(h.toLowerCase())),
  }
}

export function computeRowIssues(detection: DetectionResult, rows: Record<string, string>[]) {
  const requiredFields = detection.realFields.filter(f =>
    isRequiredField(f) && detection.headerByLowerName.has(f.name.toLowerCase())
  )
  const selectFields = detection.realFields.filter(f =>
    f.type === 'select' && f.options && detection.headerByLowerName.has(f.name.toLowerCase())
  )

  let requiredEmptyCount = 0
  const invalidByField = new Map<string, Map<string, number>>() // field name -> raw value -> count
  for (const row of rows) {
    for (const f of requiredFields) {
      const header = detection.headerByLowerName.get(f.name.toLowerCase())!
      if (isBlankCell(row[header])) requiredEmptyCount++
    }
    for (const f of selectFields) {
      const header = detection.headerByLowerName.get(f.name.toLowerCase())!
      const v = String(row[header] ?? '').trim()
      if (!isBlankCell(v) && !f.options!.some(o => o.toLowerCase() === v.toLowerCase())) {
        if (!invalidByField.has(f.name)) invalidByField.set(f.name, new Map())
        const counts = invalidByField.get(f.name)!
        counts.set(v, (counts.get(v) ?? 0) + 1)
      }
    }
  }

  const selectInvalidDetails: SelectInvalidDetail[] = selectFields
    .filter(f => invalidByField.has(f.name))
    .map(f => ({
      field: f.name,
      label: f.label,
      options: f.options!,
      values: Array.from(invalidByField.get(f.name)!.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
    }))
  const selectInvalidCount = selectInvalidDetails.reduce((sum, d) => sum + d.values.reduce((s, v) => s + v.count, 0), 0)

  return { requiredEmptyCount, selectInvalidCount, selectInvalidDetails }
}
