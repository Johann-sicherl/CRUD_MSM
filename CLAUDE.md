# CRUD_MSM ("Monte Sua Máquina" / VMI Security)

Next.js 14 (App Router) + TypeScript + Supabase, ferramenta administrativa interna.

## Stack e comandos

- Next.js 14.2, React 18, TypeScript (strict), Tailwind, Supabase (`@supabase/supabase-js`), `mssql` (Protheus/PDM), `xlsx` (SheetJS).
- `npm run dev` — desenvolvimento. `npm run build` — build de produção. `npm run serve` — build + start. `npm run lint` — ESLint.
- **Não há suite de testes automatizados** (`package.json` não tem script `test`). Antes de qualquer commit: `npx tsc --noEmit` e `npm run build` — ambos precisam terminar limpos.
- Path alias `@/*` → `./src/*`.
- Variáveis de ambiente obrigatórias (`.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

## Convenções universais

- `src/lib/schema.ts` é a fonte única de verdade: `RecordModal`, `DataTable`, import/export e geração de auditoria são todos guiados por ele. Nova coluna/tabela = editar o schema primeiro.
- Toda leitura/escrita real passa por rotas `/api/...` usando `supabaseAdmin` (chave secreta, ignora RLS). O cliente `supabase` (chave publicável) não tem permissão nenhuma — RLS está ligado com zero políticas de propósito.
- Nunca casar linha entre sistemas/imports pelo `id` interno (uuid) — sempre pela chave de negócio (`protheus_code`, `legacy_id` etc., ver `getAuditKeyFields`/`getRowKey`). Comparação de `protheus_code` sempre normalizada com `.trim().toUpperCase()` nos dois lados.
- Filtro exato do Postgres (`.in('col', array)`) é sensível a caixa/espaço — para colunas que precisam de normalização, busque a coluna crua e compare em JS, nunca no `.in()`.
- Escritas financeiras em massa são sequenciais de propósito (não `Promise.all`) — previsibilidade e erro isolado por linha importam mais que velocidade.
- Auditoria (`recordInsertAudit`/`recordUpdateAudit`/`recordDeleteAudit`/`recordReplaceAudit`) é sempre best-effort: chamada dentro de `try/catch` que nunca bloqueia a operação real.
- Listagens grandes: PostgREST tem cap padrão de 1000 linhas — use `.range()`/`limit` explícito quando precisar de mais.
- Comentários só quando o "porquê" não é óbvio (armadilha, decisão que já foi tentada de outro jeito e falhou). Nunca comentário de "o quê".
- Commits: mensagem em português explicando o porquê, nunca `--amend`, sempre `git push -u origin claude/crud-msm-audit-tccz64`. Rodapé de atribuição do ambiente de sessão vai no fim de todo commit/PR (ver instruções de sistema da sessão).

## Regras invioláveis

- **Custos reais nunca vão para o Supabase.** Os 10 campos de `FORCE_TO_ONE_FIELDS` são sempre gravados como `1` (sentinela) ou `0`/vazio — o valor real fica só em `local-data/` (gitignored, nunca sobe pro Git). Ver `specs/custeio-financeiro.md` antes de tocar em qualquer fluxo de custo.
- **Não existe sessão de servidor.** Login é escolha de perfil client-side (`sessionStorage`). Qualquer checagem de permissão no servidor deve usar `getProfileById(profileId)` — nunca confiar em um `isAdmin` enviado pelo cliente.
- **Três mecanismos de import são distintos e não devem ser confundidos**: substituição total (admin, CSV-only), atualização restrita de Controladoria/Fiscal/Precificação (CSV/XLSX, só UPDATE), e fila de insert por tela (Importar Excel). Ver `specs/import-export.md`.
- **`isControllershipTable`/`getControllershipPendingFields`** (schema.ts) são a única fonte de verdade sobre quais tabelas/campos são de Controladoria/Fiscal/Precificação — nunca reintroduzir lista hardcoded em outro arquivo.
- Função Postgres `SECURITY DEFINER` nova = sempre `REVOKE EXECUTE ... FROM PUBLIC/anon/authenticated` + `GRANT EXECUTE ... TO service_role` logo em seguida.
- Zoom da UI é feito com `zoom` CSS em `document.documentElement`, não `transform`. Qualquer componente que meça posição do DOM para posicionar portal precisa dividir pelo fator de zoom (`getRootZoom()` em `ColumnFilter.tsx`).
- Arquivos `msm_*.sql` na raiz são scripts manuais (rodados uma vez no SQL Editor do Supabase) — este projeto não tem migration runner.

## Índice de specs

- Ao trabalhar em schema, tabelas ou campos novos: leia @specs/dados-e-schema.md
- Ao trabalhar em custo, preço, campos financeiros ou custo alvo pendente: leia @specs/custeio-financeiro.md
- Ao trabalhar em login, perfis, permissões ou visibilidade de módulo: leia @specs/permissoes-e-perfis.md
- Ao trabalhar em importação/exportação de CSV/Excel: leia @specs/import-export.md
- Ao trabalhar em auditoria de queries: leia @specs/auditoria.md
- Ao trabalhar em integração PDM/Protheus: leia @specs/pdm-protheus-integracao.md
- Ao trabalhar em comparação de baseline CSV: leia @specs/csv-baseline-comparacao.md
- Ao trabalhar em explorador de relações, clonagem estrutural, análise de estruturas, busca de acessórios, depurador Solic. Comercial ou classificação de equipamentos: leia @specs/telas-auxiliares.md
- Ao trabalhar em RecordModal, DataTable, filtros de coluna, modais de edição em massa, tema/zoom: leia @specs/ui-componentes.md
- Ao trabalhar em scripts SQL da raiz: leia @specs/sql-migrations.md

# Compact instructions

Num /compact, preserve:
- Qualquer regra de negócio ou decisão arquitetural mencionada nesta sessão que ainda não esteja em specs/*.md.
- O estado exato de tarefas em andamento (arquivos editados, testes pendentes, o que falta).
- Erros já diagnosticados nesta sessão e sua causa raiz (para não re-investigar do zero).
- Convenção de commit e o nome exato da branch (`claude/crud-msm-audit-tccz64`).
