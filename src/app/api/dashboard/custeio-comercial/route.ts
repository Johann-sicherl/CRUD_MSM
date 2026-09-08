import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, getControllershipPendingFields, TARGET_COST_PENDING_FIELD } from '@/lib/schema'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Visão do Admin sobre o que está pendente do lado da Comercial (Gerente Adm
// Comercial) — cartão "Em Custeio (Comercial)" no Dashboard. Unifica as duas
// fontes que hoje só a própria Comercial vê (ver
// /api/dashboard/pending-controladoria, usado no cartão dela):
//   - novo/emAlteracao: fila pending_target_cost (accessories/
//     standard_equipment_items) — a fila de custeio de verdade, com "Custo
//     Imputado" (em_alteracao) como sinal explícito.
//   - outrasPendencias: demais tabelas com campo de controladoria/fiscal/
//     precificação (IPI, margem, comissões etc.) ainda em 0 — critério mais
//     antigo, sem fila nem flag de "imputado", só "preenchido ou não" (ex.:
//     Grupo de Equipamentos). Nunca conta accessories/standard_equipment_items
//     de novo aqui — pra essas duas, só a fila pending_target_cost vale (ver
//     comentário equivalente em pending-controladoria/route.ts).
//
// novo/emAlteracao vêm direto da contagem de pending_target_cost (a fonte da
// verdade) — nunca de somar as contagens por tabela abaixo. A quebra por
// tabela (pra accessories/standard_equipment_items) busca só a coluna
// protheus_code e casa em memória, normalizando os dois lados
// (.trim().toUpperCase(), mesmo padrão de pendingTargetCostGuard.ts/
// pdmCompare.ts) — um .in(coluna, códigos) direto no Postgres é sensível a
// maiúsculas/minúsculas e podia deixar de contar código com grafia
// divergente na tabela, sem nenhum aviso (ver `unmatched`).
export interface CusteioComercialTable {
  tableName: string
  label: string
  novo: number
  emAlteracao: number
  outrasPendencias: number
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
    Object.entries(tables).map(async ([tableName, schema]) => {
      const usesTargetCostPending = schema.fields.some(f => f.name === TARGET_COST_PENDING_FIELD)
      try {
        if (usesTargetCostPending) {
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
          results.push({ tableName, label: schema.label, novo, emAlteracao, outrasPendencias: 0 })
          return
        }
        const fields = getControllershipPendingFields(schema)
        if (fields.length === 0) return
        const { count, error: countError } = await supabaseAdmin
          .from(tableName)
          .select('*', { count: 'exact', head: true })
          .or(fields.map(f => `${f.name}.eq.0`).join(','))
        if (countError) throw countError
        results.push({ tableName, label: schema.label, novo: 0, emAlteracao: 0, outrasPendencias: count ?? 0 })
      } catch {
        results.push({ tableName, label: schema.label, novo: -1, emAlteracao: -1, outrasPendencias: -1 })
      }
    })
  )

  results.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  const novo = novoCodes.size
  const emAlteracao = emAlteracaoCodes.size
  const unmatched = novoCodes.size + emAlteracaoCodes.size - matchedCodes.size
  const outrasPendencias = results.reduce((sum, r) => sum + (r.outrasPendencias > 0 ? r.outrasPendencias : 0), 0)

  return NextResponse.json({
    tables: results,
    novo,
    emAlteracao,
    outrasPendencias,
    unmatched,
    total: novo + emAlteracao + outrasPendencias,
  })
}
