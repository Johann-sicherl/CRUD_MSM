import { NextRequest, NextResponse } from 'next/server'
import { isValidFolderPath, folderHasContent, deleteFolder } from '@/lib/r2Images'
import { recordImageChange } from '@/lib/imageChangeLog'
import { getProfileById } from '@/lib/userProfileStore'

// Remove uma pasta inteira (todo o conteúdo, qualquer profundidade) — pedido
// explícito do usuário: "Quero poder deletar uma pasta por completo."
// backup automático de cada arquivo antes de apagar (ver deleteFolder em
// r2Images.ts), igual ao delete de uma imagem avulsa, só que pra subárvore
// inteira.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const path = String(body?.path ?? '').trim()

  if (!path) {
    return NextResponse.json({ error: 'Não é possível remover a raiz' }, { status: 400 })
  }
  if (!isValidFolderPath(path)) {
    return NextResponse.json({ error: 'Caminho de pasta inválido' }, { status: 400 })
  }

  try {
    const hasContent = await folderHasContent(path)
    if (!hasContent) {
      return NextResponse.json({ error: `Pasta "${path}" não encontrada ou vazia` }, { status: 404 })
    }

    const { count, backupPrefix } = await deleteFolder(path)

    try {
      const label = `(pasta — ${count} imagem${count !== 1 ? 'ns' : ''})`
      await recordImageChange({ action: 'delete', folderPath: path, fileName: label, backupKey: backupPrefix, profile })
    } catch { /* log é best-effort */ }

    return NextResponse.json({ ok: true, count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao remover a pasta no bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
