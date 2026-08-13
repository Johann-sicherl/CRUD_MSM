import { isRealColumnField, type Field, type TableSchema } from './schema'
import { getAuditKeyFields } from './sqlAudit'

// Compartilhado entre o destaque amarelo das telas de Cadastro (DataTable)
// e a comparação "CSV novo vs. banco atual" do Atualizador Global — as duas
// telas precisam decidir "esse campo mudou?" da mesma forma exata, senão uma
// destacaria uma diferença que a outra consideraria irrelevante.

// created_at/updated_at (e afins, como last_login) são metadado de
// bookkeeping — mudam sozinhos a cada gravação e não são "informação" de
// verdade; incluí-los destacaria tudo em amarelo à toa. id é a própria
// chave de comparação, não um valor a comparar. Senha nunca aparece num
// alerta. Campos virtuais (lookup/concat/countDuplicatesOf) não têm coluna
// própria na tabela real.
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

// Identificador legível de uma linha para exibir num alerta — reaproveita a
// mesma chave de negócio já usada pela Auditoria (protheus_code, legacy_id
// etc.), nunca o uuid interno, que não diz nada pra quem está lendo.
export function getRowLabel(schema: TableSchema, row: Record<string, unknown>): string {
  const keyFields = getAuditKeyFields(schema)
  const parts = keyFields.map(f => `${f.label}: ${row[f.name] ?? '—'}`)
  return parts.join(', ') || String(row.id ?? '')
}
