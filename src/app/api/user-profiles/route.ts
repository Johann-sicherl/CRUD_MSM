import { NextRequest, NextResponse } from 'next/server'
import { readProfiles, createProfile } from '@/lib/userProfileStore'

// Arquivo local, não Supabase — nunca deve ser cacheado entre requisições.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Lista todos os perfis — usada pela tela de login (nomes pra escolher, sem
// senha) e pela Configuração de Usuários (edição completa).
export async function GET() {
  return NextResponse.json({ profiles: readProfiles() })
}

// Cria um novo perfil, sempre sem nenhum acesso além do Dashboard — a
// Configuração de Usuários libera o resto depois.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const name = String(body?.name ?? '')
  try {
    const profile = createProfile(name)
    return NextResponse.json(profile)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao criar usuário'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
