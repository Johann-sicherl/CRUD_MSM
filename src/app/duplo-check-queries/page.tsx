'use client'

import { useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'
import {
  parseCsvRaw, detectTable,
  type DetectionResult,
} from '@/lib/csvTableDetect'
import {
  DOUBLE_CHECK_TABLES, DOUBLE_CHECK_IMPORT_ORDER, isDoubleCheckTable, parseSqlStatementsFromText,
  type DoubleCheckTable,
} from '@/lib/queryDoubleCheck'
import { FORCE_TO_ONE_FIELDS } from '@/lib/schema'

interface UploadedCsv {
  id: string
  name: string
  rows: Record<string, string>[]
  detection: DetectionResult | null
  supported: boolean // detectado E dentro das 9 tabelas com cópia _check
  status: 'reviewing' | 'sending' | 'success' | 'error'
  resultMessage?: string
}

interface StatementResult {
  sql: string
  ok: boolean
  rowsAffected: number | null
  error: string | null
}

interface UploadedTxt {
  id: string
  name: string
  statementCount: number
}

function Badge({ tone, children }: { tone: 'error' | 'amber' | 'outline' | 'success'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'text-error border-error/30 bg-error-container/20'
    : tone === 'amber'
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : tone === 'success'
    ? 'text-green-400 border-green-500/30 bg-green-500/10'
    : 'text-outline border-outline-variant bg-surface-container'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  )
}

export default function DuploCheckQueriesPage() {
  const { user: appUser } = useAppAuth()

  if (!appUser.isAdmin) {
    return (
      <div className="p-8">
        <div className="bg-error-container/20 border border-error/30 text-error rounded-lg px-5 py-4 text-sm">
          Acesso restrito a administradores.
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl flex flex-col gap-10">
      <div>
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · duplo-check-queries
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Double-check de Queries</h1>
        <p className="text-on-surface-variant text-base mt-1 max-w-3xl">
          Testa se um DELETE/INSERT/UPDATE exportado da Auditoria vai dar erro antes de rodar no banco
          oficial de verdade — sem nunca tocar nos dados reais. Cada uma das 9 tabelas abaixo tem uma
          cópia estrutural idêntica (mesmos tipos, chaves, foreign keys) com sufixo <code>_check</code>.
          Primeiro grave o retrato de hoje nela (passo 1), depois simule as queries (passo 2) — cada
          simulação roda de verdade contra a cópia e desfaz tudo no final, mesmo se der tudo certo.
        </p>
      </div>

      <CsvSnapshotSection profileId={appUser.id} />
      <SimulateSection profileId={appUser.id} />
    </div>
  )
}

// ── Passo 1: gravar o retrato de hoje nas tabelas _check ──────────────────

function CsvSnapshotSection({ profileId }: { profileId: string }) {
  const [files, setFiles] = useState<UploadedCsv[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    for (const file of Array.from(fileList)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      try {
        const { headers, rows } = await parseCsvRaw(file)
        const detection = headers.length > 0 ? detectTable(headers) : null
        const supported = !!detection && isDoubleCheckTable(detection.tableName)
        setFiles(prev => [...prev, { id, name: file.name, rows, detection, supported, status: 'reviewing' }])
        setExpandedId(prevId => prevId ?? id)
      } catch {
        setFiles(prev => [...prev, {
          id, name: file.name, rows: [], detection: null, supported: false,
          status: 'error', resultMessage: 'Não foi possível ler este arquivo (CSV inválido)',
        }])
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    setExpandedId(prev => (prev === id ? null : prev))
  }

  const replaceOne = async (file: UploadedCsv) => {
    if (!file.detection || !file.supported) return
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'sending' } : f))
    try {
      const res = await fetch(`/api/global-update-check/${file.detection.tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: file.rows, profileId }),
      })
      const json = await res.json()
      if (!res.ok) {
        const parts = [json.error, json.details, json.hint].filter(Boolean)
        setFiles(prev => prev.map(f => f.id === file.id
          ? { ...f, status: 'error', resultMessage: parts.join(' — ') || 'Falha ao gravar em _check' }
          : f))
        return
      }
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, status: 'success', resultMessage: `${json.inserted} registro(s) gravado(s) em ${file.detection!.tableName}_check` }
        : f))
    } catch {
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, status: 'error', resultMessage: 'Falha de rede' }
        : f))
    }
  }

  const pendingFiles = files.filter(f => f.status !== 'success')
  const readyFiles = pendingFiles.filter(f => f.supported && f.rows.length > 0)

  const runAll = async () => {
    setSendingAll(true)
    // Sempre em ordem de dependência de FK (pai antes de filho), nunca na
    // ordem em que o usuário selecionou os arquivos — senão um filho pode
    // rodar antes do pai existir em _check e o INSERT falha por FK (já
    // aconteceu de verdade, ver DOUBLE_CHECK_IMPORT_ORDER).
    const ordered = [...readyFiles].sort((a, b) =>
      DOUBLE_CHECK_IMPORT_ORDER.indexOf(a.detection!.tableName as DoubleCheckTable) -
      DOUBLE_CHECK_IMPORT_ORDER.indexOf(b.detection!.tableName as DoubleCheckTable)
    )
    for (const file of ordered) await replaceOne(file)
    setSendingAll(false)
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-on-surface">1. Gravar o banco de hoje nas tabelas _check</h2>
        <p className="text-sm text-on-surface-variant mt-0.5">
          Mesmos CSVs oficiais que você já sobe no Atualizador Global — só que aqui vão pra{' '}
          <code>{'<tabela>'}_check</code>, apagando e recriando cada uma (igual à substituição atômica de
          sempre). Colunas financeiras ({FORCE_TO_ONE_FIELDS.join(', ')}) são gravadas como 1 e o valor
          real do CSV é descartado — nunca capturado em lugar nenhum, nem no arquivo local de custos.
          Tabelas suportadas: {DOUBLE_CHECK_TABLES.join(', ')}. O botão &quot;Gravar em lote&quot; grava
          sempre na ordem certa de dependência (Grupo de Equipamentos/Grupo de Acessórios primeiro),
          não importa a ordem em que você selecionou os arquivos.
        </p>
      </div>

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={e => handleFilesSelected(e.target.files)}
          className="hidden"
          id="double-check-csv-input"
        />
        <label
          htmlFor="double-check-csv-input"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary cursor-pointer transition-colors text-sm font-semibold"
        >
          ⇪ Selecionar arquivo(s) CSV
        </label>
      </div>

      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          {files.map(file => {
            const isOpen = expandedId === file.id
            const d = file.detection
            return (
              <div key={file.id} className="rounded-xl border border-outline-variant bg-surface-container overflow-hidden">
                <div
                  className="flex items-center justify-between gap-3 px-5 py-3 cursor-pointer hover:bg-surface-container-high transition-colors"
                  onClick={() => setExpandedId(isOpen ? null : file.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm text-on-surface truncate">{file.name}</span>
                    {d && file.supported && <Badge tone="outline">{d.schema.label} → {d.tableName}_check</Badge>}
                    {d && !file.supported && <Badge tone="error">Sem cópia _check disponível</Badge>}
                    {!d && <Badge tone="error">Tabela não identificada</Badge>}
                    {file.status === 'success' && <Badge tone="success">✓ {file.resultMessage}</Badge>}
                    {file.status === 'error' && <Badge tone="error">{file.resultMessage}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono text-outline">{file.rows.length} linha(s)</span>
                    <button
                      onClick={e => { e.stopPropagation(); removeFile(file.id) }}
                      className="text-outline hover:text-error text-sm px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {isOpen && file.status === 'sending' && (
                  <div className="border-t border-outline-variant px-5 py-3 text-sm text-primary">Gravando…</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {readyFiles.length > 0 && (
        <div>
          <button
            onClick={runAll}
            disabled={sendingAll}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold disabled:opacity-40 hover:shadow-neon transition-shadow"
          >
            {sendingAll ? 'Gravando…' : `Gravar ${readyFiles.length} tabela(s) em _check`}
          </button>
        </div>
      )}
    </section>
  )
}

// ── Passo 2: simular os .txt exportados da Auditoria ───────────────────────

function SimulateSection({ profileId }: { profileId: string }) {
  const [txts, setTxts] = useState<UploadedTxt[]>([])
  const [statements, setStatements] = useState<string[]>([])
  const [results, setResults] = useState<StatementResult[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const newTxts: UploadedTxt[] = []
    const newStatements: string[] = []
    for (const file of Array.from(fileList)) {
      const text = await file.text()
      const parsed = parseSqlStatementsFromText(text)
      newTxts.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, statementCount: parsed.length })
      newStatements.push(...parsed)
    }
    setTxts(prev => [...prev, ...newTxts])
    setStatements(prev => [...prev, ...newStatements])
    setResults(null)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const clearAll = () => {
    setTxts([])
    setStatements([])
    setResults(null)
    setError('')
  }

  const runSimulation = async () => {
    if (statements.length === 0) return
    setRunning(true)
    setError('')
    setResults(null)
    try {
      const res = await fetch('/api/query-double-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statements, profileId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError([json.error, json.details].filter(Boolean).join(' — ') || 'Falha ao simular')
        return
      }
      setResults(json.results as StatementResult[])
    } catch {
      setError('Falha de rede ao simular')
    } finally {
      setRunning(false)
    }
  }

  const okCount = results?.filter(r => r.ok).length ?? 0
  const errCount = results ? results.length - okCount : 0

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-on-surface">2. Simular queries (.txt da Auditoria)</h2>
        <p className="text-sm text-on-surface-variant mt-0.5">
          Escolha um ou mais .txt exportados em Auditoria de Queries (&quot;Exportar TXTs por
          tabela/ação&quot;). Cada instrução roda de verdade contra a cópia <code>_check</code> — em
          sequência, uma dependendo do efeito da anterior, igual rodaria no banco oficial — e no final
          tudo é desfeito, mesmo que nada tenha dado erro. Nada fica gravado, nunca.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt"
          multiple
          onChange={e => handleFilesSelected(e.target.files)}
          className="hidden"
          id="double-check-txt-input"
        />
        <label
          htmlFor="double-check-txt-input"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary cursor-pointer transition-colors text-sm font-semibold"
        >
          ⇪ Selecionar arquivo(s) .txt
        </label>
        {txts.length > 0 && (
          <button onClick={clearAll} className="text-xs text-outline hover:text-error transition-colors">
            ✕ Limpar tudo
          </button>
        )}
      </div>

      {txts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {txts.map(t => (
            <Badge key={t.id} tone="outline">{t.name} ({t.statementCount} instrução(ões))</Badge>
          ))}
        </div>
      )}

      {statements.length > 0 && (
        <div>
          <button
            onClick={runSimulation}
            disabled={running}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold disabled:opacity-40 hover:shadow-neon transition-shadow"
          >
            {running ? 'Simulando…' : `Simular ${statements.length} instrução(ões)`}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-error-container/20 border border-error/30 text-error rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {results && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge tone="success">✓ {okCount} ok</Badge>
            {errCount > 0 && <Badge tone="error">✕ {errCount} com erro</Badge>}
          </div>
          <div className="overflow-auto border border-outline-variant rounded-lg max-h-[32rem]">
            <table className="text-xs w-full">
              <thead className="sticky top-0 bg-surface-container-highest">
                <tr>
                  <th className="text-left px-2 py-1.5 font-mono text-on-surface-variant border-b border-outline-variant w-8">#</th>
                  <th className="text-left px-2 py-1.5 font-mono text-on-surface-variant border-b border-outline-variant">SQL</th>
                  <th className="text-left px-2 py-1.5 font-mono text-on-surface-variant border-b border-outline-variant whitespace-nowrap">Linhas</th>
                  <th className="text-left px-2 py-1.5 font-mono text-on-surface-variant border-b border-outline-variant">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={`border-b border-outline-variant/50 align-top ${r.ok ? '' : 'bg-error/5'}`}>
                    <td className="px-2 py-1.5 font-mono text-outline/50">{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono text-on-surface break-all">{r.sql}</td>
                    <td className="px-2 py-1.5 font-mono text-on-surface-variant whitespace-nowrap">{r.rowsAffected ?? '—'}</td>
                    <td className={`px-2 py-1.5 ${r.ok ? 'text-green-400' : 'text-error'}`}>
                      {r.ok
                        ? (r.rowsAffected === 0 ? '✓ rodou, mas 0 linhas afetadas' : '✓ ok')
                        : `✕ ${r.error}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
