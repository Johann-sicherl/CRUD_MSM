'use client'

import { useEffect, useState } from 'react'
import { Field, TableSchema } from '@/lib/schema'

interface Props {
  schema: TableSchema
  tableName: string
  selectedIds: string[]
  onClose: () => void
  onSaved: (ok: number, fail: number) => void
}

const NAV_KEYS = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

function blockNonNumericKey(e: React.KeyboardEvent<HTMLInputElement>, allowDecimal: boolean) {
  if (NAV_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return
  if (/^[0-9]$/.test(e.key)) return
  if (allowDecimal && e.key === '.' && !e.currentTarget.value.includes('.')) return
  e.preventDefault()
}

export default function BulkEditModal({ schema, tableName, selectedIds, onClose, onSaved }: Props) {
  const editableFields = schema.fields.filter(f => !f.isPk && !f.isReadonly && !f.hideInForm && !f.noBulkEdit)

  const [form, setForm] = useState<Record<string, string>>(
    Object.fromEntries(editableFields.map(f => [f.name, '']))
  )
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(editableFields.map(f => [f.name, false]))
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchedOptions, setFetchedOptions] = useState<Record<string, Array<{ value: string; label: string }>>>({})
  const [fetchedDynamic, setFetchedDynamic] = useState<Record<string, string[]>>({})

  useEffect(() => {
    const fieldsWithFetch = editableFields.filter(f => f.fetchOptions)
    fieldsWithFetch.forEach(async (field) => {
      const fc = field.fetchOptions!

      if (fc.filterVia) {
        const fv = fc.filterVia
        const [filterRes, mainRes] = await Promise.all([
          fetch(`/api/${fv.table}?limit=25000`),
          fetch(`/api/${fc.table}?limit=25000`),
        ])
        if (!filterRes.ok || !mainRes.ok) return
        const [filterJson, mainJson] = await Promise.all([filterRes.json(), mainRes.json()])
        const allowedIds = new Set(
          (filterJson.data || [])
            .filter((r: Record<string, unknown>) => String(r[fv.filterField]) === fv.filterValue)
            .map((r: Record<string, unknown>) => String(r[fv.joinField]))
        )
        const opts = (mainJson.data || [])
          .filter((r: Record<string, unknown>) => allowedIds.has(String(r[fc.keyField])))
          .map((r: Record<string, unknown>) => ({ value: String(r[fc.keyField]), label: String(r[fc.displayField]) }))
        setFetchedOptions(prev => ({ ...prev, [field.name]: opts }))
        return
      }

      const res = await fetch(`/api/${fc.table}?limit=25000`)
      if (!res.ok) return
      const json = await res.json()
      const opts = (json.data || []).map((row: Record<string, unknown>) => ({
        value: String(row[fc.keyField]),
        label: String(row[fc.displayField]),
      }))
      setFetchedOptions(prev => ({ ...prev, [field.name]: opts }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName])

  useEffect(() => {
    const dynamicFields = editableFields.filter(f => f.dynamicOptions)
    if (dynamicFields.length === 0) return
    fetch('/api/field-options')
      .then(r => r.ok ? r.json() : {})
      .then((all: Record<string, string[]>) => {
        setFetchedDynamic(Object.fromEntries(
          dynamicFields.map(f => [f.name, all[f.dynamicOptions!] || []])
        ))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName])

  const handleChange = (name: string, value: string) => {
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleToggle = (name: string, on: boolean) => {
    setEnabled(prev => ({ ...prev, [name]: on }))
  }

  const changedFields = editableFields.filter(f => enabled[f.name])
  const hasChanges = changedFields.length > 0

  const handleApply = async () => {
    if (!hasChanges || loading) return
    setLoading(true)
    setError('')

    const body: Record<string, string> = {}
    for (const f of changedFields) body[f.name] = form[f.name]

    let ok = 0, fail = 0
    await Promise.all(selectedIds.map(async id => {
      const res = await fetch(`/api/${tableName}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-6xl my-8 animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">
            Alterar selecionados — <span className="text-primary">{schema.label}</span>
          </h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none transition-colors">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center gap-2 text-xs text-outline bg-surface-container-low rounded px-3 py-2 border border-outline-variant font-mono">
            {selectedIds.length} registro{selectedIds.length !== 1 ? 's' : ''} selecionado{selectedIds.length !== 1 ? 's' : ''} — marque a caixa ao lado do campo para habilitá-lo; apenas os campos habilitados serão sobrescritos nos registros selecionados
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editableFields.map(field => (
              <BulkFieldInput
                key={field.name}
                field={field}
                value={form[field.name] ?? ''}
                enabled={!!enabled[field.name]}
                onToggle={(on) => handleToggle(field.name, on)}
                onChange={(v) => handleChange(field.name, v)}
                fetchedOptions={fetchedOptions[field.name]}
                dynamicOptionValues={field.dynamicOptions !== undefined ? (fetchedDynamic[field.name] ?? []) : undefined}
              />
            ))}
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
              disabled={!hasChanges || loading}
              title={!hasChanges ? 'Marque pelo menos um campo para alterar' : undefined}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
            >
              {loading
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Aplicando...</>
                : `Realizar alterações em ${selectedIds.length}`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BulkFieldInput({
  field,
  value,
  enabled,
  onToggle,
  onChange,
  fetchedOptions,
  dynamicOptionValues,
}: {
  field: Field
  value: string
  enabled: boolean
  onToggle: (on: boolean) => void
  onChange: (v: string) => void
  fetchedOptions?: Array<{ value: string; label: string }>
  dynamicOptionValues?: string[]
}) {
  const isWide = ['textarea', 'jsonb'].includes(field.type) || !!field.formFullWidth
  const inputClass = "w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

  let input: React.ReactNode

  if (fetchedOptions) {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} className={inputClass}>
        <option value="">— Selecione —</option>
        {fetchedOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    )
  } else if (dynamicOptionValues !== undefined) {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} className={inputClass}>
        <option value="">— Selecione —</option>
        {dynamicOptionValues.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  } else if (field.type === 'select' && field.options) {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} className={inputClass}>
        <option value="">— Selecione —</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  } else if (field.type === 'boolean') {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} className={inputClass}>
        <option value="">— Selecione —</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    )
  } else if (field.type === 'textarea') {
    input = (
      <textarea value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} rows={3} className={`${inputClass} resize-y`} />
    )
  } else if (field.type === 'jsonb') {
    input = (
      <textarea value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} rows={4} className={`${inputClass} font-mono resize-y`} />
    )
  } else if (field.type === 'number') {
    input = (
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => blockNonNumericKey(e, false)}
        disabled={!enabled}
        className={inputClass}
      />
    )
  } else if (field.type === 'decimal') {
    input = (
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => blockNonNumericKey(e, true)}
        disabled={!enabled}
        className={inputClass}
      />
    )
  } else {
    input = (
      <input type="text" value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} className={inputClass} />
    )
  }

  return (
    <div className={isWide ? 'sm:col-span-2' : ''}>
      <label className="flex items-center gap-2 text-xs font-medium mb-1 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => onToggle(e.target.checked)}
          className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
        />
        <span className={enabled ? 'text-on-surface' : 'text-on-surface-variant'}>{field.label}</span>
      </label>
      {input}
    </div>
  )
}
