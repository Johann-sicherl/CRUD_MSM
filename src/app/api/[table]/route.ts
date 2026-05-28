import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, getSearchableFields } from '@/lib/schema'

type RouteParams = { params: { table: string } }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const page  = Math.max(1, parseInt(searchParams.get('page')  || '1'))
  const limit = Math.min(5000, Math.max(1, parseInt(searchParams.get('limit') || '50')))
  const search = (searchParams.get('search') || '').trim()
  const offset = (page - 1) * limit

  const schema = tables[table]
  const orderParts = schema.orderBy.split(' ')
  const orderColumn = orderParts[0]
  const ascending = orderParts[1]?.toUpperCase() !== 'DESC'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabaseAdmin.from(table).select('*', { count: 'exact' })

  if (search) {
    const fields = getSearchableFields(table)
    if (fields.length > 0) {
      query = query.or(fields.map((f: string) => `${f}.ilike.%${search}%`).join(','))
    }
  }

  const { data, count, error } = await query
    .order(orderColumn, { ascending })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const total = count || 0
  return NextResponse.json({ data: data || [], total, page, limit, pages: Math.ceil(total / limit) })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const schema = tables[table]
  const insertBody: Record<string, unknown> = {}

  for (const field of schema.fields.filter(f => !f.isPk && !f.isReadonly)) {
    if (field.name === 'password' && !body[field.name]) continue
    const val = body[field.name]
    if (val !== undefined && val !== '') {
      insertBody[field.name] = parseValue(field.type, val)
    } else if (!field.nullable && field.defaultValue !== undefined) {
      insertBody[field.name] = field.defaultValue
    }
  }

  const { data, error } = await supabaseAdmin.from(table).insert(insertBody).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}

function parseValue(type: string, value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (type === 'jsonb') {
    if (typeof value === 'string') { try { return JSON.parse(value) } catch { return value } }
    return value
  }
  if (type === 'boolean') return value === true || value === 'true'
  if (type === 'number')  return parseInt(String(value))
  if (type === 'decimal') return parseFloat(String(value))
  return value
}
