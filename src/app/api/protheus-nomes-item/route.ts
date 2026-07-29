import { NextRequest, NextResponse } from 'next/server'
import { getEquipmentItemNames } from '@/lib/protheusDb'

// Resolves the display name (B1_DESC, falling back to DESC_ESTRUTURA, then
// 'N/A') for a batch of protheus_code values — used by the EQUIPAMENTOS
// group in Produtos Dependentes. Credentials come in per request and are
// never stored server-side — see src/lib/protheusDb.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const codes = Array.isArray(body?.codes) ? body.codes.map((c: unknown) => String(c)) : []

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (codes.length === 0) {
    return NextResponse.json({ names: {} })
  }

  try {
    const names = await getEquipmentItemNames(codes, { user, password })
    return NextResponse.json({ names })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
