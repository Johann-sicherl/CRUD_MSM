import { NextRequest, NextResponse } from 'next/server'
import { readStructurePropertyRules, writeStructurePropertyRules, type StructurePropertyRule } from '@/lib/structurePropertyRules'

// File-based, same pattern as /api/field-options — no database table involved.

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
