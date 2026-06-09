'use client'

import { useState } from 'react'
import type { TableSchema } from '@/lib/schema'

interface Props {
  schema: TableSchema
  tableName: string
  initialRows: Record<string, string>[]
  onClose: () => void
  onDone: (saved: number) => void
}

type Phase = 'review' | 'importing' | 'done'

export default function ImportReviewModal({ schema, tableName, initialRows, onClose, onDone }: Props) {
  const editableCols = schema.fields.filter(f => !f.isPk && !f.isReadonly && !f.hideInForm)

  const [rows,     setRows]     = useState<Record<string, string>[]>(initialRows)
  const [phase,    setPhase]    = useState<Phase>('review')
  const [done,     setDone]     = useState(0)
  const [total,    setTotal]    = useState(0)
  const [errLines, setErrLines] = useState<string[]>([])

  const handleChange = (ri: number, name: string, val: string) =>
    setRows(prev => prev.map((r, i) => i === ri ? { ...r, [name]: val } : r))

  const handleRemove = (ri: number) =>
    setRows(prev => prev.filter((_, i) => i !== ri))

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

  /* ── Review / Importing screen ───────────────────────────────────────── */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-on-surface font-mono">Auditoria de Importação</h2>
            <p className="text-[11px] text-outline mt-0.5">
              {rows.length} registro{rows.length !== 1 ? 's' : ''} — revise e edite antes de confirmar
            </p>
          </div>
          {phase === 'review' && (
            <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors text-xl leading-none ml-4">✕</button>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
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
                <tr key={ri} className="hover:bg-surface-container-high/50">
                  <td className="px-3 py-1.5 text-outline/40 font-mono text-[10px] select-none">{ri + 1}</td>
                  {editableCols.map(f => (
                    <td key={f.name} className="px-1.5 py-1.5">
                      <input
                        type="text"
                        value={row[f.name] === 'null' ? '' : (row[f.name] ?? '')}
                        onChange={e => handleChange(ri, f.name, e.target.value)}
                        disabled={phase === 'importing'}
                        className="w-full min-w-[80px] bg-surface-container border border-outline-variant/50 rounded px-1.5 py-0.5 text-on-surface text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors disabled:opacity-40"
                      />
                    </td>
                  ))}
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
              disabled={phase === 'importing' || rows.length === 0}
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
