# Comparação de baseline CSV

## `src/lib/csvBaseline.ts`

Usado pelo destaque amarelo de "campo mudou" nas telas de Cadastro
(`DataTable`) — decide "esse campo mudou desde o último import?" de forma
consistente entre todas as tabelas.

**Histórico**: até uma sessão posterior, este módulo também era usado pela
janela "Comparar valores recebidos com o banco de dados atual" do
Atualizador Global (`POST /api/global-update/[table]/compare`) — comparava
o CSV a ser importado contra o banco de dados MSM ao vivo antes de liberar
a substituição. Essa janela foi **removida a pedido explícito do
usuário** ("quero excluir esta função de Comparar... para isso dar
problema pouco custa" — ver `specs/import-export.md`). `csvBaseline.ts`
em si não foi tocado — continua com o mesmo papel de sempre pro destaque
amarelo, que nunca dependeu da janela removida.

- `shouldCompareField(field)` — decide se um campo entra na comparação.
  Exclui: campos que não são coluna real (`isRealColumnField`), PK, tipo
  `password`, e metadados de bookkeeping (`created_at`/`updated_at`/
  `last_login` e afins — mudam sozinhos a cada gravação, não são
  "informação"). `id` (uuid) nunca é comparado — é regenerado a cada import
  CSV, então nunca é igual entre banco e baseline mesmo quando a linha é
  exatamente a mesma; é `getRowKey` (não o `id`) quem de fato casa as
  linhas.
- `valuesEqual(field, a, b)` / `formatDiffValue(field, v)` — comparação e
  formatação tolerantes ao tipo do campo (decimal vs texto vs boolean etc.).
- `getRowKey(schema, row)` — chave de negócio usada para casar uma linha do
  banco com a linha equivalente do CSV/baseline (ver
  `specs/dados-e-schema.md`).
- `getRowLabel(schema, row)` — label legível de uma linha para exibir num
  alerta/diff.
- `groupRowsByKey(schema, rows)` → `KeyedRows` — agrupa linhas por chave,
  incluindo um bucket de **chaves ambíguas** (`ambiguousKeys`) quando mais de
  uma linha do CSV cai na mesma chave de negócio — tratado como "sem
  veredito automático", exige revisão manual em vez de escolher uma linha
  arbitrariamente.
- `costBucketFor(tableName)` / `getCostItemKey` / `SHARED_ITEM_COST_TABLES` —
  agrupamento de custo compartilhado entre `accessories`,
  `standard_equipment_items` e `dependant_items` (ver nota em
  `specs/dados-e-schema.md` sobre esta lista ser diferente da lista de
  `isControllershipTable`).

## `msm_csv_baseline_snapshots.sql`

Guarda o retrato exato de cada tabela no momento do último import feito pelo
Atualizador Global — usado pelo destaque amarelo de "campo mudou desde o
último import" nas telas de Cadastro e para permitir auditoria histórica de
quando/o que mudou no último import. Ver o cabeçalho do próprio arquivo SQL
para o propósito completo.
