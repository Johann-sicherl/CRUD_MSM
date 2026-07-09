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
BEGIN
  -- "WHERE true" is required — some Postgres setups (including Supabase)
  -- install a safety extension that rejects any DELETE/UPDATE without a
  -- WHERE clause, even inside a SECURITY DEFINER function.
  EXECUTE format('DELETE FROM %I WHERE true', target_table);

  IF new_rows IS NULL OR jsonb_array_length(new_rows) = 0 THEN
    RETURN 0;
  END IF;

  EXECUTE format(
    'INSERT INTO %I SELECT * FROM jsonb_populate_recordset(NULL::%I, $1)',
    target_table, target_table
  ) USING new_rows;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION global_table_replace(TEXT, JSONB) TO service_role;
