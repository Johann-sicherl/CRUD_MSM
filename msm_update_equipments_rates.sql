-- Atualizar colunas de taxas/comissões em equipments para 1

UPDATE equipments SET
  ipi_tax_rate               = 1,
  contribution_margin_ratio  = 1,
  seller_commission          = 1,
  manager_commission         = 1,
  director_commission        = 1,
  certification_cost         = 1,
  labor_cost_rate            = 1,
  warranty_rate              = 1,
  updated_at                 = NOW();

-- Verificar resultado
SELECT
  legacy_id,
  commercial_name,
  ipi_tax_rate,
  contribution_margin_ratio,
  seller_commission,
  manager_commission,
  director_commission,
  certification_cost,
  labor_cost_rate,
  warranty_rate
FROM equipments
ORDER BY legacy_id;
