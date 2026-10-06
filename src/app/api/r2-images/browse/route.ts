import { NextRequest, NextResponse } from 'next/server'
import { browseFolder, isValidFolderPath } from '@/lib/r2Images'
import { resolveFileGroups } from '@/lib/imageAccessoryGroups'
import { getProfileById } from '@/lib/userProfileStore'

// Navega UM nível do bucket por vez (pastas + imagens diretamente dentro de
// ?path=), estilo Windows Explorer — substitui as antigas /tree (árvore
// inteira, só 2 níveis fixos Grupo/Subgrupo) e /list (imagens de um
// subgrupo). path="" (ou omitido) é a raiz. Ver specs/imagens-r2.md.
//
// Cada imagem devolvida ganha também `group` (nome do grupo de Cadastro de
// Componentes a que o protheus_code — o próprio nome do arquivo, sem
// ".png" — pertence, ou null se não cadastrado/sem grupo) — pedido
// explícito do usuário: "Faça um JOIN com os Protheus_code de Cadastro de
// Componentes... quero que seja em formato de agrupamento de imagens pelo
// tipo de grupo." Ver resolveFileGroups.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const profile = await getProfileById(searchParams.get('profileId') ?? '')
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const path = searchParams.get('path') ?? ''
  if (!isValidFolderPath(path)) {
    return NextResponse.json({ error: 'Caminho de pasta inválido' }, { status: 400 })
  }

  try {
    const result = await browseFolder(path)
    const groups = await resolveFileGroups(result.files.map(f => f.fileName))
    const files = result.files.map(f => ({ ...f, group: groups.get(f.fileName) ?? null }))
    return NextResponse.json({ ...result, files })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o bucket de imagens'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
