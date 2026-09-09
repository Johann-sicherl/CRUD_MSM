# Permissões e perfis

## Não existe sessão de servidor

O login é uma escolha de perfil **client-side**: `appAuthContext.tsx`
(`useAppAuth`/`AppAuthProvider`) guarda o perfil escolhido em
`sessionStorage`, sem cookie de sessão, JWT próprio ou verificação de senha
no servidor a cada requisição.

Qualquer rota de API que precise de uma checagem de permissão real deve
receber o `profileId` do cliente e resolver o perfil de verdade no servidor
com `getProfileById(profileId)` (`userProfileStore.ts`) — **nunca** confiar
num campo `isAdmin`/`role` enviado solto no corpo da requisição, porque isso
seria trivialmente falsificável. Ver exemplos em
`/api/global-update-controladoria/[table]/route.ts` e o comentário
equivalente em `/api/global-update/[table]/route.ts`.

Isto é explicitamente um padrão **"melhor que nada, mas não
criptograficamente seguro"** — foi construído e disclosed como tal ao dono
do projeto durante o desenvolvimento; não tratar como autenticação real.

## `userProfileStore.ts`

- Perfis (quem loga, senha, módulos visíveis, campos com restrição) vivem na
  tabela Supabase `user_profiles` (ver `msm_user_profiles.sql`) — substituiu
  um arquivo JSON local antigo.
- `CONTROLLERSHIP_TABLES` é derivado de `isControllershipTable` (ver
  `specs/dados-e-schema.md`) — não hardcoded.
- `hardcodedDefaults()` define o conjunto de módulos visíveis para o
  primeiro-acesso (seed) de um perfil **novo**. Isso só afeta a criação —
  **um perfil já existente no Supabase não é recalculado** quando a lista de
  módulos/tabelas muda no código. Se um módulo novo precisa aparecer para
  perfis já criados, é preciso uma migração manual ou reconfiguração pela
  tela "Configuração de Usuários", não basta mudar o código.

## Telas fora do sistema de módulos

`/pdm-consulta-acessorios` e `/configuracao-usuarios` são **deliberadamente**
mantidas fora do sistema de `visibleModules`/`MODULES` — o acesso a elas é
gated direto em `isAdmin`, não por uma entrada em `modules.ts`. Isso significa
que adicionar uma tabela/tela ao `MODULES` array não cobre essas duas telas;
qualquer alteração de acesso a elas precisa mexer na checagem `isAdmin`
diretamente no componente/rota.

## Controladoria/Fiscal/Precificação (perfil Gerente Adm Comercial)

Ver `specs/dados-e-schema.md` (`isControllershipTable`) e
`specs/custeio-financeiro.md`. O acesso restrito a este perfil (Auditoria de
Queries filtrada, Atualizador Global com import restrito por coluna) é
travado no código a partir dessas funções — não depende só de alguém manter
a configuração de módulos/campos editáveis em dia na tela de administração.

## `modules.ts` / Sidebar

- `MODULES` é o catálogo único de páginas (usado pela Sidebar e pela tela
  Configuração de Usuários para montar o checklist "módulos visíveis").
- Tabelas com `domain: 'catalogo'` ou `domain: 'regras'` em `schema.ts`
  aparecem **automaticamente** em `MODULES` (via `CATALOGO_TABLES`/
  `REGRAS_TABLES`). Uma página que não é tabela (ex.: `dashboard`,
  `explorador-relacoes`) precisa ser adicionada à mão no array.
- `MODULE_GROUPS = ['Geral', DOMAIN_LABELS.catalogo, DOMAIN_LABELS.regras,
  'Sistema', 'Consulta Banco de Dados', 'Parâmetros']` — esta é a taxonomia
  de navegação da própria Sidebar; **não é** a mesma organização usada para
  os arquivos `specs/*.md` (que seguem domínio/preocupação arquitetural, não
  agrupamento de UI).
