import { NextRequest, NextResponse } from 'next/server'
import { readStructurePropertyRules, writeStructurePropertyRules, type StructurePropertyRule } from '@/lib/structurePropertyRules'

// File-based, same pattern as /api/field-options — no database table involved.
//
// Sem essas duas linhas, um build de produção (npm run serve/next start)
// pode marcar esta rota como estática (só GET, pré-renderizada em build) —
// PUT nunca é elegível pra isso, então cai no 405 padrão do Next em vez de
// rodar o handler. Achado real: as três rotas JSON-file-backed (esta,
// equipment-classification-rules, ignored-accessories) não tinham essa
// declaração e passaram a devolver 405 em PUT num build de produção — só
// /api/product-intelligence/route.ts já tinha, e nunca teve esse problema.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  return NextResponse.json(readStructurePropertyRules())
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: 'Esperava uma lista (array) de parâmetros' }, { status: 400 })
  }

  const clean: StructurePropertyRule[] = []
  for (let i = 0; i < body.length; i++) {
    const row = body[i]
    const field = String(row?.property_field ?? '').trim()
    const code = String(row?.component_code ?? '').trim()
    const value = String(row?.expected_value ?? '').trim()
    if (!field || !code || !value) {
      return NextResponse.json({
        error: `Linha ${i + 1}: precisa ter "property_field", "component_code" e "expected_value" preenchidos`,
      }, { status: 400 })
    }
    clean.push({ property_field: field, component_code: code, expected_value: value })
  }

  writeStructurePropertyRules(clean)
  return NextResponse.json({ saved: clean.length })
}
