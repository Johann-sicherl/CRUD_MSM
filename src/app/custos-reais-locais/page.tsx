'use client'

import { useEffect, useMemo, useState } from 'react'
import { tables, FORCE_TO_ONE_FIELDS } from '@/lib/schema'

interface RowState {
  label: string
  values: Record<string, number | null>
  updatedAt: string
}
type Store = Record<string, Record<string, RowState>>

function fmtNum(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString('pt-BR') } catch { return iso }
}

export default function CustosReaisLocaisPage() {
  const [store, setStore] = useState<Store | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editingRow, setEditingRow] = useState<string | null>(null) // `${table}::${key}`
  const [editDraft, setEditDraft] = useState<Record<string, string>>({})
  const [savingRow, setSavingRow] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')

  const loadStore = () => {
    setLoading(true)
    setLoadError('')
    fetch('/api/local-costs')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => { setStore(json); setLoading(false) })
      .catch(err => { setLoadError(err.message || 'Falha ao carregar'); setLoading(false) })
  }

  useEffect(() => { loadStore() }, [])

  // Só as tabelas que de fato têm alguma coluna financeira (as mesmas que o
  // Atualizador Global sempre grava como 1 no Supabase) — as demais nunca
  // teriam nada capturado aqui de qualquer forma.
  const relevantTables = useMemo(() => {
    return Object.entries(tables)
      .map(([name, schema]) => ({
        name,
        schema,
        financialFields: schema.fields.filter(f => FORCE_TO_ONE_FIELDS.includes(f.name)),
      }))
      .filter(t => t.financialFields.length > 0)
  }, [])

  const startEdit = (table: string, key: string, row: RowState, financialFields: { name: string }[]) => {
    setEditingRow(`${table}::${key}`)
    setSaveError('')
    const draft: Record<string, string> = {}
    for (const f of financialFields) {
      const v = row.values[f.name]
      draft[f.name] = v === null || v === undefined ? '' : String(v)
    }
    setEditDraft(draft)
  }

  const cancelEdit = () => { setEditingRow(null); setEditDraft({}); setSaveError('') }

  const saveEdit = async (table: string, key: string) => {
    const rowId = `${table}::${key}`
    setSavingRow(rowId)
    setSaveError('')
    const values: Record<string, number | null> = {}
    for (const [name, raw] of Object.entries(editDraft)) {
      values[name] = raw.trim() === '' ? null : Number(raw)
    }
    try {
      const res = await fetch(`/api/local-costs/${table}/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Falha ao salvar')
      }
      const updatedRow: RowState = await res.json()
      setStore(prev => ({ ...(prev ?? {}), [table]: { ...(prev?.[table] ?? {}), [key]: updatedRow } }))
      setEditingRow(null)
      setEditDraft({})
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSavingRow(null)
    }
  }

  return (
    <div className="p-8 max-w-[90rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · custos reais (local)
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Custos Reais (Local)</h1>
        <p className="text-on-surface-variant text-base mt-1">
          O Atualizador Global de Tabelas sempre grava as colunas financeiras ({FORCE_TO_ONE_FIELDS.join(', ')}) como{' '}
          <span className="font-mono">1</span> no Supabase, por sigilo. Esta tela mostra os valores REAIS que vieram
          no último CSV importado de cada tabela — capturados automaticamente no momento do import, guardados{' '}
          <strong>só num arquivo local nesta máquina</strong> (nunca no Supabase, nunca no Git). Editar um valor aqui
          também grava só nesse arquivo local — nunca altera o Supabase.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-outline text-sm py-8">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Carregando…
        </div>
      )}

      {loadError && (
        <div className="flex items-center gap-2 bg-error-container/30 text-error text-sm px-4 py-3 rounded border border-error/20 mb-4">
          ⚠ {loadError}
          <button onClick={loadStore} className="ml-auto underline hover:no-underline">tentar de novo</button>
        </div>
      )}

      {!loading && !loadError && (
        <div className="flex flex-col gap-3">
          {relevantTables.map(({ name, schema, financialFields }) => {
            const tableStore = store?.[name] ?? {}
            const rowCount = Object.keys(tableStore).length
            const isOpen = expanded === name
            const rows = Object.entries(tableStore).filter(([key, row]) =>
              !search || row.label.toLowerCase().includes(search.toLowerCase()) || key.toLowerCase().includes(search.toLowerCase())
            )
            return (
              <div key={name} className="rounded-xl border border-outline-variant bg-surface-container overflow-hidden">
                <div
                  className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer hover:bg-surface-container-high transition-colors"
                  onClick={() => setExpanded(isOpen ? null : name)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-semibold text-on-surface truncate">{schema.label}</span>
                    <span className="text-xs font-mono text-outline">{financialFields.map(f => f.label).join(', ')}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono text-outline">
                      {rowCount} registro{rowCount !== 1 ? 's' : ''} capturado{rowCount !== 1 ? 's' : ''}
                    </span>
                    <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-outline-variant p-5">
                    {rowCount === 0 ? (
                      <div className="text-sm text-outline italic">
                        Nenhum valor capturado ainda — importe um CSV desta tabela pelo Atualizador Global de Tabelas.
                      </div>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          placeholder="Filtrar por código ou nome..."
                          className="w-full sm:w-80 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors mb-3"
                        />
                        {saveError && (
                          <div className="text-xs text-error mb-3">⚠ {saveError}</div>
                        )}
                        <div className="overflow-x-auto border border-outline-variant rounded-lg max-h-[32rem] overflow-y-auto">
                          <table className="text-xs w-full">
                            <thead className="sticky top-0 bg-surface-container-highest">
                              <tr>
                                <th className="text-left px-3 py-2 font-mono text-on-surface-variant border-b border-outline-variant whitespace-nowrap">Item</th>
                                {financialFields.map(f => (
                                  <th key={f.name} className="text-right px-3 py-2 font-mono text-on-surface-variant border-b border-outline-variant whitespace-nowrap">
                                    {f.label}
                                  </th>
                                ))}
                                <th className="text-left px-3 py-2 font-mono text-on-surface-variant border-b border-outline-variant whitespace-nowrap">Atualizado em</th>
                                <th className="px-3 py-2 border-b border-outline-variant w-24" />
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(([key, row]) => {
                                const rowId = `${name}::${key}`
                                const isEditing = editingRow === rowId
                                return (
                                  <tr key={key} className="border-b border-outline-variant/50 odd:bg-surface-container-low align-top">
                                    <td className="px-3 py-2 text-on-surface whitespace-nowrap">
                                      {row.label}
                                      <div className="text-outline text-[10px] font-mono">{key}</div>
                                    </td>
                                    {financialFields.map(f => (
                                      <td key={f.name} className="px-3 py-2 text-right whitespace-nowrap">
                                        {isEditing ? (
                                          <input
                                            type="number"
                                            step="0.0001"
                                            value={editDraft[f.name] ?? ''}
                                            onChange={e => setEditDraft(prev => ({ ...prev, [f.name]: e.target.value }))}
                                            className="w-28 bg-surface-container border border-outline-variant rounded px-2 py-1 text-right text-on-surface focus:outline-none focus:border-primary"
                                          />
                                        ) : (
                                          <span className="text-on-surface-variant">{fmtNum(row.values[f.name] ?? null)}</span>
                                        )}
                                      </td>
                                    ))}
                                    <td className="px-3 py-2 text-outline whitespace-nowrap">{fmtDate(row.updatedAt)}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right">
                                      {isEditing ? (
                                        <div className="flex items-center gap-2 justify-end">
                                          <button
                                            onClick={() => saveEdit(name, key)}
                                            disabled={savingRow === rowId}
                                            className="text-primary hover:underline disabled:opacity-50"
                                          >
                                            {savingRow === rowId ? '…' : 'Salvar'}
                                          </button>
                                          <button onClick={cancelEdit} className="text-outline hover:text-error">Cancelar</button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => startEdit(name, key, row, financialFields)}
                                          className="text-outline hover:text-primary"
                                        >
                                          Editar
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
