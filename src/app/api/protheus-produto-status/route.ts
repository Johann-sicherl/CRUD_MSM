import { NextRequest, NextResponse } from 'next/server'
import { listProductStatuses } from '@/lib/protheusDb'

// Returns the ATIVO/BLOQUEADO status of every product registered in the
// Protheus product master (SB1010), keyed by code — used by the view-only
// Protheus status flag column in Cadastro de Equipamentos. Credentials come
// in per request and are never stored server-side — see src/lib/protheusDb.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }

  try {
    const statusByCode = await listProductStatuses({ user, password })
    return NextResponse.json({ statuses: Object.fromEntries(statusByCode) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
