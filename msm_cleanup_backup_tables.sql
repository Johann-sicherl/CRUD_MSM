-- ============================================================
-- MSM · VMI — LIMPEZA: tabelas *_backup_* e RLS desabilitado
-- Execute no Supabase SQL Editor — RODE ISSO UMA ÚNICA VEZ
-- ============================================================
-- Uma versão anterior do Atualizador Global de Tabelas MSM criava uma
-- tabela nova e RENOMEAVA a tabela real para "<tabela>_backup_<timestamp>"
-- a cada substituição, em vez de reaproveitar a mesma tabela. Isso:
--   1. Foi acumulando tabelas de backup inúteis a cada uso.
--   2. Fez a tabela "nova" (que ficou com o nome real) perder o RLS e as
--      permissões (GRANT/REVOKE) que a tabela original tinha, porque
--      CREATE TABLE (LIKE ... INCLUDING ALL) não copia RLS nem grants.
-- A função já foi corrigida (veja msm_global_table_replace.sql) para nunca
-- mais criar/renomear tabelas — ela só apaga e recarrega a mesma tabela.
-- Este script aqui limpa a bagunça que a versão antiga já deixou.
-- ============================================================

-- ── 1. Apagar todas as tabelas de backup acumuladas ──────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename ~ '_backup_[0-9]{14}$'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', r.tablename);
    RAISE NOTICE 'Removida: %', r.tablename;
  END LOOP;
END $$;

-- ── 2. Restaurar RLS + revogar acesso público (mesmo conteúdo de msm_seguranca.sql) ──
ALTER TABLE accessories                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE accessory_groups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependant_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipments                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE general_alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE non_combinable_comps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_equip_accessory ENABLE ROW LEVEL SECURITY;
ALTER TABLE roller_tables                ENABLE ROW LEVEL SECURITY;
ALTER TABLE standard_equipment_items     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON accessories                  FROM anon, authenticated;
REVOKE ALL ON accessory_groups             FROM anon, authenticated;
REVOKE ALL ON dependant_items              FROM anon, authenticated;
REVOKE ALL ON equipments                   FROM anon, authenticated;
REVOKE ALL ON general_alerts               FROM anon, authenticated;
REVOKE ALL ON non_combinable_comps         FROM anon, authenticated;
REVOKE ALL ON relationship_equip_accessory FROM anon, authenticated;
REVOKE ALL ON roller_tables                FROM anon, authenticated;
REVOKE ALL ON standard_equipment_items     FROM anon, authenticated;

-- ── 3. Conferir: todas devem mostrar rls_ativo = TRUE, e nenhuma linha na segunda consulta ──
SELECT tablename, rowsecurity AS rls_ativo
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'accessories', 'accessory_groups', 'dependant_items',
    'equipments', 'general_alerts', 'non_combinable_comps',
    'relationship_equip_accessory', 'roller_tables',
    'standard_equipment_items'
  )
ORDER BY tablename;

SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename ~ '_backup_[0-9]{14}$';
