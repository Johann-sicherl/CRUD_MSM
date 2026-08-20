-- ============================================================
-- MSM · VMI — USER PROFILES (usuários, senha e permissões do app)
-- Execute no Supabase SQL Editor
-- ============================================================
-- Substitui o arquivo local local-data/user-profiles.json: agora os
-- perfis (quem loga, com que senha, quais módulos vê, quais colunas
-- pode editar em cada tabela) ficam no banco — compartilhado entre
-- qualquer máquina que rode o app, em vez de preso ao disco de uma
-- instalação só.
--
-- password_hash NUNCA guarda a senha em texto puro — é gerada pelo
-- próprio app (scrypt com salt por usuário, Node "crypto" nativo, sem
-- lib externa) antes de qualquer INSERT/UPDATE aqui. Ninguém — nem
-- quem tem acesso direto ao banco — lê a senha de volta a partir do
-- hash.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL UNIQUE,
  password_hash             TEXT NOT NULL,
  is_admin                  BOOLEAN NOT NULL DEFAULT FALSE,
  can_create_delete         BOOLEAN NOT NULL DEFAULT FALSE,
  visible_modules           JSONB NOT NULL DEFAULT '[]',
  editable_fields_by_table  JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mesma estratégia de segurança das demais tabelas (ver msm_seguranca.sql):
-- RLS ativo + zero políticas = acesso NEGADO via anon/authenticated key. Só
-- o backend (service_role) lê/grava aqui — o navegador nunca fala direto
-- com esta tabela, sempre passa pelas rotas /api/user-profiles do app.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON user_profiles TO service_role;

-- Não insere nenhuma linha aqui de propósito — na primeira vez que o app
-- ler esta tabela vazia, ele mesmo semeia os perfis (Engenharia do Produto
-- e Gerente Adm Comercial, com senha provisória "1234" nos dois — troque
-- assim que entrar, em Configuração de Usuários) já com o hash calculado
-- em JS, e reaproveita as configurações do local-data/user-profiles.json
-- se esse arquivo ainda existir na máquina onde rodar pela primeira vez.
