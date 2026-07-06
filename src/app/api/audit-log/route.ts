import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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
