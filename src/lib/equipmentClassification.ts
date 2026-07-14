// Ports the VBA classification macro (matches DESC_ESTRUTURA against a
// fixed list of "Like" patterns to derive equipment/family/id/manufacturer)
// into TypeScript. The VBA has no ElseIf/Exit — every rule runs in order and
// later matches overwrite earlier ones — so this walks the same list in the
// same order and keeps the last match, exactly mirroring that behavior.

export interface EquipmentClassification {
  equip: string
  fam: string
  id: string
  fabric: string
}

interface Rule {
  test: (desc: string) => boolean
  value: EquipmentClassification
}

const contains = (desc: string, needle: string) => desc.includes(needle)

const rule = (patterns: string[], value: EquipmentClassification): Rule => ({
  test: desc => patterns.some(p => contains(desc, p)),
  value,
})

// All patterns are compared against the description already uppercased.
// Order matches the original VBA macro exactly (rules run top to bottom,
// last match wins).
const RULES: Rule[] = [
  rule(['GARRETT'], { equip: 'GARRETT', fam: 'GARRETT', id: '-', fabric: 'GARRETT' }),
  rule(['5020'], { equip: '5020', fam: '-', id: '-', fabric: 'VMI' }),
  rule(['6040C'], { equip: '6040 C', fam: '6040', id: '36', fabric: 'VMI' }),
  rule(['6040 C'], { equip: '6040 C', fam: '6040', id: '36', fabric: 'VMI' }),
  {
    // The only rule combining two conditions with AND in the VBA source.
    test: desc => desc.includes('6040') && desc.includes('COMPACT'),
    value: { equip: '6040 C', fam: '6040', id: '36', fabric: 'VMI' },
  },
  rule(['6040 SV', '6040 /'], { equip: '6040 SV', fam: '6040', id: '12', fabric: 'VMI' }),
  rule(['6240'], { equip: '6240 SV', fam: '-', id: '-', fabric: 'VMI' }),
  rule(['6040 DV'], { equip: '6040 DV', fam: '6040', id: '13', fabric: 'VMI' }),
  rule(['6040 P3D'], { equip: '6040 P3D', fam: '6040', id: '15', fabric: 'VMI' }),
  rule(['6040 M'], { equip: '6040 M', fam: '6040', id: '14', fabric: 'VMI' }),
  rule(['BODYSCAN SV'], { equip: 'BODYSCAN SV', fam: 'BODYSCAN', id: '27', fabric: 'VMI' }),
  rule(['BODYSCAN DV'], { equip: 'BODYSCAN DV', fam: 'BODYSCAN', id: '28', fabric: 'VMI' }),
  rule(['BODYSCAN HSV'], { equip: 'BODYSCAN HSV', fam: 'BODYSCAN', id: '29', fabric: 'VMI' }),
  rule(['BODYSCAN HDV'], { equip: 'BODYSCAN HDV', fam: 'BODYSCAN', id: '30', fabric: 'VMI' }),
  rule(['BODYSCAN TORSO'], { equip: 'BODYSCAN TORSO', fam: 'BODYSCAN', id: '38', fabric: 'VMI' }),
  rule(['BODYSCAN HD '], { equip: 'BODYSCAN HD', fam: 'BODYSCAN', id: '', fabric: 'VMI' }),
  rule(['100100 SV', '100100 /'], { equip: '100100 SV', fam: '100100', id: '19', fabric: 'VMI' }),
  rule(['100100 DV'], { equip: '100100 DV', fam: '100100', id: '20', fabric: 'VMI' }),
  rule(['100100 HSV', '100100 H /'], { equip: '100100 HSV', fam: '100100', id: '22', fabric: 'VMI' }),
  rule(['100100 HDV'], { equip: '100100 HDV', fam: '100100', id: '21', fabric: 'VMI' }),
  rule(['100100 M', '100100 CAMINHAO', '100100M'], { equip: '100100 M', fam: '100100', id: '23', fabric: 'VMI' }),
  rule(['180180 SV', '180180 /'], { equip: '180180 SV', fam: '180180', id: '25', fabric: 'VMI' }),
  rule(['180180 DV'], { equip: '180180 DV', fam: '180180', id: '26', fabric: 'VMI' }),
  rule(['5333'], { equip: '5333', fam: '-', id: '10', fabric: 'VMI' }),
  rule(['5536'], { equip: '5536', fam: '-', id: '11', fabric: 'VMI' }),
  rule(['6550'], { equip: '6550', fam: '-', id: '16', fabric: 'VMI' }),
  rule(['6575'], { equip: '6575', fam: '-', id: '17', fabric: 'VMI' }),
  rule(['7560'], { equip: '7560', fam: '-', id: '18', fabric: 'VMI' }),
  rule(['SPECTRUM CARGO'], { equip: 'CARGO', fam: 'CARGO', id: '34', fabric: 'VMI' }),
  rule(['SPECTRUM CARGO COMPACT'], { equip: 'CARGO COMPACT', fam: 'CARGO', id: '33', fabric: 'VMI' }),
  rule(['FLATSCAN SV', 'FLATSCAN DF80 SV'], { equip: 'FLATSCAN SV', fam: 'FLATSCAN', id: '31', fabric: 'VMI' }),
  rule(['FLATSCAN DV', 'FLATSCAN DF80 DV'], { equip: 'FLATSCAN DV', fam: 'FLATSCAN', id: '32', fabric: 'VMI' }),
  rule(['SMARTCHECK', 'CABINE DE INSPECAO'], { equip: 'SMARTCHECK', fam: '-', id: '39', fabric: 'VMI' }),
  rule(['150180'], { equip: '150180', fam: '-', id: '24', fabric: 'VMI' }),
  rule(['100110'], { equip: '100110 DV', fam: '-', id: '40', fabric: 'VMI' }),
  rule(['4SPECTRA'], { equip: '4SPECTRA', fam: '-', id: '35', fabric: 'VMI' }),
  rule(['RAD PORTAL'], { equip: 'RAD PORTAL', fam: '-', id: '41', fabric: 'VMI' }),
  rule(['RECYCLING'], { equip: 'RECYCLING', fam: '-', id: '37', fabric: 'VMI' }),
  rule(['CX6040BI'], { equip: 'CX6040BI', fam: '-', id: '-', fabric: 'NUCTECH' }),
  rule(['CX5030T'], { equip: 'CX5030T', fam: '-', id: '-', fabric: 'NUCTECH' }),
  rule(['CX6550BI'], { equip: 'CX6550BI', fam: '-', id: '-', fabric: 'NUCTECH' }),
  rule(['CX150180'], { equip: 'CX150180', fam: '-', id: '-', fabric: 'NUCTECH' }),
  rule(['CX6550B '], { equip: 'CX6550B', fam: '-', id: '-', fabric: 'NUCTECH' }),
  rule(['CX100100TI'], { equip: 'CX100100TI', fam: '-', id: '-', fabric: 'NUCTECH' }),
]

/**
 * Classifies a structure description the same way the legacy VBA macro did:
 * every rule is checked in order, and the LAST one that matches wins (the
 * VBA overwrites the same cells on every match instead of stopping early).
 * Returns null when no rule matches at all.
 */
export function classifyEquipmentType(description: string | null | undefined): EquipmentClassification | null {
  if (!description) return null
  const desc = description.trim().toUpperCase()
  if (!desc) return null

  let result: EquipmentClassification | null = null
  for (const r of RULES) {
    if (r.test(desc)) result = r.value
  }
  return result
}
