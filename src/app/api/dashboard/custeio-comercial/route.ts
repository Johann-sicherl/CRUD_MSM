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
//
// novo/emAlteracao/total vêm direto da contagem de pending_target_cost (a
// fonte da verdade) — nunca de somar as contagens por tabela abaixo. A
// quebra por tabela é só informativa: pending_target_cost não guarda em qual
// tabela cada código está, então pra descobrir isso é preciso buscar
// protheus_code de accessories/standard_equipment_items e casar em memória,
// normalizando os dois lados (.trim().toUpperCase(), mesmo padrão de
// pendingTargetCostGuard.ts/pdmCompare.ts) — um .in(coluna, códigos) direto
// no Postgres é sensível a maiúsculas/minúsculas e deixava de contar
// qualquer código cuja grafia na tabela divergisse da grafia salva na fila,
// fazendo a soma por tabela (e o card) ficar menor que a fila de verdade sem
// nenhum aviso. `unmatched` sinaliza exatamente esse caso quando acontece.
export interface CusteioComercialTable {
  tableName: string
  label: string
  novo: number
  emAlteracao: number
}

const normalize = (v: unknown) => String(v ?? '').trim().toUpperCase()

export async function GET() {
  const { data, error } = await supabaseAdmin.from('pending_target_cost').select('protheus_code, status')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const novoCodes = new Set<string>()
  const emAlteracaoCodes = new Set<string>()
  for (const row of (data ?? []) as { protheus_code: unknown; status: unknown }[]) {
    const code = normalize(row.protheus_code)
    if (!code) continue
    if (row.status === 'em_alteracao') emAlteracaoCodes.add(code)
    else novoCodes.add(code)
  }

  const matchedCodes = new Set<string>()
  const results: CusteioComercialTable[] = []

  await Promise.all(
    Object.entries(tables)
      .filter(([, schema]) => schema.fields.some(f => f.name === TARGET_COST_PENDING_FIELD))
      .map(async ([tableName, schema]) => {
        try {
          const { data: rows, error: tableError } = await supabaseAdmin.from(tableName).select('protheus_code')
          if (tableError) throw tableError
          let novo = 0
          let emAlteracao = 0
          for (const r of (rows ?? []) as { protheus_code: unknown }[]) {
            const code = normalize(r.protheus_code)
            if (!code) continue
            if (novoCodes.has(code)) { novo++; matchedCodes.add(code) }
            else if (emAlteracaoCodes.has(code)) { emAlteracao++; matchedCodes.add(code) }
          }
          results.push({ tableName, label: schema.label, novo, emAlteracao })
        } catch {
          results.push({ tableName, label: schema.label, novo: -1, emAlteracao: -1 })
        }
      })
  )

  results.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  const novo = novoCodes.size
  const emAlteracao = emAlteracaoCodes.size
  const unmatched = novoCodes.size + emAlteracaoCodes.size - matchedCodes.size

  return NextResponse.json({ tables: results, novo, emAlteracao, total: novo + emAlteracao, unmatched })
}
