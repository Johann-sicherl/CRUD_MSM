-- ============================================================
-- MSM · VMI — PERFIL SOMENTE LEITURA / DADOS CHECK POR PERFIL
-- Execute no Supabase SQL Editor
-- ============================================================
-- Adiciona uma coluna em user_profiles pra marcar um perfil como
-- "read_only_check_mode" — usado pelo perfil "Analista de Dados": em vez
-- da tabela real, o GET das 9 tabelas com cópia _check (ver
-- msm_query_double_check.sql / DOUBLE_CHECK_TABLES) passa a ler a cópia
-- _check; e a UI (DataTable) bloqueia toda escrita — insert, update,
-- delete, bulk edit, import de custos, sinalização de custo imputado —
-- para qualquer perfil com esta coluna ligada, sobrepondo
-- can_create_delete/editable_fields_by_table mesmo que estejam
-- configurados de outro jeito.
--
-- Default false: preserva o comportamento de todo perfil já existente
-- (nenhum lê _check no lugar da tabela real, nenhum fica travado em
-- somente-leitura por esta coluna).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS read_only_check_mode boolean NOT NULL DEFAULT false;
