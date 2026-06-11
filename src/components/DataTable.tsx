'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { TableSchema, Field, getListFields } from '@/lib/schema'
import { exportMatrix, parseImportFile, getExportFolder, setExportFolder } from '@/lib/importExport'

type LookupMap = Record<string, Record<string, string>>
import RecordModal from './RecordModal'
import NonCombinableModal from './NonCombinableModal'
import DependentItemsModal from './DependentItemsModal'
import RollerTableModal from './RollerTableModal'
import ColumnFilter from './ColumnFilter'
import ImportReviewModal from './ImportReviewModal'

interface Props {
  tableName: string
  schema: TableSchema
}

interface PageData {
  data: Record<string, unknown>[]
  total: number
  page: number
  pages: number
}

const PAGE_SIZE = 25000

function getDisplayValue(
  row: Record<string, unknown>,
  fieldName: string,
  field: Field | undefined,
  lookups: LookupMap,
): string {
  if (field?.lookupFrom && lookups[fieldName]) {
    const keyField = field.lookupFrom.sourceField ?? fieldName
    const key = String(row[keyField] ?? '')
    return lookups[fieldName][key] ?? 'N/A'
  }
  const raw = row[fieldName]
  if (field?.type === 'boolean') return raw ? 'Sim' : 'Não'
  if (raw === null || raw === undefined || raw === 'null' || raw === '') return 'N/A'
  return String(raw)
}

function applyFilters(
  rows: Record<string, unknown>[],
  filters: Record<string, string[]>,
  fields: Field[],
  lookups: LookupMap,
): Record<string, unknown>[] {
  const active = Object.entries(filters).filter(([, v]) => v.length > 0)
  if (!active.length) return rows
  return rows.filter(row =>
    active.every(([name, vals]) => {
      const field = fields.find(f => f.name === name)
      const display = getDisplayValue(row, name, field, lookups)
      return vals.includes(display)
    })
  )
}

export default function DataTable({ tableName, schema }: Props) {
  const [pageData, setPageData] = useState<PageData | null>(null)
  const [page] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null)
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [lookups, setLookups] = useState<LookupMap>({})
  const [nonCombModal,    setNonCombModal]    = useState(false)
  const [depItemsModal,   setDepItemsModal]   = useState(false)
  const [rollerModal,     setRollerModal]     = useState(false)
  // colFilters: selected values per column (multi-select checkboxes)
  const [colFilters,    setColFilters]    = useState<Record<string, string[]>>({})
  // filterSearch: text typed in each filter's search box (narrows dropdown, doesn't filter table)
  const [filterSearch,  setFilterSearch]  = useState<Record<string, string>>({})
  const scrollRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [importRows,    setImportRows]     = useState<Record<string, string>[] | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [newMenuOpen,   setNewMenuOpen]   = useState(false)
  // Folder used to compose the full path copied after export (browser can't read it)
  const [exportFolder,  setExportFolderState] = useState('')
  useEffect(() => { setExportFolderState(getExportFolder()) }, [])

  const listFields = useMemo(() => getListFields(tableName), [tableName])

  useEffect(() => { setColFilters({}); setFilterSearch({}) }, [tableName])

  useEffect(() => {
    const fieldsWithLookup = listFields.filter(f => f.lookupFrom)
    if (fieldsWithLookup.length === 0) return
    fieldsWithLookup.forEach(async (field) => {
      const lc = field.lookupFrom!

      if (lc.through) {
        const [mainRes, throughRes] = await Promise.all([
          fetch(`/api/${lc.table}?limit=25000`),
          fetch(`/api/${lc.through.table}?limit=25000`),
        ])
        if (!mainRes.ok || !throughRes.ok) return
        const [mainJson, throughJson] = await Promise.all([mainRes.json(), throughRes.json()])
        const intermediateMap: Record<string, string> = {}
        for (const row of (mainJson.data || [])) {
          intermediateMap[String(row[lc.keyField])] = row[lc.displayField] == null ? '' : String(row[lc.displayField])
        }
        const throughMap: Record<string, string> = {}
        for (const row of (throughJson.data || [])) {
          throughMap[String(row[lc.through.keyField])] = row[lc.through.displayField] == null ? '' : String(row[lc.through.displayField])
        }
        const map: Record<string, string> = {}
        for (const [key, mid] of Object.entries(intermediateMap)) {
          if (mid && throughMap[mid]) map[key] = throughMap[mid]
        }
        setLookups(prev => ({ ...prev, [field.name]: map }))
        return
      }

      const res = await fetch(`/api/${lc.table}?limit=25000`)
      if (!res.ok) return
      const json = await res.json()
      const map: Record<string, string> = {}
      for (const row of (json.data || [])) {
        map[String(row[lc.keyField])] = row[lc.displayField] == null ? '' : String(row[lc.displayField])
      }
      setLookups(prev => ({ ...prev, [field.name]: map }))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (search) params.set('search', search)
    const res = await fetch(`/api/${tableName}?${params}`)
    if (!res.ok) {
      setError('Erro ao carregar dados')
      setLoading(false)
      return
    }
    const json = await res.json()
    setPageData(json)
    setLoading(false)
  }, [tableName, page, search])

  useEffect(() => { fetchData() }, [fetchData])

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pageData, checkScroll])

  // Rows that pass ALL active column filters
  const filteredRows = useMemo(() => {
    if (!pageData) return []
    return applyFilters(pageData.data, colFilters, listFields, lookups)
  }, [pageData, colFilters, lookups, listFields])

  // For each column: distinct display values from rows that pass ALL OTHER column filters
  // This gives cascading behavior — each dropdown shows only what's still possible
  const columnOptions = useMemo(() => {
    if (!pageData || !schema.columnFilters) return {} as Record<string, string[]>
    const result: Record<string, string[]> = {}
    for (const field of listFields) {
      const otherFilters = Object.fromEntries(
        Object.entries(colFilters).filter(([name]) => name !== field.name)
      )
      const candidateRows = applyFilters(pageData.data, otherFilters, listFields, lookups)
      const seen = new Set<string>()
      for (const row of candidateRows) {
        const val = getDisplayValue(row, field.name, field, lookups)
        if (val !== '' && val !== 'null' && val !== 'undefined') seen.add(val)
      }
      // N/A first, rest alphabetical
      result[field.name] = Array.from(seen).sort((a, b) => {
        if (a === 'N/A') return -1
        if (b === 'N/A') return 1
        return a.localeCompare(b, 'pt-BR')
      })
    }
    return result
  }, [pageData, colFilters, lookups, listFields, schema.columnFilters])

  const hasActiveColFilters = Object.values(colFilters).some(v => v.length > 0)

  const handleToggleFilter = useCallback((name: string, val: string) => {
    setColFilters(prev => {
      const cur = prev[name] ?? []
      return { ...prev, [name]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] }
    })
  }, [])

  const handleClearFilter = useCallback((name: string) => {
    setColFilters(prev => ({ ...prev, [name]: [] }))
  }, [])

  const handleSearch = () => setSearch(searchInput)

  const handleExportMatrix = async () => {
    try {
      const { path, copied, cancelled } = await exportMatrix(schema.fields, `matriz_${tableName}.xlsx`)
      if (cancelled) return
      if (!getExportFolder()) {
        showToast('Salvo! Defina a "Pasta de exportação" no menu ▾ para copiar o caminho completo')
      } else {
        showToast(
          copied
            ? `Caminho copiado! Cole no Explorer ou Win+R para abrir: ${path}`
            : `Salvo. Caminho: ${path}`,
        )
      }
    } catch {
      showToast('Erro ao exportar matriz', true)
    }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportLoading(true)
    try {
      const rows = await parseImportFile(file, schema.fields)
      setImportRows(rows)
      window.dispatchEvent(new CustomEvent('import-review:open'))
    } catch (err) {
      showToast((err as Error).message || 'Erro ao importar arquivo', true)
    } finally {
      setImportLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteId(null)
    const res = await fetch(`/api/${tableName}/${id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('Registro excluído com sucesso')
      fetchData()
    } else {
      const err = await res.json()
      showToast(err.error || 'Erro ao excluir', true)
    }
  }

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3500)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Buscar registros..."
            className="bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-64 transition-colors"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
          >
            Buscar
          </button>
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchInput('') }}
              className="px-3 py-2 text-sm text-outline hover:text-primary transition-colors"
            >
              ✕ Limpar
            </button>
          )}
          {hasActiveColFilters && (
            <button
              onClick={() => { setColFilters({}); setFilterSearch({}) }}
              className="px-3 py-2 text-sm text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
            >
              ✕ Limpar filtros
            </button>
          )}
        </div>
        <div className="relative">
          {/* Backdrop to close dropdown on outside click */}
          {newMenuOpen && (
            <div className="fixed inset-0 z-10" onClick={() => setNewMenuOpen(false)} />
          )}

          <button
            onClick={() => {
              if (schema.importExport) { setNewMenuOpen(o => !o); return }
              if (tableName === 'non_combinable_comps') { setNonCombModal(true) }
              else if (tableName === 'dependant_items')  { setDepItemsModal(true) }
              else if (tableName === 'roller_tables')    { setRollerModal(true) }
              else { setEditRecord(null); setModalOpen(true) }
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow whitespace-nowrap"
          >
            + Novo Registro
            {schema.importExport && (
              <span className={`text-xs transition-transform duration-150 ${newMenuOpen ? 'rotate-180' : ''}`}>▾</span>
            )}
          </button>

          {/* Dropdown */}
          {schema.importExport && newMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] bg-surface-container-high border border-outline-variant rounded shadow-xl overflow-hidden">
              <button
                onClick={() => {
                  setNewMenuOpen(false)
                  if (tableName === 'non_combinable_comps') { setNonCombModal(true) }
                  else if (tableName === 'dependant_items') { setDepItemsModal(true) }
                  else if (tableName === 'roller_tables')   { setRollerModal(true) }
                  else { setEditRecord(null); setModalOpen(true) }
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-highest hover:text-primary transition-colors"
              >
                + Novo registro manual
              </button>
              <div className="border-t border-outline-variant/40" />
              <button
                onClick={() => { setNewMenuOpen(false); handleExportMatrix() }}
                className="w-full text-left px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-highest hover:text-primary transition-colors"
              >
                ↓ Exportar Matriz
              </button>
              <button
                onClick={() => { setNewMenuOpen(false); fileInputRef.current?.click() }}
                disabled={importLoading}
                className="w-full text-left px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-highest hover:text-primary transition-colors disabled:opacity-50"
              >
                {importLoading ? '…' : '↑ Importar Excel'}
              </button>
              <div className="border-t border-outline-variant/40" />
              <div className="px-4 py-2.5">
                <div className="text-[10px] text-outline uppercase tracking-wider font-mono mb-1">
                  Pasta de exportação
                </div>
                <input
                  type="text"
                  value={exportFolder}
                  onChange={e => { setExportFolderState(e.target.value); setExportFolder(e.target.value) }}
                  placeholder="C:\Users\voce\Documentos"
                  spellCheck={false}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-on-surface font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-outline/40"
                />
                <div className="text-[9px] text-outline/60 mt-1 leading-tight">
                  Usada para copiar o caminho completo após exportar
                </div>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-container rounded border border-outline-variant overflow-hidden min-h-[70vh]">
        {loading && (
          <div className="flex items-center justify-center py-16 text-outline gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono">Carregando...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-16 text-error gap-2 text-sm">
            ⚠ {error}
          </div>
        )}

        {!loading && !error && pageData && (
          <>
            <div className="relative">
              <div ref={scrollRef} onScroll={checkScroll} className="overflow-x-auto">
              <table className={`${schema.compactColumns ? 'min-w-full' : 'w-full'} text-sm`}>
                <thead className="bg-surface-container-highest border-b border-outline-variant">
                  <tr>
                    {listFields.map(f => (
                      <th key={f.name} className={`px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] whitespace-nowrap font-mono${schema.columnFilters ? ` align-top${f.listKeepWidth ? ' min-w-[150px]' : ' min-w-[100px]'}` : ''}`}>
                        <div>{f.label}</div>
                        {schema.columnFilters && (
                          <div className="mt-1.5">
                            <ColumnFilter
                              searchValue={filterSearch[f.name] ?? ''}
                              onSearchChange={v => setFilterSearch(prev => ({ ...prev, [f.name]: v }))}
                              selectedValues={colFilters[f.name] ?? []}
                              onToggleValue={v => handleToggleFilter(f.name, v)}
                              onClearValues={() => handleClearFilter(f.name)}
                              options={columnOptions[f.name] ?? []}
                              compact={schema.compactColumns && !f.listKeepWidth}
                            />
                          </div>
                        )}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono whitespace-nowrap sticky right-0 bg-surface-container-highest border-l border-outline-variant/40 z-10">
                      <div>Ações</div>
                      {canScrollRight && (
                        <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-primary/20 border border-primary/30 text-primary text-[9px] font-semibold normal-case tracking-wide animate-pulse">
                          ← rolar
                        </div>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={listFields.length + 1} className="px-4 py-12 text-center text-outline text-sm">
                        Nenhum registro encontrado
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, i) => (
                      <tr key={String(row.id) || i} className="hover:bg-surface-container-high transition-colors group">
                        {listFields.map(f => {
                          let cell: React.ReactNode
                          if (f.lookupFrom && lookups[f.name]) {
                            const text = getDisplayValue(row, f.name, f, lookups) || '—'
                            cell = f.listExpand
                              ? <TruncatedCell text={text} maxLen={14} />
                              : <span title={text.length > 50 ? text : undefined}>{text}</span>
                          } else {
                            cell = <CellValue value={row[f.name]} type={f.type} />
                          }
                          return (
                            <td key={f.name} className={`px-4 py-3 text-on-surface-variant whitespace-nowrap${schema.columnFilters ? f.listKeepWidth ? ' min-w-[150px]' : ' min-w-[100px]' : ''}`}>
                              {cell}
                            </td>
                          )
                        })}
                        <td className="px-4 py-3 text-right whitespace-nowrap sticky right-0 bg-surface-container group-hover:bg-surface-container-high transition-colors border-l border-outline-variant/40 z-10">
                          <button
                            onClick={() => { setEditRecord(row); setModalOpen(true) }}
                            className="text-outline hover:text-primary text-xs font-medium mr-3 transition-colors"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => setDeleteId(String(row.id))}
                            className="text-outline hover:text-error text-xs font-medium transition-colors"
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
              {/* Fade gradient — visible only when table can scroll right */}
              {canScrollRight && (
                <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-surface-container via-surface-container/70 to-transparent z-[5]" />
              )}
            </div>

            {/* Record count */}
            <div className="px-4 py-3 border-t border-outline-variant/30 text-xs text-outline font-mono">
              {filteredRows.length < pageData.data.length
                ? <>{filteredRows.length} de {pageData.total} registro{pageData.total !== 1 ? 's' : ''} <span className="text-primary">· filtrado</span></>
                : <>{pageData.total} registro{pageData.total !== 1 ? 's' : ''}{search && <span className="ml-1 text-primary">· busca ativa</span>}</>
              }
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl p-6 w-full max-w-sm animate-fade-in">
            <h3 className="text-base font-semibold text-on-surface mb-2">⚠ Confirmar exclusão</h3>
            <p className="text-on-surface-variant text-sm mb-6">
              Esta ação não pode ser desfeita. Deseja excluir o registro?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="px-4 py-2 text-sm bg-error-container text-on-error-container rounded hover:brightness-110 font-medium transition-all"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dependent items custom modal */}
      {depItemsModal && (
        <DependentItemsModal
          onClose={() => setDepItemsModal(false)}
          onSaved={count => {
            setDepItemsModal(false)
            fetchData()
            showToast(`${count} registros inseridos!`)
          }}
        />
      )}

      {/* Roller table custom modal */}
      {rollerModal && (
        <RollerTableModal
          onClose={() => setRollerModal(false)}
          onSaved={count => {
            setRollerModal(false)
            fetchData()
            showToast(`${count} registros inseridos!`)
          }}
        />
      )}

      {/* Non-combinable custom modal */}
      {nonCombModal && (
        <NonCombinableModal
          onClose={() => setNonCombModal(false)}
          onSaved={count => {
            setNonCombModal(false)
            fetchData()
            showToast(`${count} registros inseridos!`)
          }}
        />
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <RecordModal
          schema={schema}
          tableName={tableName}
          record={editRecord}
          onClose={() => { setModalOpen(false); setEditRecord(null) }}
          onSaved={() => {
            setModalOpen(false)
            setEditRecord(null)
            fetchData()
            showToast(editRecord ? 'Registro atualizado!' : 'Registro criado!')
          }}
        />
      )}

      {importRows && (
        <ImportReviewModal
          schema={schema}
          tableName={tableName}
          initialRows={importRows}
          onClose={() => { setImportRows(null); window.dispatchEvent(new CustomEvent('import-review:close')) }}
          onDone={saved => {
            setImportRows(null)
            window.dispatchEvent(new CustomEvent('import-review:close'))
            fetchData()
            showToast(`${saved} registro${saved !== 1 ? 's' : ''} importado${saved !== 1 ? 's' : ''} com sucesso!`)
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-lg shadow-lg text-sm animate-fade-in border ${
          toast.isError
            ? 'bg-error-container border-error/30 text-on-error-container'
            : 'bg-surface-container-highest border-outline-variant text-on-surface'
        }`}>
          {toast.isError ? '✕' : '✓'} {toast.msg}
        </div>
      )}
    </div>
  )
}

function TruncatedCell({ text, maxLen = 32 }: { text: string; maxLen?: number }) {
  const [open, setOpen] = useState(false)
  if (text.length <= maxLen) return <span>{text}</span>
  return (
    <span className="inline-flex items-start gap-1">
      <span className="break-words whitespace-normal">{open ? text : text.slice(0, maxLen) + '…'}</span>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title={open ? 'Recolher' : 'Ver completo'}
        className="shrink-0 mt-0.5 text-[9px] text-outline hover:text-primary border border-outline-variant/50 hover:border-primary/40 rounded px-1 py-0.5 leading-none transition-colors"
      >
        {open ? '▲' : '▼'}
      </button>
    </span>
  )
}

function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined || value === 'null') {
    return <span className="text-outline text-xs font-mono">N/A</span>
  }
  if (type === 'boolean') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono ${
        value
          ? 'bg-green-900/40 text-green-400 border border-green-800/40'
          : 'bg-surface-container-highest text-outline border border-outline-variant'
      }`}>
        {value ? 'Sim' : 'Não'}
      </span>
    )
  }
  if (type === 'jsonb') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface-container-highest text-outline text-xs font-mono border border-outline-variant">
        JSON
      </span>
    )
  }
  if (type === 'select') {
    const colors: Record<string, string> = {
      active:   'bg-green-900/40 text-green-400 border-green-800/40',
      inactive: 'bg-surface-container-highest text-outline border-outline-variant',
      draft:    'bg-primary/10 text-primary border-primary/20',
      sent:     'bg-blue-900/40 text-blue-400 border-blue-800/40',
      approved: 'bg-green-900/40 text-green-400 border-green-800/40',
      rejected: 'bg-error-container/40 text-error border-error/20',
      admin:    'bg-purple-900/40 text-purple-400 border-purple-800/40',
      user:     'bg-surface-container-highest text-outline border-outline-variant',
    }
    const cls = colors[String(value)] || 'bg-surface-container-highest text-outline border-outline-variant'
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono border ${cls}`}>
        {String(value)}
      </span>
    )
  }
  if (type === 'timestamp') {
    return <span className="text-outline text-xs font-mono">{new Date(String(value)).toLocaleString('pt-BR')}</span>
  }
  if (type === 'uuid') {
    return <span className="font-mono text-xs text-outline">{String(value).slice(0, 8)}…</span>
  }
  const str = String(value)
  return <span title={str.length > 50 ? str : undefined}>{str.length > 50 ? str.slice(0, 50) + '…' : str}</span>
}
