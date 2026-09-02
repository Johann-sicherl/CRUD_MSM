import type { PdmAccessoryRow } from './pdmDb'

// Compara o resultado da consulta ao PDM com o que já está gravado em
// accessories (Supabase), campo a campo, pra tela Consulta PDM x Supabase.
// Mapeamento confirmado com o usuário: NOME_COMERCIAL = campo "Nome",
// ID_GRUPO = legacy_group_id (accessory_groups) diretamente.

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

  // Merge oculto: itens já cadastrados no Supabase que a consulta ao PDM não
  // trouxe — aparecem cinza-esmaecido, só pra indicar o que falta inserir no PDM.
  for (const row of supabaseRows) {
    const code = String(row.protheus_code ?? '').trim().toUpperCase()
    if (!code || matchedCodes.has(code)) continue
    result.push({ status: 'supabase-only', protheusCode: String(row.protheus_code ?? ''), supabaseId: String(row.id ?? ''), supabaseRow: row })
  }

  return result
}
