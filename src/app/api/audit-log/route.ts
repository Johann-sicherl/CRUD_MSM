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

  // .range() explícito — sem isso, o cap padrão de 1000 linhas do PostgREST
  // corta silenciosamente qualquer linha mais antiga assim que audit_log
  // passa de 1000 registros no total (não por tabela/status — no total).
  // Bug real: uma pendência de semanas atrás sumia da exportação "TXTs por
  // tabela/ação" (que usa exatamente esta rota, sem filtro nenhum) mesmo
  // continuando visível quando filtrada por status — a tela não tem
  // paginação nenhuma, então ela assume que recebeu tudo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabaseAdmin.from('audit_log').select('*').order('created_at', { ascending: false }).range(0, 24999)
  if (table) query = query.eq('table_name', table)
  if (status) query = query.eq('status', status)
  if (operation) query = query.eq('operation', operation)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data || [] })
}
