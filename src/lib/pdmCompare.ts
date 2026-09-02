import type { PdmAccessoryRow } from './pdmDb'

// Compara o resultado da consulta ao PDM com o que já está gravado em
// accessories (banco de dados MSM), campo a campo, pra tela Consulta PDM x
// Banco MSM. Mapeamento confirmado com o usuário: NOME_COMERCIAL = campo
// "Nome", ID_GRUPO = legacy_group_id (accessory_groups) diretamente.

export interface PdmFieldDiff {
  supabaseField: string
  label: string
  pdmDisplay: string
  supabaseDisplay: string
}

export type PdmComparisonRow =
  | { status: 'ok' | 'mismatch'; protheusCode: string; pdm: PdmAccessoryRow; supabaseId: string; supabaseRow: Record<string, unknown>; diffs: PdmFieldDiff[] }
  | { status: 'pdm-only'; protheusCode: string; pdm: PdmAccessoryRow }
  | { status: 'supabase-only'; protheusCode: string; supabaseId: string; supabaseRow: Record<string, unknown> }

type FieldKind = 'text' | 'number'

interface FieldMapEntry {
  pdmKey: keyof PdmAccessoryRow
  supabaseField: string
  label: string
  kind: FieldKind
}

// Mesmos campos exibidos em Cadastro de Componentes — cost_std (Custo) e
// legacy_general_alert_id ficam de fora: custo real não vem do PDM (é
// capturado à parte, ver localCostStore.ts) e o valor de alerta do PDM
// (ALERTA_GERAL) não tem garantia de bater 1:1 com o ID de general_alerts.
export const PDM_FIELD_MAP: FieldMapEntry[] = [
  { pdmKey: 'idGrupo',              supabaseField: 'legacy_group_id',      label: 'Grupo',                kind: 'number' },
  { pdmKey: 'corProduto',           supabaseField: 'color',                label: 'Cor',                  kind: 'text' },
  { pdmKey: 'materialPredominante', supabaseField: 'predominant_material', label: 'Material Predom.',     kind: 'text' },
  { pdmKey: 'dimensionalMm',        supabaseField: 'dimensional_mm',       label: 'Dimensão (mm)',        kind: 'number' },
  { pdmKey: 'qtdMonTotem',          supabaseField: 'quantity_monitor_totem', label: 'Qtd. Monitor Totem', kind: 'number' },
  { pdmKey: 'tamanhoMonitor',       supabaseField: 'monitor_size',         label: 'Tam. Monitor (pol)',   kind: 'number' },
  { pdmKey: 'nomeComercial',        supabaseField: 'name',                 label: 'Nome',                 kind: 'text' },
  { pdmKey: 'obs',                  supabaseField: 'description',          label: 'Descrição',            kind: 'text' },
]

function normalizeText(v: unknown): string {
  const s = String(v ?? '').trim()
  return (s === '' || s.toUpperCase() === 'N/A') ? '' : s
}

// PDM traz decimal com vírgula ("21,5") — normaliza pra ponto antes de comparar.
function normalizeNumber(v: unknown): number | null {
  const s = normalizeText(v)
  if (s === '') return null
  const n = parseFloat(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

export function displayText(v: unknown): string {
  const s = normalizeText(v)
  return s === '' ? '—' : s
}

function fieldsEqual(kind: FieldKind, pdmValue: unknown, supabaseValue: unknown): boolean {
  if (kind === 'number') {
    const a = normalizeNumber(pdmValue)
    const b = normalizeNumber(supabaseValue)
    return a === b
  }
  return normalizeText(pdmValue).toUpperCase() === normalizeText(supabaseValue).toUpperCase()
}

function diffFields(pdm: PdmAccessoryRow, supabaseRow: Record<string, unknown>): PdmFieldDiff[] {
  const diffs: PdmFieldDiff[] = []
  for (const entry of PDM_FIELD_MAP) {
    const pdmValue = pdm[entry.pdmKey]
    const supabaseValue = supabaseRow[entry.supabaseField]
    if (!fieldsEqual(entry.kind, pdmValue, supabaseValue)) {
      diffs.push({
        supabaseField: entry.supabaseField,
        label: entry.label,
        pdmDisplay: displayText(pdmValue),
        supabaseDisplay: displayText(supabaseValue),
      })
    }
  }
  return diffs
}

export function comparePdmWithSupabase(
  pdmRows: PdmAccessoryRow[],
  supabaseRows: Record<string, unknown>[],
): PdmComparisonRow[] {
  const supabaseByCode = new Map<string, Record<string, unknown>>()
  for (const row of supabaseRows) {
    const code = String(row.protheus_code ?? '').trim().toUpperCase()
    if (code) supabaseByCode.set(code, row)
  }

  const matchedCodes = new Set<string>()
  const result: PdmComparisonRow[] = []

  for (const pdm of pdmRows) {
    const code = pdm.codigoProtheus.trim().toUpperCase()
    if (!code) continue
    const supabaseRow = supabaseByCode.get(code)
    if (!supabaseRow) {
      result.push({ status: 'pdm-only', protheusCode: pdm.codigoProtheus, pdm })
      continue
    }
    matchedCodes.add(code)
    const diffs = diffFields(pdm, supabaseRow)
    result.push({
      status: diffs.length > 0 ? 'mismatch' : 'ok',
      protheusCode: pdm.codigoProtheus,
      pdm,
      supabaseId: String(supabaseRow.id ?? ''),
      supabaseRow,
      diffs,
    })
  }

  // Merge oculto: itens já cadastrados no banco de dados MSM que a consulta
  // ao PDM não trouxe — aparecem cinza-esmaecido, só pra indicar o que falta
  // inserir no PDM.
  for (const row of supabaseRows) {
    const code = String(row.protheus_code ?? '').trim().toUpperCase()
    if (!code || matchedCodes.has(code)) continue
    result.push({ status: 'supabase-only', protheusCode: String(row.protheus_code ?? ''), supabaseId: String(row.id ?? ''), supabaseRow: row })
  }

  return result
}

// Pré-preenche o formulário de Cadastro de Componentes a partir de uma linha
// só-no-PDM (botão "+ Cadastrar" na tela Consulta PDM x Banco MSM) — mesma
// normalização usada na comparação (trata "N/A" como vazio, vírgula decimal
// como ponto), só grava a chave quando há valor de verdade.
export function pdmRowToPrefill(pdm: PdmAccessoryRow): Record<string, string> {
  const prefill: Record<string, string> = { protheus_code: pdm.codigoProtheus }

  const name = normalizeText(pdm.nomeComercial)
  if (name) prefill.name = name

  const groupId = normalizeNumber(pdm.idGrupo)
  if (groupId !== null) prefill.legacy_group_id = String(groupId)

  const color = normalizeText(pdm.corProduto)
  if (color) prefill.color = color

  const material = normalizeText(pdm.materialPredominante)
  if (material) prefill.predominant_material = material

  const dimensional = normalizeNumber(pdm.dimensionalMm)
  if (dimensional !== null) prefill.dimensional_mm = String(dimensional)

  const qtdMonitor = normalizeNumber(pdm.qtdMonTotem)
  if (qtdMonitor !== null) prefill.quantity_monitor_totem = String(qtdMonitor)

  const monitorSize = normalizeNumber(pdm.tamanhoMonitor)
  if (monitorSize !== null) prefill.monitor_size = String(monitorSize)

  const obs = normalizeText(pdm.obs)
  if (obs) prefill.description = obs

  return prefill
}
