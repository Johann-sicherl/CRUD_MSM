'use client'

import { useState, useEffect, useMemo } from 'react'

interface Equip { legacy_id: number; name: string }
interface Group { legacy_id: number; name: string }
interface Accessory { protheus_code: string; name: string; legacy_group_id: number | null }

interface Props {
  onClose: () => void
  onSaved: (count: number) => void
}

export default function NonCombinableModal({ onClose, onSaved }: Props) {
  const [equipments, setEquipments] = useState<Equip[]>([])
  const [groups,     setGroups]     = useState<Group[]>([])
  const [allAcc,     setAllAcc]     = useState<Accessory[]>([])
  const [equipId,    setEquipId]    = useState('')
  const [g1,         setG1]         = useState('')
  const [g2,         setG2]         = useState('')
  const [sel1,       setSel1]       = useState<Set<string>>(new Set())
  const [sel2,       setSel2]       = useState<Set<string>>(new Set())
  const [q1,         setQ1]         = useState('')
  const [q2,         setQ2]         = useState('')
  const [saving,     setSaving]     = useState(false)
  const [result,     setResult]     = useState<{ ok: number; fail: number } | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/equipments?limit=25000').then(r => r.json()),
      fetch('/api/accessory_groups?limit=25000').then(r => r.json()),
      fetch('/api/accessories?limit=25000').then(r => r.json()),
    ]).then(([eq, gr, ac]) => {
      setEquipments(eq.data || [])
      setGroups(gr.data || [])
      setAllAcc(ac.data || [])
    })
  }, [])

  const acc1      = useMemo(() => allAcc.filter(a => String(a.legacy_group_id) === g1), [allAcc, g1])
  const acc2      = useMemo(() => allAcc.filter(a => String(a.legacy_group_id) === g2), [allAcc, g2])
  const filtered1 = useMemo(() => acc1.filter(a => !q1 || `${a.protheus_code} ${a.name}`.toLowerCase().includes(q1.toLowerCase())), [acc1, q1])
  const filtered2 = useMemo(() => acc2.filter(a => !q2 || `${a.protheus_code} ${a.name}`.toLowerCase().includes(q2.toLowerCase())), [acc2, q2])

  const pairs = sel1.size * sel2.size

  const toggle = (setSel: React.Dispatch<React.SetStateAction<Set<string>>>, code: string) =>
    setSel(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })

  const handleSubmit = async () => {
    if (!equipId || !g1 || !g2 || !sel1.size || !sel2.size) return
    setSaving(true)
    setResult(null)

    const requests: Array<[string, string]> = []
    for (const c1 of sel1) for (const c2 of sel2) requests.push([c1, c2])

    const settled = await Promise.allSettled(
      requests.map(([protheus_code, remove_list_code]) =>
        fetch('/api/non_combinable_comps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ legacy_equipment_id: Number(equipId), protheus_code, remove_list_code, status: 'active' }),
        }).then(r => { if (!r.ok) throw new Error(); return r })
      )
    )

    const ok   = settled.filter(r => r.status === 'fulfilled').length
    const fail = settled.filter(r => r.status === 'rejected').length
    setSaving(false)
    setResult({ ok, fail })
    if (ok > 0) onSaved(ok * 2)
  }

  const canSubmit = !!(equipId && g1 && g2 && sel1.size && sel2.size)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant shrink-0">
          <div>
            <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em]">NOVO REGISTRO</div>
            <h2 className="text-base font-bold text-on-surface">Produtos Não Combináveis</h2>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors text-lg">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 flex flex-col gap-5">

          {/* Equipment */}
          <div>
            <label className="block text-[10px] font-semibold text-outline uppercase tracking-[0.12em] mb-1.5">
              Equipamento
            </label>
            <select
              value={equipId}
              onChange={e => setEquipId(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
              <option value="">Selecione o equipamento...</option>
              {equipments.map(eq => (
                <option key={eq.legacy_id} value={eq.legacy_id}>{eq.name}</option>
              ))}
            </select>
          </div>

          {/* Two group selectors */}
          <div className="grid grid-cols-2 gap-4">
            {([
              { label: '1° Grupo', val: g1, set: (v: string) => { setG1(v); setSel1(new Set()); setQ1('') }, exclude: g2 },
              { label: '2° Grupo', val: g2, set: (v: string) => { setG2(v); setSel2(new Set()); setQ2('') }, exclude: g1 },
            ] as const).map(({ label, val, set, exclude }) => (
              <div key={label}>
                <label className="block text-[10px] font-semibold text-outline uppercase tracking-[0.12em] mb-1.5">
                  {label}
                </label>
                <select
                  value={val}
                  onChange={e => set(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                >
                  <option value="">Selecione o grupo...</option>
                  {groups.filter(g => String(g.legacy_id) !== exclude).map(g => (
                    <option key={g.legacy_id} value={g.legacy_id}>{g.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Two accessory boxes */}
          <div className="grid grid-cols-2 gap-4">
            <AccBox
              title="1° Grupo — Acessórios"
              items={filtered1}
              selected={sel1}
              search={q1}
              total={acc1.length}
              onSearch={setQ1}
              onToggle={c => toggle(setSel1, c)}
              onAll={() => setSel1(new Set(filtered1.map(a => a.protheus_code)))}
              onNone={() => setSel1(new Set())}
              empty={!g1}
            />
            <AccBox
              title="2° Grupo — Acessórios"
              items={filtered2}
              selected={sel2}
              search={q2}
              total={acc2.length}
              onSearch={setQ2}
              onToggle={c => toggle(setSel2, c)}
              onAll={() => setSel2(new Set(filtered2.map(a => a.protheus_code)))}
              onNone={() => setSel2(new Set())}
              empty={!g2}
            />
          </div>

          {/* Summary */}
          {pairs > 0 && !result && (
            <div className="flex items-center gap-2 text-xs font-mono bg-primary/5 border border-primary/20 rounded px-4 py-2 text-primary">
              <span>{sel1.size} × {sel2.size} = {pairs} par{pairs !== 1 ? 'es' : ''}</span>
              <span className="text-outline">→</span>
              <span className="font-bold">{pairs * 2} registros</span>
              <span className="text-outline/60 text-[10px]">(A≠B e B≠A — bidirecional)</span>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`text-xs font-mono rounded px-4 py-2.5 border ${
              result.fail === 0
                ? 'bg-green-900/20 border-green-800/40 text-green-400'
                : 'bg-error-container/20 border-error/30 text-error'
            }`}>
              ✓ {result.ok * 2} registros inseridos
              {result.fail > 0 && ` · ⚠ ${result.fail} par${result.fail !== 1 ? 'es' : ''} com erro (duplicata ou inválido)`}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-outline-variant shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
          >
            {result ? 'Fechar' : 'Cancelar'}
          </button>
          {!result && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="px-5 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-40 transition-all"
            >
              {saving ? 'Inserindo...' : `Inserir${pairs > 0 ? ` ${pairs * 2} registros` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function AccBox({
  title, items, selected, search, total, onSearch, onToggle, onAll, onNone, empty,
}: {
  title: string
  items: Accessory[]
  selected: Set<string>
  search: string
  total: number
  onSearch: (v: string) => void
  onToggle: (code: string) => void
  onAll: () => void
  onNone: () => void
  empty: boolean
}) {
  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden">
      <div className="px-3 py-2 border-b border-outline-variant bg-surface-container-highest text-[10px] font-semibold text-outline uppercase tracking-[0.1em]">
        {title}
      </div>
      {empty ? (
        <div className="px-3 py-10 text-center text-xs text-outline italic">Selecione um grupo acima</div>
      ) : (
        <>
          <div className="px-2 py-2 border-b border-outline-variant/40 flex gap-1.5 items-center">
            <input
              type="text"
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Buscar código ou nome..."
              className="flex-1 bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary"
            />
            <button onClick={onAll}  className="text-[10px] text-primary hover:underline px-1 whitespace-nowrap">todos</button>
            <span className="text-outline/40 text-[10px]">|</span>
            <button onClick={onNone} className="text-[10px] text-outline hover:text-primary px-1 whitespace-nowrap">nenhum</button>
          </div>
          <div className="overflow-y-auto max-h-60 divide-y divide-outline-variant/20">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-outline italic">Nenhum resultado</div>
            ) : (
              items.map(a => (
                <label
                  key={a.protheus_code}
                  className={`flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-surface-container transition-colors ${
                    selected.has(a.protheus_code) ? 'bg-primary/5' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(a.protheus_code)}
                    onChange={() => onToggle(a.protheus_code)}
                    className="accent-primary shrink-0"
                  />
                  <span className="text-xs font-mono text-on-surface-variant truncate">
                    <span className="text-primary font-medium">{a.protheus_code}</span>
                    <span className="text-outline"> — </span>
                    {a.name}
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="px-3 py-1.5 border-t border-outline-variant/40 text-[10px] font-mono text-outline">
            {selected.size > 0
              ? <span className="text-primary">{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span>
              : 'Nenhum selecionado'
            }
            {' · '}{total} no grupo{search && items.length !== total ? `, ${items.length} visíveis` : ''}
          </div>
        </>
      )}
    </div>
  )
}
