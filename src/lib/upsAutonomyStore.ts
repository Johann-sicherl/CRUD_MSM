import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UpsModel, BatteryGroup, ExternalBatteryModule, EquipmentBomComponent, EquipmentLoadParams } from './upsAutonomyCalc'

// Catálogos da Calculadora de Autonomia de Nobreak — mesmo padrão
// JSON-file-backed de structurePropertyRules.ts/ignoredAccessories.ts:
// GET/PUT substituem o arquivo inteiro, sem tabela no Supabase (dado
// operacional local, não dado de negócio compartilhado). Extraídos
// originalmente de uma planilha de engenharia (ver
// specs/telas-auxiliares.md); agora editáveis pela própria tela — pedido
// explícito do usuário ("Tudo" quando perguntado quais catálogos precisava
// editar: modelos de UPS, BOM de equipamento, módulos de bateria externa,
// grupos de capacidade de bateria).

const CATALOG_FILE = join(process.cwd(), 'src', 'data', 'ups-autonomy-catalog.json')
const EQUIPMENT_FILE = join(process.cwd(), 'src', 'data', 'ups-autonomy-equipment.json')

export interface UpsAutonomyCatalog {
  ups: UpsModel[]
  batteryGroups: BatteryGroup[]
  batteryExternal: ExternalBatteryModule[]
}

export interface UpsAutonomyEquipment {
  equipmentNames: string[]
  equipmentBom: EquipmentBomComponent[]
  equipmentLoadParams: Record<string, EquipmentLoadParams>
}

export function readUpsAutonomyCatalog(): UpsAutonomyCatalog {
  const raw = JSON.parse(readFileSync(CATALOG_FILE, 'utf-8'))
  return { ups: raw.ups ?? [], batteryGroups: raw.batteryGroups ?? [], batteryExternal: raw.batteryExternal ?? [] }
}

export function writeUpsAutonomyCatalog(catalog: UpsAutonomyCatalog): void {
  writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf-8')
}

export function readUpsAutonomyEquipment(): UpsAutonomyEquipment {
  const raw = JSON.parse(readFileSync(EQUIPMENT_FILE, 'utf-8'))
  return {
    equipmentNames: raw.equipmentNames ?? [],
    equipmentBom: raw.equipmentBom ?? [],
    equipmentLoadParams: raw.equipmentLoadParams ?? {},
  }
}

export function writeUpsAutonomyEquipment(equipment: UpsAutonomyEquipment): void {
  writeFileSync(EQUIPMENT_FILE, JSON.stringify(equipment, null, 2) + '\n', 'utf-8')
}
