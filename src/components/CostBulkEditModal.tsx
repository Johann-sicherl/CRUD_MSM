'use client'

import { useState } from 'react'

interface SelectedRow {
  id: string
  table: string
}

interface Props {
  rows: SelectedRow[]
  onClose: () => void
  onSaved: (ok: number, fail: number) => void
}

const NAV_KEYS = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

function blockNonNumericKey(e: React.KeyboardEvent<HTMLInputElement>) {
  if (NAV_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return
  if (/^[0-9]$/.test(e.key)) return
  if (e.key === '.' && !e.currentTarget.value.includes('.')) return
  e.preventDefault()
}

export default function CostBulkEditModal({ rows, onClose, onSaved }: Props) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const hasValue = value.trim() !== ''

  const handleApply = async () => {
    if (!hasValue || loading) return
    setLoading(true)
    setError('')

    let ok = 0, fail = 0
    await Promise.all(rows.map(async ({ id, table }) => {
      const res = await fetch(`/api/${table}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cost_std: value }),
      })
      res.ok ? ok++ : fail++
    }))

    setLoading(false)
    if (ok === 0) {
      setError('Erro ao aplicar alterações — nenhum registro foi atualizado')
      return
    }
    onSaved(ok, fail)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md my-8 animate-fade-in">

        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">
            Alterar selecionados — <span className="text-primary">Custos Gerais VMI</span>
          </h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none transition-colors">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center gap-2 text-xs text-outline bg-surface-container-low rounded px-3 py-2 border border-outline-variant font-mono">
            {rows.length} registro{rows.length !== 1 ? 's' : ''} selecionado{rows.length !== 1 ? 's' : ''} — o novo custo será gravado na tabela de origem real de cada linha
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">Custo (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={blockNonNumericKey}
              placeholder="0.00"
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-error-container/30 text-error text-sm px-4 py-3 rounded border border-error/20">
              ⚠ {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-outline-variant">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!hasValue || loading}
              title={!hasValue ? 'Informe um valor de custo' : undefined}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
            >
              {loading
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Aplicando...</>
                : `Realizar alterações em ${rows.length}`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
