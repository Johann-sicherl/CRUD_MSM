# Diagnóstico da Aplicação ("Visão Geral Avançada Global")

Pop-up automático que varre a base procurando inconsistências que o
Administrador precisa saber de cara, sem abrir tela por tela. Pedido
explícito do usuário: "quero que faça uma rotina, sempre na primeira
abertura da aplicação, ou quando eu atualizo a aplicação, ele me dê um
follow up completo de como está tudo que eu preciso saber, através de um
pop-up... primeiro comece varrendo Cadastro de Equipamentos, analisando se
tem algo bloqueado no Protheus... e com STATUS igual active, sempre que
tiver bolinha vermelha tem que estar deactive."

**Nome visível do pop-up**: renomeado pra "Visão Geral Avançada Global" a
pedido explícito do usuário ("mudo o nome deste pop-up para Visão Geral
Avançada Global, ou nome parecido") — só o título (`<h3>` em
`AppDiagnosticsPopup.tsx`) mudou. Nomes de arquivo/componente/função
(`AppDiagnosticsPopup`, `AppDiagnosticsGate`, `appDiagnostics.ts`,
`app-diagnostics` na rota) e o título deste próprio documento continuam
com o nome original "Diagnóstico da Aplicação" — renomear isso também não
foi pedido, e trocaria referências espalhadas por vários arquivos sem
nenhum ganho pro usuário (que só vê o título na tela).

## Quando aparece

- **Só Admin** — pedido explícito do usuário (não Gerente Adm Comercial,
  não Analista de Dados, mesmo que também conectem ao Protheus).
- **Só depois que os DOIS bancos já conectaram — Protheus e PDM**
  (`AppDiagnosticsGate.tsx`, dentro de `ClientLayout.tsx`, escuta
  `useProtheusAuth().creds` **e** `usePdmAuth().creds`) — reusa as
  credenciais já fornecidas pelo Admin (nunca pede uma segunda vez).
  **Histórico**: até uma sessão posterior, disparava só com o Protheus (o
  PDM era opcional — a Checagem #4 mostrava "PDM não conectado" e se
  autoatualizava quando o PDM conectasse depois, ver "Checagem #4"
  abaixo). Pedido explícito do usuário, rodada seguinte: "quero que você
  dispare a consulta do pop-up de Análise, depois que for conectado os
  dois bancos de dados" — agora o disparo inicial inteiro espera os dois.
  Como o PDM é oferecido automaticamente só depois do Protheus e o Admin
  pode dispensar o modal ("Agora não"), dispensar significa que o pop-up
  não dispara nesta carga de página até o Admin conectar ao PDM manualmente (botão
  "Conectar PDM" na Sidebar, sempre disponível pra Admin — `canConnectPdm`
  é ignorado quando `isAdmin`) — decisão deliberada, não é um beco sem
  saída porque esse botão sempre existe.
- **Toda vez que os dois bancos conectarem numa carga de página — sem gate
  de "uma vez por build"**. **Histórico**: a 1ª versão comparava o hash do
  commit atual (`NEXT_PUBLIC_APP_BUILD_SHA`, embutido no bundle do cliente
  por `next.config.js` via `execSync('git rev-parse --short HEAD')` em
  build time) contra o que estava salvo em
  `localStorage['app-diagnostics-seen-build']` — build nunca visto → roda
  o diagnóstico; mesmo build já visto (mesmo depois de um F5) → não mostra
  nada, até o próximo `npm run build` em produção. Isso foi confirmado com
  o usuário na época como decisão deliberada (automático via hash do Git,
  sem passo manual extra a cada deploy).

  **Removido, pedido explícito do usuário, rodada seguinte**: "estou
  clicando em F5 e o pop-up não está tornando a voltar" — depois de eu
  explicar a causa (a trava de "visto" persistia em `localStorage`
  independente de F5, só resetava num deploy novo de verdade), o usuário
  escolheu explicitamente abandonar o conceito de "uma vez por build" em
  vez de só ganhar um jeito manual de limpar a trava: "Fazer reaparecer
  sempre que os dois bancos conectarem". `NEXT_PUBLIC_APP_BUILD_SHA`
  (`next.config.js`, `getBuildSha`) e a chave `app-diagnostics-seen-build`
  foram removidos por completo — não sobrou nenhum uso de
  `NEXT_PUBLIC_APP_BUILD_SHA` no projeto depois disso. `AppDiagnosticsGate.tsx`
  agora só depende de `triggered` (estado de componente, nunca persistido)
  pra não disparar duas vezes **dentro da mesma carga de página** — como um
  F5 é uma navegação "dura" (remonta o app do zero, credenciais em memória
  somem — mesmo comportamento já documentado em
  `specs/pdm-protheus-integracao.md` pra Protheus/PDM), `triggered` também
  reseta, e assim que o Admin reconectar aos dois bancos o pop-up dispara
  de novo. Reconectar sem dar F5 (desconectar/reconectar pela Sidebar, sem
  recarregar a página) não dispara de novo — só um carregamento de página
  novo faz isso.

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
- **Fonte maior** — pedido explícito do usuário, rodada seguinte: "aumente
  a letra da fonte deste pop-up". Todo tamanho de texto do pop-up subiu um
  degrau em relação à versão original (`text-xs` → `text-sm`, `text-sm` →
  `text-base`, título `text-base` → `text-xl`, ✕ de fechar e chevron
  `text-xl`/`text-2xl`) — extraído em `IssueRow` (componente pequeno,
  reusado tanto na lista simples quanto nos blocos abaixo) pra não deixar
  o tamanho de fonte de cada linha divergir entre os dois modos de
  renderização.
- **`src/lib/appDiagnosticsGroups.ts`** (novo arquivo, só constantes) —
  `REVERSE_SEARCH_GROUPS`/`REVERSE_SEARCH_GROUP_ORDER` moraram
  originalmente dentro de `appDiagnostics.ts`, mas **precisaram ser
  extraídas pra um arquivo à parte**: `appDiagnostics.ts` é server-only
  (importa `protheusDb.ts`, que importa `mssql`) — um componente `'use
  client'` como `AppDiagnosticsPopup.tsx` importando um **valor de
  runtime** de lá (não só um `type`) arrasta o módulo `mssql` inteiro pro
  bundle do navegador, e o build quebra (`Module not found: Can't resolve
  'dns'`, dependência Node-only de dentro do `tedious`/`mssql`). Erro real
  encontrado ao implementar o agrupamento por blocos abaixo — corrigido
  extraindo as duas constantes (sem nenhum import de `protheusDb`/
  `supabase`) pro arquivo novo, importado tanto por `appDiagnostics.ts`
  quanto por `AppDiagnosticsPopup.tsx`. `import type { DiagnosticSection,
  DiagnosticIssue }` continua vindo de `appDiagnostics.ts` normalmente —
  um `import type` é sempre apagado em tempo de compilação, nunca arrasta
  o módulo de verdade pro bundle; só importar um **valor** (`const`,
  função) de um módulo server-only é que é perigoso num componente
  cliente.
- **Agrupamento em "Blocos"** — pedido explícito do usuário: "faça a
  separação dos equipamentos por 'Blocos', assim, o que está errado, que
  eu veja nesta caixa dropdown". `DiagnosticIssue.group?: string`
  (`appDiagnostics.ts`) — campo opcional; ausente = lista única de sempre
  (as duas checagens de status Protheus continuam assim, nunca setam
  `group`). Quando pelo menos um `issue` da seção tem `group`,
  `AppDiagnosticsPopup.tsx` agrupa a lista expandida em blocos, cada um
  com um sub-cabeçalho (`"<nome do bloco> (N)"`, cor conforme o bloco) em
  vez da lista plana. Ordem dos blocos vem de `REVERSE_SEARCH_GROUP_ORDER`
  — erro primeiro (é o que o usuário quer ver de cara), depois não
  cadastrado, depois OK por último; qualquer `group` fora dessa lista
  (nenhum hoje) cairia no final, na ordem que aparecer. `groupTone(group)`
  compara **igualdade exata** contra as constantes de
  `REVERSE_SEARCH_GROUPS`, nunca `.includes()`/substring — achado real ao
  implementar: o bloco `"Cadastrado, sem erros"` contém a palavra "erro"
  dentro de si, então um `.includes('erro')` ingênuo pintaria esse bloco
  de vermelho por engano.
- **Caixinha por equipamento (`EquipmentBox`)** — pedido explícito do
  usuário, rodada seguinte: "não separou cada equipamento em 'Caixinhas'
  e quando eu clico no equipamento ele me mostra os erro dele." Dentro de
  cada bloco, cada equipamento agora é seu próprio card clicável, recolhido
  por padrão — clicar expande e mostra os erros **dele** (não o bloco
  inteiro de uma vez). Estado de expandido/recolhido é por linha
  (`expandedRows`, chave `${section.key}::${group}::${rowLabel}::${índice}`
  — nunca colide entre blocos/seções diferentes), completamente
  independente do estado de expandido/recolhido da seção (`expanded`) e
  dos outros equipamentos.
  - `DiagnosticIssue.details?: DiagnosticIssueDetail[]`
    (`appDiagnostics.ts`) — quando presente, a caixinha expandida renderiza
    a mesma mini-tabela **Propriedade / Valor Esperado (Estrutura) /
    Código(s) que Geraram / Valor no Banco** já usada em Busc. Itens Série
    Estrut. Protheus, em vez de só texto. `checkReverseSearchStructures`
    preenche isso só no bloco "Com erro(s) de propriedade" — um item de
    `details` por propriedade divergente (`property`/`expected`/`via`/
    `dbValue`, os mesmos 4 dados que a tela viva mostra por linha). Os
    outros dois blocos ("Não cadastrado"/"Cadastrado, sem erros") não têm
    `details` — a caixinha, ao expandir, cai no fallback e só mostra
    `issue.message` (agora mais curta: `'Sem erros de propriedade.'`, sem
    repetir "Já cadastrado em Cadastro de Equipamentos" — isso já fica
    óbvio pelo nome do bloco).
  - Cabeçalho da caixinha (recolhida): código do equipamento + badge — "N
    erro(s)" em vermelho quando tem `details`, ou a própria `message`
    (curta) quando não tem. Nenhum dado é escondido do usuário antes de
    clicar — o resumo já dá o essencial, o clique só abre o detalhe.
- **Blocos também são dropdowns** — pedido explícito do usuário, rodada
  seguinte: "agrupe para dentro de dropdowns os itens de Com erro(s) de
  propriedade (N), Não cadastrado em Cadastro de Equipamentos (N) e
  Cadastrado, sem erros (N)." Antes disso, o sub-cabeçalho de cada bloco
  era só um rótulo estático — a lista de caixinhas de equipamento
  aparecia sempre logo abaixo, sem precisar clicar em nada. Agora cada
  bloco em si é um dropdown recolhido por padrão (`expandedGroups`, chave
  `${section.key}::${group}`), com o mesmo padrão de chevron que gira 90°
  usado em todo o resto do app — clicar no cabeçalho do bloco expande a
  lista de caixinhas dele. É o terceiro nível de recolher/expandir dentro
  da mesma tela: **seção** (`expanded`) → **bloco** (`expandedGroups`) →
  **equipamento** (`expandedRows`), cada nível com seu próprio estado
  independente, nunca um afeta o outro.
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
igual ao número de estruturas de verdade), com três estados possíveis,
cada um também um `issue.group` (ver "Agrupamento em 'Blocos'" acima —
`REVERSE_SEARCH_GROUPS` em `appDiagnosticsGroups.ts`):
- **Não cadastrada** (`group: notRegistered`) — mensagem `'NÃO cadastrado
  em Cadastro de Equipamentos.'` — não roda a comparação de propriedade
  nesse caso (sem linha em Cadastro de Equipamentos não há "valor no
  banco" nenhum pra comparar, então o passo caro — explodir a estrutura
  inteira — é evitado à toa).
- **Cadastrada, sem erro** (`group: ok`) — mensagem curta `'Sem erros de
  propriedade.'` (não repete "Já cadastrado em Cadastro de Equipamentos" —
  já fica implícito pelo nome do bloco).
- **Cadastrada, com erro(s)** (`group: errors`) — mensagem curta `'N
  erro(s) de propriedade.'` **e** `details: DiagnosticIssueDetail[]` — um
  item por propriedade divergente (`property`/`expected`/`via`/`dbValue`),
  renderizado como mini-tabela dentro da caixinha do equipamento (ver
  "Caixinha por equipamento" acima), não mais concatenado dentro da
  própria `message` como antes.

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

`AppDiagnosticsPopup.tsx` diferencia os três estados **em blocos**
separados dentro da lista expandida (a seção em si nunca fica vermelha, só
os blocos mudam de cor — ver "Agrupamento em 'Blocos'" acima): "Com
erro(s) de propriedade" primeiro (vermelho, `text-error`, o achado mais
sério), depois "Não cadastrado em Cadastro de Equipamentos" (âmbar),
depois "Cadastrado, sem erros" por último (neutro). Dentro de cada bloco,
cada equipamento é sua própria caixinha (ver "Caixinha por equipamento"
acima) — o clique é por equipamento, nunca por bloco inteiro.

## Checagem #4 — Consulta PDM x Banco MSM

Pedido explícito do usuário: "traga a análise de Consulta PDM x Banco MSM,
1 ok / 161 divergentes / 21 só no PDM / 130 só no Banco MSM — mesmo estilo,
linha a linha, caixa a caixa, segundo código a código. Separe grupo também
por dropdown." Réplica, dentro do pop-up, das mesmas 4 categorias que a
tela viva `pdm-consulta-acessorios/page.tsx` já calcula (`comparePdmWithSupabase`,
`pdmCompare.ts`) — nenhuma lógica de comparação nova, `checkPdmVsSupabase`
(`appDiagnostics.ts`) reaproveita `fetchPdmAccessories` (`pdmDb.ts`) e
`comparePdmWithSupabase`/`PDM_FIELD_MAP` (`pdmCompare.ts`) tal e qual —
mesmo padrão de reuso das checagens anteriores. `mode: 'summary'` (é um
inventário das 4 categorias, não uma lista de "coisas erradas" só; a
própria seção nunca fica vermelha sozinha, só os blocos, mesmo padrão de
Busca Reversa). Fonte do lado banco de dados MSM é só `Cadastro de
Componentes` (`accessories`) — a mesma tabela que a tela viva usa do lado
Supabase (`accessory_groups`, ali, é só pra rótulo de grupo — não entra na
comparação em si).

### PDM é uma segunda conexão, à parte do Protheus — histórico do timing (3 rodadas)

**1ª rodada (versão original desta checagem)**: diferente do Protheus
(credencial obrigatória pra o pop-up disparar), a conexão ao PDM é
oferecida automaticamente só **depois** que o Protheus já conectou
(`pdmAuthContext.tsx`, `offeredRef`) — e exige um passo à parte do Admin
pra completar (preencher usuário/senha no modal que abre sozinho). Nessa
1ª versão, o pop-up disparava assim que o Protheus conectava — no mesmo
instante, o PDM tipicamente **ainda não** estava conectado. Decisão da
época (não bloquear o diagnóstico inteiro nem pular a seção em silêncio):
`checkPdmVsSupabase` verificava a credencial de PDM no início e, se
ausente, devolvia um único aviso informativo — `'PDM não conectado nesta
sessão — conecte ao Banco PDM...'`.

**2ª rodada, pedido explícito do usuário**: "faz o PDM re-rodar sozinho
quando conectar" — em vez de ficar preso em "PDM não conectado" até o
próximo build, `runPdmDiagnosticSection(pdm)` (`appDiagnostics.ts`) passou
a rodar **só** `checkPdmVsSupabase`, fora do loop de `CHECKS`/
`runAppDiagnostics` — reexecutar o diagnóstico inteiro só por causa do PDM
refaria as outras 3 checagens à toa (Protheus/Busca Reversa não dependem
do PDM). Extraído `runCheckResult(key, tableLabel, mode, run)` de dentro
de `runAppDiagnostics` (o mesmo try/catch por checagem, reusado pelos dois
caminhos) — `runCheck(check, creds)` é só um wrapper fino dela pro loop
principal. Nova rota `POST /api/app-diagnostics/pdm` (`{ profileId,
pdmUser, pdmPassword }`, mesma checagem `getProfileById` + `isAdmin` da
rota principal) chama `runPdmDiagnosticSection` e devolve `{ section }` —
só essa seção, não o array inteiro.

**3ª rodada, pedido explícito do usuário**: "quero que você dispare a
consulta do pop-up de Análise, depois que for conectado os dois bancos de
dados" — em vez de disparar com o Protheus sozinho e corrigir a seção do
PDM depois (2ª rodada), o disparo inicial inteiro (`AppDiagnosticsGate.tsx`)
passou a esperar **os dois** (`protheusCreds && pdmCreds`, ver "Quando
aparece" acima). Na prática, isso significa que o branch `!pdm` dentro de
`checkPdmVsSupabase` — o aviso "PDM não conectado" da 1ª rodada — não é
mais alcançado pelo fluxo normal (o pop-up só abre com os dois já
conectados); mantido mesmo assim como defesa, já que o parâmetro continua
opcional no tipo (`runPdmDiagnosticSection` também pode, em tese, ser
chamada sem credencial).

O mecanismo da 2ª rodada (`runPdmDiagnosticSection`, rota
`/api/app-diagnostics/pdm`, o segundo `useEffect` em `AppDiagnosticsGate.tsx`)
**não foi removido** — continua útil pra um caso diferente: o Admin
desconecta e reconecta ao PDM com outro usuário (Sidebar) depois que o
pop-up já rodou (com os dois conectados, na 1ª vez). `pdmSyncedKeyRef`
(chave `usuário:senha`) já nasce marcado com a credencial usada na rodada
inicial, então esse efeito só dispara de novo numa reconexão de verdade,
nunca redundantemente logo após o disparo inicial. Segue rodando em
segundo plano mesmo com o pop-up já fechado pelo Admin (não há gate de
`open` no efeito) — atualiza o state de qualquer forma; só não fica
visível até reabrir. **Limitação aceita conscientemente, ainda existente**:
não há botão pra reabrir o pop-up manualmente hoje (ele só abre sozinho,
uma vez por carregamento de página — ver "4ª rodada" abaixo) — então,
nesse cenário de reconexão, o Admin só vê o resultado atualizado se ainda
estiver com o pop-up aberto no momento em que reconecta ao PDM. Corrigir
isso (um jeito de reabrir o pop-up a qualquer momento) não foi pedido e é
uma mudança à parte.

**4ª rodada, pedido explícito do usuário**: "estou clicando em F5 e o
pop-up não está tornando a voltar" — o gate de "uma vez por build" (ver
"Quando aparece" acima) fazia o pop-up ficar preso em "já visto" mesmo
depois de um F5, até o próximo `npm run build` em produção de verdade.
Removido por completo (`NEXT_PUBLIC_APP_BUILD_SHA`/
`app-diagnostics-seen-build`) — escolha explícita do usuário entre três
opções (`AskUserQuestion`): manter e só explicar, adicionar um botão de
reabrir manual, ou abandonar o "uma vez por build" e disparar toda vez que
os dois bancos conectarem — escolhida a terceira. Agora o gate é só
`triggered` (estado de componente, nunca persistido), que reseta em
qualquer carregamento de página novo (F5 já derruba as credenciais em
memória de qualquer forma — ver `specs/pdm-protheus-integracao.md`) — então
o pop-up volta a aparecer a cada F5 seguido de reconexão aos dois bancos,
não só uma vez por deploy.

**Efeito colateral aceito da 3ª rodada**: como a conexão ao PDM pode ser
dispensada pelo Admin ("Agora não" no modal automático), dispensar agora
significa que o pop-up de Diagnóstico inteiro não dispara nesta carga de
página — não só a seção do PDM, como antes. O Admin sempre tem um jeito de
destravar isso (botão "Conectar PDM" na Sidebar, disponível pra Admin
independente de `canConnectPdm`), então não é um beco sem saída, mas é uma
mudança de comportamento real em relação à 1ª/2ª rodada (onde o Protheus
sozinho já era suficiente pro pop-up aparecer). Pedido explícito do
usuário, não uma regressão despercebida.

### Threading de credencial — mudança de assinatura compartilhada por todas as checagens

Antes desta checagem, `Check.run` recebia só `ProtheusCredentials`. Como o
PDM é uma credencial nova e opcional, `DiagnosticsCredentials` (`appDiagnostics.ts`)
passou a ser `{ protheus: ProtheusCredentials; pdm: PdmCredentials | null }`
— **todas** as checagens existentes (`checkProtheusStatusVsActive`,
`checkReverseSearchStructures`) foram ajustadas pra ler `creds.protheus`
em vez de `creds` direto; nenhuma mudou de comportamento, só a forma de
acessar a credencial Protheus. `AppDiagnosticsGate.tsx` (já renderizado
dentro de `PdmAuthProvider`, ver nesting de providers em
`specs/permissoes-e-perfis.md`) passou a também ler `usePdmAuth().creds` e
enviar `pdmUser`/`pdmPassword` (opcionais) no POST pra
`/api/app-diagnostics`; a rota monta `pdm: null` quando ausentes.

### Blocos — segunda família de grupos, popup generalizado pra não colidir com a de Busca Reversa

`PDM_COMPARE_GROUPS`/`PDM_COMPARE_GROUP_ORDER` (`appDiagnosticsGroups.ts`,
mesmo arquivo client-safe da Busca Reversa, mesmo motivo de extração — ver
"Arquitetura" acima) — ordem "o que está errado primeiro": `Divergentes` →
`Só no PDM` → `Só no Banco MSM` → `OK` por último. Cada linha do resultado
de `comparePdmWithSupabase` vira uma `DiagnosticIssue` com o `group`
correspondente:
- **`ok`** (`group: 'OK'`) — mensagem `'Sem divergência.'`, sem `details`.
- **`mismatch`** (`group: 'Divergentes'`) — mensagem `'N campo(s)
  divergente(s).'` **e** `details: DiagnosticIssueDetail[]`, um item por
  campo de `PDM_FIELD_MAP` que diverge (`row.diffs`, já calculado por
  `comparePdmWithSupabase`) — `property = diff.label`, `expected =
  diff.pdmDisplay`, `via = 'PDM'` (fixo — diferente da Busca Reversa, aqui
  não há "código(s) que geraram" o valor, é uma comparação direta campo a
  campo contra o PDM), `dbValue = diff.supabaseDisplay`. Renderiza na mesma
  mini-tabela da caixinha de equipamento (`EquipmentBox`), sem nenhuma
  mudança na UI — o componente já era genérico o bastante.
- **`pdm-only`** (`group: 'Só no PDM'`) — mensagem `'Existe no PDM, não
  cadastrado em Cadastro de Componentes.'`.
- **`supabase-only`** (`group: 'Só no Banco MSM'`) — mensagem `'Cadastrado
  em Cadastro de Componentes, não encontrado no PDM.'`.

Como `AppDiagnosticsPopup.tsx` já tinha `groupTone`/a ordenação de blocos
(`groupKeys`) hardcoded pra só reconhecer `REVERSE_SEARCH_GROUP_ORDER`
(achado ao implementar esta checagem — a Busca Reversa foi a primeira e
única seção agrupada até aqui), os dois foram generalizados: `ALL_GROUP_ORDER
= [...REVERSE_SEARCH_GROUP_ORDER, ...PDM_COMPARE_GROUP_ORDER]` — como os
nomes de grupo das duas famílias nunca se sobrepõem e cada seção só produz
issues da própria família, filtrar `ALL_GROUP_ORDER` por `grouped.has(g)`
já isola e ordena corretamente por seção, sem nenhuma checagem "qual
família é esta" — qualquer checagem futura que precise de blocos só
precisa adicionar sua própria constante de grupos a este array, sem tocar
no resto da lógica de ordenação. `groupTone` idem: comparação exata contra
as 4 constantes novas, mesmo cuidado de nunca usar substring já documentado
acima (mismatch/pdmOnly/supabaseOnly em tom vermelho/âmbar, `ok` neutro).

Mesmo "caixinha por código, expande pra ver o erro dele" da Busca Reversa —
pedido explícito do usuário ("caixa a caixa, segundo código a código") —
nenhum componente novo foi criado, `EquipmentBox` já era genérico o
bastante (rótulo = `rowLabel`, badge = `details.length` erro(s) ou a
`message`, mini-tabela a partir de `details`).

## Checagem #5 — Cadastros sem Imagem

Pedido explícito do usuário: "Adicione em Visão Geral Avançada Global um
Dropdown que me fala quantos cadastros não possuem imagem." Reaproveita o
mesmo núcleo da Busca Reversa de Imagens já usada na tela Grupos de
Imagens (`computeImageReverseSearch`, `src/lib/imageReverseSearch.ts`,
ver `specs/imagens-r2.md`) — nenhuma lógica de contagem nova: a mesma
conta (DISTINCT `standard_equipment_items.protheus_code` com status
`active`, + `relationship_equip_accessory.protheus_code` cujo componente
correspondente em `accessories` também está `active`, cruzados contra o
bucket R2) foi extraída pra um módulo próprio justamente pra poder ser
chamada dos dois lugares sem duplicar/arriscar divergir — `GET
/api/r2-images/reverse-search` (tela Grupos de Imagens) também passou a
chamar essa mesma função em vez de ter a conta inline.

**Diferente das Checagens #3 e #4 (`mode: 'summary'`), esta é `mode:
'problems'` (o padrão)** — decisão deliberada pra responder exatamente o
que foi pedido ("me fala **quantos**"): só os códigos **sem** imagem
entram como `issue` (`checkImagesMissing`, `appDiagnostics.ts`); os
códigos com imagem não aparecem em lugar nenhum aqui — isto não é um
inventário completo como Busca Reversa (Protheus)/Consulta PDM x Banco
MSM, é pontualmente sobre o que falta. Isso faz o badge do próprio
cabeçalho do dropdown já mostrar `N problema(s)` = exatamente quantos
cadastros (ativos) não têm imagem, sem precisar expandir pra achar esse
número — e esse total também soma em `totalProblems`, o resumo no topo
do pop-up (diferente das seções `summary`, que são excluídas de propósito
dessa soma). Sem `group`/blocos (lista única, mesmo padrão simples das
Checagens #1/#2) — não há um segundo estado pra separar em blocos, já que
"com imagem" nunca aparece aqui.

Não precisa de nenhuma credencial (Protheus/PDM) — é só Supabase + bucket
R2 — mas entra no mesmo `CHECKS`/`runAppDiagnostics` de qualquer forma,
já que o pop-up só dispara depois que os dois já conectaram mesmo assim
(ver "Quando aparece" acima); não haveria ganho em tratá-la separado só
por essa diferença.

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
