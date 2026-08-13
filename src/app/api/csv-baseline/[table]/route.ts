import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables } from '@/lib/schema'

type RouteParams = { params: { table: string } }

// Esta rota não lê searchParams/cookies/headers (só o segmento dinâmico
// [table]), então o Next.js não tem nenhum "Dynamic API" óbvio pra detectar
// e pode cachear a resposta do fetch() interno do supabase-js indefinidamente
// (Data Cache do App Router) — diferente de /api/[table], que usa
// searchParams e por isso já escapa desse cache sozinho. Sem isso, depois de
// um reimport pelo Atualizador Global o snapshot muda no banco mas esta
// rota podia continuar servindo a resposta antiga pra sempre. Força sempre
// buscar de novo.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Retrato do último import feito pelo Atualizador Global de Tabelas para
// esta tabela (gravado atomicamente por global_table_replace — ver
// msm_global_table_replace.sql). Usado pelo DataTable para destacar em
// amarelo tudo que foi criado/editado manualmente depois desse import.
// snapshot vem null quando a tabela nunca passou pelo Atualizador Global —
// nesse caso o DataTable simplesmente não destaca nada.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { table } = params
  if (!tables[table]) return NextResponse.json({ error: 'Tabela não encontrada' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('csv_baseline_snapshots')
    .select('snapshot, imported_at')
    .eq('table_name', table)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ snapshot: null, importedAt: null })
  return NextResponse.json({ snapshot: data.snapshot, importedAt: data.imported_at })
}
