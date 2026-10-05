'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'

interface ImageSubgroupNode {
  name: string
  count: number
}
interface ImageGroupNode {
  name: string
  subgroups: ImageSubgroupNode[]
}
interface ImageObject {
  fileName: string
  size: number
  lastModified: string | null
  url: string
}
interface ImageChangeRow {
  id: string
  action: 'upload' | 'replace' | 'rename' | 'delete'
  group_name: string
  subgroup_name: string
  file_name: string
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

export default function GruposImagensPage() {
  const { user } = useAppAuth()

  const [tree, setTree] = useState<ImageGroupNode[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState('')

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [selectedSubgroup, setSelectedSubgroup] = useState<string | null>(null)
  const [images, setImages] = useState<ImageObject[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [imagesError, setImagesError] = useState('')

  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)
  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchTree = useCallback(async () => {
    setTreeLoading(true)
    setTreeError('')
    try {
      const res = await fetch(`/api/r2-images/tree?profileId=${user.id}`)
      const json = await res.json()
      if (!res.ok) { setTreeError(json.error || 'Falha ao consultar o bucket de imagens'); return }
      setTree(json.groups || [])
    } catch {
      setTreeError('Falha de rede ao consultar o bucket de imagens')
    } finally {
      setTreeLoading(false)
    }
  }, [user.id])

  useEffect(() => { if (user.isAdmin) fetchTree() }, [user.isAdmin, fetchTree])

  const fetchImages = useCallback(async (group: string, subgroup: string) => {
    setImagesLoading(true)
    setImagesError('')
    try {
      const res = await fetch(`/api/r2-images/list?profileId=${user.id}&group=${encodeURIComponent(group)}&subgroup=${encodeURIComponent(subgroup)}`)
      const json = await res.json()
      if (!res.ok) { setImagesError(json.error || 'Falha ao listar imagens'); return }
      setImages(json.images || [])
    } catch {
      setImagesError('Falha de rede ao listar imagens')
    } finally {
      setImagesLoading(false)
    }
  }, [user.id])

  const selectSubgroup = (group: string, subgroup: string) => {
    setSelectedGroup(group)
    setSelectedSubgroup(subgroup)
    fetchImages(group, subgroup)
  }

  const refreshCurrent = () => {
    fetchTree()
    if (selectedGroup && selectedSubgroup) fetchImages(selectedGroup, selectedSubgroup)
  }

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
  const [addGroup, setAddGroup] = useState('')
  const [addSubgroup, setAddSubgroup] = useState('')
  const [addFileName, setAddFileName] = useState('')
  const [addFile, setAddFile] = useState<File | null>(null)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const openAddForm = () => {
    setAddGroup(selectedGroup ?? '')
    setAddSubgroup(selectedSubgroup ?? '')
    setAddFileName('')
    setAddFile(null)
    setAddError('')
    setAddOpen(true)
  }

  const submitAdd = async (mode: 'add' | 'replace') => {
    if (!addGroup.trim() || !addSubgroup.trim() || !addFileName.trim() || !addFile) {
      setAddError('Preencha Grupo, Subgrupo, nome do arquivo e selecione a imagem')
      return
    }
    setAddSaving(true)
    setAddError('')
    try {
      const form = new FormData()
      form.set('profileId', user.id)
      form.set('group', addGroup.trim())
      form.set('subgroup', addSubgroup.trim())
      form.set('fileName', addFileName.trim())
      form.set('mode', mode)
      form.set('file', addFile)
      const res = await fetch('/api/r2-images/upload', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { setAddError(json.error || 'Falha ao enviar a imagem'); return }
      setAddOpen(false)
      showToast(mode === 'replace' ? 'Imagem substituída' : 'Imagem adicionada')
      selectSubgroup(addGroup.trim(), addSubgroup.trim())
      fetchTree()
    } catch {
      setAddError('Falha de rede ao enviar a imagem')
    } finally {
      setAddSaving(false)
    }
  }

  // Substituir direto numa linha já existente — mesmo formulário de cima,
  // só pré-preenchido e já mandando mode=replace.
  const openReplace = (img: ImageObject) => {
    if (!selectedGroup || !selectedSubgroup) return
    setAddGroup(selectedGroup)
    setAddSubgroup(selectedSubgroup)
    setAddFileName(img.fileName)
    setAddFile(null)
    setAddError('')
    setAddOpen(true)
  }

  // ── Renomear/Mover ───────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<ImageObject | null>(null)
  const [renameToGroup, setRenameToGroup] = useState('')
  const [renameToSubgroup, setRenameToSubgroup] = useState('')
  const [renameToFileName, setRenameToFileName] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [renameError, setRenameError] = useState('')

  const openRename = (img: ImageObject) => {
    setRenameTarget(img)
    setRenameToGroup(selectedGroup ?? '')
    setRenameToSubgroup(selectedSubgroup ?? '')
    setRenameToFileName(img.fileName)
    setRenameError('')
  }

  const submitRename = async () => {
    if (!renameTarget || !selectedGroup || !selectedSubgroup) return
    setRenameSaving(true)
    setRenameError('')
    try {
      const res = await fetch('/api/r2-images/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: user.id,
          group: selectedGroup, subgroup: selectedSubgroup, fileName: renameTarget.fileName,
          toGroup: renameToGroup.trim(), toSubgroup: renameToSubgroup.trim(), toFileName: renameToFileName.trim(),
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
    if (!selectedGroup || !selectedSubgroup) return
    const ok = window.confirm(`Remover "${img.fileName}" de ${selectedGroup}/${selectedSubgroup}? Uma cópia de segurança é guardada no bucket, mas a imagem some do ar imediatamente.`)
    if (!ok) return
    setDeleting(img.fileName)
    try {
      const res = await fetch('/api/r2-images/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: user.id, group: selectedGroup, subgroup: selectedSubgroup, fileName: img.fileName }),
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

      {treeError && <div className="text-error text-sm mb-4">⚠ {treeError}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Árvore Grupo / Subgrupo */}
        <div className="bg-surface-container border border-outline-variant rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
            <span className="text-sm font-semibold text-on-surface">Grupos / Subgrupos</span>
            <button onClick={fetchTree} title="Recarregar" className="text-outline hover:text-primary text-sm">⟳</button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {treeLoading ? (
              <div className="p-4 text-sm text-outline">Carregando…</div>
            ) : tree.length === 0 ? (
              <div className="p-4 text-sm text-outline italic">Nenhum grupo encontrado no bucket.</div>
            ) : (
              tree.map(g => (
                <div key={g.name} className="border-b border-outline-variant/40 last:border-b-0">
                  <div className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant bg-surface-container-low">
                    {g.name}
                  </div>
                  {g.subgroups.map(sg => {
                    const isActive = selectedGroup === g.name && selectedSubgroup === sg.name
                    return (
                      <button
                        key={sg.name}
                        onClick={() => selectSubgroup(g.name, sg.name)}
                        className={`w-full flex items-center justify-between px-5 py-2 text-left text-sm transition-colors ${
                          isActive ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
                        }`}
                      >
                        <span className="truncate">{sg.name}</span>
                        <span className="text-xs font-mono text-outline shrink-0 ml-2">{sg.count}</span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Imagens do subgrupo selecionado */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-on-surface-variant">
              {selectedGroup && selectedSubgroup ? (
                <>
                  <span className="font-mono text-on-surface">{selectedGroup}/{selectedSubgroup}</span>
                  {' '}— {images.length} imagem{images.length !== 1 ? 'ns' : ''}
                </>
              ) : (
                'Selecione um grupo/subgrupo à esquerda, ou adicione um novo abaixo.'
              )}
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
                            {c.group_name}/{c.subgroup_name}/{c.file_name}
                            {c.action === 'rename' && c.to_file_name && (
                              <> → {c.to_group_name}/{c.to_subgroup_name}/{c.to_file_name}</>
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

          {imagesError && <div className="text-error text-sm">⚠ {imagesError}</div>}

          {selectedGroup && selectedSubgroup && (
            <div className="bg-surface-container border border-outline-variant rounded-lg overflow-hidden">
              {imagesLoading ? (
                <div className="p-6 text-sm text-outline">Carregando…</div>
              ) : images.length === 0 ? (
                <div className="p-6 text-sm text-outline italic">Nenhuma imagem neste subgrupo ainda.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-px bg-outline-variant/40">
                  {images.map(img => (
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
          )}
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
                Grupo e Subgrupo existentes aparecem na lista ao digitar; para criar um novo, basta digitar um
                nome que ainda não existe — a pasta passa a existir no bucket assim que a imagem for enviada.
              </p>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Grupo
                <input
                  list="grupo-imagens-groups"
                  value={addGroup}
                  onChange={e => setAddGroup(e.target.value)}
                  placeholder="ex: Acessórios"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
                />
                <datalist id="grupo-imagens-groups">
                  {tree.map(g => <option key={g.name} value={g.name} />)}
                </datalist>
              </label>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Subgrupo
                <input
                  list="grupo-imagens-subgroups"
                  value={addSubgroup}
                  onChange={e => setAddSubgroup(e.target.value)}
                  placeholder="ex: CAMERAS"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
                />
                <datalist id="grupo-imagens-subgroups">
                  {tree.find(g => g.name === addGroup)?.subgroups.map(sg => <option key={sg.name} value={sg.name} />)}
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
                title="Use se já existe uma imagem com esse nome nesse grupo/subgrupo"
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
                De: <span className="font-mono text-on-surface">{selectedGroup}/{selectedSubgroup}/{renameTarget.fileName}</span>
              </p>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Novo Grupo
                <input value={renameToGroup} onChange={e => setRenameToGroup(e.target.value)} className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary" />
              </label>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Novo Subgrupo
                <input value={renameToSubgroup} onChange={e => setRenameToSubgroup(e.target.value)} className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary" />
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
