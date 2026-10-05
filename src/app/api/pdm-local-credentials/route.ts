import { NextResponse } from 'next/server'
import { getLocalPdmCreds } from '@/lib/localCredentials'

// Lê PDM_USER/PDM_PASSWORD de local-data/local-access.txt — usado pelo
// botão "Entrar com Dados Locais" do pop-up de conexão ao PDM
// (pdmAuthContext.tsx). Mesmo espírito de /api/protheus-local-credentials.
//
// force-dynamic/force-no-store: mesmo motivo de /api/protheus-local-credentials
// — é um GET puro (sem request.url/cookies/headers), então o Next
// classificaria isso como estático e pré-renderizaria a resposta em build
// time, congelando pra sempre o conteúdo que local-access.txt tinha NAQUELE
// momento. Ver specs/telas-auxiliares.md para a lição original (lá era
// GET+método mutante causando 405; aqui é um GET cujo resultado depende de
// um arquivo que muda em runtime, risco diferente mas mesma causa raiz).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const creds = getLocalPdmCreds()
  if (!creds) {
    return NextResponse.json({
      error: 'Nenhuma credencial local encontrada — crie local-data/local-access.txt (copie local-access.example.txt) e preencha PDM_USER/PDM_PASSWORD',
    }, { status: 404 })
  }
  return NextResponse.json(creds)
}
