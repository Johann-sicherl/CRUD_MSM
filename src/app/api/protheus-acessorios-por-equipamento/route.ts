import { NextRequest, NextResponse } from 'next/server'
import { listAccessoryHierarchy } from '@/lib/protheusDb'

// Feeds "Busc. Avançada Acessórios" — for every ESTRUTURA header matching
// headerPrefixes (default "26"), returns its NIVEL 2 (direct children) and
// NIVEL 3 (grandchildren) rows — nothing deeper. Credentials come in on
// every request and are never persisted server-side — see
// src/lib/protheusDb.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const headerPrefixes: string[] = Array.isArray(body?.headerPrefixes) ? body.headerPrefixes.map((p: unknown) => String(p)) : []

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (headerPrefixes.length === 0) {
    return NextResponse.json({ error: 'Informe ao menos um prefixo de estrutura' }, { status: 400 })
  }

  try {
    const groups = await listAccessoryHierarchy(headerPrefixes, { user, password })
    return NextResponse.json({ groups })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
