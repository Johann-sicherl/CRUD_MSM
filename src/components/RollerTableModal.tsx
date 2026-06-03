'use client'

import { useState, useEffect, useMemo } from 'react'
import ColumnFilter from './ColumnFilter'

const TYPE_OPTIONS = ['start', 'middle', 'end', 'unique'] as const
type RollerType = typeof TYPE_OPTIONS[number]
const TYPE_LABELS: Record<RollerType, string> = {
  start: 'Início',
  middle: 'Meio',
  end: 'Fim',
  unique: 'Único',
}

const ROLLER_GROUP_ID = '12'

interface Equip     { legacy_id: number; name: string }
interface Accessory { protheus_code: string; name: string; legacy_group_id: number | null }

interface Props {
  onClose: () => void
  onSaved: (count: number) => void
}

export default function RollerTableModal({ onClose, onSaved }: Props) {
  const [equipments, setEquipments] = useState<Equip[]>([])
  const [allAcc,     setAllAcc]     = useState<Accessory[]>([])
  const [equipId,    setEquipId]    = useState('')
  const [sel,        setSel]        = useState<Set<string>>(new Set())
  const [cfg,        setCfg]        = useState<Record<string, RollerType>>({})
  const [saving,     setSaving]     = useState(false)
  const [result,     setResult]     = useState<{ ok: number; fail: number } | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/equipments?limit=25000').then(r => r.json()),
      fetch('/api/accessories?limit=25000').then(r => r.json()),
    ]).then(([eq, ac]) => {
      setEquipments(eq.data || [])
      setAllAcc(ac.data || [])
    })
  }, [])

  const accList = useMemo(
    () => allAcc.filter(a => String(a.legacy_group_id) === ROLLER_GROUP_ID),
    [allAcc]
  )

  const toggle = (code: string) => {
    setSel(prev => {
      const n = new Set(prev)
      if (n.has(code)) {
        n.delete(code)
      } else {
        n.add(code)
        setCfg(c => c[code] ? c : { ...c, [code]: 'start' })
      }
      return n
    })
  }

  const setType = (code: string, type: RollerType) => {
    setCfg(prev => ({ ...prev, [code]: type }))
    setSel(prev => { const n = new Set(prev); n.add(code); return n })
  }

  const handleSubmit = async () => {
    if (!equipId || !sel.size) return
    setSaving(true)
    setResult(null)

    const settled = await Promise.allSettled(
      Array.from(sel).map(protheus_code =>
        fetch('/api/roller_tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legacy_equipment_id: Number(equipId),
            protheus_code,
            type: cfg[protheus_code] ?? 'start',
          }),
        }).then(r => { if (!r.ok) throw new Error(); return r })
      )
    )

    const ok   = settled.filter(r => r.status === 'fulfilled').length
    const fail = settled.filter(r => r.status === 'rejected').length
    setSaving(false)
    setResult({ ok, fail })
    if (ok > 0) onSaved(ok)
  }

  const canSubmit = !!(equipId && sel.size)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant shadow-2xl w-full max-w-4xl max-h-[94vh] flex flex-col animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-outline-variant shrink-0">
          <div>
            <div className="text-xs font-mono text-outline uppercase tracking-[0.2em]">NOVO REGISTRO</div>
            <h2 className="text-xl font-bold text-on-surface mt-0.5">Tipo Mesas de Roletes</h2>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors text-xl">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-7 py-6 flex flex-col gap-6">

          {/* Equipment selector */}
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

          {/* Component list */}
          <ComponentBox
            items={accList}
            selected={sel}
            cfg={cfg}
            onToggle={toggle}
            onAll={visible => {
              setSel(new Set(visible.map(a => a.protheus_code)))
              setCfg(prev => {
                const n = { ...prev }
                for (const a of visible) if (!n[a.protheus_code]) n[a.protheus_code] = 'start'
                return n
              })
            }}
            onNone={() => { setSel(new Set()); setCfg({}) }}
            onTypeChange={setType}
          />

          {/* Summary */}
          {sel.size > 0 && !result && (
            <div className="flex items-center gap-2 text-sm font-mono bg-primary/5 border border-primary/20 rounded px-4 py-3 text-primary">
              <span className="font-bold">{sel.size} componente{sel.size !== 1 ? 's' : ''}</span>
              <span className="text-outline">→</span>
              <span>{sel.size} registro{sel.size !== 1 ? 's' : ''} serão inseridos</span>
            </div>
          )}

          {result && (
            <div className={`text-sm font-mono rounded px-4 py-3 border ${
              result.fail === 0
                ? 'bg-green-900/20 border-green-800/40 text-green-400'
                : 'bg-error-container/20 border-error/30 text-error'
            }`}>
              ✓ {result.ok} registros inseridos
              {result.fail > 0 && ` · ⚠ ${result.fail} com erro (duplicata ou inválido)`}
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
              {saving ? 'Inserindo...' : `Inserir${sel.size > 0 ? ` ${sel.size} registro${sel.size !== 1 ? 's' : ''}` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ComponentBox ──────────────────────────────────────────────────────────────

function ComponentBox({
  items, selected, cfg, onToggle, onAll, onNone, onTypeChange,
}: {
  items: Accessory[]
  selected: Set<string>
  cfg: Record<string, RollerType>
  onToggle: (code: string) => void
  onAll: (visible: Accessory[]) => void
  onNone: () => void
  onTypeChange: (code: string, type: RollerType) => void
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

  const allSel = visible.length > 0 && visible.every(a => selected.has(a.protheus_code))

  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden">

      {/* Box header */}
      <div className="px-4 py-2.5 border-b border-outline-variant bg-surface-container-highest flex items-center justify-between">
        <span className="text-xs font-semibold text-outline uppercase tracking-[0.1em]">
          Componentes — {items.length} no grupo
        </span>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => onAll(visible)} className="text-primary hover:underline">todos</button>
          <span className="text-outline/40">|</span>
          <button onClick={onNone} className="text-outline hover:text-primary">nenhum</button>
        </div>
      </div>

      {/* Column headers + filters */}
      <div className="flex items-stretch border-b border-outline-variant bg-surface-container-high text-[10px] font-semibold text-outline uppercase tracking-[0.1em]">
        <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/30 px-2">
          <input
            type="checkbox"
            checked={allSel}
            onChange={() => allSel ? onNone() : onAll(visible)}
            className="accent-primary"
            title="Selecionar todos visíveis"
          />
        </div>
        <div className="w-44 shrink-0 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
          <span>Código</span>
          <ColumnFilter searchValue={codeSearch} onSearchChange={setCodeSearch} selectedValues={codeSelected} onToggleValue={v => setCodeSelected(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])} onClearValues={() => setCodeSelected([])} options={codeOptions} />
        </div>
        <div className="flex-1 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
          <span>Nome</span>
          <ColumnFilter searchValue={nameSearch} onSearchChange={setNameSearch} selectedValues={nameSelected} onToggleValue={v => setNameSelected(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])} onClearValues={() => setNameSelected([])} options={nameOptions} />
        </div>
        <div className="w-36 shrink-0 px-2 py-2 text-center">
          <div>Tipo da Peça</div>
          <div className="text-[9px] text-outline/50 normal-case tracking-normal font-normal mt-0.5">obrigatório</div>
        </div>
      </div>

      {/* Items */}
      <div className="overflow-y-auto max-h-96 divide-y divide-outline-variant/20">
        {visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-outline italic">Nenhum resultado</div>
        ) : (
          visible.map(a => {
            const isSelected = selected.has(a.protheus_code)
            const itemType   = cfg[a.protheus_code] ?? 'start'
            return (
              <div
                key={a.protheus_code}
                className={`flex items-center transition-colors ${
                  isSelected ? 'bg-primary/5 hover:bg-primary/8' : 'hover:bg-surface-container'
                }`}
              >
                <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/10 py-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(a.protheus_code)}
                    className="accent-primary cursor-pointer"
                  />
                </div>
                <div
                  className="w-44 shrink-0 border-r border-outline-variant/10 px-2 py-2 text-xs font-mono text-primary truncate cursor-pointer"
                  onClick={() => onToggle(a.protheus_code)}
                >
                  {a.protheus_code}
                </div>
                <div
                  className="flex-1 border-r border-outline-variant/10 px-2 py-2 text-xs text-on-surface-variant truncate cursor-pointer"
                  onClick={() => onToggle(a.protheus_code)}
                >
                  {a.name}
                </div>
                <div className="w-36 shrink-0 px-2 py-1">
                  <select
                    value={itemType}
                    onChange={e => onTypeChange(a.protheus_code, e.target.value as RollerType)}
                    className={`w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs focus:outline-none focus:border-primary transition-colors ${
                      isSelected ? 'text-on-surface border-primary/40' : 'text-outline/60'
                    }`}
                  >
                    {TYPE_OPTIONS.map(t => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer count */}
      <div className="px-4 py-2 border-t border-outline-variant/40 text-xs font-mono text-outline flex items-center gap-2">
        {selected.size > 0
          ? <span className="text-primary">{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span>
          : <span>Nenhum selecionado</span>
        }
        <span className="text-outline/40">·</span>
        <span>{items.length} componentes</span>
        {visible.length !== items.length && (
          <><span className="text-outline/40">·</span><span>{visible.length} visíveis</span></>
        )}
      </div>
    </div>
  )
}
