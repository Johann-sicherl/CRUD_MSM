import { NextRequest, NextResponse } from 'next/server'
import { listAllStructureHeaders } from '@/lib/protheusDb'

// Returns every ESTRUTURA header registered in the live Protheus database,
// unfiltered — used by the view-only "existe no Protheus?" flag column in
// Cadastro de Equipamentos. Credentials come in per request and are never
// stored server-side — see src/lib/protheusDb.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }

  try {
    const headers = await listAllStructureHeaders({ user, password })
    return NextResponse.json({ headers })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
