import { NextRequest, NextResponse } from 'next/server'
import { readUpsAutonomyCatalog, writeUpsAutonomyCatalog, type UpsAutonomyCatalog } from '@/lib/upsAutonomyStore'

// Caminho fixo (sem [param] dinâmico) + GET junto de método mutante — sem
// isso, um build de produção pode marcar a rota como estática (só GET) e
// PUT cai no 405 padrão do Next. Ver o mesmo achado em
// structure-property-rules/route.ts (specs/telas-auxiliares.md).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  return NextResponse.json(readUpsAutonomyCatalog())
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as UpsAutonomyCatalog
  if (!Array.isArray(body?.ups) || !Array.isArray(body?.batteryGroups) || !Array.isArray(body?.batteryExternal)) {
    return NextResponse.json({ error: 'Corpo inválido — esperado { ups, batteryGroups, batteryExternal }' }, { status: 400 })
  }
  writeUpsAutonomyCatalog(body)
  return NextResponse.json(body)
}
