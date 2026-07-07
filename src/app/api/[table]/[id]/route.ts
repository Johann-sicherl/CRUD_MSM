import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'
import { recordUpdateAudit, recordDeleteAudit } from '@/lib/sqlAudit'

type RouteParams = { params: { table: string; id: string } }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { table, id } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const { data, error } = await supabaseAdmin.from(table).select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { table, id } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const schema = tables[table]
  const updateBody: Record<string, unknown> = {}

  for (const field of schema.fields.filter(f => !f.isPk && !f.isReadonly)) {
    if (field.name === 'password' && !body[field.name]) continue
    if (body[field.name] !== undefined) {
      updateBody[field.name] = parseValue(field.type, body[field.name])
    }
  }

  if (schema.hasTimestamps) updateBody.updated_at = new Date().toISOString()

  let beforeRow: Record<string, unknown> | null = null
  if (schema.auditQueries) {
    const { data: before } = await supabaseAdmin.from(table).select('*').eq('id', id).maybeSingle()
    beforeRow = before as Record<string, unknown> | null
  }

  const { data, error } = await supabaseAdmin.from(table).update(updateBody).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (schema.auditQueries) {
    try {
      await recordUpdateAudit(supabaseAdmin, table, schema, beforeRow, updateBody)
    } catch { /* audit log is best-effort — never block the real operation */ }
  }

  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { table, id } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })
  const schema = tables[table]

  const { data, error } = await supabaseAdmin.from(table).delete().eq('id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (schema.auditQueries && data) {
    try {
      await recordDeleteAudit(supabaseAdmin, table, schema, data as Record<string, unknown>)
    } catch { /* audit log is best-effort — never block the real operation */ }
  }

  return NextResponse.json({ deleted: true, id })
}

function parseValue(type: string, value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (type === 'jsonb') {
    if (typeof value === 'string') { try { return JSON.parse(value) } catch { return value } }
    return value
  }
  if (type === 'boolean') return value === true || value === 'true'
  if (type === 'number')  { const n = parseInt(String(value));   return Number.isNaN(n) ? null : n }
  if (type === 'decimal') { const n = parseFloat(String(value)); return Number.isNaN(n) ? null : n }
  return value
}
