import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Devolve todo o conteúdo de pending_target_cost, indexado por
// protheus_code — usado pelo RecordModal (prefill do checkbox do Admin) e
// pelo DataTable (terceira aba "Em processo de alteração de custeio" do
// perfil restrito). Tabela pequena por natureza (só itens em trânsito de
// aprovação de custo), então devolver tudo de uma vez é mais simples do que
// filtrar por tabela/código.
export async function GET() {
  const { data, error } = await supabaseAdmin.from('pending_target_cost').select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byCode: Record<string, { status: string; flagged_at: string; status_changed_at: string | null }> = {}
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const code = String(row.protheus_code ?? '')
    if (!code) continue
    byCode[code] = {
      status: String(row.status ?? 'novo'),
      flagged_at: String(row.flagged_at ?? ''),
      status_changed_at: row.status_changed_at ? String(row.status_changed_at) : null,
    }
  }
  return NextResponse.json(byCode)
}
