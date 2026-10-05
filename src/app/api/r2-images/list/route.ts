import { NextRequest, NextResponse } from 'next/server'
import { listImages } from '@/lib/r2Images'
import { getProfileById } from '@/lib/userProfileStore'

// Lista as imagens de um Grupo/Subgrupo específico, ao vivo do bucket R2.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const profile = await getProfileById(searchParams.get('profileId') ?? '')
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const group = (searchParams.get('group') ?? '').trim()
  const subgroup = (searchParams.get('subgroup') ?? '').trim()
  if (!group || !subgroup) {
    return NextResponse.json({ error: 'Informe grupo e subgrupo' }, { status: 400 })
  }

  try {
    const images = await listImages(group, subgroup)
    return NextResponse.json({ images })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o bucket de imagens'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
