'use client'

import { useEffect, useRef, useState } from 'react'
import { classifyEquipmentType, type EquipmentClassificationRule } from '@/lib/equipmentClassification'

const STORAGE_KEY = 'analisador-estruturas-state'
const UNCLASSIFIED_GROUP = 'Não classificado'

interface PropertyResult {
  field: string
  matched: { code: string; value: string }[]
  computedValue: string | null
  dbValue: string | null
  status: 'ok' | 'mismatch' | 'duplicate' | 'missing'
}

interface AnalysisFile {
  id: string
  name: string
  protheusCode: string
  source: 'excel' | 'db'
  status: 'analyzing' | 'done' | 'error'
  errorMessage?: string
  equipmentFound?: boolean
  codesAnalyzed?: number
  properties?: PropertyResult[]
  description?: string | null
  foundInProtheus?: boolean
}

const FIELD_LABELS: Record<string, string> = {
  processor: 'Processador',
  memory: 'Memória',
  storage: 'Armazenamento',
  graphics_card: 'Placa Gráfica',
  conveyor_belt_load_capacity_kg: 'Cap. Correia (kg)',
  tube_power_kv: 'Potência Tubo (kV)',
  certificate: 'Certificado',
  conveyor_belt_type: 'Tipo Correia',
  motopolia_type: 'Tipo Motopolia',
  language: 'Idioma',
  color: 'Cor',
}

// The workbook has "2-Estruturas" (hierarchical BOM explosion) and
// "FLAT-LIST" (deduplicated flat list) — both carry a "CÓDIGO" column with
// the component codes that need to be checked against the parameter rules.
async function extractStructureCodes(file: File): Promise<string[]> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const codes = new Set<string>()

  for (const wanted of ['2-Estruturas', 'FLAT-LIST']) {
    const actualName = wb.SheetNames.find(n => n.trim().toLowerCase() === wanted.toLowerCase())
    if (!actualName) continue
    const ws = wb.Sheets[actualName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (key.trim().toUpperCase() === 'CÓDIGO') {
          const v = String(value ?? '').trim()
          if (v !== '') codes.add(v)
          break
        }
      }
    }
  }
  return Array.from(codes)
}

function Badge({ tone, children }: { tone: 'error' | 'amber' | 'outline' | 'success'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'text-error border-error/30 bg-error-container/20'
    : tone === 'amber'
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : tone === 'success'
    ? 'text-green-400 border-green-500/40 bg-green-500/10'
    : 'text-outline border-outline-variant bg-surface-container'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  )
}

// ─── Protheus DB login popup ────────────────────────────────────────────
// Credentials never touch localStorage/sessionStorage — kept only in React
// state for the current page visit, and sent per-request to the backend,
// which opens a short-lived connection and closes it right away. Leaving
// this page (or refreshing) drops the credentials — reconnect any time.
function DbLoginModal({ onClose, onConnect, connecting, error }: {
  onClose: () => void
  onConnect: (user: string, password: string) => void
  connecting: boolean
  error: string
}) {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">Conectar ao Banco Protheus</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none">✕</button>
        </div>
        <form
          className="p-5 flex flex-col gap-3"
          onSubmit={e => { e.preventDefault(); onConnect(user, password) }}
        >
          <p className="text-sm text-on-surface-variant">
            Informe seu usuário e senha do SQL Server (PROTHEUS12). A conexão é aberta só para esta consulta e
            fechada em seguida — nada fica salvo.
          </p>
          <label className="text-xs font-semibold text-on-surface-variant">
            Usuário
            <input
              type="text"
              autoFocus
              value={user}
              onChange={e => setUser(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </label>
          <label className="text-xs font-semibold text-on-surface-variant">
            Senha
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </label>
          {error && <div className="text-error text-xs">⚠ {error}</div>}
          <div className="flex items-center justify-end gap-2 mt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface">
              Usar apenas upload de Excel
            </button>
            <button
              type="submit"
              disabled={connecting || !user.trim() || !password}
              className="px-4 py-1.5 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
            >
              {connecting ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Reduced code picker — only Grupo de Equipamentos + Cadastro de ────
// Equipamentos, since this tool only ever needs an equipment protheus_code
// to run the recursive BOM query against.
interface EquipmentGroupOption {
  legacyId: number
  name: string
  commercialName: string | null
}
interface EquipmentCodeOption {
  code: string
  label: string
  legacyEquipmentId: number
}

function EquipmentPickerModal({ onClose, onPick, onPickGroup, onPickAll, dbCreds, onAnalyze }: {
  onClose: () => void
  onPick: (code: string) => void
  onPickGroup: (legacyId: number, name: string) => void
  onPickAll: () => void
  dbCreds: { user: string; password: string }
  onAnalyze: (codes: string[]) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [groups, setGroups] = useState<EquipmentGroupOption[]>([])
  const [codes, setCodes] = useState<EquipmentCodeOption[]>([])

  const [reversePrefixInput, setReversePrefixInput] = useState('27.04, 27.03')
  const [reverseLoading, setReverseLoading] = useState(false)
  const [reverseError, setReverseError] = useState('')

  // Finds every structure header matching the prefix(es) directly in the
  // live Protheus DB, then hands the whole list off to be analyzed exactly
  // like any other pick — the resulting cards already show "Equipamento
  // encontrado/não encontrado", so no separate internal/external listing
  // is needed here; this window closes right away and the cards appear in
  // the normal results area below.
  const runReverseSearch = async () => {
    const prefixes = reversePrefixInput.split(',').map(p => p.trim()).filter(Boolean)
    if (prefixes.length === 0) { setReverseError('Informe ao menos um prefixo'); return }
    setReverseLoading(true)
    setReverseError('')
    try {
      const res = await fetch('/api/protheus-estrutura-reversa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: dbCreds.user, password: dbCreds.password, prefixes }),
      })
      const json = await res.json()
      if (!res.ok) { setReverseError(json.error || 'Falha ao consultar o banco Protheus'); return }
      const headers: string[] = json.headers || []
      if (headers.length === 0) { setReverseError('Nenhuma estrutura encontrada com esse(s) prefixo(s)'); return }
      onAnalyze(headers)
      onClose()
    } catch {
      setReverseError('Erro de comunicação com o banco Protheus')
    } finally {
      setReverseLoading(false)
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [eqRes, groupRes] = await Promise.all([
          fetch('/api/standard_equipment_items?limit=25000'),
          fetch('/api/equipments?limit=25000'),
        ])
        if (!eqRes.ok || !groupRes.ok) { setError('Erro ao carregar códigos'); setLoading(false); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [eqJson, groupJson] = await Promise.all([eqRes.json(), groupRes.json()]) as any[]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nameByLegacyId: Record<number, string> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const g of (groupJson.data || [])) nameByLegacyId[g.legacy_id] = g.name
        setGroups(
          (groupJson.data || [])
            .slice()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .sort((a: any, b: any) => (a.legacy_id ?? 0) - (b.legacy_id ?? 0))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((r: any) => ({ legacyId: r.legacy_id, name: r.name || 'N/A', commercialName: r.commercial_name || null }))
        )
        setCodes(
          (eqJson.data || [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((r: any) => r.status === 'active')
            .slice()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .sort((a: any, b: any) => (a.legacy_equipment_id ?? 0) - (b.legacy_equipment_id ?? 0))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((r: any) => ({
              code: r.protheus_code,
              label: nameByLegacyId[r.legacy_equipment_id] || 'N/A',
              legacyEquipmentId: r.legacy_equipment_id,
            }))
        )
      } catch {
        setError('Erro ao carregar códigos')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const f = filter.trim().toLowerCase()
  const filteredGroups = groups.filter(g =>
    !f || String(g.legacyId).includes(f) || g.name.toLowerCase().includes(f) || (g.commercialName?.toLowerCase().includes(f) ?? false)
  )
  const filteredCodes = codes.filter(o =>
    !f || o.code.toLowerCase().includes(f) || o.label.toLowerCase().includes(f)
  )
  const countByGroup = new Map<number, number>()
  for (const c of codes) countByGroup.set(c.legacyEquipmentId, (countByGroup.get(c.legacyEquipmentId) || 0) + 1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-6xl max-h-[85vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant shrink-0">
          <h2 className="text-base font-semibold text-on-surface">Buscar código</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-3 border-b border-outline-variant shrink-0 flex items-center gap-2">
          <input
            type="text"
            autoFocus
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filtrar por código ou nome…"
            className="flex-1 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          <button
            onClick={onPickAll}
            title="Gera e analisa a estrutura de todo equipamento cadastrado em Cadastro de Equipamentos"
            className="shrink-0 px-3 py-2 bg-primary/10 border border-primary/40 text-primary rounded text-xs font-semibold hover:bg-primary/20 transition-colors whitespace-nowrap"
          >
            🗂️ Analisar TODOS ({codes.length})
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-outline gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono">Carregando…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16 text-error text-sm">⚠ {error}</div>
        ) : (
          <div className="flex-1 overflow-auto grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-outline-variant">
            <div className="p-4">
              <div className="text-xs font-bold text-primary uppercase tracking-wide mb-2">
                Grupo de Equipamentos <span className="text-outline font-normal">({filteredGroups.length})</span>
              </div>
              <div className="flex flex-col gap-1">
                {filteredGroups.length === 0 ? (
                  <div className="text-xs text-outline italic">Nenhum grupo encontrado</div>
                ) : filteredGroups.map(g => (
                  <button
                    key={g.legacyId}
                    onClick={() => onPickGroup(g.legacyId, g.name)}
                    className="text-left px-2 py-1.5 rounded hover:bg-surface-container-high transition-colors"
                  >
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface-container-highest text-primary">ID {g.legacyId}</span>
                    <span className="ml-2 text-xs text-on-surface-variant">{g.name}</span>
                    <span className="ml-2 text-xs text-outline font-mono">
                      ({countByGroup.get(g.legacyId) || 0} equipamento{(countByGroup.get(g.legacyId) || 0) === 1 ? '' : 's'})
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs font-bold text-blue-400 uppercase tracking-wide mb-2">
                Cadastro de Equipamentos <span className="text-outline font-normal">({filteredCodes.length} · apenas ativos)</span>
              </div>
              <div className="flex flex-col gap-1">
                {filteredCodes.length === 0 ? (
                  <div className="text-xs text-outline italic">Nenhum código encontrado</div>
                ) : filteredCodes.map(o => (
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
                Busca Reversa (Protheus)
              </div>
              <div className="flex items-center gap-1.5 mb-2">
                <input
                  type="text"
                  value={reversePrefixInput}
                  onChange={e => setReversePrefixInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runReverseSearch()}
                  placeholder="Prefixos, ex: 27.04, 27.03"
                  className="flex-1 min-w-0 bg-surface-container-low border border-outline-variant rounded px-2 py-1.5 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 font-mono"
                />
                <button
                  onClick={runReverseSearch}
                  disabled={reverseLoading}
                  className="shrink-0 px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/40 text-amber-400 rounded text-xs font-semibold hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
                >
                  {reverseLoading ? '…' : 'Buscar'}
                </button>
              </div>
              <p className="text-[11px] text-outline mb-2">
                Ao clicar em Buscar, esta janela fecha e toda estrutura do Protheus com esse prefixo é
                analisada automaticamente — os resultados aparecem na lista abaixo, mostrando também
                quais já estão cadastradas em Cadastro de Equipamentos.
              </p>
              {reverseError && <div className="text-error text-xs mb-2">⚠ {reverseError}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AnalisadorEstruturasPage() {
  const [files, setFiles] = useState<AnalysisFile[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hydrated = useRef(false)

  const [dbCreds, setDbCreds] = useState<{ user: string; password: string } | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [groupCodes, setGroupCodes] = useState<EquipmentCodeOption[]>([])
  const [classificationRules, setClassificationRules] = useState<EquipmentClassificationRule[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // "Chave" filter: false = mostra tudo (comportamento atual); true = só o que está
  // no Protheus e ainda não está cadastrado no banco interno.
  const [showOnlyMissingFromInternal, setShowOnlyMissingFromInternal] = useState(false)

  // Restore previously analyzed files when returning to this page.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { files: AnalysisFile[]; expandedId: string | null }
        setFiles(parsed.files || [])
        setExpandedId(parsed.expandedId ?? null)
      }
    } catch {
      // ignore corrupt storage
    }
    hydrated.current = true
  }, [])

  // Persist on every change, so navigating away and back keeps the results.
  useEffect(() => {
    if (!hydrated.current) return
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ files, expandedId }))
  }, [files, expandedId])

  // Load the equipment-group membership once, so picking a group can run
  // the DB search for every equipment code inside it. Only active items —
  // deactivated equipment shouldn't be re-analyzed.
  useEffect(() => {
    fetch('/api/standard_equipment_items?limit=25000')
      .then(r => r.json())
      .then(json => setGroupCodes(
        (json.data || [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((r: any) => r.status === 'active')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => ({
            code: r.protheus_code,
            label: r.protheus_code,
            legacyEquipmentId: r.legacy_equipment_id,
          }))
      ))
      .catch(() => {})
  }, [])

  // Loads the (user-editable, in Parâmetros de Estrutura) rules used to
  // derive an equipment type from DESC_ESTRUTURA, for grouping the results.
  useEffect(() => {
    fetch('/api/equipment-classification-rules')
      .then(r => r.json())
      .then(rules => setClassificationRules(Array.isArray(rules) ? rules : []))
      .catch(() => {})
  }, [])

  const toggleGroupExpanded = (groupName: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    for (const file of Array.from(fileList)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const protheusCode = file.name.replace(/\.xlsx?$/i, '').trim()
      setFiles(prev => [...prev, { id, name: file.name, protheusCode, source: 'excel', status: 'analyzing' }])
      setExpandedId(prevId => prevId ?? id)

      try {
        const codes = await extractStructureCodes(file)
        const res = await fetch('/api/analisador-estruturas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ protheusCode, codes }),
        })
        const json = await res.json()
        if (!res.ok) {
          setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorMessage: json.error || 'Falha ao analisar' } : f))
          continue
        }
        setFiles(prev => prev.map(f => f.id === id ? {
          ...f,
          status: 'done',
          equipmentFound: json.equipmentFound,
          codesAnalyzed: json.codesAnalyzed,
          properties: json.properties,
        } : f))
      } catch {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorMessage: 'Não foi possível ler este arquivo (.xlsx inválido)' } : f))
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const runDbStructureAnalysis = async (protheusCode: string, creds: { user: string; password: string }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setFiles(prev => [...prev, { id, name: `Banco · ${protheusCode}`, protheusCode, source: 'db', status: 'analyzing' }])
    setExpandedId(prevId => prevId ?? id)

    try {
      const codesRes = await fetch('/api/protheus-estrutura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: creds.user, password: creds.password, protheusCode }),
      })
      const codesJson = await codesRes.json()
      if (!codesRes.ok) {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorMessage: codesJson.error || 'Falha ao consultar o banco Protheus' } : f))
        return
      }
      setFiles(prev => prev.map(f => f.id === id ? {
        ...f,
        description: codesJson.description ?? null,
        foundInProtheus: !!codesJson.foundInProtheus,
      } : f))

      const res = await fetch('/api/analisador-estruturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protheusCode, codes: codesJson.codes }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorMessage: json.error || 'Falha ao analisar' } : f))
        return
      }
      setFiles(prev => prev.map(f => f.id === id ? {
        ...f,
        status: 'done',
        equipmentFound: json.equipmentFound,
        codesAnalyzed: json.codesAnalyzed,
        properties: json.properties,
      } : f))
    } catch {
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorMessage: 'Erro de comunicação com o banco Protheus' } : f))
    }
  }

  const handleConnect = (user: string, password: string) => {
    setConnecting(true)
    setLoginError('')
    // The connection itself is only opened/validated on the first real
    // query — nothing to test upfront without a protheus_code.
    setDbCreds({ user, password })
    setConnecting(false)
    setShowLoginModal(false)
  }

  const handlePickCode = (code: string) => {
    setPickerOpen(false)
    if (dbCreds) runDbStructureAnalysis(code, dbCreds)
  }

  const handlePickGroup = (legacyId: number) => {
    setPickerOpen(false)
    if (!dbCreds) return
    const codesInGroup = groupCodes.filter(c => c.legacyEquipmentId === legacyId)
    ;(async () => {
      for (const c of codesInGroup) {
        await runDbStructureAnalysis(c.code, dbCreds)
      }
    })()
  }

  const handlePickAll = () => {
    setPickerOpen(false)
    if (!dbCreds) return
    ;(async () => {
      for (const c of groupCodes) {
        await runDbStructureAnalysis(c.code, dbCreds)
      }
    })()
  }

  const handleAnalyzeCodes = (codes: string[]) => {
    if (!dbCreds) return
    ;(async () => {
      for (const code of codes) {
        await runDbStructureAnalysis(code, dbCreds)
      }
    })()
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    setExpandedId(prev => (prev === id ? null : prev))
  }

  // "Chave" filter — applied before grouping, on top of the exact same
  // layout/grouping logic below, so toggling it never changes anything else.
  const displayedFiles = showOnlyMissingFromInternal
    ? files.filter(f => f.status === 'done' && f.equipmentFound === false)
    : files

  // Groups analyzed equipment by the type derived from DESC_ESTRUTURA (see
  // src/lib/equipmentClassification.ts) — anything without a description or
  // without a matching rule falls into "Não classificado".
  const groupedFiles = new Map<string, AnalysisFile[]>()
  for (const file of displayedFiles) {
    const groupName = classifyEquipmentType(file.description, classificationRules) || UNCLASSIFIED_GROUP
    const bucket = groupedFiles.get(groupName)
    if (bucket) bucket.push(file)
    else groupedFiles.set(groupName, [file])
  }
  const groupedFileEntries = Array.from(groupedFiles.entries()).sort(([a], [b]) => {
    if (a === UNCLASSIFIED_GROUP) return 1
    if (b === UNCLASSIFIED_GROUP) return -1
    return a.localeCompare(b, 'pt-BR')
  })

  return (
    <div className="p-8 max-w-[108rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · busc. itens série estrut.
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Busc. Itens Série Estrut.</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Busque a estrutura direto no banco Protheus (recomendado) ou envie um ou mais arquivos .xlsx de estrutura
          (planilhas &quot;2-Estruturas&quot; e &quot;FLAT-LIST&quot; — nome do arquivo = código Protheus). Cada código da
          estrutura é comparado com as regras cadastradas em{' '}
          <a href="/parametros-estrutura" className="text-primary hover:underline">Parâmetros de Estrutura</a>
          — todas as propriedades cadastradas são analisadas, não só as que tiveram código encontrado: se dois
          códigos do mesmo grupo indicarem valores diferentes, gera alerta de duplicidade; se o valor não bater
          com o cadastro do equipamento em Cadastro de Equipamentos, gera alerta de erro; se nenhum código do
          grupo aparecer na estrutura, a propriedade é sinalizada como não encontrada.
        </p>
      </div>

      {/* Live DB search */}
      <div className="mb-1 flex items-center gap-3 flex-wrap">
        {dbCreds ? (
          <>
            <button
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:shadow-neon transition-all"
            >
              🔍 Buscar equipamento no banco Protheus
            </button>
            <Badge tone="success">Conectado ao Protheus</Badge>
            <button
              onClick={() => { setDbCreds(null); setShowLoginModal(true) }}
              className="text-xs text-outline hover:text-error"
            >
              desconectar
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowLoginModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary cursor-pointer transition-colors text-sm font-semibold"
          >
            🔌 Conectar ao Banco Protheus
          </button>
        )}
      </div>
      {dbCreds && (
        <p className="text-xs text-outline mb-5">
          A primeira busca carrega a tabela ESTRUTURAS inteira para a memória (pode levar até 1–2 min); as buscas
          seguintes usam esse cache e ficam quase instantâneas.
        </p>
      )}

      {/* Manual Excel upload — kept as a fallback */}
      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          onChange={e => handleFilesSelected(e.target.files)}
          className="hidden"
          id="structure-analyzer-file-input"
        />
        <label
          htmlFor="structure-analyzer-file-input"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary cursor-pointer transition-colors text-sm font-semibold"
        >
          ⇪ Selecionar arquivo(s) .xlsx
        </label>
      </div>

      {showLoginModal && (
        <DbLoginModal
          onClose={() => setShowLoginModal(false)}
          onConnect={handleConnect}
          connecting={connecting}
          error={loginError}
        />
      )}
      {pickerOpen && dbCreds && (
        <EquipmentPickerModal
          onClose={() => setPickerOpen(false)}
          onPick={handlePickCode}
          onPickGroup={handlePickGroup}
          onPickAll={handlePickAll}
          dbCreds={dbCreds}
          onAnalyze={handleAnalyzeCodes}
        />
      )}

      {files.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-on-surface-variant">Mostrar:</span>
          <button
            onClick={() => setShowOnlyMissingFromInternal(v => !v)}
            role="switch"
            aria-checked={showOnlyMissingFromInternal}
            title="Alterna entre ver tudo ou só o que está no Protheus e ainda falta no banco interno"
            className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors shrink-0 ${
              showOnlyMissingFromInternal ? 'bg-primary' : 'bg-surface-container-highest border border-outline-variant'
            }`}
          >
            <span
              className={`inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform ${
                showOnlyMissingFromInternal ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className={`text-sm font-semibold ${showOnlyMissingFromInternal ? 'text-outline' : 'text-primary'}`}>
            Consulta completa
          </span>
          <span className="text-outline">/</span>
          <span className={`text-sm font-semibold ${showOnlyMissingFromInternal ? 'text-primary' : 'text-outline'}`}>
            Só o que falta no meu banco
          </span>
        </div>
      )}

      {files.length === 0 ? (
        <div className="text-sm text-outline italic">Nenhum equipamento analisado ainda.</div>
      ) : displayedFiles.length === 0 ? (
        <div className="text-sm text-outline italic">
          Nenhum equipamento no Protheus está faltando no seu banco interno, entre os já analisados.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groupedFileEntries.map(([groupName, groupFiles]) => {
            const groupOpen = expandedGroups.has(groupName)
            return (
            <div key={groupName}>
              <div
                onClick={() => toggleGroupExpanded(groupName)}
                className="flex items-center gap-3 px-4 py-3 mb-2 rounded-xl border border-outline-variant bg-surface-container-high hover:bg-surface-container-highest cursor-pointer select-none transition-colors"
              >
                <span className={`text-outline text-sm leading-none transition-transform ${groupOpen ? 'rotate-90' : ''}`}>›</span>
                <span className="text-xs font-bold text-primary uppercase tracking-wide">
                  {groupName} <span className="text-outline font-normal">({groupFiles.length})</span>
                </span>
              </div>
              {groupOpen && (
              <div className="flex flex-col gap-3">
                {groupFiles.map(file => {
            const isOpen = expandedId === file.id
            const props = file.properties || []
            const errorCount = props.filter(p => p.status === 'mismatch').length
            const duplicateCount = props.filter(p => p.status === 'duplicate').length
            const missingCount = props.filter(p => p.status === 'missing').length
            const isDbDone = file.source === 'db' && file.status === 'done'
            const cardTone = isDbDone && file.foundInProtheus && file.equipmentFound
              ? 'border-green-500/30 bg-green-500/5'
              : isDbDone && file.foundInProtheus && !file.equipmentFound
              ? 'border-amber-500/30 bg-amber-500/5'
              : isDbDone && !file.foundInProtheus && file.equipmentFound
              ? 'border-error/30 bg-error-container/10'
              : 'border-outline-variant bg-surface-container'
            return (
              <div key={file.id} className={`rounded-xl border overflow-hidden ${cardTone}`}>
                <div
                  className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer hover:bg-surface-container-high transition-colors"
                  onClick={() => setExpandedId(isOpen ? null : file.id)}
                >
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <Badge tone="outline">Cód. {file.protheusCode}</Badge>
                    {file.description && <span className="text-sm text-on-surface-variant">{file.description}</span>}
                    {file.status === 'analyzing' && <Badge tone="outline">Analisando…</Badge>}
                    {file.status === 'error' && <Badge tone="error">{file.errorMessage}</Badge>}
                    {file.status === 'done' && (
                      <>
                        {file.equipmentFound
                          ? <Badge tone="success">Equipamento encontrado</Badge>
                          : <Badge tone="error">Equipamento não encontrado</Badge>}
                        {file.source === 'db' && (
                          file.foundInProtheus
                            ? <Badge tone="success">Encontrado no Protheus</Badge>
                            : <Badge tone="error">Não encontrado no Protheus</Badge>
                        )}
                        {errorCount > 0 && <Badge tone="error">{errorCount} erro(s)</Badge>}
                        {duplicateCount > 0 && <Badge tone="amber">{duplicateCount} duplicidade(s)</Badge>}
                        {missingCount > 0 && <Badge tone="amber">{missingCount} propriedade(s) sem código</Badge>}
                        {errorCount === 0 && duplicateCount === 0 && missingCount === 0 && <Badge tone="success">Tudo OK</Badge>}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); removeFile(file.id) }}
                      className="text-outline hover:text-error text-sm px-1"
                      title="Remover da lista"
                    >
                      ✕
                    </button>
                    <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  </div>
                </div>

                {isOpen && file.status === 'done' && (
                  <div className="border-t border-outline-variant p-5">
                    {props.length === 0 ? (
                      <div className="text-sm text-outline italic">Nenhum parâmetro cadastrado em Parâmetros de Estrutura ainda.</div>
                    ) : (
                      <div className="overflow-auto border border-outline-variant rounded-lg">
                        <table className="text-xs w-full">
                          <thead className="bg-surface-container-highest">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Propriedade</th>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Valor Esperado (Estrutura)</th>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Código(s) que Geraram</th>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Valor no Banco</th>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {props.map((p: PropertyResult) => (
                              <tr key={p.field} className={`border-t border-outline-variant/50 ${
                                p.status === 'mismatch' ? 'bg-error-container/10' : (p.status === 'duplicate' || p.status === 'missing') ? 'bg-amber-500/5' : ''
                              }`}>
                                <td className="px-3 py-2 font-semibold text-on-surface whitespace-nowrap">
                                  {FIELD_LABELS[p.field] || p.field}
                                </td>
                                <td className="px-3 py-2 text-on-surface">
                                  {p.status === 'duplicate'
                                    ? <span className="text-amber-400 italic">valores conflitantes</span>
                                    : p.status === 'missing'
                                    ? <span className="text-amber-400 italic">nenhum código encontrado</span>
                                    : (p.computedValue ?? '—')}
                                </td>
                                <td className="px-3 py-2 text-outline font-mono">
                                  {p.matched.length > 0 ? p.matched.map(m => `${m.code} → ${m.value}`).join(' · ') : '—'}
                                </td>
                                <td className="px-3 py-2 text-on-surface">{p.dbValue ?? '—'}</td>
                                <td className="px-3 py-2">
                                  {p.status === 'ok' && <Badge tone="success">OK</Badge>}
                                  {p.status === 'mismatch' && <Badge tone="error">Erro — diverge do banco</Badge>}
                                  {p.status === 'duplicate' && <Badge tone="amber">Duplicidade</Badge>}
                                  {p.status === 'missing' && <Badge tone="amber">Não encontrado na estrutura</Badge>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
                })}
              </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
