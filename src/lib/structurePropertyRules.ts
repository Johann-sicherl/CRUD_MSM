import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface StructurePropertyRule {
  property_field: string
  component_code: string
  expected_value: string
}

const FILE = join(process.cwd(), 'src', 'data', 'structure-property-rules.json')

export function readStructurePropertyRules(): StructurePropertyRule[] {
  return JSON.parse(readFileSync(FILE, 'utf-8'))
}

export function writeStructurePropertyRules(rules: StructurePropertyRule[]): void {
  writeFileSync(FILE, JSON.stringify(rules, null, 2) + '\n', 'utf-8')
}
