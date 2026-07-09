'use client'

import { useRef, useState } from 'react'
import { tables, FORCE_TO_ONE_FIELDS, getRealColumnFields, type Field, type TableSchema } from '@/lib/schema'

interface DetectionResult {
  tableName: string
  schema: TableSchema
  realFields: Field[]
  headerByLowerName: Map<string, string>
  missingRequired: Field[]
  missingOptional: Field[]
  extraColumns: string[]
}

interface UploadedFile {
  id: string
  name: string
  headers: string[]
  rows: Record<string, string>[]
  detection: DetectionResult | null
  requiredEmptyCount: number
  selectInvalidCount: number
  status: 'reviewing' | 'sending' | 'success' | 'error'
  resultMessage?: string
}

const isBlocking = (file: UploadedFile) =>
  !file.detection || file.detection.missingRequired.length > 0 || file.requiredEmptyCount > 0

const isRequiredField = (f: Field) =>
  !f.isPk && !f.isReadonly && !f.autoIncrement && !f.nullable && f.defaultValue === undefined

// Hand-written CSV parser (RFC4180-style quoting) instead of the xlsx/SheetJS
// library: SheetJS auto-detects date-looking cells and silently reformats
// them (e.g. "2025-02-14 10:52:43.648996-03" becomes "2/14/25"), which would
// corrupt created_at/updated_at on import. Every cell here stays exact text.
function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0
  const len = text.length
  while (i < len) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      cell += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(cell); cell = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue }
    cell += c; i++
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

async function parseCsvRaw(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const text = await file.text()
  const matrix = parseCsvText(text).filter(r => !(r.length === 1 && r[0].trim() === ''))
  if (matrix.length === 0) return { headers: [], rows: [] }
  const headers = matrix[0].map(h => h.trim())
  const rows = matrix.slice(1)
    .filter(r => r.some(c => c.trim() !== ''))
    .map(r => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i] : '' })
      return obj
    })
  return { headers, rows }
}

// Picks the table whose real column set is the CLOSEST match to the CSV
// header set — not just whichever table contains the most matching column
// names. A table with many columns (e.g. equipments) can "contain" every
// column of a smaller table (e.g. accessory_groups: id, legacy_id, name,
// created_at, updated_at) as a subset without actually being the right
// table, so we rank by total mismatch (missing + extra columns combined) and
// take the smallest — an exact match scores 0 and always wins.
function detectTable(headers: string[]): DetectionResult | null {
  const headerLowerSet = new Set(headers.map(h => h.toLowerCase()))
  let best: { tableName: string; schema: TableSchema; realFields: Field[]; diff: number } | null = null
  for (const [tableName, schema] of Object.entries(tables)) {
    const realFields = getRealColumnFields(schema)
    const fieldLowerSet = new Set(realFields.map(f => f.name.toLowerCase()))
    const overlap = realFields.filter(f => headerLowerSet.has(f.name.toLowerCase())).length
    if (overlap === 0) continue // completely unrelated table — not a candidate
    const missingCount = realFields.length - overlap
    const extraCount = headers.filter(h => !fieldLowerSet.has(h.toLowerCase())).length
    const diff = missingCount + extraCount
    if (!best || diff < best.diff) best = { tableName, schema, realFields, diff }
  }
  if (!best) return null

  const headerByLowerName = new Map(headers.map(h => [h.toLowerCase(), h]))
  const fieldLowerSet = new Set(best.realFields.map(f => f.name.toLowerCase()))
  const present = (f: Field) => headerByLowerName.has(f.name.toLowerCase())

  return {
    tableName: best.tableName,
    schema: best.schema,
    realFields: best.realFields,
    headerByLowerName,
    missingRequired: best.realFields.filter(f => !present(f) && isRequiredField(f)),
    missingOptional: best.realFields.filter(f => !present(f) && !isRequiredField(f)),
    extraColumns: headers.filter(h => !fieldLowerSet.has(h.toLowerCase())),
  }
}

// Official CSV exports often spell an absent value out as the literal text
// "NULL" instead of leaving the cell empty — treat both as no value, same as
// the server (src/app/api/global-update/[table]/route.ts).
const isBlankCell = (raw: unknown) => {
  const s = String(raw ?? '').trim()
  return s === '' || s.toUpperCase() === 'NULL'
}

function computeRowIssues(detection: DetectionResult, rows: Record<string, string>[]) {
  const requiredFields = detection.realFields.filter(f =>
    isRequiredField(f) && detection.headerByLowerName.has(f.name.toLowerCase())
  )
  const selectFields = detection.realFields.filter(f =>
    f.type === 'select' && f.options && detection.headerByLowerName.has(f.name.toLowerCase())
  )

  let requiredEmptyCount = 0
  let selectInvalidCount = 0
  for (const row of rows) {
    for (const f of requiredFields) {
      const header = detection.headerByLowerName.get(f.name.toLowerCase())!
      if (isBlankCell(row[header])) requiredEmptyCount++
    }
    for (const f of selectFields) {
      const header = detection.headerByLowerName.get(f.name.toLowerCase())!
      const v = String(row[header] ?? '').trim()
      if (!isBlankCell(v) && !f.options!.some(o => o.toLowerCase() === v.toLowerCase())) selectInvalidCount++
    }
  }
  return { requiredEmptyCount, selectInvalidCount }
}

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

export default function AtualizadorGlobalPage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [sendingAll, setSendingAll] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    for (const file of Array.from(fileList)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      try {
        const { headers, rows } = await parseCsvRaw(file)
        const detection = headers.length > 0 ? detectTable(headers) : null
        const { requiredEmptyCount, selectInvalidCount } = detection
          ? computeRowIssues(detection, rows)
          : { requiredEmptyCount: 0, selectInvalidCount: 0 }
        setFiles(prev => [...prev, {
          id, name: file.name, headers, rows, detection,
          requiredEmptyCount, selectInvalidCount, status: 'reviewing',
        }])
        setExpandedId(prevId => prevId ?? id)
      } catch {
        setFiles(prev => [...prev, {
          id, name: file.name, headers: [], rows: [], detection: null,
          requiredEmptyCount: 0, selectInvalidCount: 0,
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

  const replaceOne = async (file: UploadedFile) => {
    if (!file.detection) return
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'sending' } : f))
    try {
      const res = await fetch(`/api/global-update/${file.detection.tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: file.rows }),
      })
      const json = await res.json()
      if (!res.ok) {
        const parts = [json.error, json.details, json.hint, json.code ? `(código ${json.code})` : null].filter(Boolean)
        setFiles(prev => prev.map(f => f.id === file.id
          ? { ...f, status: 'error', resultMessage: parts.join(' — ') || 'Falha ao substituir a tabela' }
          : f))
        return
      }
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, status: 'success', resultMessage: `${json.inserted} registro(s) gravado(s) com sucesso` }
        : f))
    } catch {
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, status: 'error', resultMessage: 'Falha de rede ao substituir a tabela' }
        : f))
    }
  }

  const pendingFiles = files.filter(f => f.status !== 'success')
  const readyFiles = pendingFiles.filter(f => !isBlocking(f))
  const anyBlocking = pendingFiles.some(isBlocking)

  const confirmReplaceAll = async () => {
    if (readyFiles.length === 0) return
    const ok = window.confirm(
      `Tem certeza? Isso vai APAGAR todos os registros atuais de ${readyFiles.length} tabela(s) — ` +
      `${readyFiles.map(f => f.detection!.schema.label).join(', ')} — e substituir pelo conteúdo destes arquivos. ` +
      `Esta ação não pode ser desfeita.`
    )
    if (!ok) return

    setSendingAll(true)
    for (const file of readyFiles) {
      await replaceOne(file)
    }
    setSendingAll(false)
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · atualizador global de tabelas msm
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Atualizador Global de Tabelas MSM</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Envie o CSV oficial de uma ou mais tabelas — a tela identifica sozinha de qual tabela cada
          arquivo se trata. Audite cada um individualmente (colunas faltando/extras, células
          obrigatórias vazias, prévia dos dados) e, quando todos estiverem corretos, use o botão no
          final da página para substituir tudo de uma vez. Cada tabela confirmada tem todos os seus
          registros atuais apagados e substituídos pelo conteúdo do respectivo arquivo. Colunas
          financeiras ({FORCE_TO_ONE_FIELDS.join(', ')}) são sempre gravadas como 1.
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
          id="global-update-file-input"
        />
        <label
          htmlFor="global-update-file-input"
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
            const blocking = !d || d.missingRequired.length > 0 || file.requiredEmptyCount > 0
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
                    {d && d.missingRequired.length > 0 && <Badge tone="error">{d.missingRequired.length} coluna(s) obrigatória(s) faltando</Badge>}
                    {d && file.requiredEmptyCount > 0 && <Badge tone="error">{file.requiredEmptyCount} célula(s) obrigatória(s) vazia(s)</Badge>}
                    {d && d.missingOptional.length > 0 && <Badge tone="amber">{d.missingOptional.length} coluna(s) opcional(is) faltando</Badge>}
                    {d && d.extraColumns.length > 0 && <Badge tone="amber">{d.extraColumns.length} coluna(s) extra(s) (ignorada(s))</Badge>}
                    {d && file.selectInvalidCount > 0 && <Badge tone="amber">{file.selectInvalidCount} valor(es) fora da lista</Badge>}
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
                    ) : (
                      <>
                        {(d.missingRequired.length > 0 || d.missingOptional.length > 0 || d.extraColumns.length > 0) && (
                          <div className="mb-4 flex flex-col gap-2 text-sm">
                            {d.missingRequired.length > 0 && (
                              <div className="text-error">
                                <strong>Faltando (obrigatórias):</strong> {d.missingRequired.map(f => f.name).join(', ')}
                              </div>
                            )}
                            {d.missingOptional.length > 0 && (
                              <div className="text-amber-400">
                                <strong>Faltando (opcionais — ficarão nulas/padrão):</strong> {d.missingOptional.map(f => f.name).join(', ')}
                              </div>
                            )}
                            {d.extraColumns.length > 0 && (
                              <div className="text-amber-400">
                                <strong>Colunas do CSV que serão ignoradas:</strong> {d.extraColumns.join(', ')}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mb-4 overflow-auto border border-outline-variant rounded-lg max-h-96">
                          <table className="text-xs w-full">
                            <thead className="sticky top-0 bg-surface-container-highest">
                              <tr>
                                {d.realFields.map(f => (
                                  <th key={f.name} className={`text-left px-2 py-1.5 font-mono whitespace-nowrap border-b border-outline-variant ${
                                    FORCE_TO_ONE_FIELDS.includes(f.name) ? 'text-amber-400' : 'text-on-surface-variant'
                                  }`}>
                                    {f.name}
                                    {FORCE_TO_ONE_FIELDS.includes(f.name) && <span title="Sempre gravado como 1"> ⚠</span>}
                                    {!d.headerByLowerName.has(f.name.toLowerCase()) && <span className="text-outline"> (ausente)</span>}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {previewRows.map((row, i) => (
                                <tr key={i} className="border-b border-outline-variant/50 odd:bg-surface-container-low">
                                  {d.realFields.map(f => {
                                    const header = d.headerByLowerName.get(f.name.toLowerCase())
                                    const forced = FORCE_TO_ONE_FIELDS.includes(f.name)
                                    const raw = header ? row[header] : undefined
                                    return (
                                      <td key={f.name} className={`px-2 py-1 whitespace-nowrap ${forced ? 'text-amber-400 font-semibold' : 'text-on-surface'}`}>
                                        {forced ? '1' : (raw === undefined || isBlankCell(raw) ? <span className="text-outline">—</span> : raw)}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {file.rows.length > previewRows.length && (
                          <div className="mb-4 text-xs text-outline">
                            Mostrando {previewRows.length} de {file.rows.length} linhas.
                          </div>
                        )}

                        {blocking && file.status !== 'success' && (
                          <div className="text-xs text-error pt-2 border-t border-outline-variant">
                            Corrija as colunas/valores obrigatórios acima — este arquivo será ignorado pelo botão de substituir tudo, no final da página.
                          </div>
                        )}
                        {file.status === 'sending' && (
                          <div className="mt-3 text-sm text-primary">Substituindo…</div>
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
            {readyFiles.length} de {pendingFiles.length} arquivo(s) pendente(s) prontos para substituir
            {anyBlocking && ' — os demais têm pendências e serão ignorados até serem corrigidos ou removidos'}.
          </div>
          <label className="flex items-start gap-2 text-sm text-on-surface-variant cursor-pointer">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={() => setConfirmChecked(v => !v)}
              className="mt-0.5"
            />
            Entendo que TODOS os dados atuais das tabelas identificadas acima serão apagados e
            substituídos pelos dados dos respectivos arquivos, e que essa ação não passa pela Auditoria.
          </label>
          <div>
            <button
              onClick={confirmReplaceAll}
              disabled={readyFiles.length === 0 || !confirmChecked || sendingAll}
              className="px-4 py-2 rounded-lg bg-error text-on-error text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {sendingAll ? 'Substituindo…' : `Confirmar e Substituir Tudo (${readyFiles.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
