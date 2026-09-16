// Motor de cálculo da Calculadora de Autonomia de Nobreak — porte fiel da
// planilha "Dimensionamento_UPS_VMI" (fornecida pelo usuário, aba
// "Cálculos" + "Temperatura" + "Baterias"). Ver specs/telas-auxiliares.md
// para o raciocínio de negócio por trás de cada fórmula — este arquivo só
// implementa, não reexplica.
//
// Módulo puro, sem dado embutido: os catálogos (UPS, grupos de bateria,
// bateria externa, BOM de equipamento) são editáveis pela própria tela
// (ver upsAutonomyStore.ts) e sempre passados como parâmetro pelas
// funções abaixo — nunca lidos de uma constante fixa do módulo.

export interface UpsModel {
  brand: string
  model: string
  fullId: string
  technology: string
  code: string
  apparentPowerVA: number
  pf: number
  activePowerW: number
  peakActivePowerW: number | null
  batteryVoltageV: number
  bankCapacityAh: number
  energyWh: number
  batteryType: string
  batteryExpansion: 'Sim' | 'Não' | 'Opcional' | string
  family: string
  output: string
  input: string
  batteryLines: number
  batteryCapacityAh: number
  erpCode: string | null
}

export interface BatteryCurve { a: number; b: number; c: number; d: number; e: number }

export interface BatteryGroup {
  capacityAh: number
  name: string
  curve: BatteryCurve
}

export interface ExternalBatteryModule {
  brand: string
  product: string
  fullId: string
  spec: string
  code: string
  voltageV: number
  bankCapacityAh: number
  lines: number
  seriesCount: number
  batteryCapacityAh: number
  energyWh: number
  family: string
  erpCode: string | null
}

export interface EquipmentBomComponent {
  name: string
  unitVA: number
  standby: boolean
  qtyByEquipment: Record<string, number>
}

export interface EquipmentLoadParams {
  activeTimeS: number
  standbyTimeS: number
  activePf: number
  standbyPf: number
  powerSafetyFactor: number
}

// y = a·ln(b·x + c) + d·x + e — curva de derating de capacidade da bateria
// por temperatura ambiente, ajustada uma única vez a partir de um
// datasheet de fabricante (fonte: upsbatterycenter.com). Não é editável
// pela tela (pedido do usuário cobriu só os 4 catálogos de lista — UPS,
// equipamento, bateria externa, grupos de bateria; esta curva é um dado
// "científico" fixo, igual pra qualquer conta).
export const TEMPERATURE_CURVE: BatteryCurve = {
  a: 35.13339088428316,
  b: 0.015650555629037378,
  c: 6.421107151504944,
  d: -0.07634371786785887,
  e: -64.50173901498157,
}

export function upsTechnologies(catalog: UpsModel[]): string[] {
  return Array.from(new Set(catalog.map(u => u.technology))).sort()
}

export function upsByTechnology(catalog: UpsModel[], technology: string): UpsModel[] {
  return technology === 'Todos' ? catalog : catalog.filter(u => u.technology === technology)
}

export function findBatteryGroup(groups: BatteryGroup[], capacityAh: number): BatteryGroup | undefined {
  return groups.find(g => g.capacityAh === capacityAh)
}

// Nem todo UPS do catálogo usa uma capacidade de bateria com curva
// ajustada (a maioria usa; alguns modelos pequenos usam 5/7 Ah, sem curva
// própria — ver histórico em specs/telas-auxiliares.md). Pra esses casos,
// a UI usa a curva do grupo de capacidade mais próxima como aproximação —
// nunca trava o cálculo, mas o rótulo do campo deixa claro que é uma
// aproximação.
export function nearestBatteryGroup(groups: BatteryGroup[], capacityAh: number): BatteryGroup {
  return groups.reduce((best, g) =>
    Math.abs(g.capacityAh - capacityAh) < Math.abs(best.capacityAh - capacityAh) ? g : best
  )
}

// Soma a potência aparente (VA) de todos os componentes cadastrados pra um
// equipamento — "Ativo" conta todo componente, "Stand by" só os marcados
// como `standby: true` (os que continuam ligados fora do ciclo de
// disparo: eletrônica de controle, monitor, computador, ventilação,
// solenoide de trava, câmeras etc. — ver Escâneres!G, planilha original).
export function equipmentApparentPowerVA(bom: EquipmentBomComponent[], equipmentName: string): { active: number; standby: number } {
  let active = 0
  let standby = 0
  for (const c of bom) {
    const qty = c.qtyByEquipment[equipmentName]
    if (!qty) continue
    active += qty * c.unitVA
    if (c.standby) standby += qty * c.unitVA
  }
  return { active, standby }
}

// y = a·ln(b·x + c) + d·x + e
export function temperatureDeratingFactor(ambientTempC: number, curve: BatteryCurve = TEMPERATURE_CURVE): number {
  const { a, b, c, d, e } = curve
  return a * Math.log(b * ambientTempC + c) + d * ambientTempC + e
}

// E(P) = a·(e^(-P/b) + e^(-P/c) + e^(-P/d)) + e/P — energia disponível
// (Wh) numa bateria deste grupo de capacidade, dada a potência (W) que ela
// está entregando — curva ajustada a partir da tabela de descarga do
// fabricante (tempo × corrente em vários Vf de corte), uma por capacidade.
export function batteryEnergyWh(curve: BatteryCurve, powerPerBatteryW: number): number {
  if (powerPerBatteryW <= 0) return 0
  const { a, b, c, d, e } = curve
  return a * (Math.exp(-powerPerBatteryW / b) + Math.exp(-powerPerBatteryW / c) + Math.exp(-powerPerBatteryW / d)) + e / powerPerBatteryW
}

export interface LoadSegment {
  label: string
  apparentPowerVA: number
  timeS: number
  pf: number
}

export interface BatteryBankConfig {
  seriesCount: number   // Nº de baterias em série (define a tensão do banco)
  lines: number          // Nº de linhas (fileiras) em paralelo
  capacityAh: number     // Capacidade de cada bateria — precisa ser uma das BATTERY_GROUPS
}

export interface AutonomyCalcInput {
  loadSegments: LoadSegment[]           // tipicamente 2: Ativo e Stand By
  selectedUps: UpsModel
  batteryGroups: BatteryGroup[]
  internalBattery: BatteryBankConfig    // normalmente derivado do próprio UPS selecionado
  externalBattery: BatteryBankConfig | null  // null = nenhuma bateria externa
  // Parâmetros gerais — mesmos defaults da planilha original, editáveis:
  upsPf: number            // "FP UPS" — fator de potência de saída do UPS, default 0.9
  batteryEfficiency: number // "Rendim. bateria" — default 0.95
  autonomySafetyFactor: number // "FS Autonomia" — reduz a autonomia estimada, default 0.2
  ambientTempC: number      // "Menor temp. méd." — default 15
  powerSafetyFactor: number // "FS Potência" — do equipamento selecionado (Parametros Carga Equipamento)
}

export interface AutonomyCalcResult {
  activePowerBySegment: number[]
  maxActivePowerW: number       // Pmax
  avgActivePowerW: number       // Pm
  avgApparentPowerVA: number    // Sm
  avgBatteryPowerW: number      // Pmb — potência média consumida da bateria
  minUpsApparentPowerVA: number // potência aparente mínima que o UPS precisa suportar
  minUpsActivePowerW: number
  internalBatteryPowerW: number
  externalBatteryPowerW: number
  internalEnergyPerBatteryWh: number
  externalEnergyPerBatteryWh: number
  internalTotalEnergyWh: number
  externalTotalEnergyWh: number
  temperatureFactor: number
  autonomyHours: number
  warnings: string[]
}

// Réplica de Cálculos!M12:M33 + B31/B32/B35 — ver o comentário no topo do
// arquivo. Lança erro se algum grupo de bateria (interna/externa) não tiver
// curva cadastrada pra capacidade escolhida — a UI deve restringir o
// seletor de capacidade às `batteryGroups` existentes, nunca deixar digitar
// um Ah livre.
export function calculateAutonomy(input: AutonomyCalcInput): AutonomyCalcResult {
  const { loadSegments, selectedUps, batteryGroups, internalBattery, externalBattery } = input
  const warnings: string[] = []

  const activePowerBySegment = loadSegments.map(s => s.apparentPowerVA * s.pf)
  const maxActivePowerW = Math.max(0, ...activePowerBySegment)
  const totalTimeS = loadSegments.reduce((sum, s) => sum + s.timeS, 0)
  const avgActivePowerW = totalTimeS > 0
    ? loadSegments.reduce((sum, s, i) => sum + activePowerBySegment[i] * s.timeS, 0) / totalTimeS
    : 0
  const avgApparentPowerVA = totalTimeS > 0
    ? loadSegments.reduce((sum, s) => sum + s.apparentPowerVA * s.timeS, 0) / totalTimeS
    : 0

  const avgBatteryPowerW = avgActivePowerW / input.batteryEfficiency
  const minUpsActivePowerW = (1 + input.powerSafetyFactor) * maxActivePowerW
  const minUpsApparentPowerVA = minUpsActivePowerW / input.upsPf

  const internalGroup = findBatteryGroup(batteryGroups, internalBattery.capacityAh)
  if (!internalGroup) throw new Error(`Nenhuma curva de bateria cadastrada para ${internalBattery.capacityAh} Ah (banco interno)`)

  const extCapacity = externalBattery?.capacityAh ?? 0
  const extSeriesLines = externalBattery ? externalBattery.seriesCount * externalBattery.lines * externalBattery.capacityAh : 0
  const intSeriesLines = internalBattery.seriesCount * internalBattery.lines * internalBattery.capacityAh
  const totalWeightedCapacity = extSeriesLines + intSeriesLines

  const internalBatteryPowerW = totalWeightedCapacity > 0
    ? (avgBatteryPowerW * internalBattery.capacityAh) / totalWeightedCapacity
    : 0
  const internalEnergyPerBatteryWh = batteryEnergyWh(internalGroup.curve, internalBatteryPowerW)
  const internalTotalEnergyWh = internalEnergyPerBatteryWh * internalBattery.seriesCount * internalBattery.lines

  let externalBatteryPowerW = 0
  let externalEnergyPerBatteryWh = 0
  let externalTotalEnergyWh = 0
  if (externalBattery && externalBattery.capacityAh > 0) {
    const externalGroup = findBatteryGroup(batteryGroups, externalBattery.capacityAh)
    if (!externalGroup) throw new Error(`Nenhuma curva de bateria cadastrada para ${extCapacity} Ah (banco externo)`)
    externalBatteryPowerW = totalWeightedCapacity > 0
      ? (avgBatteryPowerW * externalBattery.capacityAh) / totalWeightedCapacity
      : 0
    externalEnergyPerBatteryWh = batteryEnergyWh(externalGroup.curve, externalBatteryPowerW)
    externalTotalEnergyWh = externalEnergyPerBatteryWh * externalBattery.seriesCount * externalBattery.lines
  }

  const temperatureFactor = temperatureDeratingFactor(input.ambientTempC)
  const autonomyHours = avgBatteryPowerW > 0
    ? ((externalTotalEnergyWh + internalTotalEnergyWh) / avgBatteryPowerW) * (1 - input.autonomySafetyFactor) * temperatureFactor
    : 0

  if (minUpsApparentPowerVA > selectedUps.apparentPowerVA) {
    warnings.push('A potência do UPS selecionado não é suficiente para a aplicação.')
  }
  if (selectedUps.batteryExpansion === 'Não' && externalBattery && externalBattery.capacityAh > 0) {
    warnings.push('Este UPS não permite expansão de bateria externa.')
  }
  if (selectedUps.batteryExpansion === 'Opcional' && externalBattery && externalBattery.capacityAh > 0) {
    warnings.push('Especificar ao fornecedor que este modelo de UPS deve possuir expansão de bateria externa.')
  }

  return {
    activePowerBySegment,
    maxActivePowerW,
    avgActivePowerW,
    avgApparentPowerVA,
    avgBatteryPowerW,
    minUpsApparentPowerVA,
    minUpsActivePowerW,
    internalBatteryPowerW,
    externalBatteryPowerW,
    internalEnergyPerBatteryWh,
    externalEnergyPerBatteryWh,
    internalTotalEnergyWh,
    externalTotalEnergyWh,
    temperatureFactor,
    autonomyHours,
    warnings,
  }
}

export function formatHoursAsHM(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—'
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${String(m).padStart(2, '0')}min`
}
