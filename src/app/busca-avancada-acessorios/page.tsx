'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { classifyEquipmentType, type EquipmentClassificationRule } from '@/lib/equipmentClassification'
import { idbGet, idbSet } from '@/lib/idbStore'

const STORAGE_KEY = 'busca-avancada-acessorios-state'
const UNCLASSIFIED_GROUP = 'Não classificado'
const DEFAULT_HEADER_PREFIXES = '26'

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

interface FlatItem {
  estrutura: string
  descEstrutura: string
  equipType: string
  nivel: 2 | 3
  codigo: string
  denominacao: string
  qtd: number
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

export default function BuscaAvancadaAcessoriosPage() {
  const [dbCreds, setDbCreds] = useState<{ user: string; password: string } | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [connecting, setConnecting] = useState(false)

  const [headerPrefixInput, setHeaderPrefixInput] = useState(DEFAULT_HEADER_PREFIXES)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [rawGroups, setRawGroups] = useState<AccessoryHierarchyGroup[]>([])
  const [hasScanned, setHasScanned] = useState(false)

  const [classificationRules, setClassificationRules] = useState<EquipmentClassificationRule[]>([])
  const [registeredCodes, setRegisteredCodes] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [equipFilter, setEquipFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const hydrated = useRef(false)

  // Restore the last scan when returning to this page, same reasoning as
  // Busc. Itens Série Estrut.: losing a bulk-scan result on every navigation
  // would force redoing an expensive Protheus query for no reason.
  useEffect(() => {
    (async () => {
      try {
        const stored = await idbGet<{ rawGroups: AccessoryHierarchyGroup[]; headerPrefixInput: string; hasScanned: boolean }>(STORAGE_KEY)
        if (stored) {
          // Discard anything saved by an earlier version of this page whose
          // AccessoryHierarchyGroup shape doesn't match the current one
          // (e.g. the old "children" field instead of "rows") — otherwise
          // a stale cached result crashes the page instead of just being
          // treated as "no scan yet".
          const validGroups = Array.isArray(stored.rawGroups) && stored.rawGroups.every(g => Array.isArray(g?.rows))
          setRawGroups(validGroups ? stored.rawGroups : [])
          setHeaderPrefixInput(stored.headerPrefixInput || DEFAULT_HEADER_PREFIXES)
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
    idbSet(STORAGE_KEY, { rawGroups, headerPrefixInput, hasScanned }).catch(() => {})
  }, [rawGroups, headerPrefixInput, hasScanned])

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
    if (headerPrefixes.length === 0) { setScanError('Informe ao menos um prefixo de estrutura'); return }

    setScanning(true)
    setScanError('')
    try {
      const res = await fetch('/api/protheus-acessorios-por-equipamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: dbCreds.user, password: dbCreds.password, headerPrefixes }),
      })
      const json = await res.json()
      if (!res.ok) { setScanError(json.error || 'Falha ao consultar o banco Protheus'); return }
      setRawGroups(json.groups || [])
      setHasScanned(true)
      setExpandedGroups(new Set())
      setEquipFilter('')
      setCategoryFilter('')
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
      for (const r of g.rows) {
        const { categoria, isUps } = classifyAccessoryRow(r.codigo, r.denominacao)
        out.push({
          estrutura: g.estrutura,
          descEstrutura: g.descEstrutura,
          equipType,
          nivel: r.nivel,
          codigo: r.codigo,
          denominacao: r.denominacao,
          qtd: r.qtd,
          codPaiDireto: r.codPaiDireto,
          categoria,
          isUps,
          registered: registeredCodes.has(r.codigo.trim().toUpperCase()),
        })
      }
    }
    return out
  }, [rawGroups, classificationRules, registeredCodes])

  const groupedByEquip = useMemo(() => {
    const map = new Map<string, FlatItem[]>()
    for (const item of flatItems) {
      const bucket = map.get(item.equipType)
      if (bucket) bucket.push(item)
      else map.set(item.equipType, [item])
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNCLASSIFIED_GROUP) return 1
      if (b === UNCLASSIFIED_GROUP) return -1
      return a.localeCompare(b, 'pt-BR')
    })
  }, [flatItems])

  const categoriesPresent = useMemo(
    () => Array.from(new Set(flatItems.map(i => i.categoria))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [flatItems],
  )

  const displayedGroups = groupedByEquip
    .filter(([name]) => !equipFilter || name === equipFilter)
    .map(([name, items]) => [name, items.filter(i => !categoryFilter || i.categoria === categoryFilter)] as const)
    .filter(([, items]) => items.length > 0)

  return (
    <div className="p-8 max-w-[108rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · busc. avançada acessórios
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Busc. Avançada Acessórios</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Varre todo cabeçalho de estrutura no Protheus com o prefixo informado (NIVEL 1 — nunca listado
          diretamente), classifica cada um por tipo de equipamento usando as mesmas regras de{' '}
          <a href="/parametros-estrutura" className="text-primary hover:underline">Classificação de Equipamentos</a>
          {' '}(aplicadas sobre DESC_ESTRUTURA), e lista todos os itens de NIVEL 2 e NIVEL 3 dessa estrutura — SubPA,
          Embalagens, Gastos Gerais, o próprio equipamento e seus acessórios — cada um com a categoria (regras
          herdadas da macro VBA original) e se já está cadastrado no MSM (Cadastro de Equipamentos ou Cadastro de
          Componentes). Nada é ocultado por não estar cadastrado.
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
          {displayedGroups.map(([equipType, items]) => {
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
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Nível</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Código</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Denominação</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Qtd</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Cód. Pai Direto</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Categoria</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Estrutura de Origem</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Cadastro</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={`${item.estrutura}-${item.codPaiDireto}-${item.codigo}-${i}`} className="border-t border-outline-variant/50">
                            <td className="px-3 py-2 text-outline">{item.nivel}</td>
                            <td className="px-3 py-2 font-mono text-primary whitespace-nowrap">{item.codigo}</td>
                            <td className="px-3 py-2 text-on-surface">{item.denominacao || '—'}</td>
                            <td className="px-3 py-2 text-on-surface">{item.qtd}</td>
                            <td className="px-3 py-2 font-mono text-outline whitespace-nowrap">{item.codPaiDireto}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className="text-on-surface-variant font-semibold">{item.categoria}</span>
                              {item.isUps && <span className="ml-1.5"><Badge tone="amber">UPS</Badge></span>}
                            </td>
                            <td className="px-3 py-2 font-mono text-outline whitespace-nowrap">{item.estrutura}</td>
                            <td className="px-3 py-2">
                              {item.registered
                                ? <Badge tone="success">Cadastrado no MSM</Badge>
                                : <Badge tone="error">Não cadastrado no MSM</Badge>}
                            </td>
                          </tr>
                        ))}
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
