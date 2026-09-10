-- ============================================================
-- MSM · VMI — DOUBLE-CHECK DE QUERIES (tabelas _check + simulação)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Suporte à tela "Double-check de Queries": você sobe os CSVs oficiais do
-- dia numa cópia paralela de cada tabela (sufixo _check) e depois simula,
-- em cima dessa cópia, as instruções SQL exportadas da Auditoria (.txt) —
-- pra saber se um DELETE/INSERT/UPDATE vai dar erro (FK, UNIQUE, linha não
-- encontrada) antes de aplicar de verdade no banco oficial.
--
-- PRÉ-REQUISITO: msm_global_table_replace.sql e msm_foreign_keys.sql já
-- executados (reaproveita a função global_table_replace já existente e
-- espelha o mesmo grafo de FKs, só que _check -> _check).

-- ── 1) Tabelas _check ──────────────────────────────────────────
-- LIKE ... INCLUDING ALL copia tipos, defaults, NOT NULL, UNIQUE/PK, CHECK
-- e índices — mas o Postgres NÃO copia foreign keys via LIKE (limitação
-- conhecida, mesmo com INCLUDING ALL). Por isso o passo 2 recria as FKs à
-- mão, apontando pra cópia _check da tabela referenciada, nunca pra
-- original — senão a simulação estaria validando contra dado de produção
-- ao vivo, não contra o retrato do dia gravado no passo de import.
CREATE TABLE IF NOT EXISTS accessories_check                (LIKE accessories                INCLUDING ALL);
CREATE TABLE IF NOT EXISTS accessory_groups_check            (LIKE accessory_groups            INCLUDING ALL);
CREATE TABLE IF NOT EXISTS dependant_items_check             (LIKE dependant_items             INCLUDING ALL);
CREATE TABLE IF NOT EXISTS equipments_check                  (LIKE equipments                  INCLUDING ALL);
CREATE TABLE IF NOT EXISTS general_alerts_check              (LIKE general_alerts              INCLUDING ALL);
CREATE TABLE IF NOT EXISTS non_combinable_comps_check        (LIKE non_combinable_comps        INCLUDING ALL);
CREATE TABLE IF NOT EXISTS relationship_equip_accessory_check(LIKE relationship_equip_accessory INCLUDING ALL);
CREATE TABLE IF NOT EXISTS roller_tables_check                (LIKE roller_tables                INCLUDING ALL);
CREATE TABLE IF NOT EXISTS standard_equipment_items_check    (LIKE standard_equipment_items    INCLUDING ALL);

-- ── 2) Foreign keys entre as tabelas _check ────────────────────
-- Mesmo grafo exato de msm_foreign_keys.sql, só que toda referência aponta
-- pra *_check em vez da tabela real.
DO $$ BEGIN
  ALTER TABLE standard_equipment_items_check
    ADD CONSTRAINT fk_sei_equipment_check
    FOREIGN KEY (legacy_equipment_id) REFERENCES equipments_check (legacy_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE accessories_check
    ADD CONSTRAINT fk_acc_group_check
    FOREIGN KEY (legacy_group_id) REFERENCES accessory_groups_check (legacy_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE relationship_equip_accessory_check
    ADD CONSTRAINT fk_rea_equipment_check
    FOREIGN KEY (legacy_equipment_id) REFERENCES equipments_check (legacy_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE non_combinable_comps_check
    ADD CONSTRAINT fk_ncc_equipment_check
    FOREIGN KEY (legacy_equipment_id) REFERENCES equipments_check (legacy_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE non_combinable_comps_check
    ADD CONSTRAINT fk_ncc_group_check
    FOREIGN KEY (legacy_group_id) REFERENCES accessory_groups_check (legacy_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE dependant_items_check
    ADD CONSTRAINT fk_dep_equipment_check
    FOREIGN KEY (legacy_equipment_id) REFERENCES equipments_check (legacy_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE roller_tables_check
    ADD CONSTRAINT fk_rol_equipment_check
    FOREIGN KEY (legacy_equipment_id) REFERENCES equipments_check (legacy_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3) Segurança — mesma estratégia de msm_seguranca.sql ───────
-- RLS ativo + zero políticas = acesso negado pra anon/authenticated; só
-- supabaseAdmin (service_role) opera.
ALTER TABLE accessories_check                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE accessory_groups_check            ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependant_items_check             ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipments_check                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE general_alerts_check              ENABLE ROW LEVEL SECURITY;
ALTER TABLE non_combinable_comps_check        ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_equip_accessory_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE roller_tables_check               ENABLE ROW LEVEL SECURITY;
ALTER TABLE standard_equipment_items_check    ENABLE ROW LEVEL SECURITY;

-- ── 4) Simulação: roda uma lista de instruções SQL contra as tabelas
--      _check e desfaz TUDO no final, mesmo em caso de sucesso total ─────
-- Cada instrução roda isolada (um BEGIN/EXCEPTION = um SAVEPOINT implícito
-- do PL/pgSQL): se uma falhar, só o efeito dela é desfeito, as anteriores
-- continuam valendo pras próximas da lista poderem testar em cima delas —
-- é assim que INSERTs/UPDATEs/DELETEs em sequência (como saem da
-- Auditoria) se comportariam de verdade, um dependendo do estado que o
-- anterior deixou. No fim, a função SEMPRE levanta uma exceção proposital
-- pra desfazer a transação inteira — é o único jeito de "devolver dado" a
-- quem chamou E garantir que nada fica gravado, mesmo se tudo tiver dado
-- certo: o resultado (json com sucesso/erro/linhas afetadas por instrução)
-- viaja dentro do campo DETAIL dessa exceção, que o backend (Next.js) lê de
-- volta em vez de tratar como uma falha de verdade.
--
-- Trava de segurança extra, redundante de propósito: mesmo que o código
-- que monta as instruções (fora deste arquivo) já reescreva o nome da
-- tabela pra "_check" antes de chamar esta função, ela TAMBÉM confere isso
-- aqui dentro e recusa (marca como erro, nunca executa) qualquer instrução
-- cujo alvo não termine em "_check" — nenhum bug de reescrita em outra
-- camada consegue fazer esta função tocar uma tabela de verdade.
CREATE OR REPLACE FUNCTION run_query_double_check(p_statements TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stmt    TEXT;
  v_table   TEXT;
  v_rows    INTEGER;
  v_error   TEXT;
  v_results JSONB := '[]'::jsonb;
BEGIN
  IF p_statements IS NULL OR array_length(p_statements, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhuma instrução recebida para simular.';
  END IF;

  FOREACH v_stmt IN ARRAY p_statements LOOP
    v_table := (regexp_match(v_stmt, '^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+"?(\w+)"?', 'i'))[1];

    IF v_table IS NULL OR v_table NOT LIKE '%\_check' ESCAPE '\' THEN
      v_results := v_results || jsonb_build_object(
        'sql', v_stmt, 'ok', false, 'rows_affected', NULL,
        'error', 'Recusado: instrução não aponta pra uma tabela _check reconhecida.'
      );
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE v_stmt;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_results := v_results || jsonb_build_object('sql', v_stmt, 'ok', true, 'rows_affected', v_rows, 'error', NULL);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      v_results := v_results || jsonb_build_object('sql', v_stmt, 'ok', false, 'rows_affected', NULL, 'error', v_error);
    END;
  END LOOP;

  RAISE EXCEPTION 'DOUBLE_CHECK_RESULT' USING DETAIL = v_results::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION run_query_double_check(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_query_double_check(TEXT[]) TO service_role;
