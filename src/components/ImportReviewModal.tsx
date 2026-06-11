'use client'

import { useState, useEffect } from 'react'
import type { TableSchema, Field } from '@/lib/schema'

interface Props {
  schema: TableSchema
  tableName: string
  initialRows: Record<string, string>[]
  onClose: () => void
  onDone: (saved: number) => void
}

type Phase = 'validating' | 'review' | 'importing' | 'done'

// field.name → Map<keyOrName, resolvedKey>
type LookupCache = Record<string, Map<string, string>>

/** Fields that can be resolved: must have fetchOptions with both keyField and displayField */
function lookupFields(schema: TableSchema): Field[] {
  return schema.fields.filter(
    f => f.validateExistsIn?.displayField && f.fetchOptions
  )
}

export default function ImportReviewModal({ schema, tableName, initialRows, onClose, onDone }: Props) {
  const editableCols = schema.fields.filter(f => !f.isPk && !f.isReadonly && !f.hideInForm)

  const [rows,     setRows]     = useState<Record<string, string>[]>(initialRows)
  const [phase,    setPhase]    = useState<Phase>('validating')
  const [done,     setDone]     = useState(0)
  const [total,    setTotal]    = useState(0)
  const [errLines, setErrLines] = useState<string[]>([])
  // row index → field name → warning message
  const [warnings, setWarnings] = useState<Record<number, Record<string, string>>>({})

  // On mount: fetch lookup tables, auto-resolve display names → keys, flag unknowns
  useEffect(() => {
    const lFields = lookupFields(schema)
    if (lFields.length === 0) { setPhase('review'); return }

    ;(async () => {
      const cache: LookupCache = {}

      await Promise.all(lFields.map(async f => {
        const fo = f.fetchOptions!
        const vi = f.validateExistsIn!
        try {
          const res = await fetch(`/api/${fo.table}?limit=25000`)
          if (!res.ok) return
          const json = await res.json()
          const map = new Map<string, string>()
          for (const row of (json.data || [])) {
            const key = String(row[vi.field] ?? '')
            const name = String(row[vi.displayField!] ?? '').toLowerCase()
            if (key) {
              map.set(key.toLowerCase(), key)   // key → key (exact)
              if (name) map.set(name, key)       // name → key
            }
          }
          cache[f.name] = map
        } catch { /* network error — skip validation for this field */ }
      }))

      // Auto-resolve rows and collect warnings
      setRows(prev => {
        const next = prev.map(row => ({ ...row }))
        const newWarnings: Record<number, Record<string, string>> = {}

        for (let ri = 0; ri < next.length; ri++) {
          for (const f of lFields) {
            const map = cache[f.name]
            if (!map) continue
            const raw = (next[ri][f.name] ?? '').trim()
            if (!raw) continue
            const resolved = map.get(raw.toLowerCase())
            if (resolved) {
              next[ri][f.name] = resolved  // auto-resolve name → key
            } else {
              if (!newWarnings[ri]) newWarnings[ri] = {}
              newWarnings[ri][f.name] = `"${raw}" não encontrado`
            }
          }
        }

        setWarnings(newWarnings)
        return next
      })

      setPhase('review')
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (ri: number, name: string, val: string) => {
    setRows(prev => prev.map((r, i) => i === ri ? { ...r, [name]: val } : r))
    // Clear warning for the edited cell
    setWarnings(prev => {
      if (!prev[ri]?.[name]) return prev
      const next = { ...prev, [ri]: { ...prev[ri] } }
      delete next[ri][name]
      if (Object.keys(next[ri]).length === 0) delete next[ri]
      return next
    })
  }

  const handleRemove = (ri: number) => {
    setRows(prev => prev.filter((_, i) => i !== ri))
    setWarnings(prev => {
      const next: Record<number, Record<string, string>> = {}
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k)
        if (idx === ri) continue
        next[idx < ri ? idx : idx - 1] = v
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
  const totalWarnings = Object.values(warnings).reduce((s, w) => s + Object.keys(w).length, 0)

  /* ── Done screen ─────────────────────────────────────────────────────── */
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
                <span className="text-error font-medium mt-1">
                  ✕ {errLines.length} erro{errLines.length !== 1 ? 's' : ''}:
                </span>
                <ul className="list-disc list-inside text-error/80 text-xs max-h-40 overflow-y-auto bg-surface-container-highest rounded p-2 border border-error/20">
                  {errLines.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => onDone(saved)}
              className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── Review / Importing / Validating screen ──────────────────────────── */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-on-surface font-mono">Auditoria de Importação</h2>
            <p className="text-[11px] text-outline mt-0.5">
              {phase === 'validating'
                ? 'Validando referências…'
                : `${rows.length} registro${rows.length !== 1 ? 's' : ''} — revise e edite antes de confirmar`}
            </p>
          </div>
          {phase === 'review' && (
            <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors text-xl leading-none ml-4">✕</button>
          )}
        </div>

        {/* Warning banner */}
        {phase === 'review' && totalWarnings > 0 && (
          <div className="px-5 py-2.5 bg-amber-900/20 border-b border-amber-700/30 text-amber-400 text-xs flex items-start gap-2">
            <span className="shrink-0 mt-px">⚠</span>
            <span>
              {totalWarnings} campo{totalWarnings !== 1 ? 's' : ''} com valor não reconhecido (destacado em laranja).
              Corrija antes de importar ou remova as linhas problemáticas.
            </span>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {phase === 'validating' ? (
            <div className="flex items-center justify-center h-32 gap-3 text-outline text-sm">
              <span className="w-4 h-4 border-2 border-outline border-t-primary rounded-full animate-spin" />
              Verificando referências…
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
              ) : rows.map((row, ri) => (
                <tr key={ri} className={`hover:bg-surface-container-high/50 ${warnings[ri] ? 'bg-amber-900/10' : ''}`}>
                  <td className="px-3 py-1.5 text-outline/40 font-mono text-[10px] select-none">{ri + 1}</td>
                  {editableCols.map(f => {
                    const warn = warnings[ri]?.[f.name]
                    return (
                      <td key={f.name} className="px-1.5 py-1.5">
                        <input
                          type="text"
                          value={row[f.name] === 'null' ? '' : (row[f.name] ?? '')}
                          onChange={e => handleChange(ri, f.name, e.target.value)}
                          disabled={phase === 'importing'}
                          title={warn}
                          className={`w-full min-w-[80px] rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 transition-colors disabled:opacity-40 ${
                            warn
                              ? 'bg-amber-900/20 border border-amber-600/60 text-amber-300 focus:border-amber-500 focus:ring-amber-500/20'
                              : 'bg-surface-container border border-outline-variant/50 text-on-surface focus:border-primary focus:ring-primary/20'
                          }`}
                        />
                        {warn && (
                          <div className="text-[9px] text-amber-500 mt-0.5 leading-tight">{warn}</div>
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
              ))}
            </tbody>
          </table>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant shrink-0 px-5 py-3 flex items-center gap-4">
          {phase === 'importing' ? (
            <div className="flex items-center gap-3 flex-1">
              <div className="flex-1 bg-surface-container-highest rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-outline font-mono whitespace-nowrap">{done} / {total}</span>
            </div>
          ) : (
            <span className="text-xs text-outline flex-1">
              {rows.length} registro{rows.length !== 1 ? 's' : ''} para importar
              {totalWarnings > 0 && (
                <span className="text-amber-400 ml-2">· {totalWarnings} aviso{totalWarnings !== 1 ? 's' : ''}</span>
              )}
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
              disabled={phase === 'importing' || phase === 'validating' || rows.length === 0}
              className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 whitespace-nowrap"
            >
              {phase === 'importing'
                ? 'Importando…'
                : `Importar ${rows.length} registro${rows.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
