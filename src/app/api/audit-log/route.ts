import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Supabase não deve ser cacheado entre requisições — sem isto, um Descartar/
// Marcar aplicado em outra sessão (ou até nesta mesma, dependendo do cache
// de rota do Next) podia continuar mostrando uma linha já apagada/alterada
// mesmo depois de recarregar a página. Mesmo padrão já aplicado em
// pending-target-cost/route.ts, local-costs/route.ts etc.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const table = searchParams.get('table')
  const status = searchParams.get('status')
  const operation = searchParams.get('operation')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabaseAdmin.from('audit_log').select('*').order('created_at', { ascending: false })
  if (table) query = query.eq('table_name', table)
  if (status) query = query.eq('status', status)
  if (operation) query = query.eq('operation', operation)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data || [] })
}
