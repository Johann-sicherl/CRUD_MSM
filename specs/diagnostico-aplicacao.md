# Diagnóstico da Aplicação

Pop-up automático que varre a base procurando inconsistências que o
Administrador precisa saber de cara, sem abrir tela por tela. Pedido
explícito do usuário: "quero que faça uma rotina, sempre na primeira
abertura da aplicação, ou quando eu atualizo a aplicação, ele me dê um
follow up completo de como está tudo que eu preciso saber, através de um
pop-up... primeiro comece varrendo Cadastro de Equipamentos, analisando se
tem algo bloqueado no Protheus... e com STATUS igual active, sempre que
tiver bolinha vermelha tem que estar deactive."

## Quando aparece

- **Só Admin** — pedido explícito do usuário (não Gerente Adm Comercial,
  não Analista de Dados, mesmo que também conectem ao Protheus).
- **Só depois que o Protheus já conectou** (`AppDiagnosticsGate.tsx`, dentro
  de `ClientLayout.tsx`, escuta `useProtheusAuth().creds`) — reusa a
  credencial já fornecida no login do app (nunca pede uma segunda vez), e a
  checagem em si precisa dela mesmo.
- **Uma vez por build** — "primeira abertura da aplicação, ou quando eu
  atualizo a aplicação" foi implementado como: comparar o hash do commit
  atual (`NEXT_PUBLIC_APP_BUILD_SHA`, embutido no bundle do cliente por
  `next.config.js` via `execSync('git rev-parse --short HEAD')` em build
  time) contra o que está salvo em `localStorage['app-diagnostics-seen-build']`.
  Build nunca visto (ou primeiro acesso de sempre, sem nada salvo) → roda o
  diagnóstico e mostra o pop-up; mesmo build já visto → não mostra nada.
  **Decisão deliberada, confirmada com o usuário**: automático via hash do
  Git, não um número de versão manual — não exige nenhum passo extra a cada
  deploy, muda sozinho toda vez que alguém roda `npm run build` de novo em
  produção. Se o diagnóstico falhar (erro de rede/Protheus), o build **não**
  é marcado como visto — volta a tentar no próximo carregamento da página em
  que o Admin conectar, em vez de silenciar o erro até o próximo deploy.

## Arquitetura — pensada pra crescer

`src/lib/appDiagnostics.ts` (server-only, importado só pela rota) — um
array `CHECKS` de `{ key, tableLabel, run(creds) }`, cada um uma "seção" do
pop-up. `runAppDiagnostics(creds)` roda todas **em sequência** (não
`Promise.all` — uma falha isolada numa checagem vira uma seção com um
`issue` descrevendo o erro, em vez de derrubar o diagnóstico inteiro).
Adicionar uma checagem nova = só acrescentar uma entrada em `CHECKS`, sem
mexer no pop-up nem no gatilho — pedido explícito do usuário foi "primeiro
comece" por uma tabela, deixando claro que mais viriam depois.

- `POST /api/app-diagnostics/route.ts` — recebe `{ profileId, user,
  password }`, valida `profile.isAdmin` via `getProfileById` (nunca um
  `isAdmin` solto do corpo — ver `specs/permissoes-e-perfis.md`), roda
  `runAppDiagnostics` e devolve `{ sections }`. Caminho fixo, só `POST` (sem
  `GET` junto) — não corre o risco de 405 em build de produção documentado
  em `specs/telas-auxiliares.md` (esse bug era especificamente sobre GET +
  método mutante no mesmo caminho fixo).
- `AppDiagnosticsGate.tsx` — o gatilho (lógica de quando rodar, descrita
  acima). Renderizado dentro de `ClientLayout.tsx`, como filho de
  `PdmAuthProvider` — precisa ser descendente de `AppAuthProvider` (pra
  `isAdmin`) e `ProtheusAuthProvider` (pra `creds`), mesma regra de nesting
  de providers documentada em `specs/permissoes-e-perfis.md`.
- `AppDiagnosticsPopup.tsx` — a UI. Pedido explícito do usuário: "grande,
  tanto quanto os outros da aplicação" — mesmo `max-w-[95vw] max-h-[90vh]`
  de `ImportReviewModal`/`ControladoriaImportReviewModal`/
  `CostImportReviewModal`. "Cascateado por tabelas... um dropdown com o
  título desta aba, e quando eu expanda, ele me mostre os problemas, caso
  não tenha, que seja sem erros, caso tenha que esteja vermelho esmaecido o
  dropdown completo" — uma seção por `DiagnosticSection`, um accordion
  (chevron gira 90° ao expandir, mesmo padrão de `atualizador-global/page.tsx`);
  sem problemas → badge "sem erros", cabeçalho com cor neutra; com
  problemas → cabeçalho inteiro com fundo/borda/texto em tom de erro
  esmaecido (`border-error/30 bg-error-container/10`, texto do título em
  `text-error`), badge com a contagem.

## Checagem #1 — Cadastro de Equipamentos vs. status Protheus

`checkStandardEquipmentItemsStatus` (`appDiagnostics.ts`) — pra cada linha
de `standard_equipment_items` (Cadastro de Equipamentos), resolve o status
Protheus (`ATIVO`/`BLOQUEADO`, SB1010) via `protheus_code`, reusando
`listProductStatuses` (`protheusDb.ts`) — a mesma fonte que já alimenta a
"bolinha" verde/vermelha de `DataTable.tsx` (`getProtheusStatus`,
`schema.protheusStatusCheckField`), nenhuma query nova ao Protheus além da
que essa função já fazia. Regra, exatamente como pedida pelo usuário: se o
status no Protheus é `BLOQUEADO` (bolinha vermelha) **e** o campo `status`
interno (`standard_equipment_items.status`, opções `active`/`deactive`) diz
`active`, isso é um achado — o esperado é `status = deactive` sempre que
Protheus estiver `BLOQUEADO`. Não verifica a direção inversa (`ATIVO` no
Protheus com `status = deactive` aqui) — não foi pedido, e implementar sem
pedido seria inventar uma regra de negócio nova.

## O que NÃO faz parte disto

- Não é a mesma coisa que o "Comparar" removido do Atualizador Global (ver
  `specs/import-export.md`) — aquele comparava CSV recebido × banco de
  dados MSM antes de um import; este é uma varredura de consistência
  interna × Protheus ao vivo, sem CSV nenhum envolvido, disparada
  automaticamente no login, não manualmente numa tela de import.
- Não bloqueia nada — é só informativo. Fechar o pop-up não desfaz nem
  corrige nada; o Admin ainda precisa ir em Cadastro de Equipamentos e
  corrigir o `status` manualmente, linha por linha, se decidir que o
  achado é real.
