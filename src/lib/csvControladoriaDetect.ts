import { tables, isControllershipTable, getControllershipPendingFields, type Field, type TableSchema } from './schema'
import { getAuditKeyFields } from './sqlAudit'
import { parseCsvText } from './csvTableDetect'

// Lê CSV (parser próprio, texto exato — ver parseCsvText) ou .xlsx/.xls (via
// SheetJS). O Atualizador Global do admin evita SheetJS de propósito (ela
// reformata célula com cara de data, o que corromperia created_at/
// updated_at) — mas aqui só entram colunas de Controladoria/Fiscal/
// Precificação (sempre decimal) + a chave de negócio (texto/número), nunca
// timestamp, então esse risco não existe pra este fluxo.
export async function parseControladoriaFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name)
  if (!isExcel) {
    const text = await file.text()
    const matrix = parseCsvText(text).filter(r => !(r.length === 1 && r[0].trim() === ''))
    if (matrix.length === 0) return { headers: [], rows: [] }
    const headers = matrix[0].map(h => h.trim())
    const rows = matrix.slice(1)
      .filter(r => r.some(c => c.trim() !== ''))
      .map(r => {
        const obj: Record<string, string> = {}
        headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i] : '' })
        return obj
      })
    return { headers, rows }
  }

  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  if (rawRows.length === 0) return { headers: [], rows: [] }
  const headers = Object.keys(rawRows[0])
  const rows = rawRows.map(r => {
    const obj: Record<string, string> = {}
    for (const h of headers) obj[h] = String(r[h] ?? '').trim()
    return obj
  })
  return { headers, rows }
}

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
