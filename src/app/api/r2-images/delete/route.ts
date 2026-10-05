import { NextRequest, NextResponse } from 'next/server'
import { isValidFileName, isValidSegmentName, imageExists, deleteImage, backupImage } from '@/lib/r2Images'
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

  const group = String(body?.group ?? '').trim()
  const subgroup = String(body?.subgroup ?? '').trim()
  const fileName = String(body?.fileName ?? '').trim()
  if (!isValidSegmentName(group) || !isValidSegmentName(subgroup) || !isValidFileName(fileName)) {
    return NextResponse.json({ error: 'Grupo/Subgrupo/arquivo inválido' }, { status: 400 })
  }

  try {
    const exists = await imageExists(group, subgroup, fileName)
    if (!exists) {
      return NextResponse.json({ error: `Não existe imagem "${fileName}" em ${group}/${subgroup}` }, { status: 404 })
    }

    const backupKey = await backupImage(group, subgroup, fileName)
    await deleteImage(group, subgroup, fileName)

    try {
      await recordImageChange({ action: 'delete', group, subgroup, fileName, backupKey, profile })
    } catch { /* log é best-effort */ }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao remover a imagem do bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
