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
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'exported', 'applied')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Se a tabela audit_log já existia (de uma versão anterior desta rotina), rode
-- esta linha para adicionar a coluna nova sem perder o histórico já gravado:
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS baseline JSONB;

CREATE INDEX IF NOT EXISTS idx_audit_log_table_status ON audit_log (table_name, status);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
