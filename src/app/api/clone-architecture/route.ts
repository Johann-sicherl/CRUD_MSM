import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'
import { recordInsertAudit } from '@/lib/sqlAudit'

// Used by "Clonagem Estrut. Avançada" — copies the rule rows tied to a source
// equipment (across the 4 tables below) into a target equipment, after the
// user reviewed/edited/removed items on the client. Never touches any other
// table, never mutates the source equipment's own rows.

type Row = Record<string, unknown>

interface ClonePayload {
  sourceEquipmentId: number
  targetEquipmentId: number
  items: {
    relationship_equip_accessory: Row[]
    dependant_items: Row[]
    non_combinable_comps: Row[]
    roller_tables: Row[]
  }
}

// Identity key per table — an item that already exists on the target
// equipment under this same key is skipped instead of duplicated.
const IDENTITY_KEYS: Record<string, string[]> = {
  relationship_equip_accessory: ['protheus_code'],
  dependant_items: ['protheus_code', 'protheus_item_code'],
  non_combinable_comps: ['protheus_code', 'remove_list_code'],
  roller_tables: ['protheus_code', 'type'],
}

// Fields actually copied per table (everything real and user-editable in the
// review step) — legacy_equipment_id is always forced to the target instead,
// id/timestamps are never carried over, and non_combinable_comps' two group-id
// columns are always resolved fresh from Cadastro de Componentes below
// instead of being copied, in case the user edited a code during review.
const COPY_FIELDS: Record<string, string[]> = {
  relationship_equip_accessory: ['protheus_code', 'description', 'legacy_general_alert_id', 'operation_time', 'status', 'maximum_quantity'],
  dependant_items: ['protheus_code', 'protheus_item_code', 'quantity', 'cost_std', 'proportional_factor'],
  non_combinable_comps: ['protheus_code', 'remove_list_code', 'status'],
  roller_tables: ['protheus_code', 'type'],
}

function identityValue(table: string, row: Row): string {
  return IDENTITY_KEYS[table].map(k => String(row[k] ?? '').trim().toUpperCase()).join('|')
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<ClonePayload>

  const sourceId = Number(body.sourceEquipmentId)
  const targetId = Number(body.targetEquipmentId)
  if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
    return NextResponse.json({ error: 'Equipamento de origem/destino inválido' }, { status: 400 })
  }
  if (sourceId === targetId) {
    return NextResponse.json({ error: 'O equipamento de destino deve ser diferente do de origem' }, { status: 400 })
  }

  const items = body.items
  if (!items || typeof items !== 'object') {
    return NextResponse.json({ error: 'Nenhum item para clonar' }, { status: 400 })
  }

  const [{ data: targetEquip }, { data: accessoryRows }] = await Promise.all([
    supabaseAdmin.from('equipments').select('legacy_id').eq('legacy_id', targetId).maybeSingle(),
    supabaseAdmin.from('accessories').select('protheus_code, legacy_group_id'),
  ])
  if (!targetEquip) {
    return NextResponse.json({ error: 'Equipamento de destino não encontrado' }, { status: 400 })
  }

  const groupByCode = new Map<string, number | null>()
  for (const a of (accessoryRows ?? []) as Row[]) {
    groupByCode.set(String(a.protheus_code).trim().toUpperCase(), (a.legacy_group_id as number | null) ?? null)
  }

  const result: Record<string, { created: number; skipped: number; invalid: string[] }> = {}

  for (const tableName of Object.keys(IDENTITY_KEYS)) {
    const rows = Array.isArray(items[tableName as keyof ClonePayload['items']])
      ? (items[tableName as keyof ClonePayload['items']] as Row[])
      : []
    result[tableName] = { created: 0, skipped: 0, invalid: [] }
    if (rows.length === 0) continue

    const schema = tables[tableName]
    const { data: existingTargetRows } = await supabaseAdmin
      .from(tableName)
      .select('*')
      .eq('legacy_equipment_id', targetId)
    const existingKeys = new Set((existingTargetRows ?? []).map(r => identityValue(tableName, r as Row)))

    const toInsert: Row[] = []
    for (const row of rows) {
      const codeFields = tableName === 'roller_tables' || tableName === 'relationship_equip_accessory'
        ? ['protheus_code']
        : tableName === 'dependant_items'
        ? ['protheus_code', 'protheus_item_code']
        : ['protheus_code', 'remove_list_code']

      const invalidCode = codeFields.find(f => {
        const code = String(row[f] ?? '').trim().toUpperCase()
        return !code || !groupByCode.has(code)
      })
      if (invalidCode) {
        result[tableName].invalid.push(String(row[invalidCode] ?? '(vazio)'))
        continue
      }

      const key = identityValue(tableName, row)
      if (existingKeys.has(key)) {
        result[tableName].skipped++
        continue
      }
      existingKeys.add(key) // guard against duplicates within the same submitted batch too

      const insertBody: Row = { legacy_equipment_id: targetId }
      for (const f of COPY_FIELDS[tableName]) {
        insertBody[f] = row[f] ?? null
      }
      if (tableName === 'non_combinable_comps') {
        const code1 = String(row.protheus_code).trim().toUpperCase()
        const code2 = String(row.remove_list_code).trim().toUpperCase()
        insertBody.legacy_group_id = groupByCode.get(code1) ?? null
        insertBody.legacy_second_group_id = groupByCode.get(code2) ?? null
      }
      toInsert.push(insertBody)
    }

    if (toInsert.length === 0) continue

    const { data: inserted, error } = await supabaseAdmin.from(tableName).insert(toInsert).select()
    if (error) {
      return NextResponse.json({ error: `Falha ao clonar em ${schema?.label ?? tableName}: ${error.message}`, partial: result }, { status: 400 })
    }
    result[tableName].created = inserted?.length ?? 0

    if (schema?.auditQueries) {
      try {
        await Promise.all((inserted as Row[]).map(r => recordInsertAudit(supabaseAdmin, tableName, schema, r)))
      } catch { /* audit log is best-effort — never block the real operation */ }
    }
  }

  return NextResponse.json({ result })
}
