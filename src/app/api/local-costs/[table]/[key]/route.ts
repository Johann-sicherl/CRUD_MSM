import { NextRequest, NextResponse } from 'next/server'
import { tables, FORCE_TO_ONE_FIELDS } from '@/lib/schema'
import { updateCostRow } from '@/lib/localCostStore'

type RouteParams = { params: { table: string; key: string } }

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Edição manual de um valor financeiro real, feita na tela "Custos Reais
// (Local)". Grava SÓ no arquivo local (ver localCostStore.ts) — em nenhuma
// hipótese chama o Supabase, mesmo que a linha correspondente exista lá com
// o campo forçado em 1.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { table, key } = params
  const schema = tables[table]
  if (!schema) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const rawValues = body?.values
  if (!rawValues || typeof rawValues !== 'object') {
    return NextResponse.json({ error: 'Nenhum valor recebido' }, { status: 400 })
  }

  // Só aceita campos que são de fato colunas financeiras desta tabela —
  // ignora qualquer outra chave que venha no corpo da requisição.
  const fieldNames = new Set(schema.fields.map(f => f.name))
  const values: Record<string, number | null> = {}
  for (const [name, raw] of Object.entries(rawValues as Record<string, unknown>)) {
    if (!FORCE_TO_ONE_FIELDS.includes(name) || !fieldNames.has(name)) continue
    if (raw === null || raw === '') { values[name] = null; continue }
    const n = Number(raw)
    if (!Number.isNaN(n)) values[name] = n
  }
  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo financeiro válido recebido' }, { status: 400 })
  }

  const row = updateCostRow(table, key, values)
  return NextResponse.json(row)
}
