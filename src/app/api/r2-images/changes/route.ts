import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getProfileById } from '@/lib/userProfileStore'

// Histórico de alterações (upload/substituição/renomeação/remoção) feitas
// pela tela "Grupos de Imagens" — equivalente automático da seção 13 do
// manual da TI ("Registre a alteração"). .range() explícito, mesmo padrão
// documentado em specs/dados-e-schema.md (cap de 1000 do PostgREST).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const profile = await getProfileById(searchParams.get('profileId') ?? '')
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('image_change_log')
    .select('*')
    .order('created_at', { ascending: false })
    .range(0, 199)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ changes: data || [] })
}
