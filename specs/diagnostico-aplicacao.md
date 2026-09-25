# Diagnóstico da Aplicação

Pop-up automático que varre a base procurando inconsistências que o
Administrador precisa saber de cara, sem abrir tela por tela. Pedido
explícito do usuário: "quero que faça uma rotina, sempre na primeira
abertura da aplicação, ou quando eu atualizo a aplicação, ele me dê um
follow up completo de como está tudo que eu preciso saber, através de um
pop-up... primeiro comece varrendo Cadastro de Equipamentos, analisando se
tem algo bloqueado no Protheus... e com STATUS igual active, sempre que
tiver bolinha vermelha tem que estar deactive."

## Quando aparece

- **Só Admin** — pedido explícito do usuário (não Gerente Adm Comercial,
  não Analista de Dados, mesmo que também conectem ao Protheus).
- **Só depois que o Protheus já conectou** (`AppDiagnosticsGate.tsx`, dentro
  de `ClientLayout.tsx`, escuta `useProtheusAuth().creds`) — reusa a
  credencial já fornecida no login do app (nunca pede uma segunda vez), e a
  checagem em si precisa dela mesmo.
- **Uma vez por build** — "primeira abertura da aplicação, ou quando eu
  atualizo a aplicação" foi implementado como: comparar o hash do commit
  atual (`NEXT_PUBLIC_APP_BUILD_SHA`, embutido no bundle do cliente por
  `next.config.js` via `execSync('git rev-parse --short HEAD')` em build
  time) contra o que está salvo em `localStorage['app-diagnostics-seen-build']`.
  Build nunca visto (ou primeiro acesso de sempre, sem nada salvo) → roda o
  diagnóstico e mostra o pop-up; mesmo build já visto → não mostra nada.
  **Decisão deliberada, confirmada com o usuário**: automático via hash do
  Git, não um número de versão manual — não exige nenhum passo extra a cada
  deploy, muda sozinho toda vez que alguém roda `npm run build` de novo em
  produção. Se o diagnóstico falhar (erro de rede/Protheus), o build **não**
  é marcado como visto — volta a tentar no próximo carregamento da página em
  que o Admin conectar, em vez de silenciar o erro até o próximo deploy.

## Arquitetura — pensada pra crescer

`src/lib/appDiagnostics.ts` (server-only, importado só pela rota) — um
array `CHECKS` de `{ key, tableLabel, run(creds) }`, cada um uma "seção" do
pop-up. `runAppDiagnostics(creds)` roda todas **em sequência** (não
`Promise.all` — uma falha isolada numa checagem vira uma seção com um
`issue` descrevendo o erro, em vez de derrubar o diagnóstico inteiro).
Adicionar uma checagem nova = só acrescentar uma entrada em `CHECKS`, sem
mexer no pop-up nem no gatilho — pedido explícito do usuário foi "primeiro
comece" por uma tabela, deixando claro que mais viriam depois.

- `POST /api/app-diagnostics/route.ts` — recebe `{ profileId, user,
  password }`, valida `profile.isAdmin` via `getProfileById` (nunca um
  `isAdmin` solto do corpo — ver `specs/permissoes-e-perfis.md`), roda
  `runAppDiagnostics` e devolve `{ sections }`. Caminho fixo, só `POST` (sem
  `GET` junto) — não corre o risco de 405 em build de produção documentado
  em `specs/telas-auxiliares.md` (esse bug era especificamente sobre GET +
  método mutante no mesmo caminho fixo).
- `AppDiagnosticsGate.tsx` — o gatilho (lógica de quando rodar, descrita
  acima). Renderizado dentro de `ClientLayout.tsx`, como filho de
  `PdmAuthProvider` — precisa ser descendente de `AppAuthProvider` (pra
  `isAdmin`) e `ProtheusAuthProvider` (pra `creds`), mesma regra de nesting
  de providers documentada em `specs/permissoes-e-perfis.md`.
- `AppDiagnosticsPopup.tsx` — a UI. Pedido explícito do usuário: "grande,
  tanto quanto os outros da aplicação" — mesmo `max-w-[95vw] max-h-[90vh]`
  de `ImportReviewModal`/`ControladoriaImportReviewModal`/
  `CostImportReviewModal`. "Cascateado por tabelas... um dropdown com o
  título desta aba, e quando eu expanda, ele me mostre os problemas, caso
  não tenha, que seja sem erros, caso tenha que esteja vermelho esmaecido o
  dropdown completo" — uma seção por `DiagnosticSection`, um accordion
  (chevron gira 90° ao expandir, mesmo padrão de `atualizador-global/page.tsx`);
  sem problemas → badge "sem erros", cabeçalho com cor neutra; com
  problemas → cabeçalho inteiro com fundo/borda/texto em tom de erro
  esmaecido (`border-error/30 bg-error-container/10`, texto do título em
  `text-error`), badge com a contagem.
- **`DiagnosticSection.mode`** (`'problems'` padrão, ou `'summary'`) —
  achado necessário ao adicionar a Checagem #3 (abaixo): nem toda seção é
  "problema vs sem erros". Uma seção `'summary'` é inventário puro (ex.:
  "aqui está tudo que a Busca Reversa achou") — `AppDiagnosticsPopup.tsx`
  nunca acende vermelho nela só por ter itens (`flagged = hasIssues &&
  !isSummary`); o badge mostra "N encontrada(s)"/"nenhuma encontrada" em
  vez de "N problema(s)"/"sem erros", e a contagem do subtítulo do topo do
  pop-up (`totalProblems`) ignora seções `'summary'` de propósito — uma
  seção informativa cheia de itens não deve inflar "N problema(s)
  encontrado(s)" no resumo geral. Um erro ao RODAR uma checagem `'summary'`
  continua contando como problema de verdade (`runAppDiagnostics` sempre
  grava esse tipo de entrada sem `mode`, então cai no padrão `'problems'`)
  — a distinção é só pro resultado normal da checagem, nunca pra uma falha.

## Checagens #1 e #2 — bolinha vermelha vs. Status "Ativo"

`checkProtheusStatusVsActive(tableName, tableLabel)` (`appDiagnostics.ts`)
— fábrica de checagem genérica, reusada por duas tabelas que têm
exatamente a mesma forma (`protheus_code` + `status` com opções
`active`/`deactive`): pra cada linha, resolve o status Protheus
(`ATIVO`/`BLOQUEADO`, SB1010) via `protheus_code`, reusando
`listProductStatuses` (`protheusDb.ts`) — a mesma fonte que já alimenta a
"bolinha" verde/vermelha de `DataTable.tsx` (`getProtheusStatus`,
`schema.protheusStatusCheckField`), nenhuma query nova ao Protheus além da
que essa função já fazia. Regra, exatamente como pedida pelo usuário: se o
status no Protheus é `BLOQUEADO` (bolinha vermelha) **e** o campo `status`
interno diz `active`, isso é um achado — o esperado é `status = deactive`
sempre que Protheus estiver `BLOQUEADO`. Não verifica a direção inversa
(`ATIVO` no Protheus com `status = deactive` aqui) — não foi pedido, e
implementar sem pedido seria inventar uma regra de negócio nova.

Registradas em `CHECKS`:
1. **Cadastro de Equipamentos** (`standard_equipment_items`) — a primeira,
   pedido original.
2. **Cadastro de Componentes** (`accessories`) — pedido explícito do
   usuário na rodada seguinte, "faça esta mesma rotina... em Cadastro de
   Componentes" — mesma regra, tabela diferente, sem nenhuma variação
   (`accessories` tem exatamente o mesmo par `protheus_code`/`status` de
   `standard_equipment_items`).

## Checagem #3 — Busca Reversa (Protheus) 27.04 / 27.03

Pedido explícito do usuário: "faça uma pesquisa que é realizada em Busc.
Itens Série Estrut. Protheus, Busca Reversa (Protheus) 27.04, 27.03, e me
dê um resumo de todas as estruturas encontradas." O usuário inicialmente
pediu pra eu rodar essa busca diretamente nesta conversa — esclarecido que
isso é tecnicamente impossível (Claude não tem navegador, conector pro app
publicado, nem rede até o Protheus a partir do ambiente de sessão) — e o
pedido real, confirmado explicitamente, era outro: adicionar isso como uma
checagem nova neste mesmo pop-up automático, rodando com a credencial que
o próprio Admin já forneceu no navegador dele.

`checkReverseSearchStructures` (`appDiagnostics.ts`) — reusa
`listStructureHeaders(['27.04', '27.03'], creds)` (`protheusDb.ts`), a
mesma função por trás do campo "Busca Reversa (Protheus)" de
`analisador-estruturas/page.tsx` (que, aliás, já vem pré-preenchido com
exatamente `27.04, 27.03` por padrão — `reversePrefixInput`) — nenhuma
lógica de busca nova. `mode: 'summary'` (ver acima) — é um inventário de
tudo que a busca encontrou, não uma lista de "coisas erradas"; a tela
nunca marca essa seção como vermelha só por ter itens (o normal é ter
muitos).

**Rodada seguinte, pedido explícito do usuário**: depois de eu explicar
(sem mexer em código) os 5 flags que a tela viva mostra por código
(`Equipamento encontrado`, `Encontrado no Protheus`, `Tudo OK`, `N
erro(s)`, `Possui MP sem custo`) e como a tabela de divergência de
propriedade (`Propriedade`/`Valor Esperado (Estrutura)`/`Código(s) que
Geraram`/`Valor no Banco`/`Status`) é montada, o usuário perguntou "Já
implementou no novo pop-up?" — não, aquela resposta foi só explicação.
Confirmado então (`AskUserQuestion`, duas perguntas): (1) escopo — só
`N erro(s)` + listar quais propriedades divergem (não `Possui MP sem
custo`, que exigiria calcular o BOM inteiro por código — fora do pedido);
(2) performance — tudo bem essa seção demorar mais que as outras duas,
sem limite de quantidade de estruturas analisadas.

Cada estrutura encontrada vira **uma linha** (uma por código, não uma por
propriedade divergente — mantém a contagem "N encontrada(s)" do badge
igual ao número de estruturas de verdade), com três estados possíveis na
mensagem:
- **Não cadastrada** — `'NÃO cadastrado em Cadastro de Equipamentos.'` —
  não roda a comparação de propriedade nesse caso (sem linha em Cadastro
  de Equipamentos não há "valor no banco" nenhum pra comparar, então o
  passo caro — explodir a estrutura inteira — é evitado à toa).
- **Cadastrada, sem erro** — `'Já cadastrado em Cadastro de Equipamentos.
  Sem erros de propriedade.'`
- **Cadastrada, com erro(s)** — `'Já cadastrado em Cadastro de
  Equipamentos. N erro(s) de propriedade: <Propriedade> (esperado "X" via
  <código> → <valor>, banco tem "Y"); ...'` — um item por propriedade
  divergente dentro da mesma mensagem, no mesmo formato de "Valor Esperado
  (Estrutura)"/"Código(s) que Geraram"/"Valor no Banco" da tabela da tela
  viva.

Pra cada código já cadastrado, reusa exatamente o mesmo motor de
comparação da tela viva — `fetchStructureCodes` (`protheusDb.ts`, explode
a árvore de componentes) + `computeStructurePropertyResults`
(`structurePropertyMatch.ts`, o mesmo motor compartilhado com
`/api/analisador-estruturas` e a regra R090 de Inteligência do Produto) —
nenhuma lógica de comparação nova, só reaproveitada. O rótulo de cada
propriedade vem de `tables.standard_equipment_items.fields` (`schema.ts`,
fonte única de verdade), nunca um mapa duplicado à parte (a tela viva tem
o próprio `FIELD_LABELS` hardcoded — pré-existente, não tocado; este
código novo não replicou esse padrão, foi direto na fonte).

`AppDiagnosticsPopup.tsx` diferencia os três estados **dentro** da lista
expandida de uma seção `'summary'` (a seção em si nunca fica vermelha,
só as linhas individuais mudam de cor): não cadastrado → âmbar (como já
era); cadastrado com erro de propriedade → vermelho (`text-error`, achado
mais sério que "não cadastrado" ainda); cadastrado sem erro → neutro.

## O que NÃO faz parte disto

- Não é a mesma coisa que o "Comparar" removido do Atualizador Global (ver
  `specs/import-export.md`) — aquele comparava CSV recebido × banco de
  dados MSM antes de um import; este é uma varredura de consistência
  interna × Protheus ao vivo, sem CSV nenhum envolvido, disparada
  automaticamente no login, não manualmente numa tela de import.
- Não bloqueia nada — é só informativo. Fechar o pop-up não desfaz nem
  corrige nada; o Admin ainda precisa ir em Cadastro de Equipamentos e
  corrigir o `status` manualmente, linha por linha, se decidir que o
  achado é real.
