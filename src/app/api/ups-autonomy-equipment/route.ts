import { NextRequest, NextResponse } from 'next/server'
import { readUpsAutonomyEquipment, writeUpsAutonomyEquipment, type UpsAutonomyEquipment } from '@/lib/upsAutonomyStore'

// Mesmo motivo de force-dynamic/no-store de ups-autonomy-catalog/route.ts.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  return NextResponse.json(readUpsAutonomyEquipment())
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as UpsAutonomyEquipment
  if (!Array.isArray(body?.equipmentNames) || !Array.isArray(body?.equipmentBom) || typeof body?.equipmentLoadParams !== 'object') {
    return NextResponse.json({ error: 'Corpo inválido — esperado { equipmentNames, equipmentBom, equipmentLoadParams }' }, { status: 400 })
  }
  writeUpsAutonomyEquipment(body)
  return NextResponse.json(body)
}
