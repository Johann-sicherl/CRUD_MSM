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

## "Grupo de Equipamentos pendente" ≠ fila de custo alvo

São dois conceitos de pendência **diferentes**, não um bug quando aparecem
divergentes:
- **Pendência de Controladoria** — qualquer tabela com
  `isControllershipTable` que ainda tenha um campo financeiro zerado (sinal
  de "ainda não custeado" — ver `getControllershipPendingFields`). Isso
  inclui Grupo de Equipamentos.
- **Fila de custo alvo** (`pending_target_cost`, `TARGET_COST_PENDING_FIELD`)
  — só existe onde há o checkbox correspondente, hoje apenas Cadastro de
  Componentes e Cadastro de Equipamentos. Grupo de Equipamentos não tem esse
  checkbox e por isso nunca aparece nessa fila especificamente.

Se um usuário perguntar "por que não estou vendo todas as pendências", a
resposta normalmente é que ele está confundindo as duas listas — não que
há um bug de contagem.

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
