-- ============================================================
-- MSM · VMI — CSV BASELINE SNAPSHOTS (Atualizador Global de Tabelas)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Guarda o retrato exato de cada tabela no momento do último import feito
-- pelo Atualizador Global de Tabelas MSM. Usado para duas coisas:
--   1) Destacar em amarelo, nas telas de Cadastro, tudo que foi criado ou
--      editado manualmente DEPOIS desse import (registro novo = linha
--      inteira; campo pontual editado = só aquela célula).
--   2) Comparar um novo CSV contra o banco atual antes de substituir tudo
--      (janela "Comparar", no Atualizador Global).
-- Uma linha por tabela — é sempre sobrescrita (upsert) pela função
-- global_table_replace (ver msm_global_table_replace.sql), na MESMA
-- transação que grava os dados reais, nunca separadamente.
-- ============================================================

CREATE TABLE IF NOT EXISTS csv_baseline_snapshots (
  table_name   TEXT PRIMARY KEY,
  snapshot     JSONB NOT NULL,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mesma estratégia de segurança das demais tabelas (ver msm_seguranca.sql):
-- RLS ativo + zero políticas = acesso negado via anon/authenticated key. Só
-- o backend (service_role, ou a função SECURITY DEFINER global_table_replace
-- rodando como dono) lê/grava aqui.
ALTER TABLE csv_baseline_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON csv_baseline_snapshots FROM PUBLIC, anon, authenticated;
GRANT ALL ON csv_baseline_snapshots TO service_role;
