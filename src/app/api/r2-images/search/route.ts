import { NextRequest, NextResponse } from 'next/server'
import { searchAll } from '@/lib/r2Images'
import { getProfileById } from '@/lib/userProfileStore'

// Busca global (pastas + imagens) em todo o bucket — ver searchAll em
// r2Images.ts. Pedido explícito do usuário: "Quero que você adicione um
// filtro de pesquisa para todas as imagens e para todas as pastas também".
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Limite de resultados devolvidos por tipo — a varredura em si sempre
// examina o bucket inteiro (não dá pra paginar uma busca por substring sem
// isso), mas não faz sentido mandar uma lista gigante pro cliente.
const MAX_RESULTS = 200

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const profile = await getProfileById(searchParams.get('profileId') ?? '')
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const q = (searchParams.get('q') ?? '').trim()
  if (q.length < 2) {
    return NextResponse.json({ error: 'Digite ao menos 2 caracteres pra buscar' }, { status: 400 })
  }

  try {
    const result = await searchAll(q)
    return NextResponse.json({
      folders: result.folders.slice(0, MAX_RESULTS),
      files: result.files.slice(0, MAX_RESULTS),
      foldersTotal: result.folders.length,
      filesTotal: result.files.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar no bucket de imagens'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
