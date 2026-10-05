# Integração PDM / Protheus

## Conexões `mssql`

`pdmDb.ts`/`pdmProperties.ts` conectam via `mssql` (SQL Server) a dois
sistemas externos: o Vault/PDM (Autodesk) e o Protheus. `CONNECTION_BASE`
em `pdmDb.ts` define timeout/opções compartilhadas; cada chamada abre um
`sql.ConnectionPool` com credenciais (`PdmCredentials`) fornecidas pelo
usuário na tela (não fixas em variável de ambiente).

Funções principais:
- `fetchPdmAccessories(creds)` — lista de acessórios do PDM.
- `fetchPdmComponentProperties(creds, documentId)` — propriedades de um
  componente específico.

Convenção de credenciais: `PdmCredentials` é sempre fornecida pelo usuário na
tela e passada por requisição — nunca persistida no servidor (nem em
variável de ambiente, nem em sessão). Cada chamada abre e fecha seu próprio
`sql.ConnectionPool`. Mesmo padrão replicado de `protheusDb.ts` (a conexão
Protheus já existente antes desta integração).

## Credenciais locais — botão "Entrar com Dados Locais" nos pop-ups de Protheus/PDM

Pedido explícito do usuário: "É possível puxar do ambiente local o usuário
de acesso ao banco de dados do prothues e do PDM? Se sim, crie um arquivo
.txt unico onde eu vou colocar estes acessos ao R2, usuario e senho PDM e
Prothues... mas que tenha um botão de 'Logar com Dados Locais' aí já entra
no Protheues eu no PDM ao clicar nestes botões." Resposta à primeira
pergunta: não há nenhum "usuário do ambiente local" que o app possa ler
sozinho (não existe sessão de SO nem variável de ambiente já populada com
login do Protheus/PDM) — a solução é um arquivo próprio, preenchido à mão
uma vez, nesta máquina.

- **`local-data/local-access.txt`** (gitignored, nunca sobe pro Git — mesma
  pasta/convenção de `local-data/real-costs.json`, ver
  `specs/custeio-financeiro.md`) — um arquivo `CHAVE=valor` por linha
  (`#` para comentário), com `PROTHEUS_USER`/`PROTHEUS_PASSWORD`,
  `PDM_USER`/`PDM_PASSWORD`, e as chaves `R2_*` (ver
  `specs/imagens-r2.md`, seção "Fallback pra `local-data/local-access.txt`")
  — um único arquivo pra todas as credenciais desta máquina, como pedido.
- **`local-access.example.txt`** (raiz do repo, committed) — template
  comentado, mesmo padrão de `.env.local.example` → `.env.local`. Instrui a
  copiar para `local-data/local-access.txt` e preencher.
- **`src/lib/localCredentials.ts`** (server-only) — `readLocalAccess()` lê e
  faz parse do arquivo (tenta/`catch` devolvendo `{}` se o arquivo não
  existir ainda — mesmo padrão de tolerância de `localCostStore.ts`), sem
  nenhum cache em memória: relê do disco a cada chamada, porque o arquivo
  pode ser editado à mão entre uma tentativa de login e outra.
  `getLocalProtheusCreds()`/`getLocalPdmCreds()` devolvem `{ user, password
  }` ou `null` se as duas chaves correspondentes não estiverem preenchidas;
  `getLocalValue(key)` é o acesso genérico (usado por `r2Images.ts`).
- **`GET /api/protheus-local-credentials`** / **`GET /api/pdm-local-credentials`**
  (novas rotas) — devolvem `{ user, password }` lidos do arquivo local, ou
  404 com uma mensagem explicando como criar o arquivo. Mesmo nível de
  exposição das rotas de teste de conexão já existentes — não exigem
  `profileId`/checagem de admin, porque só devolvem o que já está num
  arquivo local *desta mesma máquina*, nunca um segredo vindo de outro
  lugar ou de outro usuário.
- **Botão "📁 Entrar com Dados Locais"** — adicionado em `ProtheusLoginModal`
  (`protheusAuthContext.tsx`) e `PdmLoginModal` (`pdmAuthContext.tsx`), ao
  lado dos botões "Agora não"/"Conectar" já existentes. Ao clicar: busca a
  rota local correspondente, preenche os campos Usuário/Senha do próprio
  formulário com o que veio do arquivo, e chama o **mesmo** `testAndConnect`
  que o submit manual já usava (extraído do corpo de `handleSubmit` pra ser
  reusado) — ou seja, a credencial do arquivo local passa pelo **mesmo**
  teste real contra o banco (`/api/protheus-test-connection`/
  `/api/pdm-test-connection`, `SELECT 1`) antes de marcar como conectado,
  nunca pula essa checagem. Pedido explícito do usuário foi só um jeito
  mais rápido de logar sem digitar — nunca um caminho que contorne a
  verificação "senha errada não pode conectar" já corrigida (ver seção
  abaixo). Os pop-ups continuam exatamente como eram antes (campos, texto,
  botões "Agora não"/"Conectar") — só o botão novo foi adicionado, nada
  removido/alterado no fluxo manual existente.

**Risco encontrado e corrigido antes de considerar a tarefa concluída**:
as duas rotas novas (`GET` sem nenhum parâmetro, sem tocar
`request.url`/cookies/headers) seriam classificadas pelo Next como
estáticas e pré-renderizadas em `next build` — a resposta ficaria
congelada pra sempre no que `local-access.txt` continha **no momento do
build**, nunca relendo o arquivo depois disso em produção (confirmado:
`npm run build` sem a correção listava as duas como `○`, não `ƒ`). Mesma
categoria de risco (rota de caminho fixo sem opt-out explícito do cache
estático) já documentada em `specs/telas-auxiliares.md`, só que lá o
gatilho era GET+método mutante causando 405 — aqui o gatilho é um GET cujo
resultado depende de um arquivo que muda em runtime. Corrigido com
`export const dynamic = 'force-dynamic'` + `export const fetchCache =
'force-no-store'` nas duas rotas — confirmado depois com `npm run build`
mostrando `ƒ /api/protheus-local-credentials` e `ƒ /api/pdm-local-credentials`.

## Bug real já corrigido: login "conectava" mesmo com senha errada

Pedido explícito do usuário: "quando eu faço o login dos bancos de dados,
quero que você faça uma verificação se está conectado realmente, porque
teve vez que eu errei a senha e passou, deu a flag verde do canto esquerdo
inferior como se tivesse dado certo." Causa: `connect()` em
`protheusAuthContext.tsx`/`pdmAuthContext.tsx` só gravava o texto digitado
em `creds` (estado React) e fechava o modal — nunca testava a credencial
contra o banco de verdade, então qualquer usuário/senha "conectava" com
sucesso, mesmo errados.

Corrigido com uma checagem real antes de marcar como conectado:
- `testProtheusConnection`/`testPdmConnection` (`protheusDb.ts`/`pdmDb.ts`)
  — abrem um `sql.ConnectionPool` com a credencial informada, rodam
  `SELECT 1` (não faz nenhum trabalho de verdade, só confirma que o login
  autentica) e fecham a conexão no `finally`. Lançam o erro do driver
  (ex.: "Login failed for user '...'") se a autenticação falhar.
- `POST /api/protheus-test-connection` / `POST /api/pdm-test-connection`
  (novas rotas) — chamam essas funções e devolvem `{ ok: true }` ou
  `{ error }` com status 401.
- `ProtheusLoginModal`/`PdmLoginModal` — o submit agora é assíncrono:
  chama a rota de teste primeiro (`testing` = "Conectando…" no botão,
  desabilita o form) e só chama `onConnect(user, password)` (o que de fato
  marca como conectado, acende a flag verde) se a rota devolver `ok`. Se
  falhar, mostra a mensagem de erro do driver dentro do próprio modal e
  mantém ele aberto pra tentar de novo — nunca mais fecha/marca conectado
  silenciosamente com credencial errada.

## Bug real já corrigido: pedia pra reconectar de novo no meio da sessão

Pedido explícito do usuário: "me pediu para Conectar ao Banco de Dados do
Protheus e do PDM quando eu abri a aplicação, quando recalculei e quando
eu cliquei na janela de consulta ao banco de dados novamente, teria que
ser somente no ato de entrar na aplicação." As credenciais (`creds` em
`ProtheusAuthProvider`/`PdmAuthProvider`) só existem em memória (estado
React) — sobrevivem normalmente a navegação client-side (`<Link>`, SPA,
não remonta os providers), mas somem inteiras numa navegação "dura" (o
navegador troca de página de verdade, o app inteiro remonta do zero).

Causa: `busca-avancada-acessorios/page.tsx` e `analisador-estruturas/page.tsx`
(as duas telas do grupo "Consulta Banco de Dados" que citam outras telas
no próprio texto de instrução) tinham links pra `/parametros-estrutura` e
`/equipments` escritos como `<a href="...">` (HTML puro) em vez de
`<Link href="...">` (`next/link`) — uma tag `<a>` sempre navega "duro"
(recarrega o app inteiro), mesmo apontando pra uma rota interna do próprio
Next. Clicar num desses links — e só então — derrubava a conexão Protheus
(e a do PDM junto, já que `PdmAuthProvider` também remonta), fazendo os
dois modais de login reabrirem na tela seguinte, mesmo já tendo conectado
"no ato de entrar na aplicação" como esperado. Corrigido trocando as 4
ocorrências (2 em cada arquivo) por `<Link>` — navegação client-side de
verdade, os providers (e a conexão) nunca remontam.

A tela "Consulta PDM x Banco MSM" (credenciais + comparação PDM x Supabase)
é gated por `isAdmin || canConnectPdm` — Administrador sempre, qualquer
outro perfil só se essa permissão estiver ligada em Configuração de
Usuários (ver `specs/permissoes-e-perfis.md` para o histórico: era
hardcoded admin-only antes desta permissão existir).

**2ª ocorrência da mesma classe de bug, achada depois**: pedido explícito
do usuário: "Estou tendo que conectar aos banco de dados quando eu entro e
quando eu abro [uma tela do grupo Parâmetros]... verifique se estamos
chamando este pop-up de conexão com o Banco de Dados em algum outro lugar
sem ser no momento inicial da aplicação, se tiver, remova." Causa diferente
da 1ª ocorrência (não era navegação "dura" — nenhuma das telas de
`Parâmetros` toca Protheus/PDM): o `useEffect` de auto-consulta da própria
tela "Consulta PDM x Banco MSM" (`pdm-consulta-acessorios/page.tsx`)
chamava `openPdmPrompt()` direto toda vez que a tela **montava** sem PDM
conectado (`if (!pdmCreds) { openPdmPrompt(); return }`) — reabrindo o
modal de conexão sempre que essa tela era aberta sem PDM já conectado, não
só "no ato de entrar na aplicação". Corrigido removendo essa chamada — o
efeito agora só dispara a consulta automática se `pdmCreds` já existir; sem
conexão, a tela fica parada até o Admin clicar no botão "Conectar e
consultar PDM" já existente (fallback **por ação do usuário**, não
automático — esse continua existindo, é diferente do bug). Varredura nas
outras telas que também têm um fallback de abrir o prompt dentro de um
`onClick` (`busca-avancada-acessorios/page.tsx`, `pesquisa-itens-dependentes-avancada/page.tsx`)
não achou nenhum outro caso automático — só esse `useEffect` chamava o
prompt sem uma ação explícita do usuário.

## Armadilhas conhecidas da query de BOM (já corrigidas)

Encontradas via auditoria manual do usuário e replicadas tanto no SQL
externo (VBA/planilha do usuário) quanto nas queries deste app:

- **Filtro de documento apagado/modificado ausente**: a query de itens filhos
  do BOM precisa filtrar `Deleted = 'False' AND UserDocRefsModified =
  'False'` (junto com `ObjectTypeID = '1' AND ExtensionID IN('4','5')`) —
  sem isso, itens excluídos ou com referência de usuário modificada
  aparecem indevidamente na estrutura. **Cuidado com o alias**: o bug real já
  encontrado foi validar essas colunas contra o alias do documento **pai**
  em vez do **filho** — o pai passava a validação e o filho inválido entrava
  na BOM mesmo assim. As condições precisam estar no alias do filho.
- **`ConfigurationID` não escopado em MAXREV/PROPFIL**: o join de
  propriedades de variável (`VariableValue`) precisa exigir
  `ConfigurationID = '2'` explicitamente **dentro da própria CTE `MAXREV`**
  — calcular `MAX(RevisionNo)` sem esse filtro deixa outra configuração
  "vencer" a revisão mais alta e a query seguinte (que já assume
  `ConfigurationID = '2'`) devolve propriedades em branco.

Essas duas condições estão comentadas inline em `pdmDb.ts` exatamente onde
aparecem (linhas próximas às queries SQL). Se uma query de BOM/propriedades
nova for adicionada, replicar as duas condições.

## Expansão de propriedades de montagem — hierarquia completa

Para uma montagem (assembly), a expansão de propriedades deve trazer a **BOM
recursiva completa** (todos os níveis, não só o 1º), deduplicada por
`DocumentID`. Pedido explícito do usuário: "a montagem deve ser trazida como
um todo, não somente o 1° nível."

Ao exportar/copiar dados dessa tela, o app pergunta (popup) se o
usuário quer incluir as propriedades+BOM do PDM ou só os dados já na tela —
não decide isso silenciosamente.

## `ALERTA_GERAL` — campo esquecido, decisão de não estender a RPC já publicada

O campo `ALERTA_GERAL` foi esquecido no mapeamento inicial de campos do PDM
(`PDM_FIELD_MAP`) e adicionado depois que o usuário notou a lacuna. **Decisão
deliberada**: a função `replace_protheus_code` (abaixo) já estava em
produção quando isso foi corrigido e **não foi estendida** para sincronizar
esse campo — mudar a assinatura de uma RPC `SECURITY DEFINER` já publicada é
tratado como risco desnecessário; se um novo campo precisar sincronizar via
substituição de revisão, isso exige decisão explícita nova, não extensão
silenciosa.

## Substituição de revisão (`msm_replace_protheus_code.sql`)

Tela "Consulta PDM x Banco MSM": quando um componente validado no PDM tem
código com revisão (ex.: `34.01.10040.01`) e já existe uma linha equivalente
sem revisão (ou com revisão anterior) no Supabase, a substituição é feita de
forma atômica pela RPC `replace_protheus_code`. Este fluxo passa por
`recordReplaceAudit` (ver `specs/auditoria.md`) — historicamente não passava,
foi corrigido nesta sessão.

**Decisão já tomada e não questionar**: a sincronização feita por esta
função é **só de código** (protheus_code/revisão) — não sincroniza
nome, cor, ou outros campos descritivos entre a linha antiga e a nova. Isso
foi um pedido explícito do dono do projeto; a função SQL já foi recriada
(`DROP FUNCTION` + `CREATE`) removendo os parâmetros extras que tentavam
sincronizar outros campos.

**Guard da função**: `replace_protheus_code` aborta com `RAISE EXCEPTION` se
o código antigo não existir em `accessories` — mesmo que ele exista em
outra tabela que o referencia (ex.: `relationship_equip_accessory`,
`non_combinable_comps`). Isso é intencional (accessories é a tabela "dona"
do código), mas significa que reverter/corrigir um código que só aparece em
tabelas relacionadas não passa por esta RPC.

**Popup de revisão antiga — bug já corrigido**: o popup que lista onde o
código antigo está cadastrado já filtrou incorretamente a própria tabela que
disparou o popup (Cadastro de Componentes) — corrigido para listar todas as
tabelas onde o código aparece, por precaução do usuário: "por precaução,
pode listar todas as janelas/tabelas neste pop-up de onde está com a revisão
antiga."

**Sem constraint de FK em `protheus_code`**: `msm_foreign_keys.sql` não
declara nenhuma FK real sobre `protheus_code`/`protheus_item_code`/
`remove_list_code` (só sobre IDs numéricos legados, como
`legacy_group_id`/`legacy_equipment_id`) — então renomear um código em
múltiplas tabelas via `UPDATE ... WHERE` não corre risco de violar
constraint, mas também significa que o Postgres não garante consistência
referencial nesses campos — é a própria RPC (e o app) que precisa manter
isso coerente.

## Cascade de renomeação de código também pelo formulário normal (`RecordModal.tsx`)

Pedido explícito do usuário: "como a tabela accessories e a tabela de
standard_equipment_items, logo, cadastro de componentes e cadastro de
equipamentos respectivamente, quando eu altero o código protheus_code
nestas tabelas, eu tenho que fazer o update nas outras tabelas também, em
todo lugar que aparecer este referido código antigo, tem que substituir
pelo código novo, disparando consequentemente, a criação das Queries."

Até esta mudança, o cascade de renomeação (`replace_protheus_code`, seção
acima) só rodava a partir da tela "Consulta PDM x Banco MSM" — editar o
`protheus_code` direto no formulário normal de Cadastro de Componentes ou
Cadastro de Equipamentos trocava a linha em si (e, depois do fix
documentado em `specs/auditoria.md`, gerava a query de Auditoria pra ela
corretamente), mas **nunca** propagava pra outras tabelas que referenciam
aquele código.

### Como funciona agora

`RecordModal.tsx` detecta a troca de `protheus_code` no momento do submit
(`isEdit`, comparando `record.protheus_code` com o valor do formulário,
`.trim().toUpperCase()` nos dois lados) — só pra `accessories` e
`standard_equipment_items` (`CODE_RENAME_CASCADE`, mapa fixo tabela →
rotas). Quando detecta:

1. Busca uma prévia (`POST /api/replace-protheus-code/preview` ou
   `/api/replace-protheus-code-equipment/preview`, conforme a tabela) —
   conta quantas linhas de cada tabela relacionada têm aquele código, sem
   alterar nada.
2. Mostra um pop-up de confirmação (dentro do próprio `RecordModal`, mesmo
   padrão de "grande, com tabela de impacto" das janelas de revisão de
   import) listando cada tabela afetada e quantas linhas — **decisão
   confirmada explicitamente com o usuário**: pedido pra ter essa prévia
   em vez de cascatear direto sem aviso nenhum, exatamente pelo mesmo
   motivo de segurança da tela PDM (é uma troca em massa, difícil de
   reverter).
3. Ao confirmar: chama a RPC de substituição (`POST /api/replace-protheus-code`
   ou `/api/replace-protheus-code-equipment`) — ela já troca o código na
   própria tabela (`accessories`/`standard_equipment_items`) **e** em
   todas as tabelas relacionadas, numa transação só, e grava uma linha de
   Auditoria pendente pra cada tabela de fato afetada (`recordReplaceAudit`/
   `recordReplaceAuditEquipment`), migrando também o custo real local
   (`renameCostRow`).
4. Só depois disso, o `PUT /api/[table]/[id]` normal roda (via
   `submitSave`), pra persistir qualquer OUTRO campo alterado no mesmo
   submit (nome, cor etc.) — a esta altura o `protheus_code` já bate entre
   o formulário e o banco (o passo 3 já trocou), então o PUT não gera
   diff nenhum pra ele nem duplica a entrada de Auditoria já criada pelo
   cascade; só os demais campos (se houver) passam pelo fluxo normal de
   `recordUpdateAudit`.

Se o código **não** mudou no submit, nada disso roda — comportamento
idêntico ao de antes, PUT direto.

### Dois cascades distintos, escopos confirmados explicitamente com o usuário

- **`accessories`** — reusa a RPC `replace_protheus_code` já existente,
  sem nenhuma mudança nela: `accessories` + `relationship_equip_accessory`
  + `non_combinable_comps` (2 colunas) + `dependant_items` (2 colunas) +
  `roller_tables` + `pending_target_cost`.
- **`standard_equipment_items`** — a RPC de accessories **não serve**
  (seu guard exige que o código antigo exista em `accessories`). Nova RPC
  `replace_protheus_code_equipment` (`msm_replace_protheus_code_equipment.sql`,
  precisa rodar manualmente no SQL Editor, mesma convenção de todo
  `msm_*.sql` deste projeto), com escopo bem mais estreito, confirmado
  explicitamente com o usuário via `AskUserQuestion` antes de implementar:
  só `standard_equipment_items` + `dependant_items.protheus_code` (campo
  "Cód. Item" — só quando o gatilho da dependência é o próprio
  equipamento, não um acessório) + `pending_target_cost.protheus_code`.
  **`dependant_items.protheus_item_code` (campo "Cód. Dependente") nunca
  entra nesse cascade** — essa coluna só guarda código de acessório (ver
  `schema.ts`), nunca de equipamento, então uma troca de código de
  equipamento não deve tocá-la.
- `POST /api/replace-protheus-code-equipment` e sua `/preview` seguem
  exatamente o mesmo padrão das rotas de accessories (mesmo formato de
  resposta, mesmo `recordReplaceAudit`-equivalente) — só a lista de
  tabelas/colunas afetadas é diferente.

### Limitação herdada, não nova desta mudança

Nenhuma das rotas de substituição de código (`/api/replace-protheus-code`,
`/api/replace-protheus-code-equipment`, e os respectivos `/preview`) tem
checagem de `profileId`/`isAdmin` no servidor — mesma ausência de
checagem que a rota de `accessories` já tinha desde que foi criada pra
tela PDM (admin-only só pela UI, não pelo backend). Como agora essas
rotas também são chamadas pelo `RecordModal` normal, qualquer perfil com
permissão de editar `protheus_code` nessas duas tabelas (hoje, na
prática, só quem tem o campo liberado em `editableFieldsByTable` —
perfis restritos como Gerente Adm Comercial normalmente não têm esse
campo liberado, então nunca veem o input habilitado pra disparar isso)
consegue acionar o cascade. Não corrigido aqui — é uma lacuna já existente
no mesmo nível de "proteção na UI, não no backend" documentado em
`specs/permissoes-e-perfis.md`; se quiser fechar essa lacuna, é um pedido
à parte (exigiria passar `profileId` pro `RecordModal` e validar
`getProfileById` nessas quatro rotas, mesmo padrão já usado em outras
rotas sensíveis do app).

## Alterações manuais via SQL Editor nunca geram auditoria

Rodar uma query direto no SQL Editor do Supabase (fora do app) **nunca**
grava uma linha em `audit_log` — só uma escrita feita através de uma rota do
app (que chama `record*Audit`, ver `specs/auditoria.md`) gera esse rastro.
Relevante sempre que uma correção pontual for feita direto no banco: ela
fica invisível para quem só olha a tela de Auditoria.
