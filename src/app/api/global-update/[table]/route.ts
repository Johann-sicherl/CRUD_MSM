import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, FORCE_TO_ONE_FIELDS, getRealColumnFields } from '@/lib/schema'

type RouteParams = { params: { table: string } }

// Deliberately does not import anything from '@/lib/sqlAudit' — a full-table
// replace from the official CSV export must never appear in Auditoria.

function toCellValue(type: string, raw: unknown): unknown {
  if (raw === undefined || raw === null) return null
  const s = String(raw).trim()
  if (s === '') return null
  if (type === 'jsonb') {
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
      out[field.name] = toCellValue(field.type, raw)
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
