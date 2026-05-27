import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { tables } from '@/lib/schema'

type RouteParams = { params: { table: string; id: string } }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { table, id } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const res = await pool.query(`SELECT * FROM "${table}" WHERE id = $1`, [id])
  if (res.rows.length === 0) return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 })
  return NextResponse.json(res.rows[0])
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { table, id } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const schema = tables[table]
  const allowedFields = schema.fields.filter(f => !f.isPk && !f.isReadonly)

  const setClauses: string[] = []
  const values: unknown[] = []
  let idx = 1

  for (const field of allowedFields) {
    if (field.name === 'password' && (!body[field.name] || body[field.name] === '')) continue
    if (body[field.name] !== undefined) {
      setClauses.push(`"${field.name}" = $${idx++}`)
      values.push(parseFieldValue(field.type, body[field.name]))
    }
  }

  if (schema.hasTimestamps) {
    setClauses.push(`"updated_at" = NOW()`)
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 })
  }

  values.push(id)
  const q = `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`
  const res = await pool.query(q, values)
  if (res.rows.length === 0) return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 })
  return NextResponse.json(res.rows[0])
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { table, id } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const res = await pool.query(`DELETE FROM "${table}" WHERE id = $1 RETURNING id`, [id])
  if (res.rows.length === 0) return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 })
  return NextResponse.json({ deleted: true, id })
}

function parseFieldValue(type: string, value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (type === 'jsonb') {
    if (typeof value === 'string') {
      try { return JSON.parse(value) } catch { return value }
    }
    return value
  }
  if (type === 'boolean') return value === true || value === 'true' || value === '1'
  if (type === 'number') return parseInt(String(value))
  if (type === 'decimal') return parseFloat(String(value))
  return value
}
