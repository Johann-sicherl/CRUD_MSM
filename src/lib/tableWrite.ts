import type { SupabaseClient } from '@supabase/supabase-js'
import { isRealColumnField, FORCE_TO_ONE_FIELDS, type TableSchema } from './schema'
import { recordUpdateAudit } from './sqlAudit'
import { protectLocalCostsOnUpdate } from './localCostGuard'
import { syncPendingTargetCostOnWrite } from './pendingTargetCostGuard'

// Núcleo do PUT /api/[table]/[id] (edição de um registro), extraído pra cá
// pra poder ser reaproveitado por qualquer rota que precise atualizar linhas
// uma a uma com a MESMA garantia de sempre — auditoria, proteção de custo
// real local, sincronização da fila de custo alvo — sem duplicar essa lógica
// (ver api/global-update-controladoria/[table]/route.ts, que chama isto num
// laço). Comportamento idêntico ao que a rota já tinha: só campos presentes
// em `body` entram no UPDATE (campo ausente do corpo nunca é tocado — é
// assim que uma edição parcial, com só algumas colunas, já funciona hoje).
export async function updateTableRow(
  admin: SupabaseClient,
  table: string,
  schema: TableSchema,
  id: string,
  body: Record<string, unknown>,
): Promise<{ data?: Record<string, unknown>; error?: string; realCostFieldsChanged?: string[] }> {
  const updateBody: Record<string, unknown> = {}

  for (const field of schema.fields.filter(f => !f.isPk && !f.isReadonly && isRealColumnField(f))) {
    if (field.name === 'password' && !body[field.name]) continue
    if (body[field.name] !== undefined) {
      updateBody[field.name] = parseValue(field.type, body[field.name])
    }
  }

  if (schema.hasTimestamps) updateBody.updated_at = new Date().toISOString()

  const hasForceFields = schema.fields.some(f => FORCE_TO_ONE_FIELDS.includes(f.name))
  let beforeRow: Record<string, unknown> | null = null
  if (schema.auditQueries || hasForceFields) {
    const { data: before } = await admin.from(table).select('*').eq('id', id).maybeSingle()
    beforeRow = before as Record<string, unknown> | null
  }

  // Colunas financeiras (FORCE_TO_ONE_FIELDS): o Supabase nunca recebe o
  // valor real digitado aqui — vai sempre 1. Só captura como "real" o que
  // realmente mudou em relação ao que já estava salvo (beforeRow), pra
  // reabrir/salvar o formulário sem tocar no custo não sobrescrever com 1 o
  // valor real já guardado localmente.
  const realCostFieldsChanged = protectLocalCostsOnUpdate(table, schema, updateBody, body, beforeRow)

  const { data, error } = await admin.from(table).update(updateBody).eq('id', id).select().single()
  if (error) return { error: error.message }

  if (schema.auditQueries) {
    try {
      await recordUpdateAudit(admin, table, schema, beforeRow, updateBody, realCostFieldsChanged)
    } catch { /* audit log is best-effort — never block the real operation */ }
  }

  try {
    await syncPendingTargetCostOnWrite(admin, schema, body, beforeRow)
  } catch { /* best-effort — never block the real operation */ }

  return { data: data as Record<string, unknown>, realCostFieldsChanged }
}

function parseValue(type: string, value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null
  if (type === 'jsonb') {
    if (typeof value === 'string') { try { return JSON.parse(value) } catch { return value } }
    return value
  }
  if (type === 'boolean') return value === true || value === 'true'
  if (type === 'number')  { const n = parseInt(String(value));   return Number.isNaN(n) ? null : n }
  if (type === 'decimal') { const n = parseFloat(String(value)); return Number.isNaN(n) ? null : n }
  return value
}
