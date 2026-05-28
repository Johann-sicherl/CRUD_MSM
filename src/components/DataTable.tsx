'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { TableSchema, getListFields } from '@/lib/schema'

type LookupMap = Record<string, Record<string, string>>
import RecordModal from './RecordModal'

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
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  const listFields = useMemo(() => getListFields(tableName), [tableName])

  useEffect(() => { setColFilters({}) }, [tableName])

  useEffect(() => {
    const fieldsWithLookup = listFields.filter(f => f.lookupFrom)
    if (fieldsWithLookup.length === 0) return
    fieldsWithLookup.forEach(async (field) => {
      const lc = field.lookupFrom!
      const res = await fetch(`/api/${lc.table}?limit=25000`)
      if (!res.ok) return
      const json = await res.json()
      const map: Record<string, string> = {}
      for (const row of (json.data || [])) {
        map[String(row[lc.keyField])] = String(row[lc.displayField])
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

  const filteredRows = useMemo(() => {
    if (!pageData) return []
    const active = Object.entries(colFilters).filter(([, v]) => v.trim())
    if (!active.length) return pageData.data
    return pageData.data.filter(row =>
      active.every(([name, fv]) => {
        const field = listFields.find(f => f.name === name)
        const raw = row[name]
        let display: string
        if (field?.lookupFrom && lookups[name]) {
          display = lookups[name][String(raw)] ?? String(raw ?? '')
        } else if (field?.type === 'boolean') {
          display = raw ? 'Sim' : 'Não'
        } else {
          display = String(raw ?? '')
        }
        return display.toLowerCase().includes(fv.toLowerCase())
      })
    )
  }, [pageData, colFilters, lookups, listFields])

  const handleSearch = () => setSearch(searchInput)

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
        <div className="flex gap-2 w-full sm:w-auto">
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
        </div>
        <button
          onClick={() => { setEditRecord(null); setModalOpen(true) }}
          className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow whitespace-nowrap"
        >
          + Novo Registro
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface-container rounded border border-outline-variant overflow-hidden">
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-container-highest border-b border-outline-variant">
                  <tr>
                    {listFields.map(f => (
                      <th key={f.name} className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] whitespace-nowrap font-mono">
                        <div>{f.label}</div>
                        {schema.columnFilters && (
                          <input
                            type="text"
                            value={colFilters[f.name] || ''}
                            onChange={e => setColFilters(prev => ({ ...prev, [f.name]: e.target.value }))}
                            placeholder="filtrar..."
                            className="mt-1.5 w-full min-w-[80px] bg-surface-container border border-outline-variant rounded px-2 py-1 text-[10px] font-normal normal-case tracking-normal text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                          />
                        )}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono whitespace-nowrap">
                      Ações
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
                      <tr key={String(row.id) || i} className="hover:bg-surface-container-high transition-colors">
                        {listFields.map(f => (
                          <td key={f.name} className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                            {f.lookupFrom && lookups[f.name]
                              ? <span>{lookups[f.name][String(row[f.name])] ?? String(row[f.name] ?? '—')}</span>
                              : <CellValue value={row[f.name]} type={f.type} />
                            }
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
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

function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) {
    return <span className="text-outline text-xs font-mono">null</span>
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
  return <span title={str.length > 40 ? str : undefined}>{str.length > 40 ? str.slice(0, 40) + '…' : str}</span>
}
