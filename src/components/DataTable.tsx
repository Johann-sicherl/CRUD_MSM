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

const PAGE_SIZE = 5000

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
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
              search
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Buscar registros..."
              className="bg-surface-container border border-outline-variant rounded pl-9 pr-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-64 transition-colors"
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
          >
            Buscar
          </button>
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchInput('') }}
              className="px-3 py-2 text-sm text-outline hover:text-primary transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
              Limpar
            </button>
          )}
        </div>
        <button
          onClick={() => { setEditRecord(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Novo Registro
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
            <span className="material-symbols-outlined">error</span>
            {error}
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
                        {f.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {pageData.data.length === 0 ? (
                    <tr>
                      <td colSpan={listFields.length + 1} className="px-4 py-12 text-center text-outline text-sm">
                        Nenhum registro encontrado
                      </td>
                    </tr>
                  ) : (
                    pageData.data.map((row, i) => (
                      <tr
                        key={String(row.id) || i}
                        className="hover:bg-surface-container-high transition-colors group"
                      >
                        {listFields.map(f => (
                          <td key={f.name} className="px-4 py-3 text-on-surface-variant max-w-xs">
                            <CellValue value={row[f.name]} type={f.type} />
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => { setEditRecord(row); setModalOpen(true) }}
                            className="inline-flex items-center gap-1 text-outline hover:text-primary text-xs font-medium mr-3 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                            Editar
                          </button>
                          <button
                            onClick={() => setDeleteId(String(row.id))}
                            className="inline-flex items-center gap-1 text-outline hover:text-error text-xs font-medium transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
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
              {pageData.total} registro{pageData.total !== 1 ? 's' : ''}
              {search && <span className="ml-1 text-primary">· filtrado</span>}
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl p-6 w-full max-w-sm animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <span className="material-symbols-outlined text-error text-[24px]">warning</span>
              <h3 className="text-base font-semibold text-on-surface">Confirmar exclusão</h3>
            </div>
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
          <span className="material-symbols-outlined text-[18px]">
            {toast.isError ? 'error' : 'check_circle'}
          </span>
          {toast.msg}
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
    return (
      <span className="text-outline text-xs font-mono">
        {new Date(String(value)).toLocaleString('pt-BR')}
      </span>
    )
  }
  if (type === 'uuid') {
    return (
      <span className="font-mono text-xs text-outline">
        {String(value).slice(0, 8)}…
      </span>
    )
  }
  const str = String(value)
  return <span title={str.length > 40 ? str : undefined}>{str.length > 40 ? str.slice(0, 40) + '…' : str}</span>
}
