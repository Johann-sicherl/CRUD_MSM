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
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
      active ? 'text-green-500 border-green-500/30 bg-green-500/10' : 'text-outline border-outline-variant bg-surface-container'
    }`}>
      {status}
    </span>
  )
}

function Section({ title, color, count, children }: { title: string; color: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className={`text-sm font-semibold uppercase tracking-[0.1em] font-mono ${color}`}>{title}</h2>
        <span className="text-xs text-outline font-mono">({count})</span>
        <div className="flex-1 h-px bg-outline-variant ml-1" />
      </div>
      {count === 0 ? (
        <div className="text-xs text-outline italic px-1">Nenhum registro</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">{children}</div>
      )}
    </div>
  )
}

// Groups rows that carry a groupName/groupId (accessory_groups) — "Sem grupo" always sorts last.
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

function GroupedSection({ title, color, rows, renderCard }: {
  title: string
  color: string
  rows: Row[]
  renderCard: (r: Row) => React.ReactNode
}) {
  const groups = groupByAccessoryGroup(rows)
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className={`text-sm font-semibold uppercase tracking-[0.1em] font-mono ${color}`}>{title}</h2>
        <span className="text-xs text-outline font-mono">({rows.length})</span>
        <div className="flex-1 h-px bg-outline-variant ml-1" />
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-outline italic px-1">Nenhum registro</div>
      ) : (
        groups.map(g => (
          <div key={g.groupName} className="mb-4">
            <div className="text-xs font-semibold text-on-surface-variant mb-2 pl-1">
              {g.groupName} <span className="text-outline font-normal">({g.items.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {g.items.map(renderCard)}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function Card({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${
      highlight ? 'border-primary bg-primary/5' : 'border-outline-variant bg-surface-container'
    }`}>
      {children}
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
          <div className="bg-surface-container border border-outline-variant rounded-lg p-5 mb-6">
            <div className="text-[10px] font-mono text-outline uppercase tracking-[0.12em] mb-1">Equipamento</div>
            <div className="text-xl font-bold text-on-surface">
              {result.equipment?.name ?? '—'} <span className="text-on-surface-variant font-normal">/ {result.equipment?.commercial_name}</span>
            </div>
            <div className="text-xs text-outline mt-1 font-mono">ID Leg. {result.equipment?.legacy_id} · código buscado: {result.code}</div>
          </div>

          <Section title="Cadastro de Equipamentos (BOM)" color="text-blue-400" count={result.bom.length}>
            {result.bom.map(r => (
              <Card key={r.id} highlight={r.isSearched}>
                <div className="font-mono text-xs text-primary">{r.protheus_code}</div>
                <div className="text-on-surface-variant text-xs mt-1">{r.processor || '—'} · {r.memory || '—'}</div>
                <div className="flex items-center justify-between mt-2">
                  <StatusBadge status={r.status} />
                  <span className="text-xs text-outline font-mono">R$ {Number(r.cost_std ?? 0).toFixed(2)}</span>
                </div>
              </Card>
            ))}
          </Section>

          <GroupedSection
            title="Acessórios Compatíveis"
            color="text-amber-400"
            rows={result.compatibleAccessories}
            renderCard={r => (
              <Card key={r.id}>
                <div className="font-mono text-xs text-primary">{r.protheus_code}</div>
                <div className="text-on-surface-variant text-xs mt-1">{r.accessoryName || 'N/A'}</div>
                <div className="flex items-center justify-between mt-2">
                  <StatusBadge status={r.status} />
                  {r.maximum_quantity != null && <span className="text-xs text-outline font-mono">máx. {r.maximum_quantity}</span>}
                </div>
              </Card>
            )}
          />

          <Section title="Produtos Não Combináveis" color="text-amber-400" count={result.nonCombinable.length}>
            {result.nonCombinable.map(r => (
              <Card key={r.id}>
                <div className="font-mono text-xs text-primary">{r.protheus_code}</div>
                <div className="text-on-surface-variant text-xs">{r.name1 || 'N/A'}</div>
                <div className="text-outline text-xs my-1">✕ não combina com</div>
                <div className="font-mono text-xs text-primary">{r.remove_list_code}</div>
                <div className="text-on-surface-variant text-xs">{r.name2 || 'N/A'}</div>
              </Card>
            ))}
          </Section>

          <Section title="Produtos Dependentes" color="text-amber-400" count={result.dependants.length}>
            {result.dependants.map(r => (
              <Card key={r.id}>
                <div className="font-mono text-xs text-primary">{r.protheus_code}</div>
                <div className="text-on-surface-variant text-xs">{r.itemName || 'N/A'}</div>
                <div className="text-outline text-xs my-1">→ requer (x{r.quantity})</div>
                <div className="font-mono text-xs text-primary">{r.protheus_item_code}</div>
                <div className="text-on-surface-variant text-xs">{r.dependentName || 'N/A'}</div>
              </Card>
            ))}
          </Section>

          <Section title="Mesas de Roletes" color="text-amber-400" count={result.rollerTables.length}>
            {result.rollerTables.map(r => (
              <Card key={r.id}>
                <div className="font-mono text-xs text-primary">{r.protheus_code}</div>
                <div className="text-on-surface-variant text-xs mt-1">{r.accessoryName || 'N/A'}</div>
                <div className="text-xs text-outline mt-2 font-mono uppercase">{r.type}</div>
              </Card>
            ))}
          </Section>
        </div>
      )}

      {result?.type === 'accessory' && (
        <div className="mt-2">
          <div className="bg-surface-container border border-outline-variant rounded-lg p-5 mb-6">
            <div className="text-[10px] font-mono text-outline uppercase tracking-[0.12em] mb-1">Componente</div>
            <div className="text-xl font-bold text-on-surface">
              {result.accessory.name} <span className="text-on-surface-variant font-normal font-mono text-sm">/ {result.accessory.protheus_code}</span>
            </div>
            <div className="text-xs text-outline mt-1 font-mono flex items-center gap-3">
              <span>Grupo: {result.groupName || 'N/A'}</span>
              <span>Custo: R$ {Number(result.accessory.cost_std ?? 0).toFixed(2)}</span>
              <StatusBadge status={result.accessory.status} />
            </div>
          </div>

          <Section title="Usado nestes Equipamentos" color="text-blue-400" count={result.usedInEquipments.length}>
            {result.usedInEquipments.map(r => (
              <Card key={r.id}>
                <div className="text-on-surface-variant text-xs font-semibold">{r.equipmentName || 'N/A'}</div>
                <div className="flex items-center justify-between mt-2">
                  <StatusBadge status={r.status} />
                  {r.maximum_quantity != null && <span className="text-xs text-outline font-mono">máx. {r.maximum_quantity}</span>}
                </div>
              </Card>
            ))}
          </Section>

          <Section title="Produtos Não Combináveis" color="text-amber-400" count={result.nonCombinable.length}>
            {result.nonCombinable.map(r => (
              <Card key={r.id}>
                <div className="text-on-surface-variant text-xs font-semibold">{r.equipmentName || 'N/A'}</div>
                <div className="text-outline text-xs my-1">✕ não combina com</div>
                <div className="font-mono text-xs text-primary">{r.otherCode}</div>
                <div className="text-on-surface-variant text-xs">{r.otherName || 'N/A'}</div>
              </Card>
            ))}
          </Section>

          <Section title="Produtos Dependentes" color="text-amber-400" count={result.dependants.length}>
            {result.dependants.map(r => (
              <Card key={r.id}>
                <div className="text-on-surface-variant text-xs font-semibold">{r.equipmentName || 'N/A'}</div>
                <div className="text-outline text-xs my-1">{r.role === 'item' ? '→ requer' : '← requerido por'} (x{r.quantity})</div>
                <div className="font-mono text-xs text-primary">{r.otherCode}</div>
                <div className="text-on-surface-variant text-xs">{r.otherName || 'N/A'}</div>
              </Card>
            ))}
          </Section>

          <Section title="Mesas de Roletes" color="text-amber-400" count={result.rollerTables.length}>
            {result.rollerTables.map(r => (
              <Card key={r.id}>
                <div className="text-on-surface-variant text-xs font-semibold">{r.equipmentName || 'N/A'}</div>
                <div className="text-xs text-outline mt-2 font-mono uppercase">{r.type}</div>
              </Card>
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}
