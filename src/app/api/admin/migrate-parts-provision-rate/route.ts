import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'
import { getRowKey } from '@/lib/csvBaseline'
import { readCostStore, updateCostRow } from '@/lib/localCostStore'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Migração de uma vez só: parts_provision_rate acabou de entrar em
// FORCE_TO_ONE_FIELDS (era só CONTROLLERSHIP_FIELDS antes — sigilo nenhum),
// então todo valor real que já estava direto no Supabase precisa ser
// capturado no arquivo local ANTES de virar 1 lá, senão o valor real se
// perde. Idempotente: roda de novo sem efeito nenhum, porque só migra
// linhas de "equipments" que ainda não têm parts_provision_rate no arquivo
// local — depois da primeira vez, todas já têm (mesmo que null).
export async function POST() {
  const schema = tables.equipments
  const { data, error } = await supabaseAdmin.from('equipments').select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const store = readCostStore()
  const existing = store.equipments ?? {}

  const idsToForce: string[] = []
  let migrated = 0
  for (const row of (data || []) as Record<string, unknown>[]) {
    const key = getRowKey(schema, row)
    if (existing[key]?.values && 'parts_provision_rate' in existing[key].values) continue // já migrada

    const raw = row.parts_provision_rate
    const n = raw === null || raw === undefined ? null : Number(raw)
    if (n !== null && Number.isNaN(n)) continue // valor inválido — não mexe, revisar manualmente

    updateCostRow('equipments', key, { parts_provision_rate: n })
    if (n !== null) idsToForce.push(String(row.id))
    migrated++
  }

  if (idsToForce.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('equipments')
      .update({ parts_provision_rate: 1 })
      .in('id', idsToForce)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ migrated, forced: idsToForce.length, total: (data || []).length })
}
