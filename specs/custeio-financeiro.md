# Custeio financeiro

## `FORCE_TO_ONE_FIELDS` — custo real nunca vai para o Supabase

```ts
export const FORCE_TO_ONE_FIELDS = [
  'cost_std', 'ipi_tax_rate', 'contribution_margin_ratio', 'seller_commission',
  'manager_commission', 'director_commission', 'certification_cost',
  'labor_cost_rate', 'warranty_rate', 'parts_provision_rate',
]
```

Por sigilo, o valor real desses 10 campos **nunca** é persistido no Supabase:
- Se o valor real é não-zero, o Supabase recebe sempre `1` (sentinela).
- Se não há valor real, fica `0`/vazio — usado deliberadamente como sinal de
  "ainda não custeado".
- O valor real (quando existe) fica só num arquivo local **gitignored**
  (`local-data/`, comentário explícito no `.gitignore`: "nunca vão pro
  Supabase por sigilo, nunca devem ir pro Git também").

Peças desse mecanismo:
- `localCostStore.ts` — `readCostStore`/`replaceTableCosts`/`updateCostRow`/
  `deleteCostRow`/`renameCostRow`: CRUD do arquivo local, indexado por
  `nome da tabela -> chave de negócio -> valores`.
- `localCostGuard.ts` — `protectLocalCostsOnInsert`/`protectLocalCostsOnUpdate`/
  `protectLocalCostsOnDelete`: interceptam o corpo da requisição antes do
  INSERT/UPDATE real, capturam o valor real digitado no arquivo local e
  substituem o campo no `insertBody`/`updateBody` pelo sentinela `1` (ou
  `0`) antes de mandar pro Supabase. Chamado tanto pelo endpoint genérico
  `/api/[table]/route.ts` (POST) quanto por `tableWrite.ts`/`updateTableRow`
  (usado por PUT normal e pelo import restrito de Controladoria).
- `localCostExtract.ts` — `extractRealCosts`: usado pelo Atualizador Global
  (admin) para, ao processar um CSV oficial, extrair o valor real de cada
  linha para o arquivo local antes de gravar o sentinela no Supabase.
- Tela "Importador de Custos Locais" (`/importar-custos-locais`) — ponto de
  entrada manual para popular/corrigir o arquivo local fora de um import de
  tabela completo.

**Histórico**: `parts_provision_rate` entrou em `FORCE_TO_ONE_FIELDS` depois
dos outros 9 campos — havia uma rota de migração one-off
(`/api/admin/migrate-parts-provision-rate`) para capturar valores reais já
salvos direto no Supabase antes de forçá-los a 1. Essa rota já não é chamada
por nada no app (era estritamente para ser rodada uma vez) e foi removida
nesta reestruturação de documentação — se precisar reaplicar uma migração
semelhante para um campo novo, o padrão está no histórico do git.

## `TARGET_COST_PENDING_FIELD` / fila `pending_target_cost`

```ts
export const TARGET_COST_PENDING_FIELD = 'target_cost_pending'
```

Este é um campo **virtual** (`virtual: true`, sem coluna própria) que
representa "peça pro Gerente Adm Comercial aprovar um custo alvo pra este
código". Marcar/desmarcar esse campo em `RecordModal`/import não grava uma
coluna em `accessories`/`standard_equipment_items` — grava ou apaga uma
linha na tabela `pending_target_cost`, via `pendingTargetCostGuard.ts`:
- `syncPendingTargetCostOnWrite(supabaseAdmin, schema, body, protheusCode)` —
  chamado depois de todo INSERT/UPDATE real nas tabelas elegíveis; decide se
  deve criar/atualizar/remover a linha na fila com base no valor de
  `target_cost_pending` recebido no corpo da requisição.
- `clearPendingTargetCostOnDelete` — remove a linha da fila quando o registro
  original é apagado.

Status possíveis na tabela `pending_target_cost`: **`'novo'`** (singular) e
**`'em_alteracao'`**.

### Armadilha `'novos'` (UI) vs `'novo'` (DB) — já causou bug real

A tela Custos Gerais VMI tem abas/`viewMode` com os valores **`'novos'`**
(plural) e `'em_alteracao'`. Comparar diretamente `viewMode === status` dá
sempre falso para a aba "Somente Novos", porque o valor da UI é plural e o
valor do banco é singular. O fix é um mapeamento explícito:

```ts
const wantStatus = viewMode === 'novos' ? 'novo' : 'em_alteracao'
```

Esse bug já foi corrigido em `custos-gerais-vmi/page.tsx`, no botão "Exportar
Custos Sugeridos" do admin e na normalização de chave da rota GET
`/api/pending-target-cost`. Se uma tela nova comparar `viewMode` com
`status` da fila, replicar este mapeamento — nunca comparar as strings
direto.

### `pendingKind` ("Em Alteração de Custeio") vale pros dois perfis — `isNewRow` ("Somente Novos") NÃO — já causou bug real (duas rodadas)

`DataTable.tsx` calcula, por linha, `pendingKind` (`'novo'`/`'em_alteracao'`/
`null`, a fila `pending_target_cost`) e `isNewRow` (o que acende o amarelo e
alimenta a aba "Somente Novos") em `getBaselineInfo`. As duas coisas **não
são sinônimos**, e a regra de `isNewRow` é diferente por perfil nas tabelas
com fila (`accessories`/`standard_equipment_items`, `usesTargetCostPending`):

- **`pendingKind`** — sempre a fila `pending_target_cost`, igual pros dois
  perfis. Controla só a aba/destaque "Em Alteração de Custeio" (azul). Bug
  já corrigido (1ª rodada): tanto o fetch de `/api/pending-target-cost`
  quanto o cálculo de `pendingKind` tinham `&& !appUser.isAdmin` — pro Admin
  a fila nunca era buscada, `pendingKind` ficava sempre `null`, e o filtro
  "Em Alteração de Custeio" sempre dava vazio mesmo com itens de verdade lá.
  **O Admin precisa mesmo dessa aba** — é como ele vê o que a Comercial já
  imputou e sinalizou, pronto pra confirmar oficialmente via Atualizador
  Global.
- **`isNewRow`** ("Somente Novos", amarelo) — regra **por perfil**, mesmo
  nessas duas tabelas:
  - Gerente Adm Comercial: `isNewRow = pendingKind === 'novo'` (o trabalho
    dela é custear o que ainda não tem custo alvo aprovado).
  - **Admin: critério clássico de baseline** — linha/célula diferente do
    último import via Atualizador Global, igual em qualquer outra tabela do
    app. "Toda alteração que é diferente do carregamento do banco de dados
    inicial... tudo que é novo entra em Somente Novos" (pedido explícito do
    usuário, corrigindo a 1ª rodada do fix: eu tinha feito `isNewRow`
    também virar `pendingKind === 'novo'` pro Admin, o que o impedia de ver
    como "novo" qualquer edição comum que não passasse pela fila de custo
    alvo — regressão, não o pedido original).

O grupo de abas Completo/Somente Novos/Em Alteração de Custeio não depende
de `baseline !== null` pra aparecer em tabelas com `usesTargetCostPending`
(a fila não tem nada a ver com ter havido um import CSV) — mas o filtro
"Somente Novos" do Admin em si continua exigindo `baseline !== null` pra
filtrar algo, exatamente como em qualquer tabela sem fila.

### Cor da linha quando `isNewRow` e `pendingKind === 'em_alteracao'` são os dois verdade — azul vence

Como os dois sinais acima são independentes (pro Admin), uma linha pode ser
as duas coisas ao mesmo tempo: diferente do último import (`isNewRow`) **e**
já com custo imputado pela Comercial (`pendingKind === 'em_alteracao'`).
Bug já corrigido: a cor da linha/da célula sticky de Ação priorizava amarelo
(`isNewRow`) sobre azul — então, dentro do próprio filtro "Em Alteração de
Custeio" (onde toda linha visível já é `em_alteracao` por definição do
filtro), algumas apareciam amarelas, inconsistente com a aba em que o
usuário estava. Corrigido invertendo a prioridade: `pendingKind ===
'em_alteracao'` (azul) vence `isNewRow` (amarelo) sempre que os dois forem
verdade — replicar essa ordem (azul antes de amarelo) em qualquer lugar novo
que pinte linha/célula com os dois sinais.

### `pendingTargetCost` precisa ser rebuscado depois de salvar, não só no mount — já causou bug real

Segundo bug do mesmo tipo, achado logo depois do de cima: `pendingTargetCost`
era buscado só uma vez, num `useEffect` que roda no mount/troca de tabela —
sem rebuscar depois de um save. Sintoma relatado: Admin cria um registro
novo em Cadastro de Equipamentos com "Pendente de custo alvo" = Sim, salva,
e a linha **não** aparece destacada em "Somente Novos" — mas ao trocar de
perfil e voltar (o que remonta o componente do zero) a linha aparece
destacada corretamente. Parecia um delay de página; era a fila nunca sendo
recarregada depois do primeiro fetch, mesmo `fetchData()` já trazendo a
linha nova da tabela normalmente.

Mesmo padrão de `fetchLocalCosts` (que já tinha esse cuidado, com o mesmo
comentário explicando o motivo): extraído pra `fetchPendingTargetCost`
(`useCallback`, no-op se `!usesTargetCostPending`), chamado no mount E em
**todo** `onSaved`/`onDone` que já chama `fetchLocalCosts()` — edição
individual, bulk edit, bulk delete, import (Excel e Controladoria), e os
modais de Não Combináveis/Dependentes/Roletes. Qualquer novo ponto que
grave em `accessories`/`standard_equipment_items` e já chame `fetchData()`+
`fetchLocalCosts()` deve chamar `fetchPendingTargetCost()` junto — nunca só
um dos dois.

## "Pendência de Controladoria" (campo zerado) ≠ fila de custo alvo — mas Grupo de Equipamentos agora tem as duas

São dois conceitos de pendência **diferentes**, não um bug quando aparecem
divergentes:
- **Pendência de Controladoria** — qualquer tabela com
  `isControllershipTable` que ainda tenha um campo financeiro zerado (sinal
  de "ainda não custeado" — ver `getControllershipPendingFields`). Continua
  existindo em qualquer tabela de Controladoria, independente da fila
  abaixo.
- **Fila de custo alvo** (`pending_target_cost`, `TARGET_COST_PENDING_FIELD`)
  — só existe onde há o checkbox correspondente. **Histórico**: até esta
  sessão, só Cadastro de Componentes (`accessories`) e Cadastro de
  Equipamentos (`standard_equipment_items`) tinham esse checkbox — Grupo de
  Equipamentos (`equipments`) ficava de fora, só com a pendência de
  Controladoria simples. Pedido explícito do usuário: replicar o mesmo
  mecanismo (checkbox + "✓ Custo Imputado" por linha + aba/destaque azul)
  também em Grupo de Equipamentos — ver "'Em alteração pela Controladoria'"
  abaixo. As duas pendências continuam sendo conceitos diferentes mesmo lá:
  um campo (ex.: IPI) pode estar zerado (Controladoria) sem o código estar
  necessariamente na fila, e vice-versa.

Se um usuário perguntar "por que não estou vendo todas as pendências", a
resposta normalmente é que ele está confundindo as duas listas — não que
há um bug de contagem.

## Grupo de Equipamentos (`equipments`) na fila de custo alvo — chave é `legacy_id`, não `protheus_code`

`equipments` foi adicionado como terceira tabela com `TARGET_COST_PENDING_FIELD`
(mesmo checkbox/link por linha/PATCH `'novo'` → `'em_alteracao'` de
`accessories`/`standard_equipment_items`), mas com uma diferença estrutural
importante: **`equipments` não tem coluna `protheus_code`** — a chave dele é
`legacy_id` (número). A tabela `pending_target_cost` continua tendo só a
coluna `protheus_code` (não foi renomeada) — pra `equipments`, o valor
gravado ali é o `legacy_id` como texto (ex.: `"30"`), não um código Protheus
de verdade.

Isso já tinha causado (e foi corrigido) uma classe de bug real antes de
`equipments` entrar na fila — qualquer lugar que hardcodava `row.protheus_code`/
`record.protheus_code` pra montar a chave da fila simplesmente não
funcionava pra essa tabela (dava sempre string vazia, nunca casava nada).
Corrigido usando `getAuditKeyFields(schema)[0]` (a mesma resolução de chave
de negócio já usada em toda auditoria/comparação de baseline) em vez de
assumir `protheus_code`, nos quatro lugares que precisavam disso:
- `pendingTargetCostGuard.ts` (`syncPendingTargetCostOnWrite` — agora recebe
  a linha inteira, não mais uma string de código já extraída pelo chamador —
  e `clearPendingTargetCostOnDelete`).
- Os call sites em `/api/[table]/route.ts` (POST) e `tableWrite.ts` (PUT) —
  passam `insertBody`/`beforeRow` em vez de montar `String(x.protheus_code)`.
- `DataTable.tsx` (`getBaselineInfo`, botão "✓ Custo Imputado" por linha) —
  `pendingKeyFieldName = getAuditKeyFields(schema)[0].name`, usado em vez de
  `row.protheus_code` direto.
- `RecordModal.tsx` (prefill do checkbox ao reabrir um registro em edição)
  — mesma correção, `record[keyField.name]` em vez de `record.protheus_code`.

**Qualquer tabela nova** que ganhe `TARGET_COST_PENDING_FIELD` no futuro
precisa que esses quatro pontos já funcionem automaticamente (todos já usam
`getAuditKeyFields`, nenhum mais hardcoda `protheus_code`) — não é preciso
tocar em nada além do próprio schema da tabela.

**Quinta ocorrência do mesmo bug, achada depois**: `/api/global-update/[table]/route.ts`
(a limpeza da fila de custo alvo depois de uma reimportação completa pelo
Atualizador Global) também hardcodava `r.protheus_code` para montar os
códigos a remover de `pending_target_cost` — mesma classe de bug dos quatro
pontos acima, só que descoberta depois, durante o trabalho no módulo
Double-check de Queries (`specs/double-check-queries.md`). Corrigido do
mesmo jeito: `getAuditKeyFields(schema)[0]` em vez de `protheus_code` fixo.

**Limitação conhecida, fora do escopo desta mudança**: os cartões "Em
Custeio" do Dashboard (`/api/dashboard/custeio-comercial`,
`/api/dashboard/pending-controladoria`) ainda assumem explicitamente que
`pending_target_cost` só tem código de `accessories`/`standard_equipment_items`
— não contam entradas de `equipments` na fila. Se o usuário quiser que
`equipments` também apareça nesses cartões, isso exige uma mudança separada
nessas duas rotas (não implementado ainda).

## "Em alteração pela Controladoria" — rótulo próprio do estágio 'em_alteracao' por tabela

`TableSchema.targetCostAlterationLabel?: string` — rótulo do estágio
`'em_alteracao'` (aba, tooltips, legenda) pra tabelas com
`TARGET_COST_PENDING_FIELD`. Default (quando ausente) é `'Em Alteração de
Custeio'` (`DataTable.tsx`, `emAlteracaoLabel = schema.targetCostAlterationLabel
?? 'Em Alteração de Custeio'`) — `accessories`/`standard_equipment_items`
não definem esse campo, então continuam com o rótulo padrão.

`equipments` define `targetCostAlterationLabel: 'Em alteração pela
Controladoria'` — pedido explícito do usuário: "custo alvo"/"custo
imputado" não descreve bem o que pende ali (IPI, margem, comissões — não um
único valor de custo). O checkbox continua com o mesmo rótulo de sempre
("Pendente de custo alvo (Comercial)") — só o estágio `'em_alteracao'` (a
aba/destaque azul) foi renomeado; o usuário só pediu pra trocar esse nome
específico, não o resto do vocabulário do fluxo.

## Captura do custo real acontece antes do forçamento a sentinela

Mesmo num import de tabela completa pelo Atualizador Global, o custo real de
cada linha do CSV é extraído para o arquivo local (`extractRealCosts`)
**antes** de o valor no Supabase ser forçado a `1`/`0` — a captura em si não
é o ponto de risco. O risco real a proteger ao tocar nesse fluxo é uma
coluna **não-financeira** ser sobrescrita por acidente durante o import, não
a perda do valor de custo.

## "✓ Custo Imputado" — sinalizar 'novo' → 'em_alteracao', em lote

Botão exclusivo do perfil Gerente Adm Comercial (nunca aparece pro Admin):
PATCH em `/api/pending-target-cost/[code]` com `{ status: 'em_alteracao' }`
pra cada código selecionado que ainda esteja em `'novo'` — sai de "Somente
Novos", entra em "Em Alteração de Custeio", até o Admin confirmar
oficialmente via Atualizador Global. **Não grava nenhum valor de custo** —
é só a sinalização "já imputei o custo desse código" (o valor em si é
editado direto na linha, ou pelo bulk de custo abaixo).

Existe em dois lugares, cada um com sua própria seleção/estado, mas o mesmo
PATCH por trás:
- `custos-gerais-vmi/page.tsx` (`handleMarkImputed`) — cross-tabela, por
  código Protheus (o multi-select ali é por `CostRow.code`, não por `id`).
- `DataTable.tsx` (`handleBulkSignalCostImputed`) — só em **Cadastro de
  Componentes** (`tableName === 'accessories'`, `showBulkCostImputado`),
  pedido explícito do usuário. Reaproveita o checkbox de multi-seleção que
  "Excluir"/"Alterar selecionados" já usam (`selectedIds`, por `row.id`) —
  pra não precisar marcar um código de cada vez pelo link "✓ Custo
  Imputado" que já existia por linha (`handleSignalCostImputed`). O botão em
  lote só conta (e só envia PATCH para) os selecionados que ainda estão em
  `'novo'` — os demais são ignorados silenciosamente, sem erro.
  **Cadastro de Equipamentos** (`standard_equipment_items`) também tem
  `usesTargetCostPending` e continua com o link por linha, mas **não** tem o
  botão em lote — decisão deliberada, não esquecimento; se pedirem lá
  também, replicar o mesmo `showBulkCostImputado` com a tabela certa.

Não confundir com o bulk **de valor** abaixo (`CostBulkEditModal`) — são
ações independentes: uma grava `cost_std`, a outra só move o status da
fila.

## Dashboard — card "Em Custeio"

Conta quantos códigos estão na fila `pending_target_cost`. Bug já corrigido:
o total era somado a partir de breakdowns por tabela que podiam falhar
silenciosamente — o fix foi somar direto da fila (fonte de verdade) e expor
uma contagem de diagnóstico `unmatched` para casos em que um código da fila
não é encontrado em nenhuma tabela (normalmente por causa de
maiúsculas/minúsculas — ver a armadilha do `.in()` acima).

## `CostBulkEditModal` vs `BulkEditModal`

- `BulkEditModal.tsx` — genérico, dirigido pelo schema: edita um ou mais
  campos de uma tabela para os IDs selecionados em `DataTable`.
- `CostBulkEditModal.tsx` — hardcoded para um único campo (custo) através de
  **múltiplas tabelas** ao mesmo tempo (usado na feature "Custo Imputado" de
  Custos Gerais VMI). Não é genérico de propósito: a operação atravessa
  `accessories`/`standard_equipment_items`/`dependant_items` de uma vez e
  precisa lidar com `FORCE_TO_ONE_FIELDS` e a fila de custo alvo junto — um
  componente schema-genérico não daria conta disso sem virar mais complexo
  que os dois separados.

## Escritas financeiras em massa são sequenciais

Qualquer rota que grava valores financeiros em lote (import restrito de
Controladoria, "Custo Imputado") processa uma linha por vez com `for...of` +
`await`, nunca `Promise.all` — de propósito, para que um erro numa linha não
afete as outras e para manter a ordem previsível ao revisar o resultado.
