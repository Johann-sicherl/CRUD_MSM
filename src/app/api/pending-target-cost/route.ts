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
    // Normaliza igual a quem grava aqui (pendingTargetCostGuard.ts sempre
    // salva em maiúsculo/trim) — defesa extra: se alguma linha antiga tiver
    // ficado com espaço/caixa diferente por qualquer motivo, quem consome
    // esta rota (DataTable.tsx, Custos Gerais VMI) já normaliza a própria
    // chave de busca do mesmo jeito, então a chave devolvida aqui tem que
    // bater exatamente, sem depender de o dado já estar perfeito na tabela.
    const code = String(row.protheus_code ?? '').trim().toUpperCase()
    if (!code) continue
    byCode[code] = {
      status: String(row.status ?? 'novo'),
      flagged_at: String(row.flagged_at ?? ''),
      status_changed_at: row.status_changed_at ? String(row.status_changed_at) : null,
    }
  }
  return NextResponse.json(byCode)
}
