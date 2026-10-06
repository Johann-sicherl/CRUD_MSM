import { NextRequest, NextResponse } from 'next/server'
import { getProfileById } from '@/lib/userProfileStore'
import { computeImageReverseSearch } from '@/lib/imageReverseSearch'

// Busca Reversa de Imagens — pedido explícito do usuário: "liste (Distinct)
// todos os standard_equipment_items.protheus_code e
// relationship_equip_accessory.protheus_code, dessa lista, faça um visual
// de qual cadastro está com imagem imputada, e qual não está, mesmo padrão
// de protheus_code.png." Diferente da busca global (searchAll) — ali a
// fonte é o bucket e o critério de "achado" é substring no nome do
// arquivo; aqui a fonte da lista de códigos é o banco de dados MSM, e o
// bucket só é consultado pra responder sim/não por código.
//
// Núcleo da conta (DISTINCT dos códigos ativos + JOIN com accessories +
// cruzamento com o bucket) vive em computeImageReverseSearch
// (imageReverseSearch.ts) — compartilhado com a checagem "Cadastros sem
// Imagem" de Visão Geral Avançada Global (appDiagnostics.ts), nunca
// duplicado entre os dois.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const profile = await getProfileById(searchParams.get('profileId') ?? '')
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  try {
    const result = await computeImageReverseSearch()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao executar a busca reversa de imagens'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
