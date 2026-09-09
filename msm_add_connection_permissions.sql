-- ============================================================
-- MSM · VMI — PERMISSÕES DE CONEXÃO PDM/PROTHEUS POR PERFIL
-- Execute no Supabase SQL Editor
-- ============================================================
-- Adiciona duas colunas em user_profiles pra controlar, por perfil, se ele
-- pode abrir o pop-up de conexão ao banco do PDM e/ou ao banco do Protheus
-- (ver Configuração de Usuários). Perfil Administrador sempre pode conectar
-- nos dois, independente destas colunas — mesmo padrão de
-- can_create_delete/visible_modules (isAdmin ignora tudo abaixo dele).
--
-- Defaults escolhidos pra não quebrar comportamento já em produção:
-- - can_connect_protheus = true: hoje QUALQUER perfil já consegue conectar
--   ao Protheus (nunca teve gate nenhum) — o default mantém isso pra quem
--   já está cadastrado; o Admin passa a poder revogar caso a caso daqui
--   pra frente, em Configuração de Usuários.
-- - can_connect_pdm = false: hoje só o Administrador conecta ao PDM — o
--   default preserva isso; o Admin passa a poder liberar caso a caso.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS can_connect_pdm      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_connect_protheus boolean NOT NULL DEFAULT true;
