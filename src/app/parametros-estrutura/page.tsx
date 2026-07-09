'use client'

import { useEffect, useRef, useState } from 'react'

interface Rule {
  property_field: string
  component_code: string
  expected_value: string
}

const keyOf = (r: Rule) => `${r.property_field.trim().toLowerCase()}::${r.component_code.trim().toLowerCase()}`

// Reads the same three-column layout the user's original spreadsheet uses
// (GRUPO_ACESSORIOS / CODIGO_ACESSORIO_PROTHEUS / OUTPUT), matching headers
// case/spacing-insensitively so an export from this page round-trips too.
async function parseImportFile(file: File): Promise<Rule[]> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_')

  const rows: Rule[] = []
  for (const r of raw) {
    let field = ''
    let code = ''
    let value = ''
    for (const [k, v] of Object.entries(r)) {
      const nk = norm(k)
      if (nk === 'GRUPO_ACESSORIOS' || nk === 'PROPERTY_FIELD') field = String(v ?? '').trim()
      else if (nk === 'CODIGO_ACESSORIO_PROTHEUS' || nk === 'COMPONENT_CODE') code = String(v ?? '').trim()
      else if (nk === 'OUTPUT' || nk === 'EXPECTED_VALUE') value = String(v ?? '').trim()
    }
    if (field || code || value) rows.push({ property_field: field, component_code: code, expected_value: value })
  }
  return rows
}

export default function ParametrosEstruturaPage() {
  const [rows, setRows] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [filter, setFilter] = useState('')
  const [pendingImport, setPendingImport] = useState<Rule[] | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await fetch('/api/structure-property-rules')
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao carregar parâmetros'); return }
      const sorted = (json as Rule[]).slice().sort((a, b) =>
        a.property_field.localeCompare(b.property_field) || a.component_code.localeCompare(b.component_code)
      )
      setRows(sorted)
    } catch {
      setError('Falha de rede ao carregar parâmetros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const updateCell = (index: number, field: keyof Rule, value: string) => {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  const addRow = () => {
    setFilter('')
    setRows(prev => [...prev, { property_field: '', component_code: '', expected_value: '' }])
  }

  const removeRow = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  const saveRows = async (list: Rule[], message: string) => {
    setSaving(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await fetch('/api/structure-property-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao salvar parâmetros'); return }
      setSuccessMsg(message)
      setRows(list.slice().sort((a, b) => a.property_field.localeCompare(b.property_field) || a.component_code.localeCompare(b.component_code)))
    } catch {
      setError('Falha de rede ao salvar parâmetros')
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    const clean = rows
      .map(r => ({
        property_field: r.property_field.trim(),
        component_code: r.component_code.trim(),
        expected_value: r.expected_value.trim(),
      }))
      .filter(r => r.property_field || r.component_code || r.expected_value)

    for (let i = 0; i < clean.length; i++) {
      const r = clean[i]
      if (!r.property_field || !r.component_code || !r.expected_value) {
        setError(`Linha ${i + 1}: preencha Grupo Acessórios, Código e Output`)
        return
      }
    }
    await saveRows(clean, `${clean.length} parâmetro(s) salvos com sucesso`)
  }

  const handleExport = async () => {
    const XLSX = await import('xlsx')
    const data = rows.map(r => ({
      GRUPO_ACESSORIOS: r.property_field,
      CODIGO_ACESSORIO_PROTHEUS: r.component_code,
      OUTPUT: r.expected_value,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Parametros')
    XLSX.writeFile(wb, 'parametros-estrutura.xlsx')
  }

  const handleImportFile = async (fileList: FileList | null) => {
    const file = fileList?.[0]
    if (!file) return
    setError('')
    setSuccessMsg('')
    try {
      const parsed = await parseImportFile(file)
      if (parsed.length === 0) {
        setError('Nenhuma linha válida encontrada no arquivo — esperado colunas GRUPO_ACESSORIOS, CODIGO_ACESSORIO_PROTHEUS e OUTPUT')
        return
      }
      const invalidIdx = parsed.findIndex(r => !r.property_field || !r.component_code || !r.expected_value)
      if (invalidIdx >= 0) {
        setError(`Linha ${invalidIdx + 1} do arquivo importado está incompleta (Grupo Acessórios, Código ou Output vazio)`)
        return
      }
      setPendingImport(parsed)
      setImportFileName(file.name)
    } catch {
      setError('Não foi possível ler o arquivo (.xlsx inválido)')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const applyImportReplace = async () => {
    if (!pendingImport) return
    const ok = window.confirm(
      `Isso vai substituir TODOS os ${rows.length} parâmetros atuais pelos ${pendingImport.length} do arquivo "${importFileName}". Confirma?`
    )
    if (!ok) return
    await saveRows(pendingImport, `${pendingImport.length} parâmetro(s) importados (substituiu todos os anteriores)`)
    setPendingImport(null)
  }

  const applyImportAddNew = async () => {
    if (!pendingImport) return
    const existingKeys = new Set(rows.map(keyOf))
    const seen = new Set<string>()
    const newOnes: Rule[] = []
    let duplicateCount = 0
    for (const r of pendingImport) {
      const k = keyOf(r)
      if (existingKeys.has(k) || seen.has(k)) { duplicateCount++; continue }
      seen.add(k)
      newOnes.push(r)
    }
    if (newOnes.length === 0) {
      setSuccessMsg(`Nenhum parâmetro novo — as ${pendingImport.length} linha(s) do arquivo já existiam.`)
      setPendingImport(null)
      return
    }
    await saveRows(
      [...rows, ...newOnes],
      `${newOnes.length} parâmetro(s) novo(s) adicionados` + (duplicateCount > 0 ? ` — ${duplicateCount} já existiam e foram ignorados` : '')
    )
    setPendingImport(null)
  }

  const filteredIndices = rows.map((_, i) => i).filter(i => {
    const f = filter.trim().toLowerCase()
    if (!f) return true
    const r = rows[i]
    return r.property_field.toLowerCase().includes(f)
      || r.component_code.toLowerCase().includes(f)
      || r.expected_value.toLowerCase().includes(f)
  })

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">SISTEMA</div>
        <h1 className="text-3xl font-bold text-on-surface">Parâmetros de Estrutura</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Regras usadas pelo Analisador de Estruturas, na mesma disposição da planilha original —
          edite qualquer célula diretamente e clique em Salvar, ou importe/exporte um Excel com as
          colunas GRUPO_ACESSORIOS, CODIGO_ACESSORIO_PROTHEUS e OUTPUT. Guardado em{' '}
          <code className="bg-surface-container px-1 rounded">src/data/structure-property-rules.json</code>.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-16 text-outline">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-base font-mono">Carregando...</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filtrar por grupo, código ou output..."
              className="flex-1 min-w-[200px] bg-surface-container border border-outline-variant rounded px-3 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
            <span className="text-sm text-outline font-mono whitespace-nowrap">{filteredIndices.length} de {rows.length}</span>
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap"
            >
              ⇩ Exportar Excel
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={e => handleImportFile(e.target.files)}
              className="hidden"
              id="parametros-estrutura-import-input"
            />
            <label
              htmlFor="parametros-estrutura-import-input"
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap cursor-pointer"
            >
              ⇧ Importar Excel
            </label>
          </div>

          {pendingImport && (
            <div className="mb-4 flex flex-col gap-3 bg-primary/10 border border-primary/30 rounded-lg px-4 py-3">
              <div className="text-base text-on-surface">
                <strong>{importFileName}</strong>: {pendingImport.length} linha(s) encontrada(s). Como deseja importar?
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={applyImportAddNew}
                  disabled={saving}
                  className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow disabled:opacity-50"
                >
                  Adicionar apenas novos
                </button>
                <button
                  onClick={applyImportReplace}
                  disabled={saving}
                  className="px-4 py-2 bg-error text-on-error rounded text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  Substituir tudo
                </button>
                <button
                  onClick={() => setPendingImport(null)}
                  disabled={saving}
                  className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
              <div className="text-xs text-outline">
                &quot;Adicionar apenas novos&quot; ignora linhas cujo Grupo Acessórios + Código já existam na lista atual.
                &quot;Substituir tudo&quot; apaga a lista atual e usa só o que está no arquivo.
              </div>
            </div>
          )}

          <div className="overflow-auto border border-outline-variant rounded-lg max-h-[65vh]">
            <table className="text-base w-full">
              <thead className="sticky top-0 bg-surface-container-highest">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Grupo Acessórios</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Código Acessório Protheus</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Output</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filteredIndices.map(i => (
                  <tr key={i} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
                    <td className="p-1">
                      <input
                        value={rows[i].property_field}
                        onChange={e => updateCell(i, 'property_field', e.target.value)}
                        className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-base"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        value={rows[i].component_code}
                        onChange={e => updateCell(i, 'component_code', e.target.value)}
                        className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-base"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        value={rows[i].expected_value}
                        onChange={e => updateCell(i, 'expected_value', e.target.value)}
                        className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-base"
                      />
                    </td>
                    <td className="p-1 text-center">
                      <button
                        onClick={() => removeRow(i)}
                        className="text-outline hover:text-error transition-colors text-lg"
                        title="Remover linha"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 bg-error-container/20 border border-error/20 rounded-lg px-4 py-3 text-error text-base">
              ⚠ {error}
            </div>
          )}
          {successMsg && (
            <div className="mt-3 flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-base">
              ✓ {successMsg}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={addRow}
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
            >
              + Adicionar linha
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-primary text-on-primary rounded text-base font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              onClick={load}
              disabled={saving}
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              Descartar alterações e recarregar
            </button>
          </div>
        </>
      )}
    </div>
  )
}
