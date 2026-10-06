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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

async function fetchBrowseColumn(profileId: string, path: string): Promise<BrowseColumn> {
  const res = await fetch(`/api/r2-images/browse?profileId=${profileId}&path=${encodeURIComponent(path)}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Falha ao consultar o bucket de imagens')
  return { path, folders: json.folders || [], files: json.files || [] }
}

// Pop-up de escolha de pasta por árvore — pedido explícito do usuário:
// "quando eu usar a função de Mover imagem, quero ter um pop-up para ver a
// árvore de pastas... hoje está apenas um caminho de texto". Mesmo visual
// de cascata (colunas lado a lado) da navegação principal da tela, só que
// confinado a este pop-up e só com pastas (nenhuma imagem é mostrada aqui
// — não faz sentido escolher um arquivo como destino de um move). Não
// substitui o campo de texto, só o preenche: a pessoa ainda pode digitar
// um caminho novo (uma pasta que ainda não existe) direto no input, se
// preferir — o pop-up é só uma forma mais rápida de apontar pra uma pasta
// já existente.
function FolderTreePicker({
  userId,
  initialPath,
  onSelect,
  onClose,
}: {
  userId: string
  initialPath: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const initialSegments = initialPath ? initialPath.split('/').filter(Boolean) : []
  const [pathSegments, setPathSegments] = useState<string[]>(initialSegments)
  const [columns, setColumns] = useState<BrowseColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Carrega a raiz e, em sequência, cada segmento do caminho inicial — pra
  // o pop-up já abrir navegado até onde o campo de texto já apontava, em
  // vez de sempre começar do zero.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const root = await fetchBrowseColumn(userId, '')
        if (cancelled) return
        const cols: BrowseColumn[] = [root]
        for (let i = 0; i < initialSegments.length; i++) {
          const segPath = initialSegments.slice(0, i + 1).join('/')
          const col = await fetchBrowseColumn(userId, segPath)
          if (cancelled) return
          cols.push(col)
        }
        if (!cancelled) setColumns(cols)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao consultar o bucket de imagens')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const currentPath = pathSegments.join('/')

  const selectAt = async (colIdx: number, name: string) => {
    if (pathSegments[colIdx] === name) {
      setPathSegments(pathSegments.slice(0, colIdx + 1))
      return
    }
    const newSegments = [...pathSegments.slice(0, colIdx), name]
    const newPath = newSegments.join('/')
    setLoading(true)
    setError('')
    try {
      const next = await fetchBrowseColumn(userId, newPath)
      setColumns(prev => [...prev.slice(0, colIdx + 1), next])
      setPathSegments(newSegments)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao consultar o bucket de imagens')
    } finally {
      setLoading(false)
    }
  }

  // idx = -1 volta pra raiz; idx = k mantém pathSegments[0..k]
  const navigateToIndex = (idx: number) => setPathSegments(prev => prev.slice(0, idx + 1))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-outline-variant flex items-center justify-between">
          <span className="text-base font-semibold text-on-surface">Escolher pasta de destino</span>
          <button type="button" onClick={onClose} className="text-on-surface-variant hover:text-on-surface text-xl leading-none">✕</button>
        </div>
        <div className="px-5 py-3 border-b border-outline-variant text-xs text-outline flex items-center gap-1 flex-wrap">
          <button type="button" onClick={() => navigateToIndex(-1)} className="hover:text-primary hover:underline">🗀 Raiz</button>
          {pathSegments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span>/</span>
              <button type="button" onClick={() => navigateToIndex(i)} className="hover:text-primary hover:underline">{seg}</button>
            </span>
          ))}
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          {error && <div className="text-error text-xs bg-error-container/20 border border-error/30 rounded px-3 py-2 mb-3">⚠ {error}</div>}
          {loading && columns.length === 0 ? (
            <p className="text-sm text-outline">Carregando…</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {columns.map((col, colIdx) => (
                col.folders.length > 0 && (
                  <div key={colIdx} className="w-56 shrink-0 border border-outline-variant rounded-lg overflow-hidden">
                    <div className="bg-surface-container-high px-3 py-2 text-xs font-semibold text-on-surface-variant border-b border-outline-variant">
                      {colIdx === 0 ? 'Raiz' : pathSegments[colIdx - 1]}
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {col.folders.map(name => (
                        <button
                          type="button"
                          key={name}
                          onClick={() => selectAt(colIdx, name)}
                          title={name}
                          className={`w-full text-left px-3 py-2 text-sm truncate hover:bg-surface-container-high ${pathSegments[colIdx] === name ? 'bg-primary-container/40 text-primary font-semibold' : 'text-on-surface'}`}
                        >
                          🗀 {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-outline-variant">
          <p className="text-xs text-outline truncate">
            Selecionado: <span className="font-mono text-on-surface">{currentPath || '(raiz)'}</span>
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onSelect(currentPath)}
              className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow"
            >
              Selecionar esta pasta
            </button>
          </div>
        </div>
      </div>
    </div>
  )
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

  const runSearch = useCallback(async (q: string) => {
    setSearching(true)
    setSearchError('')
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
  }, [user.id])

  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults(null); setSearchError(''); setSearching(false); return }
    setSearching(true)
    setSearchError('')
    const timer = setTimeout(() => runSearch(q), 400)
    return () => clearTimeout(timer)
  }, [searchQuery, runSearch])

  // Recarrega depois de editar uma imagem (substituir/renomear/remover) —
  // se a edição veio de um resultado de busca, refaz a busca (o item pode
  // ter saído do resultado, ex. depois de renomear); senão recarrega a
  // navegação normal, como já fazia antes de existir busca.
  const refreshAfterChange = () => {
    const q = searchQuery.trim()
    if (q.length >= 2) runSearch(q)
    else refreshAll()
  }

  // ── Adicionar / Substituir ──────────────────────────────────
  // Pedido explícito do usuário: "tenho no pop-up que selecionar a imagem e
  // ainda preencher o nome do arquivo? Não faz sentido, a imagem é o
  // arquivo, e o nome da imagem é o nome do arquivo. Quero poder selecionar
  // várias imagens de uma só vez." — o campo "Nome do arquivo" separado só
  // fazia sentido mesmo no fluxo de "Substituir" disparado por uma linha já
  // existente (`openReplace`): ali o nome-alvo é fixo (a imagem que já está
  // cadastrada), e o arquivo novo selecionado no disco pode ter outro nome
  // — o nome final tem que continuar sendo o da linha, não o do arquivo
  // local. `addTargetFileName` (não-nulo só nesse fluxo) guarda esse nome
  // fixo; fora dele (abrindo pelo botão "+ Adicionar imagem" do topo), o
  // nome de cada arquivo enviado é sempre o próprio `File.name`, nunca
  // digitado — e o seletor aceita múltiplos arquivos de uma vez.
  const [addOpen, setAddOpen] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addTargetFileName, setAddTargetFileName] = useState<string | null>(null)
  const [addFiles, setAddFiles] = useState<File[]>([])
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const openAddForm = () => {
    setAddPath(currentPath)
    setAddTargetFileName(null)
    setAddFiles([])
    setAddError('')
    setAddOpen(true)
  }

  const submitAdd = async (mode: 'add' | 'replace') => {
    if (addFiles.length === 0) {
      setAddError('Selecione ao menos uma imagem')
      return
    }
    setAddSaving(true)
    setAddError('')
    // Sequencial de propósito (não Promise.all) — mesmo padrão de toda
    // escrita em lote deste projeto: erro isolado por arquivo, ordem
    // previsível (ver specs/custeio-financeiro.md).
    let okCount = 0
    const failed: string[] = []
    for (const file of addFiles) {
      const fileName = (addTargetFileName ?? file.name).trim()
      try {
        const form = new FormData()
        form.set('profileId', user.id)
        form.set('path', addPath.trim())
        form.set('fileName', fileName)
        form.set('mode', mode)
        form.set('file', file)
        const res = await fetch('/api/r2-images/upload', { method: 'POST', body: form })
        if (res.ok) {
          okCount++
        } else {
          const json = await res.json().catch(() => ({}))
          failed.push(`${fileName}${json.error ? ` — ${json.error}` : ''}`)
        }
      } catch {
        failed.push(`${fileName} — falha de rede`)
      }
    }
    setAddSaving(false)
    if (failed.length === 0) {
      setAddOpen(false)
      showToast(okCount === 1
        ? (mode === 'replace' ? 'Imagem substituída' : 'Imagem adicionada')
        : `${okCount} imagem(ns) ${mode === 'replace' ? 'substituída(s)' : 'adicionada(s)'}`)
    } else {
      setAddError(`${okCount} enviada(s), ${failed.length} falharam: ${failed.join('; ')}`)
    }
    refreshAfterChange()
  }

  // Substituir direto numa linha já existente — mesmo formulário de cima,
  // só pré-preenchido com o nome-alvo fixo e já mandando mode=replace.
  // folderPath é explícito (default = pasta atual) pra também funcionar em
  // cima de um resultado de busca, que pode estar numa pasta diferente da
  // navegada no momento — pedido explícito do usuário: "Quero poder editar
  // as imagens que estão sendo apresentadas no meu filtro".
  const openReplace = (img: { fileName: string }, folderPath: string = currentPath) => {
    setAddPath(folderPath)
    setAddTargetFileName(img.fileName)
    setAddFiles([])
    setAddError('')
    setAddOpen(true)
  }

  // ── Pop-up de escolha de pasta por árvore (compartilhado entre o
  // Renomear/Mover de uma imagem e o Mover em lote) — pedido explícito do
  // usuário, ver FolderTreePicker acima.
  const [folderPickerFor, setFolderPickerFor] = useState<'rename' | 'bulk' | null>(null)

  // ── Renomear/Mover ───────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<{ fileName: string; fromPath: string } | null>(null)
  const [renameToPath, setRenameToPath] = useState('')
  const [renameToFileName, setRenameToFileName] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [renameError, setRenameError] = useState('')

  const openRename = (img: { fileName: string }, folderPath: string = currentPath) => {
    setRenameTarget({ fileName: img.fileName, fromPath: folderPath })
    setRenameToPath(folderPath)
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
          path: renameTarget.fromPath, fileName: renameTarget.fileName,
          toPath: renameToPath.trim(), toFileName: renameToFileName.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setRenameError(json.error || 'Falha ao renomear a imagem'); return }
      setRenameTarget(null)
      showToast('Imagem renomeada/movida')
      refreshAfterChange()
    } catch {
      setRenameError('Falha de rede ao renomear a imagem')
    } finally {
      setRenameSaving(false)
    }
  }

  // ── Remover ──────────────────────────────────────────────────
  // Chave composta pasta+arquivo (não só o nome) — evita que remover uma
  // imagem numa pasta deixe o botão de outra imagem com o mesmo nome, mas
  // em pasta diferente, também parecendo "removendo" (pode acontecer com
  // resultados de busca, que mostram várias pastas ao mesmo tempo).
  const [deleting, setDeleting] = useState<string | null>(null)
  const removeImage = async (img: { fileName: string }, folderPath: string = currentPath) => {
    const ok = window.confirm(`Remover "${img.fileName}" de ${folderPath || '(raiz)'}? A remoção é definitiva, sem cópia de segurança — a imagem some do ar imediatamente.`)
    if (!ok) return
    const key = `${folderPath}/${img.fileName}`
    setDeleting(key)
    try {
      const res = await fetch('/api/r2-images/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: user.id, path: folderPath, fileName: img.fileName }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || 'Falha ao remover a imagem', true); return }
      showToast('Imagem removida')
      refreshAfterChange()
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
    const ok = window.confirm(`Remover ${targets.length} imagem(ns) de ${currentPath || '(raiz)'}? A remoção é definitiva, sem cópia de segurança — elas somem do ar imediatamente.`)
    if (!ok) return
    setBulkDeleting(true)
    // Sequencial de propósito (não Promise.all) — erro isolado por imagem e
    // ordem previsível, mesmo padrão de toda escrita em lote deste projeto.
    let okCount = 0
    let failCount = 0
    let firstError = ''
    for (const fileName of targets) {
      try {
        const res = await fetch('/api/r2-images/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: user.id, path: currentPath, fileName }),
        })
        if (res.ok) {
          okCount++
        } else {
          failCount++
          // Guarda só a 1ª mensagem de erro (`json.error`, a mesma que o
          // delete individual já mostra) — achado real: até esta correção o
          // lote descartava o motivo de cada falha e mostrava sempre "N
          // falharam" sem explicar por quê, mesmo quando todas falhavam pelo
          // mesmo erro de verdade (ex.: credencial/permissão do bucket).
          if (!firstError) {
            try { const json = await res.json(); firstError = json.error || '' } catch { /* resposta sem corpo JSON */ }
          }
        }
      } catch {
        failCount++
      }
    }
    setBulkDeleting(false)
    clearSelection()
    refreshAll()
    if (failCount === 0) showToast(`${okCount} imagem(ns) removida(s)`)
    else showToast(`${okCount} removida(s), ${failCount} falharam${firstError ? ` — ${firstError}` : ''}`, true)
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

  // ── Remover uma pasta inteira ──────────────────────────────────
  // Pedido explícito do usuário: "Quero poder deletar uma pasta por
  // completo." Sem cópia de segurança (ver "Backup automático removido"
  // em specs/imagens-r2.md) — ver deleteFolder em r2Images.ts. Depois de
  // remover, volta pra raiz (loadRoot), mesmo motivo do rename de pasta: o
  // caminho atual pode não existir mais como estava.
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null)
  const removeFolder = async (colIdx: number, name: string) => {
    const path = [...pathSegments.slice(0, colIdx), name].join('/')
    const ok = window.confirm(`Remover a pasta "${path}" e TODO o conteúdo dela (qualquer profundidade)? A remoção é definitiva, sem cópia de segurança — a pasta some do ar imediatamente.`)
    if (!ok) return
    setDeletingFolder(path)
    try {
      const res = await fetch('/api/r2-images/delete-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: user.id, path }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || 'Falha ao remover a pasta', true); return }
      showToast(`Pasta removida (${json.count ?? 0} imagem(ns))`)
      loadRoot()
    } catch {
      showToast('Falha de rede ao remover a pasta', true)
    } finally {
      setDeletingFolder(null)
    }
  }

  // ── Criar pasta vazia ──────────────────────────────────────────
  // Pedido explícito do usuário: "Quero conseguir criar uma nova pasta
  // também" — até aqui uma pasta só "nascia" implicitamente ao enviar a
  // primeira imagem; agora dá pra criar uma vazia (ver createFolder em
  // r2Images.ts). Depois de criar, navega direto pra dentro dela.
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderPath, setNewFolderPath] = useState('')
  const [newFolderSaving, setNewFolderSaving] = useState(false)
  const [newFolderError, setNewFolderError] = useState('')

  const openNewFolder = () => {
    setNewFolderPath(currentPath)
    setNewFolderError('')
    setNewFolderOpen(true)
  }

  const submitNewFolder = async () => {
    const path = newFolderPath.trim()
    if (!path) { setNewFolderError('Informe o caminho da nova pasta'); return }
    setNewFolderSaving(true)
    setNewFolderError('')
    try {
      const res = await fetch('/api/r2-images/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: user.id, path }),
      })
      const json = await res.json()
      if (!res.ok) { setNewFolderError(json.error || 'Falha ao criar a pasta'); return }
      setNewFolderOpen(false)
      showToast('Pasta criada')
      loadPath(path.split('/'))
    } catch {
      setNewFolderError('Falha de rede ao criar a pasta')
    } finally {
      setNewFolderSaving(false)
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
                            <button onClick={() => openReplace(f, f.folderPath)} className="text-on-surface-variant hover:text-primary">Substituir</button>
                            <button onClick={() => openRename(f, f.folderPath)} className="text-on-surface-variant hover:text-primary">Renomear</button>
                            <button
                              onClick={() => removeImage(f, f.folderPath)}
                              disabled={deleting === `${f.folderPath}/${f.fileName}`}
                              className="text-error hover:underline disabled:opacity-50"
                            >
                              {deleting === `${f.folderPath}/${f.fileName}` ? 'Removendo…' : 'Remover'}
                            </button>
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
                    <button
                      onClick={() => removeFolder(i, name)}
                      disabled={deletingFolder === [...pathSegments.slice(0, i), name].join('/')}
                      title="Remover esta pasta e todo o conteúdo dela"
                      className="shrink-0 px-2 text-outline hover:text-error opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-100 disabled:text-error"
                    >
                      {deletingFolder === [...pathSegments.slice(0, i), name].join('/') ? '…' : '🗑'}
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
              onClick={openNewFolder}
              className="px-3 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
            >
              + Nova pasta
            </button>
            <button
              onClick={openAddForm}
              className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-all"
            >
              + Adicionar imagem
            </button>
          </div>
        </div>


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
                      disabled={deleting === `${currentPath}/${img.fileName}`}
                      className="text-error hover:underline disabled:opacity-50"
                    >
                      {deleting === `${currentPath}/${img.fileName}` ? 'Removendo…' : 'Remover'}
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
              <span className="text-base font-semibold text-on-surface">
                {addTargetFileName ? 'Substituir imagem' : 'Adicionar / Substituir imagem'}
              </span>
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
              {addTargetFileName ? (
                <>
                  <p className="text-xs text-outline">
                    Substituindo: <span className="font-mono text-on-surface">{addTargetFileName}</span> — o nome
                    não muda, só o conteúdo da imagem.
                  </p>
                  <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                    Novo arquivo (.png)
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png"
                      onChange={e => setAddFiles(e.target.files?.[0] ? [e.target.files[0]] : [])}
                      className="text-sm text-on-surface"
                    />
                  </label>
                </>
              ) : (
                <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                  Arquivo(s) (.png) — o nome de cada imagem já vem do próprio arquivo selecionado
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png"
                    multiple
                    onChange={e => setAddFiles(Array.from(e.target.files ?? []))}
                    className="text-sm text-on-surface"
                  />
                  {addFiles.length > 0 && (
                    <span className="text-xs text-outline font-mono">
                      {addFiles.length} arquivo(s): {addFiles.map(f => f.name).join(', ')}
                    </span>
                  )}
                </label>
              )}
              {addError && (
                <div className="text-error text-xs bg-error-container/20 border border-error/30 rounded px-3 py-2">⚠ {addError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant">
              <button type="button" onClick={() => setAddOpen(false)} disabled={addSaving} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50">
                Cancelar
              </button>
              {!addTargetFileName && (
                <button
                  type="button"
                  onClick={() => submitAdd('replace')}
                  disabled={addSaving}
                  title="Use se já existe imagem com o mesmo nome dos arquivos selecionados nessa pasta"
                  className="px-4 py-2 text-sm border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
                >
                  Substituir existente{addFiles.length > 1 ? `s (${addFiles.length})` : ''}
                </button>
              )}
              <button
                type="button"
                onClick={() => submitAdd(addTargetFileName ? 'replace' : 'add')}
                disabled={addSaving}
                className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-60 transition-shadow"
              >
                {addSaving
                  ? 'Enviando…'
                  : addTargetFileName
                    ? 'Substituir'
                    : `Adicionar nova${addFiles.length > 1 ? `s (${addFiles.length})` : ''}`}
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
                De: <span className="font-mono text-on-surface">{renameTarget.fromPath || '(raiz)'}/{renameTarget.fileName}</span>
              </p>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Nova pasta
                <div className="flex items-center gap-2">
                  <input
                    value={renameToPath}
                    onChange={e => setRenameToPath(e.target.value)}
                    placeholder="ex: Acessórios/CAMERAS"
                    className="flex-1 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setFolderPickerFor('rename')}
                    className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:text-primary border border-outline-variant rounded whitespace-nowrap"
                  >
                    🗀 Escolher pasta
                  </button>
                </div>
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
                <div className="flex items-center gap-2">
                  <input
                    value={bulkMoveToPath}
                    onChange={e => setBulkMoveToPath(e.target.value)}
                    placeholder="ex: Acessórios/CAMERAS"
                    className="flex-1 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setFolderPickerFor('bulk')}
                    className="px-3 py-2 text-xs font-semibold text-on-surface-variant hover:text-primary border border-outline-variant rounded whitespace-nowrap"
                  >
                    🗀 Escolher pasta
                  </button>
                </div>
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

      {/* Pop-up Escolher pasta por árvore (Renomear/Mover imagem e Mover em lote) */}
      {folderPickerFor && (
        <FolderTreePicker
          userId={user.id}
          initialPath={folderPickerFor === 'rename' ? renameToPath : bulkMoveToPath}
          onClose={() => setFolderPickerFor(null)}
          onSelect={path => {
            if (folderPickerFor === 'rename') setRenameToPath(path)
            else setBulkMoveToPath(path)
            setFolderPickerFor(null)
          }}
        />
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

      {/* Pop-up Nova pasta */}
      {newFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setNewFolderOpen(false)}>
          <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-outline-variant">
              <span className="text-base font-semibold text-on-surface">Nova pasta</span>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-xs text-outline">
                Caminho completo da pasta nova (ex: Acessórios/CAMERAS) — pode ter qualquer profundidade. Fica vazia
                até a primeira imagem ser enviada pra lá.
              </p>
              <label className="text-xs font-semibold text-on-surface-variant flex flex-col gap-1">
                Caminho
                <input
                  value={newFolderPath}
                  onChange={e => setNewFolderPath(e.target.value)}
                  placeholder="ex: Acessórios/CAMERAS"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
                />
              </label>
              {newFolderError && (
                <div className="text-error text-xs bg-error-container/20 border border-error/30 rounded px-3 py-2">⚠ {newFolderError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant">
              <button type="button" onClick={() => setNewFolderOpen(false)} disabled={newFolderSaving} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitNewFolder}
                disabled={newFolderSaving || !newFolderPath.trim()}
                className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-60 transition-shadow"
              >
                {newFolderSaving ? 'Criando…' : 'Criar'}
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
