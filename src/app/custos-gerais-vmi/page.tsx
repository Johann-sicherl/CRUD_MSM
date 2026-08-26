'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Field } from '@/lib/schema'
import { tables } from '@/lib/schema'
import { getCostItemKey } from '@/lib/csvBaseline'
import { exportVisibleData, parseImportFile } from '@/lib/importExport'
import { useAppAuth } from '@/lib/appAuthContext'
import ColumnFilter from '@/components/ColumnFilter'
import CostBulkEditModal from '@/components/CostBulkEditModal'
import CostImportReviewModal from '@/components/CostImportReviewModal'

// One row per physical record in the underlying tables. cost vem do arquivo
// local (local-data/real-costs.json), nunca do Supabase — lá cost_std é
// sempre 1, por sigilo (ver src/lib/localCostStore.ts). null = nenhum valor
// real foi capturado ainda pra esse registro (nunca veio de um CSV/edição).
interface PhysicalRow {
  id: string
  table: string
  code: string
  name: string | null
  cost: number | null
}

// One row per distinct Código Protheus — several PhysicalRow entries (even
// across different tables) collapse into a single CostRow here, since the
// same code always carries the same standard cost catalog-wide.
interface CostRow {
  code: string
  name: string | null
  cost: number | null
}

type ColumnKey = 'code' | 'name' | 'cost'

const SOURCES: { table: string; codeField: string; label: string }[] = [
  { table: 'standard_equipment_items', codeField: 'protheus_code',      label: 'Cadastro de Equipamentos' },
  { table: 'accessories',              codeField: 'protheus_code',      label: 'Cadastro de Componentes' },
  { table: 'dependant_items',          codeField: 'protheus_item_code', label: 'Produtos Dependentes' },
]

const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'code',   label: 'Código Protheus' },
  { key: 'name',   label: 'Nome' },
  { key: 'cost',   label: 'Custo (R$)' },
]

const VIRTUAL_FIELDS: Field[] = [
  { name: 'code',   label: 'Código Protheus', type: 'text',    nullable: false },
  { name: 'cost',   label: 'Custo (R$)',      type: 'decimal', nullable: false },
]

function formatCost(cost: number | null): string {
  if (cost === null) return 'N/A'
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

function rowKey(row: CostRow): string {
  return row.code
}

export default function CustosGeraisVmiPage() {
  const { user: appUser } = useAppAuth()
  const [rows, setRows] = useState<CostRow[]>([])
  const [allPhysical, setAllPhysical] = useState<PhysicalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [filterSearch, setFilterSearch] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  // "Editar" de uma linha só — mesmo modal do "Alterar selecionados", só que
  // sem precisar marcar checkbox. null = fechado.
  const [editingRow, setEditingRow] = useState<CostRow | null>(null)
  const [importRows, setImportRows] = useState<Record<string, string>[] | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Códigos com custo alvo sugerido pelo Admin ainda pendente de aprovação
  // da Comercial (fila pending_target_cost, status 'novo' só — 'em_alteracao'
  // já foi repassado, não faz mais parte do que falta exportar). Só o Admin
  // usa isso (botão "Exportar Custos Sugeridos" abaixo).
  const [pendingNovoCodes, setPendingNovoCodes] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [responses, localCostResponses, equipmentsRes] = await Promise.all([
        Promise.all(SOURCES.map(s => fetch(`/api/${s.table}?limit=25000`))),
        Promise.all(SOURCES.map(s => fetch(`/api/local-costs?table=${s.table}`))),
        // Só pra resolver o nome do equipamento (standard_equipment_items não
        // tem nome próprio, só liga em Grupo de Equipamentos).
        fetch('/api/equipments?limit=25000'),
      ])
      if (responses.some(r => !r.ok) || !equipmentsRes.ok) {
        setError('Erro ao carregar dados')
        setLoading(false)
        return
      }
      const jsons = await Promise.all(responses.map(r => r.json()))
      const equipmentsJson = await equipmentsRes.json()
      // local-costs nunca deve derrubar a tela — se falhar, esse source vira
      // {} e as linhas dele ficam N/A até o arquivo local existir/recarregar.
      const localCostJsons: Record<string, { values: Record<string, number | null> }>[] =
        await Promise.all(localCostResponses.map(r => r.ok ? r.json() : {}))

      // Nome por Código Protheus (accessories.name) — cobre as linhas de
      // Cadastro de Componentes diretamente e, via protheus_item_code, as de
      // Produtos Dependentes (o código dependente é sempre um acessório).
      const accessoriesIdx = SOURCES.findIndex(s => s.table === 'accessories')
      const accessoryNameByCode = new Map<string, string>(
        ((jsons[accessoriesIdx]?.data || []) as Record<string, unknown>[])
          .map(r => [String(r.protheus_code ?? ''), String(r.name ?? '')])
      )
      // Nome do equipamento por ID legado — usado pelas linhas de Cadastro
      // de Equipamentos (standard_equipment_items.legacy_equipment_id).
      const equipmentNameByLegacyId = new Map<string, string>(
        ((equipmentsJson.data || []) as Record<string, unknown>[])
          .map(r => [String(r.legacy_id ?? ''), String(r.name ?? '')])
      )

      const physical: PhysicalRow[] = jsons.flatMap((json, i) => {
        const src = SOURCES[i]
        const schema = tables[src.table]
        const localCosts = localCostJsons[i] ?? {}
        const data: Record<string, unknown>[] = json.data || []
        return data.map(row => {
          const key = getCostItemKey(src.table, schema, row)
          const real = localCosts[key]?.values?.cost_std
          const code = String(row[src.codeField] ?? '')
          const name = src.table === 'standard_equipment_items'
            ? equipmentNameByLegacyId.get(String(row.legacy_equipment_id ?? '')) ?? null
            : accessoryNameByCode.get(code) ?? null
          return {
            id: String(row.id ?? ''),
            table: src.table,
            code,
            name: name || null,
            // cost_std no Supabase é sempre 1 (sigilo) — o valor real só
            // existe no arquivo local; null = nunca foi capturado ainda.
            cost: typeof real === 'number' ? real : null,
          }
        })
      })
      setAllPhysical(physical)

      // SELECT DISTINCT por Código Protheus: o mesmo código carrega o mesmo
      // custo padrão em todo o catálogo, mesmo aparecendo em tabelas diferentes
      // — a grade mostra um único item consolidado por código; o update
      // atinge todos os registros físicos com esse código. Se o mesmo código
      // tiver custo real (ou nome) capturado numa tabela mas não em outra,
      // prefere o valor presente (evita mostrar N/A quando o dado já existe
      // em algum lugar).
      const distinct = new Map<string, CostRow>()
      for (const p of physical) {
        const existing = distinct.get(p.code)
        if (!existing) { distinct.set(p.code, { code: p.code, name: p.name, cost: p.cost }); continue }
        if (!existing.name && p.name) existing.name = p.name
        if (existing.cost === null && p.cost !== null) existing.cost = p.cost
      }
      setRows(Array.from(distinct.values()))
    } catch {
      setError('Erro ao carregar dados')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!appUser.isAdmin) return
    fetch('/api/pending-target-cost')
      .then(r => r.ok ? r.json() : {})
      .then((data: Record<string, { status: string }>) => {
        setPendingNovoCodes(new Set(
          Object.entries(data).filter(([, v]) => v.status === 'novo').map(([code]) => code)
        ))
      })
      .catch(() => {})
  }, [appUser.isAdmin])

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

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3500)
  }

  const handleExportVisible = () => {
    const headers = COLUMNS.map(c => c.label)
    // cost vai como número real (não texto formatado) para o Excel reconhecer
    // a coluna como numérica — exibição/separador ficam a cargo do próprio Excel.
    const rowData = filteredRows.map(row => COLUMNS.map(c =>
      c.key === 'cost' ? (row.cost ?? '') : getDisplayValue(row, c.key)
    ))
    exportVisibleData(headers, rowData, 'custos_gerais_vmi.xlsx')
  }

  // Só o Admin vê este botão. Exporta, no MESMO formato que "↑ Importar
  // Excel" já espera (Código Protheus / Custo (R$)), só os códigos ainda
  // pendentes de aprovação de custo alvo pela Comercial. O custo aqui é o
  // sugerido pelo Admin — nunca vai pro Supabase, só existe no arquivo local
  // desta máquina; este arquivo é o único jeito de a Comercial vê-lo, e o
  // envio (e-mail, WhatsApp etc.) é manual, fora do sistema.
  const handleExportSuggestedCosts = () => {
    const pendingRows = rows.filter(r => pendingNovoCodes.has(r.code))
    const headers = COLUMNS.map(c => c.label)
    const rowData = pendingRows.map(row => COLUMNS.map(c =>
      c.key === 'cost' ? (row.cost ?? '') : getDisplayValue(row, c.key)
    ))
    exportVisibleData(headers, rowData, 'custos_sugeridos_pendentes.xlsx')
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportLoading(true)
    try {
      const parsed = await parseImportFile(file, VIRTUAL_FIELDS)
      setImportRows(parsed)
      window.dispatchEvent(new CustomEvent('import-review:open'))
    } catch (err) {
      showToast((err as Error).message || 'Erro ao importar arquivo', true)
    } finally {
      setImportLoading(false)
    }
  }

  const selectedRows = rows.filter(r => selectedIds.has(rowKey(r)))

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
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {hasActiveColFilters && (
              <button
                onClick={() => { setColFilters({}); setFilterSearch({}) }}
                className="px-3 py-2 text-sm text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
              >
                ✕ Limpar filtros
              </button>
            )}
            {selectedIds.size > 0 && (
              <button
                onClick={() => setBulkEditOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-500 transition-colors whitespace-nowrap"
              >
                ✎ Alterar {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
              </button>
            )}
            <button
              onClick={handleExportVisible}
              disabled={filteredRows.length === 0}
              title={`Exportar ${filteredRows.length} registro${filteredRows.length !== 1 ? 's' : ''} visíveis para Excel`}
              className="flex items-center gap-1.5 px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ↓ Exportar dados
            </button>
            {appUser.isAdmin && (
              <button
                onClick={handleExportSuggestedCosts}
                disabled={pendingNovoCodes.size === 0}
                title="Exporta os custos alvo sugeridos ainda não repassados à Comercial — envie este arquivo pra ela importar via 'Importar Excel' na máquina dela"
                className="flex items-center gap-1.5 px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ↓ Exportar Custos Sugeridos{pendingNovoCodes.size > 0 ? ` (${pendingNovoCodes.size})` : ''}
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importLoading}
              className="flex items-center gap-1.5 px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {importLoading ? '…' : '↑ Importar Excel'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
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
                  <th className="px-3 py-3 w-8 align-top">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(rowKey(r)))}
                      onChange={e => {
                        const keys = filteredRows.map(rowKey)
                        setSelectedIds(e.target.checked ? new Set(keys) : new Set())
                      }}
                    />
                  </th>
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
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono align-top">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 2} className="px-4 py-12 text-center text-outline text-sm">
                      Nenhum registro encontrado
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, i) => {
                    const key = rowKey(row)
                    const isSelected = selectedIds.has(key)
                    return (
                      <tr key={key || i} className={`hover:bg-surface-container-high transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
                        <td className="px-3 py-3 w-8">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={isSelected}
                            onChange={e => setSelectedIds(prev => {
                              const next = new Set(prev)
                              e.target.checked ? next.add(key) : next.delete(key)
                              return next
                            })}
                          />
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap font-mono min-w-[150px]">{row.code}</td>
                        <td className="px-4 py-3 text-on-surface-variant min-w-[200px]">{row.name ?? 'N/A'}</td>
                        <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap min-w-[150px]">{formatCost(row.cost)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => setEditingRow(row)}
                            className="text-primary hover:underline text-xs font-medium"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    )
                  })
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

      {(bulkEditOpen || editingRow) && (
        <CostBulkEditModal
          rows={(editingRow ? [editingRow] : selectedRows).flatMap(r =>
            allPhysical
              .filter(p => p.code === r.code)
              .map(p => ({ id: p.id, table: p.table }))
          )}
          onClose={() => { setBulkEditOpen(false); setEditingRow(null) }}
          onSaved={(ok, fail) => {
            setBulkEditOpen(false)
            setEditingRow(null)
            setSelectedIds(new Set())
            fetchData()
            showToast(
              fail === 0
                ? `${ok} registro${ok !== 1 ? 's' : ''} atualizado${ok !== 1 ? 's' : ''} com sucesso`
                : `${ok} atualizado${ok !== 1 ? 's' : ''}, ${fail} com erro`,
              fail > 0,
            )
          }}
        />
      )}

      {importRows && (
        <CostImportReviewModal
          sourceRows={allPhysical}
          parsedRows={importRows}
          onClose={() => {
            setImportRows(null)
            window.dispatchEvent(new CustomEvent('import-review:close'))
          }}
          onDone={(ok, errors) => {
            setImportRows(null)
            window.dispatchEvent(new CustomEvent('import-review:close'))
            fetchData()
            showToast(
              errors.length === 0
                ? `${ok} registro${ok !== 1 ? 's' : ''} atualizado${ok !== 1 ? 's' : ''} com sucesso`
                : `${ok} atualizado${ok !== 1 ? 's' : ''}, ${errors.length} com erro`,
              errors.length > 0,
            )
          }}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-lg shadow-lg text-sm animate-fade-in border ${
          toast.isError
            ? 'bg-error-container border-error/30 text-on-error-container'
            : 'bg-surface-container-highest border-outline-variant text-on-surface'
        }`}>
          {toast.isError ? '✕' : '✓'} {toast.msg}
        </div>
      )}
    </div>
  )
}
