import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'
import { convertCsvRows } from '@/lib/globalUpdateConvert'
import { shouldCompareField, valuesEqual, formatDiffValue, getRowLabel } from '@/lib/csvBaseline'

type RouteParams = { params: { table: string } }

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

  // Assume, como o resto do fluxo do Atualizador Global (global_table_replace,
  // csv_baseline_snapshots), que o CSV é uma exportação oficial da própria
  // tabela e sempre traz o id de cada linha — é isso que permite comparar
  // linha com linha sem ambiguidade.
  const liveById = new Map<string, Record<string, unknown>>()
  for (const row of (liveRows ?? []) as Record<string, unknown>[]) {
    const id = String(row.id ?? '')
    if (id) liveById.set(id, row)
  }
  const incomingById = new Map<string, Record<string, unknown>>()
  for (const row of incomingRows) {
    const id = String(row.id ?? '')
    if (id) incomingById.set(id, row)
  }

  const compareFields = schema.fields.filter(shouldCompareField)
  const diffs: CompareDiff[] = []

  for (const [id, liveRow] of liveById) {
    const incomingRow = incomingById.get(id)
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

  for (const [id, incomingRow] of incomingById) {
    if (liveById.has(id)) continue
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
