import { NextRequest, NextResponse } from 'next/server'
import { updateProfile, deleteProfile } from '@/lib/userProfileStore'

type RouteParams = { params: { id: string } }

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Salva as alterações feitas na Configuração de Usuários (nome, admin,
// pode-criar-excluir, módulos visíveis, colunas editáveis por tabela, e
// opcionalmente uma senha nova — campo em branco no formulário = não muda).
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const body = await request.json()
  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string') patch.name = body.name
  if (typeof body?.isAdmin === 'boolean') patch.isAdmin = body.isAdmin
  if (typeof body?.canCreateDelete === 'boolean') patch.canCreateDelete = body.canCreateDelete
  if (Array.isArray(body?.visibleModules)) patch.visibleModules = body.visibleModules.map(String)
  if (body?.editableFieldsByTable && typeof body.editableFieldsByTable === 'object') {
    const clean: Record<string, string[]> = {}
    for (const [table, fields] of Object.entries(body.editableFieldsByTable as Record<string, unknown>)) {
      if (Array.isArray(fields)) clean[table] = fields.map(String)
    }
    patch.editableFieldsByTable = clean
  }
  if (typeof body?.password === 'string' && body.password.trim()) patch.password = body.password.trim()

  try {
    const profile = await updateProfile(params.id, patch)
    return NextResponse.json(profile)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao salvar usuário'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await deleteProfile(params.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao excluir usuário'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
