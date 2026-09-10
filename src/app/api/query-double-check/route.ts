import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getProfileById } from '@/lib/userProfileStore'
import { rewriteStatementForCheck } from '@/lib/queryDoubleCheck'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface StatementResult {
  sql: string
  ok: boolean
  rowsAffected: number | null
  error: string | null
}

// Roda uma lista de instruções SQL (extraídas dos .txt exportados pela
// Auditoria) contra as cópias _check das tabelas — ver
// msm_query_double_check.sql (run_query_double_check) pro mecanismo de
// simulação/rollback. Cada instrução é reescrita aqui (accessories ->
// accessories_check etc.) antes de ir pro banco; a função Postgres confere
// a mesma coisa de novo, por segurança redundante.
//
// A função sempre levanta uma exceção de propósito no final (só assim dá
// pra devolver o resultado E garantir rollback total, mesmo com tudo
// certo) — então "error" aqui não significa que a chamada falhou; é
// esperado. O resultado de verdade vem em error.details (json).
export async function POST(request: NextRequest) {
  const body = await request.json()
  const profile = await getProfileById(String(body?.profileId ?? ''))
  if (!profile || !profile.isAdmin) {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 })
  }

  const statements: string[] = Array.isArray(body?.statements) ? body.statements : []
  if (statements.length === 0) {
    return NextResponse.json({ error: 'Nenhuma instrução para simular' }, { status: 400 })
  }

  // Preserva a ordem original do(s) arquivo(s) na resposta — as puladas
  // (sem cópia _check reconhecida) não vão pro banco, viram resultado
  // "recusado" localmente; as demais vão pra função de simulação.
  const results: StatementResult[] = []
  const toRun: string[] = []
  const runIndexByStatement: number[] = []

  statements.forEach((sql, i) => {
    const { rewritten, table } = rewriteStatementForCheck(sql)
    if (!rewritten) {
      results[i] = {
        sql,
        ok: false,
        rowsAffected: null,
        error: table
          ? `Tabela "${table}" não tem cópia _check disponível — não simulada.`
          : 'Não foi possível identificar a tabela desta instrução — não simulada.',
      }
      return
    }
    toRun.push(rewritten)
    runIndexByStatement.push(i)
  })

  if (toRun.length > 0) {
    const { error } = await supabaseAdmin.rpc('run_query_double_check', { p_statements: toRun })

    if (!error) {
      return NextResponse.json({ error: 'Simulação não retornou resultado (inesperado)' }, { status: 500 })
    }
    if (error.message !== 'DOUBLE_CHECK_RESULT' || !error.details) {
      return NextResponse.json({ error: error.message, details: error.details || undefined }, { status: 400 })
    }

    let runResults: { sql: string; ok: boolean; rows_affected: number | null; error: string | null }[]
    try {
      runResults = JSON.parse(error.details)
    } catch {
      return NextResponse.json({ error: 'Falha ao interpretar o resultado da simulação' }, { status: 500 })
    }

    runResults.forEach((r, j) => {
      const originalIndex = runIndexByStatement[j]
      results[originalIndex] = {
        sql: statements[originalIndex],
        ok: r.ok,
        rowsAffected: r.rows_affected,
        error: r.error,
      }
    })
  }

  return NextResponse.json({ results })
}
