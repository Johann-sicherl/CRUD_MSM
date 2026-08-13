import { FORCE_TO_ONE_FIELDS, getRealColumnFields, type Field, type TableSchema } from './schema'

// Compartilhado entre a rota de substituição (POST /api/global-update/[table])
// e a rota de comparação (POST /api/global-update/[table]/compare) — as duas
// precisam converter as linhas do CSV exatamente da mesma forma, senão a
// comparação poderia apontar diferenças que na verdade não existiriam depois
// da substituição real (ou vice-versa).

// Official CSV exports often spell an absent value out as the literal text
// "NULL" instead of leaving the cell empty — treat both as no value.
export function isBlankCell(raw: unknown): boolean {
  const s = String(raw ?? '').trim()
  return s === '' || s.toUpperCase() === 'NULL'
}

// A blank/"NULL" cell on a NOT NULL column that has a schema default falls
// back to that default (mirrors the regular POST /api/[table] route) instead
// of being sent as SQL NULL, which would fail the column's NOT NULL
// constraint since jsonb_populate_recordset never applies table-level
// DEFAULTs on its own.
export function toCellValue(field: Field, raw: unknown): unknown {
  const fallback = () => (!field.nullable && field.defaultValue !== undefined ? field.defaultValue : null)
  if (isBlankCell(raw)) return fallback()

  const s = String(raw).trim()
  if (field.type === 'jsonb') {
    try { return JSON.parse(s) } catch { return s }
  }
  // Real integer columns reject decimal-looking text ("350.0"), which CSV
  // export tools commonly produce even for whole numbers — parse into an
  // actual number instead of passing raw text through to Postgres.
  if (field.type === 'number') {
    const n = parseInt(s, 10)
    return Number.isNaN(n) ? fallback() : n
  }
  if (field.type === 'decimal') {
    const n = parseFloat(s)
    return Number.isNaN(n) ? fallback() : n
  }
  return s
}

// Converts raw CSV rows (string cells, header-cased keys) into the exact
// shape that gets inserted into the real table — same column matching
// (case-insensitive, unknown columns dropped), same type coercion, same
// FORCE_TO_ONE_FIELDS override.
export function convertCsvRows(schema: TableSchema, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const fieldByLowerName = new Map(getRealColumnFields(schema).map(f => [f.name.toLowerCase(), f]))

  return rows.map(row => {
    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(row)) {
      const field = fieldByLowerName.get(key.trim().toLowerCase())
      if (!field) continue // column not part of this table's schema — dropped
      out[field.name] = toCellValue(field, raw)
    }
    for (const f of FORCE_TO_ONE_FIELDS) {
      if (fieldByLowerName.has(f)) out[f] = 1
    }
    return out
  })
}
