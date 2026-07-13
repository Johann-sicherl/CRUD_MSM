import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { readStructurePropertyRules, type StructurePropertyRule } from '@/lib/structurePropertyRules'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

export async function POST(request: NextRequest) {
  const body = await request.json()
  const protheusCode: string = String(body.protheusCode ?? '').trim()
  const codes: string[] = Array.isArray(body.codes) ? body.codes.map((c: unknown) => String(c).trim()).filter(Boolean) : []

  if (!protheusCode) return NextResponse.json({ error: 'Nome do arquivo não corresponde a um código Protheus' }, { status: 400 })

  const uniqueCodes = new Set(codes)

  const [allRules, equipRes] = await Promise.all([
    Promise.resolve(readStructurePropertyRules()),
    supabaseAdmin.from('standard_equipment_items').select('*').ilike('protheus_code', protheusCode).maybeSingle(),
  ])

  const equipment: Row | null = equipRes.data

  // Group by EVERY property registered in Parâmetros de Estrutura — not just
  // the ones a code happened to match — so a property whose code is missing
  // from this structure is flagged instead of silently disappearing from
  // the report.
  const byProperty = new Map<string, StructurePropertyRule[]>()
  for (const r of allRules) {
    if (!byProperty.has(r.property_field)) byProperty.set(r.property_field, [])
    byProperty.get(r.property_field)!.push(r)
  }

  const properties = Array.from(byProperty.entries()).map(([field, groupRules]) => {
    const matched = groupRules.filter(r => uniqueCodes.has(r.component_code))
    const dbValue = equipment ? (equipment[field] ?? null) : null

    if (matched.length === 0) {
      return {
        field,
        matched: [],
        computedValue: null,
        dbValue,
        status: 'missing' as const,
      }
    }

    const distinctValues = Array.from(new Set(matched.map(m => norm(m.expected_value))))
    const isDuplicate = distinctValues.length > 1
    const computedValue = isDuplicate ? null : matched[0].expected_value
    const mismatch = !isDuplicate && !!equipment && computedValue !== null && norm(dbValue) !== norm(computedValue)

    return {
      field,
      matched: matched.map(m => ({ code: m.component_code, value: m.expected_value })),
      computedValue,
      dbValue,
      status: isDuplicate ? 'duplicate' as const : (mismatch ? 'mismatch' as const : 'ok' as const),
    }
  }).sort((a, b) => a.field.localeCompare(b.field))

  return NextResponse.json({
    protheusCode,
    equipmentFound: !!equipment,
    equipment: equipment ? {
      legacy_equipment_id: equipment.legacy_equipment_id,
      protheus_code: equipment.protheus_code,
      status: equipment.status,
    } : null,
    codesAnalyzed: uniqueCodes.size,
    properties,
  })
}
