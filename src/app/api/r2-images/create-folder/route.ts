import { NextRequest, NextResponse } from 'next/server'
import { isValidFolderPath, folderHasContent, createFolder } from '@/lib/r2Images'
import { recordImageChange } from '@/lib/imageChangeLog'
import { getProfileById } from '@/lib/userProfileStore'

// Cria uma pasta vazia (antes só "nascia" implicitamente ao enviar a
// primeira imagem) — pedido explícito do usuário: "Quero conseguir criar
// uma nova pasta também." Ver createFolder em r2Images.ts pro mecanismo
// (objeto-marcador de 0 bytes, truque padrão de ferramentas S3).
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const path = String(body?.path ?? '').trim()

  if (!path) {
    return NextResponse.json({ error: 'Informe o caminho da nova pasta' }, { status: 400 })
  }
  if (!isValidFolderPath(path)) {
    return NextResponse.json({ error: 'Caminho de pasta inválido' }, { status: 400 })
  }

  try {
    const alreadyExists = await folderHasContent(path)
    if (alreadyExists) {
      return NextResponse.json({ error: `Já existe conteúdo em "${path}"` }, { status: 409 })
    }

    await createFolder(path)

    try {
      await recordImageChange({ action: 'upload', folderPath: path, fileName: '(pasta vazia criada)', profile })
    } catch { /* log é best-effort */ }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao criar a pasta no bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
