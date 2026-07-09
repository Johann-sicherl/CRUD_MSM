import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

export async function POST(request: NextRequest) {
  const body = await request.json()
  const protheusCode: string = String(body.protheusCode ?? '').trim()
  const codes: string[] = Array.isArray(body.codes) ? body.codes.map((c: unknown) => String(c).trim()).filter(Boolean) : []

  if (!protheusCode) return NextResponse.json({ error: 'Nome do arquivo não corresponde a um código Protheus' }, { status: 400 })

  const uniqueCodes = Array.from(new Set(codes))

  const [rulesRes, equipRes] = await Promise.all([
    uniqueCodes.length > 0
      ? supabaseAdmin.from('structure_property_rules').select('*').in('component_code', uniqueCodes)
      : Promise.resolve({ data: [] as Row[] }),
    supabaseAdmin.from('standard_equipment_items').select('*').ilike('protheus_code', protheusCode).maybeSingle(),
  ])

  const rules: Row[] = rulesRes.data || []
  const equipment: Row | null = equipRes.data

  const byProperty = new Map<string, Row[]>()
  for (const r of rules) {
    if (!byProperty.has(r.property_field)) byProperty.set(r.property_field, [])
    byProperty.get(r.property_field)!.push(r)
  }

  const properties = Array.from(byProperty.entries()).map(([field, matched]) => {
    const distinctValues = Array.from(new Set(matched.map(m => norm(m.expected_value))))
    const isDuplicate = distinctValues.length > 1
    const computedValue = isDuplicate ? null : matched[0].expected_value
    const dbValue = equipment ? (equipment[field] ?? null) : null
    const mismatch = !isDuplicate && !!equipment && computedValue !== null && norm(dbValue) !== norm(computedValue)

    return {
      field,
      matched: matched.map(m => ({ code: m.component_code, value: m.expected_value })),
      computedValue,
      dbValue,
      status: isDuplicate ? 'duplicate' : (mismatch ? 'mismatch' : 'ok'),
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
    codesAnalyzed: uniqueCodes.length,
    properties,
  })
}
