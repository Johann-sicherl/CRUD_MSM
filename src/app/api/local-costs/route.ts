import { NextResponse } from 'next/server'
import { readCostStore } from '@/lib/localCostStore'

// Arquivo local, não Supabase — nunca deve ser cacheado entre requisições.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Devolve o arquivo local inteiro (todas as tabelas) — os valores
// financeiros reais capturados do CSV, que nunca são enviados ao Supabase.
// Usado pela tela "Custos Reais (Local)".
export async function GET() {
  return NextResponse.json(readCostStore())
}
