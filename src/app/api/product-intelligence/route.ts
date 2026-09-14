import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { listProductInfo, fetchStructureCodes, listAccessoryHierarchy } from '@/lib/protheusDb'
import { readStructurePropertyRules } from '@/lib/structurePropertyRules'
import {
  runProductIntelligence, type ProductIntelligenceContext, type ProductIntelligenceTables,
} from '@/lib/productIntelligence'

// Mesmos prefixos padrão de Busc. Avanç. Acessórios Protheus
// (busca-avancada-acessorios/page.tsx, DEFAULT_HEADER_PREFIXES/
// DEFAULT_NIVEL2_PREFIXES) — usados só por R080 (co-ocorrência).
const HIERARCHY_HEADER_PREFIXES = ['26']
const HIERARCHY_NIVEL2_PREFIXES = ['27.13']

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const TABELAS = [
  'accessories', 'accessory_groups', 'dependant_items', 'equipments', 'general_alerts',
  'non_combinable_comps', 'relationship_equip_accessory', 'roller_tables', 'standard_equipment_items',
] as const

// Mesma credencial por requisição de todo o resto do app (nunca persistida
// no servidor — ver protheusDb.ts). Nenhuma checagem de perfil aqui: o
// acesso a esta tela já é controlado por visibleModules (como
// analisador-estruturas/busca-avancada-acessorios) e a credencial Protheus
// em si já é o controle de acesso real pro lado externo.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const apenas: string[] | undefined = Array.isArray(body?.regras) ? body.regras : undefined

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }

  try {
    // As 9 tabelas de engenharia — .range() explícito, não o default de
    // 1000 linhas do PostgREST (non_combinable_comps/relationship_equip_
    // accessory já passam disso em produção).
    const tableResults = await Promise.all(
      TABELAS.map(t => supabaseAdmin.from(t).select('*').range(0, 24999))
    )
    for (const { error } of tableResults) {
      if (error) return NextResponse.json({ error: `Falha ao ler tabelas de engenharia: ${error.message}` }, { status: 500 })
    }
    const tables = Object.fromEntries(
      TABELAS.map((t, i) => [t, tableResults[i].data || []])
    ) as unknown as ProductIntelligenceTables

    const creds = { user, password }
    const protheusInfo = await listProductInfo(creds)

    // BOM de cada variante Protheus registrada em Cadastro de Equipamentos
    // (union por equipamento é feita dentro do motor) — cada
    // fetchStructureCodes bate no mesmo cache em memória já aquecido acima
    // (listProductInfo já forçou o carregamento), então isso não gera
    // round trips extras ao Protheus.
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

    const ctx: ProductIntelligenceContext = {
      tables, protheusInfo, bomByVariantCode, accessoryHierarchyGroups, structurePropertyRules,
    }
    const achados = runProductIntelligence(ctx, apenas)

    const resumo: Record<string, number> = {}
    for (const a of achados) resumo[a.severidade] = (resumo[a.severidade] || 0) + 1

    return NextResponse.json({ achados, resumo, total: achados.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
