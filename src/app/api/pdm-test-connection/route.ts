import { NextRequest, NextResponse } from 'next/server'
import { testPdmConnection } from '@/lib/pdmDb'

// Usada só pelo modal de login do PDM (pdmAuthContext.tsx) — confirma que
// usuário/senha realmente autenticam antes de marcar a conexão como
// "conectada" na Sidebar. Nunca persiste a credencial (mesmo padrão do
// resto do app): abre a conexão, testa, fecha.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco PDM' }, { status: 400 })
  }

  try {
    await testPdmConnection({ user, password })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao conectar ao banco PDM'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
