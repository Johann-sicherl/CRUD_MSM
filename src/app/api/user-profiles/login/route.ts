import { NextRequest, NextResponse } from 'next/server'
import { verifyLogin } from '@/lib/userProfileStore'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Confere usuário + senha — a única rota que vê a senha em texto puro, só
// pra comparar com o hash guardado (nunca grava, nunca loga, nunca devolve).
export async function POST(request: NextRequest) {
  const body = await request.json()
  const id = String(body?.id ?? '')
  const password = String(body?.password ?? '')
  if (!id || !password) {
    return NextResponse.json({ error: 'Informe o perfil e a senha' }, { status: 400 })
  }

  try {
    const profile = await verifyLogin(id, password)
    if (!profile) return NextResponse.json({ error: 'Perfil ou senha inválidos' }, { status: 401 })
    return NextResponse.json(profile)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao entrar'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
