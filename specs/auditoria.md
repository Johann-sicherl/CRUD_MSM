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

## `GET /api/audit-log` precisa de `.range()` explícito — cap de 1000 do PostgREST

Bug real já corrigido: a rota (`src/app/api/audit-log/route.ts`) buscava
`audit_log` sem `.range()`/`.limit()` — sujeita ao cap padrão de 1000 linhas
do PostgREST (mesma armadilha de `specs/dados-e-schema.md`). O cap é sobre o
**total** da tabela, não por tabela/status filtrado — então uma pendência
antiga ficava fora das 1000 linhas mais recentes (`order('created_at',
{ascending: false})`) sempre que o total de `audit_log` passava de 1000, e
sumia de qualquer fetch sem filtro (ou com filtro amplo o bastante pra ainda
passar de 1000). A tela `auditoria/page.tsx` não tem paginação nenhuma — ela
assume que recebeu a tabela inteira, então tanto a lista quanto "Exportar
TXTs por tabela/ação" (que exporta exatamente `visibleRows`, o mesmo state
da lista) ficavam sem essa linha. Sintoma relatado: uma linha pendente
(`INSERT INTO accessory_groups ...`) aparecia normalmente na tela quando
filtrada por status "Pendente" (poucas linhas, dentro do cap), mas não saía
no `.txt` exportado. Corrigido com `.range(0, 24999)`, mesmo padrão já usado
em `global-update/[table]/compare/route.ts` e `clone-architecture/route.ts`.

## "Exportar TXTs por tabela/ação" precisa de pausa entre downloads — limite do navegador

Bug real já corrigido, achado logo depois do fix do `.range()` acima:
`runTxtExport` (`auditoria/page.tsx`) dispara um download (`<a>.click()`) por
grupo (tabela, ação), num loop. Disparar mais de ~10 downloads automáticos
em sequência, sem pausa nenhuma entre eles, faz o Chrome (e a maioria dos
navegadores) bloquear silenciosamente os downloads seguintes — sem erro
nenhum no JS, o arquivo simplesmente nunca aparece na pasta de Downloads.
Sintoma relatado: um export de 14 grupos (tabela, ação) só entregava os
primeiros ~10 — sempre faltavam os mesmos grupos (os que vinham depois na
ordem de `created_at desc` usada pela query). Corrigido com uma pausa de
400ms entre cada download (`sleep`/`setTimeout`, `runTxtExport` agora
`async`) — não é estético, é o workaround padrão pra esse limite do
navegador.

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
`syncPendingTargetCostOnWrite`. Consequência direta, **não é bug**: uma
tabela sem checkbox de custo alvo (ex.: Grupo de Equipamentos) nunca mostra
uma linha de INSERT para esse perfil — a UI dela não gera pendência de custo
alvo, então não há gatilho de visibilidade.

## "Exportar TXTs por tabela/ação" — recorte "Somente Engenharia"

Botão só pro Admin (perfil restrito já enxerga só a própria fatia e exporta
direto, sem escolher recorte). Ao clicar, oferece duas opções:
- **Completa** — todas as queries visíveis agora, sem separar por perfil.
- **Somente Engenharia** — exclui as linhas que são "da Comercial"
  (`isRelevantToAnyRestrictedProfile`, `auditoria/page.tsx`), pra ela
  exportar essas separadamente pela própria tela dela.

Critério de "é da Comercial" (não é uma regra só de nome de tabela — ver
`specs/dados-e-schema.md`/`SHARED_ITEM_COST_TABLES` pra não confundir com
outra lista parecida):
- **DELETE**: nunca é dela — exclusão fica restrita a quem tem acesso
  total, então sempre entra no export da Engenharia.
- **INSERT**: só é dela se o código estiver na fila `pending_target_cost`
  (`pendingCodes`, buscado sem filtro de status — `/api/pending-target-cost`
  devolve tudo).
- **UPDATE**: só é dela se (a) o campo alterado estiver em
  `editableFieldsByTable` do perfil pra aquela tabela **E**, nas tabelas com
  fila de custo alvo (`accessories`/`standard_equipment_items`,
  `usesTargetCostPending`), (b) o código **ainda estiver na fila agora**
  (`pendingCodes`, status `'novo'` OU `'em_alteracao'` — as duas contam
  igual: são fases do mesmo fluxo, não dois conceitos diferentes). Fora da
  fila, mesmo sendo um campo que ela pode editar (ex.: `cost_std` alterado
  direto pela Engenharia, sem passar pelo checkbox de pendência), a query
  conta como da Engenharia. Pedido explícito do usuário: "eu consigo
  imputar o custo e alterar por conta própria" — ela só precisa das que
  ainda estão na fila; o resto é a Engenharia quem exporta e roda.
- Tabelas de Controladoria **sem** fila de custo alvo (ex.: `equipments`/
  Grupo de Equipamentos) não entram nessa checagem extra — lá o critério
  continua sendo só o campo alterado, sem noção de "fila" nenhuma (ver
  `specs/custeio-financeiro.md`, "Grupo de Equipamentos pendente" ≠ fila de
  custo alvo).

**Cuidado ao mexer aqui**: `isRelevantForRestrictedProfile` (a função base)
é reusada sem alteração pra montar a própria tela do perfil restrito
(`visibleRows`, quando `!appUser.isAdmin`) — ela **tem** que continuar
mostrando todas as edições que a Comercial fez, mesmo em código fora da
fila. O gate extra de "está na fila agora" só é aplicado dentro de
`isRelevantToAnyRestrictedProfile`, usada exclusivamente pro recorte
"Somente Engenharia" — nunca extrair essa checagem pra dentro da função
base, ou a própria Comercial para de ver o que ela mesma editou.

## Alterações manuais via SQL Editor nunca entram na auditoria

Rodar uma query direto no SQL Editor do Supabase, fora do app, não passa
por `record*Audit` — não fica rastro nenhum em `audit_log`. Só escrita feita
através de uma rota do app gera auditoria. Ver também
`specs/pdm-protheus-integracao.md` (mesma observação, no contexto de
correções pontuais de código/revisão feitas fora do app).

## `auditNullAsText` — campo opcional em branco não pode virar `NULL` no SQL de auditoria

Alguns campos precisam que o SQL gerado para o banco oficial nunca grave
`NULL` num campo opcional deixado em branco — pedido explícito do usuário
para Cadastro de Equipamentos: "os campos que eu não preencher... não podem
ser inseridos no Banco de Dados com NULL mas sim N/A." Implementado como
flag **opt-in no schema** (não hardcoded por tabela), para poder estender a
outras tabelas sob pedido, sem duplicar lógica:

```ts
auditNullAsText?: string  // ex.: 'N/A' em equipments
```

`sqlLiteralForAudit` (`sqlAudit.ts`) troca o literal `NULL` por esse valor
**só para campos `type: 'text'` em branco**, e só no SQL de INSERT/UPDATE
gerado (nunca na cláusula WHERE de chave). **O registro real dentro do
Supabase continua guardando `NULL` normalmente** — isto muda apenas o texto
do SQL que a Auditoria produz para outra pessoa rodar no banco oficial, não
o dado que o app grava.
