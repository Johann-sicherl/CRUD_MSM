import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'
import { convertCsvRows } from '@/lib/globalUpdateConvert'
import { getProfileById } from '@/lib/userProfileStore'
import { isDoubleCheckTable } from '@/lib/queryDoubleCheck'

type RouteParams = { params: { table: string } }

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Mesma substituição atômica de /api/global-update/[table] (reaproveita a
// mesma função global_table_replace), só que grava em "<tabela>_check" —
// a cópia estrutural usada pela tela "Double-check de Queries" (ver
// msm_query_double_check.sql) — nunca na tabela real.
//
// Diferença deliberada: NUNCA chama extractRealCosts/replaceTableCosts.
// convertCsvRows já força FORCE_TO_ONE_FIELDS pro sentinela sozinho — o
// valor real do CSV é simplesmente descartado aqui, nunca capturado em
// lugar nenhum (nem no arquivo local de custos reais), pedido explícito do
// usuário: esta tela não precisa saber o custo de verdade, só testar se as
// queries rodam.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  const schema = tables[table]
  if (!schema || !isDoubleCheckTable(table)) {
    return NextResponse.json({ error: 'Esta tabela não tem cópia _check disponível' }, { status: 404 })
  }

  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: 'Nenhuma linha para importar' }, { status: 400 })

  const insertRows = convertCsvRows(schema, rows)

  const { data, error } = await supabaseAdmin.rpc('global_table_replace', {
    target_table: `${table}_check`,
    new_rows: insertRows,
  })

  if (error) {
    return NextResponse.json({
      error: error.message,
      details: error.details || undefined,
      hint: error.hint || undefined,
      code: error.code || undefined,
    }, { status: 400 })
  }

  return NextResponse.json({ inserted: data ?? insertRows.length })
}
