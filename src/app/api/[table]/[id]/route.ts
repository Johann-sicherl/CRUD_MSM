import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'
import { recordDeleteAudit } from '@/lib/sqlAudit'
import { protectLocalCostsOnDelete } from '@/lib/localCostGuard'
import { clearPendingTargetCostOnDelete } from '@/lib/pendingTargetCostGuard'
import { updateTableRow } from '@/lib/tableWrite'

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
  const schema = tables[table]
  if (!schema) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const { data, error } = await updateTableRow(supabaseAdmin, table, schema, id, body)
  if (error) return NextResponse.json({ error }, { status: 400 })
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
