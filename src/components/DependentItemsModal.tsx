'use client'

import { useState, useEffect, useMemo } from 'react'
import ColumnFilter from './ColumnFilter'
import { useProtheusAuth } from '@/lib/protheusAuthContext'

interface Equip     { legacy_id: number; name: string }
interface Group     { legacy_id: number; name: string }
interface Accessory { protheus_code: string; name: string; legacy_group_id: number | null }
interface StdItem   { protheus_code: string; legacy_equipment_id: number; status: string }
interface EquipAccessory { protheus_code: string; legacy_equipment_id: number }
interface ItemCfg   { quantity: number; factor: string } // factor as string to allow '' → null
interface AvulsoRow { id: string; code: string; quantity: string; cost: string; factor: string }

// Synthetic "group" injected only into Grupo — Cód. Item (never Cód.
// Dependente): instead of Cadastro de Componentes, lists every protheus_code
// from Cadastro de Equipamentos (standard_equipment_items) tied to whatever
// Equipamento is picked at the top of this same form.
const EQUIPMENTS_GROUP_ID = '__equipamentos__'

// Synthetic "group" injected into Grupo — Cód. Dependente, always available
// regardless of what's picked on the Cód. Item side — lets the user type in
// dependent codes by hand instead of picking from a real group's item list.
const CODIGO_AVULSO_ID = '__avulso__'

const makeEmptyAvulsoRow = (): AvulsoRow => ({
  id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()),
  code: '', quantity: '1', cost: '0', factor: '1',
})

interface Props {
  onClose: () => void
  onSaved: (count: number) => void
}

export default function DependentItemsModal({ onClose, onSaved }: Props) {
  const [equipments,       setEquipments]       = useState<Equip[]>([])
  const [groups,           setGroups]           = useState<Group[]>([])
  const [allAcc,           setAllAcc]           = useState<Accessory[]>([])
  const [stdItems,         setStdItems]         = useState<StdItem[]>([])
  const [equipAccessories, setEquipAccessories] = useState<EquipAccessory[]>([])
  const [equipId,    setEquipId]    = useState('')
  const [g1,         setG1]         = useState('')
  const [g2,         setG2]         = useState('')
  const [sel1,       setSel1]       = useState<Set<string>>(new Set())
  const [sel2,       setSel2]       = useState<Set<string>>(new Set())
  // Per-item settings for box 2 (quantity + proportional_factor)
  const [cfg2,       setCfg2]       = useState<Record<string, ItemCfg>>({})
  // Manual rows for box 2 when Grupo — Cód. Dependente = CÓD. AVULSO
  const [avulsoRows, setAvulsoRows] = useState<AvulsoRow[]>([])
  const [saving,     setSaving]     = useState(false)
  const [result,     setResult]     = useState<{ ok: number; fail: number } | null>(null)

  // Display names for the EQUIPAMENTOS group (B1_DESC, falling back to
  // DESC_ESTRUTURA, else 'N/A') — uses the single app-wide Protheus
  // connection (see Sidebar) instead of asking for credentials here.
  const { creds: dbCreds } = useProtheusAuth()
  const [equipNames,   setEquipNames]   = useState<Record<string, string>>({})
  const [loadingNames, setLoadingNames] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/equipments?limit=25000').then(r => r.json()),
      fetch('/api/accessory_groups?limit=25000').then(r => r.json()),
      fetch('/api/accessories?limit=25000').then(r => r.json()),
      fetch('/api/standard_equipment_items?limit=25000').then(r => r.json()),
      fetch('/api/relationship_equip_accessory?limit=25000').then(r => r.json()),
    ]).then(([eq, gr, ac, si, rel]) => {
      setEquipments(eq.data || [])
      setGroups(gr.data || [])
      setAllAcc(ac.data || [])
      setStdItems(si.data || [])
      setEquipAccessories(rel.data || [])
    })
  }, [])

  // Mesma regra do dropdown de Equipamento x Acessórios: só entram
  // equipamentos com pelo menos um item ativo em Cadastro de Equipamentos.
  const activeEquipIds = useMemo(() =>
    new Set(stdItems.filter(r => r.status === 'active').map(r => r.legacy_equipment_id))
  , [stdItems])
  const activeEquipments = useMemo(() =>
    equipments.filter(eq => activeEquipIds.has(eq.legacy_id))
  , [equipments, activeEquipIds])

  // Only accessories actually registered (via Equipamento x Acessórios) for
  // the equipment picked above — a group can hold accessories never linked
  // to this specific equipment, and those shouldn't be selectable here.
  // null (instead of an empty Set) distinguishes "no equipment picked yet"
  // from "picked, but nothing linked". Doesn't apply to the EQUIPAMENTOS
  // pseudo-group (already scoped to the equipment via standard_equipment_items
  // itself) nor to CÓD. AVULSO (free typing, no group/join involved).
  const linkedCodes = useMemo(() => {
    if (!equipId) return null
    return new Set(
      equipAccessories
        .filter(r => String(r.legacy_equipment_id) === equipId)
        .map(r => r.protheus_code.trim().toUpperCase())
    )
  }, [equipAccessories, equipId])

  // Raw protheus_code list behind the EQUIPAMENTOS group, before Protheus
  // names are resolved — also what drives the name-fetch effect below.
  const equipCodes = useMemo(() => {
    if (g1 !== EQUIPMENTS_GROUP_ID) return []
    return stdItems.filter(r => String(r.legacy_equipment_id) === equipId).map(r => r.protheus_code)
  }, [g1, stdItems, equipId])

  useEffect(() => {
    if (!dbCreds || equipCodes.length === 0) return
    setLoadingNames(true)
    fetch('/api/protheus-nomes-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: dbCreds.user, password: dbCreds.password, codes: equipCodes }),
    })
      .then(r => r.json())
      .then(json => { if (json.names) setEquipNames(prev => ({ ...prev, ...json.names })) })
      .catch(() => {})
      .finally(() => setLoadingNames(false))
  }, [dbCreds, equipCodes])

  // Grupos como EMBALAGEM não são equipamento-específicos — nunca aparecem
  // em Equipamento x Acessórios pra nenhum equipamento, então o filtro por
  // linkedCodes zeraria a lista inteira. Quando o grupo escolhido não tem
  // NENHUM item vinculado a este equipamento, cai pra listar todos os itens
  // do grupo direto do Cadastro de Componentes (accessories), sem restrição
  // — grupos que têm ao menos um item vinculado continuam restritos a esses.
  const acc1 = useMemo(() => {
    if (g1 === EQUIPMENTS_GROUP_ID) {
      // Falls back to the raw code (today's behavior) until Protheus is
      // connected and the name for that specific code has come back.
      return equipCodes.map(code => ({ protheus_code: code, name: equipNames[code] ?? code, legacy_group_id: null }))
    }
    if (!linkedCodes) return []
    const linked = allAcc.filter(a => String(a.legacy_group_id) === g1 && linkedCodes.has(a.protheus_code.trim().toUpperCase()))
    if (linked.length > 0) return linked
    return allAcc.filter(a => String(a.legacy_group_id) === g1)
  }, [allAcc, g1, equipCodes, equipNames, linkedCodes])
  const acc2 = useMemo(() => {
    if (!linkedCodes) return []
    const linked = allAcc.filter(a => String(a.legacy_group_id) === g2 && linkedCodes.has(a.protheus_code.trim().toUpperCase()))
    if (linked.length > 0) return linked
    return allAcc.filter(a => String(a.legacy_group_id) === g2)
  }, [allAcc, g2, linkedCodes])

  // When the same group is selected on both sides: an item chosen as trigger
  // cannot also be picked as dependent, and vice-versa — blocking only went
  // one way before (box 2 blocked against sel1, but box 1 never blocked
  // against sel2), so picking Cód. Dependente first didn't cut the same
  // component out of Cód. Item.
  const sameGroup = g1 !== '' && g1 === g2
  const blocked1  = sameGroup ? sel2 : new Set<string>()
  const blocked2  = sameGroup ? sel1 : new Set<string>()

  const toggle1 = (code: string) => {
    if (blocked1.has(code)) return
    setSel1(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }

  const toggle2 = (code: string) => {
    if (blocked2.has(code)) return
    setSel2(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
    setCfg2(prev => prev[code] ? prev : { ...prev, [code]: { quantity: 1, factor: '1' } })
  }

  const setCfgField = (code: string, field: 'quantity' | 'factor', val: string) =>
    setCfg2(prev => ({ ...prev, [code]: { ...prev[code] ?? { quantity: 1, factor: '1' }, [field]: field === 'quantity' ? Math.max(1, Number(val) || 1) : val } }))

  const addAvulsoRow    = () => setAvulsoRows(prev => [...prev, makeEmptyAvulsoRow()])
  const removeAvulsoRow = (id: string) => setAvulsoRows(prev => prev.filter(r => r.id !== id))
  const updateAvulsoRow = (id: string, field: keyof Omit<AvulsoRow, 'id'>, val: string) =>
    setAvulsoRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r))

  const isAvulso = g2 === CODIGO_AVULSO_ID
  const validAvulsoRows = useMemo(() => avulsoRows.filter(r => r.code.trim() !== ''), [avulsoRows])
  const dependentCount = isAvulso ? validAvulsoRows.length : sel2.size
  const pairs = sel1.size * dependentCount

  const handleSubmit = async () => {
    if (!equipId || !g1 || !g2 || !sel1.size || !dependentCount) return
    setSaving(true)
    setResult(null)

    type Payload = { protheus_code: string; protheus_item_code: string; quantity: number; cost_std: number; proportional_factor: number | null }
    const payloads: Payload[] = []
    if (isAvulso) {
      for (const c1 of sel1) {
        for (const row of validAvulsoRows) {
          payloads.push({
            protheus_code: c1,
            protheus_item_code: row.code.trim(),
            quantity: Math.max(1, Number(row.quantity) || 1),
            cost_std: Number(row.cost) || 0,
            proportional_factor: row.factor.trim() !== '' ? Number(row.factor) : null,
          })
        }
      }
    } else {
      for (const c1 of sel1) {
        for (const c2 of sel2) {
          const settings = cfg2[c2] ?? { quantity: 1, factor: '1' }
          payloads.push({
            protheus_code: c1,
            protheus_item_code: c2,
            quantity: settings.quantity,
            cost_std: 0,
            proportional_factor: settings.factor !== '' ? Number(settings.factor) : null,
          })
        }
      }
    }

    const settled = await Promise.allSettled(
      payloads.map(p => fetch('/api/dependant_items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legacy_equipment_id: Number(equipId), ...p }),
      }).then(r => { if (!r.ok) throw new Error(); return r }))
    )

    const ok   = settled.filter(r => r.status === 'fulfilled').length
    const fail = settled.filter(r => r.status === 'rejected').length
    setSaving(false)
    setResult({ ok, fail })
    if (ok > 0) onSaved(ok)
  }

  const canSubmit = !!(equipId && g1 && g2 && sel1.size && dependentCount)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col animate-fade-in">

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
              {activeEquipments.map(eq => <option key={eq.legacy_id} value={eq.legacy_id}>{eq.name}</option>)}
            </select>
          </div>

          {/* Group selectors */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-outline uppercase tracking-[0.12em] mb-2">Grupo — Cód. Item</label>
              <select
                value={g1}
                onChange={e => { setG1(e.target.value); setSel1(new Set()) }}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              >
                <option value="">Selecione o grupo...</option>
                <option value={EQUIPMENTS_GROUP_ID}>EQUIPAMENTOS</option>
                {groups.map(g => <option key={g.legacy_id} value={g.legacy_id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-outline uppercase tracking-[0.12em] mb-2">Grupo — Cód. Dependente</label>
              <select
                value={g2}
                onChange={e => {
                  const v = e.target.value
                  setG2(v); setSel2(new Set()); setCfg2({})
                  if (v === CODIGO_AVULSO_ID) setAvulsoRows(prev => prev.length ? prev : [makeEmptyAvulsoRow()])
                }}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              >
                <option value="">Selecione o grupo...</option>
                <option value={CODIGO_AVULSO_ID}>CÓD. AVULSO</option>
                {groups.map(g => <option key={g.legacy_id} value={g.legacy_id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          {/* Protheus names for EQUIPAMENTOS (B1_DESC / DESC_ESTRUTURA) — uses the
              single app-wide connection (see Sidebar); no per-window button here. */}
          {g1 === EQUIPMENTS_GROUP_ID && (
            <div className="flex items-center gap-3 -mt-2">
              <span className="text-xs text-outline">
                {dbCreds
                  ? (loadingNames ? '⏳ Buscando nomes no Protheus…' : '🔌 Nomes resolvidos por B1_DESC/DESC_ESTRUTURA')
                  : 'Conecte ao Protheus (barra lateral) para ver os nomes reais — por ora, o código é exibido como nome'}
              </span>
            </div>
          )}

          {/* Two accessory boxes */}
          <div className="grid grid-cols-2 gap-5">
            {/* Box 1 — Cód. Item (trigger) */}
            <TriggerBox
              key={`trig-${g1}`}
              title="Cód. Item — Gatilho"
              items={acc1}
              selected={sel1}
              blockedCodes={blocked1}
              onToggle={toggle1}
              onAll={visible => setSel1(new Set(visible.filter(a => !blocked1.has(a.protheus_code)).map(a => a.protheus_code)))}
              onNone={() => setSel1(new Set())}
              empty={!g1}
              noEquip={!equipId}
            />
            {/* Box 2 — Cód. Dependente: manual rows (CÓD. AVULSO) or the usual group picker */}
            {isAvulso ? (
              <AvulsoBox rows={avulsoRows} onAdd={addAvulsoRow} onRemove={removeAvulsoRow} onChange={updateAvulsoRow} />
            ) : (
              <DependentBox
                key={`dep-${g2}`}
                title="Cód. Dependente"
                items={acc2}
                selected={sel2}
                blockedCodes={blocked2}
                cfg={cfg2}
                onToggle={toggle2}
                onAll={visible => {
                  const allowed = visible.filter(a => !blocked2.has(a.protheus_code))
                  setSel2(new Set(allowed.map(a => a.protheus_code)))
                  setCfg2(prev => {
                    const n = { ...prev }
                    for (const a of allowed) if (!n[a.protheus_code]) n[a.protheus_code] = { quantity: 1, factor: '1' }
                    return n
                  })
                }}
                onNone={() => setSel2(new Set())}
                onCfgChange={setCfgField}
                empty={!g2}
                noEquip={!equipId}
              />
            )}
          </div>

          {/* Summary */}
          {pairs > 0 && !result && (
            <div className="flex items-center gap-2 text-sm font-mono bg-primary/5 border border-primary/20 rounded px-4 py-3 text-primary">
              <span>{sel1.size} × {dependentCount} = {pairs} par{pairs !== 1 ? 'es' : ''}</span>
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
  title, items, selected, blockedCodes, onToggle, onAll, onNone, empty, noEquip,
}: {
  title: string; items: Accessory[]; selected: Set<string>; blockedCodes: Set<string>
  onToggle: (c: string) => void; onAll: (v: Accessory[]) => void; onNone: () => void; empty: boolean; noEquip: boolean
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
  const allSel = selectableVisible.length > 0 && selectableVisible.every(a => selected.has(a.protheus_code))

  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden min-h-[28rem]">
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
      ) : noEquip ? (
        <div className="px-4 py-12 text-center text-sm text-outline italic">Selecione um equipamento acima</div>
      ) : (
        <>
          <div className="flex items-stretch border-b border-outline-variant bg-surface-container-high text-[10px] font-semibold text-outline uppercase tracking-[0.1em]">
            <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/30 px-2">
              <input type="checkbox" checked={allSel} onChange={() => allSel ? onNone() : onAll(visible)} className="accent-primary" />
            </div>
            <div className="w-44 shrink-0 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
              <span>Código</span>
              <ColumnFilter searchValue={codeSearch} onSearchChange={setCodeSearch} selectedValues={codeSelected} onToggleValue={v => setCodeSelected(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])} onClearValues={() => setCodeSelected([])} options={codeOptions} />
            </div>
            <div className="flex-1 px-2 py-2 flex flex-col gap-1.5">
              <span>Nome</span>
              <ColumnFilter searchValue={nameSearch} onSearchChange={setNameSearch} selectedValues={nameSelected} onToggleValue={v => setNameSelected(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])} onClearValues={() => setNameSelected([])} options={nameOptions} />
            </div>
          </div>
          <div className="overflow-y-auto min-h-[18rem] max-h-72 divide-y divide-outline-variant/20">
            {visible.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-outline italic">Nenhum resultado</div>
            ) : visible.map(a => {
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
                    {blocked && <span className="ml-1.5 text-[10px] text-outline font-mono">(selecionado como dependente)</span>}
                  </div>
                </label>
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

// ── DependentBox (Cód. Dependente — with QTD + Fator Prop per item) ──────────

function DependentBox({
  title, items, selected, blockedCodes, cfg, onToggle, onAll, onNone, onCfgChange, empty, noEquip,
}: {
  title: string; items: Accessory[]; selected: Set<string>; blockedCodes: Set<string>; cfg: Record<string, ItemCfg>
  onToggle: (c: string) => void; onAll: (v: Accessory[]) => void; onNone: () => void
  onCfgChange: (code: string, field: 'quantity' | 'factor', val: string) => void; empty: boolean; noEquip: boolean
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
  const allSel = selectableVisible.length > 0 && selectableVisible.every(a => selected.has(a.protheus_code))

  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden min-h-[28rem]">
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
      ) : noEquip ? (
        <div className="px-4 py-12 text-center text-sm text-outline italic">Selecione um equipamento acima</div>
      ) : (
        <>
          {/* Column headers */}
          <div className="flex items-stretch border-b border-outline-variant bg-surface-container-high text-[10px] font-semibold text-outline uppercase tracking-[0.1em]">
            <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/30 px-2">
              <input type="checkbox" checked={allSel} onChange={() => allSel ? onNone() : onAll(visible)} className="accent-primary" />
            </div>
            <div className="w-36 shrink-0 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
              <span>Código</span>
              <ColumnFilter searchValue={codeSearch} onSearchChange={setCodeSearch} selectedValues={codeSelected} onToggleValue={v => setCodeSelected(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])} onClearValues={() => setCodeSelected([])} options={codeOptions} />
            </div>
            <div className="flex-1 border-r border-outline-variant/30 px-2 py-2 flex flex-col gap-1.5">
              <span>Nome</span>
              <ColumnFilter searchValue={nameSearch} onSearchChange={setNameSearch} selectedValues={nameSelected} onToggleValue={v => setNameSelected(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])} onClearValues={() => setNameSelected([])} options={nameOptions} />
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
          <div className="overflow-y-auto min-h-[18rem] max-h-72 divide-y divide-outline-variant/20">
            {visible.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-outline italic">Nenhum resultado</div>
            ) : visible.map(a => {
              const isBlocked  = blockedCodes.has(a.protheus_code)
              const isSelected = selected.has(a.protheus_code)
              const settings   = cfg[a.protheus_code] ?? { quantity: 1, factor: '1' }
              return (
                <div
                  key={a.protheus_code}
                  className={`flex items-center transition-colors ${
                    isBlocked  ? 'opacity-35 cursor-not-allowed bg-surface-container-highest' :
                    isSelected ? 'bg-primary/5 hover:bg-primary/8' :
                                 'hover:bg-surface-container'
                  }`}
                >
                  <div className="w-9 flex items-center justify-center shrink-0 border-r border-outline-variant/10 py-2">
                    <input type="checkbox" checked={isSelected} disabled={isBlocked} onChange={() => onToggle(a.protheus_code)} className="accent-primary cursor-pointer disabled:cursor-not-allowed" />
                  </div>
                  <div className={`w-36 shrink-0 border-r border-outline-variant/10 px-2 py-2 text-xs font-mono truncate ${isBlocked ? 'text-outline line-through' : 'text-primary cursor-pointer'}`} onClick={() => !isBlocked && onToggle(a.protheus_code)}>
                    {a.protheus_code}
                  </div>
                  <div className={`flex-1 border-r border-outline-variant/10 px-2 py-2 text-xs text-on-surface-variant truncate ${isBlocked ? '' : 'cursor-pointer'}`} onClick={() => !isBlocked && onToggle(a.protheus_code)}>
                    {a.name}
                    {isBlocked && <span className="ml-1.5 text-[10px] text-outline font-mono">(selecionado como gatilho)</span>}
                  </div>
                  {/* QTD */}
                  <div className="w-16 shrink-0 border-r border-outline-variant/10 px-1.5 py-1">
                    <input
                      type="number" min={1} value={settings.quantity} disabled={isBlocked}
                      onChange={e => onCfgChange(a.protheus_code, 'quantity', e.target.value)}
                      onClick={() => { if (!isBlocked && !isSelected) onToggle(a.protheus_code) }}
                      className={`w-full bg-surface-container border border-outline-variant rounded px-1.5 py-1 text-xs font-mono text-center focus:outline-none focus:border-primary transition-colors disabled:cursor-not-allowed ${isSelected ? 'text-on-surface' : 'text-outline/50'}`}
                    />
                  </div>
                  {/* Fator Prop */}
                  <div className="w-20 shrink-0 px-1.5 py-1">
                    <input
                      type="number" step="0.01" value={settings.factor} disabled={isBlocked} placeholder="1"
                      onChange={e => onCfgChange(a.protheus_code, 'factor', e.target.value)}
                      onClick={() => { if (!isBlocked && !isSelected) onToggle(a.protheus_code) }}
                      className={`w-full bg-surface-container border border-outline-variant rounded px-1.5 py-1 text-xs font-mono text-center focus:outline-none focus:border-primary transition-colors disabled:cursor-not-allowed ${isSelected ? 'text-on-surface' : 'text-outline/50'}`}
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

// ── AvulsoBox (Cód. Dependente — CÓD. AVULSO: linhas digitadas manualmente) ──

const avulsoFieldClass = "w-full bg-surface-container border border-outline-variant rounded px-1.5 py-1.5 text-xs font-mono text-center focus:outline-none focus:border-primary transition-colors"

function AvulsoBox({
  rows, onAdd, onRemove, onChange,
}: {
  rows: AvulsoRow[]
  onAdd: () => void
  onRemove: (id: string) => void
  onChange: (id: string, field: keyof Omit<AvulsoRow, 'id'>, val: string) => void
}) {
  const validCount = rows.filter(r => r.code.trim() !== '').length
  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden min-h-[28rem]">
      <div className="px-4 py-2.5 border-b border-outline-variant bg-surface-container-highest flex items-center justify-between">
        <span className="text-xs font-semibold text-outline uppercase tracking-[0.1em]">Cód. Dependente — Avulso</span>
        <button type="button" onClick={onAdd} className="flex items-center gap-1 text-primary hover:underline text-xs font-semibold">
          <span className="text-sm leading-none">+</span> linha
        </button>
      </div>
      <div className="flex items-stretch border-b border-outline-variant bg-surface-container-high text-[10px] font-semibold text-outline uppercase tracking-[0.1em]">
        <div className="flex-1 px-2 py-2">Cód. Dependente</div>
        <div className="w-16 shrink-0 border-l border-outline-variant/30 px-2 py-2 text-center">Qtd.</div>
        <div className="w-20 shrink-0 border-l border-outline-variant/30 px-2 py-2 text-center">Custo</div>
        <div className="w-20 shrink-0 border-l border-outline-variant/30 px-2 py-2 text-center">Fat.Prop.</div>
        <div className="w-8 shrink-0" />
      </div>
      <div className="overflow-y-auto min-h-[18rem] max-h-72 divide-y divide-outline-variant/20">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-outline italic">Nenhuma linha — clique em &quot;+ linha&quot;</div>
        ) : rows.map(row => (
          <div key={row.id} className="flex items-center">
            <div className="flex-1 px-1.5 py-1.5">
              <input
                type="text" value={row.code} onChange={e => onChange(row.id, 'code', e.target.value)}
                placeholder="Ex: 27.02.00123"
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
            <div className="w-16 shrink-0 px-1.5 py-1.5">
              <input type="number" min={1} value={row.quantity} onChange={e => onChange(row.id, 'quantity', e.target.value)} className={avulsoFieldClass} />
            </div>
            <div className="w-20 shrink-0 px-1.5 py-1.5">
              <input type="number" step="0.01" value={row.cost} onChange={e => onChange(row.id, 'cost', e.target.value)} className={avulsoFieldClass} />
            </div>
            <div className="w-20 shrink-0 px-1.5 py-1.5">
              <input type="number" step="0.01" placeholder="1" value={row.factor} onChange={e => onChange(row.id, 'factor', e.target.value)} className={avulsoFieldClass} />
            </div>
            <div className="w-8 shrink-0 flex items-center justify-center">
              <button type="button" onClick={() => onRemove(row.id)} title="Remover linha" className="text-outline hover:text-error text-sm px-1">✕</button>
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2 border-t border-outline-variant/40 text-xs font-mono text-outline flex items-center gap-2">
        {validCount > 0 ? <span className="text-primary">{validCount} código{validCount !== 1 ? 's' : ''} válido{validCount !== 1 ? 's' : ''}</span> : <span>Nenhum código preenchido</span>}
        <span className="text-outline/40">·</span><span>{rows.length} linha{rows.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}
