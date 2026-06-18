'use client'

import { useEffect, useMemo, useState } from 'react'
import ColumnFilter from '@/components/ColumnFilter'

interface CostRow {
  source: string
  code: string
  cost: number
}

type ColumnKey = 'source' | 'code' | 'cost'

const SOURCES: { table: string; codeField: string; label: string }[] = [
  { table: 'standard_equipment_items', codeField: 'protheus_code',      label: 'Cadastro de Equipamentos' },
  { table: 'accessories',              codeField: 'protheus_code',      label: 'Cadastro de Componentes' },
  { table: 'dependant_items',          codeField: 'protheus_item_code', label: 'Produtos Dependentes' },
]

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'source', label: 'Origem' },
  { key: 'code',   label: 'Código Protheus' },
  { key: 'cost',   label: 'Custo (R$)' },
]

function formatCost(cost: number): string {
  return cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getDisplayValue(row: CostRow, key: ColumnKey): string {
  if (key === 'cost') return formatCost(row.cost)
  const v = row[key]
  return v === '' || v === null || v === undefined ? 'N/A' : v
}

function applyFilters(rows: CostRow[], filters: Record<string, string[]>): CostRow[] {
  const active = Object.entries(filters).filter(([, v]) => v.length > 0)
  if (!active.length) return rows
  return rows.filter(row =>
    active.every(([key, vals]) => vals.includes(getDisplayValue(row, key as ColumnKey)))
  )
}

export default function CustosGeraisVmiPage() {
  const [rows, setRows] = useState<CostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [filterSearch, setFilterSearch] = useState<Record<string, string>>({})

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

  const filteredRows = useMemo(() => applyFilters(rows, colFilters), [rows, colFilters])

  // For each column: distinct display values from rows that pass ALL OTHER column filters
  // — gives cascading behavior, same as the table list pages
  const columnOptions = useMemo(() => {
    const result: Record<string, string[]> = {}
    for (const col of COLUMNS) {
      const otherFilters = Object.fromEntries(
        Object.entries(colFilters).filter(([name]) => name !== col.key)
      )
      const candidateRows = applyFilters(rows, otherFilters)
      const seen = new Set<string>()
      for (const row of candidateRows) seen.add(getDisplayValue(row, col.key))
      result[col.key] = Array.from(seen).sort((a, b) => {
        if (a === 'N/A') return -1
        if (b === 'N/A') return 1
        return a.localeCompare(b, 'pt-BR')
      })
    }
    return result
  }, [rows, colFilters])

  const hasActiveColFilters = Object.values(colFilters).some(v => v.length > 0)

  const handleToggleFilter = (name: string, val: string) => {
    setColFilters(prev => {
      const cur = prev[name] ?? []
      return { ...prev, [name]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] }
    })
  }

  const handleClearFilter = (name: string) => {
    setColFilters(prev => ({ ...prev, [name]: [] }))
  }

  return (
    <div className="p-8 flex flex-col gap-4">
      {/* Frozen header zone — stays pinned below the theme/zoom bar while only the rows scroll */}
      <div className="sticky top-9 z-20 bg-background pt-2 -mt-2">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end justify-between">
          <div>
            <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">
              Portifólio · custos-gerais-vmi
            </div>
            <h1 className="text-2xl font-bold text-on-surface">Custos Gerais VMI</h1>
            <p className="text-on-surface-variant text-sm mt-1">
              Consolidação dos custos padrão (cost_std) de todas as tabelas do catálogo
            </p>
          </div>
          {hasActiveColFilters && (
            <button
              onClick={() => { setColFilters({}); setFilterSearch({}) }}
              className="px-3 py-2 text-sm text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
            >
              ✕ Limpar filtros
            </button>
          )}
        </div>
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
                  {COLUMNS.map(col => (
                    <th key={col.key} className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono align-top min-w-[150px]">
                      <div>{col.label}</div>
                      <div className="mt-1.5">
                        <ColumnFilter
                          searchValue={filterSearch[col.key] ?? ''}
                          onSearchChange={v => setFilterSearch(prev => ({ ...prev, [col.key]: v }))}
                          selectedValues={colFilters[col.key] ?? []}
                          onToggleValue={v => handleToggleFilter(col.key, v)}
                          onClearValues={() => handleClearFilter(col.key)}
                          options={columnOptions[col.key] ?? []}
                        />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-outline text-sm">
                      Nenhum registro encontrado
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, i) => (
                    <tr key={`${row.source}-${row.code}-${i}`} className="hover:bg-surface-container-high transition-colors">
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap min-w-[150px]">{row.source}</td>
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap font-mono min-w-[150px]">{row.code}</td>
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap min-w-[150px]">{formatCost(row.cost)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="px-4 py-3 border-t border-outline-variant/30 text-xs text-outline font-mono">
              {filteredRows.length < rows.length
                ? <>{filteredRows.length} de {rows.length} registro{rows.length !== 1 ? 's' : ''} <span className="text-primary">· filtrado</span></>
                : <>{rows.length} registro{rows.length !== 1 ? 's' : ''}</>
              }
            </div>
          </>
        )}
      </div>
    </div>
  )
}
