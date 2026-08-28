'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { TableSchema, Field, getListFields, DOMAIN_LABELS, FORCE_TO_ONE_FIELDS, getControllershipPendingFields, TARGET_COST_PENDING_FIELD } from '@/lib/schema'
import { exportMatrix, parseImportFile, exportVisibleData } from '@/lib/importExport'
import type { ProtheusProductStatus } from '@/lib/protheusDb'
import { useProtheusAuth } from '@/lib/protheusAuthContext'
import { useAppAuth } from '@/lib/appAuthContext'
import { shouldCompareField, valuesEqual, getRowKey, getCostItemKey, groupRowsByKey } from '@/lib/csvBaseline'

type LookupMap = Record<string, Record<string, string>>
import RecordModal from './RecordModal'
import NonCombinableModal from './NonCombinableModal'
import DependentItemsModal from './DependentItemsModal'
import RollerTableModal from './RollerTableModal'
import ColumnFilter from './ColumnFilter'
import ImportReviewModal from './ImportReviewModal'
import BulkEditModal from './BulkEditModal'

interface Props {
  tableName: string
  schema: TableSchema
  // Vem de ?view=novos na URL (ver [table]/page.tsx) — usado pelo cartão de
  // pendências de controladoria do Dashboard pra abrir a tabela já filtrada
  // em "Somente Novos", sem precisar o usuário clicar de novo.
  initialViewMode?: 'completo' | 'novos'
}

interface PageData {
  data: Record<string, unknown>[]
  total: number
  page: number
  pages: number
}

const PAGE_SIZE = 25000

function getDisplayValue(
  row: Record<string, unknown>,
  fieldName: string,
  field: Field | undefined,
  lookups: LookupMap,
  allFields: Field[] = [],
  duplicateCountMaps: Record<string, Map<string, number>> = {},
  // Colunas financeiras (FORCE_TO_ONE_FIELDS): o Supabase sempre tem 1 aí —
  // com localCosts+schema informados, filtro de coluna e opções do dropdown
  // passam a considerar o valor real guardado localmente, não o "1" bruto.
  localCosts?: Record<string, { values: Record<string, number | null> }> | null,
  schema?: TableSchema,
  tableName?: string,
): string {
  if (field && localCosts && schema && tableName && FORCE_TO_ONE_FIELDS.includes(field.name)) {
    const key = getCostItemKey(tableName, schema, row)
    const v = localCosts[key]?.values[field.name]
    if (v !== undefined) return v === null ? 'N/A' : String(v)
  }
  if (field?.countDuplicatesOf) {
    const targetName = field.countDuplicatesOf
    const targetField = allFields.find(f => f.name === targetName)
    const targetValue = getDisplayValue(row, targetName, targetField, lookups, allFields, duplicateCountMaps)
    return String(duplicateCountMaps[targetName]?.get(targetValue) ?? 1)
  }
  if (field?.concatFrom) {
    // Every field's value goes in, including "N/A" for whatever is unset —
    // this is a literal concatenation of all of them, not just the filled-in ones.
    return field.concatFrom
      .map(name => getDisplayValue(row, name, allFields.find(f => f.name === name), lookups, allFields, duplicateCountMaps))
      .join(' / ')
  }
  if (field?.lookupFrom && lookups[fieldName]) {
    const keyField = field.lookupFrom.sourceField ?? fieldName
    const key = String(row[keyField] ?? '')
    return lookups[fieldName][key] ?? 'N/A'
  }
  const raw = row[fieldName]
  if (field?.type === 'boolean') return raw ? 'Sim' : 'Não'
  if (raw === null || raw === undefined || raw === 'null' || raw === '') return 'N/A'
  return String(raw)
}

function applyFilters(
  rows: Record<string, unknown>[],
  filters: Record<string, string[]>,
  fields: Field[],
  lookups: LookupMap,
  duplicateCountMaps: Record<string, Map<string, number>> = {},
  localCosts?: Record<string, { values: Record<string, number | null> }> | null,
  schema?: TableSchema,
  tableName?: string,
): Record<string, unknown>[] {
  const active = Object.entries(filters).filter(([, v]) => v.length > 0)
  if (!active.length) return rows
  return rows.filter(row =>
    active.every(([name, vals]) => {
      const field = fields.find(f => f.name === name)
      const display = getDisplayValue(row, name, field, lookups, fields, duplicateCountMaps, localCosts, schema, tableName)
      return vals.includes(display)
    })
  )
}

// Sort key for schema.listSortBy: a real column (e.g. legacy_equipment_id)
// sorts by its own raw value — never the display name a lookupFrom would resolve
// it to — while a virtual field (no property of its own on the row, e.g. a
// sort-only lookup like group_legacy_id) resolves through getDisplayValue,
// which for those fields is configured to return the numeric id itself.
// pairKeyFrom fields (ex.: pair_key) instead combine two other field values
// into an order-independent key, so both directions of an unordered pair
// (A→B and its mirrored B→A row) sort next to each other.
function getSortValue(
  row: Record<string, unknown>,
  fieldName: string,
  field: Field | undefined,
  lookups: LookupMap,
  allFields: Field[],
): string {
  if (field?.pairKeyFrom) {
    const [f1, f2] = field.pairKeyFrom
    return [String(row[f1] ?? ''), String(row[f2] ?? '')].sort().join('|')
  }
  const raw = row[fieldName]
  return String(raw !== undefined ? raw : getDisplayValue(row, fieldName, field, lookups, allFields))
}

// Protheus codes (ex.: "27.01.00148") aren't pure numbers, so a numeric-only
// comparator would sort them all as 0 — numeric compare when both sides
// parse as a real number (ids), locale string compare otherwise (codes,
// pair keys).
function compareSortValues(a: string, b: string): number {
  const an = Number(a), bn = Number(b)
  if (a !== '' && b !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
  return a.localeCompare(b, 'pt-BR')
}

function applyListSortBy(
  rows: Record<string, unknown>[],
  sortBy: string[] | undefined,
  fields: Field[],
  lookups: LookupMap,
): Record<string, unknown>[] {
  if (!sortBy || sortBy.length === 0) return rows
  const sortFields = sortBy.map(name => fields.find(f => f.name === name))
  return [...rows].sort((a, b) => {
    for (let i = 0; i < sortBy.length; i++) {
      const diff = compareSortValues(
        getSortValue(a, sortBy[i], sortFields[i], lookups, fields),
        getSortValue(b, sortBy[i], sortFields[i], lookups, fields),
      )
      if (diff !== 0) return diff
    }
    return 0
  })
}

export default function DataTable({ tableName, schema, initialViewMode }: Props) {
  const [pageData, setPageData] = useState<PageData | null>(null)
  const [page] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null)
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [lookups, setLookups] = useState<LookupMap>({})
  const [nonCombModal,    setNonCombModal]    = useState(false)
  const [depItemsModal,   setDepItemsModal]   = useState(false)
  const [rollerModal,     setRollerModal]     = useState(false)
  // colFilters: selected values per column (multi-select checkboxes)
  const [colFilters,    setColFilters]    = useState<Record<string, string[]>>({})
  // filterSearch: text typed in each filter's search box (narrows dropdown, doesn't filter table)
  const [filterSearch,  setFilterSearch]  = useState<Record<string, string>>({})
  const scrollRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [importRows,    setImportRows]     = useState<Record<string, string>[] | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [newMenuOpen,   setNewMenuOpen]   = useState(false)
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  // View-only Protheus status flag column (see schema.protheusStatusCheckField) — ATIVO/BLOQUEADO
  // per product code (SB1010). Uses the single app-wide Protheus connection
  // (see Sidebar) — no per-table connect button/modal anymore.
  const { creds: protheusCreds } = useProtheusAuth()
  const [protheusStatusMap, setProtheusStatusMap] = useState<Map<string, ProtheusProductStatus> | null>(null)
  const [protheusChecking, setProtheusChecking] = useState(false)

  // Perfil sem isAdmin: só pode inserir/excluir se canCreateDelete estiver
  // ligado, e só pode editar os campos liberados pra esta tabela em
  // Configuração de Usuários — em nenhum outro. Perfil admin não tem
  // restrição nenhuma, exatamente como Engenharia do Produto sempre teve.
  const { user: appUser } = useAppAuth()
  const canCreateDelete = appUser.isAdmin || appUser.canCreateDelete
  const restrictedFieldNames = useMemo(
    () => appUser.isAdmin ? undefined : new Set(appUser.editableFieldsByTable[tableName] ?? []),
    [appUser, tableName]
  )
  // accessories/standard_equipment_items: "Somente Novos" pro perfil restrito
  // não olha mais cost_std = 0 (o Admin agora sempre preenche um custo
  // sugerido) — usa a fila pending_target_cost em vez disso (ver
  // TARGET_COST_PENDING_FIELD em schema.ts). Outras tabelas com campo de
  // controladoria (ex.: equipments — IPI, margem, comissões) continuam no
  // critério antigo "= 0", sem nenhuma mudança.
  const usesTargetCostPending = schema.fields.some(f => f.name === TARGET_COST_PENDING_FIELD)
  // Retrato do último import do Atualizador Global de Tabelas para esta
  // tabela (null = a tabela nunca passou por lá — nesse caso nada é
  // destacado). Usado só para o destaque amarelo de linha/célula.
  const [baselineRows, setBaselineRows] = useState<Record<string, unknown>[] | null>(null)
  // Só pra diagnóstico — distingue "tabela nunca teve import" (silencioso,
  // por design) de "a busca do retrato falhou de verdade" (mostra um aviso,
  // em vez de ficar indistinguível dos dois casos).
  const [baselineError, setBaselineError] = useState<string | null>(null)
  // Valores financeiros reais capturados do CSV (nunca vão pro Supabase —
  // lá esses campos sempre ficam 1) — chave de negócio -> {label, values,
  // updatedAt}. null = ainda carregando (ou tabela sem coluna financeira,
  // caso em que a busca nem dispara e fica null pra sempre).
  const [localCosts, setLocalCosts] = useState<Record<string, { label: string; values: Record<string, number | null>; updatedAt: string }> | null>(null)
  // Fila de aprovação de custo alvo (accessories/standard_equipment_items,
  // perfil restrito) — protheus_code -> status ('novo' | 'em_alteracao').
  // null = ainda carregando (ou tabela sem esse campo/perfil admin, caso em
  // que a busca nem dispara e fica null pra sempre).
  const [pendingTargetCost, setPendingTargetCost] = useState<Record<string, { status: string }> | null>(null)

  const listFields = useMemo(() => getListFields(tableName), [tableName])
  // Columns actually rendered — excludes hideInList fields (e.g. Resumo, kept
  // in listFields only so countDuplicatesOf can still resolve it).
  const visibleListFields = useMemo(() => listFields.filter(f => !f.hideInList), [listFields])
  // Fields with countDuplicatesOf (e.g. Repetições) are pinned right before
  // the Protheus status column; everything else renders in normal order.
  const pinnedListFields = useMemo(() => visibleListFields.filter(f => f.countDuplicatesOf), [visibleListFields])
  const restListFields = useMemo(() => visibleListFields.filter(f => !f.countDuplicatesOf), [visibleListFields])

  // 'completo' = todos os registros (padrão); 'novos' = só os criados depois
  // do último import no Atualizador Global, ou pendentes de custo real pro
  // perfil restrito (mesmo critério do destaque amarelo) — afeta a lista, a
  // contagem no rodapé e o "Exportar dados". Começa em initialViewMode
  // quando a página carrega com ?view=novos (ver [table]/page.tsx), vindo do
  // cartão de pendências do Dashboard.
  const [viewMode, setViewMode] = useState<'completo' | 'novos' | 'em_alteracao'>(initialViewMode ?? 'completo')

  useEffect(() => {
    // Não confia só no initialViewMode vindo do server (searchParams) — numa
    // navegação client-side (Link do pop-up de pendências) pra uma rota já
    // visitada sem ?view=, o router do Next.js pode reaproveitar a página já
    // cacheada e nunca repassar o param novo. Lendo a URL de verdade do
    // navegador aqui garante que "Ir para janela" sempre abra em "Somente
    // Novos", mesmo quando isso acontece. Roda em toda troca de tabela
    // (inclusive a primeira montagem), e também reseta os outros filtros —
    // a mesma instância de DataTable é reaproveitada ao trocar de tabela
    // pela Sidebar (só tableName/schema mudam, sem remount).
    const wantNovos = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'novos'
    setColFilters({}); setFilterSearch({}); setSelectedIds(new Set()); setProtheusStatusMap(null); setBaselineRows(null); setBaselineError(null); setLocalCosts(null); setPendingTargetCost(null)
    setViewMode(wantNovos ? 'novos' : 'completo')
  }, [tableName])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/csv-baseline/${tableName}`)
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        return json
      })
      .then(json => { if (!cancelled) { setBaselineRows(json?.snapshot ?? null); setBaselineError(null) } })
      .catch((err: Error) => {
        if (cancelled) return
        setBaselineRows(null)
        setBaselineError(err.message)
        console.error(`[csv-baseline/${tableName}]`, err.message)
      })
    return () => { cancelled = true }
  }, [tableName])

  // Extraído pra função (em vez de só um efeito) porque o valor real
  // capturado localmente muda a cada edição de campo de controladoria/
  // fiscal/precificação nesta MESMA tela — sem recarregar aqui de novo depois
  // de salvar, a célula ficava com o valor antigo até um F5 (que reexecuta o
  // efeito do zero). Chamada tanto no mount quanto em todo onSaved/onDone
  // abaixo, junto com fetchData().
  const hasForceFields = schema.fields.some(f => FORCE_TO_ONE_FIELDS.includes(f.name))
  const fetchLocalCosts = useCallback(async () => {
    if (!hasForceFields) return
    try {
      const res = await fetch(`/api/local-costs?table=${tableName}`)
      setLocalCosts(res.ok ? await res.json() : {})
    } catch {
      setLocalCosts({})
    }
  }, [tableName, hasForceFields])

  useEffect(() => { fetchLocalCosts() }, [fetchLocalCosts])

  useEffect(() => {
    if (!usesTargetCostPending || appUser.isAdmin) return
    let cancelled = false
    fetch('/api/pending-target-cost')
      .then(r => r.ok ? r.json() : {})
      .then(json => { if (!cancelled) setPendingTargetCost(json) })
      .catch(() => { if (!cancelled) setPendingTargetCost({}) })
    return () => { cancelled = true }
  }, [tableName, usesTargetCostPending, appUser.isAdmin])

  // "✓ Custo Imputado" (Gerente Adm Comercial) — move o código de 'novo'
  // pra 'em_alteracao': some de "Somente Novos", entra em "Em Alteração de
  // Custeio" até o Atualizador Global confirmar oficialmente via CSV.
  const [signalingCode, setSignalingCode] = useState<string | null>(null)
  const handleSignalCostImputed = async (protheusCode: string) => {
    const code = protheusCode.trim().toUpperCase()
    if (!code || signalingCode) return
    setSignalingCode(code)
    try {
      const res = await fetch(`/api/pending-target-cost/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'em_alteracao' }),
      })
      if (res.ok) {
        setPendingTargetCost(prev => ({ ...(prev ?? {}), [code]: { status: 'em_alteracao' } }))
      }
    } catch { /* usuário pode tentar de novo */ }
    setSignalingCode(null)
  }

  useEffect(() => {
    const fieldsWithLookup = listFields.filter(f => f.lookupFrom)
    if (fieldsWithLookup.length === 0) return
    fieldsWithLookup.forEach(async (field) => {
      const lc = field.lookupFrom!

      // Preenche, na própria map de exibição, as chaves que não existem na
      // tabela principal do lookupFrom mas existem nesta tabela alternativa —
      // assim filtro, exportação e célula usam o mesmo valor sem precisar de
      // nenhuma lógica extra em getDisplayValue.
      const applyFallback = async (map: Record<string, string>) => {
        if (!field.lookupFallback) return
        const fb = field.lookupFallback
        const fbRes = await fetch(`/api/${fb.table}?limit=25000`)
        if (!fbRes.ok) return
        const fbJson = await fbRes.json()
        for (const row of (fbJson.data || [])) {
          const key = String(row[fb.keyField])
          if (!(key in map)) map[key] = fb.fixedValue
        }
      }

      if (lc.through) {
        const [mainRes, throughRes] = await Promise.all([
          fetch(`/api/${lc.table}?limit=25000`),
          fetch(`/api/${lc.through.table}?limit=25000`),
        ])
        if (!mainRes.ok || !throughRes.ok) return
        const [mainJson, throughJson] = await Promise.all([mainRes.json(), throughRes.json()])
        const intermediateMap: Record<string, string> = {}
        for (const row of (mainJson.data || [])) {
          intermediateMap[String(row[lc.keyField])] = row[lc.displayField] == null ? '' : String(row[lc.displayField])
        }
        const throughMap: Record<string, string> = {}
        for (const row of (throughJson.data || [])) {
          throughMap[String(row[lc.through.keyField])] = row[lc.through.displayField] == null ? '' : String(row[lc.through.displayField])
        }
        const map: Record<string, string> = {}
        for (const [key, mid] of Object.entries(intermediateMap)) {
          if (mid && throughMap[mid]) map[key] = throughMap[mid]
        }
        await applyFallback(map)
        setLookups(prev => ({ ...prev, [field.name]: map }))
        return
      }

      const res = await fetch(`/api/${lc.table}?limit=25000`)
      if (!res.ok) return
      const json = await res.json()
      const map: Record<string, string> = {}
      for (const row of (json.data || [])) {
        map[String(row[lc.keyField])] = row[lc.displayField] == null ? '' : String(row[lc.displayField])
      }
      await applyFallback(map)
      setLookups(prev => ({ ...prev, [field.name]: map }))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (search) params.set('search', search)
    const res = await fetch(`/api/${tableName}?${params}`)
    if (!res.ok) {
      setError('Erro ao carregar dados')
      setLoading(false)
      return
    }
    const json = await res.json()
    setPageData(json)
    setLoading(false)
  }, [tableName, page, search])

  useEffect(() => { fetchData() }, [fetchData])

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pageData, checkScroll])

  // For a field with countDuplicatesOf set (e.g. "Repetições" counting
  // Resumo), tallies how many rows across the whole loaded table (not just
  // the currently column-filtered ones) share each resolved value of the
  // target field — one map per distinct target, built once per data/lookup
  // refresh instead of re-scanning per row.
  const duplicateCountMaps = useMemo(() => {
    const maps: Record<string, Map<string, number>> = {}
    if (!pageData) return maps
    const targets = new Set(listFields.filter(f => f.countDuplicatesOf).map(f => f.countDuplicatesOf as string))
    for (const targetName of targets) {
      const targetField = listFields.find(f => f.name === targetName)
      const counts = new Map<string, number>()
      for (const row of pageData.data) {
        const val = getDisplayValue(row, targetName, targetField, lookups, listFields)
        counts.set(val, (counts.get(val) ?? 0) + 1)
      }
      maps[targetName] = counts
    }
    return maps
  }, [pageData, listFields, lookups])

  // chave de negócio (mesma da Auditoria — NUNCA o id/uuid interno, que é
  // regenerado a cada import CSV e por isso nunca repetiria entre o
  // snapshot e o banco) -> linha, do retrato do último import CSV (ver
  // csv_baseline_snapshots). null = tabela nunca passou pelo Atualizador
  // Global — nesse caso nada é destacado (ausência de baseline não é a
  // mesma coisa que "tudo é novo").
  //
  // Em algumas tabelas (ex.: relationship_equip_accessory) a chave de
  // negócio NÃO é de fato única — o mesmo Equipamento+Código Protheus pode
  // aparecer em mais de uma linha de verdade, com outros campos diferentes.
  // Quando isso acontece, guardamos em `ambiguousKeys` em vez de deixar uma
  // linha "atropelar" a outra no Map — para essas chaves a comparação fica
  // indefinida (nem nova, nem alterada) em vez de arriscar um veredito
  // errado numa linha que ninguém tocou.
  const baseline = useMemo(() => {
    if (!baselineRows) return null
    return groupRowsByKey(schema, baselineRows)
  }, [baselineRows, schema])

  // Mesma ambiguidade, mas do lado do banco ao vivo (tabela inteira, não só
  // o que está filtrado na tela agora) — se a chave se repete aqui também,
  // nenhuma das linhas repetidas pode ser comparada com segurança.
  const liveDuplicateKeys = useMemo(() => {
    if (!pageData) return new Set<string>()
    return groupRowsByKey(schema, pageData.data).ambiguousKeys
  }, [pageData, schema])

  // Colunas de controladoria/fiscal/precificação existentes nesta tabela —
  // usadas só pela definição de "novo" de um perfil restrito, logo abaixo.
  // Mesmo critério do cartão de pendências do Dashboard (ver
  // getControllershipPendingFields em schema.ts).
  const zeroForceFields = useMemo(() => getControllershipPendingFields(schema), [schema])
  // Perfil restrito (ex.: Gerente Adm Comercial/Controladoria): "Somente
  // Novos" não tem nada a ver com o último import CSV do Atualizador Global
  // (módulo que ela nem enxerga) — significa "ainda pendente de custo real",
  // ou seja, algum campo de controladoria/fiscal/precificação = 0 no
  // Supabase (ver localCostGuard.ts: 0 não é mais forçado a 1, é a própria
  // chave de filtro). Perfil admin mantém o critério de sempre (linha nova
  // desde o último import).
  const isRestrictedControladoriaView = !appUser.isAdmin && zeroForceFields.length > 0

  // Mesmo critério do destaque amarelo (linha nova / campo alterado desde o
  // último import, OU pendente de custo real/custo alvo pro perfil
  // restrito), num só lugar — usado tanto pra pintar a linha/célula quanto
  // pra filtrar em "Somente Novos"/"Em processo de alteração de custeio".
  // pendingKind só existe pra accessories/standard_equipment_items
  // (usesTargetCostPending): 'novo' = Admin marcou o checkbox, aguardando a
  // Gerente; 'em_alteracao' = Gerente já sinalizou que imputou o custo,
  // aguardando confirmação oficial via Atualizador Global; null = fora da
  // fila (nem pendente, nem em alteração).
  const getBaselineInfo = useCallback((row: Record<string, unknown>) => {
    if (usesTargetCostPending && !appUser.isAdmin) {
      const code = String(row.protheus_code ?? '').trim().toUpperCase()
      const entry = pendingTargetCost?.[code]
      const pendingKind = entry ? (entry.status === 'em_alteracao' ? 'em_alteracao' : 'novo') : null
      return { isNewRow: pendingKind === 'novo', pendingKind, baselineRow: undefined as Record<string, unknown> | undefined }
    }
    if (isRestrictedControladoriaView) {
      const isNewRow = zeroForceFields.some(f => Number(row[f.name]) === 0)
      return { isNewRow, pendingKind: null, baselineRow: undefined as Record<string, unknown> | undefined }
    }
    const key = getRowKey(schema, row)
    const keyIsAmbiguous = !!baseline?.ambiguousKeys.has(key) || liveDuplicateKeys.has(key)
    const baselineRow = keyIsAmbiguous ? undefined : baseline?.byKey.get(key)
    const isNewRow = baseline !== null && !keyIsAmbiguous && !baselineRow
    return { isNewRow, pendingKind: null, baselineRow }
  }, [baseline, liveDuplicateKeys, schema, isRestrictedControladoriaView, zeroForceFields, usesTargetCostPending, appUser.isAdmin, pendingTargetCost])

  // Rows that pass ALL active column filters (e "Somente Novos", se ligado)
  const filteredRows = useMemo(() => {
    if (!pageData) return []
    let rows = applyFilters(pageData.data, colFilters, listFields, lookups, duplicateCountMaps, localCosts, schema, tableName)
    rows = applyListSortBy(rows, schema.listSortBy, listFields, lookups)
    if (viewMode === 'novos' && (isRestrictedControladoriaView || baseline !== null)) {
      rows = rows.filter(row => getBaselineInfo(row).isNewRow)
    } else if (viewMode === 'em_alteracao' && usesTargetCostPending) {
      rows = rows.filter(row => getBaselineInfo(row).pendingKind === 'em_alteracao')
    }
    return rows
  }, [pageData, colFilters, lookups, listFields, duplicateCountMaps, schema, localCosts, tableName, viewMode, baseline, isRestrictedControladoriaView, usesTargetCostPending, getBaselineInfo])

  // For each column: distinct display values from rows that pass ALL OTHER column filters
  // This gives cascading behavior — each dropdown shows only what's still possible
  const columnOptions = useMemo(() => {
    if (!pageData || !schema.columnFilters) return {} as Record<string, string[]>
    const result: Record<string, string[]> = {}
    for (const field of listFields) {
      const otherFilters = Object.fromEntries(
        Object.entries(colFilters).filter(([name]) => name !== field.name)
      )
      const candidateRows = applyFilters(pageData.data, otherFilters, listFields, lookups, duplicateCountMaps, localCosts, schema, tableName)
      const seen = new Set<string>()
      for (const row of candidateRows) {
        const val = getDisplayValue(row, field.name, field, lookups, listFields, duplicateCountMaps, localCosts, schema, tableName)
        if (val !== '' && val !== 'null' && val !== 'undefined') seen.add(val)
      }
      // N/A first, rest alphabetical
      result[field.name] = Array.from(seen).sort((a, b) => {
        if (a === 'N/A') return -1
        if (b === 'N/A') return 1
        return a.localeCompare(b, 'pt-BR')
      })
    }
    return result
  }, [pageData, colFilters, lookups, listFields, schema, duplicateCountMaps, localCosts, tableName])

  const hasActiveColFilters = Object.values(colFilters).some(v => v.length > 0)

  const handleToggleFilter = useCallback((name: string, val: string) => {
    setColFilters(prev => {
      const cur = prev[name] ?? []
      return { ...prev, [name]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] }
    })
  }, [])

  const handleClearFilter = useCallback((name: string) => {
    setColFilters(prev => ({ ...prev, [name]: [] }))
  }, [])

  const handleSearch = () => setSearch(searchInput)

  const handleExportMatrix = () => {
    exportMatrix(schema.fields, `matriz_${tableName}.xlsx`)
  }

  // null = not connected yet, or the code isn't a registered product in Protheus at all.
  const getProtheusStatus = useCallback((row: Record<string, unknown>): ProtheusProductStatus | null => {
    if (!schema.protheusStatusCheckField || !protheusStatusMap) return null
    const code = String(row[schema.protheusStatusCheckField] ?? '').trim().toUpperCase()
    if (!code) return null
    return protheusStatusMap.get(code) ?? null
  }, [schema.protheusStatusCheckField, protheusStatusMap])

  const checkProtheusStatus = useCallback(async () => {
    if (!protheusCreds) return
    setProtheusChecking(true)
    try {
      const res = await fetch('/api/protheus-produto-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: protheusCreds.user, password: protheusCreds.password }),
      })
      if (!res.ok) return
      const json = await res.json()
      setProtheusStatusMap(new Map(Object.entries(json.statuses as Record<string, ProtheusProductStatus>)))
    } catch {
      // Status flag just stays unverified if this fails — nothing else on the page depends on it.
    } finally {
      setProtheusChecking(false)
    }
  }, [protheusCreds])

  // Runs once the single app-wide Protheus connection (see Sidebar) is
  // available — no per-table connect button anymore.
  useEffect(() => {
    if (!schema.protheusStatusCheckField || !protheusCreds || protheusStatusMap) return
    checkProtheusStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.protheusStatusCheckField, protheusCreds, protheusStatusMap])

  // Compartilhado entre "Exportar dados" (baixa .xlsx) e "Copiar Dados"
  // (copia como texto, sem gerar arquivo nenhum) — os dois mostram exatamente
  // as mesmas colunas/linhas visíveis na tela agora.
  const buildVisibleTableData = () => {
    const includeProtheusFlag = !!schema.protheusStatusCheckField && !!protheusStatusMap
    // View-only columns (e.g. Resumo) never leave this screen — Exportar
    // Matriz/Importar already exclude them via hideInForm; this is the
    // equivalent guard for Exportar dados.
    const exportableFields = listFields.filter(f => !f.excludeFromExport)
    const headers = [
      ...(includeProtheusFlag ? ['Status Protheus'] : []),
      ...exportableFields.map(f => f.label),
    ]
    const rowData = filteredRows.map(row => [
      ...(includeProtheusFlag ? [getProtheusStatus(row) ?? 'Não encontrado'] : []),
      ...exportableFields.map(f => {
        // Colunas financeiras (FORCE_TO_ONE_FIELDS): exporta o valor real
        // (do JSON local) como número de verdade, não texto formatado — só
        // assim o Excel reconhece a célula como numérica.
        if (localCosts && FORCE_TO_ONE_FIELDS.includes(f.name)) {
          const key = getCostItemKey(tableName, schema, row)
          const v = localCosts[key]?.values[f.name]
          if (v !== undefined) return v === null ? '' : v
        }
        return getDisplayValue(row, f.name, f, lookups, listFields, duplicateCountMaps, localCosts, schema, tableName)
      }),
    ])
    return { headers, rowData }
  }

  const handleExportVisible = () => {
    const { headers, rowData } = buildVisibleTableData()
    const safeLabel = schema.label.replace(/[/\\?%*:|"<>]/g, '-')
    exportVisibleData(headers, rowData, `${safeLabel}.xlsx`)
  }

  // "Copiar Dados" — mesmas colunas/linhas de "Exportar dados", só que direto
  // pra área de transferência como texto separado por TAB, pra colar numa
  // planilha já aberta sem precisar baixar e abrir um arquivo .xlsx.
  const handleCopyVisible = () => {
    const { headers, rowData } = buildVisibleTableData()
    const tsv = [headers, ...rowData].map(r => r.join('\t')).join('\n')
    navigator.clipboard.writeText(tsv)
      .then(() => showToast(`${rowData.length} registro${rowData.length !== 1 ? 's' : ''} copiado${rowData.length !== 1 ? 's' : ''} — cole na planilha`))
      .catch(() => showToast('Não foi possível copiar', true))
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportLoading(true)
    try {
      const rows = await parseImportFile(file, schema.fields)
      setImportRows(rows)
      window.dispatchEvent(new CustomEvent('import-review:open'))
    } catch (err) {
      showToast((err as Error).message || 'Erro ao importar arquivo', true)
    } finally {
      setImportLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteId(null)
    const res = await fetch(`/api/${tableName}/${id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('Registro excluído com sucesso')
      fetchData()
      fetchLocalCosts()
    } else {
      const err = await res.json()
      showToast(err.error || 'Erro ao excluir', true)
    }
  }

  const handleBulkDelete = async () => {
    setBulkDeleteOpen(false)
    const ids = Array.from(selectedIds)
    let ok = 0, fail = 0
    await Promise.all(ids.map(async id => {
      const res = await fetch(`/api/${tableName}/${id}`, { method: 'DELETE' })
      res.ok ? ok++ : fail++
    }))
    setSelectedIds(new Set())
    showToast(
      fail === 0
        ? `${ok} registro${ok !== 1 ? 's' : ''} excluído${ok !== 1 ? 's' : ''} com sucesso`
        : `${ok} excluído${ok !== 1 ? 's' : ''}, ${fail} com erro`,
      fail > 0,
    )
    fetchData()
    fetchLocalCosts()
  }

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3500)
  }

  const clearFiltersButton = hasActiveColFilters && (
    <button
      onClick={() => { setColFilters({}); setFilterSearch({}) }}
      className="px-3 py-2 text-sm text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
    >
      ✕ Limpar filtros
    </button>
  )

  const actionButtons = (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {/* Completo/Somente Novos: perfil restrito com colunas de controladoria/
          fiscal/precificação vê o filtro sempre (pendente de custo real não
          depende de import CSV nenhum); perfil admin só quando há um retrato
          de import pra comparar — some junto com o destaque amarelo quando
          não há um. */}
      {(isRestrictedControladoriaView || baseline !== null) && (
        <div className="flex items-center rounded border border-outline-variant overflow-hidden text-xs font-medium shrink-0">
          <button
            onClick={() => setViewMode('completo')}
            title="Mostrar todos os registros"
            className={`px-3 py-2 transition-colors ${viewMode === 'completo' ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            Completo
          </button>
          <button
            onClick={() => setViewMode('novos')}
            title={usesTargetCostPending
              ? 'Mostrar só os registros ainda sem custo alvo aprovado pela Comercial'
              : isRestrictedControladoriaView
                ? 'Mostrar só os registros com algum campo de controladoria/fiscal/precificação ainda em 0 (pendente)'
                : 'Mostrar só os registros criados depois do último import no Atualizador Global'}
            className={`px-3 py-2 border-l border-outline-variant transition-colors ${viewMode === 'novos' ? 'bg-amber-500/15 text-amber-400' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            Somente Novos
          </button>
          {usesTargetCostPending && (
            <button
              onClick={() => setViewMode('em_alteracao')}
              title="Mostrar só os registros que a Comercial já sinalizou como custo imputado, aguardando confirmação oficial via Atualizador Global"
              className={`px-3 py-2 border-l border-outline-variant transition-colors ${viewMode === 'em_alteracao' ? 'bg-blue-500/15 text-blue-400' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
            >
              Em Alteração de Custeio
            </button>
          )}
        </div>
      )}
      {schema.protheusStatusCheckField && (
        protheusStatusMap ? (
          <button
            onClick={checkProtheusStatus}
            disabled={protheusChecking}
            title="Consultar novamente o banco Protheus"
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-green-400 border border-green-500/30 rounded bg-green-500/10 hover:bg-green-500/20 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {protheusChecking ? '⏳ Verificando…' : '✓ Verificado no Protheus'}
          </button>
        ) : protheusCreds ? (
          <span className="text-xs text-outline">⏳ Verificando no Protheus…</span>
        ) : (
          <span className="text-xs text-outline">Conecte ao Protheus (barra lateral) para ver o status ATIVO/BLOQUEADO</span>
        )
      )}
      {/* Edição/exclusão em massa mexem em qualquer campo/registro — ficam
          de fora pra quem não tem canCreateDelete (ver Configuração de
          Usuários). */}
      {schema.bulkEdit && selectedIds.size > 0 && canCreateDelete && (
        <button
          onClick={() => setBulkEditOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-500 transition-colors whitespace-nowrap"
        >
          ✎ Alterar {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
        </button>
      )}
      {selectedIds.size > 0 && canCreateDelete && (
        <button
          onClick={() => setBulkDeleteOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-red-700 text-black rounded text-sm font-semibold hover:bg-red-600 transition-colors whitespace-nowrap"
        >
          🗑 Excluir {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
        </button>
      )}
      <button
        onClick={handleExportVisible}
        disabled={filteredRows.length === 0}
        title={`Exportar ${filteredRows.length} registro${filteredRows.length !== 1 ? 's' : ''} visíveis para Excel`}
        className="flex items-center gap-1.5 px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ↓ Exportar dados
      </button>
      {schema.copyToClipboard && (
        <button
          onClick={handleCopyVisible}
          disabled={filteredRows.length === 0}
          title={`Copiar ${filteredRows.length} registro${filteredRows.length !== 1 ? 's' : ''} visíveis para colar numa planilha`}
          className="flex items-center gap-1.5 px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ⧉ Copiar Dados
        </button>
      )}

      {/* Inserção — manual ou via Excel — só pra quem tem canCreateDelete. */}
      {canCreateDelete && (
      <div className="relative">
      {/* Backdrop to close dropdown on outside click */}
      {newMenuOpen && (
        <div className="fixed inset-0 z-10" onClick={() => setNewMenuOpen(false)} />
      )}

      <button
        onClick={() => {
          if (schema.importExport) { setNewMenuOpen(o => !o); return }
          if (tableName === 'non_combinable_comps') { setNonCombModal(true) }
          else if (tableName === 'dependant_items')  { setDepItemsModal(true) }
          else if (tableName === 'roller_tables')    { setRollerModal(true) }
          else { setEditRecord(null); setModalOpen(true) }
        }}
        className="flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow whitespace-nowrap"
      >
        + Novo Registro
        {schema.importExport && (
          <span className={`text-xs transition-transform duration-150 ${newMenuOpen ? 'rotate-180' : ''}`}>▾</span>
        )}
      </button>

      {/* Dropdown */}
      {schema.importExport && newMenuOpen && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] bg-surface-container-high border border-outline-variant rounded shadow-xl overflow-hidden">
          <button
            onClick={() => {
              setNewMenuOpen(false)
              if (tableName === 'non_combinable_comps') { setNonCombModal(true) }
              else if (tableName === 'dependant_items') { setDepItemsModal(true) }
              else if (tableName === 'roller_tables')   { setRollerModal(true) }
              else { setEditRecord(null); setModalOpen(true) }
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-highest hover:text-primary transition-colors"
          >
            + Novo registro manual
          </button>
          <div className="border-t border-outline-variant/40" />
          <button
            onClick={() => { setNewMenuOpen(false); handleExportMatrix() }}
            className="w-full text-left px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-highest hover:text-primary transition-colors"
          >
            ↓ Exportar Matriz
          </button>
          <button
            onClick={() => { setNewMenuOpen(false); fileInputRef.current?.click() }}
            disabled={importLoading}
            className="w-full text-left px-4 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-highest hover:text-primary transition-colors disabled:opacity-50"
          >
            {importLoading ? '…' : '↑ Importar Excel'}
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportFile}
      />
      </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Frozen header zone — stays pinned below the theme/zoom bar while only the table rows scroll */}
      <div className="sticky top-9 z-20 bg-background pt-2 -mt-2">
        {schema.compactHeader ? (
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end justify-between">
            <div>
              <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">
                {DOMAIN_LABELS[schema.domain]} · {tableName}
              </div>
              <h1 className="text-2xl font-bold text-on-surface">{schema.label}</h1>
              <p className="text-on-surface-variant text-sm mt-1">{schema.description}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {clearFiltersButton}
              {actionButtons}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">
                {DOMAIN_LABELS[schema.domain]} · {tableName}
              </div>
              <h1 className="text-2xl font-bold text-on-surface">{schema.label}</h1>
              <p className="text-on-surface-variant text-sm mt-1">{schema.description}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex gap-2 w-full sm:w-auto flex-wrap">
                <input
                  type="text"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Buscar registros..."
                  className="bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-64 transition-colors"
                />
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
                >
                  Buscar
                </button>
                {search && (
                  <button
                    onClick={() => { setSearch(''); setSearchInput('') }}
                    className="px-3 py-2 text-sm text-outline hover:text-primary transition-colors"
                  >
                    ✕ Limpar
                  </button>
                )}
                {clearFiltersButton}
              </div>
              {actionButtons}
            </div>
          </>
        )}
      </div>

      {isRestrictedControladoriaView && usesTargetCostPending && (
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-outline">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-500/60" />
            registro em amarelo = aguardando custo alvo (Somente Novos)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500/40 border border-blue-500/60" />
            registro em azul = custo já imputado, aguardando confirmação via Atualizador Global (Em Alteração de Custeio)
          </div>
        </div>
      )}
      {isRestrictedControladoriaView && !usesTargetCostPending && (
        <div className="flex items-center gap-1.5 text-[11px] text-outline">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-500/60" />
          registro em amarelo = tem algum campo de controladoria/fiscal/precificação ainda em 0 (pendente)
        </div>
      )}
      {!isRestrictedControladoriaView && baseline !== null && (
        <div className="flex items-center gap-1.5 text-[11px] text-outline">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-500/60" />
          registro/campo em amarelo = criado ou alterado depois do último import no Atualizador Global de Tabelas
        </div>
      )}
      {!isRestrictedControladoriaView && baselineError && (
        <div className="flex items-center gap-1.5 text-[11px] text-error" title={baselineError}>
          ⚠ não foi possível carregar o comparativo de import desta tabela ({baselineError}) — destaque amarelo desligado por ora
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-container rounded border border-outline-variant overflow-hidden min-h-[70vh]">
        {loading && (
          <div className="flex items-center justify-center py-16 text-outline gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono">Carregando...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-16 text-error gap-2 text-sm">
            ⚠ {error}
          </div>
        )}

        {!loading && !error && pageData && (
          <>
            <div className="relative">
              <div ref={scrollRef} onScroll={checkScroll} className="overflow-x-auto">
              <table className={`${schema.compactColumns ? 'min-w-full' : 'w-full'} text-sm`}>
                <thead className="bg-surface-container-highest border-b border-outline-variant">
                  <tr>
                    <th className={`px-3 py-3 w-8 ${schema.columnFilters ? 'align-top' : ''}`}>
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(String(r.id)))}
                        onChange={e => {
                          const ids = filteredRows.map(r => String(r.id))
                          setSelectedIds(e.target.checked ? new Set(ids) : new Set())
                        }}
                      />
                    </th>
                    {[...pinnedListFields, ...(schema.protheusStatusCheckField ? ['__protheus__' as const] : []), ...restListFields].map(entry => {
                      if (entry === '__protheus__') {
                        return (
                          <th
                            key="__protheus__"
                            className="px-3 py-3 w-10 text-center text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono"
                            title="Status do produto (ATIVO/BLOQUEADO) no Protheus"
                          >
                            Protheus
                          </th>
                        )
                      }
                      const f = entry as Field
                      return (
                        <th key={f.name} className={`px-4 py-3 text-left text-[10px] font-semibold text-outline uppercase tracking-[0.12em] whitespace-nowrap font-mono${schema.columnFilters ? ` align-top${f.listKeepWidth ? ' min-w-[150px]' : ' min-w-[100px]'}` : ''}`}>
                          <div>{f.label}</div>
                          {schema.columnFilters && (
                            <div className="mt-1.5">
                              <ColumnFilter
                                searchValue={filterSearch[f.name] ?? ''}
                                onSearchChange={v => setFilterSearch(prev => ({ ...prev, [f.name]: v }))}
                                selectedValues={colFilters[f.name] ?? []}
                                onToggleValue={v => handleToggleFilter(f.name, v)}
                                onClearValues={() => handleClearFilter(f.name)}
                                options={columnOptions[f.name] ?? []}
                                compact={schema.compactColumns && !f.listKeepWidth}
                              />
                            </div>
                          )}
                        </th>
                      )
                    })}
                    <th className="px-4 py-3 text-right text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono whitespace-nowrap sticky right-0 bg-surface-container-highest border-l border-outline-variant/40 z-10">
                      <div>Ações</div>
                      {canScrollRight && (
                        <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-primary/20 border border-primary/30 text-primary text-[9px] font-semibold normal-case tracking-wide animate-pulse">
                          ← rolar
                        </div>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleListFields.length + 2 + (schema.protheusStatusCheckField ? 1 : 0)} className="px-4 py-12 text-center text-outline text-sm">
                        Nenhum registro encontrado
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, i) => {
                      const rowId = String(row.id)
                      const isSelected = selectedIds.has(rowId)
                      // Linha criada depois do último import CSV (não existia no
                      // retrato) — destaque na linha inteira. Só faz sentido
                      // quando a tabela já tem baseline (baseline !== null).
                      const { isNewRow, pendingKind, baselineRow } = getBaselineInfo(row)
                      return (
                      <tr key={rowId || i} className={`hover:bg-surface-container-high transition-colors group ${isSelected ? 'bg-primary/5' : isNewRow ? 'bg-amber-500/10' : pendingKind === 'em_alteracao' ? 'bg-blue-500/10' : ''}`}>
                        <td className="px-3 py-3 w-8">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={isSelected}
                            onChange={e => setSelectedIds(prev => {
                              const next = new Set(prev)
                              e.target.checked ? next.add(rowId) : next.delete(rowId)
                              return next
                            })}
                          />
                        </td>
                        {[...pinnedListFields, ...(schema.protheusStatusCheckField ? ['__protheus__' as const] : []), ...restListFields].map(entry => {
                          if (entry === '__protheus__') {
                            return (
                              <td key="__protheus__" className="px-3 py-3 text-center">
                                {(() => {
                                  const status = getProtheusStatus(row)
                                  if (status === null) {
                                    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-outline-variant" title="Conecte ao Protheus para verificar (botão acima da tabela) — ou o código não é um produto registrado lá" />
                                  }
                                  return status === 'ATIVO'
                                    ? <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" title="ATIVO no Protheus" />
                                    : <span className="inline-block w-3 h-3 rounded-full bg-[#ff0000] shadow-[0_0_6px_rgba(255,0,0,0.7)]" title="BLOQUEADO no Protheus" />
                                })()}
                              </td>
                            )
                          }
                          const f = entry as Field
                          let cell: React.ReactNode
                          const localCostValue = localCosts !== null && FORCE_TO_ONE_FIELDS.includes(f.name)
                            ? localCosts[getCostItemKey(tableName, schema, row)]?.values[f.name]
                            : undefined
                          if (localCostValue !== undefined) {
                            // Coluna financeira com valor real capturado localmente (Supabase
                            // tem 1, por sigilo) — mostra o valor real no lugar, somente
                            // leitura. Editar só é permitido pelo botão "Editar" (RecordModal),
                            // nunca na célula. Sem captura local, cai no valor bruto do
                            // Supabase mais abaixo — hoje sempre 0 (cadastro ainda sem custo
                            // real definido, a "chave" de filtro pra Controladoria/Fiscal/
                            // Precificação — ver localCostGuard.ts), não é segredo.
                            cell = <LocalCostCell value={localCostValue} />
                          } else if (f.countDuplicatesOf) {
                            const text = getDisplayValue(row, f.name, f, lookups, listFields, duplicateCountMaps) || '—'
                            cell = <span className={text === '1' ? 'text-green-500 font-semibold' : 'text-error font-semibold'}>{text}</span>
                          } else if ((f.lookupFrom && lookups[f.name]) || f.concatFrom) {
                            const text = getDisplayValue(row, f.name, f, lookups, listFields, duplicateCountMaps) || '—'
                            cell = f.listExpand
                              ? <TruncatedCell text={text} maxLen={14} />
                              : <span title={text.length > 50 ? text : undefined}>{text}</span>
                          } else {
                            cell = <CellValue value={row[f.name]} type={f.type} />
                          }
                          // Campo pontual editado depois do último import CSV —
                          // só a célula fica amarela (não a linha inteira, que já
                          // está tratada acima se o registro for novo).
                          const fieldChanged = !isNewRow && !!baselineRow &&
                            shouldCompareField(f) && !valuesEqual(f, row[f.name], baselineRow[f.name])
                          return (
                            <td key={f.name} className={`px-4 py-3 text-on-surface-variant whitespace-nowrap${schema.columnFilters ? f.listKeepWidth ? ' min-w-[150px]' : ' min-w-[100px]' : ''}${fieldChanged ? ' bg-amber-500/15' : ''}`}>
                              {cell}
                            </td>
                          )
                        })}
                        {/* sticky (fica por cima do conteúdo da linha ao rolar horizontal) precisa
                            de fundo OPACO — uma cor com /alpha deixa o texto das outras colunas
                            transparecer por baixo, dando a impressão de texto sobreposto/fantasma. */}
                        <td className={`px-4 py-3 text-right whitespace-nowrap sticky right-0 transition-colors border-l border-outline-variant/40 z-10 ${isSelected ? 'bg-primary-container group-hover:bg-primary-container' : isNewRow ? 'bg-amber-950 group-hover:bg-amber-900' : pendingKind === 'em_alteracao' ? 'bg-blue-950 group-hover:bg-blue-900' : 'bg-surface-container group-hover:bg-surface-container-high'}`}>
                          {usesTargetCostPending && !appUser.isAdmin && pendingKind === 'novo' && (
                            <button
                              onClick={() => handleSignalCostImputed(String(row.protheus_code ?? ''))}
                              disabled={signalingCode === String(row.protheus_code ?? '').trim().toUpperCase()}
                              title="Sinaliza que o custo alvo já foi imputado — sai de Somente Novos e entra em Em Alteração de Custeio até ser confirmado via Atualizador Global"
                              className="text-blue-400 hover:text-blue-300 text-xs font-medium mr-3 transition-colors disabled:opacity-50"
                            >
                              ✓ Custo Imputado
                            </button>
                          )}
                          <button
                            onClick={() => { setEditRecord(row); setModalOpen(true) }}
                            className="text-outline hover:text-primary text-xs font-medium mr-3 transition-colors"
                          >
                            Editar
                          </button>
                          {canCreateDelete && (
                            <button
                              onClick={() => setDeleteId(String(row.id))}
                              className="text-outline hover:text-error text-xs font-medium transition-colors"
                            >
                              Excluir
                            </button>
                          )}
                        </td>
                      </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
              </div>
              {/* Fade gradient — visible only when table can scroll right */}
              {canScrollRight && (
                <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-surface-container via-surface-container/70 to-transparent z-[5]" />
              )}
            </div>

            {/* Record count */}
            <div className="px-4 py-3 border-t border-outline-variant/30 text-xs text-outline font-mono">
              {filteredRows.length < pageData.data.length
                ? <>{filteredRows.length} de {pageData.total} registro{pageData.total !== 1 ? 's' : ''} <span className="text-primary">· filtrado</span></>
                : <>{pageData.total} registro{pageData.total !== 1 ? 's' : ''}{search && <span className="ml-1 text-primary">· busca ativa</span>}</>
              }
            </div>
          </>
        )}
      </div>

      {/* Bulk delete confirmation */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl p-6 w-full max-w-sm animate-fade-in">
            <h3 className="text-base font-semibold text-on-surface mb-2">⚠ Confirmar exclusão em massa</h3>
            <p className="text-on-surface-variant text-sm mb-6">
              Você está prestes a excluir <span className="text-error font-semibold">{selectedIds.size} registro{selectedIds.size !== 1 ? 's' : ''}</span>. Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setBulkDeleteOpen(false)}
                className="px-4 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 text-sm bg-error text-on-error rounded font-semibold hover:opacity-90 transition-opacity"
              >
                Excluir {selectedIds.size} registro{selectedIds.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk edit modal */}
      {bulkEditOpen && (
        <BulkEditModal
          schema={schema}
          tableName={tableName}
          selectedIds={Array.from(selectedIds)}
          onClose={() => setBulkEditOpen(false)}
          onSaved={(ok, fail) => {
            setBulkEditOpen(false)
            setSelectedIds(new Set())
            fetchData()
            fetchLocalCosts()
            showToast(
              fail === 0
                ? `${ok} registro${ok !== 1 ? 's' : ''} atualizado${ok !== 1 ? 's' : ''} com sucesso`
                : `${ok} atualizado${ok !== 1 ? 's' : ''}, ${fail} com erro`,
              fail > 0,
            )
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl p-6 w-full max-w-sm animate-fade-in">
            <h3 className="text-base font-semibold text-on-surface mb-2">⚠ Confirmar exclusão</h3>
            <p className="text-on-surface-variant text-sm mb-6">
              Esta ação não pode ser desfeita. Deseja excluir o registro?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-outline transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="px-4 py-2 text-sm bg-error-container text-on-error-container rounded hover:brightness-110 font-medium transition-all"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dependent items custom modal */}
      {depItemsModal && (
        <DependentItemsModal
          onClose={() => setDepItemsModal(false)}
          onSaved={count => {
            setDepItemsModal(false)
            fetchData()
            fetchLocalCosts()
            showToast(`${count} registros inseridos!`)
          }}
        />
      )}

      {/* Roller table custom modal */}
      {rollerModal && (
        <RollerTableModal
          onClose={() => setRollerModal(false)}
          onSaved={count => {
            setRollerModal(false)
            fetchData()
            fetchLocalCosts()
            showToast(`${count} registros inseridos!`)
          }}
        />
      )}

      {/* Non-combinable custom modal */}
      {nonCombModal && (
        <NonCombinableModal
          onClose={() => setNonCombModal(false)}
          onSaved={count => {
            setNonCombModal(false)
            fetchData()
            fetchLocalCosts()
            showToast(`${count} registros inseridos!`)
          }}
        />
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <RecordModal
          schema={schema}
          tableName={tableName}
          record={editRecord}
          restrictToFields={restrictedFieldNames}
          onClose={() => { setModalOpen(false); setEditRecord(null) }}
          onSaved={() => {
            setModalOpen(false)
            setEditRecord(null)
            fetchData()
            fetchLocalCosts()
            showToast(editRecord ? 'Registro atualizado!' : 'Registro criado!')
          }}
        />
      )}

      {importRows && (
        <ImportReviewModal
          schema={schema}
          tableName={tableName}
          initialRows={importRows}
          onClose={() => { setImportRows(null); window.dispatchEvent(new CustomEvent('import-review:close')) }}
          onDone={saved => {
            setImportRows(null)
            window.dispatchEvent(new CustomEvent('import-review:close'))
            fetchData()
            fetchLocalCosts()
            showToast(`${saved} registro${saved !== 1 ? 's' : ''} importado${saved !== 1 ? 's' : ''} com sucesso!`)
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-lg shadow-lg text-sm animate-fade-in border ${
          toast.isError
            ? 'bg-error-container border-error/30 text-on-error-container'
            : 'bg-surface-container-highest border-outline-variant text-on-surface'
        }`}>
          {toast.isError ? '✕' : '✓'} {toast.msg}
        </div>
      )}
    </div>
  )
}

// Coluna financeira (ex.: Custo (R$)) na própria tela de Cadastro — o
// Supabase sempre tem 1 aí (sigilo, ver FORCE_TO_ONE_FIELDS); esta célula só
// mostra o valor real capturado do CSV, guardado só localmente. Somente
// leitura — editar exige clicar em "Editar" e usar o formulário (RecordModal),
// nunca direto na célula da lista.
function LocalCostCell({ value }: { value: number | null }) {
  return (
    <span
      title="Valor real, guardado só localmente — o Supabase mantém 1 por sigilo. Edite pelo botão 'Editar'."
      className={`text-xs font-mono px-1.5 py-0.5 rounded border ${
        value === null
          ? 'text-outline border-outline-variant/50'
          : 'text-amber-400 border-amber-500/30 bg-amber-500/10'
      }`}
    >
      {value === null ? 'N/A' : value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
    </span>
  )
}

function TruncatedCell({ text, maxLen = 32 }: { text: string; maxLen?: number }) {
  const [open, setOpen] = useState(false)
  if (text.length <= maxLen) return <span>{text}</span>
  return (
    <span className="inline-flex items-start gap-1">
      <span className="break-words whitespace-normal">{open ? text : text.slice(0, maxLen) + '…'}</span>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title={open ? 'Recolher' : 'Ver completo'}
        className="shrink-0 mt-0.5 text-[9px] text-outline hover:text-primary border border-outline-variant/50 hover:border-primary/40 rounded px-1 py-0.5 leading-none transition-colors"
      >
        {open ? '▲' : '▼'}
      </button>
    </span>
  )
}

function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined || value === 'null') {
    return <span className="text-outline text-xs font-mono">N/A</span>
  }
  if (type === 'boolean') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono ${
        value
          ? 'bg-green-900/40 text-green-400 border border-green-800/40'
          : 'bg-surface-container-highest text-outline border border-outline-variant'
      }`}>
        {value ? 'Sim' : 'Não'}
      </span>
    )
  }
  if (type === 'jsonb') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface-container-highest text-outline text-xs font-mono border border-outline-variant">
        JSON
      </span>
    )
  }
  if (type === 'select') {
    const colors: Record<string, string> = {
      active:   'bg-green-900/40 text-green-400 border-green-800/40',
      deactive: 'bg-surface-container-highest text-outline border-outline-variant',
      draft:    'bg-primary/10 text-primary border-primary/20',
      sent:     'bg-blue-900/40 text-blue-400 border-blue-800/40',
      approved: 'bg-green-900/40 text-green-400 border-green-800/40',
      rejected: 'bg-error-container/40 text-error border-error/20',
      admin:    'bg-purple-900/40 text-purple-400 border-purple-800/40',
      user:     'bg-surface-container-highest text-outline border-outline-variant',
    }
    const cls = colors[String(value)] || 'bg-surface-container-highest text-outline border-outline-variant'
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono border ${cls}`}>
        {String(value)}
      </span>
    )
  }
  if (type === 'timestamp') {
    return <span className="text-outline text-xs font-mono">{new Date(String(value)).toLocaleString('pt-BR')}</span>
  }
  if (type === 'uuid') {
    return <span className="font-mono text-xs text-outline">{String(value).slice(0, 8)}…</span>
  }
  const str = String(value)
  return <span title={str.length > 50 ? str : undefined}>{str.length > 50 ? str.slice(0, 50) + '…' : str}</span>
}
