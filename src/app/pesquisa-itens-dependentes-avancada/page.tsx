'use client'

import { useCallback, useMemo, useState } from 'react'
import RecordModal from '@/components/RecordModal'
import ColumnFilter from '@/components/ColumnFilter'
import { tables } from '@/lib/schema'
import { useProtheusAuth } from '@/lib/protheusAuthContext'

const DEFAULT_HEADER_PREFIXES = '26'
const DEFAULT_NIVEL2_PREFIXES = '27.13'
const DEFAULT_MIN_SUPORTE = 3
const DEFAULT_MIN_CONFIANCA_PCT = 90

interface CooccurrencePair {
  codigoA: string
  codigoB: string
  denominacaoA: string
  denominacaoB: string
  coOcorrencias: number
  suporteA: number
  suporteB: number
  confiancaAparaB: number
  confiancaBparaA: number
  jaDeclarado: boolean
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

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`
}

// Mesmo padrão excel-style de filtro por coluna de DataTable.tsx (ColumnFilter,
// colFilters/filterSearch/columnOptions em cascata) — pedido explícito do
// usuário: "adicione o mesmo filtro em suas colunas para eu conseguir filtrar
// seus códigos". Só as colunas de fato exibidas no cabeçalho da tabela (não
// a denominação, que aparece só empilhada dentro da célula de código).
type PairColKey = 'codigoA' | 'codigoB' | 'coOcorrencias' | 'confiancaAparaB' | 'confiancaBparaA' | 'status'

const PAIR_COLUMN_LABELS: Record<PairColKey, string> = {
  codigoA: 'Código A',
  codigoB: 'Código B',
  coOcorrencias: 'Coocorrências',
  confiancaAparaB: 'Confiança A→B',
  confiancaBparaA: 'Confiança B→A',
  status: 'Status',
}

const PAIR_COLUMN_KEYS: PairColKey[] = ['codigoA', 'codigoB', 'coOcorrencias', 'confiancaAparaB', 'confiancaBparaA', 'status']

function getPairColValue(p: CooccurrencePair, key: PairColKey): string {
  switch (key) {
    case 'codigoA': return p.codigoA
    case 'codigoB': return p.codigoB
    case 'coOcorrencias': return String(p.coOcorrencias)
    case 'confiancaAparaB': return formatPct(p.confiancaAparaB)
    case 'confiancaBparaA': return formatPct(p.confiancaBparaA)
    case 'status': return p.jaDeclarado ? 'Já declarado' : 'Candidato novo'
  }
}

function applyPairColumnFilters(list: CooccurrencePair[], filters: Record<string, string[]>): CooccurrencePair[] {
  return list.filter(p => PAIR_COLUMN_KEYS.every(key => {
    const sel = filters[key]
    return !sel || sel.length === 0 || sel.includes(getPairColValue(p, key))
  }))
}

export default function PesquisaItensDependentesAvancadaPage() {
  // Conexão única ao Protheus da aplicação inteira (Sidebar) — mesma base
  // de Busc. Avanç. Acessórios Protheus/Análise de Estruturas.
  const { creds: dbCreds, openPrompt: openProtheusPrompt } = useProtheusAuth()

  const [headerPrefixInput, setHeaderPrefixInput] = useState(DEFAULT_HEADER_PREFIXES)
  const [nivel2PrefixInput, setNivel2PrefixInput] = useState(DEFAULT_NIVEL2_PREFIXES)
  const [minSuporteInput, setMinSuporteInput] = useState(String(DEFAULT_MIN_SUPORTE))
  const [minConfiancaInput, setMinConfiancaInput] = useState(String(DEFAULT_MIN_CONFIANCA_PCT))

  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [pairs, setPairs] = useState<CooccurrencePair[]>([])
  const [totalPedidos, setTotalPedidos] = useState(0)
  const [hasScanned, setHasScanned] = useState(false)

  // "Todos os pares" / "Só candidatos novos" — mesmo espírito do
  // chaveamento "Consulta completa"/"Só o que falta no meu banco" já usado
  // em Busc. Avanç. Acessórios Protheus: esconder o que já está declarado
  // em Produtos Dependentes, pra focar só no que ainda precisa de decisão.
  const [showOnlyNew, setShowOnlyNew] = useState(false)
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [filterSearch, setFilterSearch] = useState<Record<string, string>>({})
  const [copyFeedback, setCopyFeedback] = useState('')

  const [addModalPrefill, setAddModalPrefill] = useState<Record<string, string> | null>(null)

  const runScan = async () => {
    if (!dbCreds) { openProtheusPrompt(); return }
    const headerPrefixes = headerPrefixInput.split(',').map(p => p.trim()).filter(Boolean)
    const nivel2Prefixes = nivel2PrefixInput.split(',').map(p => p.trim()).filter(Boolean)
    if (headerPrefixes.length === 0) { setScanError('Informe ao menos um prefixo de estrutura'); return }
    const minSupport = Math.max(1, parseInt(minSuporteInput, 10) || DEFAULT_MIN_SUPORTE)
    const minConfidencePct = Math.min(100, Math.max(1, parseInt(minConfiancaInput, 10) || DEFAULT_MIN_CONFIANCA_PCT))

    setScanning(true)
    setScanError('')
    try {
      const res = await fetch('/api/dependent-items-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: dbCreds.user, password: dbCreds.password,
          headerPrefixes, nivel2Prefixes,
          minSupport, minConfidence: minConfidencePct / 100,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setScanError(json.error || 'Falha ao consultar o banco Protheus'); return }
      setPairs(json.pairs || [])
      setTotalPedidos(json.totalPedidos || 0)
      setHasScanned(true)
      setShowOnlyNew(false)
      setColFilters({})
      setFilterSearch({})
    } catch {
      setScanError('Erro de comunicação com o banco Protheus')
    } finally {
      setScanning(false)
    }
  }

  const clearResults = () => {
    if (pairs.length === 0 && !hasScanned) return
    const ok = window.confirm('Limpar o resultado desta busca?')
    if (!ok) return
    setPairs([])
    setTotalPedidos(0)
    setHasScanned(false)
    setShowOnlyNew(false)
    setColFilters({})
    setFilterSearch({})
  }

  const baseFilteredPairs = useMemo(
    () => pairs.filter(p => !showOnlyNew || !p.jaDeclarado),
    [pairs, showOnlyNew]
  )

  const filteredPairs = useMemo(
    () => applyPairColumnFilters(baseFilteredPairs, colFilters),
    [baseFilteredPairs, colFilters]
  )

  // Mesmo comportamento em cascata de DataTable.tsx: as opções de uma coluna
  // refletem só as linhas que já passam pelos filtros das OUTRAS colunas.
  const columnOptions = useMemo(() => {
    const result: Record<string, string[]> = {}
    for (const key of PAIR_COLUMN_KEYS) {
      const otherFilters = Object.fromEntries(Object.entries(colFilters).filter(([k]) => k !== key))
      const candidates = applyPairColumnFilters(baseFilteredPairs, otherFilters)
      const seen = new Set<string>()
      for (const p of candidates) seen.add(getPairColValue(p, key))
      result[key] = Array.from(seen).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    }
    return result
  }, [baseFilteredPairs, colFilters])

  const hasActiveColFilters = Object.values(colFilters).some(v => v.length > 0) || Object.values(filterSearch).some(v => v.trim() !== '')

  const handleToggleFilter = useCallback((name: string, val: string) => {
    setColFilters(prev => {
      const cur = prev[name] ?? []
      return { ...prev, [name]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] }
    })
  }, [])

  const handleClearFilter = useCallback((name: string) => {
    setColFilters(prev => ({ ...prev, [name]: [] }))
  }, [])

  const clearAllColumnFilters = () => {
    setColFilters({})
    setFilterSearch({})
  }

  const openAddModal = (codigoA: string, codigoB: string) => {
    setAddModalPrefill({ protheus_code: codigoA, protheus_item_code: codigoB })
  }

  const copyHeader = ['Código A', 'Denominação A', 'Código B', 'Denominação B', 'Coocorrências', 'Suporte A', 'Suporte B', 'Confiança A→B', 'Confiança B→A', 'Status']
  const copyRows: string[][] = filteredPairs.map(p => [
    p.codigoA, p.denominacaoA, p.codigoB, p.denominacaoB,
    String(p.coOcorrencias), String(p.suporteA), String(p.suporteB),
    formatPct(p.confiancaAparaB), formatPct(p.confiancaBparaA),
    p.jaDeclarado ? 'Já declarado' : 'Candidato novo',
  ])

  const handleCopyList = () => {
    if (copyRows.length === 0) return
    const tsv = [copyHeader, ...copyRows].map(r => r.join('\t')).join('\n')
    navigator.clipboard.writeText(tsv)
      .then(() => setCopyFeedback(`${copyRows.length} linha${copyRows.length !== 1 ? 's' : ''} copiada${copyRows.length !== 1 ? 's' : ''} — cole no Excel`))
      .catch(() => setCopyFeedback('Não foi possível copiar'))
    setTimeout(() => setCopyFeedback(''), 2500)
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Consulta Banco de Dados · pesquisa de itens dependentes avançada
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Pesquisa de Itens Dependentes Avançada</h1>
        <p className="text-on-surface-variant text-base mt-1 max-w-4xl">
          Analisa a estrutura Protheus ao vivo (mesma varredura 26.xx → nível 2 → nível 3 de Busc. Avanç.
          Acessórios Protheus — nunca desce além do nível 3, nenhum componente interno do BOM de um item entra
          na análise) procurando pares de código que sempre saem juntos nos pedidos — o mesmo estudo de caso por
          trás de <span className="font-mono">Produtos Dependentes</span>: &quot;este componente sempre saiu com
          este outro&quot;. Cada par encontrado é cruzado contra o que já está cadastrado em Produtos
          Dependentes — o que ainda não está declarado (nos dois sentidos) vira um candidato pra você decidir se
          cadastra.
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

      {addModalPrefill && (
        <RecordModal
          schema={tables.dependant_items}
          tableName="dependant_items"
          record={null}
          prefill={addModalPrefill}
          onClose={() => setAddModalPrefill(null)}
          onSaved={() => setAddModalPrefill(null)}
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
            title="Só os itens de nível 2 cujo código combine com este prefixo têm seus filhos (nível 3 em diante) explorados"
            className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-48"
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
          Suporte mínimo
          <input
            type="number"
            min={1}
            value={minSuporteInput}
            onChange={e => setMinSuporteInput(e.target.value)}
            title="Nº mínimo de pedidos em que cada código do par precisa aparecer — evita que uma coincidência de 1-2 pedidos vire 'candidato'"
            className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-28"
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
          Confiança mínima (%)
          <input
            type="number"
            min={1}
            max={100}
            value={minConfiancaInput}
            onChange={e => setMinConfiancaInput(e.target.value)}
            title="Nos dois sentidos: A precisa sair junto de B em pelo menos X% dos pedidos de A, e vice-versa"
            className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-28"
          />
        </label>
        <button
          onClick={runScan}
          disabled={scanning}
          className="px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
        >
          {scanning ? 'Analisando…' : '🔍 Buscar'}
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

      {hasScanned && (
        <div className="mb-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowOnlyNew(v => !v)}
              role="switch"
              aria-checked={showOnlyNew}
              title="Alterna entre ver todos os pares ou só os que ainda não estão declarados em Produtos Dependentes"
              className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors shrink-0 ${
                showOnlyNew ? 'bg-primary' : 'bg-surface-container-highest border border-outline-variant'
              }`}
            >
              <span
                className={`inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform ${
                  showOnlyNew ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-sm font-semibold ${showOnlyNew ? 'text-outline' : 'text-primary'}`}>
              Todos os pares
            </span>
            <span className="text-outline">/</span>
            <span className={`text-sm font-semibold ${showOnlyNew ? 'text-primary' : 'text-outline'}`}>
              Só candidatos novos
            </span>
          </div>
          {hasActiveColFilters && (
            <button
              onClick={clearAllColumnFilters}
              className="text-xs text-primary hover:underline whitespace-nowrap"
            >
              Limpar filtros
            </button>
          )}
          <button
            onClick={handleCopyList}
            disabled={copyRows.length === 0}
            title="Copia os pares exibidos (com os filtros aplicados) para colar direto no Excel"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-surface-container-low border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⧉ Copiar lista ({copyRows.length})
          </button>
          {copyFeedback && <span className="text-xs text-green-400">{copyFeedback}</span>}
          <span className="text-xs text-outline">
            {totalPedidos} pedido(s) (26.xx) analisado(s) · {pairs.length} par(es) encontrado(s) acima dos limiares
          </span>
        </div>
      )}

      {!hasScanned ? (
        <div className="text-sm text-outline italic">Nenhuma busca realizada ainda.</div>
      ) : pairs.length === 0 ? (
        <div className="text-sm text-outline italic">
          Nenhum par de código bateu os limiares de suporte/confiança informados.
        </div>
      ) : filteredPairs.length === 0 ? (
        <div className="text-sm text-outline italic">Nenhum par combina com os filtros selecionados.</div>
      ) : (
        <div className="overflow-auto border border-outline-variant rounded-lg">
          <table className="text-xs w-full">
            <thead className="bg-surface-container-highest">
              <tr>
                {PAIR_COLUMN_KEYS.map(key => (
                  <th key={key} className="text-left px-3 py-2 font-semibold text-on-surface-variant align-top min-w-[140px]">
                    <div>{PAIR_COLUMN_LABELS[key]}</div>
                    <div className="mt-1.5">
                      <ColumnFilter
                        searchValue={filterSearch[key] ?? ''}
                        onSearchChange={v => setFilterSearch(prev => ({ ...prev, [key]: v }))}
                        selectedValues={colFilters[key] ?? []}
                        onToggleValue={v => handleToggleFilter(key, v)}
                        onClearValues={() => handleClearFilter(key)}
                        options={columnOptions[key] ?? []}
                      />
                    </div>
                  </th>
                ))}
                <th className="text-left px-3 py-2 font-semibold text-on-surface-variant align-top">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredPairs.map((p, i) => (
                <tr key={`${p.codigoA}-${p.codigoB}-${i}`} className="border-t border-outline-variant/50">
                  <td className="px-3 py-2 align-top">
                    <div className="font-mono text-primary whitespace-nowrap">{p.codigoA}</div>
                    <div className="text-on-surface-variant">{p.denominacaoA || '—'}</div>
                    <div className="text-outline">suporte: {p.suporteA}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-mono text-primary whitespace-nowrap">{p.codigoB}</div>
                    <div className="text-on-surface-variant">{p.denominacaoB || '—'}</div>
                    <div className="text-outline">suporte: {p.suporteB}</div>
                  </td>
                  <td className="px-3 py-2 text-on-surface align-top">{p.coOcorrencias}</td>
                  <td className="px-3 py-2 text-on-surface align-top">{formatPct(p.confiancaAparaB)}</td>
                  <td className="px-3 py-2 text-on-surface align-top">{formatPct(p.confiancaBparaA)}</td>
                  <td className="px-3 py-2 align-top">
                    {p.jaDeclarado ? (
                      <Badge tone="success">Já declarado</Badge>
                    ) : (
                      <Badge tone="amber">Candidato novo</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {!p.jaDeclarado && (
                      <button
                        onClick={() => openAddModal(p.codigoA, p.codigoB)}
                        title="Abre o cadastro de uma nova dependência em Produtos Dependentes, já preenchido com os dois códigos — falta só escolher o equipamento"
                        className="px-2 py-0.5 text-[11px] font-semibold text-primary border border-primary/40 rounded hover:bg-primary/10 transition-colors whitespace-nowrap"
                      >
                        + Cadastrar dependência
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
