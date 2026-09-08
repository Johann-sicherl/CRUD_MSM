import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, TARGET_COST_PENDING_FIELD } from '@/lib/schema'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Visão do Admin sobre a fila de custeio da Comercial (Gerente Adm
// Comercial) — cartão "Em Custeio (Comercial)" no Dashboard. Mesma fonte que
// /api/dashboard/pending-controladoria (tabela pending_target_cost), mas
// aqui interessa a fila INTEIRA (novo + em_alteracao), separada por status:
//   - novo: Admin já sinalizou "Pendente de custo alvo", Comercial ainda não
//     imputou nada.
//   - em_alteracao: Comercial já clicou "✓ Custo Imputado" (DataTable.tsx),
//     aguardando confirmação oficial via reimport no Atualizador Global.
export interface CusteioComercialTable {
  tableName: string
  label: string
  novo: number
  emAlteracao: number
}

export async function GET() {
  const { data, error } = await supabaseAdmin.from('pending_target_cost').select('protheus_code, status')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const novoCodes: string[] = []
  const emAlteracaoCodes: string[] = []
  for (const row of (data ?? []) as { protheus_code: unknown; status: unknown }[]) {
    const code = String(row.protheus_code ?? '')
    if (!code) continue
    if (row.status === 'em_alteracao') emAlteracaoCodes.push(code)
    else novoCodes.push(code)
  }

  const results: CusteioComercialTable[] = []

  await Promise.all(
    Object.entries(tables)
      .filter(([, schema]) => schema.fields.some(f => f.name === TARGET_COST_PENDING_FIELD))
      .map(async ([tableName, schema]) => {
        try {
          const [novoCount, emAlteracaoCount] = await Promise.all([
            novoCodes.length === 0 ? 0 : supabaseAdmin
              .from(tableName).select('*', { count: 'exact', head: true }).in('protheus_code', novoCodes)
              .then(r => r.count ?? 0),
            emAlteracaoCodes.length === 0 ? 0 : supabaseAdmin
              .from(tableName).select('*', { count: 'exact', head: true }).in('protheus_code', emAlteracaoCodes)
              .then(r => r.count ?? 0),
          ])
          results.push({ tableName, label: schema.label, novo: novoCount, emAlteracao: emAlteracaoCount })
        } catch {
          results.push({ tableName, label: schema.label, novo: -1, emAlteracao: -1 })
        }
      })
  )

  results.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  const novo = results.reduce((sum, r) => sum + (r.novo > 0 ? r.novo : 0), 0)
  const emAlteracao = results.reduce((sum, r) => sum + (r.emAlteracao > 0 ? r.emAlteracao : 0), 0)

  return NextResponse.json({ tables: results, novo, emAlteracao, total: novo + emAlteracao })
}
