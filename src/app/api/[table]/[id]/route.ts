import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, isRealColumnField, FORCE_TO_ONE_FIELDS } from '@/lib/schema'
import { recordUpdateAudit, recordDeleteAudit } from '@/lib/sqlAudit'
import { protectLocalCostsOnUpdate, protectLocalCostsOnDelete } from '@/lib/localCostGuard'
import { syncPendingTargetCostOnWrite, clearPendingTargetCostOnDelete } from '@/lib/pendingTargetCostGuard'

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

  for (const field of schema.fields.filter(f => !f.isPk && !f.isReadonly && isRealColumnField(f))) {
    if (field.name === 'password' && !body[field.name]) continue
    if (body[field.name] !== undefined) {
      updateBody[field.name] = parseValue(field.type, body[field.name])
    }
  }

  if (schema.hasTimestamps) updateBody.updated_at = new Date().toISOString()

  const hasForceFields = schema.fields.some(f => FORCE_TO_ONE_FIELDS.includes(f.name))
  let beforeRow: Record<string, unknown> | null = null
  if (schema.auditQueries || hasForceFields) {
    const { data: before } = await supabaseAdmin.from(table).select('*').eq('id', id).maybeSingle()
    beforeRow = before as Record<string, unknown> | null
  }

  // Colunas financeiras (FORCE_TO_ONE_FIELDS): o Supabase nunca recebe o
  // valor real digitado aqui — vai sempre 1. Só captura como "real" o que
  // realmente mudou em relação ao que já estava salvo (beforeRow), pra
  // reabrir/salvar o formulário sem tocar no custo não sobrescrever com 1 o
  // valor real já guardado localmente.
  const realCostFieldsChanged = protectLocalCostsOnUpdate(table, schema, updateBody, body, beforeRow)

  const { data, error } = await supabaseAdmin.from(table).update(updateBody).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (schema.auditQueries) {
    try {
      await recordUpdateAudit(supabaseAdmin, table, schema, beforeRow, updateBody, realCostFieldsChanged)
    } catch { /* audit log is best-effort — never block the real operation */ }
  }

  try {
    const protheusCode = String(updateBody.protheus_code ?? beforeRow?.protheus_code ?? '')
    await syncPendingTargetCostOnWrite(supabaseAdmin, schema, body, protheusCode)
  } catch { /* best-effort — never block the real operation */ }

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

  // Sem isto, o custo real (ou IPI/margem/comissões etc.) capturado
  // localmente pro registro excluído ficava órfão no arquivo local pra
  // sempre. Melhor esforço, como as outras proteções de local-costs.
  if (data) protectLocalCostsOnDelete(table, schema, data as Record<string, unknown>)
  if (data) clearPendingTargetCostOnDelete(supabaseAdmin, schema, data as Record<string, unknown>)

  // non_combinable_comps grava cada regra como duas linhas espelhadas
  // (A→B e B→A, ver POST doubleInsert) — sem isto, excluir uma linha pela
  // tela deixava a linha espelhada viva, reaparecendo na lista como se
  // nada tivesse sido apagado.
  if (schema.doubleInsert && data) {
    const row = data as Record<string, unknown>
    const { data: mirror } = await supabaseAdmin
      .from(table)
      .delete()
      .eq('legacy_equipment_id', row.legacy_equipment_id as number)
      .eq('protheus_code', row.remove_list_code as string)
      .eq('remove_list_code', row.protheus_code as string)
      .select()
      .maybeSingle()

    if (schema.auditQueries && mirror) {
      try {
        await recordDeleteAudit(supabaseAdmin, table, schema, mirror as Record<string, unknown>)
      } catch { /* audit log is best-effort — never block the real operation */ }
    }
    if (mirror) protectLocalCostsOnDelete(table, schema, mirror as Record<string, unknown>)
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
