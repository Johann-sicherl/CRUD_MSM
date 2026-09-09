# Import / Export

Existem **três mecanismos distintos** de import — não confundir:

## (a) Atualizador Global — substituição total (admin)

- Tela "Atualizador Global de Tabelas MSM" (`/atualizador-global`), qualquer
  tabela.
- **Só CSV**, de propósito — `csvTableDetect.ts` (`parseCsvText`,
  `detectTable`, `parseCsvRaw`) nunca usa SheetJS/xlsx porque SheetJS
  reformata células com cara de data, o que corromperia `created_at`/
  `updated_at`.
- Server-side: RPC Postgres `global_table_replace` (`msm_global_table_replace.sql`)
  — **DELETE + INSERT atômico** de toda a tabela a partir do CSV. `SECURITY
  DEFINER`, `REVOKE`/`GRANT` já aplicado (ver `specs/sql-migrations.md`).
- Aplica `extractRealCosts` (`localCostExtract.ts`) e o forçamento de
  `FORCE_TO_ONE_FIELDS` a 1 antes de persistir (ver `specs/custeio-financeiro.md`).
- Guarda um snapshot da tabela pré-import (`msm_csv_baseline_snapshots.sql`)
  para permitir a comparação "CSV novo vs. banco atual" (ver
  `specs/csv-baseline-comparacao.md`).

## (b) Import restrito de Controladoria/Fiscal/Precificação

- Mesma tela "Atualizador Global", mas para o perfil Gerente Adm Comercial —
  rota `/api/global-update-controladoria/[table]/route.ts`.
- Só tabelas com `isControllershipTable(schema)` (ver `specs/dados-e-schema.md`).
- Aceita **CSV ou XLSX** (`csvControladoriaDetect.ts`, via SheetJS) — seguro
  aqui porque este fluxo **nunca** toca colunas de timestamp, só a chave de
  negócio + colunas financeiras (sempre decimal).
- **Só faz UPDATE**, uma linha por vez, casando pela chave de negócio
  (`getAuditKeyFields(schema)[0]`) — nunca cria linha nova, nunca apaga nada,
  e só grava as colunas retornadas por `getControllershipPendingFields`
  (qualquer outra coluna do arquivo, como nome/descrição/grupo, é ignorada
  mesmo que esteja presente).
- Reaproveita `updateTableRow` (`tableWrite.ts`) — o mesmo caminho do PUT
  normal de `/api/[table]/[id]` — para herdar de graça a auditoria e a
  proteção de custo real local, sem duplicar essa lógica. **Decisão
  arquitetural deliberada**: em vez de criar um caminho de escrita paralelo
  para este import, a lógica de UPDATE existente foi extraída para esse
  helper único, reaproveitado pelos dois fluxos — para nunca duplicar (e
  arriscar divergir) a regra de negócio de auditoria/proteção de custo.
- Grupo de Equipamentos, Cadastro de Equipamentos e Cadastro de Componentes
  têm cada um um botão "Importar Custos" na própria tela, reaproveitando
  exatamente este mesmo mecanismo — conveniência de UI, nenhuma regra de
  negócio nova.
- Permissão via `getProfileById`, nunca um `isAdmin` do corpo (ver
  `specs/permissoes-e-perfis.md`).
- Processamento das linhas é **sequencial**, de propósito (dados financeiros
  em massa — ver `specs/custeio-financeiro.md`).
- O botão "↑ Importar Custos" dentro de `DataTable.tsx` (Cadastro de
  Componentes/Equipamentos/Grupo de Equipamentos) abre uma **janela de
  revisão** antes de confirmar (`ControladoriaImportReviewModal.tsx`) — pedido
  explícito do usuário: mostra, por linha, o valor atual (custo real local,
  não o sentinela) ao lado do valor do arquivo, deixa **editar qualquer
  célula** (inclusive a chave de negócio, pra corrigir um código digitado
  errado) antes de confirmar, e só libera o botão de importar depois que não
  sobra linha "não encontrada"/duplicada/com valor não numérico. Mesmo
  espírito do `ImportReviewModal` do Admin (mecanismo (c) abaixo), mas sem
  reimplementar a escrita: no fim, ainda faz um único POST para esta mesma
  rota `/api/global-update-controladoria/[table]`, só que com os valores já
  revisados/corrigidos e rechaveados por `field.name` em vez do cabeçalho
  cru do arquivo.
- O import restrito dentro de "Custos Gerais VMI" tem sua própria janela de
  revisão (`CostImportReviewModal.tsx`), mais simples (só o campo custo,
  cross-tabela) — **não** foi unificado com `ControladoriaImportReviewModal`
  de propósito: são fluxos diferentes (um por tabela vs. um cross-tabela por
  código Protheus).

## (c) "+Novo Registro > Importar Excel" — fila de insert por tela

- `importExport.ts` → `parseImportFile`, gated por `canCreateDelete`, entrega
  linhas para `ImportReviewModal` revisar antes de confirmar o insert em
  lote (via `RecordModal` em modo `isBatch`, quando `schema.batchInsert` é
  `true` — ver `specs/ui-componentes.md`).
- Passa pelo mesmo `/api/[table]/route.ts` POST normal (incluindo
  `validateExistsIn`, checagem de `unique`, `doubleInsert`, proteção de
  custo local e sync da fila de custo alvo).

## Casamento de cabeçalho por nome OU rótulo (`findHeaderForField`)

`exportVisibleData`/`exportMatrix` (`importExport.ts`) geram arquivos usando
o **rótulo em português** (`field.label`, ex. "Custo (R$)") como cabeçalho,
não o nome real da coluna (`cost_std`). O detector do import restrito de
Controladoria (`csvControladoriaDetect.ts`) originalmente só reconhecia o
nome real da coluna — resultado: reimportar um arquivo que tinha acabado de
ser exportado por "Exportar dados" dava "nenhuma coluna reconhecida", mesmo
sendo exatamente os dados certos.

Fix, aplicado nos **dois lados** (detecção client-side em
`detectControladoriaTable` e, de forma independente, na rota server-side
`/api/global-update-controladoria/[table]/route.ts`, que tinha sua própria
lógica de casamento duplicada):

```ts
export function findHeaderForField(field: Field, headerByLower: Map<string, string>): string | undefined {
  return headerByLower.get(field.name.toLowerCase()) ?? headerByLower.get(field.label.toLowerCase())
}
```

Qualquer novo ponto de import/detecção que precise casar cabeçalho de
arquivo com campo do schema deve usar (ou replicar) esta mesma função — nome
E rótulo, nunca só um dos dois.

## `csvTableDetect.ts` vs `csvControladoriaDetect.ts`

- `detectTable` (`csvTableDetect.ts`) avalia **todas** as colunas de
  **todas** as tabelas para decidir qual tabela o CSV substitui por completo
  (fluxo admin).
- `detectControladoriaTable` (`csvControladoriaDetect.ts`) só considera
  tabelas elegíveis (`isControllershipTable`) e só a chave de negócio + as
  colunas financeiras dela — colunas como nome/descrição/grupo nem entram na
  conta, porque este import nunca as toca.

Os dois arquivos são independentes de propósito (regras de detecção e de
segurança diferentes) — não tentar unificá-los.
