-- ============================================================
-- MSM · VMI — SUBSTITUIÇÃO DE REVISÃO DE COMPONENTE (atômica)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Função usada pela tela "Consulta PDM x Banco MSM": quando um componente
-- validado no PDM tem código com revisão (ex.: 34.01.10040.01) e já existe
-- no banco MSM sob a revisão anterior (ex.: 34.01.10040.00), substitui o
-- código antigo pelo novo em accessories e em toda tabela que referencia um
-- Código Protheus de componente — preservando o ID interno (uuid) e o
-- histórico da linha, em vez de apagar e recriar. Também atualiza os demais
-- campos do item (Nome, Grupo, Cor etc.) com os dados mais recentes vindos
-- do PDM, já que a revisão nova é quem passa a valer.
--
-- protheus_code/protheus_item_code NUNCA têm FOREIGN KEY de verdade no
-- banco (ver msm_foreign_keys.sql — só legacy_group_id/legacy_equipment_id
-- têm) — são só texto comparado por igualdade, então atualizar cada tabela
-- independentemente é seguro, sem risco de violar constraint.
--
-- Fora do escopo de propósito: csv_baseline_snapshots (retrato histórico de
-- um import já concluído) e audit_log (registro histórico de comandos) —
-- reescrever essas duas apagaria o próprio histórico que elas existem para
-- preservar. O custo real local (real-costs.json) é migrado à parte, pelo
-- backend (Node), já que não mora no Postgres.
-- ============================================================

CREATE OR REPLACE FUNCTION replace_protheus_code(
  p_old_code TEXT,
  p_new_code TEXT,
  p_name TEXT DEFAULT NULL,
  p_legacy_group_id INTEGER DEFAULT NULL,
  p_color TEXT DEFAULT NULL,
  p_predominant_material TEXT DEFAULT NULL,
  p_dimensional_mm NUMERIC DEFAULT NULL,
  p_quantity_monitor_totem INTEGER DEFAULT NULL,
  p_monitor_size NUMERIC DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts JSONB := '{}'::jsonb;
  v_n INTEGER;
  v_extra INTEGER;
BEGIN
  IF p_old_code IS NULL OR p_old_code = '' OR p_new_code IS NULL OR p_new_code = '' THEN
    RAISE EXCEPTION 'Código antigo e código novo são obrigatórios.';
  END IF;
  IF p_old_code = p_new_code THEN
    RAISE EXCEPTION 'Código antigo e código novo são iguais — nada a substituir.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accessories WHERE protheus_code = p_old_code) THEN
    RAISE EXCEPTION 'Código % não encontrado em Cadastro de Componentes — nada foi alterado.', p_old_code;
  END IF;
  IF EXISTS (SELECT 1 FROM accessories WHERE protheus_code = p_new_code) THEN
    RAISE EXCEPTION 'Código % já existe em Cadastro de Componentes — nada foi alterado.', p_new_code;
  END IF;

  UPDATE accessories SET
    protheus_code = p_new_code,
    name = COALESCE(p_name, name),
    legacy_group_id = COALESCE(p_legacy_group_id, legacy_group_id),
    color = COALESCE(p_color, color),
    predominant_material = COALESCE(p_predominant_material, predominant_material),
    dimensional_mm = COALESCE(p_dimensional_mm, dimensional_mm),
    quantity_monitor_totem = COALESCE(p_quantity_monitor_totem, quantity_monitor_totem),
    monitor_size = COALESCE(p_monitor_size, monitor_size),
    description = COALESCE(p_description, description),
    updated_at = NOW()
  WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{accessories}', to_jsonb(v_n));

  UPDATE relationship_equip_accessory SET protheus_code = p_new_code WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{relationship_equip_accessory}', to_jsonb(v_n));

  UPDATE non_combinable_comps SET protheus_code = p_new_code WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE non_combinable_comps SET remove_list_code = p_new_code WHERE remove_list_code = p_old_code;
  GET DIAGNOSTICS v_extra = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{non_combinable_comps}', to_jsonb(v_n + v_extra));

  UPDATE dependant_items SET protheus_code = p_new_code WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE dependant_items SET protheus_item_code = p_new_code WHERE protheus_item_code = p_old_code;
  GET DIAGNOSTICS v_extra = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{dependant_items}', to_jsonb(v_n + v_extra));

  UPDATE roller_tables SET protheus_code = p_new_code WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{roller_tables}', to_jsonb(v_n));

  UPDATE pending_target_cost SET protheus_code = p_new_code WHERE protheus_code = p_old_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := jsonb_set(v_counts, '{pending_target_cost}', to_jsonb(v_n));

  RETURN v_counts;
END;
$$;

-- Mesmo motivo do global_table_replace: SECURITY DEFINER roda com
-- privilégios do dono, então o acesso via API REST do Supabase precisa ser
-- restrito só ao backend (service_role) — nunca anon/authenticated.
REVOKE EXECUTE ON FUNCTION replace_protheus_code(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, NUMERIC, INTEGER, NUMERIC, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION replace_protheus_code(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, NUMERIC, INTEGER, NUMERIC, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_protheus_code(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, NUMERIC, INTEGER, NUMERIC, TEXT) TO service_role;
