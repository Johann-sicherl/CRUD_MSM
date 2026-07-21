'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { classifyEquipmentType, type EquipmentClassificationRule } from '@/lib/equipmentClassification'
import { idbGet, idbSet } from '@/lib/idbStore'
import ColumnFilter from '@/components/ColumnFilter'

const STORAGE_KEY = 'busca-avancada-acessorios-state'
const UNCLASSIFIED_GROUP = 'Não classificado'
const DEFAULT_HEADER_PREFIXES = '26'
const DEFAULT_NIVEL2_PREFIXES = '27.13'

interface AccessoryHierarchyRow {
  nivel: 2 | 3
  codigo: string
  denominacao: string
  qtd: number
  codPaiDireto: string
}

interface AccessoryHierarchyGroup {
  estrutura: string
  descEstrutura: string
  rows: AccessoryHierarchyRow[]
}

// Faithful port of the legacy VBA macros (ACESSORIOS/EQUIPS/SUBPAS/
// EMBALAGENS/ADESIVOS/SPAREPARTS) — each checks the CÓDIGO (not the
// denominação) for a substring, in this same order; whatever doesn't match
// any of them is what the ACESSORIOS() macro keeps (the residual/default
// category). UPS is a separate overlay flag from the UPS() macro (código
// contains "BAT" or denominação contains "NOBRE"), independent of category.
type AccessoryCategory = 'SUBPA' | 'EQUIPAMENTO' | 'GASTOS GERAIS' | 'EMBALAGENS' | 'ADESIVOS' | 'SPARE PARTS' | 'CABOS' | 'ACESSÓRIO'

function classifyAccessoryRow(codigo: string, denominacao: string): { categoria: AccessoryCategory; isUps: boolean } {
  const cod = codigo.toUpperCase()
  const denom = denominacao.toUpperCase()
  let categoria: AccessoryCategory = 'ACESSÓRIO'
  if (cod.includes('27.13')) categoria = 'SUBPA'
  else if (cod.includes('27.04') || cod.includes('27.03')) categoria = 'EQUIPAMENTO'
  else if (cod.includes('G000')) categoria = 'GASTOS GERAIS'
  else if (cod.includes('27.11')) categoria = 'EMBALAGENS'
  else if (cod.includes('22.05')) categoria = 'ADESIVOS'
  else if (cod.includes('27.12')) categoria = 'SPARE PARTS'
  else if (cod.includes('20.11')) categoria = 'CABOS'
  const isUps = cod.includes('BAT') || denom.includes('NOBRE')
  return { categoria, isUps }
}

// Same "+"-separated AND-terms search used in Busc. Itens Série Estrut.'s
// Filtro avançado, duplicated here (rather than imported) to keep this page
// fully isolated from that one — searches whichever description text is
// shown for the item (DESC_ESTRUTURA/DESCRICAO_PRODUTO, depending on what's
// in use), e.g. "100100+SV" requires both "100100" and "SV" anywhere in it.
function matchesDescriptionSearch(description: string | null | undefined, query: string): boolean {
  const terms = query.split('+').map(t => t.trim().toUpperCase()).filter(Boolean)
  if (terms.length === 0) return true
  const desc = (description || '').toUpperCase()
  return terms.every(t => desc.includes(t))
}

// "Filtro avançado" here is intentionally just these two fields (no item de
// série columns like em Busc. Itens Série Estrut. — não se aplicam a
// acessório): Código (multi-seleção exata) e a denominação (busca livre).
function matchesAdvancedFilter(codigo: string, denominacao: string, codeFilter: string[], descSearch: string): boolean {
  if (codeFilter.length > 0 && !codeFilter.includes(codigo)) return false
  return matchesDescriptionSearch(denominacao, descSearch)
}

interface FlatItem {
  estrutura: string
  descEstrutura: string
  equipType: string
  nivel: 2 | 3
  codigo: string
  denominacao: string
  qtd: number
  qtdTotal: number
  codPaiDireto: string
  categoria: AccessoryCategory
  isUps: boolean
  registered: boolean
}

function Badge({ tone, children }: { tone: 'error' | 'success' | 'outline' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'text-error border-error/30 bg-error-container/20'
    : tone === 'success'
    ? 'text-green-400 border-green-500/40 bg-green-500/10'
    : tone === 'amber'
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : 'text-outline border-outline-variant bg-surface-container'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>
      {children}
    </span>
  )
}

// ─── Protheus DB login popup ────────────────────────────────────────────
// Credentials never touch localStorage/sessionStorage — kept only in React
// state for the current page visit, sent per-request to the backend, which
// opens a short-lived connection and closes it right away. Duplicated here
// (rather than shared with analisador-estruturas/page.tsx) on purpose, to
// avoid touching that already-working file for this unrelated page.
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
              Cancelar
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

// ─── Filtro avançado — só Código e Denominação ──────────────────────────
// Mesmo padrão "rascunho + Aplicar/Cancelar" do Filtro avançado em Busc.
// Itens Série Estrut., simplificado: sem os campos de item de série (não se
// aplicam a acessório) — apenas Código (multi-seleção) e busca livre na
// denominação (DESC_ESTRUTURA/DESCRICAO_PRODUTO), com o mesmo "+" para
// exigir mais de uma palavra. Vale para os dois modos de visualização
// (Lista de acessórios e Visão em cascata).
function AdvancedFilterModal({
  onClose,
  onApply,
  codeOptions,
  initialCodeFilter,
  initialDescSearch,
}: {
  onClose: () => void
  onApply: (codeFilter: string[], descSearch: string) => void
  codeOptions: string[]
  initialCodeFilter: string[]
  initialDescSearch: string
}) {
  const [draftCodeFilter, setDraftCodeFilter] = useState<string[]>(initialCodeFilter)
  const [draftDescSearch, setDraftDescSearch] = useState(initialDescSearch)
  const [codeSearch, setCodeSearch] = useState('')

  const activeCount = (draftCodeFilter.length > 0 ? 1 : 0) + (draftDescSearch.trim() ? 1 : 0)

  const toggleCode = (value: string) => {
    setDraftCodeFilter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }
  const clearAll = () => { setDraftCodeFilter([]); setDraftDescSearch('') }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onApply(draftCodeFilter, draftDescSearch)
          onClose()
        }
      }}
    >
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-on-surface">Filtro avançado</h2>
            <p className="text-sm text-outline mt-0.5">
              Selecione os valores desejados e clique em Aplicar. Vale para Lista de acessórios e Visão em cascata.
              {activeCount > 0 && <span className="text-primary font-semibold"> {activeCount} filtro(s) selecionado(s)</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-2xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-on-surface-variant">Código</label>
            <ColumnFilter
              searchValue={codeSearch}
              onSearchChange={setCodeSearch}
              selectedValues={draftCodeFilter}
              onToggleValue={toggleCode}
              onClearValues={() => setDraftCodeFilter([])}
              options={codeOptions}
              placeholder="filtrar…"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-on-surface-variant">
              Buscar em Denominação (DESC_ESTRUTURA / DESCRICAO_PRODUTO)
            </label>
            <input
              type="text"
              value={draftDescSearch}
              onChange={e => setDraftDescSearch(e.target.value)}
              placeholder="ex: 100100+SV"
              className="bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-base text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
            <p className="text-sm text-outline">
              Busca a palavra em qualquer posição da denominação. Use <span className="font-mono font-semibold">+</span> para
              exigir mais de uma palavra ao mesmo tempo — ex.: <span className="font-mono">100100+SV</span> encontra tudo
              que contenha 100100 <span className="font-semibold">e</span> SV juntos, em qualquer posição do texto.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-outline-variant shrink-0">
          <button onClick={clearAll} className="px-3 py-1.5 text-base text-error hover:underline">
            Limpar todos os filtros
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-base text-on-surface-variant hover:text-on-surface">
            Cancelar
          </button>
          <button
            onClick={() => { onApply(draftCodeFilter, draftDescSearch); onClose() }}
            className="px-4 py-1.5 bg-primary text-on-primary rounded text-base font-semibold hover:shadow-neon transition-all"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BuscaAvancadaAcessoriosPage() {
  const [dbCreds, setDbCreds] = useState<{ user: string; password: string } | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [connecting, setConnecting] = useState(false)

  const [headerPrefixInput, setHeaderPrefixInput] = useState(DEFAULT_HEADER_PREFIXES)
  const [nivel2PrefixInput, setNivel2PrefixInput] = useState(DEFAULT_NIVEL2_PREFIXES)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [rawGroups, setRawGroups] = useState<AccessoryHierarchyGroup[]>([])
  const [hasScanned, setHasScanned] = useState(false)

  const [classificationRules, setClassificationRules] = useState<EquipmentClassificationRule[]>([])
  const [registeredCodes, setRegisteredCodes] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedHeaders, setExpandedHeaders] = useState<Set<string>>(new Set())
  const [equipFilter, setEquipFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false)
  const [advancedCodeFilter, setAdvancedCodeFilter] = useState<string[]>([])
  const [advancedDescSearch, setAdvancedDescSearch] = useState('')
  // "Chave" de visualização: lista = lista plana de acessórios (sem
  // duplicatas); cascata = mantém o relacionamento de qual 26.xx cada item
  // veio, em árvore (26.xx → Embalagens/SubPA/Gastos Gerais → Equipamento/
  // Acessórios/matéria-prima da embalagem).
  const [viewMode, setViewMode] = useState<'lista' | 'cascata'>('lista')

  const hydrated = useRef(false)

  // Restore the last scan when returning to this page, same reasoning as
  // Busc. Itens Série Estrut.: losing a bulk-scan result on every navigation
  // would force redoing an expensive Protheus query for no reason.
  useEffect(() => {
    (async () => {
      try {
        const stored = await idbGet<{ rawGroups: AccessoryHierarchyGroup[]; headerPrefixInput: string; nivel2PrefixInput: string; hasScanned: boolean }>(STORAGE_KEY)
        if (stored) {
          // Discard anything saved by an earlier version of this page whose
          // AccessoryHierarchyGroup shape doesn't match the current one
          // (e.g. the old "children" field instead of "rows") — otherwise
          // a stale cached result crashes the page instead of just being
          // treated as "no scan yet".
          const validGroups = Array.isArray(stored.rawGroups) && stored.rawGroups.every(g => Array.isArray(g?.rows))
          setRawGroups(validGroups ? stored.rawGroups : [])
          setHeaderPrefixInput(stored.headerPrefixInput || DEFAULT_HEADER_PREFIXES)
          setNivel2PrefixInput(stored.nivel2PrefixInput || DEFAULT_NIVEL2_PREFIXES)
          setHasScanned(validGroups && !!stored.hasScanned)
        }
      } catch {
        // ignore corrupt/unavailable storage
      } finally {
        hydrated.current = true
      }
    })()
  }, [])

  useEffect(() => {
    if (!hydrated.current) return
    idbSet(STORAGE_KEY, { rawGroups, headerPrefixInput, nivel2PrefixInput, hasScanned }).catch(() => {})
  }, [rawGroups, headerPrefixInput, nivel2PrefixInput, hasScanned])

  // Loads the (user-editable, in Parâmetros de Estrutura) classification
  // rules — same engine already used to group equipment in Busc. Itens
  // Série Estrut., reused here unchanged, just fed with DESC_ESTRUTURA
  // instead of DESCRICAO_PRODUTO (SB1010).
  useEffect(() => {
    fetch('/api/equipment-classification-rules')
      .then(r => r.json())
      .then(rules => setClassificationRules(Array.isArray(rules) ? rules : []))
      .catch(() => {})
  }, [])

  // Registration check against the internal DB: a código counts as
  // "cadastrado no MSM" if it exists in EITHER standard_equipment_items OR
  // accessories — an item found here could turn out to already be
  // registered as either an accessory or, less commonly, as an equipment.
  useEffect(() => {
    (async () => {
      try {
        const [itemsRes, accRes] = await Promise.all([
          fetch('/api/standard_equipment_items?limit=25000'),
          fetch('/api/accessories?limit=25000'),
        ])
        const [itemsJson, accJson] = await Promise.all([itemsRes.json(), accRes.json()])
        const codes = new Set<string>()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of (itemsJson.data || [])) {
          const code = String(r.protheus_code || '').trim().toUpperCase()
          if (code) codes.add(code)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const r of (accJson.data || [])) {
          const code = String(r.protheus_code || '').trim().toUpperCase()
          if (code) codes.add(code)
        }
        setRegisteredCodes(codes)
      } catch {
        // Registration badges just show "Não cadastrado" for everything if this fails.
      }
    })()
  }, [])

  const handleConnect = (user: string, password: string) => {
    setConnecting(true)
    setLoginError('')
    setDbCreds({ user, password })
    setConnecting(false)
    setShowLoginModal(false)
  }

  const runScan = async () => {
    if (!dbCreds) { setShowLoginModal(true); return }
    const headerPrefixes = headerPrefixInput.split(',').map(p => p.trim()).filter(Boolean)
    const nivel2Prefixes = nivel2PrefixInput.split(',').map(p => p.trim()).filter(Boolean)
    if (headerPrefixes.length === 0) { setScanError('Informe ao menos um prefixo de estrutura'); return }

    setScanning(true)
    setScanError('')
    try {
      const res = await fetch('/api/protheus-acessorios-por-equipamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: dbCreds.user, password: dbCreds.password, headerPrefixes, nivel2Prefixes }),
      })
      const json = await res.json()
      if (!res.ok) { setScanError(json.error || 'Falha ao consultar o banco Protheus'); return }
      setRawGroups(json.groups || [])
      setHasScanned(true)
      setExpandedGroups(new Set())
      setExpandedHeaders(new Set())
      setEquipFilter('')
      setCategoryFilter('')
      setAdvancedCodeFilter([])
      setAdvancedDescSearch('')
    } catch {
      setScanError('Erro de comunicação com o banco Protheus')
    } finally {
      setScanning(false)
    }
  }

  const clearResults = () => {
    if (rawGroups.length === 0 && !hasScanned) return
    const ok = window.confirm('Limpar o resultado desta busca?')
    if (!ok) return
    setRawGroups([])
    setHasScanned(false)
    setExpandedGroups(new Set())
    setExpandedHeaders(new Set())
    setEquipFilter('')
    setCategoryFilter('')
    setAdvancedCodeFilter([])
    setAdvancedDescSearch('')
  }

  const toggleGroupExpanded = (groupName: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  const toggleHeaderExpanded = (estrutura: string) => {
    setExpandedHeaders(prev => {
      const next = new Set(prev)
      if (next.has(estrutura)) next.delete(estrutura)
      else next.add(estrutura)
      return next
    })
  }

  // Classifies each "26.xx" header by its own DESC_ESTRUTURA (same rule
  // engine, different input text than Busc. Itens Série Estrut.'s equipment
  // analysis) and flags every NIVEL 2/3 row with its VBA-derived category
  // and registration status.
  const flatItems = useMemo(() => {
    const out: FlatItem[] = []
    for (const g of rawGroups) {
      const equipType = classifyEquipmentType(g.descEstrutura, classificationRules) || UNCLASSIFIED_GROUP
      // NIVEL 2's own QUANT is the multiplier for everything under it — a
      // NIVEL 3 line's real total is QUANT(nível 3) × QUANT(nível 2 pai),
      // not just its own raw QUANT (mirrors QTD TOTAL in Exportar Excel).
      const nivel2QtyByCode = new Map<string, number>()
      for (const r of g.rows) {
        if (r.nivel === 2) nivel2QtyByCode.set(r.codigo, r.qtd)
      }
      for (const r of g.rows) {
        const { categoria, isUps } = classifyAccessoryRow(r.codigo, r.denominacao)
        const qtdTotal = r.nivel === 2 ? r.qtd : r.qtd * (nivel2QtyByCode.get(r.codPaiDireto) ?? 1)
        out.push({
          estrutura: g.estrutura,
          descEstrutura: g.descEstrutura,
          equipType,
          nivel: r.nivel,
          codigo: r.codigo,
          denominacao: r.denominacao,
          qtd: r.qtd,
          qtdTotal,
          codPaiDireto: r.codPaiDireto,
          categoria,
          isUps,
          registered: registeredCodes.has(r.codigo.trim().toUpperCase()),
        })
      }
    }
    return out
  }, [rawGroups, classificationRules, registeredCodes])

  // Options for the "Filtro avançado" Código selector — todo código já
  // encontrado nesta busca, em qualquer nível (inclusive o próprio 26.xx),
  // independente do que os outros filtros escondem.
  const codeOptions = useMemo(() => {
    const codes = new Set<string>(flatItems.map(i => i.codigo))
    for (const g of rawGroups) codes.add(g.estrutura)
    return Array.from(codes).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  }, [flatItems, rawGroups])

  // "Filtro avançado" (Código + Denominação) — vale para Lista de
  // acessórios e Visão em cascata; aplicado aqui, antes de qualquer
  // agrupamento, para que os dois modos herdem o mesmo resultado.
  const filteredFlatItems = useMemo(
    () => flatItems.filter(i => matchesAdvancedFilter(i.codigo, i.denominacao, advancedCodeFilter, advancedDescSearch)),
    [flatItems, advancedCodeFilter, advancedDescSearch],
  )

  const groupedByEquip = useMemo(() => {
    const map = new Map<string, FlatItem[]>()
    for (const item of filteredFlatItems) {
      const bucket = map.get(item.equipType)
      if (bucket) bucket.push(item)
      else map.set(item.equipType, [item])
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNCLASSIFIED_GROUP) return 1
      if (b === UNCLASSIFIED_GROUP) return -1
      return a.localeCompare(b, 'pt-BR')
    })
  }, [filteredFlatItems])

  const categoriesPresent = useMemo(
    () => Array.from(new Set(filteredFlatItems.map(i => i.categoria))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [filteredFlatItems],
  )

  const displayedGroups = groupedByEquip
    .filter(([name]) => !equipFilter || name === equipFilter)
    .map(([name, items]) => [name, items.filter(i => !categoryFilter || i.categoria === categoryFilter)] as const)
    .filter(([, items]) => items.length > 0)

  // "Lista de acessórios" — os mesmos itens de displayedGroups, mas sem
  // repetir o mesmo código dentro de um mesmo equipamento (um acessório
  // pode aparecer em mais de um 26.xx ou nível 3 do mesmo equipamento),
  // ordenados por Código crescente e, em seguida, por Categoria.
  const dedupedGroups = displayedGroups.map(([name, items]) => {
    const seen = new Set<string>()
    const deduped = items.filter(item => {
      const key = item.codigo.trim().toUpperCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    deduped.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }) || a.categoria.localeCompare(b.categoria, 'pt-BR'))
    return [name, deduped] as const
  })

  // "Visão em cascata" — reconstrói a árvore 26.xx → NIVEL 2 → NIVEL 3 a
  // partir dos mesmos dados já classificados, ligando cada linha de nível 3
  // ao seu pai de nível 2 via codPaiDireto. qtdTotal multiplica a QUANT do
  // próprio item pela QUANT do pai direto de nível 2 (nível 2 já é a
  // quantidade total, pois o multiplicador do 26.xx raiz é sempre 1).
  interface CascadeNivel3Node {
    codigo: string
    denominacao: string
    qtd: number
    qtdTotal: number
    categoria: AccessoryCategory
    isUps: boolean
    registered: boolean
  }
  interface CascadeNivel2Node extends CascadeNivel3Node {
    children: CascadeNivel3Node[]
  }
  interface CascadeHeader {
    estrutura: string
    descEstrutura: string
    equipType: string
    nivel2: CascadeNivel2Node[]
  }

  // Filtro avançado ativo? Enquanto vazio, a cascata inteira aparece sem
  // nenhuma poda — só passa a decidir o que mostrar quando há algo digitado.
  const hasActiveAdvancedFilter = advancedCodeFilter.length > 0 || !!advancedDescSearch.trim()

  const cascadeHeaders = useMemo<CascadeHeader[]>(() => {
    const headers = rawGroups.map(g => {
      const equipType = classifyEquipmentType(g.descEstrutura, classificationRules) || UNCLASSIFIED_GROUP
      const toNode = (r: AccessoryHierarchyRow, fator: number) => {
        const { categoria, isUps } = classifyAccessoryRow(r.codigo, r.denominacao)
        return {
          codigo: r.codigo,
          denominacao: r.denominacao,
          qtd: r.qtd,
          qtdTotal: r.qtd * fator,
          categoria,
          isUps,
          registered: registeredCodes.has(r.codigo.trim().toUpperCase()),
        }
      }
      const nivel3Rows = g.rows.filter(r => r.nivel === 3)
      const nivel2 = g.rows
        .filter(r => r.nivel === 2)
        .map(r => ({
          ...toNode(r, 1),
          children: nivel3Rows.filter(n3 => n3.codPaiDireto === r.codigo).map(n3 => toNode(n3, r.qtd)),
        }))
      return { estrutura: g.estrutura, descEstrutura: g.descEstrutura, equipType, nivel2 }
    })
    if (!hasActiveAdvancedFilter) return headers

    // Um filtro ativo em Busc. Avançada Acessórios não deve isolar o item
    // encontrado tirando o resto da árvore — ele deve continuar mostrando
    // todos os pais e irmãos daquele componente, servidos junto com o
    // cabeçalho 26.xx inteiro; o filtro só decide QUAIS cabeçalhos aparecem
    // (qualquer item, em qualquer nível — 26.xx, nível 2 ou nível 3).
    return headers.filter(h =>
      matchesAdvancedFilter(h.estrutura, h.descEstrutura, advancedCodeFilter, advancedDescSearch) ||
      h.nivel2.some(n2 =>
        matchesAdvancedFilter(n2.codigo, n2.denominacao, advancedCodeFilter, advancedDescSearch) ||
        n2.children.some(n3 => matchesAdvancedFilter(n3.codigo, n3.denominacao, advancedCodeFilter, advancedDescSearch))
      )
    )
  }, [rawGroups, classificationRules, registeredCodes, hasActiveAdvancedFilter, advancedCodeFilter, advancedDescSearch])

  const cascadeByEquip = useMemo(() => {
    const map = new Map<string, CascadeHeader[]>()
    for (const h of cascadeHeaders) {
      const bucket = map.get(h.equipType)
      if (bucket) bucket.push(h)
      else map.set(h.equipType, [h])
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNCLASSIFIED_GROUP) return 1
      if (b === UNCLASSIFIED_GROUP) return -1
      return a.localeCompare(b, 'pt-BR')
    })
  }, [cascadeHeaders])

  const displayedCascadeGroups = cascadeByEquip.filter(([name]) => !equipFilter || name === equipFilter)

  // Applying "Filtro avançado" auto-expands whatever groups/cabeçalhos it
  // left standing — otherwise the match would be sitting inside boxes that
  // are still collapsed by default, defeating the point of filtering.
  useEffect(() => {
    if (!hasActiveAdvancedFilter) return
    setExpandedGroups(new Set([...groupedByEquip.map(([name]) => name), ...cascadeByEquip.map(([name]) => name)]))
    setExpandedHeaders(new Set(cascadeHeaders.map(h => h.estrutura)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedCodeFilter, advancedDescSearch])

  return (
    <div className="p-8 max-w-[108rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · busc. avançada acessórios
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Busc. Avançada Acessórios</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Varre todo cabeçalho de estrutura no Protheus com o prefixo de NIVEL 1 informado (nunca listado
          diretamente), classifica cada um por tipo de equipamento usando as mesmas regras de{' '}
          <a href="/parametros-estrutura" className="text-primary hover:underline">Classificação de Equipamentos</a>
          {' '}(aplicadas sobre DESC_ESTRUTURA), e lista todos os itens de NIVEL 2 dessa estrutura — SubPA,
          Embalagens, Gastos Gerais — só abrindo para NIVEL 3 (o próprio equipamento e seus acessórios) os itens de
          nível 2 que combinem com o prefixo de NIVEL 2 informado. Cada item ganha uma categoria (regras herdadas
          da macro VBA original) e um texto dizendo se já está cadastrado no MSM (Cadastro de Equipamentos ou
          Cadastro de Componentes). Nada é ocultado por não estar cadastrado.
        </p>
      </div>

      <div className="mb-1 flex items-center gap-3 flex-wrap">
        {dbCreds ? (
          <>
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

      {showLoginModal && (
        <DbLoginModal
          onClose={() => setShowLoginModal(false)}
          onConnect={handleConnect}
          connecting={connecting}
          error={loginError}
        />
      )}
      {advancedFilterOpen && (
        <AdvancedFilterModal
          onClose={() => setAdvancedFilterOpen(false)}
          onApply={(codeFilter, descSearch) => { setAdvancedCodeFilter(codeFilter); setAdvancedDescSearch(descSearch) }}
          codeOptions={codeOptions}
          initialCodeFilter={advancedCodeFilter}
          initialDescSearch={advancedDescSearch}
        />
      )}

      <div className="mb-6 flex items-end gap-3 flex-wrap">
        <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
          Prefixo(s) de estrutura (NIVEL 1)
          <input
            type="text"
            value={headerPrefixInput}
            onChange={e => setHeaderPrefixInput(e.target.value)}
            placeholder="ex: 26"
            className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-48"
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
          Prefixo(s) para abrir NIVEL 2
          <input
            type="text"
            value={nivel2PrefixInput}
            onChange={e => setNivel2PrefixInput(e.target.value)}
            placeholder="ex: 27.13"
            title="Só os itens de nível 2 cujo código combine com este prefixo têm seus filhos (nível 3) explorados — os demais aparecem no nível 2, mas sem abrir mais fundo"
            className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-48"
          />
        </label>
        <button
          onClick={runScan}
          disabled={scanning}
          className="px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
        >
          {scanning ? 'Buscando…' : '🔍 Buscar'}
        </button>
        {hasScanned && (
          <button
            onClick={clearResults}
            className="px-3 py-2.5 text-sm text-error border border-error/30 rounded hover:bg-error-container/20 transition-colors whitespace-nowrap"
          >
            🗑 Limpar
          </button>
        )}
      </div>

      {scanError && <div className="text-error text-sm mb-4">⚠ {scanError}</div>}

      {hasScanned && groupedByEquip.length > 0 && (
        <div className="mb-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewMode(v => v === 'lista' ? 'cascata' : 'lista')}
              role="switch"
              aria-checked={viewMode === 'cascata'}
              title="Alterna entre a lista plana de acessórios (sem duplicatas) e a visão em cascata por 26.xx"
              className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors shrink-0 ${
                viewMode === 'cascata' ? 'bg-primary' : 'bg-surface-container-highest border border-outline-variant'
              }`}
            >
              <span
                className={`inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform ${
                  viewMode === 'cascata' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-sm font-semibold ${viewMode === 'cascata' ? 'text-outline' : 'text-primary'}`}>
              Lista de acessórios
            </span>
            <span className="text-outline">/</span>
            <span className={`text-sm font-semibold ${viewMode === 'cascata' ? 'text-primary' : 'text-outline'}`}>
              Visão em cascata (26.xx)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-on-surface-variant">Equipamento:</span>
            <select
              value={equipFilter}
              onChange={e => setEquipFilter(e.target.value)}
              className="bg-surface-container-low border border-outline-variant rounded px-3 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            >
              <option value="">— Todos —</option>
              {groupedByEquip.map(([name]) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          {viewMode === 'lista' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-on-surface-variant">Categoria:</span>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="bg-surface-container-low border border-outline-variant rounded px-3 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              >
                <option value="">— Todas —</option>
                {categoriesPresent.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={() => setAdvancedFilterOpen(true)}
            title="Filtra os componentes exibidos por Código ou por texto na Denominação — vale para os dois modos de visualização"
            className={`px-3 py-1.5 text-sm rounded border transition-colors whitespace-nowrap ${
              advancedCodeFilter.length > 0 || advancedDescSearch.trim()
                ? 'text-primary border-primary/40 bg-primary/10 hover:bg-primary/20'
                : 'text-on-surface-variant border-outline-variant hover:border-primary hover:text-primary'
            }`}
          >
            🔎 Filtro avançado{(advancedCodeFilter.length > 0 ? 1 : 0) + (advancedDescSearch.trim() ? 1 : 0) > 0
              ? ` (${(advancedCodeFilter.length > 0 ? 1 : 0) + (advancedDescSearch.trim() ? 1 : 0)})`
              : ''}
          </button>
        </div>
      )}

      {!hasScanned ? (
        <div className="text-sm text-outline italic">Nenhuma busca realizada ainda.</div>
      ) : groupedByEquip.length === 0 ? (
        <div className="text-sm text-outline italic">
          Nenhuma estrutura encontrada com esse(s) prefixo(s).
        </div>
      ) : viewMode === 'lista' ? (
        displayedGroups.length === 0 ? (
          <div className="text-sm text-outline italic">Nenhum item combina com os filtros selecionados.</div>
        ) : (
        <div className="flex flex-col gap-6">
          {dedupedGroups.map(([equipType, items]) => {
            const groupOpen = expandedGroups.has(equipType)
            return (
              <div key={equipType}>
                <div
                  onClick={() => toggleGroupExpanded(equipType)}
                  className="flex items-center gap-3 px-4 py-3 mb-2 rounded-xl border border-outline-variant bg-surface-container-high hover:bg-surface-container-highest cursor-pointer select-none transition-colors"
                >
                  <span className={`text-outline text-sm leading-none transition-transform ${groupOpen ? 'rotate-90' : ''}`}>›</span>
                  <span className="text-xs font-bold text-primary uppercase tracking-wide">
                    {equipType} <span className="text-outline font-normal">({items.length})</span>
                  </span>
                </div>
                {groupOpen && (
                  <div className="overflow-auto border border-outline-variant rounded-lg">
                    <table className="text-xs w-full">
                      <thead className="bg-surface-container-highest">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Código</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Denominação</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Qtd Total</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Categoria</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Cadastro</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => {
                          const isMatch = hasActiveAdvancedFilter && matchesAdvancedFilter(item.codigo, item.denominacao, advancedCodeFilter, advancedDescSearch)
                          return (
                          <tr key={`${item.codigo}-${i}`} className={`border-t border-outline-variant/50 ${isMatch ? 'bg-primary/10' : ''}`}>
                            <td className="px-3 py-2 font-mono text-primary whitespace-nowrap">{item.codigo}</td>
                            <td className="px-3 py-2 text-on-surface">{item.denominacao || '—'}</td>
                            <td className="px-3 py-2 text-on-surface">{item.qtdTotal}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className="text-on-surface-variant font-semibold">{item.categoria}</span>
                              {item.isUps && <span className="ml-1.5"><Badge tone="amber">UPS</Badge></span>}
                            </td>
                            <td className="px-3 py-2">
                              {item.registered
                                ? <Badge tone="success">Cadastrado no MSM</Badge>
                                : <Badge tone="error">Não cadastrado no MSM</Badge>}
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        )
      ) : displayedCascadeGroups.length === 0 ? (
        <div className="text-sm text-outline italic">Nenhum item combina com o filtro selecionado.</div>
      ) : (
        <div className="flex flex-col gap-6">
          {displayedCascadeGroups.map(([equipType, headers]) => {
            const groupOpen = expandedGroups.has(equipType)
            const totalCount = headers.length
            return (
              <div key={equipType}>
                <div
                  onClick={() => toggleGroupExpanded(equipType)}
                  className="flex items-center gap-3 px-4 py-3 mb-2 rounded-xl border border-outline-variant bg-surface-container-high hover:bg-surface-container-highest cursor-pointer select-none transition-colors"
                >
                  <span className={`text-outline text-sm leading-none transition-transform ${groupOpen ? 'rotate-90' : ''}`}>›</span>
                  <span className="text-xs font-bold text-primary uppercase tracking-wide">
                    {equipType} <span className="text-outline font-normal">({totalCount} estrutura{totalCount !== 1 ? 's' : ''} 26.xx)</span>
                  </span>
                </div>
                {groupOpen && (
                  <div className="flex flex-col gap-2">
                    {headers.map(h => {
                      const headerOpen = expandedHeaders.has(h.estrutura)
                      const headerMatches = hasActiveAdvancedFilter && matchesAdvancedFilter(h.estrutura, h.descEstrutura, advancedCodeFilter, advancedDescSearch)
                      return (
                        <div key={h.estrutura} className="border border-outline-variant rounded-lg overflow-hidden">
                          <div
                            onClick={() => toggleHeaderExpanded(h.estrutura)}
                            className={`flex items-center gap-3 px-3 py-2 hover:bg-surface-container-highest cursor-pointer select-none transition-colors ${headerMatches ? 'bg-primary/10' : 'bg-surface-container-high'}`}
                          >
                            <span className={`text-outline text-xs leading-none transition-transform ${headerOpen ? 'rotate-90' : ''}`}>›</span>
                            <span className="font-mono text-xs text-primary">{h.estrutura}</span>
                            <span className="text-xs text-on-surface-variant truncate">{h.descEstrutura}</span>
                            <span className="text-xs text-outline ml-auto shrink-0">({h.nivel2.length})</span>
                          </div>
                          {headerOpen && (
                            <div className="divide-y divide-outline-variant/40">
                              {h.nivel2.map((n2, i2) => {
                                const n2Matches = hasActiveAdvancedFilter && matchesAdvancedFilter(n2.codigo, n2.denominacao, advancedCodeFilter, advancedDescSearch)
                                return (
                                <div key={`${n2.codigo}-${i2}`} className="p-2">
                                  <div className={`flex items-center gap-2 px-2 py-1.5 rounded ${n2Matches ? 'bg-primary/10' : 'bg-surface-container'}`}>
                                    <span className="font-mono text-xs text-on-surface whitespace-nowrap">{n2.codigo}</span>
                                    <span className="text-xs text-on-surface-variant truncate flex-1">{n2.denominacao || '—'}</span>
                                    <span className="text-[10px] text-outline font-mono whitespace-nowrap">Qtd Total: {n2.qtdTotal}</span>
                                    <span className="text-[10px] text-on-surface-variant font-semibold whitespace-nowrap">{n2.categoria}</span>
                                    {n2.isUps && <Badge tone="amber">UPS</Badge>}
                                    {n2.registered
                                      ? <Badge tone="success">Cadastrado no MSM</Badge>
                                      : <Badge tone="error">Não cadastrado no MSM</Badge>}
                                  </div>
                                  {n2.children.length > 0 && (
                                    <div className="ml-6 mt-1 flex flex-col gap-1">
                                      {n2.children.map((n3, i3) => {
                                        const n3Matches = hasActiveAdvancedFilter && matchesAdvancedFilter(n3.codigo, n3.denominacao, advancedCodeFilter, advancedDescSearch)
                                        return (
                                        <div key={`${n3.codigo}-${i3}`} className={`flex items-center gap-2 px-2 py-1.5 rounded border ${n3Matches ? 'border-primary/50 bg-primary/10' : 'border-outline-variant/40'}`}>
                                          <span className="font-mono text-xs text-primary whitespace-nowrap">{n3.codigo}</span>
                                          <span className="text-xs text-on-surface-variant truncate flex-1">{n3.denominacao || '—'}</span>
                                          <span className="text-[10px] text-outline font-mono whitespace-nowrap">Qtd Total: {n3.qtdTotal}</span>
                                          <span className="text-[10px] text-on-surface-variant font-semibold whitespace-nowrap">{n3.categoria}</span>
                                          {n3.isUps && <Badge tone="amber">UPS</Badge>}
                                          {n3.registered
                                            ? <Badge tone="success">Cadastrado no MSM</Badge>
                                            : <Badge tone="error">Não cadastrado no MSM</Badge>}
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
