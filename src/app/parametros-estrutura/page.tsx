'use client'

import { useEffect, useRef, useState } from 'react'
import type { EquipmentClassificationRule } from '@/lib/equipmentClassification'

interface Rule {
  property_field: string
  component_code: string
  expected_value: string
}

// Editable form of an EquipmentClassificationRule — patterns are kept as a
// single comma-separated string while editing (split back into an array on
// save), so the row stays a plain set of text inputs like the rest of this page.
interface ClassificationRow {
  patternsText: string
  combinator: 'OR' | 'AND'
  equip: string
}

const ruleToRow = (r: EquipmentClassificationRule): ClassificationRow => ({
  patternsText: r.patterns.join(', '),
  combinator: r.combinator,
  equip: r.equip,
})

const rowToRule = (row: ClassificationRow): EquipmentClassificationRule => ({
  patterns: row.patternsText.split(',').map(p => p.trim()).filter(Boolean),
  combinator: row.combinator,
  equip: row.equip.trim(),
})

const keyOf = (r: Rule) => `${r.property_field.trim().toLowerCase()}::${r.component_code.trim().toLowerCase()}`

const computeGroupOrder = (list: Rule[]): string[] =>
  Array.from(new Set(list.map(r => r.property_field))).sort((a, b) => a.localeCompare(b, 'pt-BR'))

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

// Group-name edit field — only mounted while a group is in "editing" mode
// (triggered by the ✎ button), so normal clicks on the header just
// collapse/expand the box instead of accidentally starting a text edit.
// Commits on blur/Enter, cancels on Escape.
function GroupNameInput({ value, onCommit, onDone }: {
  value: string
  onCommit: (newValue: string) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onCommit(trimmed)
    onDone()
  }
  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') onDone()
      }}
      placeholder="Nome do grupo..."
      className="flex-1 min-w-[140px] bg-surface-container-highest border border-primary/40 rounded px-2 py-1 font-bold text-lg text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30"
    />
  )
}

export default function ParametrosEstruturaPage() {
  const [rows, setRows] = useState<Rule[]>([])
  const [groupOrder, setGroupOrder] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [filter, setFilter] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<Rule[] | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [classRows, setClassRows] = useState<ClassificationRow[]>([])
  const [classLoading, setClassLoading] = useState(true)
  const [classSaving, setClassSaving] = useState(false)
  const [classError, setClassError] = useState('')
  const [classSuccessMsg, setClassSuccessMsg] = useState('')
  const [classFilter, setClassFilter] = useState('')

  const loadClassification = async () => {
    setClassLoading(true)
    setClassError('')
    setClassSuccessMsg('')
    try {
      const res = await fetch('/api/equipment-classification-rules')
      const json = await res.json()
      if (!res.ok) { setClassError(json.error || 'Falha ao carregar classificação'); return }
      setClassRows((json as EquipmentClassificationRule[]).map(ruleToRow))
    } catch {
      setClassError('Falha de rede ao carregar classificação')
    } finally {
      setClassLoading(false)
    }
  }

  useEffect(() => { loadClassification() }, [])

  const updateClassCell = (index: number, field: keyof ClassificationRow, value: string) => {
    setClassRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  const addClassRow = () => {
    setClassFilter('')
    setClassRows(prev => [...prev, { patternsText: '', combinator: 'OR', equip: '' }])
  }

  const removeClassRow = (index: number) => {
    setClassRows(prev => prev.filter((_, i) => i !== index))
  }

  const handleSaveClassification = async () => {
    const nonBlank = classRows.filter(r => r.patternsText.trim() || r.equip.trim())
    const clean = nonBlank.map(rowToRule)
    for (let i = 0; i < clean.length; i++) {
      const r = clean[i]
      if (r.patterns.length === 0 || !r.equip) {
        setClassError(`Linha ${i + 1}: informe ao menos um padrão e o campo Equipamento`)
        return
      }
    }
    setClassSaving(true)
    setClassError('')
    setClassSuccessMsg('')
    try {
      const res = await fetch('/api/equipment-classification-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean),
      })
      const json = await res.json()
      if (!res.ok) { setClassError(json.error || 'Falha ao salvar classificação'); return }
      setClassSuccessMsg(`${clean.length} regra(s) salva(s) com sucesso`)
      setClassRows(clean.map(ruleToRow))
    } catch {
      setClassError('Falha de rede ao salvar classificação')
    } finally {
      setClassSaving(false)
    }
  }

  const classFilteredIndices = classRows.map((_, i) => i).filter(i => {
    const f = classFilter.trim().toLowerCase()
    if (!f) return true
    const r = classRows[i]
    return r.patternsText.toLowerCase().includes(f) || r.equip.toLowerCase().includes(f)
  })

  const load = async () => {
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await fetch('/api/structure-property-rules')
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao carregar parâmetros'); return }
      const sorted = (json as Rule[]).slice().sort((a, b) =>
        a.property_field.localeCompare(b.property_field, 'pt-BR') || a.component_code.localeCompare(b.component_code)
      )
      setRows(sorted)
      setGroupOrder(computeGroupOrder(sorted))
    } catch {
      setError('Falha de rede ao carregar parâmetros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const updateCell = (index: number, field: 'component_code' | 'expected_value', value: string) => {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  const addRowToGroup = (groupKey: string) => {
    setFilter('')
    setRows(prev => [...prev, { property_field: groupKey, component_code: '', expected_value: '' }])
    setExpanded(prev => new Set(prev).add(groupKey))
  }

  const removeRow = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  const renameGroup = (oldKey: string, newKey: string) => {
    setRows(prev => prev.map(r => r.property_field === oldKey ? { ...r, property_field: newKey } : r))
    setGroupOrder(prev => Array.from(new Set(prev.map(k => k === oldKey ? newKey : k))))
    setExpanded(prev => {
      if (!prev.has(oldKey)) return prev
      const next = new Set(prev)
      next.delete(oldKey)
      next.add(newKey)
      return next
    })
  }

  const toggleGroup = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const addGroup = () => {
    const name = newGroupName.trim()
    if (!name) return
    setFilter('')
    if (!groupOrder.includes(name)) setGroupOrder(prev => [...prev, name])
    setRows(prev => [...prev, { property_field: name, component_code: '', expected_value: '' }])
    setExpanded(prev => new Set(prev).add(name))
    setNewGroupName('')
  }

  const removeGroup = (key: string) => {
    setRows(prev => prev.filter(r => r.property_field !== key))
    setGroupOrder(prev => prev.filter(k => k !== key))
    setExpanded(prev => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
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
      const sorted = list.slice().sort((a, b) =>
        a.property_field.localeCompare(b.property_field, 'pt-BR') || a.component_code.localeCompare(b.component_code)
      )
      setRows(sorted)
      setGroupOrder(computeGroupOrder(sorted))
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

  const groupIndices = new Map<string, number[]>()
  for (const i of filteredIndices) {
    const key = rows[i].property_field
    const arr = groupIndices.get(key)
    if (arr) arr.push(i)
    else groupIndices.set(key, [i])
  }
  const isFiltering = filter.trim() !== ''
  const visibleGroups = groupOrder.filter(key => !isFiltering || (groupIndices.get(key) || []).length > 0)

  return (
    <div className="p-6 max-w-[100rem]">
      <div className="mb-2">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em]">SISTEMA</div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
      <div>
      <h1 className="text-3xl font-bold text-on-surface mb-1">Parâmetros de Estrutura</h1>
      <p className="text-on-surface-variant text-base mb-3">
        Regras por Grupo Acessórios usadas pelo Busc. Itens Série Estrut. — edite e clique em Salvar, ou importe/exporte um Excel.
      </p>
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

          <div className="flex flex-col gap-4">
            {visibleGroups.length === 0 ? (
              <div className="text-base text-outline italic">Nenhum grupo encontrado.</div>
            ) : visibleGroups.map(key => {
              const indices = groupIndices.get(key) || []
              const isOpen = isFiltering || expanded.has(key)
              return (
                <div key={key} className="border border-outline-variant rounded-xl bg-surface-container overflow-hidden">
                  <div
                    onClick={() => toggleGroup(key)}
                    className="flex items-center gap-3 px-4 py-3 bg-surface-container-high border-b border-outline-variant cursor-pointer select-none"
                  >
                    <span
                      title={isOpen ? 'Recolher grupo' : 'Expandir grupo'}
                      className={`text-outline text-lg leading-none transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`}
                    >
                      ›
                    </span>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {editingGroup === key ? (
                        <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                          <GroupNameInput
                            value={key}
                            onCommit={newKey => renameGroup(key, newKey)}
                            onDone={() => setEditingGroup(null)}
                          />
                        </div>
                      ) : (
                        <>
                          <span className="font-bold text-lg text-on-surface truncate">
                            {key || <span className="text-outline italic font-normal">(sem nome)</span>}
                          </span>
                          <button
                            onClick={e => { e.stopPropagation(); setEditingGroup(key) }}
                            title="Editar nome do grupo"
                            className="text-outline hover:text-primary transition-colors text-sm shrink-0"
                          >
                            ✎
                          </button>
                        </>
                      )}
                    </div>
                    <span className="text-sm text-outline font-mono whitespace-nowrap">{indices.length} código(s)</span>
                    <button
                      onClick={e => { e.stopPropagation(); addRowToGroup(key) }}
                      className="px-3 py-1.5 bg-primary/10 border border-primary/40 text-primary rounded text-sm font-semibold hover:bg-primary/20 transition-colors whitespace-nowrap"
                    >
                      + Código
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); removeGroup(key) }}
                      title="Remover grupo inteiro"
                      className="text-outline hover:text-error transition-colors text-lg px-1"
                    >
                      ✕
                    </button>
                  </div>
                  {isOpen && (
                    <div className="overflow-auto">
                      <table className="text-base w-full">
                        <thead className="bg-surface-container-highest/60">
                          <tr>
                            <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Código Acessório Protheus</th>
                            <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Output</th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {indices.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-3 py-3 text-sm text-outline italic">Nenhum código neste grupo ainda.</td>
                            </tr>
                          ) : indices.map(i => (
                            <tr key={i} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
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
                                  title="Remover código"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
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

          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <input
              type="text"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addGroup()}
              placeholder="NOME DO NOVO GRUPO..."
              className="bg-surface-container border border-outline-variant rounded px-3 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
            <button
              onClick={addGroup}
              disabled={!newGroupName.trim()}
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              + Novo Grupo
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

      <div className="xl:pl-12">
        <h1 className="text-3xl font-bold text-on-surface mb-1">Classificação de Equipamentos</h1>
        <p className="text-on-surface-variant text-base mb-3">
          Define o tipo de equipamento a partir da descrição da estrutura, usado para agrupar os resultados
          em Busc. Itens Série Estrut. — a última regra que bater vence.
        </p>

        {classLoading ? (
          <div className="flex items-center gap-3 py-16 text-outline">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-base font-mono">Carregando...</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <input
                type="text"
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
                placeholder="Filtrar por padrão, equipamento, família..."
                className="flex-1 min-w-[200px] bg-surface-container border border-outline-variant rounded px-3 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
              <span className="text-base text-outline font-mono whitespace-nowrap">{classFilteredIndices.length} de {classRows.length}</span>
            </div>

            <div className="overflow-auto border border-outline-variant rounded-lg max-h-[65vh]">
              <table className="text-base w-full">
                <thead className="sticky top-0 bg-surface-container-highest">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Padrões (vírgula = ou)</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Condição</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Equipamento</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {classFilteredIndices.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-base text-outline italic">Nenhuma regra encontrada.</td>
                    </tr>
                  ) : classFilteredIndices.map(i => (
                    <tr key={i} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
                      <td className="p-1">
                        <input
                          value={classRows[i].patternsText}
                          onChange={e => updateClassCell(i, 'patternsText', e.target.value)}
                          placeholder="ex: GARRETT"
                          className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-base"
                        />
                      </td>
                      <td className="p-1">
                        <select
                          value={classRows[i].combinator}
                          onChange={e => updateClassCell(i, 'combinator', e.target.value as 'OR' | 'AND')}
                          className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none text-on-surface text-base"
                        >
                          <option value="OR">Qualquer (OU)</option>
                          <option value="AND">Todas (E)</option>
                        </select>
                      </td>
                      <td className="p-1">
                        <input
                          value={classRows[i].equip}
                          onChange={e => updateClassCell(i, 'equip', e.target.value)}
                          className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-base"
                        />
                      </td>
                      <td className="p-1 text-center">
                        <button
                          onClick={() => removeClassRow(i)}
                          className="text-outline hover:text-error transition-colors text-xl"
                          title="Remover regra"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {classError && (
              <div className="mt-3 flex items-center gap-2 bg-error-container/20 border border-error/20 rounded-lg px-4 py-3 text-error text-base">
                ⚠ {classError}
              </div>
            )}
            {classSuccessMsg && (
              <div className="mt-3 flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-base">
                ✓ {classSuccessMsg}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <button
                onClick={addClassRow}
                className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
              >
                + Adicionar regra
              </button>
              <button
                onClick={handleSaveClassification}
                disabled={classSaving}
                className="px-5 py-2 bg-primary text-on-primary rounded text-base font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {classSaving ? 'Salvando…' : 'Salvar'}
              </button>
              <button
                onClick={loadClassification}
                disabled={classSaving}
                className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
              >
                Descartar alterações e recarregar
              </button>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
