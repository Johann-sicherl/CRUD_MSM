import { NextRequest, NextResponse } from 'next/server'
import { readIgnoredAccessories, writeIgnoredAccessories, type IgnoredAccessory } from '@/lib/ignoredAccessories'

// File-based, mesmo padrão de /api/structure-property-rules — sem tabela no
// banco. GET/PUT (substitui a lista inteira) porque o único jeito de editar
// isso é sempre "carreguei tudo, mudei um item, salvei tudo de novo" — tanto
// em Busc. Avanç. Acessórios Protheus (adiciona um) quanto em Parâm. Itens
// de Série e Acessórios (remove um).
//
// Sem essas duas linhas, um build de produção pode marcar esta rota como
// estática (só GET) — PUT cai no 405 padrão do Next em vez de rodar o
// handler. Ver o mesmo comentário em structure-property-rules/route.ts.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  return NextResponse.json(readIgnoredAccessories())
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: 'Esperava uma lista (array) de acessórios ignorados' }, { status: 400 })
  }

  // Dedup por código normalizado (.trim().toUpperCase(), convenção do
  // projeto inteiro) — a última ocorrência de um código repetido vence.
  const byCode = new Map<string, IgnoredAccessory>()
  for (const row of body) {
    const codigo = String(row?.codigo ?? '').trim()
    if (!codigo) continue
    const denominacao = String(row?.denominacao ?? '').trim()
    byCode.set(codigo.toUpperCase(), { codigo, denominacao })
  }
  const clean = Array.from(byCode.values()).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))

  writeIgnoredAccessories(clean)
  return NextResponse.json(clean)
}
