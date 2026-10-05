-- ============================================================
-- MSM · VMI — LOG DE ALTERAÇÕES DE IMAGENS (bucket Cloudflare R2)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Registro automático de toda alteração feita pela tela "Grupos de
-- Imagens" (upload/substituição/renomeação/remoção) no bucket images-msm
-- — equivalente ao passo manual "Registre a alteração na seção 13" do
-- manual da TI, só que automático. Não guarda o arquivo em si (isso mora
-- no R2, nunca no Postgres) — só o registro de quem fez o quê, quando.
-- ============================================================

CREATE TABLE IF NOT EXISTS image_change_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action      TEXT NOT NULL CHECK (action IN ('upload', 'replace', 'rename', 'delete')),
  group_name    TEXT NOT NULL,
  subgroup_name TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  -- Só usado em 'rename': destino da troca (grupo/subgrupo/nome podem
  -- mudar juntos ou separado). Nulo nos outros 3 tipos de ação.
  to_group_name    TEXT,
  to_subgroup_name TEXT,
  to_file_name      TEXT,
  -- Chave do backup automático feito antes de substituir/remover (ver
  -- backupImage em r2Images.ts) — null em 'upload' (nada a sobrescrever).
  backup_key  TEXT,
  profile_id  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  profile_name TEXT, -- snapshot do nome no momento da ação — sobrevive à exclusão do perfil
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_change_log_created_at ON image_change_log (created_at DESC);

ALTER TABLE image_change_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON image_change_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON image_change_log TO service_role;
