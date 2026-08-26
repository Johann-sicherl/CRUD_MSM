import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

type RouteParams = { params: { code: string } }

// Botão "já imputei o custo" da Gerente Adm Comercial — move o código de
// 'novo' pra 'em_alteracao' (some de "Somente Novos", entra em "Em
// processo de alteração de custeio"). Não faz nada se o código não estiver
// mais em pending_target_cost (ex.: já saiu via reimportação no Atualizador
// Global entre a Gerente abrir a tela e clicar no botão).
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const code = decodeURIComponent(params.code).trim().toUpperCase()
  if (!code) return NextResponse.json({ error: 'Código Protheus não informado' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const status = body?.status === 'novo' ? 'novo' : 'em_alteracao'

  const { data, error } = await supabaseAdmin
    .from('pending_target_cost')
    .update({ status, status_changed_at: new Date().toISOString() })
    .eq('protheus_code', code)
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Este código não está mais pendente de aprovação de custo' }, { status: 404 })

  return NextResponse.json(data)
}
