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
