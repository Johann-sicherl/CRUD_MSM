import { FORCE_TO_ONE_FIELDS, getRealColumnFields, type TableSchema } from './schema'
import { isBlankCell, toCellValue } from './globalUpdateConvert'
import { getRowKey } from './csvBaseline'
import { readCostStore, updateCostRow } from './localCostStore'

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

/** PUT — edição: só trata como "valor real novo" o campo cujo valor
 *  enviado difere do que já estava guardado como real no arquivo local —
 *  NUNCA compara contra o que está no Supabase (beforeRow), que pra estes
 *  campos é sempre 1 e portanto quase sempre "diferente" do valor real,
 *  mesmo quando ninguém tocou nesse campo (ex.: RecordModal resubmete o
 *  valor real pré-preenchido mesmo que o usuário só tenha mudado o nome).
 *  Comparar contra o valor real anterior evita capturar/sinalizar uma
 *  "mudança" que não existiu. Muta `writeBody` in-place forçando 1 em
 *  todos os campos financeiros presentes na edição.
 *  Devolve os nomes dos campos cujo valor real de fato mudou — o Supabase
 *  nunca reflete essa mudança (fica sempre 1), então quem chama usa essa
 *  lista pra registrar a edição na Auditoria de Queries mesmo assim (ver
 *  recordUpdateAudit/forceIncludeFields), senão uma edição de campo
 *  financeiro não gera pendência nenhuma lá. */
export function protectLocalCostsOnUpdate(
  table: string,
  schema: TableSchema,
  writeBody: Record<string, unknown>,
  rawBody: Record<string, unknown>,
  beforeRow: Record<string, unknown> | null,
): string[] {
  const forceFields = getRealColumnFields(schema).filter(f => FORCE_TO_ONE_FIELDS.includes(f.name) && f.name in writeBody)
  if (forceFields.length === 0) return []
  try {
    const fullRow = { ...(beforeRow ?? {}), ...writeBody }
    const key = getRowKey(schema, fullRow)
    const existingRealValues = readCostStore()[table]?.[key]?.values ?? {}
    const values: Record<string, number | null> = {}
    let hasAny = false
    for (const field of forceFields) {
      const raw = rawBody[field.name]
      const newVal = isBlankCell(raw) ? null : toCellValue(field, raw)
      const prevRealVal = existingRealValues[field.name] // undefined = nunca capturado antes
      if (typeof newVal === 'number' && prevRealVal !== newVal) {
        values[field.name] = newVal
        hasAny = true
      }
      writeBody[field.name] = 1
    }
    if (hasAny) updateCostRow(table, key, values)
    return Object.keys(values)
  } catch (e) {
    console.error(`[local-costs] falha ao proteger custos reais de "${table}" (update)`, e)
    return []
  }
}
