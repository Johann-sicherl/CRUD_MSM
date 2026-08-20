import { NextRequest, NextResponse } from 'next/server'
import { tables } from '@/lib/schema'
import { extractRealCosts } from '@/lib/localCostExtract'
import { replaceTableCosts } from '@/lib/localCostStore'

type RouteParams = { params: { table: string } }

// Deliberadamente NÃO toca o Supabase — nem 'select', nem 'update', nem RPC
// nenhuma. Só extrai os valores financeiros reais (FORCE_TO_ONE_FIELDS) do
// CSV oficial e grava no arquivo local desta máquina (ver localCostStore.ts).
// Usado pelo Importador de Custos Locais: uma máquina nova (sem
// local-data/real-costs.json ainda) processa os mesmos CSVs oficiais do
// Atualizador Global, sem precisar de acesso a esse módulo nem risco nenhum
// de mexer nos dados reais do banco.

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  const schema = tables[table]
  if (!schema) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const body = await request.json()
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: 'Nenhuma linha para importar' }, { status: 400 })

  const realCosts = extractRealCosts(schema, rows)
  if (!realCosts) {
    return NextResponse.json({ error: 'Esta tabela não tem nenhuma coluna financeira — nada a importar aqui' }, { status: 400 })
  }

  try {
    replaceTableCosts(table, realCosts)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'erro desconhecido'
    return NextResponse.json({ error: `Falha ao gravar o arquivo local: ${message}` }, { status: 500 })
  }

  return NextResponse.json({ localCosts: Object.keys(realCosts).length })
}
