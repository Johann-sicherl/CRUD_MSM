import { supabaseAdmin } from './supabase'
import { listAllImageCodes } from './r2Images'

export interface ImageReverseSearchItem {
  code: string
  hasImage: boolean
}

export interface ImageReverseSearchResult {
  items: ImageReverseSearchItem[]
  total: number
  withImage: number
  withoutImage: number
}

// Núcleo da Busca Reversa de Imagens — DISTINCT protheus_code de
// standard_equipment_items (só status active) e relationship_equip_accessory
// (só os componentes com status active em accessories, via JOIN
// normalizado em JS), cruzado contra o bucket R2 (listAllImageCodes).
// Extraído pra este módulo próprio pra ser compartilhado entre
// GET /api/r2-images/reverse-search (tela Grupos de Imagens) e a checagem
// "Cadastros sem Imagem" de Visão Geral Avançada Global
// (appDiagnostics.ts) — pedido explícito do usuário pra ter o mesmo
// resultado nos dois lugares, nunca duas implementações da mesma conta
// que podem divergir com o tempo.
export async function computeImageReverseSearch(): Promise<ImageReverseSearchResult> {
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

  return { items, total: items.length, withImage, withoutImage: items.length - withImage }
}
