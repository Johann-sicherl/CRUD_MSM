import { NextRequest, NextResponse } from 'next/server'
import { listAllImageCodes } from '@/lib/r2Images'
import { getProfileById } from '@/lib/userProfileStore'
import { supabaseAdmin } from '@/lib/supabase'

// Busca Reversa de Imagens — pedido explícito do usuário: "liste (Distinct)
// todos os standard_equipment_items.protheus_code e
// relationship_equip_accessory.protheus_code, dessa lista, faça um visual
// de qual cadastro está com imagem imputada, e qual não está, mesmo padrão
// de protheus_code.png." Diferente da busca global (searchAll) — ali a
// fonte é o bucket e o critério de "achado" é substring no nome do
// arquivo; aqui a fonte da lista de códigos é o banco de dados MSM, e o
// bucket só é consultado pra responder sim/não por código (listAllImageCodes).
//
// **Rodada seguinte, pedido explícito do usuário**: "faça um JOIN com
// accessories e busque somente os componentes que estão com status =
// active e standard_equipment_items.status = active" — standard_equipment_items
// é filtrado direto na query (status active); relationship_equip_accessory
// não tem o status do componente em si (protheus_code ali é só o
// "gatilho", a referência pro acessório — o status de verdade do
// componente mora em accessories), então esse código só entra na lista se
// o JOIN com accessories achar o mesmo protheus_code com status active.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const profile = await getProfileById(searchParams.get('profileId') ?? '')
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  try {
    // Sem .limit() explícito o PostgREST capa em 1000 linhas — as três
    // tabelas passam disso facilmente (ver specs/dados-e-schema.md).
    const [{ data: equipItemRows, error: equipErr }, { data: relRows, error: relErr }, { data: accessoryRows, error: accErr }] = await Promise.all([
      supabaseAdmin.from('standard_equipment_items').select('protheus_code').eq('status', 'active').limit(25000),
      supabaseAdmin.from('relationship_equip_accessory').select('protheus_code').limit(25000),
      supabaseAdmin.from('accessories').select('protheus_code, status').limit(25000),
    ])
    if (equipErr) throw equipErr
    if (relErr) throw relErr
    if (accErr) throw accErr

    // accessories.protheus_code é texto livre — comparação sempre
    // normalizada .trim().toUpperCase() em JS, nunca via .in() do
    // PostgREST (sensível a caixa/espaço, ver specs/dados-e-schema.md,
    // "Armadilha do .in()").
    const accessoryStatusByCode = new Map<string, string>()
    for (const row of accessoryRows ?? []) {
      const code = String(row.protheus_code ?? '').trim().toUpperCase()
      if (code) accessoryStatusByCode.set(code, String(row.status ?? '').trim().toLowerCase())
    }

    // DISTINCT, normalizado .trim().toUpperCase() nos dois lados — mesma
    // convenção de comparação de protheus_code do resto do projeto (ver
    // specs/dados-e-schema.md, "Business-key row identity").
    const codes = new Set<string>()
    for (const row of equipItemRows ?? []) {
      const code = String(row.protheus_code ?? '').trim().toUpperCase()
      if (code) codes.add(code)
    }
    for (const row of relRows ?? []) {
      const code = String(row.protheus_code ?? '').trim().toUpperCase()
      if (code && accessoryStatusByCode.get(code) === 'active') codes.add(code)
    }

    const imageCodes = await listAllImageCodes()

    const items = Array.from(codes)
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
      .map(code => ({ code, hasImage: imageCodes.has(code) }))
    const withImage = items.filter(i => i.hasImage).length

    return NextResponse.json({
      items,
      total: items.length,
      withImage,
      withoutImage: items.length - withImage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao executar a busca reversa de imagens'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
