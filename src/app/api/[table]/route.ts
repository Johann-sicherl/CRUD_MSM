import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, getSearchableFields, isRealColumnField } from '@/lib/schema'
import { recordInsertAudit } from '@/lib/sqlAudit'
import { protectLocalCostsOnInsert } from '@/lib/localCostGuard'

type RouteParams = { params: { table: string } }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const page  = Math.max(1, parseInt(searchParams.get('page')  || '1'))
  const limit = Math.min(25000, Math.max(1, parseInt(searchParams.get('limit') || '50')))
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

  for (const field of schema.fields.filter(f => !f.isPk && !f.isReadonly && isRealColumnField(f))) {
    if (field.name === 'password' && !body[field.name]) continue
    const val = body[field.name]
    if (val !== undefined && val !== '') {
      insertBody[field.name] = parseValue(field.type, val)
    } else if (!field.nullable && field.defaultValue !== undefined) {
      insertBody[field.name] = field.defaultValue
    }
  }

  // Validate fields that must exist in another table before inserting.
  // If displayField is set, also try matching by name so the user can put
  // either the numeric key or the display name in the Excel file.
  for (const field of schema.fields.filter(f => f.validateExistsIn)) {
    const val = insertBody[field.name]
    if (val === null || val === undefined || val === '') continue
    // A field left at its default (e.g. 0 for "sem alerta") means "none selected" — nothing to validate
    if (field.defaultValue !== undefined && val === field.defaultValue) continue
    const vi = field.validateExistsIn!

    // Try exact match on the key field first
    const { data: foundByKey } = await supabaseAdmin
      .from(vi.table)
      .select(vi.field)
      .eq(vi.field, String(val))
      .maybeSingle()

    if (foundByKey) continue // key matched — nothing to do

    // Key didn't match — try resolving by displayField (user put the name)
    if (vi.displayField) {
      const cols = `${vi.field},${vi.displayField}`
      const { data: foundByName } = await supabaseAdmin
        .from(vi.table)
        .select(cols)
        .ilike(vi.displayField, String(val))
        .maybeSingle()
      if (foundByName) {
        // Replace the name with the resolved numeric key so the INSERT works
        insertBody[field.name] = (foundByName as unknown as Record<string, unknown>)[vi.field]
        continue
      }
    }

    return NextResponse.json({
      error: vi.errorMessage ?? `"${val}" não encontrado em ${vi.table}`,
    }, { status: 400 })
  }

  // Unique-field check: reject if a record with this value already exists
  for (const field of schema.fields.filter(f => f.unique && !f.isPk)) {
    const val = insertBody[field.name]
    if (val === null || val === undefined || val === '') continue
    const { data: existing } = await supabaseAdmin
      .from(table)
      .select(field.name)
      .eq(field.name, String(val))
      .maybeSingle()
    if (existing) {
      return NextResponse.json({
        error: `${field.label}: "${val}" já existe — valor duplicado não é permitido`,
      }, { status: 400 })
    }
  }

  // Auto-increment: compute MAX(field)+1 for fields marked autoIncrement
  const autoIncrFields = schema.fields.filter(f => f.autoIncrement)
  for (const field of autoIncrFields) {
    const { data: maxRow } = await supabaseAdmin
      .from(table)
      .select(field.name)
      .order(field.name, { ascending: false })
      .limit(1)
      .maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const maxVal = maxRow ? (((maxRow as any)[field.name] as number) ?? 0) : 0
    insertBody[field.name] = maxVal + 1
  }

  // Colunas financeiras (FORCE_TO_ONE_FIELDS): o Supabase nunca recebe o
  // valor real digitado aqui — vai sempre 1, e o valor real (se houver) fica
  // só no arquivo local. Mesma proteção que o Atualizador Global já tem para
  // o import em massa via CSV, agora também pra "+ Novo Registro",
  // "Importar Excel" e os modais de Não Combináveis/Dependentes, que também
  // passam por este mesmo endpoint.
  protectLocalCostsOnInsert(table, schema, insertBody, body)

  // Double insert for non_combinable_comps: resolve groups from accessories, insert forward + reversed
  if (schema.doubleInsert) {
    const code1 = insertBody.protheus_code as string
    const code2 = insertBody.remove_list_code as string

    const [res1, res2] = await Promise.all([
      supabaseAdmin.from('accessories').select('legacy_group_id').eq('protheus_code', code1).maybeSingle(),
      supabaseAdmin.from('accessories').select('legacy_group_id').eq('protheus_code', code2).maybeSingle(),
    ])

    if (!res1.data) {
      return NextResponse.json({ error: `Acessório com código "${code1}" não encontrado em Cadastro de Componentes` }, { status: 400 })
    }
    if (!res2.data) {
      return NextResponse.json({ error: `Acessório com código "${code2}" não encontrado em Cadastro de Componentes` }, { status: 400 })
    }

    const group1 = res1.data.legacy_group_id
    const group2 = res2.data.legacy_group_id

    const row1 = { ...insertBody, legacy_group_id: group1, legacy_second_group_id: group2 }
    const row2 = {
      ...insertBody,
      legacy_group_id: group2,
      protheus_code: code2,
      legacy_second_group_id: group1,
      remove_list_code: code1,
    }

    const { data, error } = await supabaseAdmin.from(table).insert([row1, row2]).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    if (schema.auditQueries) {
      try {
        await Promise.all((data as Record<string, unknown>[]).map(inserted =>
          recordInsertAudit(supabaseAdmin, table, schema, inserted)
        ))
      } catch { /* audit log is best-effort — never block the real operation */ }
    }

    return NextResponse.json((data as Record<string, unknown>[])[0], { status: 201 })
  }

  const { data, error } = await supabaseAdmin.from(table).insert(insertBody).select().single()
  if (error) return NextResponse.json({ error: translateDbError(error.message) }, { status: 400 })

  if (schema.auditQueries) {
    try {
      await recordInsertAudit(supabaseAdmin, table, schema, insertBody)
    } catch { /* audit log is best-effort — never block the real operation */ }
  }

  return NextResponse.json(data, { status: 201 })
}

function translateDbError(msg: string): string {
  if (msg.includes('violates foreign key constraint')) {
    const table = msg.match(/on table "([^"]+)"/)?.[1] ?? ''
    const constraint = msg.match(/constraint "([^"]+)"/)?.[1] ?? ''
    return `Valor inválido: referência não encontrada (tabela: ${table || '?'}, restrição: ${constraint || '?'}). Verifique se os IDs informados existem nas tabelas relacionadas.`
  }
  if (msg.includes('violates not-null constraint')) {
    const col = msg.match(/column "([^"]+)"/)?.[1] ?? ''
    return `Campo obrigatório não preenchido${col ? `: "${col}"` : ''}.`
  }
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
    const col = msg.match(/\(([^)]+)\)/)?.[1] ?? ''
    return `Valor duplicado${col ? ` no campo "${col}"` : ''} — este registro já existe.`
  }
  return msg
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
