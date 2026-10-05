import { NextRequest, NextResponse } from 'next/server'
import { listGroupsTree } from '@/lib/r2Images'
import { getProfileById } from '@/lib/userProfileStore'

// Árvore Grupo → Subgrupo + contagem de imagens, ao vivo do bucket R2 (ver
// specs/imagens-r2.md). Admin-only no servidor (nunca confia num isAdmin
// solto do corpo/query — ver specs/permissoes-e-perfis.md), mesmo nível de
// proteção da tela inteira — este módulo não entra em visibleModules de
// propósito, é tratado como "Administração", igual Configuração de
// Usuários.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const profile = await getProfileById(searchParams.get('profileId') ?? '')
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  try {
    const groups = await listGroupsTree()
    return NextResponse.json({ groups })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o bucket de imagens'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
