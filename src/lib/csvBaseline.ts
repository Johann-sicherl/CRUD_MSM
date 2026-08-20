import { isRealColumnField, type Field, type TableSchema } from './schema'
import { getAuditKeyFields, keyValueString } from './sqlAudit'

// Compartilhado entre o destaque amarelo das telas de Cadastro (DataTable)
// e a comparação "CSV novo vs. banco atual" do Atualizador Global — as duas
// telas precisam decidir "esse campo mudou?" da mesma forma exata, senão uma
// destacaria uma diferença que a outra consideraria irrelevante.

// created_at/updated_at (e afins, como last_login) são metadado de
// bookkeeping — mudam sozinhos a cada gravação e não são "informação" de
// verdade; incluí-los destacaria tudo em amarelo à toa. id (uuid interno)
// nunca é comparado — é regenerado a cada import CSV, então nunca é igual
// entre o banco e o baseline mesmo quando a linha é exatamente a mesma (ver
// getRowKey, abaixo, que é quem de fato casa as linhas). Senha nunca aparece
// num alerta. Campos virtuais (lookup/concat/countDuplicatesOf) não têm
// coluna própria na tabela real.
export function shouldCompareField(field: Field): boolean {
  if (!isRealColumnField(field)) return false
  if (field.isPk) return false
  if (field.type === 'password') return false
  if (field.isReadonly && field.type === 'timestamp') return false
  return true
}

const isBlank = (v: unknown) => v === null || v === undefined || v === ''

// Compara dois valores do MESMO campo, normalizando por tipo — evita falsos
// positivos por diferença de formatação (ex.: number/decimal podem voltar
// como string do Postgres via PostgREST, "12.50" vs 12.5 é o mesmo valor).
export function valuesEqual(field: Field, a: unknown, b: unknown): boolean {
  const blankA = isBlank(a)
  const blankB = isBlank(b)
  if (blankA && blankB) return true
  if (blankA !== blankB) return false

  if (field.type === 'number' || field.type === 'decimal') {
    const na = Number(a)
    const nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb
    return String(a) === String(b)
  }
  if (field.type === 'boolean') {
    return (a === true || a === 'true') === (b === true || b === 'true')
  }
  if (field.type === 'jsonb') {
    try {
      const pa = typeof a === 'string' ? JSON.parse(a) : a
      const pb = typeof b === 'string' ? JSON.parse(b) : b
      return JSON.stringify(pa) === JSON.stringify(pb)
    } catch {
      return String(a) === String(b)
    }
  }
  return String(a).trim() === String(b).trim()
}

// Texto legível para um valor num alerta de comparação.
export function formatDiffValue(field: Field, v: unknown): string {
  if (isBlank(v)) return '—'
  if (field.type === 'jsonb') {
    try { return JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v) } catch { return String(v) }
  }
  return String(v)
}

// Chave para CASAR uma linha entre o banco ao vivo, o baseline salvo e um
// CSV novo — nunca o uuid interno (id), que o Postgres gera de novo a cada
// import e por isso NUNCA repete entre uma tabela recarregada e o snapshot
// do import anterior, mesmo quando a linha é idêntica. Reaproveita a mesma
// chave de negócio que a Auditoria já usa pra este exato problema
// ("identificar uma linha across imports/ambientes" — ver getAuditKeyFields
// em sqlAudit.ts): protheus_code, legacy_id, ou a chave composta de campos
// noBulkEdit, dependendo da tabela.
export function getRowKey(schema: TableSchema, row: Record<string, unknown>): string {
  return keyValueString(getAuditKeyFields(schema), row)
}

// Identificador legível de uma linha para exibir num alerta — mesma chave
// acima, só que formatada como "Rótulo: valor" para leitura humana.
export function getRowLabel(schema: TableSchema, row: Record<string, unknown>): string {
  const keyFields = getAuditKeyFields(schema)
  const parts = keyFields.map(f => `${f.label}: ${row[f.name] ?? '—'}`)
  return parts.join(', ') || String(row.id ?? '')
}

// accessories, standard_equipment_items e dependant_items apontam todas pro
// mesmo catálogo de código Protheus (dependant_items.protheus_item_code é
// sempre o código de um item que já existe numa das outras duas) — o custo
// real de um código é um valor ÚNICO do item físico, não deveria variar
// dependendo de qual tabela o está referenciando. Por isso o arquivo local de
// custos (ver localCostStore.ts) guarda essas três tabelas juntas, num único
// bucket "items" chaveado só pelo código — nunca um valor por tabela.
// equipments fica de fora: os campos financeiros de lá (IPI, margem,
// comissões etc.) são parâmetros do equipamento inteiro, chaveados por
// legacy_id (um ID numérico, não um código de item) — conceito diferente,
// sem nada em comum pra consolidar, e misturar arriscaria colisão entre um
// legacy_id e um protheus_code parecido.
export const SHARED_ITEM_COST_TABLES = new Set(['accessories', 'standard_equipment_items', 'dependant_items'])

// Em dependant_items a chave de auditoria (getRowKey) é composta — inclui o
// equipamento e o item "pai" — porque identifica UMA linha específica da
// tabela. Mas o custo (rótulo "CUSTO ITEM DEPENDENTE") pertence ao item
// DEPENDENTE em si (protheus_item_code), o mesmo item que aparece em
// accessories/standard_equipment_items — é essa chave, não a de auditoria,
// que serve pra consolidar o custo entre as tabelas.
const COST_ITEM_CODE_FIELD: Record<string, string> = {
  dependant_items: 'protheus_item_code',
}

// Nome do bucket usado no arquivo local de custos para esta tabela — 'items'
// para as três tabelas compartilhadas acima, ou o próprio nome da tabela
// (comportamento de sempre) para qualquer outra, incluindo equipments.
export function costBucketFor(tableName: string): string {
  return SHARED_ITEM_COST_TABLES.has(tableName) ? 'items' : tableName
}

// Chave usada para gravar/consultar o custo real de UMA linha no arquivo
// local — normalmente igual a getRowKey, exceto em dependant_items (ver
// COST_ITEM_CODE_FIELD acima).
export function getCostItemKey(tableName: string, schema: TableSchema, row: Record<string, unknown>): string {
  const overrideField = COST_ITEM_CODE_FIELD[tableName]
  if (overrideField) return String(row[overrideField] ?? '')
  return getRowKey(schema, row)
}

export interface KeyedRows {
  byKey: Map<string, Record<string, unknown>>
  // Chaves que aparecem em MAIS DE UMA linha do conjunto — algumas tabelas
  // (ex.: relationship_equip_accessory) legitimamente têm o mesmo
  // Equipamento+Código repetido em linhas de verdade diferentes, cada uma
  // com outros campos distintos. Quando isso acontece, não dá pra saber com
  // segurança qual linha de um lado corresponde a qual linha do outro — a
  // chave inteira fica de fora de `byKey` e entra aqui, pra quem for
  // comparar tratar essas linhas como "sem veredito" em vez de arriscar um
  // pareamento errado.
  ambiguousKeys: Set<string>
}

export function groupRowsByKey(schema: TableSchema, rows: Record<string, unknown>[]): KeyedRows {
  const byKey = new Map<string, Record<string, unknown>>()
  const ambiguousKeys = new Set<string>()
  for (const row of rows) {
    const key = getRowKey(schema, row)
    if (ambiguousKeys.has(key)) continue
    if (byKey.has(key)) { byKey.delete(key); ambiguousKeys.add(key) }
    else byKey.set(key, row)
  }
  return { byKey, ambiguousKeys }
}
