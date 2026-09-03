import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { renameCostRow } from '@/lib/localCostStore'

// Aplica a substituição de revisão de componente (Consulta PDM x Banco MSM):
// troca o código antigo pelo novo em accessories e em toda tabela que
// referencia um Código Protheus de componente, numa única transação (ver
// msm_replace_protheus_code.sql — PRÉ-REQUISITO: rodar esse arquivo uma vez
// no Supabase SQL Editor antes de usar esta rota). Mexe só no código — os
// demais campos do item (Nome, Grupo, Cor etc.) ficam como já estavam
// cadastrados, mesmo que divirjam do PDM (decisão explícita: substituir
// revisão não é reimportar o item inteiro). Migra também o custo real local
// (fora do Postgres) só depois do banco confirmar sucesso.
//
// A troca em si roda dentro da função SQL (replace_protheus_code), fora do
// caminho normal /api/[table]/[id] que grava em audit_log a cada
// insert/update/delete (ver sqlAudit.ts) — então, sem tratamento à parte
// aqui, esta operação nunca aparecia na Auditoria de Queries, mesmo tendo
// alterado o banco de verdade. recordReplaceAudit reconstrói manualmente o
// SQL equivalente (não dá pra reusar recordUpdateAudit/buildUpdateSQL — eles
// nunca colocam o campo-chave no SET, e aqui é exatamente o protheus_code,
// a chave, que muda) e grava uma linha pendente por tabela realmente afetada
// (counts vindo da própria função SQL), pro TI aplicar no banco oficial.

const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`

async function recordReplaceAudit(oldCode: string, newCode: string, counts: Record<string, number>): Promise<void> {
  const keyValue = `${oldCode} → ${newCode}`
  // formatRecordKey (auditoria/page.tsx) faz record_key_value.split('|') e casa
  // posicionalmente com record_key_field.split(',') — uma tabela com 2 campos-
  // chave (non_combinable_comps, dependant_items) precisa de 2 valores
  // separados por "|", senão o segundo campo mostra "campo=" vazio na tela.
  const keyValueFor = (fieldCount: number) => Array(fieldCount).fill(keyValue).join('|')
  const rows: Record<string, unknown>[] = []

  // accessories — sempre afetada (a função já garante que oldCode existe).
  rows.push({
    table_name: 'accessories',
    operation: 'update',
    record_key_field: 'protheus_code',
    record_key_value: keyValueFor(1),
    sql_query: `UPDATE accessories SET protheus_code = ${sqlStr(newCode)}, updated_at = NOW() WHERE protheus_code = ${sqlStr(oldCode)};`,
    payload: { protheus_code: newCode },
    baseline: { protheus_code: oldCode },
    status: 'pending',
  })

  if ((counts.relationship_equip_accessory ?? 0) > 0) {
    rows.push({
      table_name: 'relationship_equip_accessory',
      operation: 'update',
      record_key_field: 'protheus_code',
      record_key_value: keyValueFor(1),
      sql_query: `UPDATE relationship_equip_accessory SET protheus_code = ${sqlStr(newCode)} WHERE protheus_code = ${sqlStr(oldCode)};`,
      payload: { protheus_code: newCode },
      baseline: { protheus_code: oldCode },
      status: 'pending',
    })
  }

  if ((counts.non_combinable_comps ?? 0) > 0) {
    rows.push({
      table_name: 'non_combinable_comps',
      operation: 'update',
      record_key_field: 'protheus_code,remove_list_code',
      record_key_value: keyValueFor(2),
      sql_query: [
        `UPDATE non_combinable_comps SET protheus_code = ${sqlStr(newCode)} WHERE protheus_code = ${sqlStr(oldCode)};`,
        `UPDATE non_combinable_comps SET remove_list_code = ${sqlStr(newCode)} WHERE remove_list_code = ${sqlStr(oldCode)};`,
      ].join('\n'),
      payload: { protheus_code: newCode, remove_list_code: newCode },
      baseline: { protheus_code: oldCode, remove_list_code: oldCode },
      status: 'pending',
    })
  }

  if ((counts.dependant_items ?? 0) > 0) {
    rows.push({
      table_name: 'dependant_items',
      operation: 'update',
      record_key_field: 'protheus_code,protheus_item_code',
      record_key_value: keyValueFor(2),
      sql_query: [
        `UPDATE dependant_items SET protheus_code = ${sqlStr(newCode)} WHERE protheus_code = ${sqlStr(oldCode)};`,
        `UPDATE dependant_items SET protheus_item_code = ${sqlStr(newCode)} WHERE protheus_item_code = ${sqlStr(oldCode)};`,
      ].join('\n'),
      payload: { protheus_code: newCode, protheus_item_code: newCode },
      baseline: { protheus_code: oldCode, protheus_item_code: oldCode },
      status: 'pending',
    })
  }

  if ((counts.roller_tables ?? 0) > 0) {
    rows.push({
      table_name: 'roller_tables',
      operation: 'update',
      record_key_field: 'protheus_code',
      record_key_value: keyValueFor(1),
      sql_query: `UPDATE roller_tables SET protheus_code = ${sqlStr(newCode)} WHERE protheus_code = ${sqlStr(oldCode)};`,
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
      record_key_value: keyValueFor(1),
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
    const { data, error } = await supabaseAdmin.rpc('replace_protheus_code', {
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

    renameCostRow('accessories', oldCode, newCode)

    const counts = (data ?? {}) as Record<string, number>
    try {
      await recordReplaceAudit(oldCode, newCode, counts)
    } catch { /* audit log is best-effort — never block the real operation, que já teve sucesso */ }

    return NextResponse.json({ counts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao substituir o código'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
