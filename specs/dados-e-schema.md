# Dados e schema

## `src/lib/schema.ts` é a fonte única de verdade

`RecordModal`, `DataTable`, import/export (todos os três mecanismos, ver
`specs/import-export.md`) e a geração de auditoria (`specs/auditoria.md`) são
todos guiados pelo array `tables` e pelos tipos `TableSchema`/`Field`. Uma
tabela nova ou uma coluna nova no banco só existe para o app depois de
entrar aqui — não há introspecção automática do banco.

Campos relevantes de `Field` (não exaustivo — ver o arquivo para a lista
completa):
- `type: FieldType` — dirige a renderização em `RecordModal` (texto, number,
  decimal, boolean, textarea, jsonb, password, lookup, etc.).
- `isPk`, `isReadonly`, `nullable`, `defaultValue`, `unique`, `autoIncrement`.
- `validateExistsIn` — valida (e resolve por nome OU chave) uma referência a
  outra tabela antes do INSERT (ver `/api/[table]/route.ts`).
- `hideInList`, `hideInForm`, `showInList`, `excludeFromExport`, `virtual`,
  `concatFrom`, `lookupFrom`, `listFilterType`.
- `domain: 'catalogo' | 'regras'` — usado por `modules.ts` para agrupar a
  Sidebar automaticamente (`DOMAIN_LABELS`).
- `doubleInsert` (na `TableSchema`) — usado só por `non_combinable_comps`:
  resolve grupos a partir de `accessories` e insere a linha "de ida" e a
  "de volta" (ver `/api/[table]/route.ts`).
- `auditQueries` (na `TableSchema`) — liga a geração de SQL de auditoria para
  a tabela.

`isRealColumnField(field)` distingue campos que têm coluna de verdade no
banco de campos virtuais (lookup/concat/countDuplicatesOf) — usado sempre que
algo monta um INSERT/UPDATE real ou decide se um campo entra numa comparação
de diff (ver `shouldCompareField` em `csvBaseline.ts`, `specs/csv-baseline-comparacao.md`).

## `isControllershipTable` / `getControllershipPendingFields`

```ts
export function getControllershipPendingFields(schema: TableSchema): Field[] {
  return schema.fields.filter(f => FORCE_TO_ONE_FIELDS.includes(f.name) && !f.hideInList)
}
export function isControllershipTable(schema: TableSchema): boolean {
  return getControllershipPendingFields(schema).length > 0
}
```

Esta é a **única fonte de verdade** sobre quais tabelas/campos pertencem à
Controladoria/Fiscal/Precificação (hoje: `equipments`, `standard_equipment_items`,
`accessories`). Usada por:
- Auditoria de Queries (o que o perfil Gerente Adm Comercial pode ver/editar).
- Atualizador Global — tanto para decidir quais tabelas aceitam o import
  restrito de Controladoria quanto para detectar o arquivo (`csvControladoriaDetect.ts`).
- `userProfileStore.ts` (seed de perfis novos).

**Histórico**: existia antes uma lista hardcoded de 4 tabelas em
`userProfileStore.ts` que incluía `dependant_items` — ficou desatualizada
porque o `cost_std` de `dependant_items` foi desativado como sinal de
controladoria (o custo real do código já vem consolidado de `accessories`/
`standard_equipment_items`, então fica sempre em 0 sem significar "pendente").
Corrigido substituindo a lista hardcoded por esta função derivada do schema.
**Nunca reintroduzir uma lista hardcoded equivalente em outro arquivo.**

## Business-key row identity

Nunca casar uma linha entre sistemas/imports pelo `id` interno (uuid) — ele é
regenerado a cada import CSV do Atualizador Global e não é estável entre
"banco atual" e "CSV novo". Sempre usar a chave de negócio:
- `getAuditKeyFields(schema)` (`sqlAudit.ts`) — geralmente `protheus_code`,
  ou `legacy_id`/equivalente para tabelas sem código Protheus.
- `getRowKey(schema, row)` (`csvBaseline.ts`) — chave string usada para casar
  linha do baseline com linha do banco.
- `groupRowsByKey`/`getCostItemKey` (`csvBaseline.ts`) — agrupamento por
  chave para comparação em lote.

Comparação de `protheus_code` (e de qualquer chave de texto) é sempre
normalizada com `.trim().toUpperCase()` nos dois lados antes de comparar —
inconsistência de caixa/espaço entre o CSV oficial e o banco já causou pelo
menos dois bugs reais nesta base (dashboard "Em Custeio" e Custos Gerais VMI
"Somente Novos", ver `specs/custeio-financeiro.md`).

## Armadilha do `.in()` do Postgres/PostgREST

`.in('protheus_code', arrayGrande)` faz correspondência exata no banco —
sensível a caixa e espaço. Quando a comparação precisa ser normalizada
(quase sempre que envolve `protheus_code`), o padrão estabelecido é: buscar a
coluna crua com `.select()` e comparar em JS com `.trim().toUpperCase()`, em
vez de confiar no `.in()` do Postgres.

## `SHARED_ITEM_COST_TABLES`

`csvBaseline.ts` define `SHARED_ITEM_COST_TABLES = new Set(['accessories',
'standard_equipment_items', 'dependant_items'])` — usado por `costBucketFor`
para agrupar essas três tabelas num único "balde" de custo ao comparar
custos capturados localmente (`specs/custeio-financeiro.md`). Note que isto é
uma lista diferente (e mais ampla) da lista de `isControllershipTable` —
aqui `dependant_items` **continua** incluído, porque o agrupamento de custo
compartilhado é um conceito diferente de "campo pendente de controladoria".
Não confundir as duas listas.
