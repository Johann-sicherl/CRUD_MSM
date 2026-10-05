'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'

interface ImageObject {
  fileName: string
  size: number
  lastModified: string | null
  url: string
}
interface ImageChangeRow {
  id: string
  action: 'upload' | 'replace' | 'rename' | 'delete'
  folder_path: string | null
  group_name: string | null
  subgroup_name: string | null
  file_name: string
  to_folder_path: string | null
  to_group_name: string | null
  to_subgroup_name: string | null
  to_file_name: string | null
  profile_name: string | null
  created_at: string
}

const ACTION_LABEL: Record<ImageChangeRow['action'], string> = {
  upload: 'Adicionada',
  replace: 'Substituída',
  rename: 'Renomeada/Movida',
  delete: 'Removida',
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// folder_path é a coluna atual; group_name/subgroup_name são o formato
// antigo (linhas gravadas antes da navegação virar profundidade livre —
// ver msm_image_change_log_folder_path.sql), mantido só como fallback de
// leitura pra histórico antigo nunca sumir da tela.
function rowFolderPath(c: ImageChangeRow): string {
  return c.folder_path ?? [c.group_name, c.subgroup_name].filter(Boolean).join('/')
}
function rowToFolderPath(c: ImageChangeRow): string {
  return c.to_folder_path ?? [c.to_group_name, c.to_subgroup_name].filter(Boolean).join('/')
}

export default function GruposImagensPage() {
  const { user } = useAppAuth()

  // ── Navegação (estilo Windows Explorer, profundidade livre) ───
  const [currentPath, setCurrentPath] = useState('')
  const [folders, setFolders] = useState<string[]>([])
  const [files, setFiles] = useState<ImageObject[]>([])
  const [browseLoading, setBrowseLoading] = useState(true)
  const [browseError, setBrowseError] = useState('')

  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)
  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchBrowse = useCallback(async (path: string) => {
    setBrowseLoading(true)
    setBrowseError('')
    try {
      const res = await fetch(`/api/r2-images/browse?profileId=${user.id}&path=${encodeURIComponent(path)}`)
      const json = await res.json()
      if (!res.ok) { setBrowseError(json.error || 'Falha ao consultar o bucket de imagens'); return }
      setFolders(json.folders || [])
      setFiles(json.files || [])
    } catch {
      setBrowseError('Falha de rede ao consultar o bucket de imagens')
    } finally {
      setBrowseLoading(false)
    }
  }, [user.id])

  useEffect(() => { if (user.isAdmin) fetchBrowse(currentPath) }, [user.isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = (path: string) => {
    setCurrentPath(path)
    fetchBrowse(path)
  }
  const enterFolder = (name: string) => navigateTo(currentPath ? `${currentPath}/${name}` : name)
  const refreshCurrent = () => fetchBrowse(currentPath)

  const pathSegments = currentPath ? currentPath.split('/') : []

  // ── Changes log ──────────────────────────────────────────────
  const [changes, setChanges] = useState<ImageChangeRow[]>([])
  const [changesOpen, setChangesOpen] = useState(false)
  const [changesLoading, setChangesLoading] = useState(false)
  const fetchChanges = useCallback(async () => {
    setChangesLoading(true)
    try {
      const res = await fetch(`/api/r2-images/changes?profileId=${user.id}`)
      const json = await res.json()
      if (res.ok) setChanges(json.changes || [])
    } finally {
      setChangesLoading(false)
    }
  }, [user.id])
  useEffect(() => { if (changesOpen) fetchChanges() }, [changesOpen, fetchChanges])

  // ── Adicionar / Substituir ──────────────────────────────────
  const [addOpen, setAddOpen] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addFileName, setAddFileName] = useState('')
  const [addFile, setAddFile] = useState<File | null>(null)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const openAddForm = () => {
    setAddPath(currentPath)
    setAddFileName('')
    setAddFile(null)
    setAddError('')
    setAddOpen(true)
  }

  const submitAdd = async (mode: 'add' | 'replace') => {
    if (!addFileName.trim() || !addFile) {
      setAddError('Preencha o nome do arquivo e selecione a imagem')
      return
    }
    setAddSaving(true)
    setAddError('')
    try {
      const form = new FormData()
      form.set('profileId', user.id)
      form.set('path', addPath.trim())
      form.set('fileName', addFileName.trim())
      form.set('mode', mode)
      form.set('file', addFile)
      const res = await fetch('/api/r2-images/upload', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { setAddError(json.error || 'Falha ao enviar a imagem'); return }
      setAddOpen(false)
      showToast(mode === 'replace' ? 'Imagem substituída' : 'Imagem adicionada')
      navigateTo(addPath.trim())
    } catch {
      setAddError('Falha de rede ao enviar a imagem')
    } finally {
      setAddSaving(false)
    }
  }

  // Substituir direto numa linha já existente — mesmo formulário de cima,
  // só pré-preenchido e já mandando mode=replace.
  const openReplace = (img: ImageObject) => {
    setAddPath(currentPath)
    setAddFileName(img.fileName)
    setAddFile(null)
    setAddError('')
    setAddOpen(true)
  }

  // ── Renomear/Mover ───────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<ImageObject | null>(null)
  const [renameToPath, setRenameToPath] = useState('')
  const [renameToFileName, setRenameToFileName] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [renameError, setRenameError] = useState('')

  const openRename = (img: ImageObject) => {
    setRenameTarget(img)
    setRenameToPath(currentPath)
    setRenameToFileName(img.fileName)
    setRenameError('')
  }

  const submitRename = async () => {
    if (!renameTarget) return
    setRenameSaving(true)
    setRenameError('')
    try {
      const res = await fetch('/api/r2-images/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: user.id,
          path: currentPath, fileName: renameTarget.fileName,
          toPath: renameToPath.trim(), toFileName: renameToFileName.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setRenameError(json.error || 'Falha ao renomear a imagem'); return }
      setRenameTarget(null)
      showToast('Imagem renomeada/movida')
      refreshCurrent()
    } catch {
      setRenameError('Falha de rede ao renomear a imagem')
    } finally {
      setRenameSaving(false)
    }
  }

  // ── Remover ──────────────────────────────────────────────────
  const [deleting, setDeleting] = useState<string | null>(null)
  const removeImage = async (img: ImageObject) => {
    const ok = window.confirm(`Remover "${img.fileName}" de ${currentPath || '(raiz)'}? Uma cópia de segurança é guardada no bucket, mas a imagem some do ar imediatamente.`)
    if (!ok) return
    setDeleting(img.fileName)
    try {
      const res = await fetch('/api/r2-images/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: user.id, path: currentPath, fileName: img.fileName }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || 'Falha ao remover a imagem', true); return }
      showToast('Imagem removida')
      refreshCurrent()
    } catch {
      showToast('Falha de rede ao remover a imagem', true)
    } finally {
      setDeleting(null)
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

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
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">Administração · grupos de imagens</div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Grupos de Imagens</h1>
      </div>

      {browseError && <div className="text-error text-sm mb-4">⚠ {browseError}</div>}

      {/* Breadcrumb — navegação tipo Windows Explorer, profundidade livre */}
      <div className="flex items-center gap-1 flex-wrap text-sm mb-4 bg-surface-container border border-outline-variant rounded-lg px-4 py-2">
        <button
          onClick={() => navigateTo('')}
          className={`hover:text-primary transition-colors ${currentPath === '' ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
        >
          🗀 Raiz
        </button>
        {pathSegments.map((seg, i) => {
          const isLast = i === pathSegments.length - 1
          const targetPath = pathSegments.slice(0, i + 1).join('/')
          return (
            <span key={i} className="flex items-center gap-1">
              <span className="text-outline">/</span>
              <button
                onClick={() => navigateTo(targetPath)}
                className={`hover:text-primary transition-colors ${isLast ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
              >
                {seg}
              </button>
            </span>
          )
        })}
        <button onClick={refreshCurrent} title="Recarregar" className="ml-auto text-outline hover:text-primary">⟳</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Subpastas do caminho atual */}
        <div className="bg-surface-container border border-outline-variant rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
            <span className="text-sm font-semibold text-on-surface">Pastas</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {currentPath && (
              <button
                onClick={() => navigateTo(pathSegments.slice(0, -1).join('/'))}
                className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors border-b border-outline-variant/40"
              >
                <span>↑</span> <span>Subir um nível</span>
              </button>
            )}
            {browseLoading ? (
              <div className="p-4 text-sm text-outline">Carregando…</div>
            ) : folders.length === 0 ? (
              <div className="p-4 text-sm text-outline italic">Nenhuma subpasta aqui.</div>
            ) : (
              folders.map(name => (
                <button
                  key={name}
                  onClick={() => enterFolder(name)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
                >
                  <span className="text-outline">🗀</span>
                  <span className="truncate">{name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Imagens do caminho atual */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-on-surface-variant">
              <span className="font-mono text-on-surface">{currentPath || '(raiz)'}</span>
              {' '}— {files.length} imagem{files.length !== 1 ? 'ns' : ''}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setChangesOpen(v => !v)}
                className="px-3 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
              >
                {changesOpen ? 'Ocultar' : 'Ver'} histórico de alterações
              </button>
              <button
                onClick={openAddForm}
                className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-all"
              >
                + Adicionar imagem
              </button>
            </div>
          </div>

          {changesOpen && (
            <div className="bg-surface-container border border-outline-variant rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-outline-variant text-sm font-semibold text-on-surface">
                Últimas alterações
              </div>
              <div className="max-h-64 overflow-y-auto">
                {changesLoading ? (
                  <div className="p-4 text-sm text-outline">Carregando…</div>
                ) : changes.length === 0 ? (
                  <div className="p-4 text-sm text-outline italic">Nenhuma alteração registrada ainda.</div>
                ) : (
                  <table className="text-xs w-full">
                    <tbody>
                      {changes.map(c => (
                        <tr key={c.id} className="border-t border-outline-variant/40">
                          <td className="px-3 py-2 whitespace-nowrap text-outline">{new Date(c.created_at).toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 whitespace-nowrap font-semibold text-on-surface">{ACTION_LABEL[c.action]}</td>
                          <td className="px-3 py-2 font-mono text-on-surface-variant">
                            {rowFolderPath(c)}/{c.file_name}
                            {c.action === 'rename' && c.to_file_name && (
                              <> → {rowToFolderPath(c)}/{c.to_file_name}</>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-outline">{c.profile_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          <div className="bg-surface-container border border-outline-variant rounded-lg overflow-hidden">
            {browseLoading ? (
              <div className="p-6 text-sm text-outline">Carregando…</div>
            ) : files.length === 0 ? (
              <div className="p-6 text-sm text-outline italic">Nenhuma imagem nesta pasta ainda.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-px bg-outline-variant/40">
                {files.map(img => (
                  <div key={img.fileName} className="bg-surface-container p-3 flex flex-col gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.fileName}
                      className="w-full h-32 object-contain bg-surface-container-low rounded border border-outline-variant/40"
                    />
                    <div className="font-mono text-xs text-on-surface truncate" title={img.fileName}>{img.fileName}</div>
                    <div className="text-xs text-outline">{formatBytes(img.size)} · {img.lastModified ? new Date(img.lastModified).toLocaleDateString('pt-BR') : '—'}</div>
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <a href={img.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Abrir</a>
                      <button onClick={() => openReplace(img)} className="text-on-surface-variant hover:text-primary">Substituir</button>
                      <button onClick={() => openRename(img)} className="text-on-surface-variant hover:text-primary">Renomear</button>
                      <button
                        onClick={() => removeImage(img)}
                        disabled={deleting === img.fileName}
                        className="text-error hover:underline disabled:opacity-50"
                      >
                        {deleting === img.fileName ? 'Removendo…' : 'Remover'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pop-up Adicionar/Substituir */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setAddOpen(false)}>
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-outline-variant">
              <span className="text-base font-semibold text-on-surface">Adicionar / Substituir imagem</span>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-xs text-outline">
                Pasta é o caminho completo dentro do bucket (ex: Acessórios/CAMERAS) — pode ter qualquer
                profundidade; pra criar uma pasta nova, basta digitar um caminho que ainda não existe, a pasta
                passa a existir no bucket assim que a imagem for enviada.
              </p>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Pasta
                <input
                  list="grupo-imagens-folders"
                  value={addPath}
                  onChange={e => setAddPath(e.target.value)}
                  placeholder="ex: Acessórios/CAMERAS"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
                />
                <datalist id="grupo-imagens-folders">
                  {folders.map(f => <option key={f} value={currentPath ? `${currentPath}/${f}` : f} />)}
                </datalist>
              </label>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Nome do arquivo (ex: 27.02.00683.png)
                <input
                  value={addFileName}
                  onChange={e => setAddFileName(e.target.value)}
                  placeholder="codigo.png"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
                />
              </label>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Arquivo (.png)
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png"
                  onChange={e => setAddFile(e.target.files?.[0] ?? null)}
                  className="text-sm text-on-surface"
                />
              </label>
              {addError && (
                <div className="text-error text-xs bg-error-container/20 border border-error/30 rounded px-3 py-2">⚠ {addError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant">
              <button type="button" onClick={() => setAddOpen(false)} disabled={addSaving} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => submitAdd('replace')}
                disabled={addSaving}
                title="Use se já existe uma imagem com esse nome nessa pasta"
                className="px-4 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
              >
                Substituir existente
              </button>
              <button
                type="button"
                onClick={() => submitAdd('add')}
                disabled={addSaving}
                className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-60 transition-shadow"
              >
                {addSaving ? 'Enviando…' : 'Adicionar nova'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Renomear/Mover */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setRenameTarget(null)}>
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-outline-variant">
              <span className="text-base font-semibold text-on-surface">Renomear / Mover imagem</span>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-xs text-outline">
                De: <span className="font-mono text-on-surface">{currentPath || '(raiz)'}/{renameTarget.fileName}</span>
              </p>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Nova pasta
                <input
                  value={renameToPath}
                  onChange={e => setRenameToPath(e.target.value)}
                  placeholder="ex: Acessórios/CAMERAS"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
                />
              </label>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Novo nome do arquivo
                <input value={renameToFileName} onChange={e => setRenameToFileName(e.target.value)} className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary" />
              </label>
              {renameError && (
                <div className="text-error text-xs bg-error-container/20 border border-error/30 rounded px-3 py-2">⚠ {renameError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant">
              <button type="button" onClick={() => setRenameTarget(null)} disabled={renameSaving} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitRename}
                disabled={renameSaving}
                className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-60 transition-shadow"
              >
                {renameSaving ? 'Movendo…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-lg shadow-lg text-sm animate-fade-in ${
          toast.isError ? 'bg-error-container text-on-error-container border border-error/30' : 'bg-surface-container-highest border border-outline-variant text-on-surface'
        }`}>
          {toast.isError ? '⚠ ' : '✓ '}{toast.msg}
        </div>
      )}
    </div>
  )
}
