import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { renameCostRow } from '@/lib/localCostStore'

// Aplica a substituição de revisão de componente (Consulta PDM x Banco MSM):
// troca o código antigo pelo novo em accessories e em toda tabela que
// referencia um Código Protheus de componente, numa única transação (ver
// msm_replace_protheus_code.sql — PRÉ-REQUISITO: rodar esse arquivo uma vez
// no Supabase SQL Editor antes de usar esta rota). Migra também o custo
// real local (fora do Postgres) só depois do banco confirmar sucesso.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const oldCode = String(body?.oldCode ?? '').trim()
  const newCode = String(body?.newCode ?? '').trim()
  const fields = (body?.fields ?? {}) as Record<string, string | undefined>
  if (!oldCode || !newCode) {
    return NextResponse.json({ error: 'Informe o código antigo e o código novo' }, { status: 400 })
  }

  // fields chega no mesmo formato de string usado pelo formulário
  // (pdmRowToPrefill) — converte pros tipos reais que a função SQL espera,
  // pra não depender de o Postgres coagir texto pra integer/numeric sozinho.
  const asText = (v: string | undefined) => (v === undefined || v === '') ? null : v
  const asInt = (v: string | undefined) => { const n = v === undefined ? NaN : parseInt(v, 10); return Number.isNaN(n) ? null : n }
  const asNum = (v: string | undefined) => { const n = v === undefined ? NaN : parseFloat(v); return Number.isNaN(n) ? null : n }

  try {
    const { data, error } = await supabaseAdmin.rpc('replace_protheus_code', {
      p_old_code: oldCode,
      p_new_code: newCode,
      p_name: asText(fields.name),
      p_legacy_group_id: asInt(fields.legacy_group_id),
      p_color: asText(fields.color),
      p_predominant_material: asText(fields.predominant_material),
      p_dimensional_mm: asNum(fields.dimensional_mm),
      p_quantity_monitor_totem: asInt(fields.quantity_monitor_totem),
      p_monitor_size: asNum(fields.monitor_size),
      p_description: asText(fields.description),
    })

    if (error) {
      return NextResponse.json({
        error: error.message,
        details: error.details || undefined,
        hint: error.hint || undefined,
      }, { status: 400 })
    }

    renameCostRow('accessories', oldCode, newCode)

    return NextResponse.json({ counts: data })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao substituir o código'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
