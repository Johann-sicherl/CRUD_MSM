import { NextRequest, NextResponse } from 'next/server'
import { fetchStructureCodes } from '@/lib/protheusDb'

// Reads the BOM live from the Protheus SQL Server instead of a manually
// exported .xlsx. Credentials come in on every request and are never
// persisted server-side — see src/lib/protheusDb.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const protheusCode = String(body?.protheusCode ?? '').trim()

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (!protheusCode) {
    return NextResponse.json({ error: 'Código Protheus não informado' }, { status: 400 })
  }

  try {
    const codes = await fetchStructureCodes(protheusCode, { user, password })
    return NextResponse.json({ codes })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
