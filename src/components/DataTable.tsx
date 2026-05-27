'use client'

import { useState, useEffect, useCallback } from 'react'
import { TableSchema, getListFields } from '@/lib/schema'
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

const PAGE_SIZE = 20

export default function DataTable({ tableName, schema }: Props) {
  const [pageData, setPageData] = useState<PageData | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null)
  const [toast, setToast] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const listFields = getListFields(tableName)

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

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
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
    setToast((isError ? '❌ ' : '✅ ') + msg)
    setTimeout(() => setToast(''), 3500)
  }

  const formatCell = (value: unknown, type: string): string => {
    if (value === null || value === undefined) return '—'
    if (type === 'boolean') return value ? 'Sim' : 'Não'
    if (type === 'jsonb') return '[JSON]'
    if (type === 'timestamp') return new Date(String(value)).toLocaleString('pt-BR')
    if (type === 'uuid') return String(value).slice(0, 8) + '…'
    const str = String(value)
    return str.length > 40 ? str.slice(0, 40) + '…' : str
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
            placeholder="Buscar..."
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-slate-100 border border-slate-300 rounded-lg text-sm hover:bg-slate-200 text-slate-700"
          >
            Buscar
          </button>
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
            >
              ✕ Limpar
            </button>
          )}
        </div>
        <button
          onClick={() => { setEditRecord(null); setModalOpen(true) }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
        >
          + Novo Registro
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mr-3" />
            Carregando...
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-16 text-red-500 gap-2">
            <span>⚠️</span> {error}
          </div>
        )}

        {!loading && !error && pageData && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {listFields.map(f => (
                      <th key={f.name} className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageData.data.length === 0 ? (
                    <tr>
                      <td colSpan={listFields.length + 1} className="px-4 py-12 text-center text-slate-400">
                        Nenhum registro encontrado
                      </td>
                    </tr>
                  ) : (
                    pageData.data.map((row, i) => (
                      <tr key={String(row.id) || i} className="hover:bg-slate-50 transition-colors">
                        {listFields.map(f => (
                          <td key={f.name} className="px-4 py-3 text-slate-700 max-w-xs">
                            <CellValue value={row[f.name]} type={f.type} />
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => { setEditRecord(row); setModalOpen(true) }}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => setDeleteId(String(row.id))}
                            className="text-red-500 hover:text-red-700 text-xs font-medium"
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

            {/* Pagination */}
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm text-slate-600">
              <div>
                {pageData.total} registro{pageData.total !== 1 ? 's' : ''}
                {search && <span className="ml-1 text-blue-600">· filtrado</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 border rounded-md disabled:opacity-40 hover:bg-slate-50"
                >
                  ‹ Anterior
                </button>
                <span className="px-2">
                  {page} / {pageData.pages || 1}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(pageData.pages, p + 1))}
                  disabled={page >= pageData.pages}
                  className="px-3 py-1 border rounded-md disabled:opacity-40 hover:bg-slate-50"
                >
                  Próxima ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Confirmar exclusão</h3>
            <p className="text-slate-600 text-sm mb-6">
              Esta ação não pode ser desfeita. Deseja excluir o registro?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
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
        <div className="fixed bottom-6 right-6 z-50 bg-slate-800 text-white px-5 py-3 rounded-xl shadow-lg text-sm animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}

function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-300 text-xs">null</span>
  }
  if (type === 'boolean') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${value ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
        {value ? 'Sim' : 'Não'}
      </span>
    )
  }
  if (type === 'jsonb') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-xs font-mono">[JSON]</span>
  }
  if (type === 'select') {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-slate-100 text-slate-600',
      draft: 'bg-yellow-100 text-yellow-700',
      sent: 'bg-blue-100 text-blue-700',
      approved: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
      admin: 'bg-purple-100 text-purple-700',
      user: 'bg-slate-100 text-slate-600',
    }
    const cls = colors[String(value)] || 'bg-slate-100 text-slate-600'
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
        {String(value)}
      </span>
    )
  }
  if (type === 'timestamp') {
    return <span className="text-slate-500 text-xs">{new Date(String(value)).toLocaleString('pt-BR')}</span>
  }
  if (type === 'uuid') {
    return <span className="font-mono text-xs text-slate-500">{String(value).slice(0, 8)}…</span>
  }
  const str = String(value)
  return <span title={str.length > 40 ? str : undefined}>{str.length > 40 ? str.slice(0, 40) + '…' : str}</span>
}
