-- ============================================================
-- MSM · VMI — ATUALIZADOR GLOBAL DE TABELAS (substituição atômica)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Função usada pela janela "Atualizador Global de Tabelas MSM": apaga todos
-- os registros de uma tabela e recarrega a partir de um CSV oficial, tudo
-- dentro de uma única chamada de função (uma única transação): se o INSERT
-- falhar por qualquer motivo, o DELETE é desfeito junto e a tabela volta ao
-- estado original. Opera sempre na MESMA tabela (nunca cria, renomeia ou
-- troca tabelas) — não afeta RLS, políticas nem permissões (GRANT/REVOKE)
-- já configuradas nela. Não usa src/lib/sqlAudit.ts — não gera entradas em
-- audit_log. Também grava o retrato do import em csv_baseline_snapshots
-- (ver msm_csv_baseline_snapshots.sql), na mesma transação — usado pelo
-- destaque amarelo nas telas de Cadastro e pela comparação do Atualizador
-- Global.
--
-- PRÉ-REQUISITO: execute msm_csv_baseline_snapshots.sql (cria a tabela
-- csv_baseline_snapshots) ANTES deste arquivo — a função abaixo grava nela.
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
  -- checked BEFORE the delete, so an empty/missing new_rows never wipes the
  -- table without putting anything back.
  IF new_rows IS NULL OR jsonb_typeof(new_rows) <> 'array' OR jsonb_array_length(new_rows) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha válida recebida para importar — nada foi alterado.';
  END IF;
  expected_count := jsonb_array_length(new_rows);

  -- "WHERE true" is required — some Postgres setups (including Supabase)
  -- reject any DELETE/UPDATE without a WHERE clause, even inside a
  -- SECURITY DEFINER function.
  EXECUTE format('DELETE FROM %I WHERE true', target_table);

  EXECUTE format(
    'INSERT INTO %I SELECT * FROM jsonb_populate_recordset(NULL::%I, $1)',
    target_table, target_table
  ) USING new_rows;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  -- Integrity check: if the insert didn't produce exactly the rows we
  -- expected, abort — this raises an exception, which rolls back the DELETE
  -- too (both statements ran inside this same function call/transaction).
  IF inserted_count <> expected_count THEN
    RAISE EXCEPTION 'Esperava gravar % linha(s), mas % foram gravadas — operação cancelada, nada foi alterado.',
      expected_count, inserted_count;
  END IF;

  -- Retrato do import bem-sucedido — base de comparação para o destaque
  -- amarelo nas telas de Cadastro e para o "Comparar" do Atualizador
  -- Global. Mesma transação da função: se o replace acima falhar e for
  -- desfeito, este INSERT/UPDATE também é, e o retrato antigo continua
  -- valendo.
  INSERT INTO csv_baseline_snapshots (table_name, snapshot, imported_at)
  VALUES (target_table, new_rows, NOW())
  ON CONFLICT (table_name) DO UPDATE
    SET snapshot = EXCLUDED.snapshot, imported_at = EXCLUDED.imported_at;

  RETURN inserted_count;
END;
$$;

-- CREATE FUNCTION concede EXECUTE a PUBLIC por padrão no Postgres — como esta
-- função é SECURITY DEFINER (roda com privilégios do dono, aqui o bastante
-- para apagar e recarregar a tabela inteira), isso deixava qualquer role
-- (inclusive anon/authenticated, herdando de PUBLIC) capaz de chamá-la
-- diretamente via API REST do Supabase. Revoga tudo e libera só para o
-- backend (service_role).
REVOKE EXECUTE ON FUNCTION global_table_replace(TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION global_table_replace(TEXT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION global_table_replace(TEXT, JSONB) TO service_role;
