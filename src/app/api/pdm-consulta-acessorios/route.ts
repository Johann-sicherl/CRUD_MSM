import { NextRequest, NextResponse } from 'next/server'
import { fetchPdmAccessories } from '@/lib/pdmDb'

// Feeds a tela Consulta PDM x Supabase — roda a query fornecida pelo usuário
// contra o banco VMI (srvvmis03) e devolve os atributos de item já
// convertidos. Credenciais chegam a cada requisição e nunca são persistidas
// — ver src/lib/pdmDb.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco PDM' }, { status: 400 })
  }

  try {
    const rows = await fetchPdmAccessories({ user, password })
    return NextResponse.json({ rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco PDM'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
