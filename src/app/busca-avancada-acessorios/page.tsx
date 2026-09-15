'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { classifyEquipmentType, type EquipmentClassificationRule } from '@/lib/equipmentClassification'
import { idbGet, idbSet } from '@/lib/idbStore'
import ColumnFilter from '@/components/ColumnFilter'
import RecordModal from '@/components/RecordModal'
import { tables } from '@/lib/schema'
import { useProtheusAuth } from '@/lib/protheusAuthContext'
import type { IgnoredAccessory } from '@/lib/ignoredAccessories'

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

// Pedido explícito do usuário: a Lista de acessórios nunca deve mostrar
// essas categorias estruturais/intermediárias — só o resíduo "ACESSÓRIO"
// (peça de verdade, não uma categoria de agrupamento da árvore Protheus).
const EXCLUDED_CATEGORIES = new Set<AccessoryCategory>([
  'SUBPA', 'EQUIPAMENTO', 'GASTOS GERAIS', 'EMBALAGENS', 'ADESIVOS', 'SPARE PARTS', 'CABOS',
])

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

// Selo "Cadastrado/Não cadastrado no MSM" + botão "+ Cadastrar" pra linhas
// ainda não cadastradas — abre a mesma janela "Novo — Cadastro de
// Componentes" (com a fila de inserção em lote) já preenchida com o código
// e a denominação do Protheus encontrados aqui, igual ao "+ Adicionar ao
// banco" de Busc. Itens Série Estrut., só que pra accessories.
function RegistrationBadge({
  registered, codigo, denominacao, onAdd,
}: {
  registered: boolean
  codigo: string
  denominacao: string
  onAdd: (codigo: string, denominacao: string) => void
}) {
  if (registered) return <Badge tone="success">Cadastrado no MSM</Badge>
  return (
    <div className="flex items-center gap-1.5">
      <Badge tone="error">Não cadastrado no MSM</Badge>
      <button
        onClick={e => { e.stopPropagation(); onAdd(codigo, denominacao) }}
        title="Abre o cadastro de um novo item em Cadastro de Componentes já preenchido com código e denominação"
        className="px-2 py-0.5 text-[11px] font-semibold text-primary border border-primary/40 rounded hover:bg-primary/10 transition-colors whitespace-nowrap"
      >
        + Cadastrar
      </button>
    </div>
  )
}

// Checkbox "Ignorar" por linha — marca o componente como "nunca vou usar":
// grava (só código + denominação) em ignored-accessories.json e some da
// listagem a partir daí (busca atual e futuras), até ser removido em Parâm.
// Itens de Série e Acessórios. Sempre desmarcado: uma vez marcado, o item
// deixa de existir nesta tela, então não há estado "marcado" pra mostrar.
function IgnoreCheckbox({ onIgnore }: { onIgnore: () => void }) {
  return (
    <input
      type="checkbox"
      checked={false}
      onChange={onIgnore}
      title="Marcar como indesejado — some desta lista (revisável em Parâm. Itens de Série e Acessórios)"
      className="w-4 h-4 cursor-pointer accent-error"
    />
  )
}

// ─── Filtro avançado — só Código e Denominação ──────────────────────────
// Mesmo padrão "rascunho + Aplicar/Cancelar" do Filtro avançado em Busc.
// Itens Série Estrut., simplificado: sem os campos de item de série (não se
// aplicam a acessório) — apenas Código (multi-seleção) e busca livre na
// denominação (DESC_ESTRUTURA/DESCRICAO_PRODUTO), com o mesmo "+" para
// exigir mais de uma palavra.
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
              Selecione os valores desejados e clique em Aplicar.
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
  // Single app-wide Protheus connection (see Sidebar) — this page no longer
  // has its own connect/disconnect button or login modal.
  const { creds: dbCreds, openPrompt: openProtheusPrompt } = useProtheusAuth()

  const [headerPrefixInput, setHeaderPrefixInput] = useState(DEFAULT_HEADER_PREFIXES)
  const [nivel2PrefixInput, setNivel2PrefixInput] = useState(DEFAULT_NIVEL2_PREFIXES)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [rawGroups, setRawGroups] = useState<AccessoryHierarchyGroup[]>([])
  const [hasScanned, setHasScanned] = useState(false)

  const [classificationRules, setClassificationRules] = useState<EquipmentClassificationRule[]>([])
  const [registeredCodes, setRegisteredCodes] = useState<Set<string>>(new Set())
  const [ignoredList, setIgnoredList] = useState<IgnoredAccessory[]>([])
  // "+ Cadastrar" (linha a linha, item ainda não cadastrado): abre a mesma
  // janela "Novo — Cadastro de Componentes" (com a fila de inserção em lote
  // já disponível lá), prefiltrada com o código e a denominação do Protheus
  // encontrados aqui — mesma ideia do "+ Adicionar ao banco" de Busc. Itens
  // Série Estrut., só que pra accessories em vez de standard_equipment_items.
  const [addModalPrefill, setAddModalPrefill] = useState<Record<string, string> | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [equipFilter, setEquipFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false)
  const [advancedCodeFilter, setAdvancedCodeFilter] = useState<string[]>([])
  const [advancedDescSearch, setAdvancedDescSearch] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  // Mesmo chaveamento de Busc. Itens Série Estrut. Protheus
  // (showOnlyMissingFromInternal, analisador-estruturas/page.tsx) — pedido
  // explícito do usuário. Reseta a cada nova busca, mesmo tratamento de
  // equipFilter/categoryFilter/advancedFilter abaixo.
  const [showOnlyMissing, setShowOnlyMissing] = useState(false)

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
  // "cadastrado no MSM" if it exists em EITHER standard_equipment_items OR
  // accessories — an item found here could turn out to already be
  // registered as either an accessory or, less commonly, as an equipment.
  // Extraído em função nomeada pra poder rodar de novo depois de cadastrar
  // um componente novo pelo botão "+ Cadastrar" (ver addModalPrefill),
  // sem precisar recarregar a página inteira.
  const loadRegisteredCodes = async () => {
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
  }

  useEffect(() => { loadRegisteredCodes() }, [])

  // Espelha ignoredList de forma síncrona — clicar em vários checkboxes em
  // sequência rápida chama markIgnored várias vezes antes do React
  // re-renderizar entre um clique e outro; ler `ignoredList` (estado, só
  // atualiza no próximo render) faria cada chamada montar o próximo array a
  // partir do MESMO snapshot antigo, e só a última chamada "vencia" —
  // achado real: marcar vários itens seguidos, todos sumiam da tela (o
  // filtro usa o estado mais recente de qualquer jeito), mas só o último
  // realmente ia pro arquivo. Ref é atualizada na hora, sem esperar
  // re-render, então cada chamada acumula em cima da anterior de verdade.
  const ignoredListRef = useRef<IgnoredAccessory[]>([])

  // Enquanto nenhum clique local aconteceu ainda, o GET inicial (abaixo)
  // pode terminar tarde e sobrescrever ignoredListRef/ignoredList — mas se
  // o usuário já clicou em algo ANTES desse GET responder (ex.: clicou
  // muito rápido logo após a página abrir), a resposta do GET (mais
  // antiga que o clique) não pode mais "vencer" e apagar o que já foi
  // marcado localmente.
  const hasLocalWriteRef = useRef(false)

  // Lista de componentes marcados como "nunca vou usar" (Parâm. Itens de
  // Série e Acessórios) — some da listagem a partir daqui.
  useEffect(() => {
    fetch('/api/ignored-accessories')
      .then(r => r.json())
      .then(list => {
        if (hasLocalWriteRef.current) return
        const arr = Array.isArray(list) ? list : []
        setIgnoredList(arr)
        ignoredListRef.current = arr
      })
      .catch(() => {})
  }, [])

  const ignoredCodes = useMemo(
    () => new Set(ignoredList.map(i => i.codigo.trim().toUpperCase())),
    [ignoredList],
  )

  // Fila de gravação: cada PUT só é disparado depois do anterior terminar,
  // nunca em paralelo. Achado real (2ª rodada, o fix só com ref não bastou):
  // marcar vários itens rápido disparava vários PUT quase simultâneos, sem
  // ordem garantida de CHEGADA no servidor (só de envio) — o request com a
  // lista mais curta podia chegar (e escrever) DEPOIS do mais completo,
  // apagando marcações anteriores mesmo com o ref já correto no cliente.
  // Serializar elimina isso: nunca há dois PUT em voo ao mesmo tempo.
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())

  const persistIgnoredList = (list: IgnoredAccessory[]) => {
    writeQueueRef.current = writeQueueRef.current
      .catch(() => {})
      .then(() => fetch('/api/ignored-accessories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list),
      }))
      .then(res => { if (!res.ok) throw new Error('Falha ao salvar') })
      .catch(() =>
        fetch('/api/ignored-accessories')
          .then(r => r.json())
          .then(arr => {
            const clean = Array.isArray(arr) ? arr : []
            ignoredListRef.current = clean
            setIgnoredList(clean)
          })
          .catch(() => {})
      )
  }

  // Grava (otimista) e persiste — só código e denominação, nunca outra
  // informação do item.
  const markIgnored = (codigo: string, denominacao: string) => {
    hasLocalWriteRef.current = true
    const norm = codigo.trim().toUpperCase()
    if (ignoredListRef.current.some(i => i.codigo.trim().toUpperCase() === norm)) return
    const next = [...ignoredListRef.current, { codigo: codigo.trim(), denominacao: denominacao.trim() }]
    ignoredListRef.current = next
    setIgnoredList(next)
    persistIgnoredList(next)
  }

  // "+ Cadastrar" numa linha ainda não cadastrada — prefila protheus_code
  // com o código e name com a denominação encontrados aqui.
  const openAddModal = (codigo: string, denominacao: string) => {
    setAddModalPrefill({ protheus_code: codigo, name: denominacao })
  }

  const runScan = async () => {
    if (!dbCreds) { openProtheusPrompt(); return }
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
      setEquipFilter('')
      setCategoryFilter('')
      setShowOnlyMissing(false)
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
    setEquipFilter('')
    setCategoryFilter('')
    setShowOnlyMissing(false)
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
        if (ignoredCodes.has(r.codigo.trim().toUpperCase())) continue
        const { categoria, isUps } = classifyAccessoryRow(r.codigo, r.denominacao)
        if (EXCLUDED_CATEGORIES.has(categoria)) continue
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
  }, [rawGroups, classificationRules, registeredCodes, ignoredCodes])

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
  // "Só o que falta no meu banco" (showOnlyMissing) entra junto.
  const filteredFlatItems = useMemo(
    () => flatItems.filter(i =>
      (!showOnlyMissing || !i.registered) &&
      matchesAdvancedFilter(i.codigo, i.denominacao, advancedCodeFilter, advancedDescSearch)
    ),
    [flatItems, showOnlyMissing, advancedCodeFilter, advancedDescSearch],
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

  // Filtro avançado ativo? Só usado pra destacar (bg-primary/10) a linha
  // que bateu no filtro dentro do grupo já filtrado — não muda mais QUAIS
  // grupos aparecem (isso já é feito por displayedGroups/filteredFlatItems).
  const hasActiveAdvancedFilter = advancedCodeFilter.length > 0 || !!advancedDescSearch.trim()

  // "Copiar lista" — mesma ideia do botão já usado em Auditoria (copia como
  // texto separado por TAB, para colar direto numa planilha do Excel).
  // Segue exatamente o que está sendo exibido no momento (já passou pelos
  // filtros de Equipamento/Categoria/Filtro avançado).
  const copyHeader = ['Equipamento', 'Código', 'Denominação', 'Qtd Total', 'Categoria', 'Cadastro no MSM']

  const copyRows: string[][] = dedupedGroups.flatMap(([equipType, items]) =>
    items.map(item => [
      equipType, item.codigo, item.denominacao || '', String(item.qtdTotal), item.categoria,
      item.registered ? 'Cadastrado no MSM' : 'Não cadastrado no MSM',
    ])
  )

  const handleCopyList = () => {
    if (copyRows.length === 0) return
    const tsv = [copyHeader, ...copyRows].map(r => r.join('\t')).join('\n')
    navigator.clipboard.writeText(tsv)
      .then(() => setCopyFeedback(`${copyRows.length} linha${copyRows.length !== 1 ? 's' : ''} copiada${copyRows.length !== 1 ? 's' : ''} — cole no Excel`))
      .catch(() => setCopyFeedback('Não foi possível copiar'))
    setTimeout(() => setCopyFeedback(''), 2500)
  }

  // Applying "Filtro avançado" auto-expands whatever groups it left
  // standing — otherwise the match would be sitting inside a box that's
  // still collapsed by default, defeating the point of filtering.
  useEffect(() => {
    if (!hasActiveAdvancedFilter) return
    setExpandedGroups(new Set(groupedByEquip.map(([name]) => name)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedCodeFilter, advancedDescSearch])

  return (
    <div className="p-8 max-w-[108rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Consulta Banco de Dados · busc. avanc. acessórios protheus
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Busc. Avanc. Acessórios Protheus</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Varre todo cabeçalho de estrutura no Protheus com o prefixo de NIVEL 1 informado (nunca listado
          diretamente), classifica cada um por tipo de equipamento usando as mesmas regras de{' '}
          <a href="/parametros-estrutura" className="text-primary hover:underline">Classificação de Equipamentos</a>
          {' '}(aplicadas sobre DESC_ESTRUTURA), e explora todos os itens de NIVEL 2 dessa estrutura — só abrindo
          para NIVEL 3 (o próprio equipamento e seus acessórios) os itens de nível 2 que combinem com o prefixo de
          NIVEL 2 informado. A lista mostra só a categoria &quot;ACESSÓRIO&quot; (a peça de verdade) — SubPA,
          Equipamento, Gastos Gerais, Embalagens, Adesivos, Spare Parts e Cabos são categorias estruturais da
          árvore Protheus, não componentes pra cadastrar, e ficam sempre fora da lista. Cada item que aparece ganha
          um texto dizendo se já está cadastrado no MSM (Cadastro de Equipamentos ou Cadastro de Componentes) —
          nada some por não estar cadastrado — mas você pode marcar &quot;Ignorar&quot; num componente que sabe
          que nunca vai usar: ele some desta lista (nesta busca e nas próximas) e pode ser revisto/removido em
          {' '}<a href="/parametros-estrutura" className="text-primary hover:underline">Parâm. Itens de Série e Acessórios</a>.
        </p>
      </div>

      <div className="mb-1 flex items-center gap-3 flex-wrap">
        {dbCreds ? (
          <Badge tone="success">Conectado ao Protheus</Badge>
        ) : (
          <p className="text-xs text-outline">Conecte ao Protheus (barra lateral) para escanear as estruturas.</p>
        )}
      </div>
      {dbCreds && (
        <p className="text-xs text-outline mb-5">
          A primeira busca carrega a tabela ESTRUTURAS inteira para a memória (pode levar até 1–2 min); as buscas
          seguintes usam esse cache e ficam quase instantâneas.
        </p>
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
      {addModalPrefill && (
        <RecordModal
          schema={tables.accessories}
          tableName="accessories"
          record={null}
          prefill={addModalPrefill}
          onClose={() => setAddModalPrefill(null)}
          onSaved={() => { setAddModalPrefill(null); loadRegisteredCodes() }}
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
              onClick={() => setShowOnlyMissing(v => !v)}
              role="switch"
              aria-checked={showOnlyMissing}
              title="Alterna entre ver tudo ou só o que está no Protheus e ainda não está cadastrado no MSM"
              className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors shrink-0 ${
                showOnlyMissing ? 'bg-primary' : 'bg-surface-container-highest border border-outline-variant'
              }`}
            >
              <span
                className={`inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform ${
                  showOnlyMissing ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-sm font-semibold ${showOnlyMissing ? 'text-outline' : 'text-primary'}`}>
              Consulta completa
            </span>
            <span className="text-outline">/</span>
            <span className={`text-sm font-semibold ${showOnlyMissing ? 'text-primary' : 'text-outline'}`}>
              Só o que falta no meu banco
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
          <button
            onClick={() => setAdvancedFilterOpen(true)}
            title="Filtra os componentes exibidos por Código ou por texto na Denominação"
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
          <button
            onClick={handleCopyList}
            disabled={copyRows.length === 0}
            title="Copia os itens exibidos (com os filtros aplicados) para colar direto no Excel"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-surface-container-low border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⧉ Copiar lista ({copyRows.length})
          </button>
          {copyFeedback && <span className="text-xs text-green-400">{copyFeedback}</span>}
        </div>
      )}

      {!hasScanned ? (
        <div className="text-sm text-outline italic">Nenhuma busca realizada ainda.</div>
      ) : groupedByEquip.length === 0 ? (
        <div className="text-sm text-outline italic">
          Nenhuma estrutura encontrada com esse(s) prefixo(s).
        </div>
      ) : displayedGroups.length === 0 ? (
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
                          <th className="text-center px-3 py-2 font-semibold text-on-surface-variant" title="Marcar componente como indesejado">Ignorar</th>
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
                              <RegistrationBadge
                                registered={item.registered}
                                codigo={item.codigo}
                                denominacao={item.denominacao}
                                onAdd={openAddModal}
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <IgnoreCheckbox onIgnore={() => markIgnored(item.codigo, item.denominacao)} />
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
      )}
    </div>
  )
}
