import { NextRequest, NextResponse } from 'next/server'
import { isValidFileName, isValidFolderPath, imageExists, copyImage, deleteImage, folderHasContent, createFolder } from '@/lib/r2Images'
import { recordImageChange } from '@/lib/imageChangeLog'
import { getProfileById } from '@/lib/userProfileStore'

// Corrige nome/pasta de um arquivo já enviado (seção 7.4 do manual da TI:
// "moveto renomeia (ou move) o arquivo dentro do bucket") — o R2/S3 não tem
// rename de verdade, então é sempre copy pro destino novo + delete do
// original, exatamente como o rclone faz. "path"/"toPath" são caminhos
// completos de pasta (profundidade livre), não mais um par fixo
// Grupo/Subgrupo — permite mover uma imagem pra qualquer nível.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const path = String(body?.path ?? '').trim()
  const fileName = String(body?.fileName ?? '').trim()
  const toPath = String(body?.toPath ?? '').trim()
  const toFileName = String(body?.toFileName ?? '').trim()

  if (!isValidFolderPath(path) || !isValidFileName(fileName)) {
    return NextResponse.json({ error: 'Pasta/arquivo de origem inválido' }, { status: 400 })
  }
  if (!isValidFolderPath(toPath) || !isValidFileName(toFileName)) {
    return NextResponse.json({ error: 'Pasta/arquivo de destino inválido' }, { status: 400 })
  }
  if (path === toPath && fileName === toFileName) {
    return NextResponse.json({ error: 'O destino é igual à origem — nada a fazer' }, { status: 400 })
  }

  try {
    const exists = await imageExists(path, fileName)
    if (!exists) {
      return NextResponse.json({ error: `Não existe imagem "${fileName}" em ${path || '(raiz)'}` }, { status: 404 })
    }
    const destExists = await imageExists(toPath, toFileName)
    if (destExists) {
      return NextResponse.json({
        error: `Já existe uma imagem "${toFileName}" em ${toPath || '(raiz)'} — remova-a antes, ou escolha outro destino`,
      }, { status: 409 })
    }

    await copyImage(path, fileName, toPath, toFileName)
    await deleteImage(path, fileName)

    // Se a imagem saiu de verdade da pasta de origem (não só trocou de nome
    // dentro dela) e a origem ficou sem nenhum conteúdo, cria um marcador
    // vazio pra ela não sumir da cascata — pedido explícito do usuário: "Não
    // quero isso" (que mover a última imagem de uma pasta apague a pasta
    // sozinha). No S3/R2 uma pasta só existe enquanto tiver algum objeto
    // com aquele prefixo (ver "Terminologia"/`createFolder` em
    // specs/imagens-r2.md) — sem isso, esvaziar uma pasta via mover é
    // indistinguível, pro bucket, de ela nunca ter existido. Best-effort:
    // nunca derruba o move em si, que já teve sucesso.
    if (path && path !== toPath) {
      try {
        const stillHasContent = await folderHasContent(path)
        if (!stillHasContent) await createFolder(path)
      } catch { /* preservar a pasta vazia é best-effort */ }
    }

    try {
      await recordImageChange({ action: 'rename', folderPath: path, fileName, toFolderPath: toPath, toFileName, profile })
    } catch { /* log é best-effort */ }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao renomear a imagem no bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
