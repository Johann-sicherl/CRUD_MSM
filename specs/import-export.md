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
  — usado pelo destaque amarelo de "campo mudou desde o último import" nas
  telas de Cadastro (`DataTable.tsx`, ver `specs/csv-baseline-comparacao.md`).

### Removido: comparação "CSV novo vs. banco atual" antes de substituir

A tela teve, por um tempo, um checkbox "Comparar valores recebidos com o
banco de dados atual antes de substituir" — buscava a tabela ao vivo no
banco de dados MSM, casava linha por linha pela chave de negócio
(`groupRowsByKey`/`getRowKey`, `csvBaseline.ts`) e mostrava um pop-up com
toda diferença (`changed`/`new`/`missing`/`ambiguous`) antes de liberar a
substituição real. **Removido a pedido explícito do usuário**: "quero
excluir esta função de Comparar o Banco de Dados recebido com o banco de
dados do supabase. Para isso dar problema pouco custa" — decisão de que o
custo de manter essa checagem (e a confusão de reportar sempre as mesmas
diferenças entre uma comparação e outra, sem nada ter mudado no meio) não
compensava o benefício.

Removidos por completo: `POST /api/global-update/[table]/compare/route.ts`
(rota inteira), e em `atualizador-global/page.tsx` — o checkbox, os estados
`compareChecked`/`comparing`/`compareAlerts`, `runCompare`, o componente
`ComparePopup`, e os tipos locais `CompareDiff`/`CompareAlert`. O botão
final voltou a ser sempre "Confirmar e Substituir Tudo", sem ramificação.

**O que NÃO foi removido**: `csvBaseline.ts` (`shouldCompareField`,
`valuesEqual`, `groupRowsByKey`, `getRowLabel` etc.) continua intacto — é
compartilhado com `DataTable.tsx` pro destaque amarelo de "campo mudou"
(ver `specs/csv-baseline-comparacao.md`), nunca foi exclusivo da
comparação removida. `formatDiffValue` (`csvBaseline.ts`) ficou sem
nenhum consumidor depois desta remoção — mantido mesmo assim, é uma
função pura pequena e documentada como parte da API do módulo; não vale a
pena reintroduzir o mesmo tipo de checagem depois só porque a função
existe.

### Risco real achado: `ON DELETE CASCADE` de `equipments` pode esvaziar tabelas fora do lote

Achado durante uma sessão de comparação real do usuário (primeira alteração
de produção testada contra o banco de dados MSM), na época em que a tela
ainda tinha o checkbox "Comparar" (ver seção "Removido" acima) — a
pergunta que expôs o risco: "preciso saber se as informações que estão
nos CSVs resultarão no meu Banco de Dados que existe hoje no Supabase"
(ou seja: os diffs de campo do "Comparar", sozinhos, não garantiam isso).
**Esta proteção continua valendo mesmo depois do "Comparar" ter sido
removido** — o risco de cascata nunca teve relação com aquele checkbox,
só compartilhava a mesma tela.

`msm_foreign_keys.sql` declara 5 FKs com `ON DELETE CASCADE` apontando pra
`equipments(legacy_id)`: `standard_equipment_items`,
`relationship_equip_accessory`, `non_combinable_comps`, `dependant_items`,
`roller_tables`. `global_table_replace` faz `DELETE FROM equipments WHERE
true` antes de recarregar — isso dispara a cascata **na hora**, apagando
todas as linhas dessas 5 tabelas que referenciam qualquer equipamento,
independente do que o lote atual contém. Duas consequências reais, sem
nenhuma proteção antes desta mudança:

1. Se `equipments` estiver no lote mas **alguma** das 5 dependentes não
   estiver, o conteúdo dessa tabela é apagado pela cascata e **nada o
   reinsere** — fica vazio até um import futuro dela.
2. Se `equipments` estiver no lote mas for processada **depois** de
   alguma das 5 dependentes (a ordem era só a ordem de upload dos
   arquivos, sem nenhuma lógica), a substituição dessa dependente já
   rodou antes da cascata apagar tudo de novo — o turno dela no lote já
   passou, e ela também fica vazia.

**Fix**: `EQUIPMENTS_CASCADE_DEPENDENT_TABLES` (`schema.ts`) — lista as 5
tabelas acima, mantida manualmente em sincronia com
`msm_foreign_keys.sql` (não há introspecção automática do banco neste
projeto). Em `atualizador-global/page.tsx` (`AtualizadorGlobalAdmin`):
- `cascadeMissingTables`/`cascadeBlocked` — só calculado quando
  `equipments` está de fato no lote (`readyFiles`); lista as dependentes
  que faltam. Bloqueia o botão "Confirmar e Substituir Tudo" e mostra um
  aviso vermelho explícito, com os nomes das tabelas faltando, acima do
  botão. Bloqueio replicado dentro de `runReplaceAll` (não só no
  `disabled` do botão) — defesa em profundidade.
- `cascadeSafeOrder` — quando `equipments` está no lote, ela sempre é
  processada **primeiro**, antes de qualquer outra tabela, independente
  da ordem de upload — garante que as 5 tabelas dependentes (que só podem
  estar no lote se todas estiverem presentes, pelo bloqueio acima) sejam
  substituídas depois da cascata de `equipments` já ter acontecido, e não
  antes.

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
