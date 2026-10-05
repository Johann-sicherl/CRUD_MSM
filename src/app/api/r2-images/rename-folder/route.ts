import { NextRequest, NextResponse } from 'next/server'
import { isValidFolderPath, folderHasContent, renameFolder } from '@/lib/r2Images'
import { recordImageChange } from '@/lib/imageChangeLog'
import { getProfileById } from '@/lib/userProfileStore'

// Renomeia/move uma pasta inteira (todo o conteúdo, qualquer profundidade)
// — pedido explícito do usuário: "Quero poder renomear uma pasta, é
// possível?". Diferente de /rename (um arquivo por vez): aqui path/toPath
// são as PASTAS de origem/destino, sem fileName — move tudo que está
// dentro, preservando a subárvore.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const path = String(body?.path ?? '').trim()
  const toPath = String(body?.toPath ?? '').trim()

  if (!path) {
    return NextResponse.json({ error: 'Não é possível renomear a raiz' }, { status: 400 })
  }
  if (!isValidFolderPath(path) || !isValidFolderPath(toPath)) {
    return NextResponse.json({ error: 'Caminho de pasta inválido' }, { status: 400 })
  }
  if (!toPath) {
    return NextResponse.json({ error: 'Informe a pasta de destino' }, { status: 400 })
  }
  if (path === toPath) {
    return NextResponse.json({ error: 'O destino é igual à origem — nada a fazer' }, { status: 400 })
  }

  try {
    const sourceHasContent = await folderHasContent(path)
    if (!sourceHasContent) {
      return NextResponse.json({ error: `Pasta "${path}" não encontrada ou vazia` }, { status: 404 })
    }
    const destHasContent = await folderHasContent(toPath)
    if (destHasContent) {
      return NextResponse.json({
        error: `Já existe conteúdo em "${toPath}" — escolha outro destino, ou mova/renomeie o que já está lá primeiro`,
      }, { status: 409 })
    }

    const moved = await renameFolder(path, toPath)

    try {
      const label = `(pasta — ${moved} imagem${moved !== 1 ? 'ns' : ''})`
      await recordImageChange({ action: 'rename', folderPath: path, fileName: label, toFolderPath: toPath, toFileName: label, profile })
    } catch { /* log é best-effort */ }

    return NextResponse.json({ ok: true, moved })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao renomear a pasta no bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
