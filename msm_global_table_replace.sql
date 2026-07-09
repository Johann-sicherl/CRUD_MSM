-- ============================================================
-- MSM · VMI — ATUALIZADOR GLOBAL DE TABELAS (substituição atômica)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Função usada pela janela "Atualizador Global de Tabelas MSM": apaga todos
-- os registros de uma tabela e recarrega a partir de um CSV oficial, em uma
-- única transação — se o INSERT falhar (coluna obrigatória faltando, tipo
-- inválido, etc.), o DELETE também é desfeito e a tabela volta ao estado
-- original. Não usa src/lib/sqlAudit.ts — não gera entradas em audit_log.
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
BEGIN
  -- Refuse to touch the table at all unless there is real data to reload —
  -- checked BEFORE the delete. Previously the delete ran first and an empty/
  -- missing new_rows just returned 0 with no error, silently wiping the
  -- table with nothing to replace it.
  IF new_rows IS NULL OR jsonb_typeof(new_rows) <> 'array' OR jsonb_array_length(new_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha válida recebida para importar — nada foi apagado.';
  END IF;
  expected_count := jsonb_array_length(new_rows);

  -- "WHERE true" is required — some Postgres setups (including Supabase)
  -- install a safety extension that rejects any DELETE/UPDATE without a
  -- WHERE clause, even inside a SECURITY DEFINER function.
  EXECUTE format('DELETE FROM %I WHERE true', target_table);

  EXECUTE format(
    'INSERT INTO %I SELECT * FROM jsonb_populate_recordset(NULL::%I, $1)',
    target_table, target_table
  ) USING new_rows;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  -- Extra integrity check: if the insert somehow didn't produce exactly the
  -- rows we expected, abort and roll back the delete too, rather than leave
  -- the table half-loaded.
  IF inserted_count <> expected_count THEN
    RAISE EXCEPTION 'Esperava gravar % linha(s), mas % foram gravadas — operação cancelada, nada foi alterado.',
      expected_count, inserted_count;
  END IF;

  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION global_table_replace(TEXT, JSONB) TO service_role;
