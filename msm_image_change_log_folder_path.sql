-- ============================================================
-- MSM · VMI — image_change_log: pasta genérica (profundidade livre)
-- Execute no Supabase SQL Editor
-- ============================================================
-- A tela "Grupos de Imagens" deixou de assumir exatamente 2 níveis fixos
-- (Grupo > Subgrupo) e passou a navegar o bucket como um explorador de
-- arquivos (profundidade livre, igual ao Windows Explorer) — pedido
-- explícito do usuário: "eu posso ter imagens em diferentes grupos e
-- níveis, e não consigo ver o que está no nível acima da imagem hoje".
--
-- Esta migração adiciona folder_path/to_folder_path (o caminho completo
-- da pasta, ex. "Acessórios/CAMERAS" ou "Acessórios/CAMERAS/Extra") e
-- destrava group_name/subgroup_name (que ficam só como histórico das
-- linhas gravadas antes desta mudança — o app não escreve mais neles).
-- ============================================================

ALTER TABLE image_change_log ADD COLUMN IF NOT EXISTS folder_path TEXT;
ALTER TABLE image_change_log ADD COLUMN IF NOT EXISTS to_folder_path TEXT;

-- Backfill das linhas já gravadas (group_name/subgroup_name sempre tinham
-- os dois preenchidos antes desta mudança).
UPDATE image_change_log
SET folder_path = group_name || '/' || subgroup_name
WHERE folder_path IS NULL;

UPDATE image_change_log
SET to_folder_path = to_group_name || '/' || to_subgroup_name
WHERE to_folder_path IS NULL AND to_group_name IS NOT NULL AND to_subgroup_name IS NOT NULL;

-- group_name/subgroup_name não são mais escritos pelo app a partir de
-- agora (folder_path é a fonte única) — destravadas pra não quebrar
-- nenhum INSERT novo.
ALTER TABLE image_change_log ALTER COLUMN group_name DROP NOT NULL;
ALTER TABLE image_change_log ALTER COLUMN subgroup_name DROP NOT NULL;
