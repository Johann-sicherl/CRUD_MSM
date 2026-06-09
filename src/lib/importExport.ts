import type { Field } from './schema'

function editableFields(fields: Field[]): Field[] {
  return fields.filter(f => !f.isPk && !f.isReadonly && !f.hideInForm)
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

/** Generate an Excel template with just the column headers and trigger save.
 *  Uses the native File System Access API (Chrome/Edge) for a real Save-As dialog;
 *  falls back to a standard browser download on other browsers. */
export async function exportMatrix(fields: Field[], filename = 'matriz_equipamentos.xlsx') {
  const XLSX = await import('xlsx')
  const cols = editableFields(fields)
  const headers = cols.map(f => f.label)

  const ws = XLSX.utils.aoa_to_sheet([headers])
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')

  // Try native Save-As dialog (Chrome / Edge on HTTPS or localhost)
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (window as Window & { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> })
        .showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'Planilha Excel',
            accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
          }],
        })
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      const writable = await handle.createWritable()
      await writable.write(new Uint8Array(buf))
      await writable.close()
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return // user cancelled
      // fall through to standard download
    }
  }

  XLSX.writeFile(wb, filename)
}

/** Read the first row of an Excel file and map it back to field names.
 *  Comma/pt-BR decimal values are normalised to dots automatically. */
export function parseImportFile(
  file: File,
  fields: Field[],
): Promise<Record<string, string>> {
  const cols = editableFields(fields)
  const labelMap = Object.fromEntries(cols.map(f => [f.label, f]))
  const numericTypes = new Set(['decimal', 'integer', 'number'])

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

        if (rows.length === 0) {
          reject(new Error('O arquivo está vazio ou não contém dados'))
          return
        }

        const firstRow = rows[0]
        const result: Record<string, string> = {}

        for (const [colLabel, raw] of Object.entries(firstRow)) {
          const field = labelMap[colLabel]
          if (!field) continue
          let val = String(raw ?? '').trim()
          if (numericTypes.has(field.type)) {
            val = normaliseDecimal(val)
          }
          result[field.name] = val
        }

        if (Object.keys(result).length === 0) {
          reject(new Error('Nenhuma coluna reconhecida. Verifique se os cabeçalhos correspondem à Matriz exportada.'))
          return
        }

        resolve(result)
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Erro ao processar o arquivo'))
      }
    }
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'))
    reader.readAsBinaryString(file)
  })
}
