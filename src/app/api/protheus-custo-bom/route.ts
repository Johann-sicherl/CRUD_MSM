import { NextRequest, NextResponse } from 'next/server'
import { calculateBomCost } from '@/lib/protheusDb'

// Custo BOM (Busc. Itens Série Estrut.): soma o custo só das linhas de
// matéria-prima (B1_TIPO = 'MP'), excluindo estruturas fantasma, em
// qualquer nível — evita contar duas vezes o custo de um subconjunto que já
// tem CUSTO_STD próprio. Credenciais nunca são salvas — ver protheusDb.ts.

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
    const summary = await calculateBomCost(protheusCode, { user, password })
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
