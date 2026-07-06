import type { SupabaseClient } from '@supabase/supabase-js'
import type { Field, TableSchema } from './schema'

/** Renders a JS value as a Postgres SQL literal, based on the field's type. */
export function sqlLiteral(field: Field, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'NULL'
  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'TRUE' : 'FALSE'
    case 'number':
      return String(parseInt(String(value)))
    case 'decimal':
      return String(parseFloat(String(value)))
    case 'jsonb': {
      const json = typeof value === 'string' ? value : JSON.stringify(value)
      return `'${json.replace(/'/g, "''")}'::jsonb`
    }
    default:
      return `'${String(value).replace(/'/g, "''")}'`
  }
}

/** The field used to identify a row across environments (test DB vs. production).
 *  Never the internal uuid PK — that's generated independently in each database. */
export function getAuditKeyField(schema: TableSchema): Field {
  if (schema.auditKeyField) {
    const explicit = schema.fields.find(f => f.name === schema.auditKeyField)
    if (explicit) return explicit
  }
  const unique = schema.fields.find(f => f.unique && !f.isPk)
  if (unique) return unique
  const autoIncr = schema.fields.find(f => f.autoIncrement)
  if (autoIncr) return autoIncr
  return schema.fields.find(f => f.isPk)!
}

/** INSERT statement. autoIncrement fields are rebuilt as a MAX()+1 subquery so the
 *  value is computed fresh against whichever database it actually runs on — the
 *  literal value in this test DB may not match production's current max. */
export function buildInsertSQL(table: string, schema: TableSchema, insertBody: Record<string, unknown>): string {
  const cols: string[] = []
  const vals: string[] = []
  for (const field of schema.fields) {
    if (field.isPk) continue
    if (!(field.name in insertBody)) continue
    cols.push(field.name)
    vals.push(
      field.autoIncrement
        ? `(SELECT COALESCE(MAX(${field.name}), 0) + 1 FROM ${table})`
        : sqlLiteral(field, insertBody[field.name])
    )
  }
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`
}

/** UPDATE statement, keyed on the business key (not the internal uuid). */
export function buildUpdateSQL(
  table: string,
  schema: TableSchema,
  updateBody: Record<string, unknown>,
  keyField: Field,
  keyValue: unknown,
): string {
  const sets: string[] = []
  for (const [name, val] of Object.entries(updateBody)) {
    if (name === keyField.name) continue
    if (name === 'updated_at') { sets.push('updated_at = NOW()'); continue }
    const field = schema.fields.find(f => f.name === name)
    if (!field) continue
    sets.push(`${name} = ${sqlLiteral(field, val)}`)
  }
  return `UPDATE ${table} SET ${sets.join(', ')} WHERE ${keyField.name} = ${sqlLiteral(keyField, keyValue)};`
}

export function buildDeleteSQL(table: string, keyField: Field, keyValue: unknown): string {
  return `DELETE FROM ${table} WHERE ${keyField.name} = ${sqlLiteral(keyField, keyValue)};`
}

/** Keeps a single "pending" audit_log row per record — repeated edits before
 *  export overwrite the same draft instead of piling up one entry per click.
 *  If a record is created and deleted again before ever being exported, the
 *  draft is simply discarded: nothing needs to reach production for it. */
export async function recordAudit(
  admin: SupabaseClient,
  table: string,
  schema: TableSchema,
  operation: 'insert' | 'update' | 'delete',
  fullRow: Record<string, unknown>,
  sqlQuery: string,
): Promise<void> {
  const keyField = getAuditKeyField(schema)
  const keyValue = String(fullRow[keyField.name] ?? '')

  const { data: existing } = await admin
    .from('audit_log')
    .select('id, operation')
    .eq('table_name', table)
    .eq('record_key_value', keyValue)
    .eq('status', 'pending')
    .maybeSingle()

  if (operation === 'delete' && existing?.operation === 'insert') {
    await admin.from('audit_log').delete().eq('id', existing.id)
    return
  }

  const row = {
    table_name: table,
    operation,
    record_key_field: keyField.name,
    record_key_value: keyValue,
    sql_query: sqlQuery,
    payload: fullRow,
    status: 'pending',
  }

  if (existing) {
    await admin.from('audit_log').update(row).eq('id', existing.id)
  } else {
    await admin.from('audit_log').insert(row)
  }
}
