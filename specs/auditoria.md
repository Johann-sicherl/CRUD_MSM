# Auditoria de queries

## Propósito

Toda tabela com `auditQueries: true` no schema gera, a cada INSERT/UPDATE/
DELETE feito pelo app, uma linha na tabela `audit_log`
(`msm_audit_log.sql`) contendo a query SQL equivalente para aplicar
manualmente no banco oficial (Protheus/externo) — o app nunca escreve
direto nesse banco oficial, só gera a instrução para alguém rodar.

## `src/lib/sqlAudit.ts`

- `sqlLiteral(field, value)` — serializa um valor para literal SQL de acordo
  com o tipo do campo.
- `buildInsertSQL` / `buildUpdateSQL` / `buildDeleteSQL` — montam o texto SQL
  guardado em `audit_log`.
- `getAuditKeyFields(schema)` — campos que identificam a linha de negócio
  (ver `specs/dados-e-schema.md`).
- `keyValueString(keyFields, row)` — para tabelas com **mais de uma** chave
  de negócio, as chaves são **unidas por pipe** (`|`) para formar
  `record_key_value`. Bug já corrigido: `record_key_value` não estava sendo
  pipe-joined corretamente para tabelas de duas chaves, o que quebrava a
  exibição na tela de Auditoria. Qualquer novo ponto que monte
  `record_key_value` manualmente deve reusar `keyValueString`, nunca
  concatenar à mão.
- `diffChangedFields` — decide quais campos de um UPDATE de fato mudaram
  (usa `shouldCompareField`/`valuesEqual`, mesma lógica de comparação de
  `csvBaseline.ts` — ver `specs/csv-baseline-comparacao.md`), para o SQL de
  auditoria de UPDATE só listar as colunas que realmente mudaram.
- `recordInsertAudit` / `recordUpdateAudit` / `recordDeleteAudit` /
  `recordReplaceAudit` — gravam a linha em `audit_log`. `recordReplaceAudit`
  é usado pela tela "Substituir revisão" (`/api/replace-protheus-code`, ver
  `msm_replace_protheus_code.sql`) — foi adicionado depois de descobrir que
  essa operação bypassava a Auditoria inteiramente.

## Convenção: auditoria é best-effort

Toda chamada às funções `record*Audit` é envolta em `try { } catch { /*
best-effort */ }` nas rotas que as chamam (`/api/[table]/route.ts` e
equivalentes) — uma falha ao gravar o log de auditoria **nunca** deve
impedir ou revert a operação real no Supabase. Essa convenção nunca esteve
escrita antes desta reestruturação; qualquer rota nova que grave
auditoria deve seguir o mesmo padrão.

## `updated_at` não entra no SQL gerado

Por convenção do app inteiro, `created_at`/`updated_at` (e campos
equivalentes de bookkeeping, como `last_login`) não aparecem no SQL de
auditoria gerado — eles mudam sozinhos a cada gravação e não são
"informação" que o banco oficial precisa replicar. Isso foi uma
inconsistência real já corrigida (o replace de revisão vazava `updated_at`
no SQL gerado, diferente do resto do app) — manter a paridade se qualquer
novo caminho de auditoria for adicionado.

## Vínculo com a fila de custo alvo pendente

A visibilidade de uma linha de Auditoria (INSERT) para o perfil Gerente Adm
Comercial está amarrada à fila `pending_target_cost` — ver
`specs/custeio-financeiro.md` para o fluxo completo de
`syncPendingTargetCostOnWrite`.
