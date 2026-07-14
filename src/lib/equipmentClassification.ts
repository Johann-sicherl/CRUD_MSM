// Classifies a structure description (DESC_ESTRUTURA) against a list of
// user-editable rules (see Parâmetros de Estrutura > Classificação de
// Equipamentos, backed by src/data/equipment-classification-rules.json).
// Ported from a legacy VBA macro that had no ElseIf/Exit — every rule ran
// top to bottom and later matches overwrote earlier ones — so this keeps
// the same "last match wins" semantics instead of stopping at the first hit.

export interface EquipmentClassificationRule {
  patterns: string[]
  combinator: 'OR' | 'AND'
  equip: string
}

/**
 * Classifies `description` by walking `rules` in order; the LAST rule that
 * matches wins (mirrors the VBA source, which overwrites the same cell on
 * every match rather than stopping early). Returns the equipment type, or
 * null when nothing matches or the description is empty.
 */
export function classifyEquipmentType(
  description: string | null | undefined,
  rules: EquipmentClassificationRule[]
): string | null {
  if (!description) return null
  const desc = description.trim().toUpperCase()
  if (!desc) return null

  let result: string | null = null
  for (const r of rules) {
    const patterns = r.patterns.map(p => p.trim().toUpperCase()).filter(Boolean)
    if (patterns.length === 0) continue
    const matches = r.combinator === 'AND'
      ? patterns.every(p => desc.includes(p))
      : patterns.some(p => desc.includes(p))
    if (matches) result = r.equip
  }
  return result
}
