import { NextRequest, NextResponse } from 'next/server'
import { listAccessoryHierarchy } from '@/lib/protheusDb'

// Feeds "Busc. Avançada Acessórios" — for every ESTRUTURA header matching
// headerPrefixes (default "26"), returns its NIVEL 2 (direct children) rows,
// only descending into NIVEL 3 (grandchildren) for a NIVEL 2 node whose own
// código matches nivel2Prefixes (default "27.13"). Credentials come in on
// every request and are never persisted server-side — see
// src/lib/protheusDb.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const headerPrefixes: string[] = Array.isArray(body?.headerPrefixes) ? body.headerPrefixes.map((p: unknown) => String(p)) : []
  const nivel2Prefixes: string[] = Array.isArray(body?.nivel2Prefixes) ? body.nivel2Prefixes.map((p: unknown) => String(p)) : []

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (headerPrefixes.length === 0) {
    return NextResponse.json({ error: 'Informe ao menos um prefixo de estrutura' }, { status: 400 })
  }

  try {
    const groups = await listAccessoryHierarchy(headerPrefixes, nivel2Prefixes, { user, password })
    return NextResponse.json({ groups })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
