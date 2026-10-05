import { NextRequest, NextResponse } from 'next/server'
import { isValidFileName, isValidFolderPath, imageExists, deleteImage, backupImage, folderHasContent, createFolder } from '@/lib/r2Images'
import { recordImageChange } from '@/lib/imageChangeLog'
import { getProfileById } from '@/lib/userProfileStore'

// Remove uma imagem (seção 7.5 do manual da TI) — "a remoção é imediata e
// não há lixeira no bucket". Guarda uma cópia de segurança (backupImage)
// antes de apagar, automático aqui (o manual pede isso como passo manual).
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const path = String(body?.path ?? '').trim()
  const fileName = String(body?.fileName ?? '').trim()
  if (!isValidFolderPath(path) || !isValidFileName(fileName)) {
    return NextResponse.json({ error: 'Pasta/arquivo inválido' }, { status: 400 })
  }

  try {
    const exists = await imageExists(path, fileName)
    if (!exists) {
      return NextResponse.json({ error: `Não existe imagem "${fileName}" em ${path || '(raiz)'}` }, { status: 404 })
    }

    const backupKey = await backupImage(path, fileName)
    await deleteImage(path, fileName)

    // Mesma proteção do move (ver POST /rename) — pedido explícito do
    // usuário: "Faz o mesmo quando excluir a última imagem também". Se a
    // pasta ficou sem nenhum conteúdo depois dessa remoção, cria um
    // marcador vazio ali pra ela não sumir sozinha da cascata. Best-effort:
    // nunca derruba a remoção em si, que já teve sucesso.
    if (path) {
      try {
        const stillHasContent = await folderHasContent(path)
        if (!stillHasContent) await createFolder(path)
      } catch { /* preservar a pasta vazia é best-effort */ }
    }

    try {
      await recordImageChange({ action: 'delete', folderPath: path, fileName, backupKey, profile })
    } catch { /* log é best-effort */ }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao remover a imagem do bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
