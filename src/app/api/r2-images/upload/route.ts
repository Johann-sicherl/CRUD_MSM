import { NextRequest, NextResponse } from 'next/server'
import { isValidFileName, isValidSegmentName, imageExists, uploadImage, backupImage } from '@/lib/r2Images'
import { recordImageChange } from '@/lib/imageChangeLog'
import { getProfileById } from '@/lib/userProfileStore'

// Envia uma imagem nova (mode=add, seção 7.2 do manual da TI) ou substitui
// uma já existente (mode=replace, seção 7.3) — multipart/form-data porque é
// upload de arquivo de verdade. "Criar um grupo/subgrupo novo" não é uma
// ação separada: é só digitar um nome de grupo/subgrupo que ainda não
// existe aqui — a pasta passa a existir no R2 no mesmo instante que o
// primeiro arquivo chega (ver listGroupsTree em r2Images.ts).
export async function POST(request: NextRequest) {
  const form = await request.formData()
  const profileId = String(form.get('profileId') ?? '')
  const profile = await getProfileById(profileId)
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const group = String(form.get('group') ?? '').trim()
  const subgroup = String(form.get('subgroup') ?? '').trim()
  const fileName = String(form.get('fileName') ?? '').trim()
  const mode = String(form.get('mode') ?? 'add') === 'replace' ? 'replace' : 'add'
  const file = form.get('file')

  if (!isValidSegmentName(group) || !isValidSegmentName(subgroup)) {
    return NextResponse.json({ error: 'Grupo e Subgrupo não podem ficar vazios nem conter "/"' }, { status: 400 })
  }
  if (!isValidFileName(fileName)) {
    return NextResponse.json({ error: 'Nome do arquivo inválido — use letras, números, ponto, hífen ou underscore, terminando em ".png" minúsculo' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Envie um arquivo de imagem' }, { status: 400 })
  }
  if (file.type !== 'image/png') {
    return NextResponse.json({ error: 'Só arquivos .png são aceitos (envie somente imagens do catálogo)' }, { status: 400 })
  }

  try {
    const alreadyExists = await imageExists(group, subgroup, fileName)
    if (mode === 'add' && alreadyExists) {
      return NextResponse.json({
        error: `Já existe uma imagem "${fileName}" em ${group}/${subgroup} — use "Substituir" em vez de "Adicionar"`,
      }, { status: 409 })
    }
    if (mode === 'replace' && !alreadyExists) {
      return NextResponse.json({
        error: `Não existe imagem "${fileName}" em ${group}/${subgroup} ainda — use "Adicionar" em vez de "Substituir"`,
      }, { status: 409 })
    }

    // Guarda uma cópia da versão atual antes de sobrescrever — passo manual
    // no guia da TI ("guarde uma cópia da versão atual"), automático aqui.
    const backupKey = mode === 'replace' ? await backupImage(group, subgroup, fileName) : null

    const buffer = Buffer.from(await file.arrayBuffer())
    await uploadImage(group, subgroup, fileName, buffer, 'image/png')

    try {
      await recordImageChange({ action: mode === 'replace' ? 'replace' : 'upload', group, subgroup, fileName, backupKey, profile })
    } catch { /* log é best-effort — nunca derruba o upload, que já teve sucesso */ }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao enviar a imagem para o bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
