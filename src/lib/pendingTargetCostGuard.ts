import type { SupabaseClient } from '@supabase/supabase-js'
import { TARGET_COST_PENDING_FIELD, type TableSchema } from './schema'
import { getAuditKeyFields } from './sqlAudit'

// Sincroniza a tabela pending_target_cost com o campo virtual
// TARGET_COST_PENDING_FIELD (ver schema.ts) — o Admin marca/desmarca esse
// checkbox em Cadastro de Componentes/Cadastro de Equipamentos/Grupo de
// Equipamentos, e este arquivo é o único lugar que traduz isso numa linha
// gravada/apagada lá. Nunca grava nada na tabela real — isRealColumnField
// já exclui o campo virtual do insertBody/updateBody antes disso.
//
// A chave gravada em pending_target_cost.protheus_code é sempre
// getAuditKeyFields(schema)[0] da tabela de origem — NUNCA hardcoded
// "protheus_code" do corpo da requisição: Grupo de Equipamentos
// (equipments) não tem coluna protheus_code nenhuma, usa legacy_id (ver
// specs/custeio-financeiro.md). O nome da coluna em pending_target_cost
// continua "protheus_code" só por já existir assim — o valor gravado ali
// pode vir de qualquer chave de negócio da tabela de origem.
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
  // Linha com a chave de negócio resolvida — o corpo do INSERT/UPDATE já
  // finalizado (com autoIncrement/legacy_id já calculado) ou, num UPDATE
  // parcial que não reenvia a chave (ex.: legacy_id é isReadonly, nunca
  // vem no body), a linha como estava antes da escrita (beforeRow).
  existingRow?: Record<string, unknown> | null,
): Promise<void> {
  if (!schema.fields.some(f => f.name === TARGET_COST_PENDING_FIELD)) return
  if (!(TARGET_COST_PENDING_FIELD in rawBody)) return
  const keyField = getAuditKeyFields(schema)[0]
  const rawKey = rawBody[keyField.name] ?? existingRow?.[keyField.name]
  const code = String(rawKey ?? '').trim().toUpperCase()
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
  const keyField = getAuditKeyFields(schema)[0]
  const code = String(deletedRow[keyField.name] ?? '').trim().toUpperCase()
  if (!code) return
  try {
    await admin.from('pending_target_cost').delete().eq('protheus_code', code)
  } catch (e) {
    console.error(`[pending-target-cost] falha ao limpar "${code}" (delete)`, e)
  }
}
