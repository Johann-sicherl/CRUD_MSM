'use client'

import { useEffect, useState } from 'react'

interface CostRow {
  source: string
  code: string
  cost: number
}

const SOURCES: { table: string; codeField: string; label: string }[] = [
  { table: 'standard_equipment_items', codeField: 'protheus_code',      label: 'Cadastro de Equipamentos' },
  { table: 'accessories',              codeField: 'protheus_code',      label: 'Cadastro de Componentes' },
  { table: 'dependant_items',          codeField: 'protheus_item_code', label: 'Produtos Dependentes' },
]

export default function CustosGeraisVmiPage() {
  const [rows, setRows] = useState<CostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      setError('')
      try {
        const responses = await Promise.all(
          SOURCES.map(s => fetch(`/api/${s.table}?limit=25000`))
        )
        if (responses.some(r => !r.ok)) {
          setError('Erro ao carregar dados')
          setLoading(false)
          return
        }
        const jsons = await Promise.all(responses.map(r => r.json()))
        const combined: CostRow[] = jsons.flatMap((json, i) => {
          const src = SOURCES[i]
          const data: Record<string, unknown>[] = json.data || []
          return data.map(row => ({
            source: src.label,
            code: String(row[src.codeField] ?? ''),
            cost: Number(row.cost_std ?? 0),
          }))
        })
        setRows(combined)
      } catch {
        setError('Erro ao carregar dados')
      }
      setLoading(false)
    })()
  }, [])

  return (
    <div className="p-8">
      <div className="mb-4">
        <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Portifólio · custos-gerais-vmi
        </div>
        <h1 className="text-2xl font-bold text-on-surface">Custos Gerais VMI</h1>
        <p className="text-on-surface-variant text-sm mt-1">
          Consolidação dos custos padrão (cost_std) de todas as tabelas do catálogo
        </p>
      </div>

      <div className="bg-surface-container rounded border border-outline-variant overflow-hidden min-h-[70vh]">
        {loading && (
          <div className="flex items-center justify-center py-16 text-outline gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono">Carregando...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-16 text-error gap-2 text-sm">
            ⚠ {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <table className="w-full text-sm">
              <thead className="bg-surface-container-highest border-b border-outline-variant">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Origem</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Código Protheus</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono">Custo (R$)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-12 text-center text-outline text-sm">
                      Nenhum registro encontrado
                    </td>
                  </tr>
                ) : (
                  rows.map((row, i) => (
                    <tr key={`${row.source}-${row.code}-${i}`} className="hover:bg-surface-container-high transition-colors">
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{row.source}</td>
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap font-mono">{row.code}</td>
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                        {row.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="px-4 py-3 border-t border-outline-variant/30 text-xs text-outline font-mono">
              {rows.length} registro{rows.length !== 1 ? 's' : ''}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
