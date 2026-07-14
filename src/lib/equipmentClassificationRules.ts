import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { EquipmentClassificationRule } from '@/lib/equipmentClassification'

const FILE = join(process.cwd(), 'src', 'data', 'equipment-classification-rules.json')

export function readEquipmentClassificationRules(): EquipmentClassificationRule[] {
  return JSON.parse(readFileSync(FILE, 'utf-8'))
}

export function writeEquipmentClassificationRules(rules: EquipmentClassificationRule[]): void {
  writeFileSync(FILE, JSON.stringify(rules, null, 2) + '\n', 'utf-8')
}
