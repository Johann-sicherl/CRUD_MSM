'use client'

import { useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'
import { isBlankCell } from '@/lib/globalUpdateConvert'
import { detectControladoriaTable, parseControladoriaFile, type ControladoriaDetection } from '@/lib/csvControladoriaDetect'

// Versão restrita do Atualizador Global pro perfil Gerente Adm Comercial —
// só Grupo de Equipamentos/Cadastro de Equipamentos/Cadastro de Componentes
// (as únicas com coluna de Controladoria/Fiscal/Precificação, ver
// isControllershipTable em schema.ts), e só ATUALIZA (nunca cria nem apaga
// linha) as colunas financeiras da tabela — o resto do registro (nome,
// descrição, grupo, especificação técnica) nunca é tocado por aqui, mesmo
// que venha diferente no CSV. Ver /api/global-update-controladoria/[table].

interface UploadedFile {
  id: string
  name: string
  headers: string[]
  rows: Record<string, string>[]
  detection: ControladoriaDetection | null
  status: 'reviewing' | 'sending' | 'success' | 'error'
  resultMessage?: string
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

export default function AtualizadorGlobalControladoria() {
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
        const { headers, rows } = await parseControladoriaFile(file)
        const detection = headers.length > 0 ? detectControladoriaTable(headers) : null
        setFiles(prev => [...prev, { id, name: file.name, headers, rows, detection, status: 'reviewing' }])
        setExpandedId(prevId => prevId ?? id)
      } catch {
        setFiles(prev => [...prev, {
          id, name: file.name, headers: [], rows: [], detection: null,
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

  const updateOne = async (file: UploadedFile) => {
    if (!file.detection) return
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'sending' } : f))
    try {
      const res = await fetch(`/api/global-update-controladoria/${file.detection.tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: file.rows, profileId: appUser.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFiles(prev => prev.map(f => f.id === file.id
          ? { ...f, status: 'error', resultMessage: json.error || 'Falha ao atualizar os custos' }
          : f))
        return
      }
      const parts = [
        `${json.updated} registro(s) atualizado(s)`,
        json.notFound > 0 ? `${json.notFound} código(s) não encontrado(s) — não foram criados` : null,
        json.errors?.length > 0 ? `${json.errors.length} erro(s)` : null,
        json.localCostsCaptured > 0 ? `💰 ${json.localCostsCaptured} custo(s) real(is) capturado(s) localmente` : null,
      ].filter(Boolean)
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, status: 'success', resultMessage: parts.join(' — ') }
        : f))
    } catch {
      setFiles(prev => prev.map(f => f.id === file.id
        ? { ...f, status: 'error', resultMessage: 'Falha de rede ao atualizar os custos' }
        : f))
    }
  }

  const isBlocking = (file: UploadedFile) => !file.detection || file.rows.length === 0
  const pendingFiles = files.filter(f => f.status !== 'success')
  const readyFiles = pendingFiles.filter(f => !isBlocking(f))
  const anyBlocking = pendingFiles.some(isBlocking)

  const runUpdateAll = async () => {
    setSendingAll(true)
    for (const file of readyFiles) {
      await updateOne(file)
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
          Envie a planilha (CSV ou Excel) de Grupo de Equipamentos, Cadastro de Equipamentos ou Cadastro de Componentes pra
          imputar custo/IPI/margem/comissão em lote. Só as colunas de Controladoria/Fiscal/Precificação são
          atualizadas — nome, descrição, grupo e demais dados do registro nunca são alterados por aqui. Um
          código que não exista ainda na tabela é ignorado (não é criado); a criação de itens novos continua
          sendo feita pelo Cadastro correspondente.
        </p>
      </div>

      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          onChange={e => handleFilesSelected(e.target.files)}
          className="hidden"
          id="global-update-controladoria-file-input"
        />
        <label
          htmlFor="global-update-controladoria-file-input"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary cursor-pointer transition-colors text-sm font-semibold"
        >
          ⇪ Selecionar arquivo(s) CSV ou Excel
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
                    {d && d.missingFields.length > 0 && <Badge tone="amber">{d.missingFields.length} coluna(s) financeira(s) ausente(s) no CSV — não serão tocadas</Badge>}
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
                        Nenhuma tabela de Controladoria/Fiscal/Precificação tem colunas correspondentes a este
                        arquivo. Confira se a planilha tem a coluna de código ({'protheus_code'} ou {'legacy_id'})
                        e pelo menos uma coluna financeira (ex.: cost_std, ipi_tax_rate).
                      </div>
                    ) : (
                      <>
                        <div className="mb-4 overflow-auto border border-outline-variant rounded-lg max-h-96">
                          <table className="text-xs w-full">
                            <thead className="sticky top-0 bg-surface-container-highest">
                              <tr>
                                <th className="text-left px-2 py-1.5 font-mono whitespace-nowrap border-b border-outline-variant text-on-surface-variant">
                                  {d.keyField.name}
                                </th>
                                {d.presentFields.map(f => (
                                  <th key={f.name} className="text-left px-2 py-1.5 font-mono whitespace-nowrap border-b border-outline-variant text-amber-400">
                                    {f.name} <span title="Gravado como 1 no Banco MSM — o valor real fica só local">⚠</span>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {previewRows.map((row, i) => {
                                const keyHeader = d.headerByLowerName.get(d.keyField.name.toLowerCase())
                                const keyVal = keyHeader ? row[keyHeader] : undefined
                                return (
                                  <tr key={i} className="border-b border-outline-variant/50 odd:bg-surface-container-low">
                                    <td className="px-2 py-1 whitespace-nowrap text-on-surface">
                                      {keyVal === undefined || isBlankCell(keyVal) ? <span className="text-outline">—</span> : keyVal}
                                    </td>
                                    {d.presentFields.map(f => {
                                      const header = d.headerByLowerName.get(f.name.toLowerCase())
                                      const raw = header ? row[header] : undefined
                                      return (
                                        <td key={f.name} className="px-2 py-1 whitespace-nowrap text-amber-400 font-semibold">
                                          {raw === undefined || isBlankCell(raw) ? <span className="text-outline">—</span> : raw}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                        {file.rows.length > previewRows.length && (
                          <div className="mb-4 text-xs text-outline">
                            Mostrando {previewRows.length} de {file.rows.length} linhas.
                          </div>
                        )}

                        {file.status === 'sending' && (
                          <div className="mt-3 text-sm text-primary">Atualizando…</div>
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
            {readyFiles.length} de {pendingFiles.length} arquivo(s) pendente(s) prontos para atualizar
            {anyBlocking && ' — os demais têm pendências e serão ignorados até serem corrigidos ou removidos'}.
          </div>
          <label className="flex items-start gap-2 text-sm text-on-surface-variant cursor-pointer">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={() => setConfirmChecked(v => !v)}
              className="mt-0.5"
            />
            Entendo que isto atualiza só as colunas de Controladoria/Fiscal/Precificação dos códigos já
            cadastrados nas tabelas identificadas acima — nada mais é alterado, e nenhum código novo é criado.
          </label>
          <div>
            <button
              onClick={runUpdateAll}
              disabled={readyFiles.length === 0 || !confirmChecked || sendingAll}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {sendingAll ? 'Atualizando…' : `Atualizar Custos (${readyFiles.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
