import { NextRequest, NextResponse } from 'next/server'
import {
  readEquipmentClassificationRules,
  writeEquipmentClassificationRules,
} from '@/lib/equipmentClassificationRules'
import type { EquipmentClassificationRule } from '@/lib/equipmentClassification'

// File-based, same pattern as /api/field-options and /api/structure-property-rules
// — no database table involved.

export async function GET() {
  return NextResponse.json(readEquipmentClassificationRules())
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: 'Esperava uma lista (array) de regras' }, { status: 400 })
  }

  const clean: EquipmentClassificationRule[] = []
  for (let i = 0; i < body.length; i++) {
    const row = body[i]
    const patterns = Array.isArray(row?.patterns)
      ? row.patterns.map((p: unknown) => String(p).trim()).filter(Boolean)
      : []
    const combinator = row?.combinator === 'AND' ? 'AND' : 'OR'
    const equip = String(row?.equip ?? '').trim()
    const fam = String(row?.fam ?? '').trim()
    const equipId = String(row?.equipId ?? '').trim()
    const fabric = String(row?.fabric ?? '').trim()

    if (patterns.length === 0 || !equip) {
      return NextResponse.json({
        error: `Linha ${i + 1}: precisa ter ao menos um padrão e o campo "Equipamento" preenchido`,
      }, { status: 400 })
    }
    clean.push({ patterns, combinator, equip, fam, equipId, fabric })
  }

  writeEquipmentClassificationRules(clean)
  return NextResponse.json({ saved: clean.length })
}
