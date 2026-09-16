# Double-check de Queries

Tela `/duplo-check-queries`. Pedido explícito do usuário: testar se uma
instrução SQL exportada da Auditoria (DELETE/INSERT/UPDATE) vai dar erro no
banco oficial **antes** de rodá-la de verdade — sem nunca tocar nos dados
reais.

**Histórico — deixou de ser admin-only**: até uma sessão posterior, esta
tela era tratada como `/configuracao-usuarios` (admin-only, link hardcoded
na Sidebar fora de `MODULES`/`visibleModules`). Pedido explícito do usuário
ao criar o perfil "Analista de Dados" (ver `specs/permissoes-e-perfis.md`,
seção "Perfil somente leitura — dados CHECK"): virou módulo normal
(`duplo-check-queries`, grupo "Sistema" em `modules.ts`, logo abaixo de
"Desenvolvedor de Queries"), liberável por perfil como qualquer outro —
"o analista de dados também consegue carregar os csvs novos". Seguro
liberar sem exigir `isAdmin` porque esta tela **nunca** toca dado real, só
as cópias `_check` — mesmo critério de acesso nos dois lugares que
verificam permissão: `duplo-check-queries/page.tsx` (guard client-side) e
as rotas `global-update-check/[table]`/`query-double-check`
(`profile.isAdmin || profile.visibleModules.includes('duplo-check-queries')`,
sempre resolvido no servidor via `getProfileById` — nunca confia no client).

## Ideia geral

1. **Gravar o retrato de hoje** — sobe os mesmos CSVs oficiais que já se
   sobe no Atualizador Global, mas escrevendo numa cópia estrutural paralela
   de cada tabela (sufixo `_check`, ex. `accessories_check`), apagando e
   recriando (mesma substituição atômica de sempre).
2. **Simular** — sobe um ou mais `.txt` exportados da tela de Auditoria
   ("Exportar TXTs por tabela/ação") e roda cada instrução, em sequência
   (uma dependendo do efeito da anterior), contra essas cópias `_check`.
   Reporta linha por linha se rodou ok (e quantas linhas afetou) ou deu
   erro (UNIQUE, NOT NULL, CHECK, chave não encontrada etc. — **não FK**,
   ver "Tabelas _check sem foreign key entre si" abaixo) — e desfaz tudo no
   final, mesmo que nada tenha dado erro. Nada fica gravado, nunca.

## Escopo de tabelas — lista fechada, não "toda tabela com auditQueries"

`DOUBLE_CHECK_TABLES` (`src/lib/queryDoubleCheck.ts`) é uma lista explícita
e fechada de 9 tabelas, pedido explícito do usuário ("tabelas originais
apenas"): `accessories`, `accessory_groups`, `dependant_items`, `equipments`,
`general_alerts`, `non_combinable_comps`, `relationship_equip_accessory`,
`roller_tables`, `standard_equipment_items`. Não inclui, por exemplo,
`pending_target_cost`/`audit_log`/`user_profiles` — só as tabelas de
catálogo/regras que o Atualizador Global substitui.

## `msm_query_double_check.sql` — precisa rodar manualmente

Como todo `msm_*.sql` deste projeto (ver `specs/sql-migrations.md`), este
script **não roda sozinho** — precisa ser colado no SQL Editor do Supabase
uma vez, manualmente, pelo dono do projeto. Ele:

1. Cria as 9 tabelas `_check` via `CREATE TABLE ... (LIKE <tabela>
   INCLUDING ALL)` — copia tipos, defaults, NOT NULL, UNIQUE/PK, CHECK e
   índices (nunca foreign keys, ver seção abaixo).
2. Ativa RLS em todas as 9 (`ENABLE ROW LEVEL SECURITY`, zero políticas) —
   mesma estratégia de `msm_seguranca.sql`: só `supabaseAdmin` (service_role)
   opera.
3. Cria a função `run_query_double_check(p_statements TEXT[])`, com
   `REVOKE`/`GRANT` aplicado logo em seguida (padrão obrigatório para toda
   `SECURITY DEFINER` nova, ver `specs/sql-migrations.md`).

## Reescrita de nome de tabela — whitelist ancorada, sem parser SQL de verdade

Toda instrução simulada vem de um `.txt` gerado pela própria Auditoria
(`sqlAudit.ts`: `buildInsertSQL`/`buildUpdateSQL`/`buildDeleteSQL`), nunca
digitada à mão — então o nome da tabela sempre aparece logo depois de
`INSERT INTO`/`UPDATE`/`DELETE FROM`, no início da instrução. Isso torna
seguro reescrever só com uma regex ancorada
(`^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+"?(\w+)"?`, em
`rewriteStatementForCheck`, `src/lib/queryDoubleCheck.ts`) em vez de um
parser SQL de verdade — não seria seguro se o texto viesse de entrada livre
do usuário.

Uma instrução cuja tabela não está em `DOUBLE_CHECK_TABLES` não é enviada ao
banco — vira um resultado "recusado" já no backend (Next.js), localmente,
sem round-trip.

**Trava redundante, de propósito**: mesmo com a reescrita já feita no
Next.js, `run_query_double_check` confere de novo, dentro do Postgres, que
toda instrução recebida aponta para uma tabela terminando em `_check`
(`v_table NOT LIKE '%\_check' ESCAPE '\'`) e recusa (sem executar) qualquer
uma que não termine assim. Um bug na camada JS nunca consegue, sozinho,
fazer essa função tocar uma tabela real.

## Mecanismo de simulação/rollback — exceção deliberada carregando o resultado

`run_query_double_check` roda cada instrução dentro do seu próprio bloco
`BEGIN ... EXCEPTION WHEN OTHERS THEN ... END` (um SAVEPOINT implícito do
PL/pgSQL) — se uma falhar, só o efeito dela é desfeito; as instruções
anteriores continuam valendo para as próximas poderem testar em cima delas,
exatamente como uma sequência de INSERT/UPDATE/DELETE real se comportaria.

No final, a função **sempre** levanta uma exceção proposital
(`RAISE EXCEPTION 'DOUBLE_CHECK_RESULT' USING DETAIL = v_results::text`) —
é o único jeito de devolver o resultado (json por instrução: sql, ok,
rows_affected, error) **e** garantir que a transação inteira é desfeita,
mesmo se tudo tiver dado certo. O backend (`/api/query-double-check/route.ts`)
não trata essa exceção como falha de verdade: lê `error.message ===
'DOUBLE_CHECK_RESULT'` e faz `JSON.parse(error.details)` para recuperar o
resultado. Mesmo padrão já usado neste projeto para `global_table_replace`
(erro estruturado lido de `error.details`/`error.hint`/`error.code`).

## Nunca captura o custo real — sentinela sempre, sem exceção

`POST /api/global-update-check/[table]` (o import do passo 1) reaproveita
`convertCsvRows` (`globalUpdateConvert.ts`), que já força
`FORCE_TO_ONE_FIELDS` para o sentinela `1`/`0` sozinho — igual ao Atualizador
Global real. A diferença deliberada: esta rota **nunca** chama
`extractRealCosts`/`replaceTableCosts`. O valor real do CSV é simplesmente
descartado, não capturado em lugar nenhum — nem no arquivo local de custos
reais (`local-data/`). Pedido explícito do usuário: **"Não quero enxergar o
custo nestas queries, pode apenas ignorar no sentinela"** — esta tela só
precisa saber se as queries rodam, não precisa (e não deve) saber o custo de
verdade.

## Tabelas `_check` sem foreign key entre si — pedido explícito do usuário

Até uma sessão posterior, `msm_query_double_check.sql` recriava aqui o
mesmo grafo de FKs de `msm_foreign_keys.sql`, só que `_check → _check` —
pra a simulação (passo 2) também pegar erro de FK, igual pegaria no banco
oficial. Removido a pedido explícito do usuário, depois de um erro real ao
gravar `standard_equipment_items` em `_check` sozinho: `insert or update on
table "standard_equipment_items_check" violates foreign key constraint
"fk_sei_equipment_check" — Key (legacy_equipment_id)=(49) is not present in
table "equipments_check"`. Ele precisa poder gravar/analisar cada tabela
`_check` de forma independente, exatamente como ela está no CSV oficial
daquela tabela — sem que gravar uma dependa de outra tabela relacionada já
ter sido gravada em `_check` antes (ou ter a linha referenciada): "não
podemos ter isso, porque tenho que ver o banco de dados como ele está, o
relacionamento deve estar somente no banco de dados original (sem
_check)". Revertido com `msm_query_double_check_remove_fks.sql` (as 7
tabelas já existentes) — `msm_query_double_check.sql` também foi corrigido
pra não recriar essas FKs numa instalação nova.

**Consequência aceita conscientemente**: a simulação (passo 2) não pega
mais erro de FK — só UNIQUE/NOT NULL/CHECK/"linha não encontrada". Um
INSERT/UPDATE que violaria uma foreign key no banco oficial pode rodar sem
erro contra `_check` agora.

## Ordem de import em lote — não é mais necessária, mantida por previsibilidade

`DOUBLE_CHECK_TABLES` é só a whitelist, em ordem alfabética — **não** serve
para decidir em que ordem gravar as tabelas `_check`. **Histórico**: o
botão "Gravar N tabela(s) em _check" rodava os arquivos na ordem em que o
usuário os selecionou no seletor de arquivos do navegador; enquanto as
tabelas `_check` ainda tinham FK entre si (ver seção acima), gravar uma
tabela filha antes da tabela pai já causou erro real de FK. Corrigido na
época com `DOUBLE_CHECK_IMPORT_ORDER` (`src/lib/queryDoubleCheck.ts`) — uma
ordem topológica explícita (pais `accessory_groups`/`equipments` primeiro),
usada por `CsvSnapshotSection` (`duplo-check-queries/page.tsx`, `runAll`)
pra ordenar `readyFiles` antes do `for...of` sequencial.

Com as FKs removidas (seção acima), essa ordem **deixou de ser necessária**
pra evitar erro — cada tabela `_check` é gravada de forma independente
agora. `DOUBLE_CHECK_IMPORT_ORDER` foi mantida mesmo assim, só por
previsibilidade (pais antes de filhos é uma ordem de leitura mais natural
pra quem revisa o resultado do lote) — não por necessidade técnica.

## Reaproveitamento — nada de caminho de escrita paralelo para o import

`POST /api/global-update-check/[table]` chama a mesma RPC
`global_table_replace` já existente (`msm_global_table_replace.sql`), só
passando `target_table: '<tabela>_check'` em vez do nome real — sem
duplicar a lógica de substituição atômica. Permissão via `getProfileById`
(nunca um `isAdmin` do corpo, mesmo padrão do resto do app — ver
`specs/permissoes-e-perfis.md`).

## Arquivos

- `msm_query_double_check.sql` — migração manual (ver acima).
- `msm_query_double_check_remove_fks.sql` — migração manual, só pra quem já
  rodou a versão antiga de `msm_query_double_check.sql` (com FKs `_check →
  _check`) — remove as 7 constraints (ver "Tabelas _check sem foreign key
  entre si" acima).
- `src/lib/queryDoubleCheck.ts` — `DOUBLE_CHECK_TABLES`/`isDoubleCheckTable`,
  `rewriteStatementForCheck`, `parseSqlStatementsFromText` (um `.txt` da
  Auditoria é uma instrução por linha).
- `src/app/api/global-update-check/[table]/route.ts` — passo 1 (import CSV
  → `_check`).
- `src/app/api/query-double-check/route.ts` — passo 2 (simulação).
- `src/app/duplo-check-queries/page.tsx` — a tela: `CsvSnapshotSection`
  (passo 1) + `SimulateSection` (passo 2).
