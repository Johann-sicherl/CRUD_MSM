import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Conta, por tabela, quantas linhas referenciam o código antigo — mostrado
// na tela de prévia antes de confirmar a substituição de revisão (Consulta
// PDM x Banco MSM). Só leitura, nada é alterado aqui.

interface CountTarget {
  table: string
  label: string
  columns: string[]
}

const TARGETS: CountTarget[] = [
  { table: 'accessories', label: 'Cadastro de Componentes', columns: ['protheus_code'] },
  { table: 'relationship_equip_accessory', label: 'Equipamento x Acessórios', columns: ['protheus_code'] },
  { table: 'non_combinable_comps', label: 'Não Combináveis', columns: ['protheus_code', 'remove_list_code'] },
  { table: 'dependant_items', label: 'Produtos Dependentes', columns: ['protheus_code', 'protheus_item_code'] },
  { table: 'roller_tables', label: 'Tipo Mesas de Roletes', columns: ['protheus_code'] },
  { table: 'pending_target_cost', label: 'Fila de Aprovação de Custo', columns: ['protheus_code'] },
]

export async function POST(request: NextRequest) {
  const body = await request.json()
  const oldCode = String(body?.oldCode ?? '').trim()
  if (!oldCode) return NextResponse.json({ error: 'Informe o código antigo' }, { status: 400 })

  try {
    const counts: Record<string, number> = {}
    for (const target of TARGETS) {
      let total = 0
      for (const column of target.columns) {
        const { count, error } = await supabaseAdmin
          .from(target.table)
          .select('*', { count: 'exact', head: true })
          .eq(column, oldCode)
        if (error) throw error
        total += count || 0
      }
      counts[target.table] = total
    }
    return NextResponse.json({
      counts,
      labels: Object.fromEntries(TARGETS.map(t => [t.table, t.label])),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar referências do código'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
