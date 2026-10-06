import { supabaseAdmin } from './supabase'

// Resolve, pra cada imagem de Grupos de Imagens (bucket R2), o grupo a que
// o componente/equipamento pertence — pedido explícito do usuário: "Faça
// um JOIN com os Protheus_code de Cadastro de Componentes... também com a
// tabela de grupos de componentes, busque o grupo em que cada
// imagem/componente está... quero que seja em formato de agrupamento de
// imagens pelo tipo de grupo." **Rodada seguinte, pedido explícito do
// usuário**: "Quero que faça a mesma conexão com standard_equipment_items
// com o seu respectivo protheus_code, o mesmo link do protheus_code de
// accessories já existente" — mesmo mecanismo replicado pra Cadastro de
// Equipamentos: `standard_equipment_items.protheus_code` ->
// `legacy_equipment_id` -> `equipments.name` (o "grupo" de um equipamento
// é o próprio equipamento, igual `accessory_groups.name` é o grupo de um
// componente). `accessories` é checada primeiro; `standard_equipment_items`
// é o fallback pra código que não bate em `accessories` — os dois
// catálogos não deveriam ter o mesmo `protheus_code`, mas a ordem garante
// um resultado determinístico se algum dia baterem.
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

// fileName -> nome do grupo (de accessory_groups ou o nome do próprio
// equipamento), ou null (arquivo não bate com nenhum protheus_code
// cadastrado em accessories/standard_equipment_items, ou bate mas o
// componente não tem grupo).
export async function resolveFileGroups(fileNames: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  if (fileNames.length === 0) return result

  // Sem .limit() explícito, o PostgREST capa em 1000 linhas por padrão —
  // Cadastro de Componentes/Equipamentos podem facilmente passar disso.
  const [{ data: accessoryRows }, { data: equipmentItemRows }] = await Promise.all([
    supabaseAdmin.from('accessories').select('protheus_code, legacy_group_id').limit(25000),
    supabaseAdmin.from('standard_equipment_items').select('protheus_code, legacy_equipment_id').limit(25000),
  ])

  const codeToGroupId = new Map<string, number | null>()
  for (const row of accessoryRows ?? []) {
    const code = String(row.protheus_code ?? '').trim().toUpperCase()
    if (code) codeToGroupId.set(code, (row.legacy_group_id as number | null) ?? null)
  }

  const codeToEquipmentId = new Map<string, number | null>()
  for (const row of equipmentItemRows ?? []) {
    const code = String(row.protheus_code ?? '').trim().toUpperCase()
    if (code) codeToEquipmentId.set(code, (row.legacy_equipment_id as number | null) ?? null)
  }

  const groupIds = Array.from(
    new Set(Array.from(codeToGroupId.values()).filter((id): id is number => id != null)),
  )
  const equipmentIds = Array.from(
    new Set(Array.from(codeToEquipmentId.values()).filter((id): id is number => id != null)),
  )

  // legacy_id é numérico (não texto) nas duas tabelas — .in() é seguro
  // aqui, diferente de protheus_code.
  const [{ data: groupRows }, { data: equipmentRows }] = await Promise.all([
    groupIds.length > 0
      ? supabaseAdmin.from('accessory_groups').select('legacy_id, name').in('legacy_id', groupIds)
      : Promise.resolve({ data: [] as { legacy_id: number; name: string }[] }),
    equipmentIds.length > 0
      ? supabaseAdmin.from('equipments').select('legacy_id, name').in('legacy_id', equipmentIds)
      : Promise.resolve({ data: [] as { legacy_id: number; name: string }[] }),
  ])

  const groupIdToName = new Map<number, string>()
  for (const g of groupRows ?? []) {
    groupIdToName.set(g.legacy_id as number, g.name as string)
  }
  const equipmentIdToName = new Map<number, string>()
  for (const e of equipmentRows ?? []) {
    equipmentIdToName.set(e.legacy_id as number, e.name as string)
  }

  for (const fileName of fileNames) {
    const code = codeFromFileName(fileName)
    const groupId = codeToGroupId.get(code)
    if (groupId !== undefined) {
      result.set(fileName, groupId != null ? (groupIdToName.get(groupId) ?? null) : null)
      continue
    }
    const equipmentId = codeToEquipmentId.get(code)
    if (equipmentId !== undefined) {
      result.set(fileName, equipmentId != null ? (equipmentIdToName.get(equipmentId) ?? null) : null)
      continue
    }
    result.set(fileName, null)
  }
  return result
}
