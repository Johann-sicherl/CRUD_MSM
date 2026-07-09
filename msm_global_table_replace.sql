-- ============================================================
-- MSM · VMI — ATUALIZADOR GLOBAL DE TABELAS (substituição atômica)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Função usada pela janela "Atualizador Global de Tabelas MSM": monta os
-- dados novos numa tabela temporária isolada PRIMEIRO, confere se a
-- quantidade bate com o esperado, e só então apaga e recarrega a tabela
-- real — se qualquer coisa falhar antes disso, a tabela real nunca chega a
-- ser tocada. Não usa src/lib/sqlAudit.ts — não gera entradas em audit_log.
-- ============================================================

CREATE OR REPLACE FUNCTION global_table_replace(target_table TEXT, new_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
  expected_count INTEGER;
  staging_table TEXT := 'stg_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF new_rows IS NULL OR jsonb_typeof(new_rows) <> 'array' OR jsonb_array_length(new_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha válida recebida para importar — nada foi apagado.';
  END IF;
  expected_count := jsonb_array_length(new_rows);

  -- Build the new data set in an isolated temp table first (same columns,
  -- constraints and defaults as the real table) — the real table is not
  -- touched until this succeeds and the row count is verified.
  EXECUTE format('CREATE TEMP TABLE %I (LIKE %I INCLUDING ALL) ON COMMIT DROP', staging_table, target_table);

  EXECUTE format(
    'INSERT INTO %I SELECT * FROM jsonb_populate_recordset(NULL::%I, $1)',
    staging_table, target_table
  ) USING new_rows;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count <> expected_count THEN
    RAISE EXCEPTION 'Esperava preparar % linha(s), mas % foram preparadas — operação cancelada, a tabela real não foi tocada.',
      expected_count, inserted_count;
  END IF;

  -- Only now touch the real table — delete + reload from the verified
  -- staging data. "WHERE true" is required because some Postgres setups
  -- (including Supabase) reject any DELETE/UPDATE without a WHERE clause,
  -- even inside a SECURITY DEFINER function.
  EXECUTE format('DELETE FROM %I WHERE true', target_table);
  EXECUTE format('INSERT INTO %I SELECT * FROM %I', target_table, staging_table);

  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION global_table_replace(TEXT, JSONB) TO service_role;
