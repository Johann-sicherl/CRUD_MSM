import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, FORCE_TO_ONE_FIELDS, getRealColumnFields, type Field } from '@/lib/schema'

type RouteParams = { params: { table: string } }

// Deliberately does not import anything from '@/lib/sqlAudit' — a full-table
// replace from the official CSV export must never appear in Auditoria.

// Official CSV exports often spell an absent value out as the literal text
// "NULL" instead of leaving the cell empty — treat both as no value.
function isBlankCell(raw: unknown): boolean {
  const s = String(raw ?? '').trim()
  return s === '' || s.toUpperCase() === 'NULL'
}

// A blank/"NULL" cell on a NOT NULL column that has a schema default falls
// back to that default (mirrors the regular POST /api/[table] route) instead
// of being sent as SQL NULL, which would fail the column's NOT NULL
// constraint since jsonb_populate_recordset never applies table-level
// DEFAULTs on its own.
function toCellValue(field: Field, raw: unknown): unknown {
  if (isBlankCell(raw)) {
    return !field.nullable && field.defaultValue !== undefined ? field.defaultValue : null
  }
  const s = String(raw).trim()
  if (field.type === 'jsonb') {
    try { return JSON.parse(s) } catch { return s }
  }
  return s
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  const schema = tables[table]
  if (!schema) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: 'Nenhuma linha para importar' }, { status: 400 })

  // Only real database columns — excludes join-derived display fields
  // (e.g. accessory_name resolved from protheus_code), which don't exist as
  // columns in the actual table and would make the insert fail.
  const fieldByLowerName = new Map(getRealColumnFields(schema).map(f => [f.name.toLowerCase(), f]))

  const insertRows = rows.map(row => {
    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(row)) {
      const field = fieldByLowerName.get(key.trim().toLowerCase())
      if (!field) continue // column not part of this table's schema — dropped
      out[field.name] = toCellValue(field, raw)
    }
    // Financial multipliers must always be 1, regardless of the CSV value
    for (const f of FORCE_TO_ONE_FIELDS) {
      if (fieldByLowerName.has(f)) out[f] = 1
    }
    return out
  })

  // Atomic wipe + reload — see msm_global_table_replace.sql. If the insert
  // fails, the delete rolls back too and the table keeps its original data.
  const { data, error } = await supabaseAdmin.rpc('global_table_replace', {
    target_table: table,
    new_rows: insertRows,
  })

  if (error) {
    return NextResponse.json({
      error: error.message,
      details: error.details || undefined,
      hint: error.hint || undefined,
      code: error.code || undefined,
    }, { status: 400 })
  }

  return NextResponse.json({ inserted: data ?? insertRows.length })
}
