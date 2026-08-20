import { NextResponse } from 'next/server'
import { resetPassword } from '@/lib/userProfileStore'

type RouteParams = { params: { id: string } }

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// "Restaurar senha" — chamado da própria tela de login (sem estar logado)
// depois de uma tentativa com senha errada. Apaga a senha atual; a próxima
// que for digitada nesse perfil vira a nova senha (ver verifyLogin).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    await resetPassword(params.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao restaurar senha'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
