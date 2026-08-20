'use client'

import { useRef, useState } from 'react'
import { FORCE_TO_ONE_FIELDS } from '@/lib/schema'
import {
  parseCsvRaw, detectTable, computeRowIssues,
  type DetectionResult, type SelectInvalidDetail,
} from '@/lib/csvTableDetect'
import { isBlankCell } from '@/lib/globalUpdateConvert'

interface UploadedFile {
  id: string
  name: string
  headers: string[]
  rows: Record<string, string>[]
  detection: DetectionResult | null
  // true = a tabela detectada não tem nenhuma coluna financeira — nada pra
  // este importador fazer com ela (diferente do Atualizador Global, aqui
  // isso bloqueia o arquivo em vez de só avisar).
  noFinancialColumns: boolean
  requiredEmptyCount: number
  selectInvalidCount: number
  selectInvalidDetails: SelectInvalidDetail[]
  status: 'reviewing' | 'sending' | 'success' | 'error'
  resultMessage?: string
  localCosts?: number | null
}

const isBlocking = (file: UploadedFile) =>
  !file.detection || file.noFinancialColumns || file.rows.length === 0

function Badge({ tone, children }: { tone: 'error' | 'amber' | 'outline'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'text-error border-error/30 bg-error-container/20'
    : tone === 'amber'
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : 'text-outline border-outline-variant bg-surface-container'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  )
}

export default function ImportarCustosLocaisPage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
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
        const noFinancialColumns = !!detection && !detection.realFields.some(f => FORCE_TO_ONE_FIELDS.includes(f.name))
        const { requiredEmptyCount, selectInvalidCount, selectInvalidDetails } = detection
          ? computeRowIssues(detection, rows)
          : { requiredEmptyCount: 0, selectInvalidCount: 0, selectInvalidDetails: [] }
        setFiles(prev => [...prev, {
          id, name: file.name, headers, rows, detection, noFinancialColumns,
          requiredEmptyCount, selectInvalidCount, selectInvalidDetails, status: 'reviewing',
        }])
        setExpandedId(prevId => prevId ?? id)
      } catch {
        setFiles(prev => [...prev, {
          id, name: file.name, headers: [], rows: [], detection: null, noFinancialColumns: false,
          requiredEmptyCount: 0, selectInvalidCount: 0, selectInvalidDetails: [],
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

  const importOne = async (file: UploadedFile) => {
    if (!file.detection) return
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'sending' } : f))
    try {
      const res = await fetch(`/api/import-local-costs/${file.detection.tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: file.rows }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFiles(prev => prev.map(f => f.id === file.id
          ? { ...f, status: 'error', resultMessage: json.error || 'Falha ao importar custos' }
          : f))
        return
      }
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, status: 'success', resultMessage: `${json.localCosts} custo(s) real(is) gravado(s) no arquivo local`, localCosts: json.localCosts }
        : f))
    } catch {
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, status: 'error', resultMessage: 'Falha de rede ao importar custos' }
        : f))
    }
  }

  const pendingFiles = files.filter(f => f.status !== 'success')
  const readyFiles = pendingFiles.filter(f => !isBlocking(f))
  const anyBlocking = pendingFiles.some(isBlocking)

  const runImportAll = async () => {
    setSendingAll(true)
    for (const file of readyFiles) {
      await importOne(file)
    }
    setSendingAll(false)
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Geral · importar-custos-locais
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Importador de Custos Locais</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Mesma lógica do Atualizador Global de Tabelas MSM — envie o(s) CSV(s) oficial(is), a tela
          identifica a tabela sozinha — mas <strong>nunca toca o Supabase</strong>: só extrai as colunas
          financeiras ({FORCE_TO_ONE_FIELDS.join(', ')}) e grava no arquivo local de custos reais desta
          máquina (local-data/real-costs.json). Use isto pra alimentar o custo local numa instalação nova,
          sem precisar de acesso ao Atualizador Global nem risco nenhum de apagar dados do banco.
        </p>
      </div>

      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={e => handleFilesSelected(e.target.files)}
          className="hidden"
          id="import-local-costs-file-input"
        />
        <label
          htmlFor="import-local-costs-file-input"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary cursor-pointer transition-colors text-sm font-semibold"
        >
          ⇪ Selecionar arquivo(s) CSV
        </label>
      </div>

      {files.length === 0 ? (
        <div className="text-sm text-outline italic">Nenhum arquivo carregado ainda.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {files.map(file => {
            const isOpen = expandedId === file.id
            const d = file.detection
            const previewRows = file.rows.slice(0, 50)
            return (
              <div key={file.id} className="rounded-xl border border-outline-variant bg-surface-container overflow-hidden">
                <div
                  className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer hover:bg-surface-container-high transition-colors"
                  onClick={() => setExpandedId(isOpen ? null : file.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm text-on-surface truncate">{file.name}</span>
                    {d ? (
                      <Badge tone="outline">{d.schema.label}</Badge>
                    ) : (
                      <Badge tone="error">Tabela não identificada</Badge>
                    )}
                    {d && file.rows.length === 0 && <Badge tone="error">Sem linhas de dados</Badge>}
                    {d && file.noFinancialColumns && <Badge tone="error">Tabela sem coluna financeira — nada a importar</Badge>}
                    {d && file.selectInvalidCount > 0 && <Badge tone="amber">{file.selectInvalidCount} valor(es) fora da lista (ignorado — só afeta custo)</Badge>}
                    {file.status === 'success' && <Badge tone="outline">✓ {file.resultMessage}</Badge>}
                    {file.status === 'error' && <Badge tone="error">{file.resultMessage}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono text-outline">{file.rows.length} linha(s)</span>
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

                {isOpen && (
                  <div className="border-t border-outline-variant p-5">
                    {!d ? (
                      <div className="text-sm text-error">
                        Nenhuma tabela do sistema tem colunas correspondentes ao cabeçalho deste arquivo.
                        Verifique se o CSV é uma exportação direta de uma das tabelas do banco.
                      </div>
                    ) : file.noFinancialColumns ? (
                      <div className="text-sm text-error">
                        {d.schema.label} não tem nenhuma coluna de controladoria/custo/precificação — este
                        importador não tem nada a fazer com ela. Remova este arquivo da lista.
                      </div>
                    ) : (
                      <>
                        <div className="mb-4 overflow-auto border border-outline-variant rounded-lg max-h-96">
                          <table className="text-xs w-full">
                            <thead className="sticky top-0 bg-surface-container-highest">
                              <tr>
                                {d.realFields.map(f => (
                                  <th key={f.name} className={`text-left px-2 py-1.5 font-mono whitespace-nowrap border-b border-outline-variant ${
                                    FORCE_TO_ONE_FIELDS.includes(f.name) ? 'text-amber-400' : 'text-on-surface-variant/50'
                                  }`}>
                                    {f.name}
                                    {FORCE_TO_ONE_FIELDS.includes(f.name) && <span title="Vai pro arquivo local de custos"> 💰</span>}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {previewRows.map((row, i) => (
                                <tr key={i} className="border-b border-outline-variant/50 odd:bg-surface-container-low">
                                  {d.realFields.map(f => {
                                    const header = d.headerByLowerName.get(f.name.toLowerCase())
                                    const financial = FORCE_TO_ONE_FIELDS.includes(f.name)
                                    const raw = header ? row[header] : undefined
                                    const empty = raw === undefined || isBlankCell(raw)
                                    return (
                                      <td key={f.name} className={`px-2 py-1 whitespace-nowrap ${
                                        financial ? 'text-amber-400 font-semibold' : 'text-on-surface-variant/40'
                                      }`}>
                                        {empty ? <span className="text-outline">—</span> : raw}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="mb-4 text-xs text-outline">
                          Só as colunas em laranja (💰) são usadas — o resto do CSV (identidade do registro,
                          nome etc.) é lido só pra achar a linha certa, nunca é gravado em lugar nenhum.
                        </p>
                        {file.rows.length > previewRows.length && (
                          <div className="mb-4 text-xs text-outline">
                            Mostrando {previewRows.length} de {file.rows.length} linhas.
                          </div>
                        )}
                        {file.status === 'sending' && (
                          <div className="mt-3 text-sm text-primary">Importando…</div>
                        )}
                        {file.status === 'error' && (
                          <div className="mt-3 text-sm text-error">{file.resultMessage}</div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-6 pt-5 border-t border-outline-variant flex flex-col gap-3">
          <div className="text-sm text-on-surface-variant">
            {readyFiles.length} de {pendingFiles.length} arquivo(s) pendente(s) prontos para importar
            {anyBlocking && ' — os demais têm pendências e serão ignorados até serem corrigidos ou removidos'}.
          </div>
          <div>
            <button
              onClick={runImportAll}
              disabled={readyFiles.length === 0 || sendingAll}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-neon transition-shadow"
            >
              {sendingAll ? 'Importando…' : `Importar Custos de ${readyFiles.length} Arquivo${readyFiles.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
