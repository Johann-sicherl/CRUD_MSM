-- ============================================================
-- MSM · VMI — DOUBLE-CHECK DE QUERIES: REMOVER FKs DAS TABELAS _check
-- Execute no Supabase SQL Editor
-- ============================================================
-- Reverte o passo 2 de msm_query_double_check.sql (as 7 foreign keys
-- _check -> _check). Pedido explícito do usuário, depois de um erro real ao
-- gravar o CSV de "standard_equipment_items" em _check ("Key
-- (legacy_equipment_id)=(49) is not present in table equipments_check"):
-- ele quer poder gravar/analisar cada tabela _check de forma independente,
-- exatamente como ela está no CSV oficial — sem o import de uma tabela
-- exigir que outra tabela relacionada já tenha sido gravada em _check antes
-- (ou tenha a linha referenciada), porque o relacionamento real já é
-- garantido pelas FKs do banco original (sem _check); a cópia _check é só
-- pra inspecionar/analisar dado, não pra reforçar consistência entre
-- tabelas de novo.
--
-- Consequência aceita conscientemente: a partir de agora, simular
-- (passo 2 da tela) um INSERT/UPDATE que violaria uma foreign key no banco
-- oficial NÃO dá mais erro contra a cópia _check (ela deixou de ter FK) —
-- só UNIQUE, NOT NULL, CHECK e "linha não encontrada" continuam sendo
-- pegos. Ver specs/double-check-queries.md.

ALTER TABLE standard_equipment_items_check
  DROP CONSTRAINT IF EXISTS fk_sei_equipment_check;

ALTER TABLE accessories_check
  DROP CONSTRAINT IF EXISTS fk_acc_group_check;

ALTER TABLE relationship_equip_accessory_check
  DROP CONSTRAINT IF EXISTS fk_rea_equipment_check;

ALTER TABLE non_combinable_comps_check
  DROP CONSTRAINT IF EXISTS fk_ncc_equipment_check;

ALTER TABLE non_combinable_comps_check
  DROP CONSTRAINT IF EXISTS fk_ncc_group_check;

ALTER TABLE dependant_items_check
  DROP CONSTRAINT IF EXISTS fk_dep_equipment_check;

ALTER TABLE roller_tables_check
  DROP CONSTRAINT IF EXISTS fk_rol_equipment_check;
