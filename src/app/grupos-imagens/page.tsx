'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'

interface ImageObject {
  fileName: string
  size: number
  lastModified: string | null
  url: string
}
interface BrowseColumn {
  path: string
  folders: string[]
  files: ImageObject[]
}
interface SearchFileResult {
  folderPath: string
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

async function fetchBrowseColumn(profileId: string, path: string): Promise<BrowseColumn> {
  const res = await fetch(`/api/r2-images/browse?profileId=${profileId}&path=${encodeURIComponent(path)}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Falha ao consultar o bucket de imagens')
  return { path, folders: json.folders || [], files: json.files || [] }
}

export default function GruposImagensPage() {
  const { user } = useAppAuth()

  // ── Navegação em cascata (estilo colunas do Finder/macOS) ──────
  // pathSegments é o caminho selecionado; columns[0] é sempre a raiz,
  // columns[k] (k = 1..pathSegments.length) é o conteúdo de
  // pathSegments.slice(0, k) — uma caixa por nível, lado a lado, sem
  // precisar de um botão "subir": clicar numa pasta de uma coluna mais à
  // esquerda já corta tudo que vinha depois dela e abre o próximo nível.
  // Pedido explícito do usuário: "não ter o Subir de nível... quero a
  // visão de cascata, separada em caixas menores... e em níveis
  // cascateados".
  const [pathSegments, setPathSegments] = useState<string[]>([])
  const [columns, setColumns] = useState<BrowseColumn[]>([])
  const [browseLoading, setBrowseLoading] = useState(true)
  const [browseError, setBrowseError] = useState('')

  const currentPath = pathSegments.join('/')
  const currentColumn = columns[pathSegments.length] as BrowseColumn | undefined
  const files = currentColumn?.files ?? []

  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)
  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 4000)
  }

  const loadRoot = useCallback(async () => {
    setBrowseLoading(true)
    setBrowseError('')
    try {
      const root = await fetchBrowseColumn(user.id, '')
      setColumns([root])
      setPathSegments([])
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Falha de rede ao consultar o bucket de imagens')
    } finally {
      setBrowseLoading(false)
    }
  }, [user.id])

  useEffect(() => { if (user.isAdmin) loadRoot() }, [user.isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clique numa pasta dentro da coluna de índice colIdx — abre/substitui a
  // próxima coluna (colIdx + 1), descartando qualquer seleção mais
  // profunda que já existisse.
  const selectAt = async (colIdx: number, name: string) => {
    if (pathSegments[colIdx] === name) return // já selecionado, nada a fazer
    const newSegments = [...pathSegments.slice(0, colIdx), name]
    const newPath = newSegments.join('/')
    setBrowseLoading(true)
    setBrowseError('')
    try {
      const next = await fetchBrowseColumn(user.id, newPath)
      setColumns(prev => [...prev.slice(0, colIdx + 1), next])
      setPathSegments(newSegments)
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Falha de rede ao consultar o bucket de imagens')
    } finally {
      setBrowseLoading(false)
    }
  }

  // Breadcrumb — volta pra um nível já visitado sem precisar refazer a
  // requisição (as colunas anteriores já estão em memória).
  const navigateToIndex = (keepCount: number) => {
    setPathSegments(prev => prev.slice(0, keepCount))
    setColumns(prev => prev.slice(0, keepCount + 1))
  }

  // Carrega todas as colunas (raiz + um nível por segmento) de um caminho
  // qualquer de uma vez (Promise.all) — usada tanto por refreshAll (recarrega
  // o caminho atual) quanto por navigateToPath (pula direto pra um resultado
  // de busca, sem precisar clicar nível por nível na cascata).
  const loadPath = async (segments: string[]) => {
    setBrowseLoading(true)
    setBrowseError('')
    try {
      const paths = ['', ...segments.map((_, i) => segments.slice(0, i + 1).join('/'))]
      const results = await Promise.all(paths.map(p => fetchBrowseColumn(user.id, p)))
      setColumns(results)
      setPathSegments(segments)
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Falha de rede ao consultar o bucket de imagens')
    } finally {
      setBrowseLoading(false)
    }
  }

  // Recarrega todas as colunas abertas no momento (não só a mais funda) —
  // uma mudança em qualquer nível já visitado também deve aparecer.
  const refreshAll = () => loadPath(pathSegments)

  // Pula direto pra um caminho vindo de um resultado de busca (pasta ou a
  // pasta de uma imagem encontrada) — sai do modo de busca e navega até lá.
  const navigateToPath = (fullPath: string) => {
    setSearchQuery('')
    setSearchResults(null)
    loadPath(fullPath ? fullPath.split('/') : [])
  }

  // ── Busca global (pastas + imagens, bucket inteiro) ───────────
  // Pedido explícito do usuário: "Quero que você adicione um filtro de
  // pesquisa para todas as imagens e para todas as pastas também" — ao
  // contrário da navegação normal (sempre um nível por vez, lazy), a busca
  // varre o bucket inteiro sob demanda; substitui a cascata+grade enquanto
  // o campo tiver pelo menos 2 caracteres, com debounce pra não disparar
  // uma varredura completa a cada tecla.
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ folders: string[]; files: SearchFileResult[]; foldersTotal: number; filesTotal: number } | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const searchActive = searchQuery.trim().length >= 2

  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults(null); setSearchError(''); setSearching(false); return }
    setSearching(true)
    setSearchError('')
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/r2-images/search?profileId=${user.id}&q=${encodeURIComponent(q)}`)
        const json = await res.json()
        if (!res.ok) { setSearchError(json.error || 'Falha na busca'); return }
        setSearchResults({
          folders: json.folders || [],
          files: json.files || [],
          foldersTotal: json.foldersTotal ?? (json.folders || []).length,
          filesTotal: json.filesTotal ?? (json.files || []).length,
        })
      } catch {
        setSearchError('Falha de rede na busca')
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery, user.id])

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
      refreshAll()
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
      refreshAll()
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
      refreshAll()
    } catch {
      showToast('Falha de rede ao remover a imagem', true)
    } finally {
      setDeleting(null)
    }
  }

  // ── Seleção múltipla + exclusão em lote ─────────────────────
  // Pedido explícito do usuário: "quero ter o controle total das imagens,
  // que em cada imagem que eu possa selecionar mais de uma ao mesmo
  // tempo... que eu consiga deletar estas imagens". Seleção é sempre
  // relativa à pasta atual (nomes de arquivo só fazem sentido dentro dela)
  // — limpa automaticamente ao trocar de pasta, pra nunca arrastar uma
  // seleção "fantasma" de outro lugar.
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  useEffect(() => { setSelectedFiles(new Set()) }, [currentPath])

  const toggleSelected = (fileName: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(fileName)) next.delete(fileName)
      else next.add(fileName)
      return next
    })
  }
  const selectAllVisible = () => setSelectedFiles(new Set(files.map(f => f.fileName)))
  const clearSelection = () => setSelectedFiles(new Set())

  const [bulkDeleting, setBulkDeleting] = useState(false)
  const submitBulkDelete = async () => {
    const targets = Array.from(selectedFiles)
    if (targets.length === 0) return
    const ok = window.confirm(`Remover ${targets.length} imagem(ns) de ${currentPath || '(raiz)'}? Uma cópia de segurança é guardada no bucket pra cada uma, mas elas somem do ar imediatamente.`)
    if (!ok) return
    setBulkDeleting(true)
    // Sequencial de propósito (não Promise.all) — erro isolado por imagem e
    // ordem previsível, mesmo padrão de toda escrita em lote deste projeto.
    let okCount = 0
    let failCount = 0
    for (const fileName of targets) {
      try {
        const res = await fetch('/api/r2-images/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: user.id, path: currentPath, fileName }),
        })
        if (res.ok) okCount++
        else failCount++
      } catch {
        failCount++
      }
    }
    setBulkDeleting(false)
    clearSelection()
    refreshAll()
    if (failCount === 0) showToast(`${okCount} imagem(ns) removida(s)`)
    else showToast(`${okCount} removida(s), ${failCount} falharam`, true)
  }

  // ── Mover em lote (uma imagem ou várias selecionadas) ─────────
  // Pedido explícito do usuário: "Quero ter a capacidade de mover imagens
  // de uma pasta para outra, podem ser uma única imagem ou várias
  // selecionadas." O pop-up Renomear/Mover já existente (abaixo) cobre o
  // caso de uma imagem só (ele também só muda a pasta, deixando o nome
  // igual, se quiser); este modal novo é só pra mover várias de uma vez,
  // reusando a mesma rota POST /rename, uma chamada por imagem.
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkMoveToPath, setBulkMoveToPath] = useState('')
  const [bulkMoveSaving, setBulkMoveSaving] = useState(false)
  const [bulkMoveError, setBulkMoveError] = useState('')

  const openBulkMove = () => {
    setBulkMoveToPath(currentPath)
    setBulkMoveError('')
    setBulkMoveOpen(true)
  }

  const submitBulkMove = async () => {
    const targets = Array.from(selectedFiles)
    const toPath = bulkMoveToPath.trim()
    if (targets.length === 0) return
    if (toPath === currentPath) { setBulkMoveError('O destino é igual à pasta atual — nada a fazer'); return }
    setBulkMoveSaving(true)
    setBulkMoveError('')
    // Sequencial de propósito (não Promise.all) — erro isolado por imagem e
    // ordem previsível, mesmo padrão de toda escrita em lote deste projeto.
    let okCount = 0
    const failed: string[] = []
    for (const fileName of targets) {
      try {
        const res = await fetch('/api/r2-images/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: user.id, path: currentPath, fileName, toPath, toFileName: fileName }),
        })
        if (res.ok) okCount++
        else failed.push(fileName)
      } catch {
        failed.push(fileName)
      }
    }
    setBulkMoveSaving(false)
    setBulkMoveOpen(false)
    clearSelection()
    refreshAll()
    if (failed.length === 0) showToast(`${okCount} imagem(ns) movida(s) para ${toPath || '(raiz)'}`)
    else showToast(`${okCount} movida(s), ${failed.length} falharam (${failed.join(', ')})`, true)
  }

  // ── Renomear/mover uma pasta inteira ──────────────────────────
  // Pedido explícito do usuário: "Quero poder renomear uma pasta, é
  // possível?" — R2/S3 não tem rename de pasta nativo, a rota
  // /rename-folder copia toda a subárvore pro destino novo e só então
  // apaga a origem. Depois de um rename bem-sucedido, a navegação volta
  // pra raiz (loadRoot) em vez de só recarregar as colunas abertas — o
  // caminho da pasta renomeada pode não existir mais exatamente como
  // estava, então recomeçar do zero é mais seguro que tentar remendar o
  // estado de navegação atual.
  const [renameFolderTarget, setRenameFolderTarget] = useState<{ fromPath: string } | null>(null)
  const [renameFolderToPath, setRenameFolderToPath] = useState('')
  const [renameFolderSaving, setRenameFolderSaving] = useState(false)
  const [renameFolderError, setRenameFolderError] = useState('')

  const openRenameFolder = (colIdx: number, name: string) => {
    const fromPath = [...pathSegments.slice(0, colIdx), name].join('/')
    setRenameFolderTarget({ fromPath })
    setRenameFolderToPath(fromPath)
    setRenameFolderError('')
  }

  const submitRenameFolder = async () => {
    if (!renameFolderTarget) return
    const toPath = renameFolderToPath.trim()
    if (toPath === renameFolderTarget.fromPath) { setRenameFolderError('O destino é igual à origem — nada a fazer'); return }
    setRenameFolderSaving(true)
    setRenameFolderError('')
    try {
      const res = await fetch('/api/r2-images/rename-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: user.id, path: renameFolderTarget.fromPath, toPath }),
      })
      const json = await res.json()
      if (!res.ok) { setRenameFolderError(json.error || 'Falha ao renomear a pasta'); return }
      setRenameFolderTarget(null)
      showToast(`Pasta renomeada/movida (${json.moved ?? 0} imagem(ns))`)
      loadRoot()
    } catch {
      setRenameFolderError('Falha de rede ao renomear a pasta')
    } finally {
      setRenameFolderSaving(false)
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

      {/* Busca global — pastas e imagens em todo o bucket, não só no nível navegado */}
      <div className="relative mb-6">
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Buscar pasta ou imagem em todo o bucket (mínimo 2 letras)…"
          className="w-full bg-surface-container border border-outline-variant rounded-lg pl-4 pr-9 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            title="Limpar busca"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-primary"
          >
            ✕
          </button>
        )}
      </div>

      {browseError && !searchActive && <div className="text-error text-sm mb-4">⚠ {browseError}</div>}

      {searchActive && (
        <div className="flex flex-col gap-4 mb-6">
          {searchError && <div className="text-error text-sm">⚠ {searchError}</div>}
          {searching ? (
            <div className="text-sm text-outline">Buscando em todo o bucket…</div>
          ) : searchResults && (
            <>
              <div>
                <div className="text-sm font-semibold text-on-surface mb-2">
                  Pastas ({searchResults.foldersTotal}{searchResults.foldersTotal > searchResults.folders.length ? `, mostrando ${searchResults.folders.length}` : ''})
                </div>
                {searchResults.folders.length === 0 ? (
                  <div className="text-sm text-outline italic">Nenhuma pasta encontrada.</div>
                ) : (
                  <div className="bg-surface-container border border-outline-variant rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                    {searchResults.folders.map(f => (
                      <button
                        key={f}
                        onClick={() => navigateToPath(f)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors border-b border-outline-variant/40 last:border-b-0"
                      >
                        <span className="text-outline">🗀</span>
                        <span className="font-mono truncate">{f}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-on-surface mb-2">
                  Imagens ({searchResults.filesTotal}{searchResults.filesTotal > searchResults.files.length ? `, mostrando ${searchResults.files.length}` : ''})
                </div>
                {searchResults.files.length === 0 ? (
                  <div className="text-sm text-outline italic">Nenhuma imagem encontrada.</div>
                ) : (
                  <div className="bg-surface-container border border-outline-variant rounded-lg overflow-hidden">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-px bg-outline-variant/40">
                      {searchResults.files.map(f => (
                        <div key={`${f.folderPath}/${f.fileName}`} className="bg-surface-container p-3 flex flex-col gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f.url}
                            alt={f.fileName}
                            className="w-full h-32 object-contain bg-surface-container-low rounded border border-outline-variant/40"
                          />
                          <div className="font-mono text-xs text-on-surface truncate" title={f.fileName}>{f.fileName}</div>
                          <div className="text-xs text-outline truncate" title={f.folderPath}>{f.folderPath || '(raiz)'}</div>
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Abrir</a>
                            <button onClick={() => navigateToPath(f.folderPath)} className="text-on-surface-variant hover:text-primary">Ir até a pasta</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {!searchActive && (
      <>
      {/* Breadcrumb compacto — atalho pra voltar a um nível já aberto sem rolar as caixas */}
      <div className="flex items-center gap-1 flex-wrap text-sm mb-4 bg-surface-container border border-outline-variant rounded-lg px-4 py-2">
        <button
          onClick={() => navigateToIndex(0)}
          className={`hover:text-primary transition-colors ${pathSegments.length === 0 ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
        >
          🗀 Raiz
        </button>
        {pathSegments.map((seg, i) => {
          const isLast = i === pathSegments.length - 1
          return (
            <span key={i} className="flex items-center gap-1">
              <span className="text-outline">/</span>
              <button
                onClick={() => navigateToIndex(i + 1)}
                className={`hover:text-primary transition-colors ${isLast ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
              >
                {seg}
              </button>
            </span>
          )
        })}
        <button onClick={refreshAll} title="Recarregar" className="ml-auto text-outline hover:text-primary">⟳</button>
      </div>

      {/* Caixas em cascata, uma por nível — clicar numa pasta abre a próxima caixa à direita.
          Só mostra a caixa quando o nível tem pelo menos uma subpasta de verdade — pedido
          explícito do usuário: "não quero ver isso [Sem subpastas], quero ver só se tiver
          alguma subpasta mesmo". */}
      <div className="flex gap-3 overflow-x-auto pb-2 mb-6">
        {columns.map((col, i) => col.folders.length === 0 ? null : (
          <div key={i} className="shrink-0 w-56 bg-surface-container border border-outline-variant rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-outline-variant text-xs font-bold uppercase tracking-wide text-on-surface-variant truncate">
              {i === 0 ? '🗀 Raiz' : pathSegments[i - 1]}
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {col.folders.map(name => {
                const isSelected = pathSegments[i] === name
                return (
                  <div
                    key={name}
                    className={`group w-full flex items-center transition-colors ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-surface-container-high'
                    }`}
                  >
                    <button
                      onClick={() => selectAt(i, name)}
                      className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 text-left text-xs ${
                        isSelected ? 'text-primary font-semibold' : 'text-on-surface-variant'
                      }`}
                    >
                      <span className="text-outline">🗀</span>
                      <span className="truncate">{name}</span>
                    </button>
                    <button
                      onClick={() => openRenameFolder(i, name)}
                      title="Renomear/mover esta pasta"
                      className="shrink-0 px-2 text-outline hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✎
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Imagens do caminho selecionado (coluna mais profunda) */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-on-surface-variant">
            <span className="font-mono text-on-surface">{currentPath || '(raiz)'}</span>
            {' '}— {files.length} imagem{files.length !== 1 ? 'ns' : ''}
            {selectedFiles.size > 0 && <> · {selectedFiles.size} selecionada{selectedFiles.size !== 1 ? 's' : ''}</>}
          </div>
          <div className="flex items-center gap-2">
            {files.length > 0 && (
              <button
                onClick={selectedFiles.size === files.length ? clearSelection : selectAllVisible}
                className="px-3 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
              >
                {selectedFiles.size === files.length ? 'Limpar seleção' : 'Selecionar todas'}
              </button>
            )}
            {selectedFiles.size > 0 && (
              <button
                onClick={openBulkMove}
                className="px-3 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
              >
                Mover selecionadas ({selectedFiles.size})
              </button>
            )}
            {selectedFiles.size > 0 && (
              <button
                onClick={submitBulkDelete}
                disabled={bulkDeleting}
                className="px-3 py-2 text-sm border border-error/40 rounded text-error hover:bg-error-container/20 disabled:opacity-50 transition-colors"
              >
                {bulkDeleting ? 'Removendo…' : `Excluir selecionadas (${selectedFiles.size})`}
              </button>
            )}
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
              {files.map(img => {
                const isSelected = selectedFiles.has(img.fileName)
                return (
                <div key={img.fileName} className={`p-3 flex flex-col gap-2 transition-colors ${isSelected ? 'bg-primary/10' : 'bg-surface-container'}`}>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(img.fileName)}
                      className="mt-1 shrink-0"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.fileName}
                      className="w-full h-32 object-contain bg-surface-container-low rounded border border-outline-variant/40"
                    />
                  </label>
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
                )
              })}
            </div>
          )}
        </div>
      </div>
      </>
      )}

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
                  {(currentColumn?.folders ?? []).map(f => <option key={f} value={currentPath ? `${currentPath}/${f}` : f} />)}
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

      {/* Pop-up Mover selecionadas (em lote) */}
      {bulkMoveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setBulkMoveOpen(false)}>
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-outline-variant">
              <span className="text-base font-semibold text-on-surface">Mover {selectedFiles.size} imagem(ns)</span>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-xs text-outline">
                De: <span className="font-mono text-on-surface">{currentPath || '(raiz)'}</span> — o nome de cada
                arquivo é mantido, só a pasta muda. Se já existir uma imagem com o mesmo nome no destino, essa em
                particular falha (as outras continuam normalmente).
              </p>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Pasta de destino
                <input
                  value={bulkMoveToPath}
                  onChange={e => setBulkMoveToPath(e.target.value)}
                  placeholder="ex: Acessórios/CAMERAS"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
                />
              </label>
              {bulkMoveError && (
                <div className="text-error text-xs bg-error-container/20 border border-error/30 rounded px-3 py-2">⚠ {bulkMoveError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant">
              <button type="button" onClick={() => setBulkMoveOpen(false)} disabled={bulkMoveSaving} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitBulkMove}
                disabled={bulkMoveSaving || !bulkMoveToPath.trim()}
                className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-60 transition-shadow"
              >
                {bulkMoveSaving ? 'Movendo…' : 'Mover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Renomear pasta */}
      {renameFolderTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setRenameFolderTarget(null)}>
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-outline-variant">
              <span className="text-base font-semibold text-on-surface">Renomear / mover pasta</span>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-xs text-outline">
                De: <span className="font-mono text-on-surface">{renameFolderTarget.fromPath}</span> — move todo o
                conteúdo (qualquer profundidade) pro caminho novo. Se já existir alguma coisa no destino, a operação
                é recusada (escolha outro caminho, ou mova/limpe o destino primeiro).
              </p>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Novo caminho
                <input
                  value={renameFolderToPath}
                  onChange={e => setRenameFolderToPath(e.target.value)}
                  placeholder="ex: Acessórios/CAMERAS"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
                />
              </label>
              {renameFolderError && (
                <div className="text-error text-xs bg-error-container/20 border border-error/30 rounded px-3 py-2">⚠ {renameFolderError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant">
              <button type="button" onClick={() => setRenameFolderTarget(null)} disabled={renameFolderSaving} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitRenameFolder}
                disabled={renameFolderSaving || !renameFolderToPath.trim()}
                className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-60 transition-shadow"
              >
                {renameFolderSaving ? 'Movendo…' : 'Confirmar'}
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
