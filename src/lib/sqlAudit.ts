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

/** INSERT statement. Uses the literal value computed in this test DB for every
 *  field, including autoIncrement ones — if the production DB already has a
 *  higher legacy_id, adjust the number by hand before sending it to IT. */
export function buildInsertSQL(table: string, schema: TableSchema, row: Record<string, unknown>): string {
  const cols: string[] = []
  const vals: string[] = []
  for (const field of schema.fields) {
    if (field.isPk) continue
    if (!(field.name in row)) continue
    cols.push(field.name)
    vals.push(sqlLiteral(field, row[field.name]))
  }
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`
}

/** UPDATE statement, keyed on the business key (not the internal uuid). */
export function buildUpdateSQL(
  table: string,
  schema: TableSchema,
  changedFields: Record<string, unknown>,
  keyField: Field,
  keyValue: unknown,
): string {
  const sets: string[] = []
  for (const [name, val] of Object.entries(changedFields)) {
    if (name === keyField.name) continue
    const field = schema.fields.find(f => f.name === name)
    if (!field) continue
    sets.push(`${name} = ${sqlLiteral(field, val)}`)
  }
  return `UPDATE ${table} SET ${sets.join(', ')} WHERE ${keyField.name} = ${sqlLiteral(keyField, keyValue)};`
}

export function buildDeleteSQL(table: string, keyField: Field, keyValue: unknown): string {
  return `DELETE FROM ${table} WHERE ${keyField.name} = ${sqlLiteral(keyField, keyValue)};`
}

/** The form always resubmits every editable field, so a raw update payload alone
 *  can't tell which ones actually changed vs. some baseline. `updated_at` is
 *  bookkeeping, not a real edit, so it never counts on its own. */
export function diffChangedFields(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const [name, val] of Object.entries(current)) {
    if (name === 'updated_at') continue
    const prev = baseline[name] ?? null
    const next = val ?? null
    const equal = typeof prev === 'object' || typeof next === 'object'
      ? JSON.stringify(prev) === JSON.stringify(next)
      : prev === next
    if (!equal) changed[name] = val
  }
  return changed
}

type PendingRow = {
  id: string
  operation: 'insert' | 'update' | 'delete'
  baseline: Record<string, unknown> | null
}

async function findPending(admin: SupabaseClient, table: string, keyValue: string): Promise<PendingRow | null> {
  const { data } = await admin
    .from('audit_log')
    .select('id, operation, baseline')
    .eq('table_name', table)
    .eq('record_key_value', keyValue)
    .eq('status', 'pending')
    .maybeSingle()
  return data as PendingRow | null
}

/** Record a freshly-inserted row as a pending draft. If this same record
 *  somehow already had a pending draft (shouldn't normally happen — it was
 *  just created), the new insert simply replaces it. */
export async function recordInsertAudit(
  admin: SupabaseClient,
  table: string,
  schema: TableSchema,
  insertedRow: Record<string, unknown>,
): Promise<void> {
  const keyField = getAuditKeyField(schema)
  const keyValue = String(insertedRow[keyField.name] ?? '')
  const existing = await findPending(admin, table, keyValue)

  const row = {
    table_name: table,
    operation: 'insert' as const,
    record_key_field: keyField.name,
    record_key_value: keyValue,
    sql_query: buildInsertSQL(table, schema, insertedRow),
    payload: insertedRow,
    baseline: null,
    status: 'pending' as const,
  }

  if (existing) await admin.from('audit_log').update(row).eq('id', existing.id)
  else await admin.from('audit_log').insert(row)
}

/** Record an edit as a pending draft.
 *  - If a pending INSERT draft already exists for this record (created and
 *    edited before ever being exported), the draft stays an INSERT — just
 *    regenerated with the latest field values.
 *  - Otherwise it's a real UPDATE against production. The first edit since
 *    the last export captures `beforeRow` as the baseline; further edits
 *    reuse that same baseline (not the live, already-edited test-DB row) so
 *    the comparison is always against the true starting point. If the
 *    current values end up matching the baseline again, the draft is
 *    discarded — nothing to send. */
export async function recordUpdateAudit(
  admin: SupabaseClient,
  table: string,
  schema: TableSchema,
  beforeRow: Record<string, unknown> | null,
  updateBody: Record<string, unknown>,
): Promise<void> {
  const keyField = getAuditKeyField(schema)
  const keyValue = String((beforeRow?.[keyField.name] ?? updateBody[keyField.name]) ?? '')
  const existing = await findPending(admin, table, keyValue)

  if (existing?.operation === 'insert') {
    await admin.from('audit_log').update({
      sql_query: buildInsertSQL(table, schema, updateBody),
      payload: updateBody,
    }).eq('id', existing.id)
    return
  }

  const hasStoredBaseline = existing?.operation === 'update' && existing.baseline && Object.keys(existing.baseline).length > 0
  const baseline = hasStoredBaseline ? existing!.baseline! : (beforeRow ?? {})
  const changed = diffChangedFields(baseline, updateBody)

  if (Object.keys(changed).length === 0) {
    if (existing) await admin.from('audit_log').delete().eq('id', existing.id)
    return
  }

  const row = {
    table_name: table,
    operation: 'update' as const,
    record_key_field: keyField.name,
    record_key_value: keyValue,
    sql_query: buildUpdateSQL(table, schema, changed, keyField, keyValue),
    payload: updateBody,
    baseline,
    status: 'pending' as const,
  }

  if (existing) await admin.from('audit_log').update(row).eq('id', existing.id)
  else await admin.from('audit_log').insert(row)
}

/** Record a delete as a pending draft. If the record was created and never
 *  exported, the delete just cancels the pending INSERT — production never
 *  had the row, so there's nothing to send. */
export async function recordDeleteAudit(
  admin: SupabaseClient,
  table: string,
  schema: TableSchema,
  deletedRow: Record<string, unknown>,
): Promise<void> {
  const keyField = getAuditKeyField(schema)
  const keyValue = String(deletedRow[keyField.name] ?? '')
  const existing = await findPending(admin, table, keyValue)

  if (existing?.operation === 'insert') {
    await admin.from('audit_log').delete().eq('id', existing.id)
    return
  }

  const row = {
    table_name: table,
    operation: 'delete' as const,
    record_key_field: keyField.name,
    record_key_value: keyValue,
    sql_query: buildDeleteSQL(table, keyField, keyValue),
    payload: deletedRow,
    baseline: null,
    status: 'pending' as const,
  }

  if (existing) await admin.from('audit_log').update(row).eq('id', existing.id)
  else await admin.from('audit_log').insert(row)
}
