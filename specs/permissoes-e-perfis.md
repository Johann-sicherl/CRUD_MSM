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

## Perfil somente leitura — dados CHECK (`readOnlyCheckMode`)

Pedido explícito do usuário ao criar um perfil chamado exatamente "Analista
de Dados": "este usuário será para eu analisar somente o banco de dados
CHECK que criamos... ele não poderá fazer nenhuma alteração, e nenhuma
insert, delete e nem UPDATE. Ele só visualizará ou exportará dados de
todas as janelas que já permiti em Configuração de Usuários."

Implementado como uma nova coluna booleana genérica em `user_profiles`
(`read_only_check_mode`, `msm_add_read_only_check_mode.sql`, mesmo padrão
de `can_connect_pdm`/`can_connect_protheus`) — **não hardcoded pro nome
"Analista de Dados"**, qualquer perfil pode ligar esse toggle em
Configuração de Usuários. Dois efeitos, os dois amarrados só a essa coluna:

1. **Leitura vira CHECK, não produção** — `GET /api/[table]` (usado por
   `DataTable.fetchData`) passa a receber `profileId` como query param
   sempre (`fetchData`, `DataTable.tsx`). Se o perfil resolvido no servidor
   (`getProfileById`, nunca confia num profileId sozinho) tem
   `readOnlyCheckMode` **e** a tabela é uma das 9 com cópia `_check`
   (`isDoubleCheckTable`, `queryDoubleCheck.ts`), a query passa a ler
   `<tabela>_check` em vez de `<tabela>`. Fora dessas 9 tabelas (telas sem
   cópia `_check` — dashboard, consultas Protheus etc.), a leitura continua
   normal — o escopo desse perfil não vai além do que o Double-check de
   Queries já cobre. `GET /api/[table]/[id]` (registro único) não foi
   tocado — não é usado por nenhum lugar do client hoje (RecordModal edita
   a partir da linha já carregada na lista).
2. **Escrita bloqueada em toda tabela, sempre** — em `DataTable.tsx`,
   `readOnlyCheckMode` sobrepõe `canCreateDelete`/`editableFieldsByTable`
   (mesmo que estejam configurados de outro jeito): `canCreateDelete` vira
   sempre `false` (esconde "+Novo Registro"/"Importar Excel", excluir em
   massa, alterar selecionados, excluir por linha), `restrictedFieldNames`
   vira sempre um `Set` vazio (todo campo do `RecordModal` renderiza
   desabilitado, "Editar" abre só-leitura), e os três outros gatilhos de
   escrita achados numa varredura da tela (botão "↑ Importar Custos" da
   Controladoria, "✓ Custo Imputado" em lote e por linha) também ficam
   escondidos. **Escopo desta proteção**: é o mesmo nível de "melhor que
   nada" já documentado no topo deste arquivo — proteção na UI/rota
   genérica de tabela, não uma reescrita de todo o app pra exigir
   `profileId` em cada POST/PUT/DELETE existente (nenhum outro perfil
   restrito, como Gerente Adm Comercial, tem esse nível de blindagem
   também — mesmo padrão de proteção, não um padrão novo só pra este
   perfil).
3. **Double-check de Queries agora é módulo liberável** — ver
   `specs/double-check-queries.md`. Pedido explícito do usuário: o
   Analista de Dados também precisa poder carregar CSVs novos em `_check`
   (passo 1) e simular queries (passo 2) — ação permitida mesmo sendo
   "escrita", porque nunca toca tabela real, só a cópia `_check`.
4. **Sem os filtros "Completo/Somente Novos/Em Alteração de Custeio"** — em
   `DataTable.tsx`, pedido explícito do usuário: "não precisamos do filtro
   ... porque este usuário só enxerga tabela de _Check, não teremos nada a
   ser inserido nisso". O grupo de abas inteiro (`actionButtons`) some pra
   `readOnlyCheckMode`, independente de `isRestrictedControladoriaView`/
   `usesTargetCostPending`/`baseline`. `viewMode` também é forçado pra
   `'completo'` sempre nesse perfil (mesmo `useEffect` que sincroniza com
   `?view=novos`/`?view=em_alteracao` da URL) — sem isso, um link antigo
   com esse query param deixaria a lista filtrada sem nenhuma aba visível
   pra voltar a "Completo".

**O que o admin ainda precisa configurar manualmente** pro perfil
"Analista de Dados" (não automatizado, é responsabilidade da tela
Configuração de Usuários, como qualquer perfil novo): marcar
`readOnlyCheckMode`, liberar `duplo-check-queries` + as tabelas de
catálogo/regras relevantes em `visibleModules`. `canCreateDelete`/
`editableFieldsByTable` podem ficar como estiverem — `readOnlyCheckMode`
já garante somente-leitura independente deles, mas por clareza o padrão
recomendado é deixá-los nos valores padrão (`false`/vazio) mesmo assim.

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
- `MODULE_GROUPS = ['Geral', 'Engenharia', 'Sistema', 'Consulta Banco de
  Dados', 'Parâmetros']` — esta é a taxonomia de navegação da própria
  Sidebar; **não é** a mesma organização usada para os arquivos `specs/*.md`
  (que seguem domínio/preocupação arquitetural, não agrupamento de UI).
  **Histórico**: até esta sessão existiam dois grupos separados,
  `DOMAIN_LABELS.catalogo` ("Portifólio") e `DOMAIN_LABELS.regras`
  ("Regras") — pedido explícito do usuário pra fundir os dois numa única
  aba "Engenharia" na Sidebar. `DOMAIN_LABELS`/`DOMAIN_COLORS` (`schema.ts`)
  **não mudaram** — continuam distinguindo `catalogo`/`regras` nos badges de
  domínio de `DataTable.tsx`/Dashboard; só a navegação lateral (`modules.ts`,
  constante interna `ENGINEERING_GROUP`) foi unificada. Uma tabela nova com
  `domain: 'catalogo'` ou `domain: 'regras'` continua caindo automaticamente
  no grupo "Engenharia" da Sidebar, sem precisar editar `modules.ts`.

### Grupos da Sidebar são colapsáveis, independentes entre si

Pedido explícito do usuário: "Está muito moroso navegar pela barra lateral,
por conta das inúmeras janelas que criamos, quero colapsar as janelas...
Eu posso deixar aberta mais de uma janela." Cada cabeçalho de grupo (os de
`byGroup`, derivados de `MODULE_GROUPS`, mais o bloco "Administração"
admin-only) é um `<button>` clicável com um chevron que gira 90° — clicar
alterna só aquele grupo (`collapsedGroups: Set<string>`, chave = nome do
grupo), sem afetar os demais. **Não é accordion**: não existe lógica de
"fechar os outros ao abrir um" — qualquer combinação de grupos abertos é
válida.

**Sem persistência em `localStorage` de propósito** — diferente do padrão
`sidebar-pinned` de `ClientLayout.tsx`. Pedido explícito do usuário, numa
rodada seguinte: "quando abre a primeira vez a aplicação ou quando a
atualiza que as 'Cascatas' estejam colapsadas" — o estado inicial de
`collapsedGroups` já nasce com **todos** os grupos (`MODULE_GROUPS` +
`'Administração'`) colapsados, tanto no primeiro acesso quanto em qualquer
F5/refresh da página. Expandir um grupo dura só a navegação em memória
daquela sessão (SPA — trocar de tela via `Link` não remonta a Sidebar, então
o que a pessoa abriu continua aberto ao navegar); um refresh de verdade
sempre volta a começar tudo fechado.

O link especial "Consulta PDM x Banco MSM" (fora de `MODULES`, ver seção
acima) é renderizado dentro do bloco do grupo "Consulta Banco de Dados" —
some junto com o resto do grupo quando colapsado, reaparece junto quando
expandido, sem estado próprio.

**Caixa própria por grupo** — pedido explícito do usuário: "está
visivelmente confuso as letras, visualmente se mistura o que é o título
do grupo das janelas... e quando expande um grupo, as janelas ficam
próximas de janelas do outro grupo por causa da cor". Cada grupo (incluindo
"Administração") agora é uma caixa com borda própria
(`border border-outline-variant rounded-lg`, fundo levemente destacado do
resto da Sidebar `bg-surface-container/40`) — o cabeçalho clicável tem um
fundo mais forte (`bg-surface-container-high`) e uma borda inferior
separando-o das janelas do próprio grupo enquanto expandido (some quando
colapsado, já que não há conteúdo abaixo pra separar). Mesmo padrão visual
de "caixa por grupo" já usado nos cards de grupo de Parâmetros de
Estrutura/Busc. Avanç. Acessórios Protheus — só replicado aqui pra
resolver a confusão visual entre título de grupo e nome de janela, e
entre as janelas de grupos vizinhos.

**"Colapsar tudo"/"Expandir tudo"**: pedido explícito do usuário, dois
botões — `collapseAllGroups` grava `collapsedGroups` como o conjunto de
**todos** os grupos realmente renderizados pra aquele perfil
(`byGroup.map(g => g.group)`, já filtrado pelos grupos vazios, mais
`'Administração'` só se `appUser.isAdmin`) e `expandAllGroups` zera pra um
`Set` vazio. Calculado a partir de `byGroup` — nunca de `MODULE_GROUPS`
direto — pra não deixar sobrando em `collapsedGroups` o nome de um grupo
que nem aparece pra esse perfil (ex.: perfil sem nenhum módulo de
"Parâmetros" liberado). Estilo "slim" (pedido explícito, numa rodada
seguinte, depois da 1ª versão ter saído com borda cheia/negrito demais
comparado ao resto da Sidebar): texto 9px, peso normal, borda transparente
até o hover — mesmo espírito dos botões de tema em `ThemeZoomBar.tsx`.
**Posição** (pedido explícito, mais uma rodada depois): ficavam no topo do
`<nav>`, junto da lista de grupos — movidos pro rodapé da Sidebar (depois
do bloco de perfil/Sair, a última coisa antes do fim da barra lateral),
pra não competir visualmente com os grupos.

**Bug real corrigido: "Expandir tudo" deixava a Sidebar inteira mais alta
que a tela, sem barra de rolagem** — pedido explícito do usuário: "a
expansão é maior que a área útil da tela, preciso de um scrollbar para
rolar entre as janelas". Causa: `<nav>` já tinha `flex-1 overflow-y-auto`
dentro do `<aside>` (`flex flex-col`), mas faltava `min-h-0` — um filho
flex com `overflow-y-auto` usa `min-height: auto` por padrão do CSS
(não `0`), então ele cresce pra caber todo o conteúdo em vez de respeitar
a altura disponível e rolar internamente. Com poucos grupos abertos isso
nunca aparecia (o conteúdo cabia sem esticar); só ficou visível com muitos
grupos expandidos ao mesmo tempo (exatamente o caso de "Expandir tudo").
Corrigido com `min-h-0` no `<nav>` — padrão CSS a replicar em qualquer
área flex-scroll nova desta Sidebar.

**`min-h-0` sozinho não resolveu — 2ª rodada**: usuário confirmou que
"Expandir tudo" ainda não habilitava scrollbar nenhuma depois do fix
acima. Causa real: o `<aside>` usava `h-full` (`height: 100%`) — uma
altura **percentual**, que em teoria resolve contra o viewport pra um
elemento `position: fixed` (é o comportamento padrão do CSS), mas na
prática, combinado com `zoom` no `<html>` (`document.documentElement.style.zoom`,
ver `ThemeZoomBar.tsx`) e sem nenhum ancestral com altura 100% explícita
na cadeia, o `%` pode não travar numa altura confiável — o `<aside>` (que
não rola sozinho, é `fixed`) cresce além da tela, e como não é parte do
fluxo normal do documento, o scroll da própria página (`body`) também não
alcança o conteúdo cortado: nem o `<nav>` rola internamente (não tinha
altura real pra sobrar) nem a página rola (elemento fixo não some do
viewport) — o conteúdo simplesmente ficava inacessível. Corrigido trocando
`h-full` por `h-screen` (`height: 100vh`, unidade de viewport direta, sem
depender de resolução de porcentagem/cadeia de ancestrais) — junto com o
`min-h-0` do `<nav>`, agora o `<aside>` sempre trava em 100vh de verdade e
o `<nav>` sempre tem uma altura real pra rolar dentro.

**Rótulo de grupo com nome longo ("Consulta Banco de Dados") quebrava
centralizado** — bug real corrigido na mesma rodada: o cabeçalho de grupo é
um `<button>`, e `<button>` tem `text-align: center` por padrão do
navegador; o `<span>{group}</span>` interno herdava isso sem override.
Grupos com rótulo curto (cabe numa linha só) nunca mostravam o problema,
mas "Consulta Banco de Dados" é longo o bastante pra quebrar em duas
linhas dentro da largura da Sidebar — e as duas apareciam centralizadas em
vez de alinhadas à esquerda como o resto. Corrigido com `text-left`
explícito no `<span>` (nos dois cabeçalhos de grupo, incluindo
"Administração").

**Rótulo do cabeçalho de grupo mais visível no tema Ciberpunk**: pedido
explícito do usuário — a letra do nome do grupo (GERAL, ENGENHARIA,
SISTEMA etc.) estava fina/pouco visível no tema Ciberpunk (`--c-outline:
156 143 120`, um tom acastanhado dessaturado, combinado com `text-[10px]`
+ `font-semibold`). Trocado pro token `text-on-surface-variant` (bem mais
contrastante nos três temas — Ciberpunk `212 197 171`, Cinza & Amarelo
`200 200 184`, Luz `72 64 58`, todos mais fortes que o `outline`
correspondente) + `font-bold` + `text-[11px]` — nunca uma cor fixa, sempre
o token do tema (ver `ThemeZoomBar.tsx`), então a correção vale nos três
temas, não só no Ciberpunk.
