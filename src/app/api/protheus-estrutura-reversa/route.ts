import { NextRequest, NextResponse } from 'next/server'
import { listStructureHeaders } from '@/lib/protheusDb'

// Reverse search: lists every ESTRUTURA header registered in the live
// Protheus database that starts with one of the given prefixes, so gaps
// against our internal catalog (standard_equipment_items) can be spotted —
// the caller cross-checks internal presence itself and re-uses the normal
// per-code analysis for each result.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const prefixes: string[] = Array.isArray(body?.prefixes)
    ? body.prefixes.map((p: unknown) => String(p).trim()).filter(Boolean)
    : []

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (prefixes.length === 0) {
    return NextResponse.json({ error: 'Informe ao menos um prefixo para buscar' }, { status: 400 })
  }

  try {
    const headers = await listStructureHeaders(prefixes, { user, password })
    return NextResponse.json({ headers })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
