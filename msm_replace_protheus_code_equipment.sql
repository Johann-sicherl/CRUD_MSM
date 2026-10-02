-- ============================================================
-- MSM · VMI — SUBSTITUIÇÃO DE CÓDIGO DE EQUIPAMENTO (atômica)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Análoga a msm_replace_protheus_code.sql (accessories), mas pro domínio
-- de Cadastro de Equipamentos (standard_equipment_items) — escopo bem mais
-- estreito, confirmado explicitamente com o usuário: só as tabelas que de
-- fato guardam um código de EQUIPAMENTO fora da própria
-- standard_equipment_items.
--
-- dependant_items.protheus_item_code NUNCA guarda código de equipamento
-- (só de acessório — ver schema.ts, campo "Cód. Dependente") — não é
-- tocado aqui, só dependant_items.protheus_code (campo "Cód. Item", usado
-- quando o gatilho da dependência é o próprio equipamento, não um
-- acessório).
--
-- protheus_code NUNCA tem FOREIGN KEY de verdade no banco (ver
-- msm_foreign_keys.sql) — é só texto comparado por igualdade, então
-- atualizar cada tabela independentemente é seguro, sem risco de violar
-- constraint.
--
-- Fora do escopo de propósito: csv_baseline_snapshots e audit_log (ver o
-- mesmo motivo documentado em msm_replace_protheus_code.sql). O custo real
-- local (real-costs.json) é migrado à parte, pelo backend (Node), já que
-- não mora no Postgres.
-- ============================================================

CREATE OR REPLACE FUNCTION replace_protheus_code_equipment(
  p_old_code TEXT,
  p_new_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts JSONB := '{}'::jsonb;
  v_n INTEGER;
BEGIN
  IF p_old_code IS NULL OR p_old_code = '' OR p_new_code IS NULL OR p_new_code = '' THEN
    RAISE EXCEPTION 'Código antigo e código novo são obrigatórios.';
  END IF;
  IF p_old_code = p_new_code THEN
    RAISE EXCEPTION 'Código antigo e código novo são iguais — nada a substituir.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM standard_equipment_items WHERE protheus_code = p_old_code) THEN
    RAISE EXCEPTION 'Código % não encontrado em Cadastro de Equipamentos — nada foi alterado.', p_old_code;
  END IF;
  IF EXISTS (SELECT 1 FROM standard_equipment_items WHERE protheus_code = p_new_code) THEN
    RAISE EXCEPTION 'Código % já existe em Cadastro de Equipamentos — nada foi alterado.', p_new_code;
  END IF;

  UPDATE standard_equipment_items SET protheus_code = p_new_code, updated_at = NOW() WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{standard_equipment_items}', to_jsonb(v_n));

  UPDATE dependant_items SET protheus_code = p_new_code WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{dependant_items}', to_jsonb(v_n));

  UPDATE pending_target_cost SET protheus_code = p_new_code WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{pending_target_cost}', to_jsonb(v_n));

  RETURN v_counts;
END;
$$;

-- Mesmo motivo do global_table_replace/replace_protheus_code: SECURITY
-- DEFINER roda com privilégios do dono, então o acesso via API REST do
-- Supabase precisa ser restrito só ao backend (service_role) — nunca
-- anon/authenticated.
REVOKE EXECUTE ON FUNCTION replace_protheus_code_equipment(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION replace_protheus_code_equipment(TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_protheus_code_equipment(TEXT, TEXT) TO service_role;
