import { FORCE_TO_ONE_FIELDS, getRealColumnFields, type TableSchema } from './schema'
import { isBlankCell, toCellValue } from './globalUpdateConvert'
import { getRowKey } from './csvBaseline'
import { updateCostRow } from './localCostStore'

// Fecha, para os caminhos de escrita registro-a-registro (POST /api/[table]
// e PUT /api/[table]/[id] — usados por "+ Novo Registro", "Importar Excel",
// os modais de Não Combináveis/Dependentes e o formulário de edição), a
// mesma garantia que o Atualizador Global já tem via convertCsvRows: nenhum
// valor financeiro real (FORCE_TO_ONE_FIELDS) chega ao Supabase — vai
// sempre 1, e o valor real (se houver) é gravado só no arquivo local
// (ver localCostStore.ts). Melhor esforço: nunca deve derrubar a operação
// real por causa de um problema aqui (ex.: disco cheio).

/** POST — linha nova: qualquer valor numérico enviado pelo cliente num campo
 *  financeiro é "real" por definição (a linha não existia antes). Muta
 *  `writeBody` in-place forçando 1 nesses campos; `writeBody` já deve ter
 *  todos os campos-chave resolvidos (inclusive autoIncrement, se houver)
 *  antes de chamar esta função, pra chave de linha ficar correta. */
export function protectLocalCostsOnInsert(
  table: string,
  schema: TableSchema,
  writeBody: Record<string, unknown>,
  rawBody: Record<string, unknown>,
): void {
  const forceFields = getRealColumnFields(schema).filter(f => FORCE_TO_ONE_FIELDS.includes(f.name))
  if (forceFields.length === 0) return
  try {
    const key = getRowKey(schema, writeBody)
    const values: Record<string, number | null> = {}
    let hasAny = false
    for (const field of forceFields) {
      const raw = rawBody[field.name]
      if (!isBlankCell(raw)) {
        const v = toCellValue(field, raw)
        if (typeof v === 'number') { values[field.name] = v; hasAny = true }
      }
      writeBody[field.name] = 1
    }
    if (hasAny) updateCostRow(table, key, values)
  } catch (e) {
    console.error(`[local-costs] falha ao proteger custos reais de "${table}" (insert)`, e)
  }
}

/** PUT — edição: só trata como "valor real novo" o campo que o cliente
 *  realmente mudou em relação ao que já estava no Supabase (beforeRow) —
 *  sem essa checagem, reabrir o formulário de edição sem tocar no custo
 *  reenviaria o "1" que já está lá e sobrescreveria com 1 o valor real
 *  guardado localmente. Muta `writeBody` in-place forçando 1 em todos os
 *  campos financeiros presentes na edição. */
export function protectLocalCostsOnUpdate(
  table: string,
  schema: TableSchema,
  writeBody: Record<string, unknown>,
  rawBody: Record<string, unknown>,
  beforeRow: Record<string, unknown> | null,
): void {
  const forceFields = getRealColumnFields(schema).filter(f => FORCE_TO_ONE_FIELDS.includes(f.name) && f.name in writeBody)
  if (forceFields.length === 0) return
  try {
    const fullRow = { ...(beforeRow ?? {}), ...writeBody }
    const key = getRowKey(schema, fullRow)
    const values: Record<string, number | null> = {}
    let hasAny = false
    for (const field of forceFields) {
      const raw = rawBody[field.name]
      const newVal = isBlankCell(raw) ? null : toCellValue(field, raw)
      const prevVal = beforeRow ? beforeRow[field.name] : undefined
      if (typeof newVal === 'number' && Number(prevVal) !== newVal) {
        values[field.name] = newVal
        hasAny = true
      }
      writeBody[field.name] = 1
    }
    if (hasAny) updateCostRow(table, key, values)
  } catch (e) {
    console.error(`[local-costs] falha ao proteger custos reais de "${table}" (update)`, e)
  }
}
