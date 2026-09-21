-- ============================================================
-- MSM · VMI — CAMPO NOVO: MARGEM DE CONTRIBUIÇÃO INTERNACIONAL
-- Execute no Supabase SQL Editor
-- ============================================================
-- Adiciona international_contribution_margin_ratio em equipments (Grupo de
-- Equipamentos) — coluna nova achada como "coluna extra ignorada" no
-- Atualizador Global (o CSV oficial já trazia essa coluna, mas o schema.ts
-- ainda não a mapeava). É um 11º campo financeiro real, ao lado dos 10 já
-- existentes de FORCE_TO_ONE_FIELDS (schema.ts) — mesma regra de sigilo dos
-- outros: o Supabase nunca recebe o valor real, só o sentinela 1 (valor
-- real não-zero) ou 0/vazio; o valor real fica só em local-data/ (ver
-- specs/custeio-financeiro.md). Nenhum código precisou mudar pra essa
-- proteção valer pro campo novo — tableWrite.ts/localCostGuard.ts/
-- RecordModal.tsx/DataTable.tsx etc. já iteram FORCE_TO_ONE_FIELDS
-- dinamicamente, nunca uma lista de nomes hardcoded em paralelo.
--
-- Default 0, NOT NULL: mesmo padrão dos outros 10 campos financeiros —
-- preserva o comportamento de toda linha já existente (fica em 0, sinal de
-- "ainda não custeado", igual sempre foi pros outros campos).
--
-- equipments_check (Double-check de Queries) recebe a mesma coluna, só se
-- a tabela já existir neste ambiente (msm_query_double_check.sql já
-- rodado) — sem isso, uma simulação de UPDATE/INSERT em equipments via
-- Double-check falharia por coluna ausente assim que este campo passasse a
-- ser gravado de verdade.

ALTER TABLE equipments
  ADD COLUMN IF NOT EXISTS international_contribution_margin_ratio DECIMAL(10,4) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF to_regclass('public.equipments_check') IS NOT NULL THEN
    ALTER TABLE equipments_check
      ADD COLUMN IF NOT EXISTS international_contribution_margin_ratio DECIMAL(10,4) NOT NULL DEFAULT 0;
  END IF;
END $$;
