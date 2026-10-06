import { NextRequest, NextResponse } from 'next/server'
import { purgeBackups } from '@/lib/r2Images'
import { getProfileById } from '@/lib/userProfileStore'

// Limpeza única das cópias de segurança que o mecanismo antigo de backup
// automático (removido — ver "Backup automático removido" em
// specs/imagens-r2.md) já tinha criado sob `_backup/` antes desta mudança.
// Pedido explícito do usuário: "todo e qualquer backup que esteja sendo
// criado, delete-o." Não grava linha em image_change_log — é limpeza de
// infraestrutura, não uma alteração de imagem do catálogo.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  try {
    const count = await purgeBackups()
    return NextResponse.json({ ok: true, count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao limpar os backups do bucket'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
