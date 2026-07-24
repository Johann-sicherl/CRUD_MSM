'use client'

import { useEffect, useMemo, useState } from 'react'

interface EquipmentOption {
  legacyId: number
  name: string
}

interface RelAccessoryRow {
  protheus_code: string
  description: string
  legacy_general_alert_id: string
  operation_time: string
  status: string
  maximum_quantity: string
}

interface DependantRow {
  protheus_code: string
  protheus_item_code: string
  quantity: string
  cost_std: string
  proportional_factor: string
}

interface NonCombinableRow {
  protheus_code: string
  remove_list_code: string
  status: string
}

interface RollerTableRow {
  protheus_code: string
  type: string
}

interface CloneResult {
  [table: string]: { created: number; skipped: number; invalid: string[] }
}

const TABLE_LABELS: Record<string, string> = {
  relationship_equip_accessory: 'Equipamento x Acessórios',
  dependant_items: 'Produtos Dependentes',
  non_combinable_comps: 'Produtos Não Combináveis',
  roller_tables: 'Tipo Mesas de Roletes',
}

function Badge({ tone, children }: { tone: 'success' | 'outline' | 'amber' | 'error'; children: React.ReactNode }) {
  const cls = tone === 'success'
    ? 'text-green-400 border-green-500/40 bg-green-500/10'
    : tone === 'amber'
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : tone === 'error'
    ? 'text-error border-error/30 bg-error-container/20'
    : 'text-outline border-outline-variant bg-surface-container'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>
      {children}
    </span>
  )
}

const inputClass = "w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
const selectClass = inputClass

export default function ClonagemEstruturalAvancadaPage() {
  const [equipments, setEquipments] = useState<EquipmentOption[]>([])
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [step, setStep] = useState<'select' | 'review'>('select')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cloning, setCloning] = useState(false)
  const [result, setResult] = useState<CloneResult | null>(null)

  const [accessoryNames, setAccessoryNames] = useState<Record<string, string>>({})
  const [alertDescriptions, setAlertDescriptions] = useState<Record<string, string>>({})

  const [relRows, setRelRows] = useState<RelAccessoryRow[]>([])
  const [depRows, setDepRows] = useState<DependantRow[]>([])
  const [nccRows, setNccRows] = useState<NonCombinableRow[]>([])
  const [rtRows, setRtRows] = useState<RollerTableRow[]>([])

  useEffect(() => {
    fetch('/api/equipments?limit=25000')
      .then(res => res.json())
      .then(json => {
        const opts = (json.data || [])
          .map((e: Record<string, unknown>) => ({ legacyId: Number(e.legacy_id), name: String(e.name ?? '') }))
          .sort((a: EquipmentOption, b: EquipmentOption) => a.name.localeCompare(b.name, 'pt-BR'))
        setEquipments(opts)
      })
      .catch(() => {})
  }, [])

  const targetOptions = useMemo(
    () => equipments.filter(e => String(e.legacyId) !== sourceId),
    [equipments, sourceId],
  )

  const sourceName = equipments.find(e => String(e.legacyId) === sourceId)?.name ?? ''
  const targetName = equipments.find(e => String(e.legacyId) === targetId)?.name ?? ''

  const handleAvancar = async () => {
    if (!sourceId || !targetId) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const [relRes, depRes, nccRes, rtRes, accRes, alertRes] = await Promise.all([
        fetch('/api/relationship_equip_accessory?limit=25000'),
        fetch('/api/dependant_items?limit=25000'),
        fetch('/api/non_combinable_comps?limit=25000'),
        fetch('/api/roller_tables?limit=25000'),
        fetch('/api/accessories?limit=25000'),
        fetch('/api/general_alerts?limit=25000'),
      ])
      const [relJson, depJson, nccJson, rtJson, accJson, alertJson] = await Promise.all([
        relRes.json(), depRes.json(), nccRes.json(), rtRes.json(), accRes.json(), alertRes.json(),
      ])

      const matchesSource = (row: Record<string, unknown>) => String(row.legacy_equipment_id) === sourceId
      // Only clone active rules — dependant_items and roller_tables have no
      // status column at all, so they're unaffected and still bring everything.
      const matchesSourceActive = (row: Record<string, unknown>) => matchesSource(row) && String(row.status) === 'active'

      setRelRows((relJson.data || []).filter(matchesSourceActive).map((r: Record<string, unknown>) => ({
        protheus_code: String(r.protheus_code ?? ''),
        description: r.description == null ? '' : String(r.description),
        legacy_general_alert_id: r.legacy_general_alert_id == null ? '0' : String(r.legacy_general_alert_id),
        operation_time: r.operation_time == null ? '' : String(r.operation_time),
        status: String(r.status ?? 'active'),
        maximum_quantity: r.maximum_quantity == null ? '' : String(r.maximum_quantity),
      })))

      setDepRows((depJson.data || []).filter(matchesSource).map((r: Record<string, unknown>) => ({
        protheus_code: String(r.protheus_code ?? ''),
        protheus_item_code: String(r.protheus_item_code ?? ''),
        quantity: String(r.quantity ?? 1),
        cost_std: String(r.cost_std ?? 0),
        proportional_factor: r.proportional_factor == null ? '' : String(r.proportional_factor),
      })))

      setNccRows((nccJson.data || []).filter(matchesSourceActive).map((r: Record<string, unknown>) => ({
        protheus_code: String(r.protheus_code ?? ''),
        remove_list_code: String(r.remove_list_code ?? ''),
        status: String(r.status ?? 'active'),
      })))

      setRtRows((rtJson.data || []).filter(matchesSource).map((r: Record<string, unknown>) => ({
        protheus_code: String(r.protheus_code ?? ''),
        type: String(r.type ?? 'unique'),
      })))

      const accNames: Record<string, string> = {}
      for (const a of (accJson.data || [])) accNames[String(a.protheus_code ?? '').trim().toUpperCase()] = String(a.name ?? '')
      setAccessoryNames(accNames)

      const alertDescs: Record<string, string> = {}
      for (const a of (alertJson.data || [])) alertDescs[String(a.legacy_id)] = String(a.description ?? '')
      setAlertDescriptions(alertDescs)

      setStep('review')
    } catch {
      setError('Falha ao carregar os dados do equipamento de origem')
    } finally {
      setLoading(false)
    }
  }

  const accName = (code: string) => accessoryNames[code.trim().toUpperCase()] || '—'

  const handleClonar = async () => {
    setCloning(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/clone-architecture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceEquipmentId: Number(sourceId),
          targetEquipmentId: Number(targetId),
          items: {
            relationship_equip_accessory: relRows,
            dependant_items: depRows,
            non_combinable_comps: nccRows,
            roller_tables: rtRows,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Falha ao clonar')
        if (json.partial) setResult(json.partial)
        return
      }
      setResult(json.result)
    } catch {
      setError('Erro de comunicação ao clonar')
    } finally {
      setCloning(false)
    }
  }

  const totalItems = relRows.length + depRows.length + nccRows.length + rtRows.length

  return (
    <div className="p-8 max-w-[100rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">Sistema · clonagem estrut. avançada</div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Clonagem Estrut. Avançada</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Copia, de um equipamento de origem para outro de destino, todas as regras cadastradas em Equipamento x
          Acessórios, Produtos Dependentes, Produtos Não Combináveis e Tipo Mesas de Roletes. Antes de efetivar,
          você revisa, edita ou remove qualquer linha — nada é gravado até clicar em &quot;Clonar&quot;. Um item que já
          exista, idêntico, no equipamento de destino é automaticamente ignorado (não duplica). Em Equipamento x
          Acessórios e Produtos Não Combináveis, só são trazidas regras com status = active (Produtos Dependentes e
          Tipo Mesas de Roletes não têm coluna de status, então trazem tudo).
        </p>
      </div>

      {step === 'select' && (
        <div className="max-w-xl bg-surface-container border border-outline-variant rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">Equipamento de origem</label>
            <select
              value={sourceId}
              onChange={e => { setSourceId(e.target.value); if (e.target.value === targetId) setTargetId('') }}
              className={selectClass}
            >
              <option value="">— Selecione —</option>
              {equipments.map(eq => <option key={eq.legacyId} value={eq.legacyId}>{eq.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">Equipamento de destino</label>
            <select value={targetId} onChange={e => setTargetId(e.target.value)} className={selectClass} disabled={!sourceId}>
              <option value="">— Selecione —</option>
              {targetOptions.map(eq => <option key={eq.legacyId} value={eq.legacyId}>{eq.name}</option>)}
            </select>
          </div>
          {error && <div className="text-sm text-error">{error}</div>}
          <button
            onClick={handleAvancar}
            disabled={!sourceId || !targetId || loading}
            className="px-5 py-2 text-sm font-semibold bg-primary text-on-primary rounded hover:shadow-neon disabled:opacity-50 transition-shadow"
          >
            {loading ? 'Carregando…' : 'Avançar →'}
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge tone="outline">Origem: {sourceName}</Badge>
            <span className="text-outline">→</span>
            <Badge tone="outline">Destino: {targetName}</Badge>
            <span className="text-xs text-outline">({totalItems} item(ns) no total)</span>
            <button
              onClick={() => { setStep('select'); setResult(null); setError('') }}
              className="ml-auto text-xs text-outline hover:text-primary"
            >
              ← voltar / trocar equipamentos
            </button>
          </div>

          <ReviewSection title={TABLE_LABELS.relationship_equip_accessory} count={relRows.length}>
            {relRows.length === 0 ? <EmptyNote /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-outline uppercase tracking-wide">
                    <th className="px-2 py-1.5">Código</th>
                    <th className="px-2 py-1.5">Nome</th>
                    <th className="px-2 py-1.5">Descrição</th>
                    <th className="px-2 py-1.5 w-28">Alerta</th>
                    <th className="px-2 py-1.5 w-32">Tempo Oper.</th>
                    <th className="px-2 py-1.5 w-28">Status</th>
                    <th className="px-2 py-1.5 w-28">Qtd. Máx.</th>
                    <th className="px-2 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {relRows.map((row, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5 font-mono">{row.protheus_code}</td>
                      <td className="px-2 py-1.5 text-on-surface-variant">{accName(row.protheus_code)}</td>
                      <td className="px-2 py-1.5">
                        <input value={row.description} onChange={e => setRelRows(rs => rs.map((r, j) => j === i ? { ...r, description: e.target.value } : r))} className={inputClass} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number" value={row.legacy_general_alert_id}
                          onChange={e => setRelRows(rs => rs.map((r, j) => j === i ? { ...r, legacy_general_alert_id: e.target.value } : r))}
                          title={alertDescriptions[row.legacy_general_alert_id] || ''}
                          className={inputClass}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={row.operation_time} onChange={e => setRelRows(rs => rs.map((r, j) => j === i ? { ...r, operation_time: e.target.value } : r))} className={inputClass} />
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={row.status} onChange={e => setRelRows(rs => rs.map((r, j) => j === i ? { ...r, status: e.target.value } : r))} className={selectClass}>
                          <option value="active">active</option>
                          <option value="deactive">deactive</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={row.maximum_quantity} onChange={e => setRelRows(rs => rs.map((r, j) => j === i ? { ...r, maximum_quantity: e.target.value } : r))} className={inputClass} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <RemoveButton onClick={() => setRelRows(rs => rs.filter((_, j) => j !== i))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ReviewSection>

          <ReviewSection title={TABLE_LABELS.dependant_items} count={depRows.length}>
            {depRows.length === 0 ? <EmptyNote /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-outline uppercase tracking-wide">
                    <th className="px-2 py-1.5">Cód. Item</th>
                    <th className="px-2 py-1.5">Nome Item</th>
                    <th className="px-2 py-1.5">Cód. Dependente</th>
                    <th className="px-2 py-1.5">Nome Dependente</th>
                    <th className="px-2 py-1.5 w-24">Qtd.</th>
                    <th className="px-2 py-1.5 w-28">Custo</th>
                    <th className="px-2 py-1.5 w-28">Fat. Prop.</th>
                    <th className="px-2 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {depRows.map((row, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        <input value={row.protheus_code} onChange={e => setDepRows(rs => rs.map((r, j) => j === i ? { ...r, protheus_code: e.target.value } : r))} className={`${inputClass} font-mono`} />
                      </td>
                      <td className="px-2 py-1.5 text-on-surface-variant">{accName(row.protheus_code)}</td>
                      <td className="px-2 py-1.5">
                        <input value={row.protheus_item_code} onChange={e => setDepRows(rs => rs.map((r, j) => j === i ? { ...r, protheus_item_code: e.target.value } : r))} className={`${inputClass} font-mono`} />
                      </td>
                      <td className="px-2 py-1.5 text-on-surface-variant">{accName(row.protheus_item_code)}</td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={row.quantity} onChange={e => setDepRows(rs => rs.map((r, j) => j === i ? { ...r, quantity: e.target.value } : r))} className={inputClass} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" step="0.01" value={row.cost_std} onChange={e => setDepRows(rs => rs.map((r, j) => j === i ? { ...r, cost_std: e.target.value } : r))} className={inputClass} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" step="0.0001" value={row.proportional_factor} onChange={e => setDepRows(rs => rs.map((r, j) => j === i ? { ...r, proportional_factor: e.target.value } : r))} className={inputClass} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <RemoveButton onClick={() => setDepRows(rs => rs.filter((_, j) => j !== i))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ReviewSection>

          <ReviewSection title={TABLE_LABELS.non_combinable_comps} count={nccRows.length}>
            {nccRows.length === 0 ? <EmptyNote /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-outline uppercase tracking-wide">
                    <th className="px-2 py-1.5">1° Código</th>
                    <th className="px-2 py-1.5">Nome</th>
                    <th className="px-2 py-1.5">2° Código</th>
                    <th className="px-2 py-1.5">Nome</th>
                    <th className="px-2 py-1.5 w-28">Status</th>
                    <th className="px-2 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {nccRows.map((row, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        <input value={row.protheus_code} onChange={e => setNccRows(rs => rs.map((r, j) => j === i ? { ...r, protheus_code: e.target.value } : r))} className={`${inputClass} font-mono`} />
                      </td>
                      <td className="px-2 py-1.5 text-on-surface-variant">{accName(row.protheus_code)}</td>
                      <td className="px-2 py-1.5">
                        <input value={row.remove_list_code} onChange={e => setNccRows(rs => rs.map((r, j) => j === i ? { ...r, remove_list_code: e.target.value } : r))} className={`${inputClass} font-mono`} />
                      </td>
                      <td className="px-2 py-1.5 text-on-surface-variant">{accName(row.remove_list_code)}</td>
                      <td className="px-2 py-1.5">
                        <select value={row.status} onChange={e => setNccRows(rs => rs.map((r, j) => j === i ? { ...r, status: e.target.value } : r))} className={selectClass}>
                          <option value="active">active</option>
                          <option value="deactive">deactive</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <RemoveButton onClick={() => setNccRows(rs => rs.filter((_, j) => j !== i))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ReviewSection>

          <ReviewSection title={TABLE_LABELS.roller_tables} count={rtRows.length}>
            {rtRows.length === 0 ? <EmptyNote /> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-outline uppercase tracking-wide">
                    <th className="px-2 py-1.5">Código</th>
                    <th className="px-2 py-1.5">Nome</th>
                    <th className="px-2 py-1.5 w-40">Tipo da Peça</th>
                    <th className="px-2 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {rtRows.map((row, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        <input value={row.protheus_code} onChange={e => setRtRows(rs => rs.map((r, j) => j === i ? { ...r, protheus_code: e.target.value } : r))} className={`${inputClass} font-mono`} />
                      </td>
                      <td className="px-2 py-1.5 text-on-surface-variant">{accName(row.protheus_code)}</td>
                      <td className="px-2 py-1.5">
                        <select value={row.type} onChange={e => setRtRows(rs => rs.map((r, j) => j === i ? { ...r, type: e.target.value } : r))} className={selectClass}>
                          <option value="start">start</option>
                          <option value="middle">middle</option>
                          <option value="end">end</option>
                          <option value="unique">unique</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <RemoveButton onClick={() => setRtRows(rs => rs.filter((_, j) => j !== i))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ReviewSection>

          {error && (
            <div className="flex items-center gap-2 bg-error-container/30 text-error text-sm px-4 py-3 rounded border border-error/20">
              ⚠ {error}
            </div>
          )}

          {result && (
            <div className="bg-surface-container border border-outline-variant rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-on-surface mb-1">Resultado da clonagem</div>
              {Object.entries(result).map(([table, r]) => (
                <div key={table} className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-on-surface-variant w-56 shrink-0">{TABLE_LABELS[table] ?? table}:</span>
                  <Badge tone="success">{r.created} criado(s)</Badge>
                  {r.skipped > 0 && <Badge tone="amber">{r.skipped} já existia(m) — ignorado(s)</Badge>}
                  {r.invalid.length > 0 && <Badge tone="error">{r.invalid.length} código(s) inválido(s): {r.invalid.join(', ')}</Badge>}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleClonar}
              disabled={cloning || totalItems === 0}
              className="px-5 py-2 text-sm font-semibold bg-primary text-on-primary rounded hover:shadow-neon disabled:opacity-50 transition-shadow"
            >
              {cloning ? 'Clonando…' : `✓ Clonar (${totalItems} item(ns))`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ReviewSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container border border-outline-variant rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-surface-container-high border-b border-outline-variant flex items-center gap-2">
        <span className="text-xs font-bold text-primary uppercase tracking-wide">{title}</span>
        <span className="text-xs text-outline">({count})</span>
      </div>
      <div className="overflow-x-auto p-2">
        {children}
      </div>
    </div>
  )
}

function EmptyNote() {
  return <div className="px-2 py-3 text-sm text-outline">Nenhum item encontrado para este equipamento nesta tabela.</div>
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Remover — este item não será clonado"
      className="text-outline hover:text-error text-sm px-1"
    >
      ✕
    </button>
  )
}
