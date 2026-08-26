import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, getControllershipPendingFields, TARGET_COST_PENDING_FIELD } from '@/lib/schema'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Conta, por tabela, quantos registros ainda precisam de atenção da
// Controladoria/Fiscal/Precificação. Duas fontes, dependendo da tabela:
//   - accessories/standard_equipment_items (usesTargetCostPending): fila
//     pending_target_cost, status 'novo' — só o que ainda não foi sinalizado
//     pela Comercial conta aqui ('em_alteracao' já está em andamento, não
//     entra nesse número; ver DataTable.tsx e o botão "✓ Custo Imputado").
//   - demais tabelas com campo de controladoria (ex.: equipments — IPI,
//     margem, comissões): critério antigo, algum campo em 0 (ver
//     localCostGuard.ts) — sem mudança nenhuma aqui.
// Mesmo critério do filtro "Somente Novos" de perfil restrito em
// DataTable.tsx, só que agregado pra todas as tabelas de uma vez.
export interface PendingControladoriaTable {
  tableName: string
  label: string
  count: number
}

export async function GET() {
  const { data: pendingRows } = await supabaseAdmin
    .from('pending_target_cost')
    .select('protheus_code')
    .eq('status', 'novo')
  const pendingCodes = (pendingRows ?? []).map(r => String((r as { protheus_code: unknown }).protheus_code))

  const results: PendingControladoriaTable[] = []

  await Promise.all(
    Object.entries(tables).map(async ([tableName, schema]) => {
      const usesTargetCostPending = schema.fields.some(f => f.name === TARGET_COST_PENDING_FIELD)
      try {
        if (usesTargetCostPending) {
          if (pendingCodes.length === 0) { results.push({ tableName, label: schema.label, count: 0 }); return }
          const { count } = await supabaseAdmin
            .from(tableName)
            .select('*', { count: 'exact', head: true })
            .in('protheus_code', pendingCodes)
          results.push({ tableName, label: schema.label, count: count ?? 0 })
          return
        }
        const fields = getControllershipPendingFields(schema)
        if (fields.length === 0) return
        const { count } = await supabaseAdmin
          .from(tableName)
          .select('*', { count: 'exact', head: true })
          .or(fields.map(f => `${f.name}.eq.0`).join(','))
        results.push({ tableName, label: schema.label, count: count ?? 0 })
      } catch {
        results.push({ tableName, label: schema.label, count: -1 })
      }
    })
  )

  results.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  const total = results.filter(r => r.count > 0).reduce((sum, r) => sum + r.count, 0)

  return NextResponse.json({ tables: results, total })
}
