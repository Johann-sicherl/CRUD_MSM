import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Componentes que o Busc. Avanç. Acessórios Protheus encontra (a busca
// recursiva 26.xx/27.13 é correta e sempre traz tudo) mas que o usuário
// marcou como "nunca vou usar" — gravados aqui só pra sumir da listagem
// dali em diante. Mesmo padrão JSON-file-backed de structurePropertyRules.ts/
// equipmentClassificationRules.ts (config operacional de um usuário/máquina,
// não dado de negócio compartilhado).
export interface IgnoredAccessory {
  codigo: string
  denominacao: string
}

const FILE = join(process.cwd(), 'src', 'data', 'ignored-accessories.json')

export function readIgnoredAccessories(): IgnoredAccessory[] {
  return JSON.parse(readFileSync(FILE, 'utf-8'))
}

export function writeIgnoredAccessories(list: IgnoredAccessory[]): void {
  writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8')
}
