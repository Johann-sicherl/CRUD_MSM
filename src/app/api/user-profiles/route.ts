import { NextRequest, NextResponse } from 'next/server'
import { readProfiles, createProfile } from '@/lib/userProfileStore'

// Supabase não deve ser cacheado entre requisições.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Lista todos os perfis — usada pela tela de login (nomes pra escolher) e
// pela Configuração de Usuários (edição completa). Nunca inclui a senha
// nem o hash — isso não sai do servidor em nenhuma hipótese.
export async function GET() {
  try {
    return NextResponse.json({ profiles: await readProfiles() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao carregar usuários'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Cria um novo perfil, com senha própria, sempre sem nenhum acesso além do
// Dashboard — a Configuração de Usuários libera o resto depois.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const name = String(body?.name ?? '')
  const password = String(body?.password ?? '')
  try {
    const profile = await createProfile(name, password)
    return NextResponse.json(profile)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao criar usuário'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
