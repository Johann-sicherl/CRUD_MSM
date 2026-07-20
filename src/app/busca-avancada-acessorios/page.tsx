'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { classifyEquipmentType, type EquipmentClassificationRule } from '@/lib/equipmentClassification'
import { idbGet, idbSet } from '@/lib/idbStore'

const STORAGE_KEY = 'busca-avancada-acessorios-state'
const UNCLASSIFIED_GROUP = 'Não classificado'
const DEFAULT_HEADER_PREFIXES = '26'
const DEFAULT_CHILD_PREFIXES = '26, 27.13'

interface AccessoryStructureGroup {
  estrutura: string
  descEstrutura: string
  children: { codigo: string; denominacao: string }[]
}

function Badge({ tone, children }: { tone: 'error' | 'success' | 'outline'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'text-error border-error/30 bg-error-container/20'
    : tone === 'success'
    ? 'text-green-400 border-green-500/40 bg-green-500/10'
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
  const [childPrefixInput, setChildPrefixInput] = useState(DEFAULT_CHILD_PREFIXES)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [rawGroups, setRawGroups] = useState<AccessoryStructureGroup[]>([])
  const [hasScanned, setHasScanned] = useState(false)

  const [classificationRules, setClassificationRules] = useState<EquipmentClassificationRule[]>([])
  const [registeredCodes, setRegisteredCodes] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [equipFilter, setEquipFilter] = useState('')

  const hydrated = useRef(false)

  // Restore the last scan when returning to this page, same reasoning as
  // Busc. Itens Série Estrut.: losing a bulk-scan result on every navigation
  // would force redoing an expensive Protheus query for no reason.
  useEffect(() => {
    (async () => {
      try {
        const stored = await idbGet<{ rawGroups: AccessoryStructureGroup[]; headerPrefixInput: string; childPrefixInput: string; hasScanned: boolean }>(STORAGE_KEY)
        if (stored) {
          setRawGroups(stored.rawGroups || [])
          setHeaderPrefixInput(stored.headerPrefixInput || DEFAULT_HEADER_PREFIXES)
          setChildPrefixInput(stored.childPrefixInput || DEFAULT_CHILD_PREFIXES)
          setHasScanned(!!stored.hasScanned)
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
    idbSet(STORAGE_KEY, { rawGroups, headerPrefixInput, childPrefixInput, hasScanned }).catch(() => {})
  }, [rawGroups, headerPrefixInput, childPrefixInput, hasScanned])

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
  // accessories — matching how this tool is meant to be used (an accessory
  // code found via Protheus could turn out to already be registered as
  // either an accessory or, less commonly, as an equipment item).
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
    const childPrefixes = childPrefixInput.split(',').map(p => p.trim()).filter(Boolean)
    if (headerPrefixes.length === 0) { setScanError('Informe ao menos um prefixo de estrutura'); return }

    setScanning(true)
    setScanError('')
    try {
      const res = await fetch('/api/protheus-acessorios-por-equipamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: dbCreds.user, password: dbCreds.password, headerPrefixes, childPrefixes }),
      })
      const json = await res.json()
      if (!res.ok) { setScanError(json.error || 'Falha ao consultar o banco Protheus'); return }
      setRawGroups(json.groups || [])
      setHasScanned(true)
      setExpandedGroups(new Set())
      setEquipFilter('')
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
  // analysis), then flattens every header's children into one list per
  // equipamento group, tagging each with its registration status.
  const groupedByEquip = useMemo(() => {
    const map = new Map<string, { codigo: string; denominacao: string; estrutura: string; registered: boolean }[]>()
    for (const g of rawGroups) {
      const equipType = classifyEquipmentType(g.descEstrutura, classificationRules) || UNCLASSIFIED_GROUP
      const bucket = map.get(equipType) || []
      for (const c of g.children) {
        bucket.push({
          codigo: c.codigo,
          denominacao: c.denominacao,
          estrutura: g.estrutura,
          registered: registeredCodes.has(c.codigo.trim().toUpperCase()),
        })
      }
      map.set(equipType, bucket)
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNCLASSIFIED_GROUP) return 1
      if (b === UNCLASSIFIED_GROUP) return -1
      return a.localeCompare(b, 'pt-BR')
    })
  }, [rawGroups, classificationRules, registeredCodes])

  const displayedGroups = equipFilter
    ? groupedByEquip.filter(([name]) => name === equipFilter)
    : groupedByEquip

  return (
    <div className="p-8 max-w-[108rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · busc. avançada acessórios
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Busc. Avançada Acessórios</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Varre todo cabeçalho de estrutura no Protheus com o prefixo informado, classifica cada um por tipo de
          equipamento usando as mesmas regras de{' '}
          <a href="/parametros-estrutura" className="text-primary hover:underline">Classificação de Equipamentos</a>
          {' '}(aplicadas sobre DESC_ESTRUTURA), e lista os itens diretos de cada estrutura que combinem com o
          prefixo de acessório informado, verificando se já estão cadastrados no MSM (Cadastro de Equipamentos ou
          Cadastro de Componentes) — nada é ocultado por não estar cadastrado.
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
          Prefixo(s) de estrutura
          <input
            type="text"
            value={headerPrefixInput}
            onChange={e => setHeaderPrefixInput(e.target.value)}
            placeholder="ex: 26"
            className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-48"
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
          Prefixo(s) de acessório (nível 2)
          <input
            type="text"
            value={childPrefixInput}
            onChange={e => setChildPrefixInput(e.target.value)}
            placeholder="ex: 26, 27.13"
            className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-56"
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
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm text-on-surface-variant">Filtrar por equipamento:</span>
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
      )}

      {!hasScanned ? (
        <div className="text-sm text-outline italic">Nenhuma busca realizada ainda.</div>
      ) : groupedByEquip.length === 0 ? (
        <div className="text-sm text-outline italic">
          Nenhuma estrutura encontrada com esse(s) prefixo(s), ou nenhum item de nível 2 combinou com o prefixo de
          acessório informado.
        </div>
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
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Cód. Acessório</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Denominação</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Estrutura de Origem</th>
                          <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Cadastro</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={`${item.estrutura}-${item.codigo}-${i}`} className="border-t border-outline-variant/50">
                            <td className="px-3 py-2 font-mono text-primary whitespace-nowrap">{item.codigo}</td>
                            <td className="px-3 py-2 text-on-surface">{item.denominacao || '—'}</td>
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
