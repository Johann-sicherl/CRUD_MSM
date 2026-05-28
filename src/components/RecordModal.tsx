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
  search: string
  groups: Array<{ value: string; label: string }>
  items: CascadeItem[]
  loading: boolean
  selected: Set<string>
}

interface QueueItem {
  qid: string
  data: Record<string, string>
}

const EMPTY_CASCADE: CascadeState = {
  open: false, fieldName: '', groupId: '', search: '', groups: [], items: [], loading: false,
  selected: new Set(),
}

export default function RecordModal({ schema, tableName, record, onClose, onSaved }: Props) {
  const isEdit = !!record
  const isBatch = !!schema.batchInsert && !isEdit
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

  // Batch queue state
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [editingQid, setEditingQid] = useState<string | null>(null)
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchError, setBatchError] = useState('')
  const [queueSelected, setQueueSelected] = useState<Set<string>>(new Set())

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
    setCascade({ open: true, fieldName: field.name, groupId: '', search: '', groups: [], items: [], loading: true, selected: new Set() })
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

  const filteredCascadeItems = cascade.items.filter(i => {
    if (cascade.groupId && i.groupId !== cascade.groupId) return false
    if (cascade.search) {
      const q = cascade.search.toLowerCase()
      return i.value.toLowerCase().includes(q) || i.label.toLowerCase().includes(q)
    }
    return !!cascade.groupId
  })

  const allFilteredSelected =
    filteredCascadeItems.length > 0 &&
    filteredCascadeItems.every(i => cascade.selected.has(i.value))

  const toggleCascadeItem = (value: string) => {
    setCascade(prev => {
      const s = new Set(prev.selected)
      s.has(value) ? s.delete(value) : s.add(value)
      return { ...prev, selected: s }
    })
  }

  const toggleAllFilteredCascade = () => {
    setCascade(prev => {
      const s = new Set(prev.selected)
      if (allFilteredSelected) {
        filteredCascadeItems.forEach(i => s.delete(i.value))
      } else {
        filteredCascadeItems.forEach(i => s.add(i.value))
      }
      return { ...prev, selected: s }
    })
  }

  const addCascadeSelectionsToQueue = () => {
    const newItems: QueueItem[] = Array.from(cascade.selected).map(val => ({
      qid: crypto.randomUUID(),
      data: { ...form, [cascade.fieldName]: val },
    }))
    setQueue(prev => [...prev, ...newItems])
    setCascade(EMPTY_CASCADE)
  }

  const parseFormToBody = (formData: Record<string, string>): Record<string, unknown> => {
    const body: Record<string, unknown> = {}
    for (const f of editableFields) {
      const val = formData[f.name] ?? ''
      if (f.type === 'password' && val === '') continue
      if (f.type === 'boolean') {
        body[f.name] = val === 'true'
      } else if (f.type === 'jsonb') {
        try { body[f.name] = val ? JSON.parse(val) : null } catch { body[f.name] = val }
      } else if (f.type === 'number') {
        body[f.name] = val === '' ? null : parseInt(val)
      } else if (f.type === 'decimal') {
        body[f.name] = val === '' ? null : parseFloat(val)
      } else {
        body[f.name] = val === '' ? null : val
      }
    }
    return body
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (isBatch) {
      if (editingQid) {
        setQueue(prev => prev.map(item =>
          item.qid === editingQid ? { ...item, data: { ...form } } : item
        ))
        setEditingQid(null)
      } else {
        setQueue(prev => [...prev, { qid: crypto.randomUUID(), data: { ...form } }])
      }
      setForm(buildInitial())
      return
    }

    setLoading(true)
    const body = parseFormToBody(form)
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

  const handleCreateAll = async () => {
    setBatchLoading(true)
    setBatchError('')
    const items = [...queue]
    for (let i = 0; i < items.length; i++) {
      const body = parseFormToBody(items[i].data)
      const res = await fetch(`/api/${tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        setQueue(items.slice(i))
        setBatchError(`Erro no item ${i + 1}: ${err.error || 'Falha ao salvar'}`)
        setBatchLoading(false)
        return
      }
    }
    setBatchLoading(false)
    onSaved()
  }

  const handleEditQueueItem = (qid: string) => {
    const item = queue.find(i => i.qid === qid)
    if (!item) return
    setForm({ ...item.data })
    setEditingQid(qid)
    setError('')
  }

  const handleDeleteQueueItem = (qid: string) => {
    setQueue(prev => prev.filter(i => i.qid !== qid))
    if (editingQid === qid) {
      setEditingQid(null)
      setForm(buildInitial())
    }
  }

  const toggleQueueSelect = (qid: string) => {
    setQueueSelected(prev => {
      const s = new Set(prev)
      s.has(qid) ? s.delete(qid) : s.add(qid)
      return s
    })
  }

  const allQueueSelected = queue.length > 0 && queue.every(i => queueSelected.has(i.qid))

  const toggleAllQueueSelect = () => {
    setQueueSelected(allQueueSelected ? new Set() : new Set(queue.map(i => i.qid)))
  }

  const deleteSelectedQueue = () => {
    if (editingQid && queueSelected.has(editingQid)) {
      setEditingQid(null)
      setForm(buildInitial())
    }
    setQueue(prev => prev.filter(i => !queueSelected.has(i.qid)))
    setQueueSelected(new Set())
  }

  const overlayInputClass = "w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-6xl my-8 animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">
            {isEdit ? 'Editar' : 'Novo'} — <span className="text-primary">{schema.label}</span>
          </h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none transition-colors">✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {isEdit && (
            <div className="flex items-center gap-2 text-xs text-outline bg-surface-container-low rounded px-3 py-2 border border-outline-variant font-mono">
              <span>ID:</span>
              <span className="text-on-surface-variant">{String(record!.id)}</span>
            </div>
          )}

          {/* Editing queue item banner */}
          {isBatch && editingQid && (
            <div className="flex items-center gap-2 text-xs bg-primary/10 border border-primary/30 rounded px-3 py-2 text-primary font-mono">
              ✎ Editando item da lista — clique em &quot;Atualizar na Lista&quot; para salvar a alteração
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
            {isBatch && editingQid && (
              <button
                type="button"
                onClick={() => { setEditingQid(null); setForm(buildInitial()) }}
                className="px-4 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
              >
                Descartar Edição
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-on-primary rounded hover:shadow-neon disabled:opacity-60 font-semibold transition-shadow"
            >
              {!isBatch && loading
                ? <><span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" /> Salvando...</>
                : isBatch
                  ? (editingQid ? '✓ Atualizar na Lista' : '+ Adicionar à Lista')
                  : (isEdit ? 'Salvar Alterações' : 'Criar Registro')
              }
            </button>
          </div>
        </form>

        {/* Batch queue */}
        {isBatch && queue.length > 0 && (
          <div className="border-t border-outline-variant px-6 py-4 space-y-3">
            {/* Queue header */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-mono text-outline uppercase tracking-wider">
                Fila de inserção — {queue.length} item{queue.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-2">
                {queueSelected.size > 0 && (
                  <button
                    type="button"
                    onClick={deleteSelectedQueue}
                    className="px-3 py-1.5 text-xs border border-error/40 text-error hover:bg-error-container/20 rounded transition-colors"
                  >
                    Excluir {queueSelected.size} selecionado{queueSelected.size !== 1 ? 's' : ''}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCreateAll}
                  disabled={batchLoading}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-on-primary rounded hover:shadow-neon disabled:opacity-60 font-semibold transition-shadow"
                >
                  {batchLoading
                    ? <><span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" /> Salvando...</>
                    : `Criar Todos (${queue.length})`
                  }
                </button>
              </div>
            </div>

            {batchError && (
              <div className="flex items-center gap-2 bg-error-container/30 text-error text-sm px-4 py-3 rounded border border-error/20">
                ⚠ {batchError}
              </div>
            )}

            {/* Queue table */}
            <div className="border border-outline-variant rounded overflow-hidden">
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-surface-container-highest">
                    <tr className="border-b border-outline-variant">
                      <th className="px-3 py-2.5 w-8 sticky top-0 bg-surface-container-highest">
                        <input
                          type="checkbox"
                          checked={allQueueSelected}
                          onChange={toggleAllQueueSelect}
                          className="accent-yellow-400 cursor-pointer"
                          title="Selecionar todos"
                        />
                      </th>
                      <th className="px-2 py-2.5 w-7 sticky top-0 bg-surface-container-highest text-[10px] font-mono text-outline uppercase tracking-[0.1em]">
                        #
                      </th>
                      {editableFields.map(f => (
                        <th
                          key={f.name}
                          className="px-3 py-2.5 text-left text-[10px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest"
                        >
                          {f.label}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right text-[10px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {queue.map((item, idx) => (
                      <QueueRow
                        key={item.qid}
                        idx={idx}
                        item={item}
                        editableFields={editableFields}
                        fetchedOptions={fetchedOptions}
                        isEditing={editingQid === item.qid}
                        isSelected={queueSelected.has(item.qid)}
                        onToggleSelect={() => toggleQueueSelect(item.qid)}
                        onEdit={() => handleEditQueueItem(item.qid)}
                        onDelete={() => handleDeleteQueueItem(item.qid)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cascade Lookup Overlay */}
      {cascade.open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setCascade(EMPTY_CASCADE)}
        >
          <div
            className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-2xl animate-fade-in flex flex-col"
            style={{ maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant shrink-0">
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
              <div className="flex items-center justify-center gap-3 py-16 text-outline text-sm">
                <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Carregando componentes...
              </div>
            ) : (
              <div className="p-5 flex flex-col gap-4 overflow-hidden flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0">
                  <div>
                    <label className="block text-[10px] font-mono text-outline uppercase tracking-wider mb-1">Grupo</label>
                    <select
                      value={cascade.groupId}
                      onChange={e => setCascade(prev => ({ ...prev, groupId: e.target.value }))}
                      className={overlayInputClass}
                      autoFocus
                    >
                      <option value="">— Todos os grupos —</option>
                      {cascade.groups.map(g => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-outline uppercase tracking-wider mb-1">Buscar por código ou nome</label>
                    <input
                      type="text"
                      value={cascade.search}
                      onChange={e => setCascade(prev => ({ ...prev, search: e.target.value }))}
                      placeholder="Digite para filtrar..."
                      className={overlayInputClass}
                    />
                  </div>
                </div>

                <div className="flex flex-col min-h-0 flex-1">
                  <div className="flex items-center justify-between mb-1 shrink-0">
                    <label className="text-[10px] font-mono text-outline uppercase tracking-wider">
                      Acessórios
                      {(cascade.groupId || cascade.search) && (
                        <span className="ml-1 text-primary">{filteredCascadeItems.length} resultado{filteredCascadeItems.length !== 1 ? 's' : ''}</span>
                      )}
                      {isBatch && cascade.selected.size > 0 && (
                        <span className="ml-2 text-primary font-semibold">{cascade.selected.size} selecionado{cascade.selected.size !== 1 ? 's' : ''}</span>
                      )}
                    </label>
                    {isBatch && filteredCascadeItems.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleAllFilteredCascade}
                        className="flex items-center gap-1.5 text-xs text-outline hover:text-on-surface transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          readOnly
                          className="pointer-events-none accent-yellow-400"
                        />
                        Selecionar todos
                      </button>
                    )}
                  </div>
                  <div className="border border-outline-variant rounded overflow-y-auto flex-1">
                    {!cascade.groupId && !cascade.search ? (
                      <div className="px-3 py-10 text-center text-outline text-xs font-mono">
                        Selecione um grupo ou busque pelo código / nome
                      </div>
                    ) : filteredCascadeItems.length === 0 ? (
                      <div className="px-3 py-10 text-center text-outline text-xs font-mono">
                        Nenhum resultado encontrado
                      </div>
                    ) : (
                      filteredCascadeItems.map(item => (
                        isBatch ? (
                          <div
                            key={item.value}
                            onClick={() => toggleCascadeItem(item.value)}
                            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm transition-colors border-b border-outline-variant/20 last:border-0 ${
                              cascade.selected.has(item.value)
                                ? 'bg-primary/10 text-on-surface'
                                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={cascade.selected.has(item.value)}
                              readOnly
                              className="pointer-events-none shrink-0 accent-yellow-400"
                            />
                            <span className="flex-1 truncate text-left">{item.label}</span>
                            <span className="text-xs font-mono text-outline shrink-0">{item.value}</span>
                          </div>
                        ) : (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => selectCascadeItem(item.value)}
                            className="w-full flex items-center justify-between gap-4 px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors border-b border-outline-variant/20 last:border-0"
                          >
                            <span className="truncate text-left">{item.label}</span>
                            <span className="text-xs font-mono text-outline shrink-0">{item.value}</span>
                          </button>
                        )
                      ))
                    )}
                  </div>
                </div>

                {isBatch && cascade.selected.size > 0 && (
                  <div className="shrink-0 pt-2 border-t border-outline-variant">
                    <button
                      type="button"
                      onClick={addCascadeSelectionsToQueue}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow"
                    >
                      + Adicionar {cascade.selected.size} item{cascade.selected.size !== 1 ? 's' : ''} à Lista
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function QueueRow({
  idx,
  item,
  editableFields,
  fetchedOptions,
  isEditing,
  isSelected,
  onToggleSelect,
  onEdit,
  onDelete,
}: {
  idx: number
  item: QueueItem
  editableFields: Field[]
  fetchedOptions: Record<string, Array<{ value: string; label: string }>>
  isEditing: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const rowClass = isEditing
    ? 'bg-primary/10'
    : isSelected
      ? 'bg-surface-container-highest'
      : 'hover:bg-surface-container-high'

  return (
    <tr className={`transition-colors ${rowClass}`}>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="accent-yellow-400 cursor-pointer"
        />
      </td>
      <td className="px-2 py-2 text-center text-outline font-mono">{idx + 1}</td>
      {editableFields.map(f => {
        const val = item.data[f.name]
        let display = ''
        if (val !== undefined && val !== '') {
          display = val
          const opts = fetchedOptions[f.name]
          if (opts) display = opts.find(o => o.value === val)?.label ?? val
        }
        return (
          <td key={f.name} className="px-3 py-2 text-on-surface-variant whitespace-nowrap">
            {display
              ? <span className="block max-w-[200px] truncate" title={display}>{display}</span>
              : <span className="text-outline/40">—</span>
            }
          </td>
        )
      })}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={onEdit}
          className="text-outline hover:text-primary text-xs font-medium mr-3 transition-colors"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-outline hover:text-error text-xs font-medium transition-colors"
        >
          ✕
        </button>
      </td>
    </tr>
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
