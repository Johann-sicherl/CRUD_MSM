-- Atualizar cost_std para 10000 em todas as tabelas relevantes

UPDATE accessories                SET cost_std = 10000, updated_at = NOW();
UPDATE dependant_items             SET cost_std = 10000, updated_at = NOW();
UPDATE standard_equipment_items    SET cost_std = 10000, updated_at = NOW();

-- Verificar resultado
SELECT 'accessories'             AS tabela, COUNT(*) AS registros, MIN(cost_std) AS min, MAX(cost_std) AS max FROM accessories
UNION ALL
SELECT 'dependant_items',         COUNT(*), MIN(cost_std), MAX(cost_std) FROM dependant_items
UNION ALL
SELECT 'standard_equipment_items', COUNT(*), MIN(cost_std), MAX(cost_std) FROM standard_equipment_items;
