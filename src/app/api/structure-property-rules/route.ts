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

// Add (or update, if the same property_field + component_code already exists)
// a single entry — mirrors /api/field-options' add-one-value interaction.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const property_field = String(body?.property_field ?? '').trim()
  const component_code = String(body?.component_code ?? '').trim()
  const expected_value = String(body?.expected_value ?? '').trim()
  if (!property_field || !component_code || !expected_value) {
    return NextResponse.json({ error: 'Informe property_field, component_code e expected_value' }, { status: 400 })
  }

  const rules = readStructurePropertyRules()
  const idx = rules.findIndex(r => r.property_field === property_field && r.component_code === component_code)
  if (idx >= 0) rules[idx] = { property_field, component_code, expected_value }
  else rules.push({ property_field, component_code, expected_value })
  writeStructurePropertyRules(rules)

  return NextResponse.json(rules.filter(r => r.property_field === property_field))
}

// Remove a single entry by property_field + component_code.
export async function DELETE(request: NextRequest) {
  const body = await request.json()
  const property_field = String(body?.property_field ?? '').trim()
  const component_code = String(body?.component_code ?? '').trim()

  const rules = readStructurePropertyRules()
    .filter(r => !(r.property_field === property_field && r.component_code === component_code))
  writeStructurePropertyRules(rules)

  return NextResponse.json(rules.filter(r => r.property_field === property_field))
}
