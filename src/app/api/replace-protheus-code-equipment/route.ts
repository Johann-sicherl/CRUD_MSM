import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { renameCostRow } from '@/lib/localCostStore'

// Análoga a /api/replace-protheus-code (accessories), mas pro domínio de
// Cadastro de Equipamentos (standard_equipment_items) — pedido explícito do
// usuário: editar o protheus_code direto no formulário normal de Cadastro
// de Componentes/Equipamentos deve cascatear pra toda tabela que referencia
// aquele código, disparando a Auditoria pra cada uma. A troca de código de
// accessories já tinha esse mecanismo (replace_protheus_code, usado pela
// tela "Consulta PDM x Banco MSM") — esta rota é o equivalente pro código
// de equipamento, chamada pelo RecordModal quando `tableName ===
// 'standard_equipment_items'` e o protheus_code mudou numa edição normal.
//
// Escopo bem mais estreito que o de accessories (confirmado explicitamente
// com o usuário): só dependant_items.protheus_code (campo "Cód. Item") e
// pending_target_cost.protheus_code guardam um código de equipamento fora
// da própria standard_equipment_items — ver msm_replace_protheus_code_equipment.sql.
//
// Mesmo motivo de recordReplaceAudit (route.ts de accessories): a troca
// roda dentro da função SQL, fora do caminho normal que grava em
// audit_log — sem tratamento à parte aqui, nunca apareceria na Auditoria
// de Queries.

const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`

async function recordReplaceAuditEquipment(oldCode: string, newCode: string, counts: Record<string, number>): Promise<void> {
  const keyValue = `${oldCode} → ${newCode}`
  const rows: Record<string, unknown>[] = []

  // standard_equipment_items — sempre afetada (a função já garante que oldCode existe).
  rows.push({
    table_name: 'standard_equipment_items',
    operation: 'update',
    record_key_field: 'protheus_code',
    record_key_value: keyValue,
    sql_query: `UPDATE standard_equipment_items SET protheus_code = ${sqlStr(newCode)} WHERE protheus_code = ${sqlStr(oldCode)};`,
    payload: { protheus_code: newCode },
    baseline: { protheus_code: oldCode },
    status: 'pending',
  })

  if ((counts.dependant_items ?? 0) > 0) {
    rows.push({
      table_name: 'dependant_items',
      operation: 'update',
      record_key_field: 'protheus_code',
      record_key_value: keyValue,
      sql_query: `UPDATE dependant_items SET protheus_code = ${sqlStr(newCode)} WHERE protheus_code = ${sqlStr(oldCode)};`,
      payload: { protheus_code: newCode },
      baseline: { protheus_code: oldCode },
      status: 'pending',
    })
  }

  if ((counts.pending_target_cost ?? 0) > 0) {
    rows.push({
      table_name: 'pending_target_cost',
      operation: 'update',
      record_key_field: 'protheus_code',
      record_key_value: keyValue,
      sql_query: `UPDATE pending_target_cost SET protheus_code = ${sqlStr(newCode)} WHERE protheus_code = ${sqlStr(oldCode)};`,
      payload: { protheus_code: newCode },
      baseline: { protheus_code: oldCode },
      status: 'pending',
    })
  }

  await supabaseAdmin.from('audit_log').insert(rows)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const oldCode = String(body?.oldCode ?? '').trim()
  const newCode = String(body?.newCode ?? '').trim()
  if (!oldCode || !newCode) {
    return NextResponse.json({ error: 'Informe o código antigo e o código novo' }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('replace_protheus_code_equipment', {
      p_old_code: oldCode,
      p_new_code: newCode,
    })

    if (error) {
      return NextResponse.json({
        error: error.message,
        details: error.details || undefined,
        hint: error.hint || undefined,
      }, { status: 400 })
    }

    renameCostRow('standard_equipment_items', oldCode, newCode)

    const counts = (data ?? {}) as Record<string, number>
    try {
      await recordReplaceAuditEquipment(oldCode, newCode, counts)
    } catch { /* audit log is best-effort — never block the real operation, que já teve sucesso */ }

    return NextResponse.json({ counts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao substituir o código'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
