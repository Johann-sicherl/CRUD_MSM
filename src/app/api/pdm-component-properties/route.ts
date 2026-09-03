import { NextRequest, NextResponse } from 'next/server'
import { fetchPdmComponentProperties } from '@/lib/pdmProperties'

// Feeds o painel de propriedades expansível em Consulta PDM x Banco MSM —
// dado o DocumentID do PDM de um componente (peça ou montagem), traz as
// propriedades dele e, se for montagem, de toda a estrutura (todos os
// níveis) que ela referencia. Ver src/lib/pdmProperties.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const documentId = Number(body?.documentId)

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco PDM' }, { status: 400 })
  }
  if (!Number.isFinite(documentId)) {
    return NextResponse.json({ error: 'documentId inválido' }, { status: 400 })
  }

  try {
    const rows = await fetchPdmComponentProperties({ user, password }, documentId)
    return NextResponse.json({ rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar propriedades no PDM'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
