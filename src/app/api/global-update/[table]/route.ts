import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'
import { convertCsvRows } from '@/lib/globalUpdateConvert'
import { extractRealCosts } from '@/lib/localCostExtract'
import { replaceTableCosts } from '@/lib/localCostStore'

type RouteParams = { params: { table: string } }

// Deliberately does not import anything from '@/lib/sqlAudit' — a full-table
// replace from the official CSV export must never appear in Auditoria.

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  const schema = tables[table]
  if (!schema) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: 'Nenhuma linha para importar' }, { status: 400 })

  // Only real database columns — excludes join-derived display fields
  // (e.g. accessory_name resolved from protheus_code), which don't exist as
  // columns in the actual table and would make the insert fail.
  const insertRows = convertCsvRows(schema, rows)

  // Atomic wipe + reload — see msm_global_table_replace.sql. If the insert
  // fails, the delete rolls back too and the table keeps its original data.
  const { data, error } = await supabaseAdmin.rpc('global_table_replace', {
    target_table: table,
    new_rows: insertRows,
  })

  if (error) {
    return NextResponse.json({
      error: error.message,
      details: error.details || undefined,
      hint: error.hint || undefined,
      code: error.code || undefined,
    }, { status: 400 })
  }

  // Captura os valores financeiros reais do CSV (antes de virarem 1 acima)
  // num arquivo local — nunca vão pro Supabase. Melhor esforço: a
  // substituição real já aconteceu com sucesso, então uma falha aqui (ex.:
  // disco cheio) nunca deve derrubar a resposta de sucesso do import.
  // localCosts na resposta deixa isso visível na própria tela do Atualizador
  // Global, em vez de só no terminal — null = esta tabela não tem nenhuma
  // coluna financeira (nada a capturar, normal); número = quantas linhas
  // tiveram algum valor real capturado; localCostsError = a gravação local
  // falhou (raríssimo — problema de disco/permissão na máquina).
  let localCosts: number | null = null
  let localCostsError: string | undefined
  try {
    const realCosts = extractRealCosts(schema, rows)
    if (realCosts) {
      replaceTableCosts(table, realCosts)
      localCosts = Object.keys(realCosts).length
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'erro desconhecido'
    console.error(`[local-costs] falha ao gravar custos reais locais de "${table}"`, e)
    localCostsError = message
  }

  return NextResponse.json({ inserted: data ?? insertRows.length, localCosts, localCostsError })
}
