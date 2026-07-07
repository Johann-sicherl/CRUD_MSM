'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { TableSchema, Field } from '@/lib/schema'

interface Props {
  schema: TableSchema
  tableName: string
  initialRows: Record<string, string>[]
  onClose: () => void
  onDone: (saved: number) => void
}

type Phase = 'validating' | 'review' | 'importing' | 'done'

interface LookupEntry {
  byKeyOrName: Map<string, string>  // lowercase key or name → resolved key
  byKey: Map<string, string>        // key → display name (for reverse lookup)
}
type LookupCache = Record<string, LookupEntry>

function lookupFields(schema: TableSchema): Field[] {
  return schema.fields.filter(f => f.validateExistsIn?.displayField && f.fetchOptions)
}

export default function ImportReviewModal({ schema, tableName, initialRows, onClose, onDone }: Props) {
  const editableCols  = schema.fields.filter(f => !f.isPk && !f.isReadonly && !f.hideInForm)
  const lFields       = lookupFields(schema)
  const lFieldNames   = new Set(lFields.map(f => f.name))
  const uniqueFields  = schema.fields.filter(f => f.unique && !f.isPk)
  const dFields       = schema.fields.filter(f => f.dynamicOptions)

  // rows: values to submit — lookup fields hold the resolved KEY (ID)
  const [rows,     setRows]     = useState<Record<string, string>[]>(initialRows)
  // display: what's shown in lookup inputs (the human-readable name)
  const [display,  setDisplay]  = useState<Record<number, Record<string, string>>>({})
  // warnings: unresolved lookup fields → prevent import
  const [warnings, setWarnings] = useState<Record<number, Record<string, string>>>({})
  const [phase,    setPhase]    = useState<Phase>('validating')
  const [done,     setDone]     = useState(0)
  const [total,    setTotal]    = useState(0)
  const [errLines, setErrLines] = useState<string[]>([])

  const cacheRef          = useRef<LookupCache>({})
  const uniqueExistingRef = useRef<Record<string, Set<string>>>({})
  // field name → Map<lowercase option, canonical option> from field-options.json
  const dynamicAllowedRef = useRef<Record<string, Map<string, string>>>({})

  // On mount: fetch lookup tables, build cache, pre-validate unique fields against DB
  useEffect(() => {
    if (lFields.length === 0 && uniqueFields.length === 0 && dFields.length === 0) { setPhase('review'); return }

    ;(async () => {
      const cache: LookupCache = {}

      await Promise.all([
        // Build lookup caches for FK reference fields
        ...lFields.map(async f => {
          const fo = f.fetchOptions!
          const vi = f.validateExistsIn!
          try {
            const res = await fetch(`/api/${fo.table}?limit=25000`)
            if (!res.ok) return
            const json = await res.json()
            const byKeyOrName = new Map<string, string>()
            const byKey       = new Map<string, string>()
            for (const row of (json.data || [])) {
              const key  = String(row[vi.field]        ?? '')
              const name = String(row[vi.displayField!] ?? '')
              if (!key) continue
              byKeyOrName.set(key.toLowerCase(), key)
              if (name) {
                byKeyOrName.set(name.toLowerCase(), key)
                byKey.set(key, name)
              }
            }
            cache[f.name] = { byKeyOrName, byKey }
          } catch { /* skip if API unreachable */ }
        }),
        // Fetch existing records to pre-check unique fields
        ...(uniqueFields.length > 0 ? [(async () => {
          try {
            const res = await fetch(`/api/${tableName}?limit=25000`)
            if (!res.ok) return
            const json = await res.json()
            const data: Record<string, unknown>[] = json.data || []
            for (const f of uniqueFields) {
              const existing = new Set<string>()
              for (const row of data) {
                const v = String(row[f.name] ?? '').trim()
                if (v) existing.add(v.toLowerCase())
              }
              uniqueExistingRef.current[f.name] = existing
            }
          } catch { /* skip */ }
        })()] : []),
        // Fetch standardized options (field-options.json) for dynamicOptions fields
        ...(dFields.length > 0 ? [(async () => {
          try {
            const res = await fetch('/api/field-options')
            if (!res.ok) return
            const all: Record<string, string[]> = await res.json()
            for (const f of dFields) {
              const map = new Map<string, string>()
              for (const opt of (all[f.dynamicOptions!] || [])) {
                map.set(opt.toLowerCase(), opt)
              }
              dynamicAllowedRef.current[f.name] = map
            }
          } catch { /* skip */ }
        })()] : []),
      ])

      cacheRef.current = cache

      const newRows:     Record<string, string>[]              = initialRows.map(r => ({ ...r }))
      const newDisplay:  Record<number, Record<string, string>> = {}
      const newWarnings: Record<number, Record<string, string>> = {}

      for (let ri = 0; ri < newRows.length; ri++) {
        for (const f of lFields) {
          const entry = cache[f.name]
          const raw   = (newRows[ri][f.name] ?? '').trim()
          if (!raw) continue
          // Left at the field's default (e.g. 0 for "sem alerta") — nothing to resolve
          if (f.defaultValue !== undefined && raw === String(f.defaultValue)) continue

          if (entry) {
            const resolvedKey = entry.byKeyOrName.get(raw.toLowerCase())
            if (resolvedKey) {
              newRows[ri][f.name]                       = resolvedKey
              if (!newDisplay[ri]) newDisplay[ri] = {}
              newDisplay[ri][f.name] = entry.byKey.get(resolvedKey) ?? raw
              continue
            }
          }
          // Not resolved
          if (!newDisplay[ri]) newDisplay[ri] = {}
          newDisplay[ri][f.name] = raw
          if (!newWarnings[ri]) newWarnings[ri] = {}
          newWarnings[ri][f.name] = `"${raw}" não encontrado`
        }

        // Check unique fields against existing DB records
        for (const f of uniqueFields) {
          const val = (newRows[ri][f.name] ?? '').trim()
          if (!val) continue
          if (uniqueExistingRef.current[f.name]?.has(val.toLowerCase())) {
            if (!newWarnings[ri]) newWarnings[ri] = {}
            newWarnings[ri][f.name] = `"${val}" já existe no banco de dados`
          }
        }

        // Standardization: dynamicOptions fields must match an option in field-options.json.
        // Case-insensitive matches are normalized to the canonical (uppercase) value.
        for (const f of dFields) {
          const allowed = dynamicAllowedRef.current[f.name]
          if (!allowed || allowed.size === 0) continue
          const val = (newRows[ri][f.name] ?? '').trim()
          if (!val || val === 'null') continue
          const canonical = allowed.get(val.toLowerCase())
          if (canonical) {
            newRows[ri][f.name] = canonical
          } else {
            if (!newWarnings[ri]) newWarnings[ri] = {}
            newWarnings[ri][f.name] = `"${val}" fora do padrão — opções: ${[...allowed.values()].join(', ')}`
          }
        }
      }

      setRows(newRows)
      setDisplay(newDisplay)
      setWarnings(newWarnings)
      setPhase('review')
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = useCallback((ri: number, fieldName: string, val: string) => {
    if (lFieldNames.has(fieldName)) {
      // Lookup field: update display, resolve live against cache
      setDisplay(prev => ({ ...prev, [ri]: { ...prev[ri], [fieldName]: val } }))

      const trimmed = val.trim()
      const field = lFields.find(f => f.name === fieldName)
      // Left empty (when optional) or at the field's default (e.g. 0 for "sem alerta") — nothing to resolve
      const isDefault = field?.defaultValue !== undefined && trimmed === String(field.defaultValue)
      const isOptionalEmpty = !trimmed && field?.nullable

      if (isDefault || isOptionalEmpty) {
        setRows(prev => prev.map((r, i) => i === ri ? { ...r, [fieldName]: val } : r))
        setWarnings(prev => {
          if (!prev[ri]?.[fieldName]) return prev
          const next = { ...prev, [ri]: { ...prev[ri] } }
          delete next[ri][fieldName]
          if (!Object.keys(next[ri]).length) delete next[ri]
          return next
        })
        return
      }

      const entry = cacheRef.current[fieldName]
      const resolvedKey = entry?.byKeyOrName.get(trimmed.toLowerCase())

      if (resolvedKey) {
        setRows(prev => prev.map((r, i) => i === ri ? { ...r, [fieldName]: resolvedKey } : r))
        setWarnings(prev => {
          if (!prev[ri]?.[fieldName]) return prev
          const next = { ...prev, [ri]: { ...prev[ri] } }
          delete next[ri][fieldName]
          if (!Object.keys(next[ri]).length) delete next[ri]
          return next
        })
      } else {
        setRows(prev => prev.map((r, i) => i === ri ? { ...r, [fieldName]: val } : r))
        setWarnings(prev => ({
          ...prev,
          [ri]: { ...prev[ri], [fieldName]: trimmed ? `"${trimmed}" não encontrado` : 'Campo obrigatório' },
        }))
      }
    } else {
      // Regular field
      setRows(prev => prev.map((r, i) => i === ri ? { ...r, [fieldName]: val } : r))

      const setWarn = (msg: string) => setWarnings(prev => ({
        ...prev,
        [ri]: { ...prev[ri], [fieldName]: msg },
      }))
      const clearWarn = () => setWarnings(prev => {
        if (!prev[ri]?.[fieldName]) return prev
        const next = { ...prev, [ri]: { ...prev[ri] } }
        delete next[ri][fieldName]
        if (!Object.keys(next[ri]).length) delete next[ri]
        return next
      })

      const trimmed = val.trim()

      // Live DB-unique validation: check against existing records fetched on mount
      const existingSet = uniqueExistingRef.current[fieldName]
      if (existingSet) {
        if (trimmed && existingSet.has(trimmed.toLowerCase())) {
          setWarn(`"${trimmed}" já existe no banco de dados`)
        } else {
          clearWarn()
        }
        return
      }

      // Live standardization check against field-options.json
      const allowed = dynamicAllowedRef.current[fieldName]
      if (allowed && allowed.size > 0) {
        if (!trimmed) {
          clearWarn()
        } else {
          const canonical = allowed.get(trimmed.toLowerCase())
          if (canonical) {
            if (canonical !== val) {
              setRows(prev => prev.map((r, i) => i === ri ? { ...r, [fieldName]: canonical } : r))
            }
            clearWarn()
          } else {
            setWarn(`"${trimmed}" fora do padrão — opções: ${[...allowed.values()].join(', ')}`)
          }
        }
      }
    }
  }, [lFieldNames])

  const handleRemove = (ri: number) => {
    setRows(prev => prev.filter((_, i) => i !== ri))
    setDisplay(prev => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k)
        if (idx !== ri) next[idx < ri ? idx : idx - 1] = v
      }
      return next
    })
    setWarnings(prev => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k)
        if (idx !== ri) next[idx < ri ? idx : idx - 1] = v
      }
      return next
    })
  }

  const handleImport = async () => {
    setPhase('importing')
    setTotal(rows.length)
    setDone(0)
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      try {
        const res = await fetch(`/api/${tableName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rows[i]),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          errors.push(`Linha ${i + 1}: ${json.error || 'erro desconhecido'}`)
        }
      } catch {
        errors.push(`Linha ${i + 1}: falha de rede`)
      }
      setDone(i + 1)
    }

    setErrLines(errors)
    setPhase('done')
  }

  const saved = done - errLines.length
  const pct   = total ? Math.round((done / total) * 100) : 0

  // Detect duplicates within the current batch for unique fields
  const batchDuplicates: Record<number, Record<string, string>> = {}
  for (const f of uniqueFields) {
    const seen = new Map<string, number>()  // value → first row index
    for (let ri = 0; ri < rows.length; ri++) {
      const val = (rows[ri][f.name] ?? '').trim()
      if (!val) continue
      if (seen.has(val)) {
        const first = seen.get(val)!
        if (!batchDuplicates[ri]) batchDuplicates[ri] = {}
        batchDuplicates[ri][f.name] = `Duplicado no lote (linha ${first + 1})`
        if (!batchDuplicates[first]) batchDuplicates[first] = {}
        batchDuplicates[first][f.name] = `Duplicado no lote (linha ${ri + 1})`
      } else {
        seen.set(val, ri)
      }
    }
  }

  // Merge lookup warnings + batch duplicate warnings
  const allWarnings: Record<number, Record<string, string>> = {}
  const mergeIn = (src: Record<number, Record<string, string>>) => {
    for (const [k, v] of Object.entries(src)) {
      const idx = Number(k)
      allWarnings[idx] = { ...allWarnings[idx], ...v }
    }
  }
  mergeIn(warnings)
  mergeIn(batchDuplicates)

  const totalWarnings = Object.values(allWarnings).reduce((s, w) => s + Object.keys(w).length, 0)
  const hasErrors     = totalWarnings > 0

  /* ── Done ─────────────────────────────────────────────────────────────── */
  if (phase === 'done') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in p-6 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-on-surface">Importação concluída</h2>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-primary font-medium">
              ✓ {saved} registro{saved !== 1 ? 's' : ''} salvo{saved !== 1 ? 's' : ''} com sucesso
            </span>
            {errLines.length > 0 && (
              <>
                <span className="text-error font-medium mt-1">✕ {errLines.length} erro{errLines.length !== 1 ? 's' : ''}:</span>
                <ul className="list-disc list-inside text-error/80 text-xs max-h-40 overflow-y-auto bg-surface-container-highest rounded p-2 border border-error/20">
                  {errLines.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </>
            )}
          </div>
          <div className="flex justify-end">
            <button onClick={() => onDone(saved)} className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow">
              Fechar
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── Review / Validating / Importing ─────────────────────────────────── */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-on-surface font-mono">Auditoria de Importação</h2>
            <p className="text-[11px] text-outline mt-0.5">
              {phase === 'validating'
                ? 'Validando referências e duplicidades…'
                : `${rows.length} registro${rows.length !== 1 ? 's' : ''} — revise e edite antes de confirmar`}
            </p>
          </div>
          {phase === 'review' && (
            <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none ml-4">✕</button>
          )}
        </div>

        {/* Error banner */}
        {phase === 'review' && hasErrors && (
          <div className="px-5 py-2.5 bg-error/10 border-b border-error/30 text-error text-xs flex items-start gap-2">
            <span className="shrink-0 mt-px">✕</span>
            <span>
              {totalWarnings} campo{totalWarnings !== 1 ? 's' : ''} com valor não reconhecido (em vermelho).
              Corrija ou remova as linhas antes de importar.
            </span>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {phase === 'validating' ? (
            <div className="flex items-center justify-center h-32 gap-3 text-outline text-sm">
              <span className="w-4 h-4 border-2 border-outline border-t-primary rounded-full animate-spin" />
              Verificando referências e duplicidades no banco…
            </div>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="bg-surface-container-highest border-b border-outline-variant sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider w-8">#</th>
                  {editableCols.map(f => (
                    <th key={f.name} className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[90px]">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={editableCols.length + 2} className="px-4 py-10 text-center text-outline text-sm">
                      Nenhuma linha. Remova o arquivo e importe novamente com dados.
                    </td>
                  </tr>
                ) : rows.map((row, ri) => {
                  const rowHasError = !!allWarnings[ri]
                  return (
                    <tr key={ri} className={`hover:bg-surface-container-high/50 ${rowHasError ? 'bg-error/5' : ''}`}>
                      <td className={`px-3 py-1.5 font-mono text-[10px] select-none ${rowHasError ? 'text-error/60' : 'text-outline/40'}`}>{ri + 1}</td>
                      {editableCols.map(f => {
                        const isLookup = lFieldNames.has(f.name)
                        const warn     = allWarnings[ri]?.[f.name]
                        const shownVal = isLookup
                          ? (display[ri]?.[f.name] ?? row[f.name] ?? '')
                          : (row[f.name] === 'null' ? '' : (row[f.name] ?? ''))
                        const resolvedId = isLookup && !warn ? row[f.name] : null

                        return (
                          <td key={f.name} className="px-1.5 py-1.5">
                            <input
                              type="text"
                              value={shownVal}
                              onChange={e => handleChange(ri, f.name, e.target.value)}
                              disabled={phase === 'importing'}
                              title={warn ?? (resolvedId ? `ID: ${resolvedId}` : undefined)}
                              className={`w-full min-w-[80px] rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 transition-colors disabled:opacity-40 ${
                                warn
                                  ? 'bg-error/10 border border-error/60 text-error focus:border-error focus:ring-error/20'
                                  : resolvedId
                                    ? 'bg-green-900/10 border border-green-700/40 text-on-surface focus:border-green-600 focus:ring-green-600/20'
                                    : 'bg-surface-container border border-outline-variant/50 text-on-surface focus:border-primary focus:ring-primary/20'
                              }`}
                            />
                            {warn && (
                              <div className="text-[9px] text-error mt-0.5 leading-tight">{warn}</div>
                            )}
                            {resolvedId && (
                              <div className="text-[9px] text-green-500/70 mt-0.5 leading-tight font-mono">ID: {resolvedId}</div>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => handleRemove(ri)}
                          disabled={phase === 'importing'}
                          title="Remover linha"
                          className="text-outline/30 hover:text-error transition-colors disabled:invisible text-sm leading-none"
                        >✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant shrink-0 px-5 py-3 flex items-center gap-4">
          {phase === 'importing' ? (
            <div className="flex items-center gap-3 flex-1">
              <div className="flex-1 bg-surface-container-highest rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-primary transition-all duration-200" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-outline font-mono whitespace-nowrap">{done} / {total}</span>
            </div>
          ) : (
            <span className="text-xs text-outline flex-1">
              {rows.length} registro{rows.length !== 1 ? 's' : ''} para importar
              {hasErrors && <span className="text-error ml-2">· {totalWarnings} erro{totalWarnings !== 1 ? 's' : ''} impedem o import</span>}
            </span>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={phase === 'importing'}
              className="px-4 py-2 text-sm text-on-surface-variant border border-outline-variant rounded hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              onClick={handleImport}
              disabled={phase !== 'review' || rows.length === 0 || hasErrors}
              title={hasErrors ? 'Corrija os campos em vermelho antes de importar' : undefined}
              className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {phase === 'importing' ? 'Importando…' : `Importar ${rows.length} registro${rows.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
