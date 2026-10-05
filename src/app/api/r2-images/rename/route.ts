import { NextRequest, NextResponse } from 'next/server'
import { isValidFileName, isValidSegmentName, imageExists, copyImage, deleteImage } from '@/lib/r2Images'
import { recordImageChange } from '@/lib/imageChangeLog'
import { getProfileById } from '@/lib/userProfileStore'

// Corrige nome/pasta de um arquivo já enviado (seção 7.4 do manual da TI:
// "moveto renomeia (ou move) o arquivo dentro do bucket") — o R2/S3 não tem
// rename de verdade, então é sempre copy pro destino novo + delete do
// original, exatamente como o rclone faz.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const group = String(body?.group ?? '').trim()
  const subgroup = String(body?.subgroup ?? '').trim()
  const fileName = String(body?.fileName ?? '').trim()
  const toGroup = String(body?.toGroup ?? '').trim()
  const toSubgroup = String(body?.toSubgroup ?? '').trim()
  const toFileName = String(body?.toFileName ?? '').trim()

  if (!isValidSegmentName(group) || !isValidSegmentName(subgroup) || !isValidFileName(fileName)) {
    return NextResponse.json({ error: 'Grupo/Subgrupo/arquivo de origem inválido' }, { status: 400 })
  }
  if (!isValidSegmentName(toGroup) || !isValidSegmentName(toSubgroup) || !isValidFileName(toFileName)) {
    return NextResponse.json({ error: 'Grupo/Subgrupo/arquivo de destino inválido' }, { status: 400 })
  }
  if (group === toGroup && subgroup === toSubgroup && fileName === toFileName) {
    return NextResponse.json({ error: 'O destino é igual à origem — nada a fazer' }, { status: 400 })
  }

  try {
    const exists = await imageExists(group, subgroup, fileName)
    if (!exists) {
      return NextResponse.json({ error: `Não existe imagem "${fileName}" em ${group}/${subgroup}` }, { status: 404 })
    }
    const destExists = await imageExists(toGroup, toSubgroup, toFileName)
    if (destExists) {
      return NextResponse.json({
        error: `Já existe uma imagem "${toFileName}" em ${toGroup}/${toSubgroup} — remova-a antes, ou escolha outro destino`,
      }, { status: 409 })
    }

    await copyImage(group, subgroup, fileName, toGroup, toSubgroup, toFileName)
    await deleteImage(group, subgroup, fileName)

    try {
      await recordImageChange({ action: 'rename', group, subgroup, fileName, toGroup, toSubgroup, toFileName, profile })
    } catch { /* log é best-effort */ }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao renomear a imagem no bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
