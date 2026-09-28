import { NextRequest, NextResponse } from 'next/server'
import { runPdmDiagnosticSection } from '@/lib/appDiagnostics'
import { getProfileById } from '@/lib/userProfileStore'

// Re-executa só a Checagem #4 (Consulta PDM x Banco MSM) do pop-up de
// Diagnóstico — pedido explícito do usuário: "faz o PDM re-rodar sozinho
// quando conectar". Chamada por AppDiagnosticsGate.tsx assim que o PDM
// conecta (evento separado do disparo inicial, que já rodou sem essa
// credencial na maioria das vezes — ver runPdmDiagnosticSection,
// appDiagnostics.ts). Mesma checagem de permissão do endpoint principal
// (getProfileById + isAdmin, nunca um isAdmin solto do corpo — ver
// specs/permissoes-e-perfis.md).
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const pdmUser = String(body?.pdmUser ?? '').trim()
  const pdmPassword = String(body?.pdmPassword ?? '')
  if (!pdmUser || !pdmPassword) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco PDM' }, { status: 400 })
  }

  const section = await runPdmDiagnosticSection({ user: pdmUser, password: pdmPassword })
  return NextResponse.json({ section })
}
