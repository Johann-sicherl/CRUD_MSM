import { NextRequest, NextResponse } from 'next/server'
import { readCostStore } from '@/lib/localCostStore'

// Arquivo local, não Supabase — nunca deve ser cacheado entre requisições.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Devolve os valores financeiros reais capturados do CSV (nunca enviados ao
// Supabase) — usado pela própria tela de Cadastro (DataTable) pra mostrar o
// custo real na coluna, no lugar do "1" gravado no banco. Com ?table=nome
// devolve só a fatia daquela tabela (o caso comum — cada tela só precisa da
// sua própria); sem o parâmetro devolve o arquivo inteiro.
export async function GET(request: NextRequest) {
  const table = request.nextUrl.searchParams.get('table')
  const store = readCostStore()
  return NextResponse.json(table ? (store[table] ?? {}) : store)
}
