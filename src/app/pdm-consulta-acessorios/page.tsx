'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'
import { usePdmAuth } from '@/lib/pdmAuthContext'
import { tables } from '@/lib/schema'
import { exportVisibleData } from '@/lib/importExport'
import RecordModal from '@/components/RecordModal'
import ColumnFilter from '@/components/ColumnFilter'
import type { PdmAccessoryRow } from '@/lib/pdmDb'
import type { PdmPropertyRow } from '@/lib/pdmProperties'
import { PDM_FIELD_MAP, comparePdmWithSupabase, displayText, pdmRowToPrefill, findPreviousRevision, type PdmComparisonRow } from '@/lib/pdmCompare'

// Tipo de arquivo do PDM (Vault) por ExtensionID — mesma convenção da query
// (ver pdmDb.ts): 3 = desenho, 4 = montagem, 5 = peça.
const EXTENSION_LABEL: Record<number, string> = { 3: 'Desenho', 4: 'Montagem', 5: 'Peça' }

const PROPERTY_COLUMNS: { key: keyof PdmPropertyRow; label: string }[] = [
  { key: 'filename', label: 'Arquivo' },
  { key: 'codigo', label: 'Código' },
  { key: 'denominacao', label: 'Denominação' },
  { key: 'revisao', label: 'Revisão' },
  { key: 'material', label: 'Material' },
  { key: 'tratamento', label: 'Tratamento' },
  { key: 'peso', label: 'Peso' },
  { key: 'areaSup', label: 'Área Sup.' },
  { key: 'espessura', label: 'Espessura' },
  { key: 'custoSw', label: 'Custo SW' },
  { key: 'maquina', label: 'Máquina' },
  { key: 'grupo', label: 'Grupo' },
  { key: 'projetadoPor', label: 'Projetado por' },
  { key: 'desenhadoPor', label: 'Desenhado por' },
  { key: 'aprovadoPor', label: 'Aprovado por' },
]

// Compara o catálogo de Cadastro de Componentes (banco de dados MSM) com o
// que está validado no PDM (AC_VALIDADO = 'S') — tela exclusiva do perfil
// Administrador (ver Sidebar.tsx e o guard abaixo). Consulta automaticamente
// ao abrir, desde que já conectado ao PDM (ver pdmAuthContext.tsx).
//
// Três estados de linha:
//  - normal: código existe nos dois, todos os campos batem.
//  - vermelho na CÉLULA: código existe nos dois, mas aquele campo diverge —
//    "Editar" abre o mesmo formulário de Cadastro de Componentes.
//  - vermelho esmaecido na LINHA: existe no PDM, não existe no banco MSM —
//    "+ Cadastrar" abre o mesmo formulário já pré-preenchido com os dados do PDM.
//  - cinza esmaecido na LINHA, sem interação: existe no banco MSM, não veio
//    na consulta ao PDM — só um lembrete visual do que falta inserir lá.

const STATUS_LABEL: Record<PdmComparisonRow['status'], string> = {
  ok: 'OK',
  mismatch: 'Divergente',
  'pdm-only': 'Só no PDM',
  'supabase-only': 'Só no Banco MSM',
}

function resolveGroupName(rawId: unknown, groupNames: Map<number, string>): string {
  const n = rawId === null || rawId === undefined ? NaN : Number(String(rawId).trim())
  if (Number.isNaN(n)) return '—'
  return groupNames.get(n) ?? `#${n}`
}

interface ColumnDef {
  key: string
  label: string
  getValue: (row: PdmComparisonRow) => string
}

function buildColumns(groupNames: Map<number, string>): ColumnDef[] {
  return [
    { key: 'status', label: 'Status', getValue: row => STATUS_LABEL[row.status] },
    { key: 'grupo', label: 'Grupo', getValue: row =>
      resolveGroupName(row.status === 'supabase-only' ? row.supabaseRow.legacy_group_id : row.pdm.idGrupo, groupNames) },
    { key: 'protheus_code', label: 'Código Protheus', getValue: row => row.protheusCode },
    ...PDM_FIELD_MAP.filter(f => f.supabaseField !== 'legacy_group_id').map(f => ({
      key: f.supabaseField,
      label: f.label,
      getValue: (row: PdmComparisonRow) => row.status === 'supabase-only' ? displayText(row.supabaseRow[f.supabaseField]) : displayText(row.pdm[f.pdmKey]),
    })),
  ]
}

export default function PdmConsultaAcessoriosPage() {
  const { user } = useAppAuth()
  const { creds: pdmCreds, openPrompt: openPdmPrompt } = usePdmAuth()

  const [pdmRows, setPdmRows] = useState<PdmAccessoryRow[] | null>(null)
  const [supabaseRows, setSupabaseRows] = useState<Record<string, unknown>[] | null>(null)
  const [groupNames, setGroupNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null)
  const [createPrefill, setCreatePrefill] = useState<Record<string, string> | null>(null)
  const [revisionCandidate, setRevisionCandidate] = useState<{ oldCode: string; newCode: string; prefill: Record<string, string> } | null>(null)
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [filterSearch, setFilterSearch] = useState<Record<string, string>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // Painel de propriedades expansível por linha (ver PROPERTY_COLUMNS acima)
  // — busca sob demanda na primeira vez que a linha é aberta, depois fica em
  // cache por código Protheus pro resto da sessão (a lista de componentes só
  // muda numa nova consulta, que já limpa este cache junto).
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const [propsByCode, setPropsByCode] = useState<Record<string, PdmPropertyRow[]>>({})
  const [propsLoading, setPropsLoading] = useState<Record<string, boolean>>({})
  const [propsError, setPropsError] = useState<Record<string, string>>({})

  // Pop-up "incluir PDM?" ao clicar em Exportar dados / Copiar Dados — ver
  // runExportOrCopy abaixo. bulkFetchProgress != null enquanto busca as
  // propriedades de cada linha uma a uma (sequencial, pra não sobrecarregar
  // o SQL Server do PDM com dezenas de consultas recursivas em paralelo).
  const [exportChoiceOpen, setExportChoiceOpen] = useState<'export' | 'copy' | null>(null)
  const [bulkFetchProgress, setBulkFetchProgress] = useState<{ done: number; total: number } | null>(null)

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchDbSide = useCallback(async () => {
    const [accRes, groupsRes] = await Promise.all([
      fetch('/api/accessories?limit=25000'),
      fetch('/api/accessory_groups?limit=1000'),
    ])
    const accJson = await accRes.json()
    const groupsJson = await groupsRes.json()
    if (!accRes.ok) throw new Error(accJson.error || 'Falha ao carregar Cadastro de Componentes')
    if (!groupsRes.ok) throw new Error(groupsJson.error || 'Falha ao carregar Grupo de Acessórios')
    setSupabaseRows(accJson.data || [])
    const names = new Map<number, string>()
    for (const g of (groupsJson.data || []) as { legacy_id: number; name: string }[]) names.set(g.legacy_id, g.name)
    setGroupNames(names)
  }, [])

  const runQuery = useCallback(async (creds: { user: string; password: string }) => {
    setLoading(true)
    setError('')
    setExpandedCode(null)
    setPropsByCode({})
    setPropsError({})
    try {
      const [pdmRes] = await Promise.all([
        fetch('/api/pdm-consulta-acessorios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: creds.user, password: creds.password }),
        }),
        fetchDbSide(),
      ])
      const pdmJson = await pdmRes.json()
      if (!pdmRes.ok) { setError(pdmJson.error || 'Falha ao consultar o banco PDM'); return }
      setPdmRows(pdmJson.rows || [])
    } catch {
      setError('Erro de comunicação com o banco PDM')
    } finally {
      setLoading(false)
    }
  }, [fetchDbSide])

  // Consulta sozinha ao abrir a tela, sem precisar clicar em nada — se ainda
  // não houver conexão ao PDM, abre o pop-up (o mesmo oferecido automaticamente
  // logo após conectar ao Protheus); assim que a conexão existir, dispara a
  // consulta uma única vez.
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (!pdmCreds) { openPdmPrompt(); return }
    if (autoRanRef.current) return
    autoRanRef.current = true
    runQuery(pdmCreds)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdmCreds])

  const comparison = useMemo<PdmComparisonRow[] | null>(() => {
    if (!pdmRows || !supabaseRows) return null
    return comparePdmWithSupabase(pdmRows, supabaseRows)
  }, [pdmRows, supabaseRows])

  const columns = useMemo(() => buildColumns(groupNames), [groupNames])

  // Códigos já cadastrados no banco MSM — usado pra achar, entre eles, uma
  // revisão anterior do mesmo desenho de um item só-no-PDM (ver
  // findPreviousRevision em pdmCompare.ts e o botão "Substituir revisão" abaixo).
  const supabaseCodes = useMemo(
    () => (supabaseRows ?? []).map(r => String(r.protheus_code ?? '')).filter(Boolean),
    [supabaseRows]
  )

  // Mesmo estilo "Excel" do resto do app: as opções de CADA coluna já
  // consideram os filtros ativos das OUTRAS colunas, mas nunca o dela mesma.
  const columnOptions = useMemo(() => {
    if (!comparison) return {} as Record<string, string[]>
    const result: Record<string, string[]> = {}
    for (const col of columns) {
      const otherActive = Object.entries(colFilters).filter(([k, v]) => k !== col.key && v.length > 0)
      const candidateRows = comparison.filter(row =>
        otherActive.every(([k, vals]) => {
          const c = columns.find(cc => cc.key === k)
          return c ? vals.includes(c.getValue(row)) : true
        })
      )
      const seen = new Set<string>()
      for (const row of candidateRows) {
        const v = col.getValue(row)
        if (v && v !== '—') seen.add(v)
      }
      result[col.key] = Array.from(seen).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    }
    return result
  }, [comparison, columns, colFilters])

  const filteredComparison = useMemo(() => {
    if (!comparison) return null
    const active = Object.entries(colFilters).filter(([, v]) => v.length > 0)
    if (active.length === 0) return comparison
    return comparison.filter(row =>
      active.every(([k, vals]) => {
        const c = columns.find(cc => cc.key === k)
        return c ? vals.includes(c.getValue(row)) : true
      })
    )
  }, [comparison, colFilters, columns])

  // Aviso visual (gradiente na borda direita) de que há mais colunas pra ver
  // rolando a tabela — mesmo mecanismo de DataTable.tsx.
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
  }, [filteredComparison, checkScroll])

  const handleToggleFilter = useCallback((key: string, val: string) => {
    setColFilters(prev => {
      const cur = prev[key] ?? []
      return { ...prev, [key]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] }
    })
  }, [])
  const handleClearFilter = useCallback((key: string) => {
    setColFilters(prev => ({ ...prev, [key]: [] }))
  }, [])
  const hasActiveColFilters = Object.values(colFilters).some(v => v.length > 0)

  // Expande/recolhe o painel de propriedades de uma linha. Peça (sem
  // sub-itens) ou montagem (traz a estrutura inteira) — ver
  // src/lib/pdmProperties.ts. Sem PDM associado (linha "só no Banco MSM",
  // cinza) não tem o que buscar.
  const togglePropertiesRow = useCallback((row: PdmComparisonRow) => {
    if (row.status === 'supabase-only') return
    const code = row.protheusCode
    if (expandedCode === code) { setExpandedCode(null); return }
    setExpandedCode(code)
    if (propsByCode[code] || propsLoading[code] || !pdmCreds) return
    setPropsLoading(prev => ({ ...prev, [code]: true }))
    setPropsError(prev => ({ ...prev, [code]: '' }))
    fetch('/api/pdm-component-properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: pdmCreds.user, password: pdmCreds.password, documentId: row.pdm.documentId }),
    })
      .then(async res => ({ ok: res.ok, json: await res.json().catch(() => ({})) }))
      .then(({ ok, json }) => {
        if (!ok) { setPropsError(prev => ({ ...prev, [code]: json.error || 'Falha ao buscar propriedades' })); return }
        setPropsByCode(prev => ({ ...prev, [code]: json.rows || [] }))
      })
      .catch(() => setPropsError(prev => ({ ...prev, [code]: 'Erro de comunicação com o banco PDM' })))
      .finally(() => setPropsLoading(prev => ({ ...prev, [code]: false })))
  }, [expandedCode, propsByCode, propsLoading, pdmCreds])

  const counts = useMemo(() => {
    if (!comparison) return null
    return {
      ok: comparison.filter(r => r.status === 'ok').length,
      mismatch: comparison.filter(r => r.status === 'mismatch').length,
      pdmOnly: comparison.filter(r => r.status === 'pdm-only').length,
      dbOnly: comparison.filter(r => r.status === 'supabase-only').length,
    }
  }, [comparison])

  const buildExportData = () => {
    const rows = filteredComparison ?? []
    return { headers: columns.map(c => c.label), rowData: rows.map(row => columns.map(c => c.getValue(row))) }
  }

  const copyTsv = (headers: string[], rowData: string[][]) => {
    const tsv = [headers, ...rowData].map(r => r.join('\t')).join('\n')
    navigator.clipboard.writeText(tsv)
      .then(() => showToast(`${rowData.length} linha${rowData.length !== 1 ? 's' : ''} copiada${rowData.length !== 1 ? 's' : ''} — cole na planilha`))
      .catch(() => showToast('Não foi possível copiar', true))
  }

  // Monta a versão "com PDM": uma linha por item da estrutura de cada
  // componente (a peça/montagem em si +, se for montagem, cada item dela —
  // ver PROPERTY_COLUMNS/togglePropertiesRow), repetindo as colunas normais
  // da tela em cada uma. Busca sequencialmente (uma consulta recursiva de
  // cada vez no PDM) e reaproveita o que já estiver em cache de expansões
  // manuais — só busca de novo o que ainda não foi aberto na tela.
  const buildExportDataWithPdmProperties = async (): Promise<{ headers: string[]; rowData: string[][] } | null> => {
    if (!pdmCreds) { showToast('Conecte ao PDM primeiro', true); return null }
    const rows = filteredComparison ?? []
    const cache = { ...propsByCode }
    let hadError = false
    setBulkFetchProgress({ done: 0, total: rows.length })

    const headers = [
      ...columns.map(c => c.label),
      'PDM Nível', 'PDM Tipo',
      ...PROPERTY_COLUMNS.map(pc => `PDM ${pc.label}`),
    ]
    const blankProps = () => ['—', '—', ...PROPERTY_COLUMNS.map(() => '—')]
    const outRows: string[][] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const baseValues = columns.map(c => c.getValue(row))
      if (row.status === 'supabase-only') {
        outRows.push([...baseValues, ...blankProps()])
      } else {
        let propRows = cache[row.protheusCode]
        if (!propRows) {
          try {
            const res = await fetch('/api/pdm-component-properties', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user: pdmCreds.user, password: pdmCreds.password, documentId: row.pdm.documentId }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Falha ao buscar propriedades')
            propRows = (json.rows || []) as PdmPropertyRow[]
            cache[row.protheusCode] = propRows
          } catch {
            hadError = true
            propRows = []
          }
        }
        if (propRows.length === 0) {
          outRows.push([...baseValues, ...blankProps()])
        } else {
          for (const pRow of propRows) {
            outRows.push([
              ...baseValues,
              String(pRow.level),
              (pRow.extensionId !== null ? EXTENSION_LABEL[pRow.extensionId] : undefined) ?? '—',
              ...PROPERTY_COLUMNS.map(pc => (pRow[pc.key] as string | null) ?? '—'),
            ])
          }
        }
      }
      setBulkFetchProgress({ done: i + 1, total: rows.length })
    }

    setPropsByCode(cache)
    setBulkFetchProgress(null)
    if (hadError) showToast('Algumas propriedades não puderam ser buscadas — linhas marcadas com "—"', true)
    return { headers, rowData: outRows }
  }

  const runExportOrCopy = async (mode: 'export' | 'copy', withPdm: boolean) => {
    setExportChoiceOpen(null)
    if (!withPdm) {
      const { headers, rowData } = buildExportData()
      if (mode === 'export') await exportVisibleData(headers, rowData, 'Consulta_PDM_x_Banco_MSM.xlsx')
      else copyTsv(headers, rowData)
      return
    }
    const result = await buildExportDataWithPdmProperties()
    if (!result) return
    if (mode === 'export') await exportVisibleData(result.headers, result.rowData, 'Consulta_PDM_x_Banco_MSM_com_Propriedades_BOM.xlsx')
    else copyTsv(result.headers, result.rowData)
  }

  if (!user.isAdmin) {
    return (
      <div className="p-8">
        <div className="bg-error-container/20 border border-error/30 text-error rounded-lg px-5 py-4 text-sm">
          Acesso restrito a administradores.
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Consulta Banco de Dados · consulta pdm x banco msm
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Consulta PDM x Banco MSM</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Traz os itens validados no PDM (base VMI) e compara com o que está gravado em Cadastro de Componentes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          onClick={() => pdmCreds ? runQuery(pdmCreds) : openPdmPrompt()}
          disabled={loading}
          className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
        >
          {loading ? 'Consultando...' : comparison ? 'Atualizar consulta' : pdmCreds ? 'Consultar PDM' : 'Conectar e consultar PDM'}
        </button>
        {comparison && (
          <>
            <button
              onClick={() => setExportChoiceOpen('export')}
              disabled={filteredComparison?.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
            >
              ↓ Exportar dados
            </button>
            <button
              onClick={() => setExportChoiceOpen('copy')}
              disabled={filteredComparison?.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
            >
              ⧉ Copiar Dados
            </button>
            {hasActiveColFilters && (
              <button
                onClick={() => { setColFilters({}); setFilterSearch({}) }}
                className="text-xs text-outline hover:text-primary transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </>
        )}
        {counts && (
          <div className="flex items-center gap-2 text-xs font-mono ml-auto">
            <span className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant">{counts.ok} ok</span>
            <span className="px-2 py-1 rounded border border-error/30 bg-error/10 text-error">{counts.mismatch} divergente{counts.mismatch !== 1 ? 's' : ''}</span>
            <span className="px-2 py-1 rounded border border-error/30 bg-error/10 text-error">{counts.pdmOnly} só no PDM</span>
            <span className="px-2 py-1 rounded border border-outline-variant text-outline">{counts.dbOnly} só no Banco MSM</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-error-container/30 text-error text-sm px-4 py-3 rounded border border-error/20 mb-4">
          ⚠ {error}
        </div>
      )}

      {loading && !comparison && (
        <div className="text-sm text-on-surface-variant">Consultando o banco PDM...</div>
      )}

      {filteredComparison && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant mb-3">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-error/15 border border-error/30 inline-block" /> célula divergente</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-error/10 border border-error/30 inline-block" /> só existe no PDM — falta cadastrar</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-surface-container-highest border border-outline-variant inline-block opacity-60" /> só existe no Banco MSM — falta inserir no PDM</span>
          </div>

          <div className="relative border border-outline-variant rounded-lg bg-surface-container-low">
          <div ref={scrollRef} onScroll={checkScroll} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-highest text-left text-xs text-outline uppercase tracking-wide">
                  <th className="px-2 py-2 w-8" aria-label="Expandir propriedades" />
                  {columns.map(col => (
                    <th key={col.key} className="px-4 py-2 align-top min-w-[130px]">
                      <div className="font-semibold mb-1.5 normal-case tracking-normal text-[11px]">{col.label}</div>
                      <ColumnFilter
                        searchValue={filterSearch[col.key] ?? ''}
                        onSearchChange={v => setFilterSearch(prev => ({ ...prev, [col.key]: v }))}
                        selectedValues={colFilters[col.key] ?? []}
                        onToggleValue={v => handleToggleFilter(col.key, v)}
                        onClearValues={() => handleClearFilter(col.key)}
                        options={columnOptions[col.key] ?? []}
                      />
                    </th>
                  ))}
                  <th className="px-4 py-2 whitespace-nowrap text-right align-top sticky right-0 bg-surface-container-highest border-l border-outline-variant/40 z-10">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {filteredComparison.map(row => {
                  const isGhost = row.status === 'supabase-only'
                  const isPdmOnly = row.status === 'pdm-only'
                  const diffFieldSet = row.status === 'ok' || row.status === 'mismatch'
                    ? new Set(row.diffs.map(d => d.supabaseField))
                    : new Set<string>()
                  // Componente com código de revisão (ex.: 34.01.10040.01) cuja
                  // revisão anterior (34.01.10040.00) já está cadastrada — troca
                  // o "+ Cadastrar" por "Substituir revisão" nessa linha.
                  const prevRevision = isPdmOnly ? findPreviousRevision(row.protheusCode, supabaseCodes) : null
                  const isExpanded = expandedCode === row.protheusCode

                  return (
                    <Fragment key={`${row.status}-${row.protheusCode}`}>
                    <tr
                      className={
                        isGhost ? 'opacity-50 pointer-events-none bg-surface-container-highest'
                        : isPdmOnly ? 'bg-error/10'
                        : 'hover:bg-surface-container-high transition-colors'
                      }
                    >
                      <td className="px-2 py-2.5 text-center">
                        {!isGhost && (
                          <button
                            onClick={() => togglePropertiesRow(row)}
                            title="Ver propriedades no PDM"
                            className="text-outline hover:text-primary transition-colors w-5 h-5 inline-flex items-center justify-center"
                          >
                            {isExpanded ? '▾' : '▸'}
                          </button>
                        )}
                      </td>
                      {columns.map(col => {
                        if (col.key === 'status') {
                          return (
                            <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                row.status === 'ok' ? 'text-on-surface-variant border-outline-variant'
                                : row.status === 'mismatch' ? 'text-error border-error/30 bg-error/10'
                                : row.status === 'pdm-only' ? 'text-error border-error/30 bg-error/10'
                                : 'text-outline border-outline-variant'
                              }`}>
                                {STATUS_LABEL[row.status]}
                              </span>
                            </td>
                          )
                        }
                        if (col.key === 'protheus_code') {
                          return <td key={col.key} className="px-4 py-2.5 font-mono text-on-surface whitespace-nowrap">{row.protheusCode}</td>
                        }
                        const isDiff = diffFieldSet.has(col.key)
                        return (
                          <td key={col.key} className={`px-4 py-2.5 text-on-surface-variant whitespace-nowrap ${isDiff ? 'bg-error/15' : ''}`}
                            title={isDiff && row.status === 'mismatch' ? `Banco MSM: ${displayText(row.supabaseRow[col.key])}` : undefined}
                          >
                            {col.getValue(row)}
                          </td>
                        )
                      })}
                      <td className={`px-4 py-2.5 text-right whitespace-nowrap sticky right-0 border-l border-outline-variant/40 z-10 ${
                        isGhost ? 'bg-surface-container-highest' : isPdmOnly ? 'bg-error-container' : 'bg-surface-container-low'
                      }`}>
                        {isPdmOnly && prevRevision && (
                          <button
                            onClick={() => setRevisionCandidate({ oldCode: prevRevision, newCode: row.protheusCode, prefill: pdmRowToPrefill(row.pdm) })}
                            title={`Revisão anterior encontrada no banco MSM: ${prevRevision}`}
                            className="text-on-error-container hover:opacity-80 text-xs font-semibold transition-opacity"
                          >
                            ↻ Substituir revisão
                          </button>
                        )}
                        {isPdmOnly && !prevRevision && (
                          <button
                            onClick={() => setCreatePrefill(pdmRowToPrefill(row.pdm))}
                            className="text-on-error-container hover:opacity-80 text-xs font-semibold transition-opacity"
                          >
                            + Cadastrar
                          </button>
                        )}
                        {isGhost && <span className="text-outline text-xs font-medium">Ausente no PDM</span>}
                        {(row.status === 'ok' || row.status === 'mismatch') && (
                          <button
                            onClick={() => setEditRecord(row.supabaseRow)}
                            className="text-outline hover:text-primary text-xs font-medium transition-colors"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={columns.length + 2} className="px-4 py-3 bg-surface-container-high border-b border-outline-variant/40">
                          {propsLoading[row.protheusCode] ? (
                            <div className="text-xs text-outline font-mono">Buscando propriedades no PDM...</div>
                          ) : propsError[row.protheusCode] ? (
                            <div className="text-xs text-error">⚠ {propsError[row.protheusCode]}</div>
                          ) : (propsByCode[row.protheusCode]?.length ?? 0) === 0 ? (
                            <div className="text-xs text-outline font-mono">Nenhuma propriedade encontrada no PDM para este documento.</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="text-xs border border-outline-variant/60 rounded overflow-hidden">
                                <thead>
                                  <tr className="bg-surface-container-highest text-outline uppercase tracking-wide text-left">
                                    <th className="px-3 py-1.5 font-semibold whitespace-nowrap">Nível</th>
                                    <th className="px-3 py-1.5 font-semibold whitespace-nowrap">Tipo</th>
                                    {PROPERTY_COLUMNS.map(pc => (
                                      <th key={pc.key} className="px-3 py-1.5 font-semibold whitespace-nowrap">{pc.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-outline-variant/30">
                                  {propsByCode[row.protheusCode].map(pRow => (
                                    <tr key={pRow.documentId} className={pRow.level === 0 ? 'bg-surface-container-highest/60 font-medium' : undefined}>
                                      <td className="px-3 py-1.5 whitespace-nowrap text-on-surface-variant">{pRow.level}</td>
                                      <td className="px-3 py-1.5 whitespace-nowrap text-on-surface-variant">
                                        {(pRow.extensionId !== null && EXTENSION_LABEL[pRow.extensionId]) ?? '—'}
                                      </td>
                                      {PROPERTY_COLUMNS.map(pc => (
                                        <td key={pc.key} className="px-3 py-1.5 whitespace-nowrap text-on-surface-variant">
                                          {(pRow[pc.key] as string | null) ?? '—'}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Fade gradient — avisa que dá pra rolar pra ver mais colunas */}
          {canScrollRight && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-surface-container-low via-surface-container-low/70 to-transparent z-[5]" />
          )}
          </div>

          <div className="text-xs text-outline font-mono mt-2">
            {filteredComparison.length < (comparison?.length ?? 0)
              ? <>{filteredComparison.length} de {comparison?.length} registros <span className="text-primary">· filtrado</span></>
              : <>{comparison?.length} registros</>}
          </div>
        </>
      )}

      {editRecord && (
        <RecordModal
          schema={tables.accessories}
          tableName="accessories"
          record={editRecord}
          onClose={() => setEditRecord(null)}
          onSaved={() => { setEditRecord(null); fetchDbSide() }}
        />
      )}

      {createPrefill && (
        <RecordModal
          schema={tables.accessories}
          tableName="accessories"
          prefill={createPrefill}
          onClose={() => setCreatePrefill(null)}
          onSaved={() => { setCreatePrefill(null); fetchDbSide() }}
        />
      )}

      {revisionCandidate && (
        <RevisionReplaceModal
          oldCode={revisionCandidate.oldCode}
          newCode={revisionCandidate.newCode}
          prefill={revisionCandidate.prefill}
          onClose={() => setRevisionCandidate(null)}
          onCreateAsNew={() => { setCreatePrefill(revisionCandidate.prefill); setRevisionCandidate(null) }}
          onReplaced={() => {
            showToast(`Substituído: ${revisionCandidate.oldCode} → ${revisionCandidate.newCode}`)
            setRevisionCandidate(null)
            fetchDbSide()
          }}
        />
      )}

      {exportChoiceOpen && !bulkFetchProgress && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setExportChoiceOpen(null)}
        >
          <div
            className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-outline-variant">
              <h3 className="text-base font-semibold text-on-surface">
                {exportChoiceOpen === 'export' ? 'Exportar dados' : 'Copiar dados'} — incluir PDM?
              </h3>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <p className="text-sm text-on-surface-variant">
                Quer incluir, pra cada componente, as propriedades e a estrutura (BOM) completa dele no PDM? Uma
                montagem traz uma linha por item da estrutura — o resultado fica bem maior.
              </p>
              <button
                onClick={() => runExportOrCopy(exportChoiceOpen, false)}
                className="w-full text-left px-4 py-3 bg-surface-container-low border border-outline-variant rounded hover:border-primary transition-colors"
              >
                <span className="block text-sm font-semibold text-on-surface">Não, só os dados desta tela</span>
                <span className="block text-xs text-outline mt-0.5">Mesmas colunas que já aparecem na tabela</span>
              </button>
              <button
                onClick={() => runExportOrCopy(exportChoiceOpen, true)}
                className="w-full text-left px-4 py-3 bg-surface-container-low border border-outline-variant rounded hover:border-primary transition-colors"
              >
                <span className="block text-sm font-semibold text-on-surface">Sim, incluir propriedades e BOM do PDM</span>
                <span className="block text-xs text-outline mt-0.5">Busca no PDM a estrutura completa de cada componente — pode demorar um pouco</span>
              </button>
            </div>
            <div className="px-5 py-3 border-t border-outline-variant flex justify-end">
              <button onClick={() => setExportChoiceOpen(null)} className="text-sm text-outline hover:text-on-surface transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkFetchProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-sm p-5 flex flex-col gap-3 animate-fade-in">
            <div className="text-sm font-semibold text-on-surface">Buscando propriedades no PDM...</div>
            <div className="w-full h-2 bg-surface-container-highest rounded overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(bulkFetchProgress.done / Math.max(1, bulkFetchProgress.total)) * 100}%` }}
              />
            </div>
            <div className="text-xs text-outline font-mono">{bulkFetchProgress.done} / {bulkFetchProgress.total}</div>
          </div>
        </div>
      )}

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

// Pop-up de confirmação com prévia — abre ao clicar em "Substituir revisão"
// numa linha só-no-PDM cujo código bate com uma revisão anterior já
// cadastrada (ver findPreviousRevision em pdmCompare.ts). Busca, antes de
// qualquer alteração, quantas linhas em cada tabela referenciam o código
// antigo (/api/replace-protheus-code/preview); só grava algo quando o
// usuário confirma "Sim, substituir" (/api/replace-protheus-code — troca o
// código em accessories e em toda tabela que o referencia, numa única
// transação no banco, e migra o custo real local pra chave nova).
function RevisionReplaceModal({ oldCode, newCode, prefill, onClose, onCreateAsNew, onReplaced }: {
  oldCode: string
  newCode: string
  prefill: Record<string, string>
  onClose: () => void
  onCreateAsNew: () => void
  onReplaced: () => void
}) {
  const [preview, setPreview] = useState<{ counts: Record<string, number>; labels: Record<string, string> } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/replace-protheus-code/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldCode }),
    })
      .then(res => res.json())
      .then(json => { if (!cancelled) setPreview(json) })
      .catch(() => { if (!cancelled) setError('Não foi possível calcular a prévia') })
      .finally(() => { if (!cancelled) setLoadingPreview(false) })
    return () => { cancelled = true }
  }, [oldCode])

  const handleApply = async () => {
    setApplying(true)
    setError('')
    try {
      const res = await fetch('/api/replace-protheus-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Só o código — os outros campos do item (Nome, Grupo, Cor etc.)
        // ficam como já estavam cadastrados, mesmo que divirjam do PDM.
        body: JSON.stringify({ oldCode, newCode }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao substituir'); return }
      onReplaced()
    } catch {
      setError('Erro de comunicação ao substituir')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">Revisão de componente detectada</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <p className="text-sm text-on-surface-variant">
            Este componente existe no banco de dados com uma revisão anterior à atual (código{' '}
            <span className="font-mono text-on-surface">{oldCode}</span>). Deseja substituir o componente da
            revisão anterior pela atual (<span className="font-mono text-on-surface">{newCode}</span>)?
          </p>

          {loadingPreview ? (
            <p className="text-xs text-outline">Calculando o que será afetado...</p>
          ) : preview ? (
            <div className="text-xs text-on-surface-variant border border-outline-variant rounded p-3 flex flex-col gap-1">
              <div className="font-semibold text-on-surface mb-1">Isto vai atualizar {oldCode} → {newCode} em:</div>
              {Object.entries(preview.counts).filter(([table]) => table !== 'accessories').map(([table, n]) => (
                <div key={table} className="flex justify-between">
                  <span>{preview.labels[table] ?? table}</span>
                  <span className={n > 0 ? 'text-primary font-semibold' : 'text-outline'}>{n}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-outline-variant/40 pt-1 mt-1">
                <span>Custo real local (se houver)</span>
                <span className="text-primary font-semibold">migra junto</span>
              </div>
            </div>
          ) : null}

          {error && <p className="text-xs text-error">{error}</p>}

          <div className="flex items-center justify-between gap-2 mt-2">
            <button type="button" onClick={onCreateAsNew} className="text-xs text-outline hover:text-on-surface transition-colors">
              Cadastrar como item novo
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying || loadingPreview}
                className="px-4 py-1.5 bg-error-container text-on-error-container rounded text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {applying ? 'Substituindo...' : 'Sim, substituir'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
