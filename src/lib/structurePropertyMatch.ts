import type { StructurePropertyRule } from './structurePropertyRules'

// Compartilhado entre /api/analisador-estruturas (Busc. Itens Série Estrut.,
// um equipamento por vez, interativo) e productIntelligence.ts (Inteligência
// do Produto, varredura em lote de todo o catálogo) — as duas telas
// precisam decidir "esse valor bate com a estrutura?" exatamente da mesma
// forma, senão uma acusaria uma divergência que a outra consideraria OK.
// Extraído daqui em vez de deixar cada tela com sua própria cópia.

export interface StructurePropertyResult {
  field: string
  matched: { code: string; value: string }[]
  computedValue: string | null
  dbValue: string | null
  status: 'ok' | 'mismatch' | 'duplicate' | 'missing'
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

/**
 * Pra cada propriedade cadastrada em Parâmetros de Estrutura, confronta os
 * códigos encontrados na estrutura Protheus (`codes`) com o valor gravado
 * no equipamento (`equipmentRow`, standard_equipment_items) — agrupando por
 * TODA propriedade cadastrada (não só as que algum código bateu), pra uma
 * propriedade sem código nenhum na estrutura aparecer como "missing" em vez
 * de simplesmente desaparecer do relatório.
 */
export function computeStructurePropertyResults(
  codes: Set<string>,
  equipmentRow: Record<string, unknown> | null,
  rules: StructurePropertyRule[],
): StructurePropertyResult[] {
  const byProperty = new Map<string, StructurePropertyRule[]>()
  for (const r of rules) {
    const list = byProperty.get(r.property_field)
    if (list) list.push(r)
    else byProperty.set(r.property_field, [r])
  }

  return Array.from(byProperty.entries()).map(([field, groupRules]) => {
    const matched = groupRules.filter(r => codes.has(r.component_code))
    const dbValue = equipmentRow ? ((equipmentRow[field] as string | null | undefined) ?? null) : null

    if (matched.length === 0) {
      return { field, matched: [], computedValue: null, dbValue, status: 'missing' as const }
    }

    const distinctValues = Array.from(new Set(matched.map(m => norm(m.expected_value))))
    const isDuplicate = distinctValues.length > 1
    const computedValue = isDuplicate ? null : matched[0].expected_value
    const mismatch = !isDuplicate && !!equipmentRow && computedValue !== null && norm(dbValue) !== norm(computedValue)

    return {
      field,
      matched: matched.map(m => ({ code: m.component_code, value: m.expected_value })),
      computedValue,
      dbValue,
      status: isDuplicate ? 'duplicate' as const : (mismatch ? 'mismatch' as const : 'ok' as const),
    }
  }).sort((a, b) => a.field.localeCompare(b.field))
}
