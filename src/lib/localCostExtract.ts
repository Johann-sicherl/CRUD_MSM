import { FORCE_TO_ONE_FIELDS, getRealColumnFields, type TableSchema } from './schema'
import { getRowKey, getRowLabel } from './csvBaseline'
import { toCellValue, isBlankCell } from './globalUpdateConvert'

// Puro/isomórfico (sem 'fs') — extrai, de um CSV recém-anexado no
// Atualizador Global, os valores REAIS das colunas financeiras (as mesmas
// que FORCE_TO_ONE_FIELDS sempre grava como 1 no Supabase por sigilo),
// ANTES desse valor ser sobrescrito. Não decide onde isso é guardado —
// só devolve os dados; quem chama (a rota de import) grava no arquivo
// local (ver localCostStore.ts, que é o único lugar que toca 'fs').

export interface ExtractedCostRow {
  label: string
  values: Record<string, number | null>
}

// null = esta tabela não tem nenhuma coluna financeira (FORCE_TO_ONE_FIELDS)
// — nada a capturar, nada a gravar localmente por causa dela.
export function extractRealCosts(
  schema: TableSchema,
  rows: Record<string, unknown>[],
): Record<string, ExtractedCostRow> | null {
  const fieldByLowerName = new Map(getRealColumnFields(schema).map(f => [f.name.toLowerCase(), f]))
  const forceFields = FORCE_TO_ONE_FIELDS.filter(name => fieldByLowerName.has(name))
  if (forceFields.length === 0) return null

  const out: Record<string, ExtractedCostRow> = {}
  for (const row of rows) {
    // Mesma conversão de tipo usada pela substituição real (convertCsvRows em
    // globalUpdateConvert.ts) — precisamos dos valores já tipados (número,
    // não texto do CSV) tanto para a chave de negócio (getRowKey precisa dos
    // outros campos já corretos) quanto para os valores financeiros em si.
    const rawByLowerName = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
    const converted: Record<string, unknown> = {}
    for (const [lowerKey, rawVal] of rawByLowerName) {
      const field = fieldByLowerName.get(lowerKey)
      if (field) converted[field.name] = toCellValue(field, rawVal)
    }

    const values: Record<string, number | null> = {}
    let hasAny = false
    for (const fname of forceFields) {
      // Célula vazia/ausente no CSV vira NULL aqui, mesmo que o campo tenha
      // defaultValue no schema (ex.: cost_std -> 0) — esse default é uma
      // conveniência para a gravação real (que não pode violar NOT NULL),
      // não um valor "real" que veio do CSV. Sem isso, todo item sem custo
      // no CSV apareceria com "custo real R$ 0,00", o que é diferente de
      // "custo desconhecido/não informado".
      const raw = rawByLowerName.get(fname.toLowerCase())
      if (raw === undefined || isBlankCell(raw)) { values[fname] = null; continue }
      const v = converted[fname]
      values[fname] = typeof v === 'number' ? v : null
      if (typeof v === 'number') hasAny = true
    }
    if (!hasAny) continue // linha sem nenhum valor financeiro real no CSV — nada a guardar

    const key = getRowKey(schema, converted)
    out[key] = { label: getRowLabel(schema, converted), values }
  }
  return out
}
