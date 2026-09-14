import { NextRequest, NextResponse } from 'next/server'
import { buildProductIntelligenceContext } from '@/lib/productIntelligenceContext'
import { runProductIntelligence } from '@/lib/productIntelligence'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Mesma credencial por requisição de todo o resto do app (nunca persistida
// no servidor — ver protheusDb.ts). Nenhuma checagem de perfil aqui: o
// acesso a esta tela já é controlado por visibleModules (como
// analisador-estruturas/busca-avancada-acessorios) e a credencial Protheus
// em si já é o controle de acesso real pro lado externo.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const apenas: string[] | undefined = Array.isArray(body?.regras) ? body.regras : undefined

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }

  try {
    const ctx = await buildProductIntelligenceContext({ user, password })
    const achados = runProductIntelligence(ctx, apenas)

    const resumo: Record<string, number> = {}
    for (const a of achados) resumo[a.severidade] = (resumo[a.severidade] || 0) + 1

    return NextResponse.json({ achados, resumo, total: achados.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
