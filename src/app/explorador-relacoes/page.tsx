'use client'

import { useState } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

interface EquipmentResult {
  type: 'equipment'
  code: string
  equipment: Row | null
  bom: Row[]
  compatibleAccessories: Row[]
  nonCombinable: Row[]
  dependants: Row[]
  rollerTables: Row[]
}

interface AccessoryResult {
  type: 'accessory'
  code: string
  accessory: Row
  groupName: string | null
  usedInEquipments: Row[]
  nonCombinable: Row[]
  dependants: Row[]
  rollerTables: Row[]
}

type Result = EquipmentResult | AccessoryResult

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null
  const active = status === 'active'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
      active ? 'text-green-400 border-green-500/40 bg-green-500/10' : 'text-outline border-outline-variant bg-surface-container'
    }`}>
      {status}
    </span>
  )
}

const TINTS = {
  blue:  { border: 'border-blue-500/30',  bg: 'bg-blue-500/[0.06]',  title: 'text-blue-400'  },
  amber: { border: 'border-amber-500/30', bg: 'bg-amber-500/[0.06]', title: 'text-amber-400' },
}

// Groups rows that carry a groupName (accessory_groups) — "Sem grupo" always sorts last.
function groupByAccessoryGroup(rows: Row[]): { groupName: string; items: Row[] }[] {
  const map = new Map<string, Row[]>()
  for (const r of rows) {
    const key = r.groupName || 'Sem grupo'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return Array.from(map.entries())
    .map(([groupName, items]) => ({ groupName, items }))
    .sort((a, b) => {
      if (a.groupName === 'Sem grupo') return 1
      if (b.groupName === 'Sem grupo') return -1
      return a.groupName.localeCompare(b.groupName, 'pt-BR')
    })
}

/** Section wrapper: a tinted, bordered panel with a bold header + count pill.
 *  `plain` renders children as-is (e.g. an accordion); otherwise wraps them in a grid. */
function SectionPanel({ title, tint, count, plain, children }: {
  title: string
  tint: keyof typeof TINTS
  count: number
  plain?: boolean
  children?: React.ReactNode
}) {
  const t = TINTS[tint]
  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} p-5 mb-5`}>
      <div className="flex items-center gap-3 mb-4">
        <h2 className={`text-lg font-bold ${t.title}`}>{title}</h2>
        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div className="text-sm text-outline italic">Nenhum registro</div>
      ) : plain ? (
        children
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{children}</div>
      )}
    </div>
  )
}

function Property({ label, value }: { label: string; value: unknown }) {
  const shown = value === null || value === undefined || value === '' ? '—' : String(value)
  return (
    <div className="flex justify-between gap-3">
      <span className="text-on-surface-variant font-medium">{label}</span>
      <span className="text-on-surface font-bold text-right">{shown}</span>
    </div>
  )
}

/** Full-property card for the searched Cadastro de Equipamentos item — every
 *  BOM field, not just the processor/memory summary shown for the other items. */
function EquipmentItemDetailCard({ r }: { r: Row }) {
  return (
    <div className="rounded-xl border-2 border-primary bg-primary/10 p-5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="font-mono text-sm font-bold px-2 py-1 rounded bg-surface-container-highest text-primary">
          {r.protheus_code}
        </div>
        <StatusBadge status={r.status} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
        <Property label="Processador" value={r.processor} />
        <Property label="Memória" value={r.memory} />
        <Property label="Armazenamento" value={r.storage} />
        <Property label="Placa Gráfica" value={r.graphics_card} />
        <Property label="Cap. Correia (kg)" value={r.conveyor_belt_load_capacity_kg} />
        <Property label="Potência Tubo (kV)" value={r.tube_power_kv} />
        <Property label="Certificado" value={r.certificate} />
        <Property label="Tipo Correia" value={r.conveyor_belt_type} />
        <Property label="Tipo Motopolia" value={r.motopolia_type} />
        <Property label="Idioma" value={r.language} />
        <Property label="Cor" value={r.color} />
        <Property label="Alerta" value={r.alertDescription} />
        <Property label="Custo (R$)" value={Number(r.cost_std ?? 0).toFixed(2)} />
      </div>
    </div>
  )
}

/** Full-property card for one accessory inside an expanded group — shows every
 *  catalog field (color, material, dimensions, cost, alert...) plus the
 *  compatibility rule's own fields (max quantity, operation time). */
function AccessoryDetailCard({ r }: { r: Row }) {
  const acc = r.accessory as Row | null
  return (
    <div className="rounded-lg border-2 border-outline-variant bg-surface-container-high p-4">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-bold text-on-surface text-base leading-snug">{r.accessoryName || 'N/A'}</div>
        <StatusBadge status={acc?.status} />
      </div>
      <div className="mb-3 inline-block font-mono text-sm font-bold px-2 py-1 rounded bg-primary text-on-primary">
        {r.protheus_code}
      </div>
      <div className="flex flex-col gap-1.5 text-sm border-t border-outline-variant pt-3">
        <Property label="Cor" value={acc?.color} />
        <Property label="Material Predom." value={acc?.predominant_material} />
        <Property label="Dimensão (mm)" value={acc?.dimensional_mm} />
        <Property label="Tam. Monitor (pol)" value={acc?.monitor_size} />
        <Property label="Qtd. Monitor Totem" value={acc?.quantity_monitor_totem} />
        <Property label="Custo (R$)" value={acc ? Number(acc.cost_std ?? 0).toFixed(2) : null} />
        <Property label="Alerta" value={r.alertDescription} />
        <Property label="Qtd. Máxima (regra)" value={r.maximum_quantity} />
        <Property label="Tempo Oper. (regra)" value={r.operation_time} />
      </div>
      {(acc?.description || r.description) && (
        <div className="mt-3 pt-2 border-t border-outline-variant text-xs text-on-surface-variant leading-relaxed">
          {acc?.description || r.description}
        </div>
      )}
    </div>
  )
}

/** Collapsed-by-default accordion of accessory groups — expanding a group reveals
 *  every accessory in it with its full set of properties. */
function AccessoryGroupAccordion({ rows }: { rows: Row[] }) {
  const groups = groupByAccessoryGroup(rows)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (name: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  return (
    <div className="flex flex-col gap-2">
      {groups.map(g => {
        const isOpen = expanded.has(g.groupName)
        return (
          <div key={g.groupName} className="rounded-lg border border-outline-variant bg-surface-container-high overflow-hidden">
            <button
              onClick={() => toggle(g.groupName)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-container-highest transition-colors"
            >
              <span className="font-bold text-on-surface text-sm">{g.groupName}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant">
                  {g.items.length}
                </span>
                <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              </span>
            </button>
            {isOpen && (
              <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {g.items.map(r => <AccessoryDetailCard key={r.id} r={r} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Generic grouper: buckets rows by a key, keeping the first label seen for that key.
function groupRowsBy(rows: Row[], keyFn: (r: Row) => string, labelFn: (r: Row) => string): { key: string; label: string; items: Row[] }[] {
  const map = new Map<string, { label: string; items: Row[] }>()
  for (const r of rows) {
    const key = keyFn(r)
    if (!map.has(key)) map.set(key, { label: labelFn(r), items: [] })
    map.get(key)!.items.push(r)
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, label: v.label, items: v.items }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/** Collapsed-by-default accordion for non_combinable_comps pairs: one row per
 *  group (an "X" component, or an equipment — whichever side is fixed for this
 *  view). Expanding it reveals a second cascade — the other-side components,
 *  sub-grouped by their own accessory group — each shown with every property. */
function NonCombinableAccordion({ rows, groupKey, groupLabel, groupCode, itemCode, itemLabel, itemAccessory, itemGroupName, itemAlert }: {
  rows: Row[]
  groupKey: (r: Row) => string
  groupLabel: (r: Row) => string
  groupCode?: (r: Row) => string | undefined
  itemCode: (r: Row) => string
  itemLabel: (r: Row) => string
  itemAccessory: (r: Row) => Row | null
  itemGroupName: (r: Row) => string | null
  itemAlert?: (r: Row) => string | null
}) {
  const groups = groupRowsBy(rows, groupKey, groupLabel)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <div className="flex flex-col gap-2">
      {groups.map(g => {
        const isOpen = expanded.has(g.key)
        const code = groupCode?.(g.items[0])
        const subGroups = groupRowsBy(
          g.items,
          r => itemGroupName(r) || 'Sem grupo',
          r => itemGroupName(r) || 'Sem grupo',
        )
        return (
          <div key={g.key} className="rounded-lg border border-outline-variant bg-surface-container-high overflow-hidden">
            <button
              onClick={() => toggle(g.key)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-container-highest transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-on-surface text-sm truncate">{g.label}</span>
                {code && <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface-container-highest text-primary shrink-0">{code}</span>}
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-error/15 text-error">
                  ✕ {g.items.length}
                </span>
                <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              </span>
            </button>
            {isOpen && (
              <div className="p-4 pt-0 flex flex-col gap-4">
                {subGroups.map(sg => (
                  <div key={sg.key}>
                    <div className="text-xs font-semibold text-error mb-2">
                      ✕ não combina com — {sg.label} <span className="text-outline font-normal">({sg.items.length})</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {sg.items.map(r => (
                        <AccessoryDetailCard
                          key={r.id}
                          r={{
                            id: r.id,
                            protheus_code: itemCode(r),
                            accessoryName: itemLabel(r),
                            accessory: itemAccessory(r),
                            alertDescription: itemAlert ? itemAlert(r) : null,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Simple entity card: name is the primary, prominent line; code is a small chip below it. */
function InfoCard({ name, code, highlight, footer }: {
  name: string
  code?: string
  highlight?: boolean
  footer?: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border-2 p-4 ${highlight ? 'border-primary bg-primary/10' : 'border-outline-variant bg-surface-container-high'}`}>
      <div className="font-bold text-on-surface text-base leading-snug">{name}</div>
      {code && (
        <div className="mt-1.5 inline-block font-mono text-xs px-1.5 py-0.5 rounded bg-surface-container-highest text-primary">
          {code}
        </div>
      )}
      {footer && <div className="mt-3 flex items-center justify-between gap-2">{footer}</div>}
    </div>
  )
}

/** Relational pair card: two sides joined by a connector badge — used for
 *  "não combina com" and "requer" links, where two codes/names relate to
 *  each other under a given equipment context. */
function PairCard({ context, leftName, leftCode, rightName, rightCode, connector, tone }: {
  context?: string | null
  leftName: string
  leftCode: string
  rightName: string
  rightCode: string
  connector: string
  tone: 'error' | 'primary'
}) {
  return (
    <div className="rounded-lg border-2 border-outline-variant bg-surface-container-high p-4">
      {context && <div className="text-xs font-semibold text-on-surface-variant mb-3 truncate">{context}</div>}
      <div className="flex items-stretch gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-on-surface text-sm leading-snug break-words">{leftName}</div>
          <div className="mt-1 font-mono text-xs text-primary truncate">{leftCode}</div>
        </div>
        <div className="shrink-0 flex items-center">
          <span className={`text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${
            tone === 'error' ? 'bg-error/15 text-error' : 'bg-primary/15 text-primary'
          }`}>
            {connector}
          </span>
        </div>
        <div className="flex-1 min-w-0 text-right">
          <div className="font-bold text-on-surface text-sm leading-snug break-words">{rightName}</div>
          <div className="mt-1 font-mono text-xs text-primary truncate">{rightCode}</div>
        </div>
      </div>
    </div>
  )
}

export default function ExploradorRelacoesPage() {
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState<Result | null>(null)

  const handleSearch = async () => {
    const code = input.trim()
    if (!code) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch(`/api/relations/${encodeURIComponent(code)}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Código não encontrado')
        return
      }
      setResult(json)
    } catch {
      setError('Erro ao buscar relações')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-7xl flex flex-col gap-4">
      <div>
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · explorador de relações
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Explorador de Relações</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Digite um código de Cadastro de Equipamentos ou de Cadastro de Componentes e veja tudo que está ligado a ele
        </p>
      </div>

      <div className="flex items-center gap-2 max-w-xl">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Ex: 27.04.00541"
          className="flex-1 bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 font-mono"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !input.trim()}
          className="px-5 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-error-container/20 border border-error/20 rounded-lg px-4 py-3 text-error text-sm max-w-xl">
          ⚠ {error}
        </div>
      )}

      {result?.type === 'equipment' && (
        <div className="mt-2">
          <div className="bg-surface-container border-2 border-primary/30 rounded-xl p-5 mb-6">
            <div className="text-xs font-mono text-outline uppercase tracking-[0.12em] mb-1">Equipamento</div>
            <div className="text-2xl font-bold text-on-surface">
              {result.equipment?.name ?? '—'} <span className="text-on-surface-variant font-normal text-lg">/ {result.equipment?.commercial_name}</span>
            </div>
            <div className="text-sm text-outline mt-2 font-mono">ID Leg. {result.equipment?.legacy_id} · código buscado: {result.code}</div>
          </div>

          <SectionPanel title="Cadastro de Equipamentos (BOM)" tint="blue" count={result.bom.length} plain>
            {result.bom.filter(r => r.isSearched).map(r => <EquipmentItemDetailCard key={r.id} r={r} />)}

            {result.bom.filter(r => !r.isSearched).length > 0 && (
              <>
                <div className="text-sm font-bold text-on-surface mt-2 mb-3">
                  Outros equipamentos deste grupo
                  <span className="text-outline font-normal"> ({result.bom.filter(r => !r.isSearched).length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {result.bom.filter(r => !r.isSearched).map(r => (
                    <InfoCard
                      key={r.id}
                      name={`${r.processor || '—'} · ${r.memory || '—'}`}
                      code={r.protheus_code}
                      footer={<>
                        <StatusBadge status={r.status} />
                        <span className="text-sm font-semibold text-on-surface-variant font-mono">R$ {Number(r.cost_std ?? 0).toFixed(2)}</span>
                      </>}
                    />
                  ))}
                </div>
              </>
            )}
          </SectionPanel>

          <SectionPanel title="Acessórios Compatíveis" tint="amber" count={result.compatibleAccessories.length} plain>
            <AccessoryGroupAccordion rows={result.compatibleAccessories} />
          </SectionPanel>

          <SectionPanel title="Produtos Não Combináveis" tint="amber" count={result.nonCombinable.length} plain>
            <NonCombinableAccordion
              rows={result.nonCombinable}
              groupKey={r => r.protheus_code}
              groupLabel={r => r.name1 || 'N/A'}
              groupCode={r => r.protheus_code}
              itemCode={r => r.remove_list_code}
              itemLabel={r => r.name2 || 'N/A'}
              itemAccessory={r => r.otherAccessory ?? null}
              itemGroupName={r => r.otherGroupName ?? null}
              itemAlert={r => r.otherAlertDescription ?? null}
            />
          </SectionPanel>

          <SectionPanel title="Produtos Dependentes" tint="amber" count={result.dependants.length}>
            {result.dependants.map(r => (
              <PairCard
                key={r.id}
                leftName={r.itemName || 'N/A'} leftCode={r.protheus_code}
                rightName={r.dependentName || 'N/A'} rightCode={r.protheus_item_code}
                connector={`→ requer x${r.quantity}`}
                tone="primary"
              />
            ))}
          </SectionPanel>

          <SectionPanel title="Mesas de Roletes" tint="amber" count={result.rollerTables.length}>
            {result.rollerTables.map(r => (
              <InfoCard
                key={r.id}
                name={r.accessoryName || 'N/A'}
                code={r.protheus_code}
                footer={<span className="text-xs font-bold text-outline uppercase font-mono">{r.type}</span>}
              />
            ))}
          </SectionPanel>
        </div>
      )}

      {result?.type === 'accessory' && (
        <div className="mt-2">
          <div className="bg-surface-container border-2 border-primary/30 rounded-xl p-5 mb-6">
            <div className="text-xs font-mono text-outline uppercase tracking-[0.12em] mb-1">Componente</div>
            <div className="text-2xl font-bold text-on-surface">
              {result.accessory.name} <span className="text-on-surface-variant font-normal font-mono text-base">/ {result.accessory.protheus_code}</span>
            </div>
            <div className="text-sm text-outline mt-2 flex items-center gap-3 flex-wrap">
              <span className="font-mono">Grupo: {result.groupName || 'N/A'}</span>
              <span className="font-mono">Custo: R$ {Number(result.accessory.cost_std ?? 0).toFixed(2)}</span>
              <StatusBadge status={result.accessory.status} />
            </div>
          </div>

          <SectionPanel title="Usado nestes Equipamentos" tint="blue" count={result.usedInEquipments.length}>
            {result.usedInEquipments.map(r => (
              <InfoCard
                key={r.id}
                name={r.equipmentName || 'N/A'}
                footer={<>
                  <StatusBadge status={r.status} />
                  {r.maximum_quantity != null && <span className="text-xs font-semibold text-outline">máx. {r.maximum_quantity}</span>}
                </>}
              />
            ))}
          </SectionPanel>

          <SectionPanel title="Produtos Não Combináveis" tint="amber" count={result.nonCombinable.length} plain>
            <NonCombinableAccordion
              rows={result.nonCombinable}
              groupKey={r => String(r.legacy_equipment_id)}
              groupLabel={r => r.equipmentName || 'N/A'}
              itemCode={r => r.otherCode}
              itemLabel={r => r.otherName || 'N/A'}
              itemAccessory={r => r.otherAccessory ?? null}
              itemGroupName={r => r.otherGroupName ?? null}
              itemAlert={r => r.otherAlertDescription ?? null}
            />
          </SectionPanel>

          <SectionPanel title="Produtos Dependentes" tint="amber" count={result.dependants.length}>
            {result.dependants.map(r => (
              <PairCard
                key={r.id}
                context={r.equipmentName}
                leftName={result.accessory.name} leftCode={result.accessory.protheus_code}
                rightName={r.otherName || 'N/A'} rightCode={r.otherCode}
                connector={r.role === 'item' ? `→ requer x${r.quantity}` : `← requerido por`}
                tone="primary"
              />
            ))}
          </SectionPanel>

          <SectionPanel title="Mesas de Roletes" tint="amber" count={result.rollerTables.length}>
            {result.rollerTables.map(r => (
              <InfoCard
                key={r.id}
                name={r.equipmentName || 'N/A'}
                footer={<span className="text-xs font-bold text-outline uppercase font-mono">{r.type}</span>}
              />
            ))}
          </SectionPanel>
        </div>
      )}
    </div>
  )
}
