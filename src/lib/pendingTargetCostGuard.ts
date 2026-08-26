import type { SupabaseClient } from '@supabase/supabase-js'
import { TARGET_COST_PENDING_FIELD, type TableSchema } from './schema'

// Sincroniza a tabela pending_target_cost com o campo virtual
// TARGET_COST_PENDING_FIELD (ver schema.ts) — o Admin marca/desmarca esse
// checkbox em Cadastro de Componentes/Cadastro de Equipamentos, e este
// arquivo é o único lugar que traduz isso numa linha gravada/apagada lá.
// Nunca grava nada em accessories/standard_equipment_items — isRealColumnField
// já exclui o campo virtual do insertBody/updateBody antes disso.
//
// Regra: marcar um código que ainda não está na tabela -> INSERT status
// 'novo'. Desmarcar um código que está lá (em qualquer status) -> DELETE
// (revert completo, como definido com o usuário). Marcar um código que já
// está lá (ex.: reabrir e salvar sem mexer no checkbox) NÃO reseta o status
// de volta pra 'novo' — preserva 'em_alteracao' se a Gerente já tiver
// sinalizado que imputou o custo.

export async function syncPendingTargetCostOnWrite(
  admin: SupabaseClient,
  schema: TableSchema,
  rawBody: Record<string, unknown>,
  protheusCode: string,
): Promise<void> {
  if (!schema.fields.some(f => f.name === TARGET_COST_PENDING_FIELD)) return
  if (!(TARGET_COST_PENDING_FIELD in rawBody)) return
  const code = protheusCode.trim().toUpperCase()
  if (!code) return

  const wantFlagged = rawBody[TARGET_COST_PENDING_FIELD] === true || rawBody[TARGET_COST_PENDING_FIELD] === 'true'

  try {
    const { data: existing } = await admin
      .from('pending_target_cost')
      .select('protheus_code')
      .eq('protheus_code', code)
      .maybeSingle()

    if (wantFlagged && !existing) {
      await admin.from('pending_target_cost').insert({ protheus_code: code, status: 'novo' })
    } else if (!wantFlagged && existing) {
      await admin.from('pending_target_cost').delete().eq('protheus_code', code)
    }
    // wantFlagged && existing (qualquer status) -> nada a fazer, preserva.
  } catch (e) {
    console.error(`[pending-target-cost] falha ao sincronizar "${code}"`, e)
  }
}

// Exclusão do registro em accessories/standard_equipment_items — mesma
// razão de protectLocalCostsOnDelete (localCostGuard.ts): sem isto, uma
// linha pendente em pending_target_cost ficava órfã pra sempre, sem
// nenhum item vivo que a referencie.
export async function clearPendingTargetCostOnDelete(
  admin: SupabaseClient,
  schema: TableSchema,
  deletedRow: Record<string, unknown>,
): Promise<void> {
  if (!schema.fields.some(f => f.name === TARGET_COST_PENDING_FIELD)) return
  const code = String(deletedRow.protheus_code ?? '').trim().toUpperCase()
  if (!code) return
  try {
    await admin.from('pending_target_cost').delete().eq('protheus_code', code)
  } catch (e) {
    console.error(`[pending-target-cost] falha ao limpar "${code}" (delete)`, e)
  }
}
