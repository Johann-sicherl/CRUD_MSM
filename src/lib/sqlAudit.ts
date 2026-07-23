import type { SupabaseClient } from '@supabase/supabase-js'
import type { Field, TableSchema } from './schema'
import { isRealColumnField } from './schema'

/** Renders a JS value as a Postgres SQL literal, based on the field's type. */
export function sqlLiteral(field: Field, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'NULL'
  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'TRUE' : 'FALSE'
    case 'number': {
      const n = parseInt(String(value))
      return Number.isNaN(n) ? 'NULL' : String(n)
    }
    case 'decimal': {
      const n = parseFloat(String(value))
      return Number.isNaN(n) ? 'NULL' : String(n)
    }
    case 'jsonb': {
      const json = typeof value === 'string' ? value : JSON.stringify(value)
      return `'${json.replace(/'/g, "''")}'::jsonb`
    }
    default:
      return `'${String(value).replace(/'/g, "''")}'`
  }
}

/** The field(s) used to identify a row across environments (test DB vs.
 *  production) — never the internal uuid PK, which is generated independently
 *  in each database. Tables with a single unique/autoIncrement column use
 *  that; tables without one (pure relationship/rule tables) fall back to
 *  every field marked `noBulkEdit` — those are exactly the identity/relational
 *  columns the schema already says shouldn't be mass-edited, so together they
 *  form a natural composite key. Last resort is the internal id. */
export function getAuditKeyFields(schema: TableSchema): Field[] {
  if (schema.auditKeyField) {
    const names = Array.isArray(schema.auditKeyField) ? schema.auditKeyField : [schema.auditKeyField]
    const explicit = names.map(n => schema.fields.find(f => f.name === n)).filter((f): f is Field => !!f)
    if (explicit.length > 0) return explicit
  }
  const unique = schema.fields.find(f => f.unique && !f.isPk)
  if (unique) return [unique]
  const autoIncr = schema.fields.find(f => f.autoIncrement)
  if (autoIncr) return [autoIncr]
  const composite = schema.fields.filter(f => f.noBulkEdit && !f.isPk)
  if (composite.length > 0) return composite
  return [schema.fields.find(f => f.isPk)!]
}

function keyValueString(keyFields: Field[], row: Record<string, unknown>): string {
  return keyFields.map(f => String(row[f.name] ?? '')).join('|')
}

function whereClause(keyFields: Field[], row: Record<string, unknown>): string {
  return keyFields.map(f => `${f.name} = ${sqlLiteral(f, row[f.name])}`).join(' AND ')
}

/** INSERT statement. Lists every editable column explicitly — including empty
 *  ones as NULL — so whoever reviews it sees the full row shape at a glance.
 *  created_at/updated_at are skipped so the production DB fills them with its
 *  own NOW() default; legacy_id-style autoIncrement fields are still included
 *  since the route always computes and provides a value for those. */
export function buildInsertSQL(table: string, schema: TableSchema, row: Record<string, unknown>): string {
  const cols: string[] = []
  const vals: string[] = []
  for (const field of schema.fields) {
    if (field.isPk) continue
    // Readonly fields are only ever legacy_id-style autoIncrement columns
    // (which the route computes a real value for) or created_at/updated_at
    // (which must always come from the production DB's own NOW() default).
    if (field.isReadonly && !field.autoIncrement) continue
    // Virtual fields (concatFrom/countDuplicatesOf/lookupFrom via another
    // field) have no column of their own in the real table — e.g. group_name
    // and accessory_name on relationship_equip_accessory, or resumo/
    // resumo_count on standard_equipment_items — including them here would
    // generate an INSERT against a column that doesn't exist.
    if (!isRealColumnField(field)) continue
    cols.push(field.name)
    vals.push(sqlLiteral(field, row[field.name]))
  }
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`
}

/** UPDATE statement, keyed on the business key (not the internal uuid).
 *  `keyRow` only needs to carry the key fields' values. */
export function buildUpdateSQL(
  table: string,
  schema: TableSchema,
  changedFields: Record<string, unknown>,
  keyFields: Field[],
  keyRow: Record<string, unknown>,
): string {
  const keyNames = new Set(keyFields.map(f => f.name))
  const sets: string[] = []
  for (const [name, val] of Object.entries(changedFields)) {
    if (keyNames.has(name)) continue
    const field = schema.fields.find(f => f.name === name)
    if (!field) continue
    sets.push(`${name} = ${sqlLiteral(field, val)}`)
  }
  return `UPDATE ${table} SET ${sets.join(', ')} WHERE ${whereClause(keyFields, keyRow)};`
}

export function buildDeleteSQL(table: string, keyFields: Field[], keyRow: Record<string, unknown>): string {
  return `DELETE FROM ${table} WHERE ${whereClause(keyFields, keyRow)};`
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
  payload: Record<string, unknown> | null
}

async function findPending(admin: SupabaseClient, table: string, keyValue: string): Promise<PendingRow | null> {
  const { data } = await admin
    .from('audit_log')
    .select('id, operation, baseline, payload')
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
  const keyFields = getAuditKeyFields(schema)
  const keyValue = keyValueString(keyFields, insertedRow)
  const existing = await findPending(admin, table, keyValue)

  const row = {
    table_name: table,
    operation: 'insert' as const,
    record_key_field: keyFields.map(f => f.name).join(','),
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
  const keyFields = getAuditKeyFields(schema)
  const keyRow = beforeRow ?? updateBody
  const keyValue = keyValueString(keyFields, keyRow)
  const existing = await findPending(admin, table, keyValue)

  if (existing?.operation === 'insert') {
    // updateBody only carries editable fields (never autoIncrement ones like
    // legacy_id, which the PUT route never touches) — merge over the
    // original insert payload so those columns survive the regeneration.
    const mergedRow = { ...(existing.payload ?? {}), ...updateBody }
    await admin.from('audit_log').update({
      sql_query: buildInsertSQL(table, schema, mergedRow),
      payload: mergedRow,
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
    record_key_field: keyFields.map(f => f.name).join(','),
    record_key_value: keyValue,
    sql_query: buildUpdateSQL(table, schema, changed, keyFields, keyRow),
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
  const keyFields = getAuditKeyFields(schema)
  const keyValue = keyValueString(keyFields, deletedRow)
  const existing = await findPending(admin, table, keyValue)

  if (existing?.operation === 'insert') {
    await admin.from('audit_log').delete().eq('id', existing.id)
    return
  }

  const row = {
    table_name: table,
    operation: 'delete' as const,
    record_key_field: keyFields.map(f => f.name).join(','),
    record_key_value: keyValue,
    sql_query: buildDeleteSQL(table, keyFields, deletedRow),
    payload: deletedRow,
    baseline: null,
    status: 'pending' as const,
  }

  if (existing) await admin.from('audit_log').update(row).eq('id', existing.id)
  else await admin.from('audit_log').insert(row)
}
