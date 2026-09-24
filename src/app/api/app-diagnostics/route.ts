import { NextRequest, NextResponse } from 'next/server'
import { runAppDiagnostics } from '@/lib/appDiagnostics'
import { getProfileById } from '@/lib/userProfileStore'

// Diagnóstico da Aplicação — só Admin (pedido explícito do usuário), checado
// no servidor via getProfileById (nunca um isAdmin solto do corpo — ver
// specs/permissoes-e-perfis.md). Credencial Protheus vem por requisição,
// nunca persistida (mesmo padrão de /api/protheus-produto-status).
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }

  try {
    const sections = await runAppDiagnostics({ user, password })
    return NextResponse.json({ sections })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao rodar o diagnóstico'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
