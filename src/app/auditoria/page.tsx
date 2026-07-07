'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { tables } from '@/lib/schema'

interface AuditRow {
  id: string
  table_name: string
  operation: 'insert' | 'update' | 'delete'
  record_key_field: string
  record_key_value: string
  sql_query: string
  status: 'pending' | 'exported' | 'applied'
  created_at: string
}

const OPERATION_LABELS: Record<AuditRow['operation'], string> = {
  insert: 'Criação',
  update: 'Alteração',
  delete: 'Exclusão',
}

const OPERATION_COLORS: Record<AuditRow['operation'], string> = {
  insert: 'bg-green-500/10 text-green-500 border-green-500/30',
  update: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  delete: 'bg-red-500/10 text-red-500 border-red-500/30',
}

const STATUS_LABELS: Record<AuditRow['status'], string> = {
  pending: 'Pendente',
  exported: 'Exportado',
  applied: 'Aplicado',
}

function formatRecordKey(row: AuditRow): string {
  const names = row.record_key_field.split(',')
  const values = row.record_key_value.split('|')
  return names.map((n, i) => `${n}=${values[i] ?? ''}`).join(', ')
}

function buildSqlText(rows: AuditRow[]): string {
  return rows.map(r => r.sql_query).join('\n')
}

function downloadSql(rows: AuditRow[], filename: string) {
  const blob = new Blob([buildSqlText(rows)], { type: 'application/sql' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export default function AuditoriaPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tableFilter, setTableFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (tableFilter) params.set('table', tableFilter)
    if (statusFilter) params.set('status', statusFilter)
    const res = await fetch(`/api/audit-log?${params}`)
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      setError(err?.error || 'Erro ao carregar auditoria')
      setLoading(false)
      return
    }
    const json = await res.json()
    setRows(json.data || [])
    setSelectedIds(new Set())
    setLoading(false)
  }, [tableFilter, statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const auditedTables = useMemo(
    () => Object.entries(tables).filter(([, s]) => s.auditQueries),
    [],
  )

  const selectedRows = rows.filter(r => selectedIds.has(r.id))

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleExportSelected = async () => {
    if (selectedRows.length === 0) return
    downloadSql(selectedRows, `queries_${Date.now()}.sql`)
    await Promise.all(
      selectedRows
        .filter(r => r.status === 'pending')
        .map(r => fetch(`/api/audit-log/${r.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'exported' }),
        }))
    )
    showToast(`${selectedRows.length} query${selectedRows.length !== 1 ? 's' : ''} exportada${selectedRows.length !== 1 ? 's' : ''}`)
    fetchData()
  }

  const handleMarkApplied = async (id: string) => {
    await fetch(`/api/audit-log/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'applied' }),
    })
    fetchData()
  }

  const handleDiscard = async (id: string) => {
    await fetch(`/api/audit-log/${id}`, { method: 'DELETE' })
    showToast('Pendência descartada')
    fetchData()
  }

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0) return
    await Promise.all(selectedRows.map(r => fetch(`/api/audit-log/${r.id}`, { method: 'DELETE' })))
    showToast(`${selectedRows.length} quer${selectedRows.length !== 1 ? 'ies' : 'y'} exclu${selectedRows.length !== 1 ? 'ídas' : 'ída'}`)
    fetchData()
  }

  const handleCopyAll = () => {
    if (rows.length === 0) return
    navigator.clipboard.writeText(buildSqlText(rows)).then(() => showToast(`${rows.length} quer${rows.length !== 1 ? 'ies' : 'y'} copiada${rows.length !== 1 ? 's' : ''}`))
  }

  return (
    <div className="p-8 flex flex-col gap-4">
      <div className="sticky top-9 z-20 bg-background pt-2 -mt-2">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end justify-between">
          <div>
            <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">
              Sistema · auditoria
            </div>
            <h1 className="text-2xl font-bold text-on-surface">Auditoria de Queries</h1>
            <p className="text-on-surface-variant text-sm mt-1">
              Queries geradas a partir das alterações no app, para aplicar manualmente no banco oficial
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <select
              value={tableFilter}
              onChange={e => setTableFilter(e.target.value)}
              className="px-3 py-2 text-sm bg-surface-container border border-outline-variant rounded text-on-surface-variant"
            >
              <option value="">Todas as tabelas</option>
              {auditedTables.map(([name, schema]) => (
                <option key={name} value={name}>{schema.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm bg-surface-container border border-outline-variant rounded text-on-surface-variant"
            >
              <option value="">Todos os status</option>
              <option value="pending">Pendente</option>
              <option value="exported">Exportado</option>
              <option value="applied">Aplicado</option>
            </select>
            <button
              onClick={handleCopyAll}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⧉ Copiar todas ({rows.length})
            </button>
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={handleExportSelected}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-500 transition-colors whitespace-nowrap"
                >
                  ↓ Exportar {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
                </button>
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1.5 px-4 py-2 bg-error text-on-error rounded text-sm font-semibold hover:opacity-90 transition-colors whitespace-nowrap"
                >
                  ✕ Excluir {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-surface-container rounded border border-outline-variant overflow-hidden min-h-[70vh]">
        {loading && (
          <div className="flex items-center justify-center py-16 text-outline gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono">Carregando...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-16 text-error gap-2 text-sm">⚠ {error}</div>
        )}

        {!loading && !error && (
          <table className="w-full text-sm">
            <thead className="bg-surface-container-highest border-b border-outline-variant">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={rows.length > 0 && rows.every(r => selectedIds.has(r.id))}
                    onChange={e => setSelectedIds(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())}
                  />
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Tabela</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Ação</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Registro</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Quando</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-outline text-sm">Nenhuma query pendente</td></tr>
              ) : (
                rows.map(row => (
                  <Fragment key={row.id}>
                    <tr className="hover:bg-surface-container-high transition-colors">
                      <td className="px-3 py-3">
                        <input type="checkbox" className="accent-primary" checked={selectedIds.has(row.id)} onChange={() => toggleSelect(row.id)} />
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">{tables[row.table_name]?.label ?? row.table_name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded border text-xs font-mono ${OPERATION_COLORS[row.operation]}`}>
                          {OPERATION_LABELS[row.operation]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant font-mono">{formatRecordKey(row)}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{STATUS_LABELS[row.status]}</td>
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{new Date(row.created_at).toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3 whitespace-nowrap flex gap-2">
                        <button
                          onClick={() => navigator.clipboard.writeText(row.sql_query).then(() => showToast('SQL copiado'))}
                          className="text-primary hover:underline text-xs"
                        >
                          Copiar
                        </button>
                        {row.status === 'exported' && (
                          <button onClick={() => handleMarkApplied(row.id)} className="text-green-500 hover:underline text-xs">
                            Marcar aplicado
                          </button>
                        )}
                        {row.status === 'pending' && (
                          <button onClick={() => handleDiscard(row.id)} className="text-error hover:underline text-xs">
                            Descartar
                          </button>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={7} className="px-4 pb-4 bg-surface-container-high">
                        <pre className="p-3 bg-surface-container-highest border border-outline-variant rounded text-xs font-mono whitespace-pre-wrap overflow-x-auto">
                          {row.sql_query}
                        </pre>
                      </td>
                    </tr>
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

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
