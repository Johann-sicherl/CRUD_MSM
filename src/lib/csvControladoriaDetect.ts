import { tables, isControllershipTable, getControllershipPendingFields, type Field, type TableSchema } from './schema'
import { getAuditKeyFields } from './sqlAudit'

export interface ControladoriaDetection {
  tableName: string
  schema: TableSchema
  keyField: Field
  presentFields: Field[]
  missingFields: Field[]
  headerByLowerName: Map<string, string>
}

// Detecção enxuta pro import restrito de Controladoria/Fiscal/Precificação
// (Atualizador Global, perfil Gerente Adm Comercial) — só considera as
// tabelas elegíveis (isControllershipTable) e só liga pra chave de negócio
// da tabela (protheus_code/ID legado) + as colunas financeiras dela.
// Diferente de detectTable (csvTableDetect.ts), que avalia TODAS as colunas
// de TODAS as tabelas pra decidir a substituição completa (admin) — aqui
// colunas como nome/descrição/grupo nem entram na conta, porque essa
// importação nunca as toca.
export function detectControladoriaTable(headers: string[]): ControladoriaDetection | null {
  const headerLowerSet = new Set(headers.map(h => h.trim().toLowerCase()))
  let best: { tableName: string; schema: TableSchema; keyField: Field; overlap: number } | null = null

  for (const [tableName, schema] of Object.entries(tables)) {
    if (!isControllershipTable(schema)) continue
    const keyField = getAuditKeyFields(schema)[0]
    if (!headerLowerSet.has(keyField.name.toLowerCase())) continue
    const allowed = getControllershipPendingFields(schema)
    const overlap = allowed.filter(f => headerLowerSet.has(f.name.toLowerCase())).length
    if (overlap === 0) continue
    if (!best || overlap > best.overlap) best = { tableName, schema, keyField, overlap }
  }
  if (!best) return null

  const headerByLowerName = new Map(headers.map(h => [h.trim().toLowerCase(), h]))
  const allowed = getControllershipPendingFields(best.schema)
  return {
    tableName: best.tableName,
    schema: best.schema,
    keyField: best.keyField,
    presentFields: allowed.filter(f => headerByLowerName.has(f.name.toLowerCase())),
    missingFields: allowed.filter(f => !headerByLowerName.has(f.name.toLowerCase())),
    headerByLowerName,
  }
}
