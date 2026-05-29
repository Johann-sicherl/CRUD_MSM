'use client'

import { useState, useEffect, useMemo } from 'react'
import ColumnFilter from './ColumnFilter'

interface Equip     { legacy_id: number; name: string }
interface Group     { legacy_id: number; name: string }
interface Accessory { protheus_code: string; name: string; legacy_group_id: number | null }
interface ItemCfg   { quantity: number; factor: string } // factor as string to allow '' → null

interface Props {
  onClose: () => void
  onSaved: (count: number) => void
}

export default function DependentItemsModal({ onClose, onSaved }: Props) {
  const [equipments, setEquipments] = useState<Equip[]>([])
  const [groups,     setGroups]     = useState<Group[]>([])
  const [allAcc,     setAllAcc]     = useState<Accessory[]>([])
  const [equipId,    setEquipId]    = useState('')
  const [g1,         setG1]         = useState('')
  const [g2,         setG2]         = useState('')
  const [sel1,       setSel1]       = useState<Set<string>>(new Set())
  const [sel2,       setSel2]       = useState<Set<string>>(new Set())
  // Per-item settings for box 2 (quantity + proportional_factor)
  const [cfg2,       setCfg2]       = useState<Record<string, ItemCfg>>({})
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

  const toggle1 = (code: string) =>
    setSel1(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })

  const toggle2 = (code: string) => {
    setSel2(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
    setCfg2(prev => prev[code] ? prev : { ...prev, [code]: { quantity: 1, factor: '1' } })
  }

  const setCfgField = (code: string, field: 'quantity' | 'factor', val: string) =>
    setCfg2(prev => ({ ...prev, [code]: { ...prev[code] ?? { quantity: 1, factor: '1' }, [field]: field === 'quantity' ? Math.max(1, Number(val) || 1) : val } }))

  const pairs = sel1.size * sel2.size

  const handleSubmit = async () => {
    if (!equipId || !g1 || !g2 || !sel1.size || !sel2.size) return
    setSaving(true)
    setResult(null)

    const requests: Array<[string, string]> = []
    for (const c1 of sel1) for (const c2 of sel2) requests.push([c1, c2])

    const settled = await Promise.allSettled(
      requests.map(([protheus_code, protheus_item_code]) => {
        const settings = cfg2[protheus_item_code] ?? { quantity: 1, factor: '1' }
        return fetch('/api/dependant_items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legacy_equipment_id:  Number(equipId),
            protheus_code,
            protheus_item_code,
            quantity:             settings.quantity,
            proportional_factor:  settings.factor !== '' ? Number(settings.factor) : null,
            cost_std:             0,
          }),
        }).then(r => { if (!r.ok) throw new Error(); return r })
      })
    )

    const ok   = settled.filter(r => r.status === 'fulfilled').length
    const fail = settled.filter(r => r.status === 'rejected').length
    setSaving(false)
    setResult({ ok, fail })
    if (ok > 0) onSaved(ok)
  }

  const canSubmit = !!(equipId && g1 && g2 && sel1.size && sel2.size)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-outline-variant shrink-0">
          <div>
            <div className="text-xs font-mono text-outline uppercase tracking-[0.2em]">NOVO REGISTRO</div>
            <h2 className="text-xl font-bold text-on-surface mt-0.5">Produtos Dependentes</h2>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors text-xl">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-7 py-6 flex flex-col gap-6">

          {/* Equipment */}
          <div>
            <label className="block text-xs font-semibold text-outline uppercase tracking-[0.12em] mb-2">Equipamento</label>
            <select
              value={equipId}
              onChange={e => setEquipId(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
              <option value="">Selecione o equipamento...</option>
              {equipments.map(eq => <option key={eq.legacy_id} value={eq.legacy_id}>{eq.name}</option>)}
            </select>
          </div>

          {/* Group selectors */}
          <div className="grid grid-cols-2 gap-5">
            {([
              { label: 'Grupo — Cód. Item',       val: g1, set: (v: string) => { setG1(v); setSel1(new Set()) } },
              { label: 'Grupo — Cód. Dependente', val: g2, set: (v: string) => { setG2(v); setSel2(new Set()); setCfg2({}) } },
            ] as const).map(({ label, val, set }) => (
              <div key={label}>
                <label className="block text-xs font-semibold text-outline uppercase tracking-[0.12em] mb-2">{label}</label>
                <select
                  value={val}
                  onChange={e => set(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                >
                  <option value="">Selecione o grupo...</option>
                  {groups.map(g => <option key={g.legacy_id} value={g.legacy_id}>{g.name}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Two accessory boxes */}
          <div className="grid grid-cols-2 gap-5">
            {/* Box 1 — Cód. Item (trigger) */}
            <TriggerBox
              key={`trig-${g1}`}
              title="Cód. Item — Gatilho"
              items={acc1}
              selected={sel1}
              onToggle={toggle1}
              onAll={visible => setSel1(new Set(visible.map(a => a.protheus_code)))}
              onNone={() => setSel1(new Set())}
              empty={!g1}
            />
            {/* Box 2 — Cód. Dependente (with qty/factor per item) */}
            <DependentBox
              key={`dep-${g2}`}
              title="Cód. Dependente"
              items={acc2}
              selected={sel2}
              cfg={cfg2}
              onToggle={toggle2}
              onAll={visible => {
                setSel2(new Set(visible.map(a => a.protheus_code)))
                setCfg2(prev => {
                  const n = { ...prev }
                  for (const a of visible) if (!n[a.protheus_code]) n[a.protheus_code] = { quantity: 1, factor: '1' }
                  return n
                })
              }}
              onNone={() => setSel2(new Set())}
              onCfgChange={setCfgField}
              empty={!g2}
            />
          </div>

          {/* Summary */}
          {pairs > 0 && !result && (
            <div className="flex items-center gap-2 text-sm font-mono bg-primary/5 border border-primary/20 rounded px-4 py-3 text-primary">
              <span>{sel1.size} × {sel2.size} = {pairs} par{pairs !== 1 ? 'es' : ''}</span>
              <span className="text-outline">→</span>
              <span className="font-bold">{pairs} registros</span>
              <span className="text-outline/60 text-xs">(unidirecional)</span>
            </div>
          )}

          {result && (
            <div className={`text-sm font-mono rounded px-4 py-3 border ${
              result.fail === 0
                ? 'bg-green-900/20 border-green-800/40 text-green-400'
                : 'bg-error-container/20 border-error/30 text-error'
            }`}>
              ✓ {result.ok} registros inseridos
              {result.fail > 0 && ` · ⚠ ${result.fail} par${result.fail !== 1 ? 'es' : ''} com erro`}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-7 py-5 border-t border-outline-variant shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors">
            {result ? 'Fechar' : 'Cancelar'}
          </button>
          {!result && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="px-6 py-2.5 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-40 transition-all"
            >
              {saving ? 'Inserindo...' : `Inserir${pairs > 0 ? ` ${pairs} registros` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── TriggerBox (Cód. Item — standard, no extra columns) ──────────────────────

function TriggerBox({
  title, items, selected, onToggle, onAll, onNone, empty,
}: {
  title: string; items: Accessory[]; selected: Set<string>
  onToggle: (c: string) => void; onAll: (v: Accessory[]) => void; onNone: () => void; empty: boolean
}) {
  const [filterCode, setFilterCode] = useState('')
  const [filterName, setFilterName] = useState('')

  const codeOptions = useMemo(() => {
    const pass = filterName ? items.filter(a => a.name.toLowerCase().includes(filterName.toLowerCase())) : items
    return [...new Set(pass.map(a => a.protheus_code))].sort()
  }, [items, filterName])

  const nameOptions = useMemo(() => {
    const pass = filterCode ? items.filter(a => a.protheus_code.toLowerCase().includes(filterCode.toLowerCase())) : items
    return [...new Set(pass.map(a => a.name))].sort()
  }, [items, filterCode])

  const visible = useMemo(() => items.filter(a =>
    (!filterCode || a.protheus_code.toLowerCase().includes(filterCode.toLowerCase())) &&
    (!filterName || a.name.toLowerCase().includes(filterName.toLowerCase()))
  ), [items, filterCode, filterName])

  const allSel = visible.length > 0 && visible.every(a => selected.has(a.protheus_code))

  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden">
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
          <div className="flex items-stretch border-b border-outline-variant bg-surface-container-high text-[10px] font-semibold text-outline uppercase tracking-[0.1em]">
            <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/30 px-2">
              <input type="checkbox" checked={allSel} onChange={() => allSel ? onNone() : onAll(visible)} className="accent-primary" />
            </div>
            <div className="w-44 shrink-0 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
              <span>Código</span>
              <ColumnFilter value={filterCode} onChange={setFilterCode} onSelect={setFilterCode} options={codeOptions} placeholder="filtrar..." />
            </div>
            <div className="flex-1 px-2 py-2 flex flex-col gap-1.5">
              <span>Nome</span>
              <ColumnFilter value={filterName} onChange={setFilterName} onSelect={setFilterName} options={nameOptions} placeholder="filtrar..." />
            </div>
          </div>
          <div className="overflow-y-auto max-h-72 divide-y divide-outline-variant/20">
            {visible.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-outline italic">Nenhum resultado</div>
            ) : visible.map(a => (
              <label key={a.protheus_code} className={`flex items-center cursor-pointer hover:bg-surface-container transition-colors ${selected.has(a.protheus_code) ? 'bg-primary/5' : ''}`}>
                <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/10 py-2">
                  <input type="checkbox" checked={selected.has(a.protheus_code)} onChange={() => onToggle(a.protheus_code)} className="accent-primary" />
                </div>
                <div className="w-44 shrink-0 border-r border-outline-variant/10 px-2 py-2 text-xs font-mono text-primary truncate">{a.protheus_code}</div>
                <div className="flex-1 px-2 py-2 text-xs text-on-surface-variant truncate">{a.name}</div>
              </label>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-outline-variant/40 text-xs font-mono text-outline flex items-center gap-2">
            {selected.size > 0 ? <span className="text-primary">{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span> : <span>Nenhum selecionado</span>}
            <span className="text-outline/40">·</span><span>{items.length} no grupo</span>
            {visible.length !== items.length && <><span className="text-outline/40">·</span><span>{visible.length} visíveis</span></>}
          </div>
        </>
      )}
    </div>
  )
}

// ── DependentBox (Cód. Dependente — with QTD + Fator Prop per item) ──────────

function DependentBox({
  title, items, selected, cfg, onToggle, onAll, onNone, onCfgChange, empty,
}: {
  title: string; items: Accessory[]; selected: Set<string>; cfg: Record<string, ItemCfg>
  onToggle: (c: string) => void; onAll: (v: Accessory[]) => void; onNone: () => void
  onCfgChange: (code: string, field: 'quantity' | 'factor', val: string) => void; empty: boolean
}) {
  const [filterCode, setFilterCode] = useState('')
  const [filterName, setFilterName] = useState('')

  const codeOptions = useMemo(() => {
    const pass = filterName ? items.filter(a => a.name.toLowerCase().includes(filterName.toLowerCase())) : items
    return [...new Set(pass.map(a => a.protheus_code))].sort()
  }, [items, filterName])

  const nameOptions = useMemo(() => {
    const pass = filterCode ? items.filter(a => a.protheus_code.toLowerCase().includes(filterCode.toLowerCase())) : items
    return [...new Set(pass.map(a => a.name))].sort()
  }, [items, filterCode])

  const visible = useMemo(() => items.filter(a =>
    (!filterCode || a.protheus_code.toLowerCase().includes(filterCode.toLowerCase())) &&
    (!filterName || a.name.toLowerCase().includes(filterName.toLowerCase()))
  ), [items, filterCode, filterName])

  const allSel = visible.length > 0 && visible.every(a => selected.has(a.protheus_code))

  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden">
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
          {/* Column headers */}
          <div className="flex items-stretch border-b border-outline-variant bg-surface-container-high text-[10px] font-semibold text-outline uppercase tracking-[0.1em]">
            <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/30 px-2">
              <input type="checkbox" checked={allSel} onChange={() => allSel ? onNone() : onAll(visible)} className="accent-primary" />
            </div>
            <div className="w-36 shrink-0 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
              <span>Código</span>
              <ColumnFilter value={filterCode} onChange={setFilterCode} onSelect={setFilterCode} options={codeOptions} placeholder="filtrar..." />
            </div>
            <div className="flex-1 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
              <span>Nome</span>
              <ColumnFilter value={filterName} onChange={setFilterName} onSelect={setFilterName} options={nameOptions} placeholder="filtrar..." />
            </div>
            <div className="w-16 shrink-0 border-r border-outline-variant/30 px-2 py-2 text-center">
              <div>Qtd.</div>
              <div className="text-[9px] text-outline/50 normal-case tracking-normal font-normal mt-0.5">padrão 1</div>
            </div>
            <div className="w-20 shrink-0 px-2 py-2 text-center">
              <div>Fat.Prop.</div>
              <div className="text-[9px] text-outline/50 normal-case tracking-normal font-normal mt-0.5">padrão 1</div>
            </div>
          </div>

          {/* Items */}
          <div className="overflow-y-auto max-h-72 divide-y divide-outline-variant/20">
            {visible.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-outline italic">Nenhum resultado</div>
            ) : visible.map(a => {
              const isSelected = selected.has(a.protheus_code)
              const settings = cfg[a.protheus_code] ?? { quantity: 1, factor: '1' }
              return (
                <div key={a.protheus_code} className={`flex items-center transition-colors ${isSelected ? 'bg-primary/5' : ''} hover:bg-surface-container`}>
                  <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/10 py-2">
                    <input type="checkbox" checked={isSelected} onChange={() => onToggle(a.protheus_code)} className="accent-primary cursor-pointer" />
                  </div>
                  <div className="w-36 shrink-0 border-r border-outline-variant/10 px-2 py-2 text-xs font-mono text-primary truncate cursor-pointer" onClick={() => onToggle(a.protheus_code)}>
                    {a.protheus_code}
                  </div>
                  <div className="flex-1 border-r border-outline-variant/10 px-2 py-2 text-xs text-on-surface-variant truncate cursor-pointer" onClick={() => onToggle(a.protheus_code)}>
                    {a.name}
                  </div>
                  {/* QTD */}
                  <div className="w-16 shrink-0 border-r border-outline-variant/10 px-1.5 py-1">
                    <input
                      type="number"
                      min={1}
                      value={settings.quantity}
                      onChange={e => onCfgChange(a.protheus_code, 'quantity', e.target.value)}
                      onClick={() => { if (!isSelected) onToggle(a.protheus_code) }}
                      className={`w-full bg-surface-container border border-outline-variant rounded px-1.5 py-1 text-xs font-mono text-center focus:outline-none focus:border-primary transition-colors ${
                        isSelected ? 'text-on-surface' : 'text-outline/50'
                      }`}
                    />
                  </div>
                  {/* Fator Prop */}
                  <div className="w-20 shrink-0 px-1.5 py-1">
                    <input
                      type="number"
                      step="0.01"
                      value={settings.factor}
                      onChange={e => onCfgChange(a.protheus_code, 'factor', e.target.value)}
                      onClick={() => { if (!isSelected) onToggle(a.protheus_code) }}
                      placeholder="1"
                      className={`w-full bg-surface-container border border-outline-variant rounded px-1.5 py-1 text-xs font-mono text-center focus:outline-none focus:border-primary transition-colors ${
                        isSelected ? 'text-on-surface' : 'text-outline/50'
                      }`}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="px-4 py-2 border-t border-outline-variant/40 text-xs font-mono text-outline flex items-center gap-2">
            {selected.size > 0 ? <span className="text-primary">{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span> : <span>Nenhum selecionado</span>}
            <span className="text-outline/40">·</span><span>{items.length} no grupo</span>
            {visible.length !== items.length && <><span className="text-outline/40">·</span><span>{visible.length} visíveis</span></>}
          </div>
        </>
      )}
    </div>
  )
}
