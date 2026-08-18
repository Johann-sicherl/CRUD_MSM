'use client'

import { useState, useEffect, useMemo } from 'react'
import ColumnFilter from './ColumnFilter'

interface Equip { legacy_id: number; name: string }
interface Group { legacy_id: number; name: string }
interface Accessory { protheus_code: string; name: string; legacy_group_id: number | null }
interface EquipAccessory { protheus_code: string; legacy_equipment_id: number; status: string }
interface StdItem { legacy_equipment_id: number; status: string }

interface QueueItem {
  qid: string
  legacy_equipment_id: number
  protheus_code: string
  remove_list_code: string
}

interface Props {
  onClose: () => void
  onSaved: (count: number) => void
}

// Par não-ordenado: a mesma regra A-B ou B-A é a mesma regra (o servidor já
// grava as duas direções via doubleInsert) — usada pra nunca deixar entrar
// na fila uma combinação que já está lá.
const pairKey = (equipId: number, a: string, b: string) => `${equipId}|${[a, b].sort().join('|')}`

export default function NonCombinableModal({ onClose, onSaved }: Props) {
  const [equipments,       setEquipments]       = useState<Equip[]>([])
  const [groups,           setGroups]           = useState<Group[]>([])
  const [allAcc,           setAllAcc]           = useState<Accessory[]>([])
  const [equipAccessories, setEquipAccessories] = useState<EquipAccessory[]>([])
  const [stdItems,         setStdItems]         = useState<StdItem[]>([])
  const [equipId,    setEquipId]    = useState('')
  const [g1,         setG1]         = useState('')
  const [g2,         setG2]         = useState('')
  const [sel1,       setSel1]       = useState<Set<string>>(new Set())
  const [sel2,       setSel2]       = useState<Set<string>>(new Set())

  // Fila de inserção — mesma lógica de Equipamento x Acessórios: os pares
  // selecionados caem numa lista abaixo do formulário, e só viram registro
  // de verdade quando "Criar N registros" é clicado.
  const [queue,         setQueue]         = useState<QueueItem[]>([])
  const [queueSelected, setQueueSelected] = useState<Set<string>>(new Set())
  const [editingQid,    setEditingQid]    = useState<string | null>(null)
  const [creating,      setCreating]      = useState(false)
  const [queueError,    setQueueError]    = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/equipments?limit=25000').then(r => r.json()),
      fetch('/api/accessory_groups?limit=25000').then(r => r.json()),
      fetch('/api/accessories?limit=25000').then(r => r.json()),
      fetch('/api/relationship_equip_accessory?limit=25000').then(r => r.json()),
      fetch('/api/standard_equipment_items?limit=25000').then(r => r.json()),
    ]).then(([eq, gr, ac, rel, si]) => {
      setEquipments(eq.data || [])
      setGroups(gr.data || [])
      setAllAcc(ac.data || [])
      setEquipAccessories(rel.data || [])
      setStdItems(si.data || [])
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

  const equipNameById  = useMemo(() => new Map(equipments.map(e => [e.legacy_id, e.name])), [equipments])
  const accByCode      = useMemo(() => new Map(allAcc.map(a => [a.protheus_code, a])), [allAcc])

  // Only accessories actually registered (via Equipamento x Acessórios) for
  // the equipment picked above, com o vínculo ativo (status = 'active') —
  // um vínculo desativado não deve deixar o acessório selecionável aqui,
  // mesmo que o registro ainda exista na tabela. null (instead of an empty
  // Set) distinguishes "no equipment picked yet" from "picked, but nothing
  // linked".
  const linkedCodes = useMemo(() => {
    if (!equipId) return null
    return new Set(
      equipAccessories
        .filter(r => String(r.legacy_equipment_id) === equipId && r.status === 'active')
        .map(r => r.protheus_code.trim().toUpperCase())
    )
  }, [equipAccessories, equipId])

  const acc1 = useMemo(() => {
    if (!linkedCodes) return []
    return allAcc.filter(a => String(a.legacy_group_id) === g1 && linkedCodes.has(a.protheus_code.trim().toUpperCase()))
  }, [allAcc, g1, linkedCodes])
  const acc2 = useMemo(() => {
    if (!linkedCodes) return []
    return allAcc.filter(a => String(a.legacy_group_id) === g2 && linkedCodes.has(a.protheus_code.trim().toUpperCase()))
  }, [allAcc, g2, linkedCodes])

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

  // Manda o cruzamento sel1 × sel2 pra fila — nunca deixa entrar uma
  // combinação que já está lá (mesmo equipamento + mesmo par, em qualquer
  // ordem). Mantém Equipamento/Grupos como estão, só limpa a seleção dos
  // itens (igual ao "+ Adicionar à Lista" de Equipamento x Acessórios).
  const addSelectionsToQueue = () => {
    if (!equipId || sel1.size === 0 || sel2.size === 0) return
    const equipNum = Number(equipId)
    const existingKeys = new Set(queue.map(q => pairKey(q.legacy_equipment_id, q.protheus_code, q.remove_list_code)))
    const candidates: QueueItem[] = []
    for (const c1 of sel1) {
      for (const c2 of sel2) {
        if (c1 === c2) continue
        candidates.push({ qid: crypto.randomUUID(), legacy_equipment_id: equipNum, protheus_code: c1, remove_list_code: c2 })
      }
    }
    const newItems: QueueItem[] = []
    let duplicates = 0
    for (const item of candidates) {
      const key = pairKey(item.legacy_equipment_id, item.protheus_code, item.remove_list_code)
      if (existingKeys.has(key)) { duplicates++; continue }
      existingKeys.add(key)
      newItems.push(item)
    }
    if (newItems.length === 0) {
      setQueueError('Todos os pares selecionados já estão na fila de inserção.')
      return
    }
    setQueue(prev => [...prev, ...newItems])
    setQueueError(duplicates > 0
      ? `${duplicates} par${duplicates !== 1 ? 'es' : ''} já estava${duplicates !== 1 ? 'm' : ''} na fila e foi${duplicates !== 1 ? 'ram' : ''} ignorado${duplicates !== 1 ? 's' : ''} — ${newItems.length} adicionado${newItems.length !== 1 ? 's' : ''}.`
      : '')
    setSel1(new Set())
    setSel2(new Set())
  }

  const updateEditingQueueItem = () => {
    if (!editingQid || !equipId) return
    const c1 = Array.from(sel1)[0]
    const c2 = Array.from(sel2)[0]
    if (!c1 || !c2) { setQueueError('Selecione um item em cada caixa antes de atualizar.'); return }
    const equipNum = Number(equipId)
    const key = pairKey(equipNum, c1, c2)
    const dup = queue.some(q => q.qid !== editingQid && pairKey(q.legacy_equipment_id, q.protheus_code, q.remove_list_code) === key)
    if (dup) { setQueueError('Esse par já existe em outro item da fila.'); return }
    setQueue(prev => prev.map(q => q.qid === editingQid ? { ...q, legacy_equipment_id: equipNum, protheus_code: c1, remove_list_code: c2 } : q))
    setEditingQid(null)
    setQueueError('')
    setSel1(new Set())
    setSel2(new Set())
  }

  const handleAddOrUpdate = () => editingQid ? updateEditingQueueItem() : addSelectionsToQueue()

  const handleEditQueueItem = (qid: string) => {
    const item = queue.find(q => q.qid === qid)
    if (!item) return
    const a1 = accByCode.get(item.protheus_code)
    const a2 = accByCode.get(item.remove_list_code)
    setEquipId(String(item.legacy_equipment_id))
    setG1(a1 ? String(a1.legacy_group_id) : '')
    setG2(a2 ? String(a2.legacy_group_id) : '')
    setSel1(new Set([item.protheus_code]))
    setSel2(new Set([item.remove_list_code]))
    setEditingQid(qid)
    setQueueError('')
  }

  const cancelEdit = () => {
    setEditingQid(null)
    setSel1(new Set())
    setSel2(new Set())
    setQueueError('')
  }

  const handleDeleteQueueItem = (qid: string) => {
    setQueue(prev => prev.filter(q => q.qid !== qid))
    setQueueSelected(prev => { const n = new Set(prev); n.delete(qid); return n })
    if (editingQid === qid) cancelEdit()
  }

  const toggleQueueSelect = (qid: string) => {
    setQueueSelected(prev => {
      const n = new Set(prev)
      n.has(qid) ? n.delete(qid) : n.add(qid)
      return n
    })
  }

  const allQueueSelected = queue.length > 0 && queue.every(q => queueSelected.has(q.qid))
  const toggleAllQueueSelect = () => setQueueSelected(allQueueSelected ? new Set() : new Set(queue.map(q => q.qid)))

  const deleteSelectedQueue = () => {
    if (editingQid && queueSelected.has(editingQid)) cancelEdit()
    setQueue(prev => prev.filter(q => !queueSelected.has(q.qid)))
    setQueueSelected(new Set())
  }

  // Mesma lógica de Equipamento x Acessórios: cria sequencialmente, e se
  // algo falhar, para ali, mostra o erro e deixa o resto na fila pra
  // corrigir e tentar de novo — não perde o que ainda não foi criado.
  const handleCreateAll = async () => {
    setCreating(true)
    setQueueError('')
    const items = [...queue]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const res = await fetch('/api/non_combinable_comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legacy_equipment_id: item.legacy_equipment_id,
          protheus_code: item.protheus_code,
          remove_list_code: item.remove_list_code,
          status: 'active',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setQueue(items.slice(i))
        setQueueError(`Erro no item ${i + 1}: ${err.error || 'Falha ao salvar'}`)
        setCreating(false)
        return
      }
    }
    setCreating(false)
    onSaved(items.length * 2)
  }

  const canAdd = !!(equipId && sel1.size && sel2.size)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="bg-surface-container rounded-lg border border-outline-variant shadow-2xl w-full max-w-[93.6rem] my-8 animate-fade-in flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-outline-variant shrink-0">
          <div>
            <div className="text-[12px] font-mono text-outline uppercase tracking-[0.2em]">NOVO REGISTRO</div>
            <h2 className="text-[19.2px] font-bold text-on-surface mt-0.5">Produtos Não Combináveis</h2>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface transition-colors text-2xl">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-7 py-6 flex flex-col gap-6">

          {/* Editing queue item banner */}
          {editingQid && (
            <div className="flex items-center justify-between gap-2 text-[14.4px] bg-primary/10 border border-primary/30 rounded px-3 py-2 text-primary font-mono">
              <span>✎ Editando item da fila — selecione um item em cada caixa e clique em &quot;Atualizar na Fila&quot;</span>
              <button type="button" onClick={cancelEdit} className="text-primary hover:underline shrink-0">cancelar</button>
            </div>
          )}

          {/* Equipment */}
          <div>
            <label className="block text-[12px] font-semibold text-outline uppercase tracking-[0.12em] mb-2">
              Equipamento
            </label>
            <select
              value={equipId}
              onChange={e => setEquipId(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-[16.8px] text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
              <option value="">Selecione o equipamento...</option>
              {activeEquipments.map(eq => (
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
                <label className="block text-[12px] font-semibold text-outline uppercase tracking-[0.12em] mb-2">
                  {label}
                </label>
                <select
                  value={val}
                  onChange={e => set(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-[16.8px] text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
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
              noEquip={!equipId}
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
              noEquip={!equipId}
            />
          </div>

          {/* Summary */}
          {pairs > 0 && (
            <div className="flex items-center gap-2 text-[14.4px] font-mono bg-primary/5 border border-primary/20 rounded px-4 py-3 text-primary">
              <span>{sel1.size} × {sel2.size} = {pairs} par{pairs !== 1 ? 'es' : ''}</span>
              <span className="text-outline">→</span>
              <span className="font-bold">{pairs * 2} registros</span>
              <span className="text-outline/60 text-[13px]">(A≠B e B≠A — bidirecional)</span>
            </div>
          )}

          {queueError && (
            <div className="flex items-center gap-2 bg-error-container/30 text-error text-[14.4px] px-4 py-3 rounded border border-error/20">
              ⚠ {queueError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-outline-variant">
            {editingQid && (
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 text-[16.8px] text-on-surface-variant border border-outline-variant rounded hover:border-outline transition-colors"
              >
                Cancelar edição
              </button>
            )}
            <button
              type="button"
              onClick={handleAddOrUpdate}
              disabled={editingQid ? !(sel1.size && sel2.size) : !canAdd}
              className="flex items-center gap-2 px-5 py-2 text-[16.8px] bg-primary text-on-primary rounded hover:shadow-neon disabled:opacity-40 font-semibold transition-shadow"
            >
              {editingQid ? '✓ Atualizar na Fila' : `+ Adicionar${pairs > 0 ? ` ${pairs * 2} registros` : ''} à Fila`}
            </button>
          </div>

          {/* Batch queue */}
          {queue.length > 0 && (
            <div className="border border-outline-variant rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-surface-container-highest border-b border-outline-variant">
                <span className="text-[12px] font-mono text-outline uppercase tracking-wider">
                  Fila de inserção — {queue.length} par{queue.length !== 1 ? 'es' : ''} ({queue.length * 2} registros)
                </span>
                {queueSelected.size > 0 && (
                  <button
                    onClick={deleteSelectedQueue}
                    className="px-3 py-1.5 text-[14.4px] border border-error/40 text-error hover:bg-error-container/20 rounded transition-colors"
                  >
                    Excluir {queueSelected.size} selecionado{queueSelected.size !== 1 ? 's' : ''}
                  </button>
                )}
              </div>

              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-[14.4px] border-collapse">
                  <thead>
                    <tr>
                      <th className="px-2 py-2.5 w-7 sticky top-0 bg-surface-container-highest text-[12px] font-mono text-outline uppercase tracking-[0.1em]">
                        <input type="checkbox" checked={allQueueSelected} onChange={toggleAllQueueSelect} className="accent-primary" />
                      </th>
                      <th className="px-3 py-2.5 text-left text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">#</th>
                      <th className="px-3 py-2.5 text-left text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">Equipamento</th>
                      <th className="px-3 py-2.5 text-left text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">1° Código</th>
                      <th className="px-3 py-2.5 text-left text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">Nome 1°</th>
                      <th className="px-3 py-2.5 text-left text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">2° Código</th>
                      <th className="px-3 py-2.5 text-left text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">Nome 2°</th>
                      <th className="px-3 py-2.5 text-right text-[12px] font-mono text-outline uppercase tracking-[0.1em] whitespace-nowrap sticky top-0 bg-surface-container-highest">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20">
                    {queue.map((item, idx) => (
                      <tr key={item.qid} className={`hover:bg-surface-container-high/50 ${item.qid === editingQid ? 'bg-primary/5' : ''}`}>
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={queueSelected.has(item.qid)} onChange={() => toggleQueueSelect(item.qid)} className="accent-primary" />
                        </td>
                        <td className="px-3 py-2 font-mono text-outline">{idx + 1}</td>
                        <td className="px-3 py-2 text-on-surface">{equipNameById.get(item.legacy_equipment_id) ?? item.legacy_equipment_id}</td>
                        <td className="px-3 py-2 font-mono text-primary">{item.protheus_code}</td>
                        <td className="px-3 py-2 text-on-surface-variant truncate max-w-[12rem]">{accByCode.get(item.protheus_code)?.name ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-primary">{item.remove_list_code}</td>
                        <td className="px-3 py-2 text-on-surface-variant truncate max-w-[12rem]">{accByCode.get(item.remove_list_code)?.name ?? '—'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => handleEditQueueItem(item.qid)} className="text-outline hover:text-primary text-[14.4px] font-medium mr-3 transition-colors">Editar</button>
                          <button onClick={() => handleDeleteQueueItem(item.qid)} className="text-outline hover:text-error text-[14.4px] font-medium transition-colors">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-7 py-5 border-t border-outline-variant shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-[16.8px] border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreateAll}
            disabled={queue.length === 0 || creating}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary rounded text-[16.8px] font-semibold hover:shadow-neon disabled:opacity-40 transition-all"
          >
            {creating ? 'Criando...' : `Criar${queue.length > 0 ? ` ${queue.length * 2} registros` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AccBox ────────────────────────────────────────────────────────────────────

function AccBox({
  title, items, selected, blockedCodes, onToggle, onAll, onNone, empty, noEquip,
}: {
  title: string
  items: Accessory[]
  selected: Set<string>
  blockedCodes: Set<string>
  onToggle: (code: string) => void
  onAll: (visible: Accessory[]) => void
  onNone: () => void
  empty: boolean
  noEquip: boolean
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
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-low overflow-hidden min-h-[28rem]">

      {/* Box title */}
      <div className="px-4 py-2.5 border-b border-outline-variant bg-surface-container-highest flex items-center justify-between">
        <span className="text-[12px] font-semibold text-outline uppercase tracking-[0.1em]">{title}</span>
        <div className="flex items-center gap-2 text-[13px]">
          <button onClick={() => onAll(visible)} className="text-primary hover:underline">todos</button>
          <span className="text-outline/40">|</span>
          <button onClick={onNone} className="text-outline hover:text-primary">nenhum</button>
        </div>
      </div>

      {empty ? (
        <div className="px-4 py-12 text-center text-[14.4px] text-outline italic">Selecione um grupo acima</div>
      ) : noEquip ? (
        <div className="px-4 py-12 text-center text-[14.4px] text-outline italic">Selecione um equipamento acima</div>
      ) : (
        <>
          {/* Column headers + filters */}
          <div className="flex items-stretch border-b border-outline-variant bg-surface-container-high text-[12px] font-semibold text-outline uppercase tracking-[0.1em]">
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
          <div className="overflow-y-auto min-h-[18rem] max-h-72 divide-y divide-outline-variant/20">
            {visible.length === 0 ? (
              <div className="px-4 py-6 text-center text-[14.4px] text-outline italic">Nenhum resultado</div>
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
                    <div className={`w-44 shrink-0 border-r border-outline-variant/10 px-2 py-2 text-[13px] font-mono truncate ${blocked ? 'text-outline line-through' : 'text-primary'}`}>
                      {a.protheus_code}
                    </div>
                    <div className="flex-1 px-2 py-2 text-[13px] text-on-surface-variant truncate">
                      {a.name}
                      {blocked && <span className="ml-1.5 text-[12px] text-outline font-mono">(selecionado no outro lado)</span>}
                    </div>
                  </label>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-outline-variant/40 text-[13px] font-mono text-outline flex items-center gap-2">
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
