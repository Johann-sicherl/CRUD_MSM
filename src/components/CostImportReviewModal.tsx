'use client'

import { useMemo, useState } from 'react'

interface SourceRow {
  id: string
  table: string
  code: string
  cost: number | null
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
  const [skipped, setSkipped] = useState(0)
  const [errLines, setErrLines] = useState<string[]>([])

  // Each row must match exactly one Código Protheus, and that code must appear
  // only once in the file — anything else is an irreconcilable mismatch and
  // must block the import entirely.
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      counts.set(row.code, (counts.get(row.code) ?? 0) + 1)
    }
    return counts
  }, [rows])

  const rowInfos = useMemo(() => rows.map(row => {
    const matches = sourceRows.filter(r => r.code === row.code)
    const newCost = parseFloat(row.cost)
    // cost null = nenhum valor real capturado ainda pra esse registro —
    // qualquer valor no arquivo é uma mudança real, não só "diferente de 0".
    const toUpdate = matches.filter(m => m.cost === null || Math.abs(m.cost - newCost) > 0.005)
    const duplicate = (duplicateKeys.get(row.code) ?? 0) > 1
    return {
      row,
      matches,
      notFound: matches.length === 0,
      multi: matches.length > 1,
      toUpdate,
      unchanged: matches.length > 0 && toUpdate.length === 0,
      duplicate,
    }
  }), [rows, sourceRows, duplicateKeys])

  const handleImport = async () => {
    setPhase('importing')
    setDone(0)
    let ok = 0
    let skip = 0
    const errors: string[] = []

    for (let i = 0; i < rowInfos.length; i++) {
      const { row, toUpdate } = rowInfos[i]
      if (toUpdate.length === 0) {
        skip++
        setDone(i + 1)
        continue
      }
      try {
        const results = await Promise.all(toUpdate.map(m =>
          fetch(`/api/${m.table}/${m.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cost_std: row.cost }),
          })
        ))
        if (results.every(r => r.ok)) ok++
        else errors.push(`Linha ${i + 1}: "${row.code}" — erro ao salvar`)
      } catch {
        errors.push(`Linha ${i + 1}: "${row.code}" — falha de rede`)
      }
      setDone(i + 1)
    }

    setSaved(ok)
    setSkipped(skip)
    setErrLines(errors)
    setPhase('done')
  }

  const total = rows.length
  const pct   = total ? Math.round((done / total) * 100) : 0
  const notFoundCount  = rowInfos.filter(r => r.notFound).length
  const duplicateCount = rowInfos.filter(r => r.duplicate).length
  const updateCount    = rowInfos.filter(r => r.toUpdate.length > 0 && !r.duplicate).length
  const canImport      = phase === 'review' && rows.length > 0
    && notFoundCount === 0 && duplicateCount === 0 && updateCount > 0

  if (phase === 'done') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in p-6 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-on-surface">Importação concluída</h2>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-primary font-medium">
              ✓ {saved} registro{saved !== 1 ? 's' : ''} atualizado{saved !== 1 ? 's' : ''} com sucesso
            </span>
            {skipped > 0 && (
              <span className="text-outline font-medium">
                — {skipped} sem alteração (já estava{skipped !== 1 ? 'm' : ''} com o mesmo custo)
              </span>
            )}
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
        {phase === 'review' && (notFoundCount > 0 || duplicateCount > 0) && (
          <div className="px-5 py-2.5 bg-error/10 border-b border-error/30 text-error text-xs flex flex-col gap-1.5">
            {notFoundCount > 0 && (
              <span className="flex items-start gap-2">
                <span className="shrink-0 mt-px">✕</span>
                <span>
                  {notFoundCount} linha{notFoundCount !== 1 ? 's' : ''} sem correspondência exata de Código Protheus (em vermelho) — corrija ou remova essas linhas no arquivo para habilitar a importação.
                </span>
              </span>
            )}
            {duplicateCount > 0 && (
              <span className="flex items-start gap-2">
                <span className="shrink-0 mt-px">✕</span>
                <span>
                  {duplicateCount} linha{duplicateCount !== 1 ? 's' : ''} com Código Protheus repetido no arquivo (em vermelho) — cada código só pode aparecer uma vez. Corrija o arquivo para habilitar a importação.
                </span>
              </span>
            )}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-surface-container-highest border-b border-outline-variant sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider w-8">#</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[120px]">Código Protheus</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[100px]">Custo (R$)</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[120px]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-outline text-sm">
                    Nenhuma linha. Remova o arquivo e importe novamente com dados.
                  </td>
                </tr>
              ) : rowInfos.map(({ row, matches, notFound, multi, unchanged, duplicate }, ri) => {
                const flagged = notFound || duplicate
                return (
                  <tr key={ri} className={`hover:bg-surface-container-high/50 ${flagged ? 'bg-error/5' : ''}`}>
                    <td className={`px-3 py-1.5 font-mono text-[10px] select-none ${flagged ? 'text-error/60' : 'text-outline/40'}`}>{ri + 1}</td>
                    <td className="px-3 py-1.5 font-mono text-on-surface-variant">{row.code || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-on-surface-variant">{row.cost || '—'}</td>
                    <td className="px-3 py-1.5">
                      {duplicate ? (
                        <span className="text-error text-[10px]">duplicado no arquivo</span>
                      ) : notFound ? (
                        <span className="text-error text-[10px]">não encontrado</span>
                      ) : unchanged ? (
                        <span className="text-outline text-[10px]">sem alteração</span>
                      ) : multi ? (
                        <span className="text-primary text-[10px]">{matches.length} correspondências</span>
                      ) : (
                        <span className="text-green-500 text-[10px]">✓ será atualizado</span>
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
              {duplicateCount > 0 && <span className="text-error ml-2">· {duplicateCount} duplicado{duplicateCount !== 1 ? 's' : ''}</span>}
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
              disabled={!canImport}
              title={
                notFoundCount > 0
                  ? 'Corrija as linhas sem correspondência exata de Código Protheus antes de importar'
                  : duplicateCount > 0
                  ? 'Remova as linhas com Código Protheus repetido antes de importar'
                  : updateCount === 0
                  ? 'Nenhum registro com custo diferente do atual'
                  : undefined
              }
              className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {phase === 'importing' ? 'Importando…' : `Importar ${updateCount} registro${updateCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
