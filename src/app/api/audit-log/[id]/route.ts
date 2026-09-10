import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

type RouteParams = { params: { id: string } }

// PUT/DELETE não são alvo do Data Cache do Next.js, mas força mesmo assim
// (mesmo padrão de global-update/[table]/compare/route.ts) — consistência
// com o GET de audit-log/route.ts, que precisa disso de verdade.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const VALID_STATUSES = ['pending', 'exported', 'applied']

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = params
  const body = await request.json()
  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .update({ status: body.status })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = params
  const { error } = await supabaseAdmin.from('audit_log').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ deleted: true, id })
}
