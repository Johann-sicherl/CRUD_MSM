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
-- `password` guarda a senha em TEXTO PURO — pedido explícito de quem
-- mantém o app, ciente de que isso não é a prática recomendada (o
-- ideal seria um hash, ver histórico da conversa). RLS abaixo é a
-- única proteção real: só o backend (service_role) consegue ler essa
-- coluna, nunca o navegador.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL UNIQUE,
  password                  TEXT NOT NULL,
  is_admin                  BOOLEAN NOT NULL DEFAULT FALSE,
  can_create_delete         BOOLEAN NOT NULL DEFAULT FALSE,
  visible_modules           JSONB NOT NULL DEFAULT '[]',
  editable_fields_by_table  JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Se a tabela já existia com a coluna antiga password_hash (versão anterior,
-- com hash), rode esta linha uma vez para renomear sem perder as linhas já
-- gravadas — depois é só atualizar o valor de cada uma pra senha em texto
-- puro (UPDATE user_profiles SET password = '...' WHERE id = '...').
ALTER TABLE user_profiles RENAME COLUMN password_hash TO password;

-- Mesma estratégia de segurança das demais tabelas (ver msm_seguranca.sql):
-- RLS ativo + zero políticas = acesso NEGADO via anon/authenticated key. Só
-- o backend (service_role) lê/grava aqui — o navegador nunca fala direto
-- com esta tabela, sempre passa pelas rotas /api/user-profiles do app.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON user_profiles TO service_role;

-- Não insere nenhuma linha aqui de propósito — na primeira vez que o app
-- ler esta tabela vazia, ele mesmo semeia os perfis (Engenharia do Produto
-- e Gerente Adm Comercial) com `password = ''` (SEM senha nenhuma),
-- reaproveitando as configurações do local-data/user-profiles.json se esse
-- arquivo ainda existir na máquina onde rodar pela primeira vez.
--
-- Perfil com password = '' = ainda não tem senha definida: a primeira senha
-- que alguém digitar pra ele no login vira a senha dele a partir daí (ver
-- verifyLogin em src/lib/userProfileStore.ts). "Restaurar senha" (botão na
-- tela de login, depois de errar) volta a senha pra '' de novo.
--
-- Se você já tinha rodado a versão anterior (com senha "1234"/"17052024" já
-- definida) e quer testar esse fluxo de primeira senha do zero, rode:
--   UPDATE user_profiles SET password = '';
