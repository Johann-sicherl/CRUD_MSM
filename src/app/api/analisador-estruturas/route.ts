import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { readStructurePropertyRules } from '@/lib/structurePropertyRules'
import { computeStructurePropertyResults } from '@/lib/structurePropertyMatch'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

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
  const properties = computeStructurePropertyResults(uniqueCodes, equipment, allRules)

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
