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
mantidas fora do sistema de `visibleModules`/`MODULES` — o acesso a elas
não é uma entrada em `modules.ts`, é uma checagem própria no componente/rota
(`isAdmin` para `/configuracao-usuarios`; `isAdmin || canConnectPdm` para
`/pdm-consulta-acessorios`, ver seção de conexão a PDM/Protheus abaixo).
Isso significa que adicionar uma tabela/tela ao `MODULES` array não cobre
essas duas telas.

Além do guard dentro da própria página, o **link** para essas páginas fica
hardcoded direto no render de `Sidebar.tsx` (não gerado a partir de
`MODULES`/`visibleModules`) — defesa em profundidade deliberada: mesmo um
erro de configuração no checklist de "módulos visíveis" de um perfil não
pode fazer esse link aparecer para quem não tem a permissão.

## "+Novo Registro" (criação em lote) escondido do Gerente Adm Comercial

O botão "+Novo Registro" / "Importar Excel" (fila de insert, mecanismo (c)
de `specs/import-export.md`) é gated por `canCreateDelete` — e o perfil
Gerente Adm Comercial não tem essa permissão, por design: ela só deve poder
imputar custo no que já existe (via o import restrito de Controladoria),
nunca cadastrar componente/equipamento novo por essa tela.

## Global Table Replace já teve zero checagem de permissão

Histórico relevante: antes desta sessão, a rota do Atualizador Global
(substituição total, admin) não tinha **nenhuma** verificação de permissão
no servidor — qualquer um com acesso ao menu podia importar em qualquer das
tabelas. Achado da própria Claude durante a auditoria de permissões (não
reportado pelo usuário), corrigido exigindo uma checagem real via
`getProfileById` + `profile.isAdmin` (ver `/api/global-update/[table]/route.ts`).
Serve de lembrete para revisar rotas antigas equivalentes ao adicionar
mecanismos novos — a ausência de checagem não é sempre óbvia até alguém
procurar.

## Ordem de nesting dos providers é estrutural

`ClientLayout.tsx`: `<AppAuthProvider><ProtheusAuthProvider><PdmAuthProvider>...`
— `ProtheusAuthProvider` chama `useAppAuth()` internamente (pra decidir
`canConnectProtheus`), e `PdmAuthProvider` chama `useProtheusAuth()` e
`useAppAuth()` internamente — os dois precisam ficar como descendentes de
`AppAuthProvider`, e `PdmAuthProvider` também de `ProtheusAuthProvider`.
Trocar a ordem quebra esses hooks com "must be used within Provider".

## Conexão a PDM e a Protheus — permissão por perfil (`canConnectPdm`/`canConnectProtheus`)

Duas colunas booleanas em `user_profiles` (`msm_add_connection_permissions.sql`),
configuráveis por perfil em "Configuração de Usuários" — Administrador
sempre pode conectar aos dois, independente destas colunas (mesmo padrão de
`canCreateDelete`/`visibleModules`: `isAdmin` ignora tudo abaixo dele).

- **PDM** (`canConnectPdm`): controla o pop-up de conexão (`pdmAuthContext.tsx`),
  o link/botão na Sidebar e o acesso à tela "Consulta PDM x Banco MSM"
  (`/pdm-consulta-acessorios`) — os três checam
  `user.isAdmin || user.canConnectPdm`. Default `false` pra perfil não-admin
  (**histórico**: antes desta permissão existir, PDM era hardcoded
  admin-only; o default preserva esse comportamento pra quem já está
  cadastrado — Admin libera caso a caso a partir de agora).
- **Protheus** (`canConnectProtheus`): controla o pop-up de conexão
  (`protheusAuthContext.tsx`, que agora chama `useAppAuth()` internamente —
  por isso precisa ficar descendente de `AppAuthProvider`, ver nesting dos
  providers abaixo) e o botão correspondente na Sidebar. Default `true` pra
  qualquer perfil (**histórico**: antes desta permissão existir, Protheus
  nunca teve gate nenhum — todo perfil conectava livremente; o default
  preserva isso, e o Admin passa a poder revogar caso a caso a partir de
  agora).

Nenhuma das duas gates as telas que só **consultam** Protheus depois de já
conectado (`analisador-estruturas`, `busca-avancada-acessorios`,
`DependentItemsModal`, o status ATIVO/BLOQUEADO em `DataTable`) — essas já
são gated normalmente por `visibleModules`; sem `creds`, elas simplesmente
mostram "conecte ao Protheus" e não fazem nada, igual a hoje.

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
