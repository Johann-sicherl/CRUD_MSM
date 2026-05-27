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

export default function RecordModal({ schema, tableName, record, onClose, onSaved }: Props) {
  const isEdit = !!record
  const editableFields = schema.fields.filter(f => !f.isPk && !f.isReadonly)

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

  useEffect(() => {
    setForm(buildInitial())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record])

  const handleChange = (name: string, value: string) => {
    setForm(prev => ({ ...prev, [name]: value }))
  }

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
        // skip empty password on edit
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-slate-800">
            {isEdit ? 'Editar' : 'Novo'} — {schema.label}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {isEdit && (
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded px-3 py-2">
              <span className="font-medium">ID:</span>
              <span className="font-mono">{String(record!.id)}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editableFields.map(field => (
              <FieldInput
                key={field.name}
                field={field}
                value={form[field.name] ?? ''}
                onChange={(v) => handleChange(field.name, v)}
              />
            ))}
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border rounded-lg hover:bg-slate-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium"
            >
              {loading ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Criar Registro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const isWide = ['textarea', 'jsonb'].includes(field.type)

  return (
    <div className={isWide ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {field.label}
        {!field.nullable && <span className="text-red-500 ml-1">*</span>}
      </label>

      {field.type === 'select' && field.options ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          required={!field.nullable}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {field.nullable && <option value="">— Selecione —</option>}
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

      ) : field.type === 'boolean' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>

      ) : field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          required={!field.nullable}
          placeholder={field.placeholder}
          rows={3}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
        />

      ) : field.type === 'jsonb' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder='{"chave": "valor"}'
          rows={4}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
        />

      ) : field.type === 'password' ? (
        <input
          type="password"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder || 'Senha'}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

      ) : field.type === 'number' ? (
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          required={!field.nullable}
          placeholder={field.placeholder}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

      ) : field.type === 'decimal' ? (
        <input
          type="number"
          step="0.0001"
          value={value}
          onChange={e => onChange(e.target.value)}
          required={!field.nullable}
          placeholder={field.placeholder || '0.0000'}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

      ) : field.type === 'uuid' ? (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          required={!field.nullable}
          placeholder="UUID do registro relacionado"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          required={!field.nullable}
          placeholder={field.placeholder}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}
    </div>
  )
}
