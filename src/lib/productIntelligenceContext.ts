import { supabaseAdmin } from './supabase'
import { listProductInfo, fetchStructureCodes, listAccessoryHierarchy, type ProtheusCredentials } from './protheusDb'
import { readStructurePropertyRules } from './structurePropertyRules'
import type { ProductIntelligenceContext, ProductIntelligenceTables } from './productIntelligence'

// Extraído de /api/product-intelligence/route.ts pra ser reusado também por
// /api/product-intelligence/ask/route.ts (Camada B) — os dois precisam do
// mesmo retrato (9 tabelas + cadastro/estrutura Protheus ao vivo), só o que
// cada um faz com o resultado das 14 regras diverge.

// Mesmos prefixos padrão de Busc. Avanç. Acessórios Protheus
// (busca-avancada-acessorios/page.tsx, DEFAULT_HEADER_PREFIXES/
// DEFAULT_NIVEL2_PREFIXES) — usados só por R080 (co-ocorrência).
const HIERARCHY_HEADER_PREFIXES = ['26']
const HIERARCHY_NIVEL2_PREFIXES = ['27.13']

const TABELAS = [
  'accessories', 'accessory_groups', 'dependant_items', 'equipments', 'general_alerts',
  'non_combinable_comps', 'relationship_equip_accessory', 'roller_tables', 'standard_equipment_items',
] as const

export async function buildProductIntelligenceContext(creds: ProtheusCredentials): Promise<ProductIntelligenceContext> {
  // .range() explícito, não o default de 1000 linhas do PostgREST
  // (non_combinable_comps/relationship_equip_accessory já passam disso em produção).
  const tableResults = await Promise.all(
    TABELAS.map(t => supabaseAdmin.from(t).select('*').range(0, 24999))
  )
  for (const { error } of tableResults) {
    if (error) throw new Error(`Falha ao ler tabelas de engenharia: ${error.message}`)
  }
  const tables = Object.fromEntries(
    TABELAS.map((t, i) => [t, tableResults[i].data || []])
  ) as unknown as ProductIntelligenceTables

  const protheusInfo = await listProductInfo(creds)

  // BOM de cada variante Protheus registrada em Cadastro de Equipamentos
  // (union por equipamento é feita dentro do motor) — cada fetchStructureCodes
  // bate no mesmo cache em memória já aquecido acima (listProductInfo já
  // forçou o carregamento), então isso não gera round trips extras ao Protheus.
  const variantCodes = Array.from(new Set(
    (tables.standard_equipment_items || []).map(r => String(r.protheus_code ?? '').trim()).filter(Boolean)
  ))
  const bomEntries = await Promise.all(
    variantCodes.map(async code => {
      const { codes } = await fetchStructureCodes(code, creds)
      return [code.toUpperCase(), new Set(codes.map(c => c.trim().toUpperCase()))] as const
    })
  )
  const bomByVariantCode = new Map(bomEntries)

  // Mesma hierarquia 26.xx → 27.13 → nível 3 de Busc. Avanç. Acessórios
  // Protheus (reuso direto, bate no mesmo cache de estrutura já quente) —
  // usada só por R080 (co-ocorrência entre itens de nível 3).
  const accessoryHierarchyGroups = await listAccessoryHierarchy(
    HIERARCHY_HEADER_PREFIXES, HIERARCHY_NIVEL2_PREFIXES, creds,
  )
  const structurePropertyRules = readStructurePropertyRules()

  return { tables, protheusInfo, bomByVariantCode, accessoryHierarchyGroups, structurePropertyRules }
}
