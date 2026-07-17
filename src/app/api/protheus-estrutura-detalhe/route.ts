import { NextRequest, NextResponse } from 'next/server'
import { explodeBomForExport } from '@/lib/protheusDb'

// Feeds the "Exportar Excel" button in Busc. Itens Série Estrut. — returns
// the full exploded BOM tree (quantity/cost/unit/type per line) so the
// client can build the 2-Estruturas/FLAT-LIST/IDENTADO/PROPRIEDADES_ESTRUTURA
// workbook. Credentials come in on every request and are never persisted
// server-side — see src/lib/protheusDb.ts.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const protheusCode = String(body?.protheusCode ?? '').trim()

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (!protheusCode) {
    return NextResponse.json({ error: 'Código Protheus não informado' }, { status: 400 })
  }

  try {
    const { rows, descEstrutura, found } = await explodeBomForExport(protheusCode, { user, password })
    if (!found) {
      return NextResponse.json({ error: 'Estrutura não encontrada no Protheus' }, { status: 404 })
    }
    return NextResponse.json({ rows, descEstrutura })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
