-- ============================================================
-- MSM · VMI Security — FOREIGN KEYS (relacionamentos)
-- Execute no Supabase SQL Editor
-- ============================================================

-- standard_equipment_items → equipments
ALTER TABLE standard_equipment_items
  ADD CONSTRAINT fk_sei_equipment
  FOREIGN KEY (legacy_equipment_id)
  REFERENCES equipments (legacy_id)
  ON DELETE CASCADE;

-- accessories → accessory_groups
ALTER TABLE accessories
  ADD CONSTRAINT fk_acc_group
  FOREIGN KEY (legacy_group_id)
  REFERENCES accessory_groups (legacy_id)
  ON DELETE SET NULL;

-- relationship_equip_accessory → equipments
ALTER TABLE relationship_equip_accessory
  ADD CONSTRAINT fk_rea_equipment
  FOREIGN KEY (legacy_equipment_id)
  REFERENCES equipments (legacy_id)
  ON DELETE CASCADE;

-- non_combinable_comps → equipments
ALTER TABLE non_combinable_comps
  ADD CONSTRAINT fk_ncc_equipment
  FOREIGN KEY (legacy_equipment_id)
  REFERENCES equipments (legacy_id)
  ON DELETE CASCADE;

-- non_combinable_comps → accessory_groups (grupo principal)
ALTER TABLE non_combinable_comps
  ADD CONSTRAINT fk_ncc_group
  FOREIGN KEY (legacy_group_id)
  REFERENCES accessory_groups (legacy_id)
  ON DELETE CASCADE;

-- dependant_items → equipments
ALTER TABLE dependant_items
  ADD CONSTRAINT fk_dep_equipment
  FOREIGN KEY (legacy_equipment_id)
  REFERENCES equipments (legacy_id)
  ON DELETE CASCADE;

-- roller_tables → equipments
ALTER TABLE roller_tables
  ADD CONSTRAINT fk_rol_equipment
  FOREIGN KEY (legacy_equipment_id)
  REFERENCES equipments (legacy_id)
  ON DELETE CASCADE;

-- ── Verificar FK criadas ──────────────────────────────────────
SELECT
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name  AS ref_table,
  ccu.column_name AS ref_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;
