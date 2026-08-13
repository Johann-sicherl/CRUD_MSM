import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'
import { convertCsvRows } from '@/lib/globalUpdateConvert'
import { shouldCompareField, valuesEqual, formatDiffValue, getRowLabel, getRowKey } from '@/lib/csvBaseline'

type RouteParams = { params: { table: string } }

// POST não é alvo do Data Cache do Next.js, mas força mesmo assim — esta
// rota sempre precisa refletir o banco no exato momento da chamada.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export interface CompareDiff {
  rowLabel: string
  fieldLabel: string
  current: string
  received: string
  kind: 'changed' | 'new' | 'missing'
}

// Compara o CSV que está prestes a ser importado contra o que está no banco
// AGORA (não contra o baseline do import anterior) — usado pelo checkbox
// "Comparar valores recebidos com o banco de dados atual" do Atualizador
// Global, para avisar antes de rodar a substituição cega (que apaga e
// recarrega a tabela inteira). Mesma conversão de linha usada pela
// substituição de verdade (convertCsvRows), pra a comparação nunca apontar
// uma diferença que na prática não existiria depois de aplicada.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  const schema = tables[table]
  if (!schema) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: 'Nenhuma linha para comparar' }, { status: 400 })

  const incomingRows = convertCsvRows(schema, rows)

  const { data: liveRows, error } = await supabaseAdmin.from(table).select('*').range(0, 24999)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Casa as linhas pela mesma chave de negócio que a Auditoria usa (ex.:
  // protheus_code) — NUNCA pelo id/uuid interno, que o Postgres gera de novo
  // a cada import e por isso nunca repetiria entre o CSV e o banco mesmo
  // quando a linha é idêntica (ver getRowKey em csvBaseline.ts).
  const liveByKey = new Map<string, Record<string, unknown>>()
  for (const row of (liveRows ?? []) as Record<string, unknown>[]) {
    liveByKey.set(getRowKey(schema, row), row)
  }
  const incomingByKey = new Map<string, Record<string, unknown>>()
  for (const row of incomingRows) {
    incomingByKey.set(getRowKey(schema, row), row)
  }

  const compareFields = schema.fields.filter(shouldCompareField)
  const diffs: CompareDiff[] = []

  for (const [key, liveRow] of liveByKey) {
    const incomingRow = incomingByKey.get(key)
    if (!incomingRow) {
      diffs.push({
        rowLabel: getRowLabel(schema, liveRow),
        fieldLabel: '(registro inteiro)',
        current: 'existe no banco',
        received: 'ausente no CSV — seria excluído',
        kind: 'missing',
      })
      continue
    }
    for (const field of compareFields) {
      const cur = liveRow[field.name]
      const rec = incomingRow[field.name]
      if (!valuesEqual(field, cur, rec)) {
        diffs.push({
          rowLabel: getRowLabel(schema, liveRow),
          fieldLabel: field.label,
          current: formatDiffValue(field, cur),
          received: formatDiffValue(field, rec),
          kind: 'changed',
        })
      }
    }
  }

  for (const [key, incomingRow] of incomingByKey) {
    if (liveByKey.has(key)) continue
    diffs.push({
      rowLabel: getRowLabel(schema, incomingRow),
      fieldLabel: '(registro inteiro)',
      current: 'não existe no banco',
      received: 'novo no CSV — seria inserido',
      kind: 'new',
    })
  }

  return NextResponse.json({ diffs })
}
