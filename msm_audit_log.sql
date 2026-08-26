-- ============================================================
-- MSM · VMI — AUDIT LOG (queries geradas para aplicar no banco oficial)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Cada INSERT/UPDATE/DELETE feito pelo app, nas tabelas marcadas com
-- auditQueries no schema (src/lib/schema.ts), gera uma linha aqui com o
-- SQL pronto para o TI rodar no banco de dados oficial da empresa.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name        TEXT NOT NULL,
  operation         TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  record_key_field  TEXT,
  record_key_value  TEXT,
  sql_query         TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  baseline          JSONB,  -- row state right before the first edit in this pending draft; used to detect "reverted back to original"
  changed_fields    JSONB,  -- update only: nomes dos campos que de fato mudaram, calculados no momento da gravação (inclui campos financeiros forçados a 1 no Supabase — ver forceIncludeFields em recordUpdateAudit). Null = linha antiga, cai no recálculo por baseline/payload (não detecta troca de segredo por segredo).
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'exported', 'applied')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Se a tabela audit_log já existia (de uma versão anterior desta rotina), rode
-- estas linhas para adicionar as colunas novas sem perder o histórico já gravado:
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS baseline JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS changed_fields JSONB;

CREATE INDEX IF NOT EXISTS idx_audit_log_table_status ON audit_log (table_name, status);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
