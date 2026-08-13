-- ============================================================
-- MSM · VMI Security — SEGURANÇA COMPLETA DAS TABELAS
-- Execute no Supabase SQL Editor
-- ============================================================
-- Estratégia: RLS ativo + zero políticas = acesso NEGADO para
-- qualquer cliente usando anon key ou authenticated key.
-- O backend (conexão PostgreSQL direta) não é afetado.
-- ============================================================

-- ── 1. HABILITAR RLS EM TODAS AS TABELAS ─────────────────────
ALTER TABLE accessories                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE accessory_groups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependant_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipments                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE general_alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE non_combinable_comps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_equip_accessory ENABLE ROW LEVEL SECURITY;
ALTER TABLE roller_tables                ENABLE ROW LEVEL SECURITY;
ALTER TABLE standard_equipment_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_baseline_snapshots       ENABLE ROW LEVEL SECURITY;

-- ── 2. REVOGAR PERMISSÕES PÚBLICAS ───────────────────────────
-- Remove qualquer grant padrão para roles anon/authenticated
REVOKE ALL ON accessories                  FROM anon, authenticated;
REVOKE ALL ON accessory_groups             FROM anon, authenticated;
REVOKE ALL ON dependant_items              FROM anon, authenticated;
REVOKE ALL ON equipments                   FROM anon, authenticated;
REVOKE ALL ON general_alerts               FROM anon, authenticated;
REVOKE ALL ON non_combinable_comps         FROM anon, authenticated;
REVOKE ALL ON relationship_equip_accessory FROM anon, authenticated;
REVOKE ALL ON roller_tables                FROM anon, authenticated;
REVOKE ALL ON standard_equipment_items     FROM anon, authenticated;
REVOKE ALL ON audit_log                    FROM anon, authenticated;
REVOKE ALL ON csv_baseline_snapshots       FROM anon, authenticated;

-- ── 3. VERIFICAR SE FICOU CORRETO ────────────────────────────
-- Rode esta query para confirmar: todas devem mostrar TRUE
SELECT
  tablename,
  rowsecurity AS rls_ativo
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'accessories', 'accessory_groups', 'dependant_items',
    'equipments', 'general_alerts', 'non_combinable_comps',
    'relationship_equip_accessory', 'roller_tables',
    'standard_equipment_items', 'audit_log', 'csv_baseline_snapshots'
  )
ORDER BY tablename;
