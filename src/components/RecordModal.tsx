'use client'

import { useState, useEffect, useMemo } from 'react'
import { Field, TableSchema, shouldUppercaseField } from '@/lib/schema'
import { bestGhostSuggestion } from '@/lib/textSimilarity'

interface Props {
  schema: TableSchema
  tableName: string
  record?: Record<string, unknown> | null
  prefill?: Record<string, string> | null
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

export default function RecordModal({ schema, tableName, record, prefill, onClose, onSaved }: Props) {
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
        // Prefill from imported data takes priority over defaults
        if (prefill && prefill[f.name] !== undefined) {
          init[f.name] = prefill[f.name]
        } else if (f.defaultValue !== undefined) {
          init[f.name] = String(f.defaultValue)
        } else if (f.type === 'select' && !f.nullable && f.options?.length) {
          init[f.name] = String(f.options[0])
        } else {
          init[f.name] = ''
        }
      }
    }
    return init
  }

  const [form, setForm] = useState<Record<string, string>>(buildInitial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchedOptions, setFetchedOptions] = useState<Record<string, Array<{ value: string; label: string }>>>({})
  const [fetchedDynamic, setFetchedDynamic] = useState<Record<string, string[]>>({})
  const [similarCandidates, setSimilarCandidates] = useState<Record<string, string[]>>({})
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

  // Padronização de nomenclatura ("+ Novo Registro" apenas — editar um
  // registro existente não precisa se comparar consigo mesmo): busca todos
  // os valores já cadastrados nas colunas marcadas com similarTextSuggest
  // (ex.: accessories.name) uma única vez, ao abrir o formulário — o
  // ranking em si (findSimilarTexts) roda no navegador a cada tecla, sem
  // round-trip nenhum, pra ficar instantâneo.
  useEffect(() => {
    if (isEdit) return
    const fields = editableFields.filter(f => f.similarTextSuggest)
    if (fields.length === 0) return
    fetch(`/api/${tableName}?limit=25000`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json) return
        const rows = (json.data || []) as Record<string, unknown>[]
        const result: Record<string, string[]> = {}
        for (const f of fields) {
          const seen = new Set<string>()
          const values: string[] = []
          for (const row of rows) {
            const v = row[f.name]
            if (typeof v === 'string' && v.trim() && !seen.has(v)) { seen.add(v); values.push(v) }
          }
          result[f.name] = values
        }
        setSimilarCandidates(result)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, isEdit])

  const addDynamicOption = async (fieldName: string, key: string, value: string) => {
    const res = await fetch('/api/field-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (!res.ok) return
    const updated: string[] = await res.json()
    setFetchedDynamic(prev => ({ ...prev, [fieldName]: updated }))
    handleChange(fieldName, value)
  }

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

    // Extra synthetic group sourced from a different table entirely (e.g.
    // "EQUIPAMENTOS" pulling from standard_equipment_items instead of
    // accessories), filtered by whatever value the form's own referenced
    // field currently holds (e.g. the "Equipamento" picked at the top of
    // this same record) — evaluated once, at the moment this picker opens.
    if (cfg.extraGroup) {
      const eg = cfg.extraGroup
      const extraGroupId = `__extra__${eg.label}`
      groups.unshift({ value: extraGroupId, label: eg.label }) // pinned first — never buried at the bottom of a long group list
      const filterValue = form[eg.filterFromForm] ?? ''
      if (filterValue) {
        try {
          const extraRes = await fetch(`/api/${eg.table}?limit=25000`)
          if (extraRes.ok) {
            const extraJson = await extraRes.json()
            for (const r of (extraJson.data || []) as Record<string, unknown>[]) {
              if (String(r[eg.filterField] ?? '') === filterValue) {
                items.push({ value: String(r[eg.itemKeyField]), label: String(r[eg.itemKeyField]), groupId: extraGroupId })
              }
            }
          }
        } catch { /* extra group simply stays empty if this fetch fails */ }
      }
    }

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

  const overlayInputClass = "w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-[16.8px] text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-6xl my-8 animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h2 className="text-[19.2px] font-semibold text-on-surface">
            {isEdit ? 'Editar' : 'Novo'} — <span className="text-primary">{schema.label}</span>
          </h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-2xl leading-none transition-colors">✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {isEdit && (
            <div className="flex items-center gap-2 text-[14.4px] text-outline bg-surface-container-low rounded px-3 py-2 border border-outline-variant font-mono">
              <span>ID:</span>
              <span className="text-on-surface-variant">{String(record!.id)}</span>
            </div>
          )}

          {/* Editing queue item banner */}
          {isBatch && editingQid && (
            <div className="flex items-center gap-2 text-[14.4px] bg-primary/10 border border-primary/30 rounded px-3 py-2 text-primary font-mono">
              ✎ Editando item da lista — clique em &quot;Atualizar na Lista&quot; para salvar a alteração
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editableFields.map(field => {
              const forceRequired = field.requiredWhen
                ? field.requiredWhen.values.map(String).includes(String(form[field.requiredWhen.field] ?? ''))
                : false
              return (
                <FieldInput
                  key={field.name}
                  field={field}
                  value={form[field.name] ?? ''}
                  onChange={(v) => handleChange(field.name, shouldUppercaseField(field) ? v.toUpperCase() : v)}
                  fetchedOptions={fetchedOptions[field.name]}
                  dynamicOptionValues={field.dynamicOptions !== undefined ? (fetchedDynamic[field.name] ?? []) : undefined}
                  onAddOption={field.dynamicOptions ? (v) => addDynamicOption(field.name, field.dynamicOptions!, v) : undefined}
                  onCascadeOpen={field.cascadeLookup ? () => openCascade(field) : undefined}
                  forceRequired={forceRequired}
                  similarCandidates={field.similarTextSuggest ? similarCandidates[field.name] : undefined}
                />
              )
            })}
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-error-container/30 text-error text-[16.8px] px-4 py-3 rounded border border-error/20">
              ⚠ {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-outline-variant">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[16.8px] border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
            >
              Cancelar
            </button>
            {isBatch && editingQid && (
              <button
                type="button"
                onClick={() => { setEditingQid(null); setForm(buildInitial()) }}
                className="px-4 py-2 text-[16.8px] border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
              >
                Descartar Edição
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 text-[16.8px] bg-primary text-on-primary rounded hover:shadow-neon disabled:opacity-60 font-semibold transition-shadow"
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
              <span className="text-[12px] font-mono text-outline uppercase tracking-wider">
                Fila de inserção — {queue.length} item{queue.length !== 1 ? 's' : ''}
              </span>
              {queueSelected.size > 0 && (
                <button
                  type="button"
                  onClick={deleteSelectedQueue}
                  className="px-3 py-1.5 text-[14.4px] border border-error/40 text-error hover:bg-error-container/20 rounded transition-colors"
                >
                  Excluir {queueSelected.size} selecionado{queueSelected.size !== 1 ? 's' : ''}
                </button>
              )}
            </div>

            {batchError && (
              <div className="flex items-center gap-2 bg-error-container/30 text-error text-[16.8px] px-4 py-3 rounded border border-error/20">
                ⚠ {batchError}
              </div>
            )}

            {/* Queue table */}
            <div className="border border-outline-variant rounded overflow-hidden">
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-[14.4px] border-collapse">
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
                      <th className="px-2 py-2.5 w-7 sticky top-0 bg-surface-container-highest text-[12px] font-mono text-outline uppercase tracking-[0.1em]">
                        #
                      </th>
                      {editableFields.map(f => (
                        <th
                          key={f.name}
                          className="px-3 py-2.5 text-left text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest"
                        >
                          {f.label}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">
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

            {/* Save button below the table */}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleCreateAll}
                disabled={batchLoading}
                className="flex items-center gap-2 px-6 py-2.5 text-[16.8px] bg-primary text-on-primary rounded hover:shadow-neon disabled:opacity-60 font-semibold transition-shadow"
              >
                {batchLoading
                  ? <><span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" /> Salvando...</>
                  : 'Salvar'
                }
              </button>
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
              <span className="text-[16.8px] font-semibold text-on-surface">Buscar Acessório por Grupo</span>
              <button
                type="button"
                onClick={() => setCascade(EMPTY_CASCADE)}
                className="text-outline hover:text-on-surface transition-colors text-2xl leading-none"
              >
                ✕
              </button>
            </div>

            {cascade.loading ? (
              <div className="flex items-center justify-center gap-3 py-16 text-outline text-[16.8px]">
                <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Carregando componentes...
              </div>
            ) : (
              <div className="p-5 flex flex-col gap-4 overflow-hidden flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0">
                  <div>
                    <label className="block text-[12px] font-mono text-outline uppercase tracking-wider mb-1">Grupo</label>
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
                    <label className="block text-[12px] font-mono text-outline uppercase tracking-wider mb-1">Buscar por código ou nome</label>
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
                    <label className="text-[12px] font-mono text-outline uppercase tracking-wider">
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
                        className="flex items-center gap-1.5 text-[14.4px] text-outline hover:text-on-surface transition-colors"
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
                      <div className="px-3 py-10 text-center text-outline text-[14.4px] font-mono">
                        Selecione um grupo ou busque pelo código / nome
                      </div>
                    ) : filteredCascadeItems.length === 0 ? (
                      <div className="px-3 py-10 text-center text-outline text-[14.4px] font-mono">
                        Nenhum resultado encontrado
                      </div>
                    ) : (
                      filteredCascadeItems.map(item => (
                        isBatch ? (
                          <div
                            key={item.value}
                            onClick={() => toggleCascadeItem(item.value)}
                            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer text-[16.8px] transition-colors border-b border-outline-variant/20 last:border-0 ${
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
                            <span className="text-[14.4px] font-mono text-outline shrink-0">{item.value}</span>
                          </div>
                        ) : (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => selectCascadeItem(item.value)}
                            className="w-full flex items-center justify-between gap-4 px-4 py-2.5 text-[16.8px] text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors border-b border-outline-variant/20 last:border-0"
                          >
                            <span className="truncate text-left">{item.label}</span>
                            <span className="text-[14.4px] font-mono text-outline shrink-0">{item.value}</span>
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
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-on-primary rounded text-[16.8px] font-semibold hover:shadow-neon transition-shadow"
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
          className="text-outline hover:text-primary text-[14.4px] font-medium mr-3 transition-colors"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-outline hover:text-error text-[14.4px] font-medium transition-colors"
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
  dynamicOptionValues,
  onAddOption,
  onCascadeOpen,
  forceRequired,
  similarCandidates,
}: {
  field: Field
  value: string
  onChange: (v: string) => void
  fetchedOptions?: Array<{ value: string; label: string }>
  dynamicOptionValues?: string[]
  onAddOption?: (value: string) => Promise<void>
  onCascadeOpen?: () => void
  forceRequired?: boolean
  similarCandidates?: string[]
}) {
  const [addingOpt, setAddingOpt] = useState(false)
  const [newOptInput, setNewOptInput] = useState('')
  const [addingLoading, setAddingLoading] = useState(false)

  // Sugestão fantasma (autocomplete) — só quando o que já foi digitado é o
  // começo de um nome parecido já cadastrado. "restante" é o que aparece em
  // cinza, colado depois do texto digitado, na mesma linha.
  const ghost = useMemo(() => {
    if (!similarCandidates || value.trim().length < 3) return null
    return bestGhostSuggestion(value, similarCandidates)
  }, [similarCandidates, value])
  const ghostSuffix = ghost ? ghost.slice(value.length) : ''

  const acceptGhost = () => { if (ghost) onChange(ghost) }

  const commitNewOpt = async () => {
    const v = newOptInput.trim().toUpperCase()
    if (!v || !onAddOption) return
    setAddingLoading(true)
    await onAddOption(v)
    setAddingLoading(false)
    setAddingOpt(false)
    setNewOptInput('')
  }

  const isWide = ['textarea', 'jsonb'].includes(field.type) || !!field.formFullWidth
  const inputClass = "w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-[16.8px] text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
  // requiredWhen (ex.: Cor/Material/Dimensão para MESAS DE ROLETES e
  // EXTENSOES DE TUNEL, Tam. Monitor para MONITORES) torna o campo
  // obrigatório mesmo sendo nullable no banco — depende do grupo escolhido.
  const isRequired = !field.nullable || !!forceRequired
  // Campos opcionais (nullable) parados em "— Selecione —" ficam com texto e
  // borda levemente avermelhados — só um aviso visual de que esse campo
  // segue vazio, nunca bloqueia o envio (nulo é um valor válido para eles).
  // Campos tornados obrigatórios via requiredWhen não entram nesse aviso —
  // eles bloqueiam o envio como qualquer outro campo obrigatório.
  const isEmptyNullable = !isRequired && !value
  const selectClass = isEmptyNullable
    ? "w-full bg-surface-container-low border border-error/50 rounded px-3 py-2 text-[16.8px] text-error/80 placeholder:text-outline focus:outline-none focus:border-error focus:ring-1 focus:ring-error/30 transition-colors"
    : inputClass

  let input: React.ReactNode

  if (fetchedOptions) {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} required={isRequired} className={selectClass}>
        <option value="">— Selecione —</option>
        {fetchedOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  } else if (dynamicOptionValues !== undefined) {
    input = (
      <div>
        <div className="flex gap-1.5">
          <select value={value} onChange={e => onChange(e.target.value)} className={`${selectClass} flex-1`} required={isRequired}>
            {field.nullable && <option value="">— Selecione —</option>}
            {dynamicOptionValues.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <button
            type="button"
            onClick={() => { setAddingOpt(o => !o); setNewOptInput('') }}
            title="Adicionar nova opção à lista"
            className={`shrink-0 px-2.5 border rounded text-[16.8px] transition-colors ${
              addingOpt
                ? 'border-primary text-primary bg-primary/10'
                : 'border-outline-variant text-outline hover:border-primary hover:text-primary bg-surface-container-low'
            }`}
          >
            +
          </button>
        </div>
        {addingOpt && (
          <div className="flex gap-1.5 mt-1.5">
            <input
              type="text"
              value={newOptInput}
              onChange={e => setNewOptInput(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitNewOpt() }
                if (e.key === 'Escape') { setAddingOpt(false); setNewOptInput('') }
              }}
              placeholder="NOVA OPÇÃO..."
              autoFocus
              className="flex-1 bg-surface-container-low border border-primary/50 rounded px-2 py-1.5 text-[14.4px] font-mono text-on-surface uppercase placeholder:text-outline/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
            <button
              type="button"
              disabled={addingLoading || !newOptInput.trim()}
              onClick={commitNewOpt}
              className="px-2.5 py-1.5 bg-primary text-on-primary rounded text-[14.4px] font-semibold disabled:opacity-40 hover:shadow-neon transition-all"
            >
              {addingLoading ? '…' : '✓'}
            </button>
            <button
              type="button"
              onClick={() => { setAddingOpt(false); setNewOptInput('') }}
              className="px-2.5 py-1.5 border border-outline-variant rounded text-[14.4px] text-outline hover:border-error hover:text-error transition-colors"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    )
  } else if (field.type === 'select' && field.options) {
    input = (
      <select value={value} onChange={e => onChange(e.target.value)} required={isRequired} className={selectClass}>
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
      <textarea value={value} onChange={e => onChange(e.target.value)} required={isRequired} placeholder={field.placeholder} rows={3} className={`${inputClass} resize-y`} />
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
      <input type="number" value={value} onChange={e => onChange(e.target.value)} required={isRequired} placeholder={field.placeholder} className={inputClass} />
    )
  } else if (field.type === 'decimal') {
    input = (
      <input type="number" step="0.0001" value={value} onChange={e => onChange(e.target.value)} required={isRequired} placeholder={field.placeholder || '0.0000'} className={inputClass} />
    )
  } else if (field.type === 'uuid') {
    input = (
      <input type="text" value={value} onChange={e => onChange(e.target.value)} required={isRequired} placeholder="UUID do registro relacionado" className={`${inputClass} font-mono`} />
    )
  } else if (onCascadeOpen) {
    input = (
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          required={isRequired}
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
  } else if (similarCandidates) {
    // Sugestão fantasma: um "espaçador" invisível com o mesmo texto já
    // digitado reserva exatamente a largura certa (funciona com qualquer
    // fonte, não precisa ser monoespaçada), e o restante do nome parecido
    // aparece em cinza logo em seguida, colado na mesma linha — o input em
    // si fica com fundo transparente pra esse texto por trás aparecer no
    // espaço depois do que já foi digitado. Tab ou → (com o cursor no fim)
    // aceita a sugestão.
    input = (
      // O fundo/borda/anel de foco moram no wrapper (via focus-within), não
      // no <input> — assim o <input> pode ficar com bg-transparent sem
      // disputar com bg-surface-container-low pela mesma propriedade CSS.
      <div className="relative w-full bg-surface-container-low border border-outline-variant rounded focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30 transition-colors">
        <div
          aria-hidden
          className="absolute inset-0 flex items-center px-3 text-[16.8px] pointer-events-none overflow-hidden whitespace-pre"
        >
          <span className="invisible">{value}</span>
          <span className="text-on-surface-variant/40">{ghostSuffix}</span>
        </div>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (!ghostSuffix) return
            const atEnd = e.currentTarget.selectionStart === value.length && e.currentTarget.selectionEnd === value.length
            if (e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) {
              e.preventDefault()
              acceptGhost()
            }
          }}
          required={isRequired}
          placeholder={field.placeholder}
          className="relative w-full bg-transparent px-3 py-2 text-[16.8px] text-on-surface placeholder:text-outline focus:outline-none"
        />
      </div>
    )
  } else {
    input = (
      <input type="text" value={value} onChange={e => onChange(e.target.value)} required={isRequired} placeholder={field.placeholder} className={inputClass} />
    )
  }

  return (
    <div className={isWide ? 'sm:col-span-2' : ''}>
      <label className="block text-[14.4px] font-medium text-on-surface-variant mb-1">
        {field.label}
        {isRequired && <span className="text-primary ml-1">*</span>}
      </label>
      {input}
    </div>
  )
}

