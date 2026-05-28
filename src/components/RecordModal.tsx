'use client'

import { useState, useEffect } from 'react'
import { Field, TableSchema } from '@/lib/schema'

interface Props {
  schema: TableSchema
  tableName: string
  record?: Record<string, unknown> | null
  onClose: () => void
  onSaved: () => void
}

interface CascadeItem {
  value: string
  label: string
  groupId: string
}

interface CascadeState {
  open: boolean
  fieldName: string
  groupId: string
  groups: Array<{ value: string; label: string }>
  items: CascadeItem[]
  loading: boolean
}

const EMPTY_CASCADE: CascadeState = {
  open: false, fieldName: '', groupId: '', groups: [], items: [], loading: false,
}

export default function RecordModal({ schema, tableName, record, onClose, onSaved }: Props) {
  const isEdit = !!record
  const editableFields = schema.fields.filter(f => !f.isPk && !f.isReadonly && !f.hideInForm)

  const buildInitial = () => {
    const init: Record<string, string> = {}
    for (const f of editableFields) {
      if (isEdit && record) {
        const v = record[f.name]
        if (v === null || v === undefined) {
          init[f.name] = ''
        } else if (f.type === 'jsonb' && typeof v === 'object') {
          init[f.name] = JSON.stringify(v, null, 2)
        } else if (f.type === 'timestamp') {
          init[f.name] = String(v).slice(0, 16)
        } else if (f.type === 'password') {
          init[f.name] = ''
        } else {
          init[f.name] = String(v)
        }
      } else {
        init[f.name] = f.defaultValue !== undefined ? String(f.defaultValue) : ''
      }
    }
    return init
  }

  const [form, setForm] = useState<Record<string, string>>(buildInitial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchedOptions, setFetchedOptions] = useState<Record<string, Array<{ value: string; label: string }>>>({})
  const [cascade, setCascade] = useState<CascadeState>(EMPTY_CASCADE)

  useEffect(() => {
    setForm(buildInitial())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record])

  useEffect(() => {
    const fieldsWithFetch = schema.fields.filter(f => f.fetchOptions)
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
          .map((r: Record<string, unknown>) => ({
            value: String(r[fc.keyField]),
            label: String(r[fc.displayField]),
          }))
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

  const handleChange = (name: string, value: string) => {
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const openCascade = async (field: Field) => {
    const cfg = field.cascadeLookup!
    setCascade({ open: true, fieldName: field.name, groupId: '', groups: [], items: [], loading: true })
    const [groupRes, itemRes] = await Promise.all([
      fetch(`/api/${cfg.groupTable}?limit=25000`),
      fetch(`/api/${cfg.itemTable}?limit=25000`),
    ])
    if (!groupRes.ok || !itemRes.ok) { setCascade(EMPTY_CASCADE); return }
    const [groupJson, itemJson] = await Promise.all([groupRes.json(), itemRes.json()])
    const groups = (groupJson.data || []).map((r: Record<string, unknown>) => ({
      value: String(r[cfg.groupKeyField]),
      label: String(r[cfg.groupDisplayField]),
    }))
    const items: CascadeItem[] = (itemJson.data || []).map((r: Record<string, unknown>) => ({
      value: String(r[cfg.itemKeyField]),
      label: String(r[cfg.itemDisplayField]),
      groupId: String(r[cfg.itemGroupField]),
    }))
    setCascade(prev => ({ ...prev, loading: false, groups, items }))
  }

  const selectCascadeItem = (value: string) => {
    handleChange(cascade.fieldName, value)
    setCascade(EMPTY_CASCADE)
  }

  const filteredCascadeItems = cascade.items.filter(i => i.groupId === cascade.groupId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const body: Record<string, unknown> = {}
    for (const f of editableFields) {
      const val = form[f.name]
      if (f.type === 'boolean') {
        body[f.name] = val === 'true'
      } else if (f.type === 'jsonb') {
        try { body[f.name] = val ? JSON.parse(val) : null } catch { body[f.name] = val }
      } else if (f.type === 'number') {
        body[f.name] = val === '' ? null : parseInt(val)
      } else if (f.type === 'decimal') {
        body[f.name] = val === '' ? null : parseFloat(val)
      } else if (f.type === 'password' && val === '') {
        continue
      } else {
        body[f.name] = val === '' ? null : val
      }
    }

    const url = isEdit ? `/api/${tableName}/${record!.id}` : `/api/${tableName}`
    const method = isEdit ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setLoading(false)
    if (!res.ok) {
      const err = await res.json()
      setError(err.error || 'Erro ao salvar')
      return
    }
    onSaved()
  }

  const overlayInputClass = "w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-2xl my-8 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">
            {isEdit ? 'Editar' : 'Novo'} — <span className="text-primary">{schema.label}</span>
          </h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none transition-colors">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {isEdit && (
            <div className="flex items-center gap-2 text-xs text-outline bg-surface-container-low rounded px-3 py-2 border border-outline-variant font-mono">
              <span>ID:</span>
              <span className="text-on-surface-variant">{String(record!.id)}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editableFields.map(field => (
              <FieldInput
                key={field.name}
                field={field}
                value={form[field.name] ?? ''}
                onChange={(v) => handleChange(field.name, v)}
                fetchedOptions={fetchedOptions[field.name]}
                onCascadeOpen={field.cascadeLookup ? () => openCascade(field) : undefined}
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
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-on-primary rounded hover:shadow-neon disabled:opacity-60 font-semibold transition-shadow"
            >
              {loading
                ? <><span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" /> Salvando...</>
                : isEdit ? 'Salvar Alterações' : 'Criar Registro'
              }
            </button>
          </div>
        </form>
      </div>

      {/* Cascade Lookup Overlay */}
      {cascade.open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setCascade(EMPTY_CASCADE)}
        >
          <div
            className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
              <span className="text-sm font-semibold text-on-surface">Buscar Acessório por Grupo</span>
              <button
                type="button"
                onClick={() => setCascade(EMPTY_CASCADE)}
                className="text-outline hover:text-on-surface transition-colors text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {cascade.loading ? (
              <div className="flex items-center justify-center gap-3 py-12 text-outline text-sm">
                <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Carregando componentes...
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-[10px] font-mono text-outline uppercase tracking-wider mb-1">Grupo</label>
                  <select
                    value={cascade.groupId}
                    onChange={e => setCascade(prev => ({ ...prev, groupId: e.target.value }))}
                    className={overlayInputClass}
                    autoFocus
                  >
                    <option value="">— Selecione um grupo —</option>
                    {cascade.groups.map(g => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-outline uppercase tracking-wider mb-1">
                    Acessório
                    {cascade.groupId && (
                      <span className="ml-1 text-primary">{filteredCascadeItems.length} item{filteredCascadeItems.length !== 1 ? 's' : ''}</span>
                    )}
                  </label>
                  <div className="border border-outline-variant rounded overflow-hidden max-h-72 overflow-y-auto">
                    {!cascade.groupId ? (
                      <div className="px-3 py-8 text-center text-outline text-xs font-mono">
                        Selecione um grupo acima
                      </div>
                    ) : filteredCascadeItems.length === 0 ? (
                      <div className="px-3 py-8 text-center text-outline text-xs font-mono">
                        Nenhum acessório neste grupo
                      </div>
                    ) : (
                      filteredCascadeItems.map(item => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => selectCascadeItem(item.value)}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors border-b border-outline-variant/20 last:border-0"
                        >
                          <span className="truncate text-left">{item.label}</span>
                          <span className="text-xs font-mono text-outline shrink-0">{item.value}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  fetchedOptions,
  onCascadeOpen,
}: {
  field: Field
  value: string
  onChange: (v: string) => void
  fetchedOptions?: Array<{ value: string; label: string }>
  onCascadeOpen?: () => void
}) {
  const isWide = ['textarea', 'jsonb'].includes(field.type) || !!field.formFullWidth
  const inputClass = "w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"

  let input: React.ReactNode

  if (fetchedOptions) {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} required={!field.nullable} className={inputClass}>
        <option value="">— Selecione —</option>
        {fetchedOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  } else if (field.type === 'select' && field.options) {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} required={!field.nullable} className={inputClass}>
        {field.nullable && <option value="">— Selecione —</option>}
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  } else if (field.type === 'boolean') {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} className={inputClass}>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    )
  } else if (field.type === 'textarea') {
    input = (
      <textarea value={value} onChange={e => onChange(e.target.value)} required={!field.nullable} placeholder={field.placeholder} rows={3} className={`${inputClass} resize-y`} />
    )
  } else if (field.type === 'jsonb') {
    input = (
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder='{"chave": "valor"}' rows={4} className={`${inputClass} font-mono resize-y`} />
    )
  } else if (field.type === 'password') {
    input = (
      <input type="password" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || 'Senha'} className={inputClass} />
    )
  } else if (field.type === 'number') {
    input = (
      <input type="number" value={value} onChange={e => onChange(e.target.value)} required={!field.nullable} placeholder={field.placeholder} className={inputClass} />
    )
  } else if (field.type === 'decimal') {
    input = (
      <input type="number" step="0.0001" value={value} onChange={e => onChange(e.target.value)} required={!field.nullable} placeholder={field.placeholder || '0.0000'} className={inputClass} />
    )
  } else if (field.type === 'uuid') {
    input = (
      <input type="text" value={value} onChange={e => onChange(e.target.value)} required={!field.nullable} placeholder="UUID do registro relacionado" className={`${inputClass} font-mono`} />
    )
  } else if (onCascadeOpen) {
    input = (
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          required={!field.nullable}
          placeholder={field.placeholder}
          className={`${inputClass} pr-9`}
        />
        <button
          type="button"
          onClick={onCascadeOpen}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-outline hover:text-primary transition-colors leading-none"
          title="Buscar por grupo e acessório"
        >
          🔍
        </button>
      </div>
    )
  } else {
    input = (
      <input type="text" value={value} onChange={e => onChange(e.target.value)} required={!field.nullable} placeholder={field.placeholder} className={inputClass} />
    )
  }

  return (
    <div className={isWide ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-on-surface-variant mb-1">
        {field.label}
        {!field.nullable && <span className="text-primary ml-1">*</span>}
      </label>
      {input}
    </div>
  )
}
