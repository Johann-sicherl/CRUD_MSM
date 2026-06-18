'use client'

import { useState } from 'react'

interface SourceRow {
  id: string
  table: string
  source: string
  code: string
}

interface Props {
  sourceRows: SourceRow[]
  parsedRows: Record<string, string>[]
  onClose: () => void
  onDone: (saved: number, errors: string[]) => void
}

type Phase = 'review' | 'importing' | 'done'

export default function CostImportReviewModal({ sourceRows, parsedRows, onClose, onDone }: Props) {
  const [rows]             = useState(parsedRows)
  const [phase, setPhase]  = useState<Phase>('review')
  const [done,  setDone]   = useState(0)
  const [saved, setSaved]  = useState(0)
  const [errLines, setErrLines] = useState<string[]>([])

  const matchesFor = (row: Record<string, string>) =>
    sourceRows.filter(r => r.source === row.source && r.code === row.code)

  const handleImport = async () => {
    setPhase('importing')
    setDone(0)
    let ok = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const matches = matchesFor(row)
      if (matches.length === 0) {
        errors.push(`Linha ${i + 1}: "${row.code}" não encontrado em "${row.source || '—'}"`)
        setDone(i + 1)
        continue
      }
      try {
        const results = await Promise.all(matches.map(m =>
          fetch(`/api/${m.table}/${m.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cost_std: row.cost }),
          })
        ))
        if (results.every(r => r.ok)) ok++
        else errors.push(`Linha ${i + 1}: "${row.code}" (${row.source}) — erro ao salvar`)
      } catch {
        errors.push(`Linha ${i + 1}: "${row.code}" (${row.source}) — falha de rede`)
      }
      setDone(i + 1)
    }

    setSaved(ok)
    setErrLines(errors)
    setPhase('done')
  }

  const total = rows.length
  const pct   = total ? Math.round((done / total) * 100) : 0
  const notFoundCount = rows.filter(r => matchesFor(r).length === 0).length

  if (phase === 'done') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in p-6 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-on-surface">Importação concluída</h2>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-primary font-medium">
              ✓ {saved} registro{saved !== 1 ? 's' : ''} atualizado{saved !== 1 ? 's' : ''} com sucesso
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
            <button onClick={() => onDone(saved, errLines)} className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow">
              Fechar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-on-surface font-mono">Auditoria de Importação — Custos Gerais VMI</h2>
            <p className="text-[11px] text-outline mt-0.5">
              {rows.length} registro{rows.length !== 1 ? 's' : ''} — cada linha atualiza o custo na tabela de origem real
            </p>
          </div>
          {phase === 'review' && (
            <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none ml-4">✕</button>
          )}
        </div>

        {/* Info banner */}
        {phase === 'review' && notFoundCount > 0 && (
          <div className="px-5 py-2.5 bg-error/10 border-b border-error/30 text-error text-xs flex items-start gap-2">
            <span className="shrink-0 mt-px">✕</span>
            <span>
              {notFoundCount} linha{notFoundCount !== 1 ? 's' : ''} sem correspondência (em vermelho) — serão ignoradas e reportadas como erro; as demais linhas válidas serão importadas normalmente.
            </span>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-surface-container-highest border-b border-outline-variant sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider w-8">#</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[160px]">Origem</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[120px]">Código Protheus</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[100px]">Custo (R$)</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[120px]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-outline text-sm">
                    Nenhuma linha. Remova o arquivo e importe novamente com dados.
                  </td>
                </tr>
              ) : rows.map((row, ri) => {
                const matches  = matchesFor(row)
                const notFound = matches.length === 0
                const multi    = matches.length > 1
                return (
                  <tr key={ri} className={`hover:bg-surface-container-high/50 ${notFound ? 'bg-error/5' : ''}`}>
                    <td className={`px-3 py-1.5 font-mono text-[10px] select-none ${notFound ? 'text-error/60' : 'text-outline/40'}`}>{ri + 1}</td>
                    <td className="px-3 py-1.5 text-on-surface-variant">{row.source || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-on-surface-variant">{row.code || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-on-surface-variant">{row.cost || '—'}</td>
                    <td className="px-3 py-1.5">
                      {notFound ? (
                        <span className="text-error text-[10px]">não encontrado</span>
                      ) : multi ? (
                        <span className="text-primary text-[10px]">{matches.length} correspondências</span>
                      ) : (
                        <span className="text-green-500 text-[10px]">✓ encontrado</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
              {rows.length} registro{rows.length !== 1 ? 's' : ''} no arquivo
              {notFoundCount > 0 && <span className="text-error ml-2">· {notFoundCount} sem correspondência</span>}
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
              disabled={phase !== 'review' || rows.length === 0}
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
