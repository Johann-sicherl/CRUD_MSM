import type { Field } from './schema'

function editableFields(fields: Field[]): Field[] {
  return fields.filter(f => !f.isPk && !f.isReadonly && !f.hideInForm && !f.hideInImport)
}

/** Normalises a cell value to a SQL-safe decimal string.
 *  Handles both pt-BR (1.234,56) and US/plain (1234.56 / 1,56) formats. */
function normaliseDecimal(raw: string): string {
  const s = raw.trim()
  // pt-BR: dots as thousands separator, comma as decimal → "1.234,56"
  if (/^\d{1,3}(\.\d{3})+(,\d*)?$/.test(s)) {
    return s.replace(/\./g, '').replace(',', '.')
  }
  // Simple comma as decimal: "1,56" → "1.56"
  return s.replace(',', '.')
}

/** Export the currently-visible grid rows to an XLSX file and save to Downloads. */
export async function exportVisibleData(
  headers: string[],
  rows: string[][],
  filename: string,
) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([buf], { type: xlsxMime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Generate an Excel template with just the column headers and save directly to Downloads. */
export async function exportMatrix(fields: Field[], filename = 'matriz_equipamentos.xlsx') {
  const XLSX = await import('xlsx')
  const cols = editableFields(fields)
  const headers = cols.map(f => f.label)

  const ws = XLSX.utils.aoa_to_sheet([headers])
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')

  const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([buf], { type: xlsxMime })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Read ALL data rows of an Excel file and map them back to field names.
 *  Accepts both Portuguese label headers (from exportMatrix) and raw DB column
 *  name headers (from direct DB exports via Supabase / pgAdmin / DBeaver).
 *  Comma/pt-BR decimal values are normalised to dots automatically. */
export function parseImportFile(
  file: File,
  fields: Field[],
): Promise<Record<string, string>[]> {
  const cols = editableFields(fields)

  // Build a single lookup that matches both PT labels and raw DB column names.
  const colMap: Record<string, Field> = {}
  for (const f of cols) {
    colMap[f.label] = f   // e.g. "Custo (R$)"
    colMap[f.name]  = f   // e.g. "cost_std"
  }

  const numericTypes = new Set(['decimal', 'integer', 'number'])

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

        if (rawRows.length === 0) {
          reject(new Error('O arquivo está vazio ou não contém dados'))
          return
        }

        const results: Record<string, string>[] = []

        for (const rawRow of rawRows) {
          const row: Record<string, string> = {}
          for (const [colLabel, raw] of Object.entries(rawRow)) {
            const field = colMap[colLabel]
            if (!field) continue
            let val = String(raw ?? '').trim()
            if (numericTypes.has(field.type)) val = normaliseDecimal(val)
            row[field.name] = val
          }

          // Apply schema defaults for fields that are missing or empty
          for (const col of cols) {
            if ((!row[col.name] || row[col.name] === '') && col.defaultValue !== undefined) {
              row[col.name] = String(col.defaultValue)
            }
          }

          if (Object.keys(row).length > 0) results.push(row)
        }

        if (results.length === 0) {
          reject(new Error('Nenhuma coluna reconhecida. Verifique se os cabeçalhos correspondem à Matriz exportada.'))
          return
        }

        resolve(results)
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Erro ao processar o arquivo'))
      }
    }
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'))
    reader.readAsBinaryString(file)
  })
}
