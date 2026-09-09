# Componentes de UI

## `RecordModal.tsx`

- Renderização de campo é 100% dirigida por `field.type` (ver
  `specs/dados-e-schema.md`) — nunca hardcoded por nome de campo, exceto os
  poucos pontos já documentados no próprio arquivo (`FORCE_TO_ONE_FIELDS`,
  `TARGET_COST_PENDING_FIELD`).
- `restrictToFields?: Set<string>` — quando presente, todo campo **fora**
  desse conjunto é renderizado desabilitado (fieldset disable), não
  escondido. Usado para perfis restritos (ex.: Gerente Adm Comercial editando
  só colunas de Controladoria/Fiscal/Precificação) — o usuário vê o registro
  inteiro, mas só pode alterar os campos liberados.
- `isBatch = !!schema.batchInsert && !isEdit` — modo "fila de import": em vez
  de um único registro, o modal itera múltiplas linhas vindas de
  `parseImportFile` (ver `specs/import-export.md`) uma a uma, sem fechar
  entre elas.
- Trata `FORCE_TO_ONE_FIELDS`/`TARGET_COST_PENDING_FIELD` como campos
  especiais na hora de montar o corpo da requisição (delega a lógica real
  para `localCostGuard`/`pendingTargetCostGuard` no servidor — o modal só
  precisa mandar o valor "aparente").

## `DataTable.tsx`

Tabela genérica dirigida por schema — colunas, filtros (`ColumnFilter`),
ordenação e o destaque amarelo de "campo mudou" (via `shouldCompareField`/
`valuesEqual` de `csvBaseline.ts`, ver `specs/csv-baseline-comparacao.md`)
são todos derivados do `TableSchema`, não hardcoded por tela.

## `ColumnFilter.tsx` — portal + zoom

Renderiza o dropdown de filtro num portal direto no `<body>`
(`createPortal`), para não ficar preso ao `overflow`/`z-index` do container
da tabela. Como o app aplica zoom via CSS `zoom` em `<html>` (não
`transform` — ver `ThemeZoomBar.tsx` abaixo), coordenadas de
`getBoundingClientRect()` vêm em espaço "visual" (já multiplicado pelo
zoom), mas o `top`/`left` de um elemento `position: fixed` **dentro** da
raiz zoomada são re-escalados de novo pelo zoom — por isso `getRootZoom()`
divide a posição calculada pelo fator de zoom atual antes de aplicar. Todo
componente novo que meça posição do DOM para posicionar algo em portal
precisa da mesma compensação.

Filtro de coluna tem toggle **aditivo vs. substituição** — selecionar um
valor novo adiciona ao filtro atual em vez de substituí-lo, replicando o
comportamento de filtro do Excel que o usuário já conhece.

## `BulkEditModal.tsx` vs `CostBulkEditModal.tsx`

Ver `specs/custeio-financeiro.md` — o primeiro é genérico por schema
(qualquer campo, uma tabela), o segundo é hardcoded para custo através de
múltiplas tabelas.

## `ThemeZoomBar.tsx`

- Zoom: CSS `zoom` (não `transform`) em `document.documentElement`, 50–150%
  em passos de 5%, persistido em `localStorage` como `app-zoom`. Aplicado
  também inline em `layout.tsx` (script síncrono no `<head>`) para evitar
  flash de zoom errado no primeiro paint.
- Tema: persistido em `localStorage` como `app-theme`, default `'luz'`
  (escolhido deliberadamente para performance em máquinas mais fracas — não
  trocar o default sem motivo).
- Tokens de cor via CSS custom properties (`tailwind.config.ts`):
  `primary`, `on-primary`, `primary-container`, `secondary`, `surface`,
  `surface-container-lowest` até `-highest`, `outline`, `outline-variant`,
  `background`, `error`, `error-container`, `on-error-container`, entre
  outros — sempre usar os tokens do tema, nunca cor fixa, para que os dois
  temas (e futuros) continuem funcionando.

## `idbStore.ts`

Wrapper fino de IndexedDB (`idbGet`/`idbSet`) — criado porque o quota de
`sessionStorage` (5–10MB) falhava silenciosamente (throw engolido) ao
guardar resultados grandes de consulta entre navegações. Usar `idbStore`
(não `sessionStorage`) para qualquer estado client-side que possa crescer
além de uma lista pequena.
