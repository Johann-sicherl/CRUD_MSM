import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { tables, isControllershipTable, getControllershipPendingFields } from '@/lib/schema'
import { getAuditKeyFields } from '@/lib/sqlAudit'
import { findHeaderForField, normalizeControladoriaKey } from '@/lib/csvControladoriaDetect'
import { getProfileById } from '@/lib/userProfileStore'
import { updateTableRow } from '@/lib/tableWrite'

type RouteParams = { params: { table: string } }

// Import restrito a Controladoria/Fiscal/Precificação (tela Atualizador
// Global de Tabelas, perfil Gerente Adm Comercial) — diferente de
// /api/global-update/[table] (admin: apaga e recria a tabela inteira), esta
// rota só faz UPDATE, uma linha de cada vez, casando pela chave de negócio
// (protheus_code ou ID legado, ver getAuditKeyFields): nunca cria linha
// nova, nunca apaga nada, e só toca nas colunas de Controladoria/Fiscal/
// Precificação da própria tabela (ver getControllershipPendingFields) — uma
// coluna do CSV que não esteja nessa lista (nome, descrição, grupo,
// especificação técnica etc.) é simplesmente ignorada, mesmo que esteja no
// arquivo. Reaproveita updateTableRow (o mesmo caminho de PUT
// /api/[table]/[id]) linha a linha, pra herdar de graça a auditoria e a
// proteção de custo real local já existentes, sem duplicar essa lógica.
//
// Só tabela permitida (isControllershipTable) e só perfil de verdade
// (getProfileById, nunca um "isAdmin" solto vindo do corpo) podem chamar —
// ver comentário equivalente em global-update/[table]/route.ts sobre a
// ausência de sessão de servidor neste app.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { table } = params
  const schema = tables[table]
  if (!schema || !isControllershipTable(schema)) {
    return NextResponse.json({ error: 'Tabela não permitida para esta importação' }, { status: 404 })
  }

  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile) {
    return NextResponse.json({ error: 'Perfil não identificado' }, { status: 403 })
  }

  const rows: Record<string, string>[] = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: 'Nenhuma linha para importar' }, { status: 400 })

  const keyField = getAuditKeyFields(schema)[0]
  const allowedFields = getControllershipPendingFields(schema)
  if (allowedFields.length === 0) {
    return NextResponse.json({ error: 'Esta tabela não tem coluna de Controladoria/Fiscal/Precificação' }, { status: 400 })
  }

  // Casa cada linha do CSV com o id interno (uuid) já existente na tabela,
  // pela chave de negócio — busca tudo de uma vez (tabelas pequenas o
  // suficiente pra isso, mesmo padrão já usado em outras telas do app) em
  // vez de uma consulta por linha.
  const { data: existingRows, error: fetchError } = await supabaseAdmin.from(table).select(`id, ${keyField.name}`)
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })

  const idByKey = new Map<string, string>()
  for (const r of (existingRows ?? []) as unknown as Record<string, unknown>[]) {
    const k = normalizeControladoriaKey(keyField, r[keyField.name])
    if (k) idByKey.set(k, String(r.id))
  }

  let updated = 0
  let notFound = 0
  let localCostsCaptured = 0
  const errors: { key: string; error: string }[] = []

  // Sequencial de propósito (não Promise.all) — são dados financeiros
  // gravados em massa; previsibilidade e um erro por linha isolado importam
  // mais aqui do que a velocidade.
  for (const row of rows) {
    const headerByLower = new Map(Object.keys(row).map(h => [h.trim().toLowerCase(), h]))
    const keyHeader = findHeaderForField(keyField, headerByLower)
    const rawKey = keyHeader ? row[keyHeader] : undefined
    const normalizedKey = normalizeControladoriaKey(keyField, rawKey)
    if (!normalizedKey) { notFound++; continue }

    const id = idByKey.get(normalizedKey)
    if (!id) { notFound++; continue }

    const updateBody: Record<string, unknown> = {}
    for (const field of allowedFields) {
      const header = findHeaderForField(field, headerByLower)
      if (header !== undefined) updateBody[field.name] = row[header]
    }
    if (Object.keys(updateBody).length === 0) continue

    const { error, realCostFieldsChanged } = await updateTableRow(supabaseAdmin, table, schema, id, updateBody)
    if (error) {
      errors.push({ key: normalizedKey, error })
    } else {
      updated++
      if (realCostFieldsChanged && realCostFieldsChanged.length > 0) localCostsCaptured++
    }
  }

  return NextResponse.json({ updated, notFound, errors, localCostsCaptured })
}
