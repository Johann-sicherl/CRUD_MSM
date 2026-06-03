'use client'

import { useState, useEffect, useMemo } from 'react'
import ColumnFilter from './ColumnFilter'

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

  const acc1 = useMemo(() => allAcc.filter(a => String(a.legacy_group_id) === g1), [allAcc, g1])
  const acc2 = useMemo(() => allAcc.filter(a => String(a.legacy_group_id) === g2), [allAcc, g2])

  // When the same group is selected in both, items chosen in one box are blocked in the other
  const sameGroup = g1 !== '' && g1 === g2
  const blocked1 = sameGroup ? sel2 : new Set<string>()
  const blocked2 = sameGroup ? sel1 : new Set<string>()

  const toggle1 = (code: string) => {
    if (blocked1.has(code)) return
    setSel1(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }
  const toggle2 = (code: string) => {
    if (blocked2.has(code)) return
    setSel2(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }

  const pairs = sel1.size * sel2.size

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
      <div className="bg-surface-container rounded-lg border border-outline-variant shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-outline-variant shrink-0">
          <div>
            <div className="text-xs font-mono text-outline uppercase tracking-[0.2em]">NOVO REGISTRO</div>
            <h2 className="text-xl font-bold text-on-surface mt-0.5">Produtos Não Combináveis</h2>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors text-xl">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-7 py-6 flex flex-col gap-6">

          {/* Equipment */}
          <div>
            <label className="block text-xs font-semibold text-outline uppercase tracking-[0.12em] mb-2">
              Equipamento
            </label>
            <select
              value={equipId}
              onChange={e => setEquipId(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
              <option value="">Selecione o equipamento...</option>
              {equipments.map(eq => (
                <option key={eq.legacy_id} value={eq.legacy_id}>{eq.name}</option>
              ))}
            </select>
          </div>

          {/* Two group selectors — same group is now allowed */}
          <div className="grid grid-cols-2 gap-5">
            {([
              { label: '1° Grupo', val: g1, set: (v: string) => { setG1(v); setSel1(new Set()) } },
              { label: '2° Grupo', val: g2, set: (v: string) => { setG2(v); setSel2(new Set()) } },
            ] as const).map(({ label, val, set }) => (
              <div key={label}>
                <label className="block text-xs font-semibold text-outline uppercase tracking-[0.12em] mb-2">
                  {label}
                </label>
                <select
                  value={val}
                  onChange={e => set(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                >
                  <option value="">Selecione o grupo...</option>
                  {groups.map(g => (
                    <option key={g.legacy_id} value={g.legacy_id}>{g.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Two accessory boxes */}
          <div className="grid grid-cols-2 gap-5">
            <AccBox
              key={`box1-${g1}`}
              title="1° Grupo — Acessórios"
              items={acc1}
              selected={sel1}
              blockedCodes={blocked1}
              onToggle={toggle1}
              onAll={visible => setSel1(new Set(visible.filter(a => !blocked1.has(a.protheus_code)).map(a => a.protheus_code)))}
              onNone={() => setSel1(new Set())}
              empty={!g1}
            />
            <AccBox
              key={`box2-${g2}`}
              title="2° Grupo — Acessórios"
              items={acc2}
              selected={sel2}
              blockedCodes={blocked2}
              onToggle={toggle2}
              onAll={visible => setSel2(new Set(visible.filter(a => !blocked2.has(a.protheus_code)).map(a => a.protheus_code)))}
              onNone={() => setSel2(new Set())}
              empty={!g2}
            />
          </div>

          {/* Summary */}
          {pairs > 0 && !result && (
            <div className="flex items-center gap-2 text-sm font-mono bg-primary/5 border border-primary/20 rounded px-4 py-3 text-primary">
              <span>{sel1.size} × {sel2.size} = {pairs} par{pairs !== 1 ? 'es' : ''}</span>
              <span className="text-outline">→</span>
              <span className="font-bold">{pairs * 2} registros</span>
              <span className="text-outline/60 text-xs">(A≠B e B≠A — bidirecional)</span>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`text-sm font-mono rounded px-4 py-3 border ${
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
        <div className="flex justify-end gap-3 px-7 py-5 border-t border-outline-variant shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
          >
            {result ? 'Fechar' : 'Cancelar'}
          </button>
          {!result && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="px-6 py-2.5 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-40 transition-all"
            >
              {saving ? 'Inserindo...' : `Inserir${pairs > 0 ? ` ${pairs * 2} registros` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── AccBox ────────────────────────────────────────────────────────────────────

function AccBox({
  title, items, selected, blockedCodes, onToggle, onAll, onNone, empty,
}: {
  title: string
  items: Accessory[]
  selected: Set<string>
  blockedCodes: Set<string>
  onToggle: (code: string) => void
  onAll: (visible: Accessory[]) => void
  onNone: () => void
  empty: boolean
}) {
  const [codeSearch,   setCodeSearch]   = useState('')
  const [codeSelected, setCodeSelected] = useState<string[]>([])
  const [nameSearch,   setNameSearch]   = useState('')
  const [nameSelected, setNameSelected] = useState<string[]>([])

  const passesCode = (a: Accessory) =>
    codeSelected.length > 0 ? codeSelected.includes(a.protheus_code)
      : (!codeSearch || a.protheus_code.toLowerCase().includes(codeSearch.toLowerCase()))
  const passesName = (a: Accessory) =>
    nameSelected.length > 0 ? nameSelected.includes(a.name)
      : (!nameSearch || a.name.toLowerCase().includes(nameSearch.toLowerCase()))

  const codeOptions = useMemo(() =>
    [...new Set(items.filter(passesName).map(a => a.protheus_code))].sort()
  , [items, nameSearch, nameSelected]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameOptions = useMemo(() =>
    [...new Set(items.filter(passesCode).map(a => a.name))].sort()
  , [items, codeSearch, codeSelected]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() =>
    items.filter(a => passesCode(a) && passesName(a))
  , [items, codeSearch, codeSelected, nameSearch, nameSelected]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectableVisible = visible.filter(a => !blockedCodes.has(a.protheus_code))
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(a => selected.has(a.protheus_code))

  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden">

      {/* Box title */}
      <div className="px-4 py-2.5 border-b border-outline-variant bg-surface-container-highest flex items-center justify-between">
        <span className="text-xs font-semibold text-outline uppercase tracking-[0.1em]">{title}</span>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => onAll(visible)} className="text-primary hover:underline">todos</button>
          <span className="text-outline/40">|</span>
          <button onClick={onNone} className="text-outline hover:text-primary">nenhum</button>
        </div>
      </div>

      {empty ? (
        <div className="px-4 py-12 text-center text-sm text-outline italic">Selecione um grupo acima</div>
      ) : (
        <>
          {/* Column headers + filters */}
          <div className="flex items-stretch border-b border-outline-variant bg-surface-container-high text-[10px] font-semibold text-outline uppercase tracking-[0.1em]">
            {/* Checkbox col */}
            <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/30 px-2">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => allVisibleSelected ? onNone() : onAll(visible)}
                className="accent-primary"
                title="Selecionar todos visíveis"
              />
            </div>
            {/* Código col */}
            <div className="w-44 shrink-0 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
              <span>Código</span>
              <ColumnFilter
                searchValue={codeSearch}
                onSearchChange={setCodeSearch}
                selectedValues={codeSelected}
                onToggleValue={v => setCodeSelected(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])}
                onClearValues={() => setCodeSelected([])}
                options={codeOptions}
              />
            </div>
            {/* Nome col */}
            <div className="flex-1 px-2 py-2 flex flex-col gap-1.5">
              <span>Nome</span>
              <ColumnFilter
                searchValue={nameSearch}
                onSearchChange={setNameSearch}
                selectedValues={nameSelected}
                onToggleValue={v => setNameSelected(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])}
                onClearValues={() => setNameSelected([])}
                options={nameOptions}
              />
            </div>
          </div>

          {/* Items */}
          <div className="overflow-y-auto max-h-72 divide-y divide-outline-variant/20">
            {visible.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-outline italic">Nenhum resultado</div>
            ) : (
              visible.map(a => {
                const blocked = blockedCodes.has(a.protheus_code)
                return (
                  <label
                    key={a.protheus_code}
                    className={`flex items-center transition-colors ${
                      blocked
                        ? 'opacity-35 cursor-not-allowed bg-surface-container-highest'
                        : selected.has(a.protheus_code)
                          ? 'bg-primary/5 cursor-pointer hover:bg-primary/8'
                          : 'cursor-pointer hover:bg-surface-container'
                    }`}
                  >
                    <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/10 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(a.protheus_code)}
                        disabled={blocked}
                        onChange={() => onToggle(a.protheus_code)}
                        className="accent-primary disabled:cursor-not-allowed"
                      />
                    </div>
                    <div className={`w-44 shrink-0 border-r border-outline-variant/10 px-2 py-2 text-xs font-mono truncate ${blocked ? 'text-outline line-through' : 'text-primary'}`}>
                      {a.protheus_code}
                    </div>
                    <div className="flex-1 px-2 py-2 text-xs text-on-surface-variant truncate">
                      {a.name}
                      {blocked && <span className="ml-1.5 text-[10px] text-outline font-mono">(selecionado no outro lado)</span>}
                    </div>
                  </label>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-outline-variant/40 text-xs font-mono text-outline flex items-center gap-2">
            {selected.size > 0
              ? <span className="text-primary">{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span>
              : <span>Nenhum selecionado</span>
            }
            <span className="text-outline/40">·</span>
            <span>{items.length} no grupo</span>
            {visible.length !== items.length && (
              <><span className="text-outline/40">·</span><span>{visible.length} visíveis</span></>
            )}
          </div>
        </>
      )}
    </div>
  )
}
