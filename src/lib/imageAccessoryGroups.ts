import { supabaseAdmin } from './supabase'

// Resolve, pra cada imagem de Grupos de Imagens (bucket R2), o grupo de
// Cadastro de Componentes (accessory_groups) a que o componente pertence —
// pedido explícito do usuário: "Faça um JOIN com os Protheus_code de
// Cadastro de Componentes... também com a tabela de grupos de
// componentes, busque o grupo em que cada imagem/componente está... quero
// que seja em formato de agrupamento de imagens pelo tipo de grupo."
//
// O nome do arquivo (sem a extensão ".png") é o candidato a protheus_code
// — mesma convenção de nomenclatura das imagens do catálogo (ex.
// "27.02.00683.png" -> "27.02.00683"). Comparação sempre normalizada
// (.trim().toUpperCase()) nos dois lados, nunca via .in() do PostgREST
// (sensível a caixa/espaço — ver specs/dados-e-schema.md, "Armadilha do
// .in()"); busca a coluna crua da tabela inteira e compara em JS, mesmo
// padrão já usado em clone-architecture/route.ts.
function codeFromFileName(fileName: string): string {
  return fileName.replace(/\.png$/i, '').trim().toUpperCase()
}

// fileName -> nome do grupo, ou null (arquivo não bate com nenhum
// protheus_code de accessories, ou bate mas o componente não tem grupo).
export async function resolveFileGroups(fileNames: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  if (fileNames.length === 0) return result

  // Sem .limit() explícito, o PostgREST capa em 1000 linhas por padrão —
  // Cadastro de Componentes pode facilmente passar disso.
  const { data: accessoryRows } = await supabaseAdmin
    .from('accessories')
    .select('protheus_code, legacy_group_id')
    .limit(25000)

  const codeToGroupId = new Map<string, number | null>()
  for (const row of accessoryRows ?? []) {
    const code = String(row.protheus_code ?? '').trim().toUpperCase()
    if (code) codeToGroupId.set(code, (row.legacy_group_id as number | null) ?? null)
  }

  const groupIds = Array.from(
    new Set(Array.from(codeToGroupId.values()).filter((id): id is number => id != null)),
  )
  const groupIdToName = new Map<number, string>()
  if (groupIds.length > 0) {
    // legacy_id é numérico (não texto) — .in() é seguro aqui, diferente de
    // protheus_code.
    const { data: groupRows } = await supabaseAdmin
      .from('accessory_groups')
      .select('legacy_id, name')
      .in('legacy_id', groupIds)
    for (const g of groupRows ?? []) {
      groupIdToName.set(g.legacy_id as number, g.name as string)
    }
  }

  for (const fileName of fileNames) {
    const code = codeFromFileName(fileName)
    const groupId = codeToGroupId.get(code)
    result.set(fileName, groupId != null ? (groupIdToName.get(groupId) ?? null) : null)
  }
  return result
}
