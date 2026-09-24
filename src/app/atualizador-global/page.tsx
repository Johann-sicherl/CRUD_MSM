'use client'

import { useRef, useState } from 'react'
import { FORCE_TO_ONE_FIELDS, tables, EQUIPMENTS_CASCADE_DEPENDENT_TABLES } from '@/lib/schema'
import { useAppAuth } from '@/lib/appAuthContext'
import AtualizadorGlobalControladoria from '@/components/AtualizadorGlobalControladoria'
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
  requiredEmptyCount: number
  selectInvalidCount: number
  selectInvalidDetails: SelectInvalidDetail[]
  status: 'reviewing' | 'sending' | 'success' | 'error'
  resultMessage?: string
  // null = tabela sem coluna financeira (normal); número = quantas linhas
  // tiveram custo/valor fiscal real capturado no arquivo local desta vez.
  localCosts?: number | null
  localCostsError?: string
}

const isBlocking = (file: UploadedFile) =>
  !file.detection || file.rows.length === 0 || file.detection.missingRequired.length > 0 || file.requiredEmptyCount > 0

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

// Perfil sem acesso total (Gerente Adm Comercial) cai numa tela à parte —
// só as 3 tabelas de Controladoria/Fiscal/Precificação, e só ATUALIZA as
// colunas financeiras delas (nunca cria/apaga linha, nunca toca no resto do
// registro). Ver AtualizadorGlobalControladoria.tsx e
// /api/global-update-controladoria/[table]. Admin continua exatamente como
// sempre foi, abaixo.
export default function AtualizadorGlobalPage() {
  const { user: appUser } = useAppAuth()
  if (!appUser.isAdmin) return <AtualizadorGlobalControladoria />
  return <AtualizadorGlobalAdmin />
}

function AtualizadorGlobalAdmin() {
  const { user: appUser } = useAppAuth()
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
        const { requiredEmptyCount, selectInvalidCount, selectInvalidDetails } = detection
          ? computeRowIssues(detection, rows)
          : { requiredEmptyCount: 0, selectInvalidCount: 0, selectInvalidDetails: [] }
        setFiles(prev => [...prev, {
          id, name: file.name, headers, rows, detection,
          requiredEmptyCount, selectInvalidCount, selectInvalidDetails, status: 'reviewing',
        }])
        setExpandedId(prevId => prevId ?? id)
      } catch {
        setFiles(prev => [...prev, {
          id, name: file.name, headers: [], rows: [], detection: null,
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

  const replaceOne = async (file: UploadedFile) => {
    if (!file.detection) return
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'sending' } : f))
    try {
      const res = await fetch(`/api/global-update/${file.detection.tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: file.rows, profileId: appUser.id }),
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
        ? {
            ...f,
            status: 'success',
            resultMessage: `${json.inserted} registro(s) gravado(s) com sucesso`,
            localCosts: json.localCosts ?? null,
            localCostsError: json.localCostsError,
          }
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

  // Achado real: equipments tem 5 tabelas com FK ON DELETE CASCADE
  // apontando pra ela (ver EQUIPMENTS_CASCADE_DEPENDENT_TABLES, schema.ts)
  // — substituir "Grupo de Equipamentos" dispara DELETE FROM equipments
  // WHERE true, que apaga em cascata TODAS as linhas dessas 5 tabelas na
  // hora, mesmo as que não mudaram nada. Se alguma delas não estiver
  // também neste lote, ela fica vazia e nada a reinsere. Só se aplica
  // quando "equipments" está de fato no lote — substituir só as tabelas
  // dependentes, sem equipments, não corre esse risco.
  const readyTableNames = new Set(readyFiles.map(f => f.detection!.tableName))
  const cascadeMissingTables = readyTableNames.has('equipments')
    ? EQUIPMENTS_CASCADE_DEPENDENT_TABLES.filter(t => !readyTableNames.has(t)).map(t => tables[t].label)
    : []
  const cascadeBlocked = cascadeMissingTables.length > 0

  // equipments precisa ser processada ANTES das suas 5 tabelas dependentes
  // dentro do mesmo lote — senão a substituição delas roda antes da
  // cascata de equipments apagar tudo de novo, e o turno delas no lote já
  // passou (nada reprocessa depois). Ordena só isso, preserva a ordem de
  // upload pro resto.
  const cascadeSafeOrder = (list: UploadedFile[]) =>
    [...list].sort((a, b) => {
      const aFirst = a.detection!.tableName === 'equipments' ? 0 : 1
      const bFirst = b.detection!.tableName === 'equipments' ? 0 : 1
      return aFirst - bFirst
    })

  const runReplaceAll = async () => {
    if (readyFiles.length === 0) return
    if (cascadeBlocked) {
      window.alert(
        `Substituição bloqueada: "Grupo de Equipamentos" está neste lote, mas ${cascadeMissingTables.join(', ')} ` +
        `não está(ão) — substituir equipments apaga em cascata todas as linhas dessas tabelas, e elas ficariam ` +
        `vazias sem esses arquivos no mesmo lote.`
      )
      return
    }
    const orderedFiles = cascadeSafeOrder(readyFiles)
    const ok = window.confirm(
      `Tem certeza? Isso vai APAGAR todos os registros atuais de ${orderedFiles.length} tabela(s) — ` +
      `${orderedFiles.map(f => f.detection!.schema.label).join(', ')} — e substituir pelo conteúdo destes arquivos. ` +
      `Esta ação não pode ser desfeita.`
    )
    if (!ok) return

    setSendingAll(true)
    for (const file of orderedFiles) {
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
                    {d && file.rows.length === 0 && <Badge tone="error">Sem linhas de dados</Badge>}
                    {d && d.missingRequired.length > 0 && <Badge tone="error">{d.missingRequired.length} coluna(s) obrigatória(s) faltando</Badge>}
                    {d && file.requiredEmptyCount > 0 && <Badge tone="error">{file.requiredEmptyCount} célula(s) obrigatória(s) vazia(s)</Badge>}
                    {d && d.missingOptional.length > 0 && <Badge tone="amber">{d.missingOptional.length} coluna(s) opcional(is) faltando</Badge>}
                    {d && d.extraColumns.length > 0 && <Badge tone="amber">{d.extraColumns.length} coluna(s) extra(s) (ignorada(s))</Badge>}
                    {d && file.selectInvalidCount > 0 && <Badge tone="amber">{file.selectInvalidCount} valor(es) fora da lista</Badge>}
                    {file.status === 'success' && <Badge tone="outline">✓ {file.resultMessage}</Badge>}
                    {file.status === 'success' && file.localCostsError && (
                      <Badge tone="error">⚠ custo local não gravado: {file.localCostsError}</Badge>
                    )}
                    {file.status === 'success' && !file.localCostsError && typeof file.localCosts === 'number' && (
                      <Badge tone={file.localCosts > 0 ? 'outline' : 'amber'}>
                        💰 {file.localCosts} custo(s) real(is) capturado(s) localmente
                      </Badge>
                    )}
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

                        {file.selectInvalidDetails.length > 0 && (
                          <div className="mb-4 flex flex-col gap-2 text-sm">
                            {file.selectInvalidDetails.map(det => (
                              <div key={det.field} className="text-amber-400">
                                <strong>Valores fora da lista em &quot;{det.label}&quot;</strong>{' '}
                                (esperado: {det.options.join(' ou ')}):{' '}
                                {det.values.map(v => `"${v.value}" (${v.count}x)`).join(', ')}
                              </div>
                            ))}
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
          {cascadeBlocked && (
            <div className="text-sm text-error bg-error-container/20 border border-error/30 rounded px-3 py-2">
              ⚠ &quot;Grupo de Equipamentos&quot; está neste lote, mas {cascadeMissingTables.join(', ')} não está(ão) —
              substituir Grupo de Equipamentos apaga em cascata (FK <code>ON DELETE CASCADE</code>) todas as linhas
              dessas tabelas para qualquer equipamento, e elas ficariam vazias sem esses arquivos no mesmo lote.
              Adicione os CSVs faltantes ao lote, ou remova o de Grupo de Equipamentos, antes de substituir.
            </div>
          )}
          <div>
            <button
              onClick={runReplaceAll}
              disabled={readyFiles.length === 0 || !confirmChecked || sendingAll || cascadeBlocked}
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
