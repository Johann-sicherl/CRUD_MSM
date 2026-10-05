import { NextResponse } from 'next/server'
import { getLocalProtheusCreds } from '@/lib/localCredentials'

// Lê PROTHEUS_USER/PROTHEUS_PASSWORD de local-data/local-access.txt — usado
// pelo botão "Entrar com Dados Locais" do pop-up de conexão ao Protheus
// (protheusAuthContext.tsx). Mesmo nível de exposição das rotas de teste de
// conexão já existentes (/api/protheus-test-connection) — não exige
// profileId porque só devolve o que já está num arquivo local desta mesma
// máquina, nunca um segredo vindo de outro lugar.
//
// force-dynamic/force-no-store: é um GET puro (sem request.url/cookies/
// headers), então o Next classificaria isso como estático e pré-renderizaria
// a resposta em build time — congelando pra sempre o conteúdo que
// local-access.txt tinha NAQUELE momento, nunca relendo o arquivo depois.
// Mesma lição (achada numa rodada anterior) documentada em
// specs/telas-auxiliares.md — lá era GET+método mutante causando 405; aqui
// é um GET cujo resultado depende de um arquivo que muda em runtime, risco
// diferente mas mesma causa raiz (rota de caminho fixo sem opt-out explícito
// do cache estático).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const creds = getLocalProtheusCreds()
  if (!creds) {
    return NextResponse.json({
      error: 'Nenhuma credencial local encontrada — crie local-data/local-access.txt (copie local-access.example.txt) e preencha PROTHEUS_USER/PROTHEUS_PASSWORD',
    }, { status: 404 })
  }
  return NextResponse.json(creds)
}
