'use client'

import { useMemo, useState } from 'react'
import type { Field, TableSchema } from '@/lib/schema'
import { normalizeControladoriaKey } from '@/lib/csvControladoriaDetect'

// Janela de Auditoria de Importação pro botão "↑ Importar Custos" (perfil
// restrito de Controladoria/Fiscal/Precificação) — mesmo espírito do
// ImportReviewModal que o Admin já tem em "+Novo Registro > Importar
// Excel": mostra, linha a linha, o valor atual x o valor que vai ser
// gravado, deixa editar qualquer célula errada ali mesmo (código digitado
// errado, custo com typo etc.) antes de confirmar, e só libera o botão de
// importar depois que não sobra nenhuma linha com problema não resolvido.
//
// O POST final ainda passa pela rota de sempre
// (/api/global-update-controladoria/[table]) — esta janela não reimplementa
// a escrita, só dá uma chance de revisar/corrigir antes de disparar o
// mesmo caminho que já cuida de auditoria + proteção de custo real local.

interface Props {
  schema: TableSchema
  tableName: string
  keyField: Field
  presentFields: Field[]
  // Uma linha por código do arquivo, já rechaveada por field.name (não pelo
  // cabeçalho cru do arquivo — pode ter sido nome da coluna ou rótulo).
  rows: Record<string, string>[]
  // Chave normalizada -> field.name -> valor atual exibido (custo real
  // capturado localmente quando aplicável, não o sentinela do Supabase —
  // ver DataTable.tsx, que já resolve isso do mesmo jeito pra tela toda).
  currentByKey: Map<string, Record<string, string>>
  profileId: string
  onClose: () => void
  onDone: (updated: number, notFound: number, errors: { key: string; error: string }[]) => void
}

type Phase = 'review' | 'importing' | 'done'

export default function ControladoriaImportReviewModal({
  schema, tableName, keyField, presentFields, rows: initialRows, currentByKey, profileId, onClose, onDone,
}: Props) {
  const [rows, setRows]   = useState(initialRows)
  const [phase, setPhase] = useState<Phase>('review')
  const [result, setResult] = useState<{ updated: number; notFound: number; errors: { key: string; error: string }[] } | null>(null)

  const handleChange = (ri: number, fieldName: string, val: string) => {
    setRows(prev => prev.map((r, i) => i === ri ? { ...r, [fieldName]: val } : r))
  }

  const rowInfos = useMemo(() => {
    const keyCounts = new Map<string, number>()
    for (const row of rows) {
      const k = normalizeControladoriaKey(keyField, row[keyField.name])
      if (k) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1)
    }
    return rows.map(row => {
      const key = normalizeControladoriaKey(keyField, row[keyField.name])
      const current = key ? currentByKey.get(key) : undefined
      const notFound = !key || !current
      const duplicate = key ? (keyCounts.get(key) ?? 0) > 1 : false

      const fieldInfos = presentFields.map(f => {
        const raw = (row[f.name] ?? '').trim()
        const invalid = raw !== '' && Number.isNaN(parseFloat(raw))
        const curRaw = current?.[f.name]
        const curNum = curRaw && curRaw !== 'N/A' ? parseFloat(curRaw) : null
        const newNum = raw === '' ? null : parseFloat(raw)
        const changed = !invalid && raw !== '' && (curNum === null || Math.abs((newNum ?? 0) - curNum) > 0.005)
        return { field: f, raw, invalid, curDisplay: curRaw ?? 'N/A', changed }
      })
      const hasInvalid = fieldInfos.some(fi => fi.invalid)
      const hasChange  = fieldInfos.some(fi => fi.changed)

      return { row, key, notFound, duplicate, fieldInfos, hasInvalid, hasChange }
    })
  }, [rows, currentByKey, keyField, presentFields])

  const notFoundCount  = rowInfos.filter(r => r.notFound).length
  const duplicateCount = rowInfos.filter(r => r.duplicate).length
  const invalidCount   = rowInfos.filter(r => !r.notFound && !r.duplicate && r.hasInvalid).length
  const updateCount    = rowInfos.filter(r => !r.notFound && !r.duplicate && !r.hasInvalid && r.hasChange).length
  const canImport = phase === 'review' && notFoundCount === 0 && duplicateCount === 0 && invalidCount === 0 && updateCount > 0

  const handleImport = async () => {
    setPhase('importing')
    // Só as linhas sem erro e com pelo menos um campo realmente diferente
    // do valor atual vão pro servidor — evita reescrever à toa o que já
    // está igual, e mantém o rastro de auditoria significativo.
    const toSubmit = rowInfos
      .filter(r => !r.notFound && !r.duplicate && !r.hasInvalid && r.hasChange)
      .map(r => r.row)
    try {
      const res = await fetch(`/api/global-update-controladoria/${tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: toSubmit, profileId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setResult({ updated: 0, notFound: 0, errors: [{ key: '', error: json.error || 'Falha ao importar' }] })
      } else {
        setResult({ updated: json.updated ?? 0, notFound: json.notFound ?? 0, errors: json.errors ?? [] })
      }
    } catch {
      setResult({ updated: 0, notFound: 0, errors: [{ key: '', error: 'Falha de rede' }] })
    }
    setPhase('done')
  }

  if (phase === 'done' && result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in p-6 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-on-surface">Importação concluída</h2>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-primary font-medium">
              ✓ {result.updated} registro{result.updated !== 1 ? 's' : ''} atualizado{result.updated !== 1 ? 's' : ''} com sucesso
            </span>
            {result.notFound > 0 && (
              <span className="text-outline font-medium">— {result.notFound} não encontrado{result.notFound !== 1 ? 's' : ''} no banco</span>
            )}
            {result.errors.length > 0 && (
              <>
                <span className="text-error font-medium mt-1">✕ {result.errors.length} erro{result.errors.length !== 1 ? 's' : ''}:</span>
                <ul className="list-disc list-inside text-error/80 text-xs max-h-40 overflow-y-auto bg-surface-container-highest rounded p-2 border border-error/20">
                  {result.errors.map((e, i) => <li key={i}>{e.key ? `${e.key}: ` : ''}{e.error}</li>)}
                </ul>
              </>
            )}
          </div>
          <div className="flex justify-end">
            <button onClick={() => onDone(result.updated, result.notFound, result.errors)} className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow">
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
            <h2 className="text-sm font-semibold text-on-surface font-mono">Auditoria de Importação — {schema.label}</h2>
            <p className="text-[11px] text-outline mt-0.5">
              {rows.length} registro{rows.length !== 1 ? 's' : ''} — revise, edite o que estiver errado e confirme
            </p>
          </div>
          {phase === 'review' && (
            <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none ml-4">✕</button>
          )}
        </div>

        {/* Error banner */}
        {phase === 'review' && (notFoundCount > 0 || duplicateCount > 0 || invalidCount > 0) && (
          <div className="px-5 py-2.5 bg-error/10 border-b border-error/30 text-error text-xs flex flex-col gap-1.5">
            {notFoundCount > 0 && (
              <span className="flex items-start gap-2">
                <span className="shrink-0 mt-px">✕</span>
                <span>{notFoundCount} linha{notFoundCount !== 1 ? 's' : ''} sem correspondência de {keyField.label} (em vermelho) — corrija a célula ou remova a linha do arquivo antes de importar.</span>
              </span>
            )}
            {duplicateCount > 0 && (
              <span className="flex items-start gap-2">
                <span className="shrink-0 mt-px">✕</span>
                <span>{duplicateCount} linha{duplicateCount !== 1 ? 's' : ''} com {keyField.label} repetido no arquivo (em vermelho) — cada código só pode aparecer uma vez.</span>
              </span>
            )}
            {invalidCount > 0 && (
              <span className="flex items-start gap-2">
                <span className="shrink-0 mt-px">✕</span>
                <span>{invalidCount} linha{invalidCount !== 1 ? 's' : ''} com valor não numérico num campo financeiro (em vermelho).</span>
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
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[130px]">{keyField.label}</th>
                {presentFields.map(f => (
                  <th key={f.name} className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[110px]">
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-outline uppercase tracking-wider whitespace-nowrap min-w-[110px]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={presentFields.length + 3} className="px-4 py-10 text-center text-outline text-sm">
                    Nenhuma linha. Remova o arquivo e importe novamente com dados.
                  </td>
                </tr>
              ) : rowInfos.map(({ row, notFound, duplicate, fieldInfos, hasInvalid, hasChange }, ri) => {
                const flagged = notFound || duplicate
                return (
                  <tr key={ri} className={`hover:bg-surface-container-high/50 ${flagged ? 'bg-error/5' : ''}`}>
                    <td className={`px-3 py-1.5 font-mono text-[10px] select-none ${flagged ? 'text-error/60' : 'text-outline/40'}`}>{ri + 1}</td>
                    <td className="px-1.5 py-1.5">
                      <input
                        type="text"
                        value={row[keyField.name] ?? ''}
                        onChange={e => handleChange(ri, keyField.name, e.target.value)}
                        disabled={phase === 'importing'}
                        title={notFound ? `"${row[keyField.name] || ''}" não encontrado` : duplicate ? 'Repetido no arquivo' : undefined}
                        className={`w-full min-w-[110px] rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 transition-colors disabled:opacity-40 ${
                          flagged
                            ? 'bg-error/10 border border-error/60 text-error focus:border-error focus:ring-error/20'
                            : 'bg-surface-container border border-outline-variant/50 text-on-surface focus:border-primary focus:ring-primary/20'
                        }`}
                      />
                      {notFound && <div className="text-[9px] text-error mt-0.5 leading-tight">não encontrado</div>}
                      {duplicate && <div className="text-[9px] text-error mt-0.5 leading-tight">repetido no arquivo</div>}
                    </td>
                    {fieldInfos.map(({ field, raw, invalid, curDisplay, changed }) => (
                      <td key={field.name} className="px-1.5 py-1.5">
                        <input
                          type="text"
                          value={raw}
                          onChange={e => handleChange(ri, field.name, e.target.value)}
                          disabled={phase === 'importing'}
                          title={invalid ? `"${raw}" não é um número válido` : `atual: ${curDisplay}`}
                          className={`w-full min-w-[90px] rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 transition-colors disabled:opacity-40 ${
                            invalid
                              ? 'bg-error/10 border border-error/60 text-error focus:border-error focus:ring-error/20'
                              : changed
                                ? 'bg-green-900/10 border border-green-700/40 text-on-surface focus:border-green-600 focus:ring-green-600/20'
                                : 'bg-surface-container border border-outline-variant/50 text-on-surface focus:border-primary focus:ring-primary/20'
                          }`}
                        />
                        <div className={`text-[9px] mt-0.5 leading-tight font-mono ${invalid ? 'text-error' : 'text-outline/60'}`}>
                          {invalid ? 'inválido' : `atual: ${curDisplay}`}
                        </div>
                      </td>
                    ))}
                    <td className="px-3 py-1.5">
                      {duplicate ? (
                        <span className="text-error text-[10px]">duplicado no arquivo</span>
                      ) : notFound ? (
                        <span className="text-error text-[10px]">não encontrado</span>
                      ) : hasInvalid ? (
                        <span className="text-error text-[10px]">valor inválido</span>
                      ) : hasChange ? (
                        <span className="text-green-500 text-[10px]">✓ será atualizado</span>
                      ) : (
                        <span className="text-outline text-[10px]">sem alteração</span>
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
            <span className="text-xs text-outline flex-1 flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-outline border-t-primary rounded-full animate-spin" />
              Importando…
            </span>
          ) : (
            <span className="text-xs text-outline flex-1">
              {rows.length} registro{rows.length !== 1 ? 's' : ''} no arquivo
              {notFoundCount > 0 && <span className="text-error ml-2">· {notFoundCount} sem correspondência</span>}
              {duplicateCount > 0 && <span className="text-error ml-2">· {duplicateCount} duplicado{duplicateCount !== 1 ? 's' : ''}</span>}
              {invalidCount > 0 && <span className="text-error ml-2">· {invalidCount} inválido{invalidCount !== 1 ? 's' : ''}</span>}
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
                notFoundCount > 0 || duplicateCount > 0 || invalidCount > 0
                  ? 'Corrija as linhas em vermelho antes de importar'
                  : updateCount === 0
                  ? 'Nenhum registro com valor diferente do atual'
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
