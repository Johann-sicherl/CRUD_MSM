import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { tables, getSearchableFields } from '@/lib/schema'

type RouteParams = { params: { table: string } }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  if (!tables[table]) {
    return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))
  const search = (searchParams.get('search') || '').trim()
  const offset = (page - 1) * limit

  const schema = tables[table]
  const orderCol = schema.orderBy.includes(' ') ? schema.orderBy : `"${schema.orderBy}"`

  let whereClause = ''
  const queryValues: unknown[] = []

  if (search) {
    const searchFields = getSearchableFields(table)
    if (searchFields.length > 0) {
      const conditions = searchFields.map((col, i) => `"${col}"::text ILIKE $${i + 1}`)
      whereClause = `WHERE ${conditions.join(' OR ')}`
      queryValues.push(...searchFields.map(() => `%${search}%`))
    }
  }

  const countQ = `SELECT COUNT(*) FROM "${table}" ${whereClause}`
  const countRes = await pool.query(countQ, queryValues)
  const total = parseInt(countRes.rows[0].count)

  const n = queryValues.length
  const dataQ = `SELECT * FROM "${table}" ${whereClause} ORDER BY ${orderCol} LIMIT $${n + 1} OFFSET $${n + 2}`
  const dataRes = await pool.query(dataQ, [...queryValues, limit, offset])

  return NextResponse.json({
    data: dataRes.rows,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  if (!tables[table]) {
    return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })
  }

  const body = await request.json()
  const schema = tables[table]

  const allowedFields = schema.fields.filter(f => !f.isPk && !f.isReadonly)
  const insertFields: string[] = []
  const insertValues: unknown[] = []

  for (const field of allowedFields) {
    if (field.name === 'password' && (!body[field.name] || body[field.name] === '')) continue
    if (body[field.name] !== undefined && body[field.name] !== '') {
      insertFields.push(`"${field.name}"`)
      insertValues.push(parseFieldValue(field.type, body[field.name]))
    } else if (!field.nullable && field.defaultValue !== undefined) {
      insertFields.push(`"${field.name}"`)
      insertValues.push(field.defaultValue)
    }
  }

  if (insertFields.length === 0) {
    return NextResponse.json({ error: 'Nenhum campo fornecido' }, { status: 400 })
  }

  const placeholders = insertValues.map((_, i) => `$${i + 1}`)
  const q = `INSERT INTO "${table}" (${insertFields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`

  const res = await pool.query(q, insertValues)
  return NextResponse.json(res.rows[0], { status: 201 })
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
