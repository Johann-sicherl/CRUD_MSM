import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, getControllershipPendingFields } from '@/lib/schema'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Conta, por tabela, quantos registros ainda têm algum campo de
// controladoria/fiscal/precificação em 0 (a "chave" de pendência — ver
// localCostGuard.ts). Mesmo critério do filtro "Somente Novos" de perfil
// restrito em DataTable.tsx, só que agregado pra todas as tabelas de uma vez
// — usado pelo cartão de pendências do Dashboard.
export interface PendingControladoriaTable {
  tableName: string
  label: string
  count: number
}

export async function GET() {
  const results: PendingControladoriaTable[] = []

  await Promise.all(
    Object.entries(tables).map(async ([tableName, schema]) => {
      const fields = getControllershipPendingFields(schema)
      if (fields.length === 0) return
      try {
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
