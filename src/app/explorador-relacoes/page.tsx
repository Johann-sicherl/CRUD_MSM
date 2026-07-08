'use client'

import { useEffect, useState } from 'react'

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

/** Prominent name + code pairing used as a card's top caption — the code renders
 *  as a solid high-contrast badge instead of small colored text. */
function NameCodeCaption({ name, code }: { name: string; code: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-bold text-on-surface text-sm">{name}</span>
      <span className="font-mono text-sm font-bold px-2 py-0.5 rounded bg-primary text-on-primary">{code}</span>
    </div>
  )
}

/** Tab-separated header+value row — pasting this into Excel drops each field
 *  into its own column, with the label row on top. */
function tsvFromFields(fields: { label: string; value: unknown }[]): string {
  const cell = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v).replace(/\t|\n/g, ' '))
  const headers = fields.map(f => f.label).join('\t')
  const values = fields.map(f => cell(f.value)).join('\t')
  return `${headers}\n${values}`
}

/** Multi-row table (one header row + one row per item) — for copying an
 *  entire expanded group at once, ready to paste into Excel. */
function tsvFromRows(rowsFields: { label: string; value: unknown }[][]): string {
  if (rowsFields.length === 0) return ''
  const cell = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v).replace(/\t|\n/g, ' '))
  const headers = rowsFields[0].map(f => f.label).join('\t')
  const lines = rowsFields.map(fields => fields.map(f => cell(f.value)).join('\t'))
  return [headers, ...lines].join('\n')
}

/** Small copy-to-clipboard button — shows a checkmark briefly after copying. */
function CopyButton({ getText, title }: { getText: () => string; title?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={e => {
        e.stopPropagation()
        navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }).catch(() => {})
      }}
      title={title ?? 'Copiar dados (colar no Excel)'}
      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors ${
        copied ? 'text-green-400' : 'text-outline hover:text-primary hover:bg-surface-container-highest'
      }`}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

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
/** Shared field list for a Cadastro de Equipamentos (BOM) row — used both by
 *  the card itself and by the group-level/"copiar tudo" buttons. */
function buildEquipmentItemFields(r: Row) {
  return [
    { label: 'Cód. Protheus', value: r.protheus_code },
    { label: 'Status', value: r.status },
    { label: 'Processador', value: r.processor },
    { label: 'Memória', value: r.memory },
    { label: 'Armazenamento', value: r.storage },
    { label: 'Placa Gráfica', value: r.graphics_card },
    { label: 'Cap. Correia (kg)', value: r.conveyor_belt_load_capacity_kg },
    { label: 'Potência Tubo (kV)', value: r.tube_power_kv },
    { label: 'Certificado', value: r.certificate },
    { label: 'Tipo Correia', value: r.conveyor_belt_type },
    { label: 'Tipo Motopolia', value: r.motopolia_type },
    { label: 'Idioma', value: r.language },
    { label: 'Cor', value: r.color },
    { label: 'Alerta', value: r.alertDescription },
    { label: 'Custo (R$)', value: Number(r.cost_std ?? 0).toFixed(2) },
  ]
}

function EquipmentItemDetailCard({ r }: { r: Row }) {
  const fields = buildEquipmentItemFields(r)
  return (
    <div className="rounded-xl border-2 border-primary bg-primary/10 p-5 mb-4">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="font-mono text-sm font-bold px-2 py-1 rounded bg-surface-container-highest text-primary">
          {r.protheus_code}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={r.status} />
          <CopyButton getText={() => tsvFromFields(fields)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-sm border-t border-outline-variant pt-3">
        {fields.map(f => <Property key={f.label} label={f.label} value={f.value} />)}
      </div>
    </div>
  )
}

/** Shared field list for an accessory-cascade row — used both by the card
 *  itself and by the group-level "copy all" button. */
function buildAccessoryFields(
  r: Row,
  extra?: { label: string; value: unknown }[],
  prefix?: { label: string; value: unknown }[],
) {
  const acc = r.accessory as Row | null
  return [
    ...(prefix ?? []),
    { label: 'Cód. Protheus', value: r.protheus_code },
    { label: 'Nome', value: r.accessoryName },
    { label: 'Grupo', value: r.groupName },
    { label: 'Status', value: acc?.status },
    ...(extra ?? []),
    { label: 'Cor', value: acc?.color },
    { label: 'Material Predom.', value: acc?.predominant_material },
    { label: 'Dimensão (mm)', value: acc?.dimensional_mm },
    { label: 'Tam. Monitor (pol)', value: acc?.monitor_size },
    { label: 'Qtd. Monitor Totem', value: acc?.quantity_monitor_totem },
    { label: 'Custo (R$)', value: acc ? Number(acc.cost_std ?? 0).toFixed(2) : null },
    { label: 'Alerta', value: r.alertDescription },
    { label: 'Qtd. Máxima (regra)', value: r.maximum_quantity },
    { label: 'Tempo Oper. (regra)', value: r.operation_time },
  ]
}

/** Full-property card for one accessory inside an expanded group — shows every
 *  catalog field (color, material, dimensions, cost, alert...) plus the
 *  compatibility rule's own fields (max quantity, operation time). */
function AccessoryDetailCard({ r, extra, prefix, topCaption, hideStatus, hideCatalogFields }: {
  r: Row
  extra?: { label: string; value: unknown }[]
  prefix?: { label: string; value: unknown }[]
  topCaption?: React.ReactNode
  hideStatus?: boolean
  /** Hides the accessory catalog's own physical properties (color, material,
   *  dimension, monitor size...) — for relations whose underlying table has
   *  no such concept (e.g. dependant_items). */
  hideCatalogFields?: boolean
}) {
  const acc = r.accessory as Row | null
  const fields = buildAccessoryFields(r, extra, prefix)
  return (
    <div className="rounded-lg border-2 border-outline-variant bg-surface-container-high p-4">
      {topCaption && (
        <div className="mb-3 pb-3 border-b border-outline-variant">
          {topCaption}
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-bold text-on-surface text-base leading-snug">{r.accessoryName || 'N/A'}</div>
        <div className="flex items-center gap-2 shrink-0">
          {!hideStatus && <StatusBadge status={acc?.status} />}
          <CopyButton getText={() => tsvFromFields(fields)} />
        </div>
      </div>
      <div className="mb-3 inline-block font-mono text-sm font-bold px-2 py-1 rounded bg-primary text-on-primary">
        {r.protheus_code}
      </div>
      {!acc && (
        <div className="mb-3 text-xs text-error italic">Não encontrado em Cadastro de Componentes</div>
      )}
      <div className="flex flex-col gap-1.5 text-sm border-t border-outline-variant pt-3">
        {extra?.map((e, i) => <Property key={`extra-${i}`} label={e.label} value={e.value} />)}
        {!hideCatalogFields && (
          <>
            <Property label="Cor" value={acc?.color} />
            <Property label="Material Predom." value={acc?.predominant_material} />
            <Property label="Dimensão (mm)" value={acc?.dimensional_mm} />
            <Property label="Tam. Monitor (pol)" value={acc?.monitor_size} />
            <Property label="Qtd. Monitor Totem" value={acc?.quantity_monitor_totem} />
          </>
        )}
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

/** Collapsed-by-default accordion, one row per equipment that uses the searched
 *  accessory — expanding one reveals the ID Leg., the rule's own description
 *  and every Cadastro de Equipamentos item in that group with full properties. */
function UsedInEquipmentsAccordion({ rows }: { rows: Row[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [copiedAll, setCopiedAll] = useState(false)

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const allBom: Row[] = rows.flatMap(r => (r.bom || []) as Row[])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button
          onClick={() => {
            navigator.clipboard.writeText(tsvFromRows(allBom.map(buildEquipmentItemFields))).then(() => {
              setCopiedAll(true)
              setTimeout(() => setCopiedAll(false), 1500)
            }).catch(() => {})
          }}
          title="Copiar todos os itens de Cadastro de Equipamentos (colar no Excel)"
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border transition-colors ${
            copiedAll ? 'border-green-500/40 text-green-400' : 'border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'
          }`}
        >
          {copiedAll ? '✓ Copiado' : `⧉ Copiar tudo (${allBom.length})`}
        </button>
      </div>
      {rows.map(r => {
        const eq = r.equipment as Row | null
        const bom: Row[] = r.bom || []
        const isOpen = expanded.has(r.id)
        return (
          <div key={r.id} className="rounded-lg border border-outline-variant bg-surface-container-high overflow-hidden">
            <div
              onClick={() => toggle(r.id)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-container-highest transition-colors cursor-pointer"
            >
              <span className="font-bold text-on-surface text-sm truncate">{eq?.name || 'N/A'}</span>
              <span className="flex items-center gap-3 shrink-0">
                <StatusBadge status={r.status} />
                <CopyButton
                  getText={() => tsvFromRows(bom.map(buildEquipmentItemFields))}
                  title="Copiar todos os itens deste equipamento (colar no Excel)"
                />
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                  {bom.length}
                </span>
                <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              </span>
            </div>
            {isOpen && (
              <div className="p-4 pt-0">
                <div className="mb-3 inline-block font-mono text-sm font-bold px-2 py-1 rounded bg-primary text-on-primary">
                  ID Leg. {eq?.legacy_id ?? '—'}
                </div>
                {!eq && (
                  <div className="mb-3 text-xs text-error italic">Não encontrado em Grupo de Equipamentos</div>
                )}
                {r.description && (
                  <div className="mb-3 pb-3 border-b border-outline-variant text-xs text-on-surface-variant leading-relaxed">
                    {r.description}
                  </div>
                )}
                <div className="text-xs font-bold text-on-surface-variant mb-2 border-t border-outline-variant pt-3">
                  Cadastro de Equipamentos <span className="text-outline font-normal">({bom.length})</span>
                </div>
                {bom.length === 0 ? (
                  <div className="text-xs text-outline italic">Nenhum código cadastrado neste grupo</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {bom.map(b => <EquipmentItemDetailCard key={b.id} r={b} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Collapsed-by-default accordion of accessory groups — expanding a group reveals
 *  every accessory in it with its full set of properties. */
function AccessoryGroupAccordion({ rows }: { rows: Row[] }) {
  const groups = groupByAccessoryGroup(rows)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [copiedAll, setCopiedAll] = useState(false)

  const toggle = (name: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button
          onClick={() => {
            navigator.clipboard.writeText(tsvFromRows(rows.map(r => buildAccessoryFields(r)))).then(() => {
              setCopiedAll(true)
              setTimeout(() => setCopiedAll(false), 1500)
            }).catch(() => {})
          }}
          title="Copiar todos os acessórios compatíveis (colar no Excel)"
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border transition-colors ${
            copiedAll ? 'border-green-500/40 text-green-400' : 'border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'
          }`}
        >
          {copiedAll ? '✓ Copiado' : `⧉ Copiar tudo (${rows.length})`}
        </button>
      </div>
      {groups.map(g => {
        const isOpen = expanded.has(g.groupName)
        return (
          <div key={g.groupName} className="rounded-lg border border-outline-variant bg-surface-container-high overflow-hidden">
            <div
              onClick={() => toggle(g.groupName)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-container-highest transition-colors cursor-pointer"
            >
              <span className="font-bold text-on-surface text-sm">{g.groupName}</span>
              <span className="flex items-center gap-3">
                <CopyButton
                  getText={() => tsvFromRows(g.items.map(r => buildAccessoryFields(r)))}
                  title="Copiar todos os itens deste grupo (colar no Excel)"
                />
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant">
                  {g.items.length}
                </span>
                <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              </span>
            </div>
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

/** Collapsed-by-default accordion for pair-style relations (non_combinable_comps,
 *  dependant_items): one row per group (an "X" component, or an equipment —
 *  whichever side is fixed for this view). Expanding it reveals a second
 *  cascade — the other-side components, sub-grouped by their own accessory
 *  group — each shown with every property. */
function RelationAccordion({
  rows, groupKey, groupLabel, groupCode,
  itemCode, itemLabel, itemAccessory, itemGroupName, itemAlert, itemExtra, itemPrefix,
  connector, tone, nested = true, copyAll = false, hideStatus = false, hideCatalogFields = false,
}: {
  rows: Row[]
  groupKey: (r: Row) => string
  groupLabel: (r: Row) => string
  groupCode?: (r: Row) => string | undefined
  itemCode: (r: Row) => string
  itemLabel: (r: Row) => string
  itemAccessory: (r: Row) => Row | null
  itemGroupName?: (r: Row) => string | null
  itemAlert?: (r: Row) => string | null
  itemExtra?: (r: Row) => { label: string; value: unknown }[]
  /** Fields rendered before Cód. Protheus/Nome/Grupo — for a reference item that
   *  should read first (e.g. the base item that triggers a dependency). */
  itemPrefix?: (r: Row) => { label: string; value: unknown }[]
  connector: (r: Row) => React.ReactNode
  tone: 'error' | 'primary'
  /** false = a single flat level (e.g. group already reflects the item's own
   *  accessory group); true = also sub-group each group's items by itemGroupName. */
  nested?: boolean
  /** Adds a top "copiar tudo" button and a per-group copy button, mirroring
   *  Acessórios Compatíveis — enable where a bulk export of the cascade makes sense. */
  copyAll?: boolean
  /** Hides the accessory catalog status badge — for relations whose underlying
   *  table has no status concept of its own (e.g. dependant_items). */
  hideStatus?: boolean
  /** Hides the accessory catalog's own physical properties (color, material,
   *  dimension, monitor size...) — for relations whose underlying table has
   *  no such concept (e.g. dependant_items). */
  hideCatalogFields?: boolean
}) {
  const groups = groupRowsBy(rows, groupKey, groupLabel)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [copiedAll, setCopiedAll] = useState(false)
  const toneBadge = tone === 'error' ? 'bg-error/15 text-error' : 'bg-primary/15 text-primary'

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const buildFields = (r: Row) => buildAccessoryFields(
    {
      id: r.id,
      protheus_code: itemCode(r),
      accessoryName: itemLabel(r),
      groupName: itemGroupName ? itemGroupName(r) : null,
      accessory: itemAccessory(r),
      alertDescription: itemAlert ? itemAlert(r) : null,
    },
    itemExtra ? itemExtra(r) : undefined,
    itemPrefix ? itemPrefix(r) : undefined,
  )

  const renderItem = (r: Row) => (
    <AccessoryDetailCard
      key={r.id}
      r={{
        id: r.id,
        protheus_code: itemCode(r),
        accessoryName: itemLabel(r),
        groupName: itemGroupName ? itemGroupName(r) : null,
        accessory: itemAccessory(r),
        alertDescription: itemAlert ? itemAlert(r) : null,
      }}
      extra={itemExtra ? itemExtra(r) : undefined}
      prefix={itemPrefix ? itemPrefix(r) : undefined}
      topCaption={connector(r)}
      hideStatus={hideStatus}
      hideCatalogFields={hideCatalogFields}
    />
  )

  return (
    <div className="flex flex-col gap-2">
      {copyAll && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              navigator.clipboard.writeText(tsvFromRows(rows.map(buildFields))).then(() => {
                setCopiedAll(true)
                setTimeout(() => setCopiedAll(false), 1500)
              }).catch(() => {})
            }}
            title="Copiar todos os itens desta cascata (colar no Excel)"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border transition-colors ${
              copiedAll ? 'border-green-500/40 text-green-400' : 'border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'
            }`}
          >
            {copiedAll ? '✓ Copiado' : `⧉ Copiar tudo (${rows.length})`}
          </button>
        </div>
      )}
      {groups.map(g => {
        const isOpen = expanded.has(g.key)
        const code = groupCode?.(g.items[0])
        const subGroups = nested && itemGroupName ? groupRowsBy(
          g.items,
          r => itemGroupName(r) || 'Sem grupo',
          r => itemGroupName(r) || 'Sem grupo',
        ) : null
        return (
          <div key={g.key} className="rounded-lg border border-outline-variant bg-surface-container-high overflow-hidden">
            <div
              onClick={() => toggle(g.key)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-container-highest transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-on-surface text-sm truncate">{g.label}</span>
                {code && <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface-container-highest text-primary shrink-0">{code}</span>}
              </span>
              <span className="flex items-center gap-3 shrink-0">
                {copyAll && (
                  <CopyButton
                    getText={() => tsvFromRows(g.items.map(buildFields))}
                    title="Copiar todos os itens deste grupo (colar no Excel)"
                  />
                )}
                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${toneBadge}`}>
                  {g.items.length}
                </span>
                <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              </span>
            </div>
            {isOpen && (
              <div className="p-4 pt-0">
                {subGroups ? (
                  <div className="flex flex-col gap-4">
                    {subGroups.map(sg => (
                      <div key={sg.key}>
                        <div className="text-sm font-bold text-on-surface mb-2">
                          {sg.label} <span className="text-outline font-normal">({sg.items.length})</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          {sg.items.map(renderItem)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {g.items.map(renderItem)}
                  </div>
                )}
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

interface CodeOption {
  code: string
  label: string
  group?: string
}

/** Modal listing every available code from Cadastro de Equipamentos and
 *  Cadastro de Componentes, split only by which catalog they come from —
 *  no further grouping. Picking one runs the search immediately. */
function CodePickerModal({ onClose, onPick }: { onClose: () => void; onPick: (code: string) => void }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [equipmentCodes, setEquipmentCodes] = useState<CodeOption[]>([])
  const [componentCodes, setComponentCodes] = useState<CodeOption[]>([])

  useEffect(() => {
    (async () => {
      try {
        const [eqRes, compRes, groupRes, accGroupRes] = await Promise.all([
          fetch('/api/standard_equipment_items?limit=25000'),
          fetch('/api/accessories?limit=25000'),
          fetch('/api/equipments?limit=25000'),
          fetch('/api/accessory_groups?limit=25000'),
        ])
        if (!eqRes.ok || !compRes.ok || !groupRes.ok || !accGroupRes.ok) { setError('Erro ao carregar códigos'); setLoading(false); return }
        const [eqJson, compJson, groupJson, accGroupJson] = await Promise.all([eqRes.json(), compRes.json(), groupRes.json(), accGroupRes.json()])
        const equipNameByLegacyId: Record<number, string> = {}
        for (const g of (groupJson.data || [])) equipNameByLegacyId[g.legacy_id] = g.name
        const accGroupNameByLegacyId: Record<number, string> = {}
        for (const g of (accGroupJson.data || [])) accGroupNameByLegacyId[g.legacy_id] = g.name
        setEquipmentCodes(
          (eqJson.data || [])
            .slice()
            .sort((a: Row, b: Row) => (a.legacy_equipment_id ?? 0) - (b.legacy_equipment_id ?? 0))
            .map((r: Row) => ({ code: r.protheus_code, label: equipNameByLegacyId[r.legacy_equipment_id] || 'N/A' }))
        )
        setComponentCodes(
          (compJson.data || [])
            .slice()
            .sort((a: Row, b: Row) =>
              (a.legacy_group_id ?? 0) - (b.legacy_group_id ?? 0)
              || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
            )
            .map((r: Row) => ({
              code: r.protheus_code,
              label: r.name || 'N/A',
              group: r.legacy_group_id != null ? (accGroupNameByLegacyId[r.legacy_group_id] || 'Sem grupo') : 'Sem grupo',
            }))
        )
      } catch {
        setError('Erro ao carregar códigos')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const matches = (o: CodeOption) => {
    const f = filter.trim().toLowerCase()
    if (!f) return true
    return o.code.toLowerCase().includes(f) || o.label.toLowerCase().includes(f) || (o.group?.toLowerCase().includes(f) ?? false)
  }
  const filteredEquipment = equipmentCodes.filter(matches)
  const filteredComponent = componentCodes.filter(matches)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-6xl max-h-[85vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant shrink-0">
          <h2 className="text-base font-semibold text-on-surface">Buscar código</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-3 border-b border-outline-variant shrink-0">
          <input
            type="text"
            autoFocus
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filtrar por código ou nome…"
            className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-outline gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono">Carregando…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16 text-error text-sm">⚠ {error}</div>
        ) : (
          <div className="flex-1 overflow-auto grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-outline-variant">
            <div className="p-4">
              <div className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-2">
                Cadastro de Equipamentos <span className="text-outline font-normal">({filteredEquipment.length})</span>
              </div>
              <div className="flex flex-col gap-1">
                {filteredEquipment.length === 0 ? (
                  <div className="text-xs text-outline italic">Nenhum código encontrado</div>
                ) : filteredEquipment.map(o => (
                  <button
                    key={o.code}
                    onClick={() => onPick(o.code)}
                    className="text-left px-2 py-1.5 rounded hover:bg-surface-container-high transition-colors"
                  >
                    <span className="font-mono text-xs text-primary">{o.code}</span>
                    <span className="ml-2 text-xs text-on-surface-variant">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wide mb-2">
                Cadastro de Componentes <span className="text-outline font-normal">({filteredComponent.length})</span>
              </div>
              <div className="flex flex-col gap-1">
                {filteredComponent.length === 0 ? (
                  <div className="text-xs text-outline italic">Nenhum código encontrado</div>
                ) : filteredComponent.map(o => (
                  <button
                    key={o.code}
                    onClick={() => onPick(o.code)}
                    className="text-left px-2 py-1.5 rounded hover:bg-surface-container-high transition-colors"
                  >
                    <span className="font-mono text-xs text-primary">{o.code}</span>
                    {o.group && <span className="ml-2 text-xs text-outline">{o.group} ·</span>}
                    <span className="ml-2 text-xs text-on-surface-variant">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ExploradorRelacoesPage() {
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState<Result | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const handleSearch = async (codeOverride?: string) => {
    const code = (codeOverride ?? input).trim()
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

  const handlePick = (code: string) => {
    setInput(code)
    setPickerOpen(false)
    handleSearch(code)
  }

  return (
    <div className="p-8 max-w-7xl flex flex-col gap-4">
      <div>
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · janela de pesquisa avançada
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Janela de Pesquisa Avançada</h1>
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
          onClick={() => setPickerOpen(true)}
          title="Ver todos os códigos disponíveis"
          className="px-3 py-2 bg-surface-container border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
        >
          🔍
        </button>
        <button
          onClick={() => handleSearch()}
          disabled={loading || !input.trim()}
          className="px-5 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {pickerOpen && <CodePickerModal onClose={() => setPickerOpen(false)} onPick={handlePick} />}

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

          <SectionPanel title="Cadastro de Equipamentos (BOM)" tint="blue" count={result.bom.filter(r => r.isSearched).length} plain>
            {result.bom.filter(r => r.isSearched).map(r => <EquipmentItemDetailCard key={r.id} r={r} />)}
          </SectionPanel>

          <SectionPanel title="Acessórios Compatíveis" tint="amber" count={result.compatibleAccessories.length} plain>
            <AccessoryGroupAccordion rows={result.compatibleAccessories} />
          </SectionPanel>

          <SectionPanel title="Produtos Não Combináveis" tint="amber" count={result.nonCombinable.length} plain>
            <RelationAccordion
              rows={result.nonCombinable}
              groupKey={r => r.protheus_code}
              groupLabel={r => r.name1 || 'N/A'}
              groupCode={r => r.protheus_code}
              itemCode={r => r.remove_list_code}
              itemLabel={r => r.name2 || 'N/A'}
              itemAccessory={r => r.otherAccessory ?? null}
              itemGroupName={r => r.otherGroupName ?? null}
              itemAlert={r => r.otherAlertDescription ?? null}
              itemExtra={r => [
                { label: 'Não Combina Com (Cód. Protheus)', value: r.protheus_code },
                { label: 'Não Combina Com (Nome)', value: r.name1 },
                { label: 'Não Combina Com (Grupo)', value: r.firstGroupName },
              ]}
              connector={() => <span className="text-error font-bold text-sm">✕ não combina com</span>}
              tone="error"
              copyAll
            />
          </SectionPanel>

          <SectionPanel title="Produtos Dependentes" tint="amber" count={result.dependants.length} plain>
            <RelationAccordion
              rows={result.dependants}
              groupKey={r => r.codeGroupName || 'Sem grupo'}
              groupLabel={r => r.codeGroupName || 'Sem grupo'}
              itemCode={r => r.protheus_item_code}
              itemLabel={r => r.dependentName || 'N/A'}
              itemAccessory={r => r.dependentAccessory ?? null}
              itemGroupName={r => r.dependentGroupName ?? null}
              itemAlert={r => r.dependentAlertDescription ?? null}
              itemExtra={r => [
                { label: 'Qtd. Necessária', value: r.quantity },
                { label: 'Fat. Proporcional', value: r.proportional_factor },
              ]}
              itemPrefix={r => [
                { label: 'Item Base (Cód. Protheus)', value: r.protheus_code },
                { label: 'Item Base (Nome)', value: r.itemName },
                { label: 'Grupo (Item Base)', value: r.codeGroupName },
              ]}
              connector={r => <NameCodeCaption name={r.itemName || 'N/A'} code={r.protheus_code} />}
              tone="primary"
              nested={false}
              copyAll
              hideStatus
              hideCatalogFields
            />
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

          <SectionPanel title="Usado nestes Equipamentos" tint="blue" count={result.usedInEquipments.length} plain>
            <UsedInEquipmentsAccordion rows={result.usedInEquipments} />
          </SectionPanel>

          <SectionPanel title="Produtos Não Combináveis" tint="amber" count={result.nonCombinable.length} plain>
            <RelationAccordion
              rows={result.nonCombinable}
              groupKey={r => String(r.legacy_equipment_id)}
              groupLabel={r => r.equipmentName || 'N/A'}
              itemCode={r => r.otherCode}
              itemLabel={r => r.otherName || 'N/A'}
              itemAccessory={r => r.otherAccessory ?? null}
              itemGroupName={r => r.otherGroupName ?? null}
              itemAlert={r => r.otherAlertDescription ?? null}
              itemExtra={r => [
                { label: 'Equipamento', value: r.equipmentName },
                { label: 'Não Combina Com (Cód. Protheus)', value: result.accessory.protheus_code },
                { label: 'Não Combina Com (Nome)', value: result.accessory.name },
                { label: 'Não Combina Com (Grupo)', value: result.groupName },
              ]}
              connector={() => <span className="text-error font-bold text-sm">✕ não combina com</span>}
              tone="error"
              copyAll
            />
          </SectionPanel>

          <SectionPanel title="Produtos Dependentes" tint="amber" count={result.dependants.length} plain>
            <RelationAccordion
              rows={result.dependants}
              groupKey={r => r.codeGroupName || 'Sem grupo'}
              groupLabel={r => r.codeGroupName || 'Sem grupo'}
              itemCode={r => r.otherCode}
              itemLabel={r => r.otherName || 'N/A'}
              itemAccessory={r => r.otherAccessory ?? null}
              itemGroupName={r => r.otherGroupName ?? null}
              itemAlert={r => r.otherAlertDescription ?? null}
              itemExtra={r => r.role === 'item'
                ? [
                    { label: 'Qtd. Necessária', value: r.quantity },
                    { label: 'Fat. Proporcional', value: r.proportional_factor },
                  ]
                : []
              }
              itemPrefix={r => r.role === 'item'
                ? [
                    { label: 'Item Base (Cód. Protheus)', value: result.accessory.protheus_code },
                    { label: 'Item Base (Nome)', value: result.accessory.name },
                    { label: 'Grupo (Item Base)', value: result.groupName },
                  ]
                : [
                    { label: 'Dependente (Cód. Protheus)', value: result.accessory.protheus_code },
                    { label: 'Dependente (Nome)', value: result.accessory.name },
                    { label: 'Grupo (Dependente)', value: result.groupName },
                  ]
              }
              connector={r => (
                <NameCodeCaption name={result.accessory.name} code={result.accessory.protheus_code} />
              )}
              tone="primary"
              nested={false}
              copyAll
              hideStatus
              hideCatalogFields
            />
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
