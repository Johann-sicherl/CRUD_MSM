-- ============================================================
-- MSM · VMI — ATUALIZADOR GLOBAL DE TABELAS (substituição atômica)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Função usada pela janela "Atualizador Global de Tabelas MSM": monta os
-- dados novos numa tabela nova, isolada, PRIMEIRO, confere se a quantidade
-- bate com o esperado, e só então RENOMEIA a tabela real para um nome de
-- backup e coloca a tabela nova no lugar dela. A tabela real NUNCA é
-- apagada — se qualquer coisa falhar antes da troca de nomes, ela continua
-- exatamente como estava. Não usa src/lib/sqlAudit.ts — não gera entradas
-- em audit_log.
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
  backup_table TEXT := target_table || '_backup_' || to_char(now(), 'YYYYMMDDHH24MISS');
BEGIN
  IF new_rows IS NULL OR jsonb_typeof(new_rows) <> 'array' OR jsonb_array_length(new_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha válida recebida para importar — nada foi alterado.';
  END IF;
  expected_count := jsonb_array_length(new_rows);

  -- Build the new data set in an isolated, ordinary (non-temp) table first —
  -- must be a real table, not TEMP, because it is about to be renamed into
  -- permanent place. The real table is not touched until this succeeds and
  -- the row count is verified.
  EXECUTE format('CREATE TABLE %I (LIKE %I INCLUDING ALL)', staging_table, target_table);

  BEGIN
    EXECUTE format(
      'INSERT INTO %I SELECT * FROM jsonb_populate_recordset(NULL::%I, $1)',
      staging_table, target_table
    ) USING new_rows;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE format('DROP TABLE IF EXISTS %I', staging_table);
    RAISE;
  END;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count <> expected_count THEN
    EXECUTE format('DROP TABLE IF EXISTS %I', staging_table);
    RAISE EXCEPTION 'Esperava preparar % linha(s), mas % foram preparadas — operação cancelada, a tabela real não foi tocada.',
      expected_count, inserted_count;
  END IF;

  -- Swap by renaming — the old table becomes a timestamped backup (kept,
  -- not dropped) and the fully-verified staging table takes its place.
  -- No DELETE is ever run against the real table.
  EXECUTE format('ALTER TABLE %I RENAME TO %I', target_table, backup_table);
  EXECUTE format('ALTER TABLE %I RENAME TO %I', staging_table, target_table);

  -- Renaming tables is DDL — PostgREST caches the database schema and won't
  -- notice on its own, so every other screen in the app (which reads through
  -- PostgREST) would keep seeing the old table until its cache happened to
  -- refresh. Force an immediate reload so the new data is visible right away.
  NOTIFY pgrst, 'reload schema';

  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION global_table_replace(TEXT, JSONB) TO service_role;
