# Grupos de Imagens (bucket Cloudflare R2)

Tela `/grupos-imagens` (grupo "Administração", admin-only, fora do sistema
de `visibleModules`/`MODULES` — ver `specs/permissoes-e-perfis.md`). Pedido
explícito do usuário: criar, dentro do CRUD_MSM, um módulo pra gerenciar o
bucket Cloudflare R2 (`images-msm`) onde ficam as imagens dos itens do
catálogo, hoje mantido manualmente pela equipe de TI/Engenharia via
`rclone` + PowerShell (ver manual interno "Manutenção de Imagens — Monte
Sua Máquina", anexado pelo usuário antes do pedido).

**Decisões confirmadas explicitamente com o usuário (`AskUserQuestion`)
antes de implementar**:
1. A tela não é só um catálogo de nomes — ela **envia/substitui/renomeia/
   remove imagem de verdade no bucket**, assumindo o lugar do processo
   manual do `rclone` pra esse tipo de operação do dia a dia.
2. É uma tela nova própria, com link na Sidebar — não uma lista anexada
   dentro de uma tela já existente.

Até esta sessão, o CRUD_MSM **não tinha nenhuma integração com R2/S3** —
nenhum código do projeto referenciava o bucket. Esta é a primeira vez que
o app fala com um serviço de armazenamento de objetos.

## Terminologia (do manual da TI, replicada aqui)

- **R2** — serviço de armazenamento de objetos da Cloudflare, compatível
  com a API S3 (o SDK oficial `@aws-sdk/client-s3` funciona direto, só
  trocando o endpoint).
- **Bucket** — `images-msm`, configurável via `R2_BUCKET`.
- **Pasta** — qualquer segmento do caminho dentro do bucket, profundidade
  livre (ex.: `Acessórios/CAMERAS`, ou `Acessórios/CAMERAS/Extra`). No R2
  (como em qualquer S3) **pasta não é uma entidade de verdade** — é só o
  efeito de agrupar chaves que compartilham o mesmo prefixo até a próxima
  barra (`Delimiter: '/'` no `ListObjectsV2`). Uma pasta só "existe"
  enquanto houver pelo menos um arquivo dentro dela (direto ou numa
  subpasta) — exatamente como o manual da TI descreve. **Histórico**: a 1ª
  versão desta tela chamava isso de "Grupo/Subgrupo" e assumia sempre
  exatamente 2 níveis fixos — ver "Navegação tipo Windows Explorer" abaixo
  pra por que isso mudou.
- **Chave (key)** — o caminho completo dentro do bucket, ex.:
  `img/Monte sua Máquina/Imagens - MSM/Acessórios/CAMERAS/27.02.00683.png`.
- **URL pública** — endereço pelo qual a aplicação e qualquer navegador
  abrem a imagem.

## Por que não existe uma tabela "Grupos de Imagens" no Supabase

Decisão deliberada, não uma lacuna: a árvore de pastas é **100% derivada do
bucket ao vivo** (`browseFolder`, `src/lib/r2Images.ts`), via
`ListObjectsV2` com `Delimiter: '/'`, nunca de uma tabela local. Manter uma
lista separada de "pastas cadastradas" no Postgres criaria uma segunda
fonte de verdade que pode divergir da realidade do bucket (uma pasta
existente no R2 mas não na lista, ou vice-versa) — exatamente o tipo de
inconsistência que este projeto evita em outros lugares (ver
`isControllershipTable` em `specs/dados-e-schema.md`, "nunca reintroduzir
lista hardcoded").

**"Criar uma pasta nova" não é uma ação separada**: é só digitar, no
formulário "Adicionar imagem", um caminho de pasta que ainda não existe —
a pasta passa a existir no bucket no exato momento em que a primeira
imagem é enviada pra lá, igual ao comportamento nativo do R2/S3 que o
próprio manual da TI descreve.

## Navegação tipo Windows Explorer — profundidade livre

**Histórico, mudança arquitetural de uma sessão posterior**: a 1ª versão
desta tela assumia que todo caminho dentro do bucket tinha **exatamente 2
níveis fixos** (Grupo > Subgrupo > imagens) — a árvore era carregada por
inteiro de uma vez (`listGroupsTree`, removida) e upload/renomear/remover
eram todos parametrizados por `group`+`subgroup`. Pedido explícito do
usuário, depois de notar que a tela escondia parte da estrutura real do
bucket: "eu posso ter imagens em diferentes grupos e níveis, e não
consigo ver o que está no nível acima da imagem hoje" — confirmado via
`AskUserQuestion` (reescrever pra navegação genérica vs. só adicionar uma
visualização read-only a mais) que a reescrita completa era o caminho
certo.

- **`browseFolder(folderPath)`** (`r2Images.ts`) substituiu `listGroupsTree`
  + `listImages` — lista **um nível por vez** (pastas + imagens
  diretamente dentro de `folderPath`, nunca a árvore inteira), estilo
  Windows Explorer. Mais barato também: o bucket pode ter qualquer
  profundidade, então varrer tudo de uma vez (como a 1ª versão fazia, 2
  chamadas aninhadas) não escalaria pra uma estrutura mais profunda.
  `folderPath` é uma string livre (`"Acessórios/CAMERAS"`,
  `"Acessórios/CAMERAS/Extra"`, ou `""` pra raiz) — `buildKey`/
  `buildPublicUrl`/`uploadImage`/`copyImage`/`deleteImage`/`imageExists`/
  `backupImage` foram todos generalizados de `(group, subgroup, fileName)`
  pra `(folderPath, fileName)`.
- **`isValidFolderPath(path)`** substituiu `isValidSegmentName` — valida o
  caminho inteiro (cada segmento não vazio, não `.`/`..`), não mais só um
  segmento isolado.
- **Tela (`grupos-imagens/page.tsx`)** — breadcrumb no topo (`Raiz / seg1 /
  seg2 / ...`, cada segmento clicável pra voltar) + **caixas em cascata**
  (estilo colunas do Finder/macOS), uma caixa por nível, lado a lado, com
  rolagem horizontal. Abaixo, as imagens do caminho selecionado (coluna
  mais funda) — mesma grade de cartões de antes, só generalizada pra
  `path` em vez de `group`/`subgroup`. O formulário "+ Adicionar imagem"
  tem um único campo "Pasta" (texto livre, aceita qualquer profundidade
  separada por `/`, pré-preenchido com o caminho atual) em vez de dois
  campos fixos. **2ª rodada, pedido explícito do usuário**: "Tem como não
  ter o 'Subir de nivel' das pastas quero a visão de cascata, separada em
  caixas menores... e em níveis cascateados" — o painel único (lista de
  subpastas do nível atual + botão "↑ Subir um nível") foi substituído por
  várias caixas pequenas simultâneas, uma por nível já visitado
  (`columns: BrowseColumn[]`, `columns[0]` = raiz, `columns[k]` = conteúdo
  de `pathSegments.slice(0, k)`), sem nenhum botão "subir" — pra voltar a
  um nível mais raso, ou clica na própria caixa anterior (escolhendo outra
  subpasta dali, o que já corta qualquer coluna mais funda) ou no
  breadcrumb. Colunas já visitadas ficam em memória (`navigateToIndex` só
  corta o array, sem round-trip novo); só abrir uma pasta nova (ou
  "Recarregar") dispara `fetchBrowseColumn`.
- **`GET /tree` e `GET /list` foram removidos**, substituídos por uma única
  `GET /browse?path=`, que devolve `{ path, folders, files }` de um nível
  só. `POST /upload`/`/rename`/`/delete` trocaram `group`/`subgroup` (e
  `toGroup`/`toSubgroup`) por `path`/`toPath`.
- **`image_change_log`** — `group_name`/`subgroup_name`/`to_group_name`/
  `to_subgroup_name` foram substituídos por `folder_path`/`to_folder_path`
  (`msm_image_change_log_folder_path.sql`, migração manual). As colunas
  antigas ficaram destravadas (`DROP NOT NULL`) e paradas de receber valor
  novo — mantidas só como histórico das linhas já gravadas antes desta
  mudança. **Nota histórica**: na época, a UI lia `folder_path` com
  fallback pra `group_name + '/' + subgroup_name` quando `folder_path` era
  `null` — essa leitura não existe mais, o painel "Ver histórico de
  alterações" (e toda a gravação em `image_change_log`) foi removido numa
  sessão posterior, ver "Histórico de alterações removido" abaixo.

## `src/lib/r2Images.ts` — server-only

Único ponto de contato com a API S3 do R2. `S3Client` (`@aws-sdk/client-s3`,
região `auto`, endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`)
é um singleton lazy, mesmo padrão de `src/lib/supabase.ts` (`getAdmin`/
`getClient` via `Proxy`, aqui simplificado pra uma função `getClient()`
só).

- `browseFolder(folderPath)` — lista um nível só: as subpastas
  (`CommonPrefixes`) e as imagens (`Contents`) diretamente dentro de
  `folderPath` (`""` = raiz, sob o prefixo-base `R2_BASE_PREFIX`). Pagina
  com `ContinuationToken` até `IsTruncated` ser falso — nunca assume que
  cabe tudo numa página só (mesma disciplina de `.range()` explícito já
  documentada em `specs/dados-e-schema.md`, só que pro lado do S3 em vez do
  PostgREST). Sem cache — é uma tela de uso ocasional (Admin, manutenção
  pontual), e dado fresco logo depois de um upload importa mais que
  velocidade; se algum dia isso ficar lento, o próximo passo natural é um
  cache curto, mesmo espírito do `BomDetailCache` de `protheusDb.ts`. Ver
  "Navegação tipo Windows Explorer" acima pra por que isso substituiu a
  árvore eager de 2 níveis fixos da 1ª versão.
- `uploadImage` / `copyImage` / `deleteImage` / `imageExists` — operações
  básicas (`PutObjectCommand`/`CopyObjectCommand`/`DeleteObjectCommand`/
  `HeadObjectCommand`), todas parametrizadas por `(folderPath, fileName)`.
- `purgeBackups()` — apaga tudo sob `_backup/` no bucket. Ver "Backup
  automático removido" abaixo — não cria cópia nenhuma, só limpa o que o
  mecanismo antigo (`backupImage`, removido) já tinha criado.
- `isValidFileName` / `isValidFolderPath` — validação antes de qualquer
  operação: arquivo precisa terminar em `.png` (case-sensitive, minúsculo —
  mesma regra do manual da TI) e não pode ter barra no nome (pra nunca
  criar um "subcaminho" por engano), mas **aceita qualquer outro
  caractere** — espaço, acento, parênteses etc. Caminho de pasta — cada
  segmento não pode ficar vazio nem ser `.`/`..`, profundidade livre.
  **Bug real já corrigido**: a 1ª versão de `isValidFileName` só aceitava
  `[A-Za-z0-9._-]` — "Remover"/"Renomear"/"Substituir" recusavam com
  "Pasta/arquivo inválido" qualquer arquivo já existente no bucket cujo
  nome tivesse espaço (ex. `"13 - BRANCO_CINZA.png"`, cadastrado fora do
  app via rclone), mesmo sendo um nome perfeitamente válido — a tela
  listava a imagem normalmente (`browseFolder` não valida nome nenhum), só
  as ações recusavam agir nela. Relatado pelo usuário como "não estou
  conseguindo deletar imagens"; a regex foi trocada pra `/^[^/]+\.png$/`
  (qualquer caractere, menos barra, terminando em `.png`).
- `buildKey` / `buildPublicUrl` — monta a chave completa e a URL pública
  (`R2_PUBLIC_BASE_URL` + chave, cada segmento passado por
  `encodeURIComponent` — necessário porque os nomes de pasta têm espaço e
  acento, ex. "Monte sua Máquina", "Acessórios").

### Variáveis de ambiente (`.env.local`, só pra esta tela)

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=images-msm                 # default se omitido
R2_PUBLIC_BASE_URL=https://images-msm.vmisecurity.com
R2_BASE_PREFIX=img/Monte sua Máquina/Imagens - MSM/   # default se omitido
```

**Por que env var, e não uma tela de login (diferente de Protheus/PDM)**:
o próprio manual da TI trata essas chaves como infraestrutura
compartilhada da equipe ("recomendação da TI: registre nos campos
sigilosos apenas o nome do item no cofre de senhas corporativo"), não um
login pessoal como Protheus/PDM (`protheusAuthContext.tsx`/
`pdmAuthContext.tsx`, credencial por pessoa, só em memória, nunca em env).
Mesmo tratamento já dado a `SUPABASE_SECRET_KEY` — uma credencial de
sistema, configurada uma vez no servidor, nunca digitada numa tela.

**Fallback pra `local-data/local-access.txt`, adicionado numa sessão
posterior**: `envOrLocal()`/`getBucket()`/`getBasePrefix()` (`r2Images.ts`)
agora leem `process.env[X] || getLocalValue(X)` (`src/lib/localCredentials.ts`)
em vez de só `process.env[X]` — pedido explícito do usuário ao criar o
mecanismo de "Entrar com Dados Locais" (ver
`specs/pdm-protheus-integracao.md`, seção "Credenciais locais..."): ter um
único arquivo nesta máquina com todas as credenciais (Protheus, PDM, R2),
em vez de precisar configurar o `.env.local` separadamente só pra testar
este módulo localmente. **`.env.local` sempre tem prioridade** quando as
duas fontes existirem — quem já configurou R2 em produção via `.env.local`
não tem nenhuma mudança de comportamento; o arquivo local é só um fallback
de conveniência para desenvolvimento/uso pessoal na própria máquina.
`R2_PUBLIC_BASE_URL` continua exigindo que pelo menos uma das duas fontes
tenha o valor (`envOrLocal`, lança erro se nenhuma tiver) — nunca um
default hardcoded, pelo mesmo motivo de grafia ambígua já explicado acima.

**Dentro de `local-data/local-access.txt`, a seção R2 usa exatamente o
bloco `[r2]` que a TI fornece pro `rclone.conf`** (`type`, `provider`,
`access_key_id`, `secret_access_key`, `endpoint`, `region`,
`no_check_bucket`, chaves em minúsculo), não `R2_ACCESS_KEY_ID=` flat —
pedido explícito do usuário, confirmado com o texto literal que a TI já
passou pra ele, pra poder colar direto sem reescrever nada.
`R2_BUCKET`/`R2_PUBLIC_BASE_URL` não fazem parte desse bloco (não existem
no `rclone.conf` padrão) — continuam só no `.env.local`. O `endpoint` é
usado direto, nunca decomposto num "Account ID" separado (bug real já
corrigido — ver detalhe completo em `specs/pdm-protheus-integracao.md`,
seção "Credenciais locais...").

**`R2_PUBLIC_BASE_URL` não tem um valor hardcoded de propósito**: o manual
enviado pelo usuário tem duas grafias diferentes pro mesmo domínio
(`imagesmsm.vmisecurity.com` numa tabela, `images-msm.vmisecurity.com` nos
exemplos de uso) — em vez de arriscar a grafia errada no código, isso fica
como variável de ambiente, confirmada pela TI antes de preencher o
`.env.local` de produção.

## Rotas (`/api/r2-images/*`)

Todas exigem `profileId` + `getProfileById(...).isAdmin` no servidor —
nunca um `isAdmin` solto do corpo/query (mesmo padrão documentado em
`specs/permissoes-e-perfis.md`). Nenhuma mistura GET+método mutante no
mesmo caminho fixo (cada ação tem sua própria rota: `browse`/`changes` são
só `GET`, `upload`/`rename`/`delete` são só `POST`) — não corre o risco de
405 em build de produção documentado em `specs/telas-auxiliares.md`.

- `GET /browse?path=` — substituiu `/tree` e `/list` (ver "Navegação tipo
  Windows Explorer" acima). Devolve `{ path, folders, files }` de **um
  nível só** — as subpastas e as imagens diretamente dentro de `path`
  (`""`/omitido = raiz).
- `POST /upload` — `multipart/form-data` (upload de arquivo de verdade):
  `profileId`, `path`, `fileName`, `mode` (`add`|`replace`), `file`.
  `mode=add` recusa se já existir uma imagem com esse nome (equivalente ao
  passo manual "confirme que ainda não existe imagem com esse código" do
  guia — aqui é checado pelo servidor, não só lembrado na checklist);
  `mode=replace` recusa se **não** existir (evita criar uma substituição
  "no vazio" sem querer). Só aceita `file.type === 'image/png'`. Sem cópia
  de segurança antes de sobrescrever (ver "Backup automático removido"
  abaixo) — sobrescreve direto.
- `POST /rename` — copy + delete (S3/R2 não tem rename nativo, mesmo
  motivo do `rclone` usar `moveto`) — equivalente à seção 7.4 do manual
  ("corrigir o nome de um arquivo enviado errado"), `path`/`toPath`
  (profundidade livre) + `fileName`/`toFileName`. Recusa se o destino já
  existir.
- `POST /delete` — `deleteImage`, sem cópia de segurança (ver "Backup
  automático removido" abaixo). Confirmação (`window.confirm`) é só no
  cliente — a rota em si não teria como "desfazer" a remoção.
- `POST /purge-backups` — apaga tudo sob `_backup/` (ver "Backup automático
  removido" abaixo).

## Backup automático removido

Até esta sessão, toda substituição/remoção (de uma imagem avulsa ou de uma
pasta inteira) guardava automaticamente uma cópia do conteúdo anterior sob
o prefixo `_backup/` do mesmo bucket, antes de sobrescrever/apagar —
automatizando o passo manual que o guia da TI pede ("guarde uma cópia da
versão atual... para poder voltar atrás"). **Removido por completo, pedido
explícito do usuário**: "Eu não quero ter backup de nada... todo e
qualquer backup que esteja sendo criado, delete-o."

- `backupImage` (`r2Images.ts`) foi deletada — `uploadImage`
  (`mode=replace`) e `deleteImage` não fazem mais cópia nenhuma antes de
  agir. `deleteFolder` também parou de copiar cada objeto pra `_backup/`
  antes de apagar — `DeleteFolderResult` perdeu o campo `backupPrefix`
  (só `{ count }` agora).
- **`recordImageChange`/`image_change_log` (histórico de alterações) foi
  removido por completo numa rodada seguinte** — ver "Histórico de
  alterações removido" abaixo. Na época desta mudança o mecanismo ainda
  existia (só o campo `backup_key` passou a ficar sempre `null`); isso não
  é mais verdade — nenhuma linha nova é gravada em `image_change_log` hoje.
- **`purgeBackups()`** (`r2Images.ts`) — limpeza única das cópias que o
  mecanismo antigo já tinha criado antes de ser removido: lista tudo sob
  `_backup/` (fora do prefixo-base, nunca aparece em `browseFolder`) e
  apaga, sem nenhuma confirmação adicional além da da própria tela. `POST
  /api/r2-images/purge-backups` (admin-only, mesmo padrão
  `getProfileById`/`isAdmin` de toda rota desta tela) expõe isso; botão
  "🗑 Limpar backups antigos" na tela, com confirmação (`window.confirm`) e
  toast mostrando quantos arquivos foram removidos.
- Todo texto de confirmação (`window.confirm`) que mencionava "uma cópia
  de segurança é guardada" (remover uma imagem, remover em lote, remover
  uma pasta inteira) foi atualizado pra deixar claro que a remoção agora é
  definitiva, sem cópia nenhuma.
- **Achado durante a investigação deste pedido**: o usuário relatou "não
  estou conseguindo deletar imagens" momentos antes — a hipótese inicial
  (permissão do token R2 restrita ao prefixo-base, bloqueando a escrita em
  `_backup/` fora dele) foi descartada depois que o erro real apareceu:
  "Pasta/arquivo inválido", vindo da validação de nome de arquivo, não do
  S3. Causa raiz de verdade foi o bug de `isValidFileName` documentado
  acima (regex não aceitava espaço no nome) — **duas correções
  independentes, não a mesma**: o bug de validação (que bloqueava
  qualquer ação nesses dois arquivos específicos) e a remoção do backup
  automático (pedido à parte, decidido depois, não uma consequência do
  bug).

## Histórico de alterações removido

Até esta sessão, cada upload/substituição/renomeação/remoção gravava uma
linha em `image_change_log` (`action`, `folder_path`/`file_name`,
`to_folder_path`/`to_file_name` quando era um `rename`, `profile_id`/
`profile_name`) — equivalente automático da seção 13 do manual da TI
("Registre a alteração") — e a tela tinha um painel colapsável "Ver
histórico de alterações" (últimas 200 linhas, `GET /api/r2-images/changes`)
pra consultar isso. **Removido por completo, pedido explícito do
usuário**: "Remova a função de Ver histórico de alterações... não quero
isso" — confirmado via `AskUserQuestion` que o pedido cobria tanto a tela
quanto parar de gravar (não só esconder o botão).

- `recordImageChange` (`src/lib/imageChangeLog.ts`) foi deletado, e com
  ele toda chamada a partir das rotas de `/api/r2-images/*` (upload,
  rename, delete, rename-folder, delete-folder, create-folder) — nenhuma
  delas grava linha nenhuma em `image_change_log` a partir de agora.
- `GET /api/r2-images/changes` (a rota que a tela usava pra listar o
  histórico) foi deletada — não tem mais consumidor.
- Na tela, removidos: o botão "Ver histórico de alterações", o painel
  "Últimas alterações" (tabela com data/ação/pasta/arquivo/perfil), e todo
  o estado/tipos que só existiam pra isso (`changes`, `changesOpen`,
  `changesLoading`, `fetchChanges`, a interface `ImageChangeRow`,
  `ACTION_LABEL`, `rowFolderPath`/`rowToFolderPath`).
- **A tabela `image_change_log` em si não foi apagada do banco** —
  `msm_image_change_log.sql`/`msm_image_change_log_folder_path.sql`
  continuam valendo como histórico de migração (ver
  `specs/sql-migrations.md`); as linhas já gravadas antes desta mudança
  continuam lá, só não há mais nenhum jeito de consultá-las pelo app, e
  nenhuma linha nova é gravada. Derrubar a tabela não foi pedido — fora de
  escopo desta mudança.
- **Isto nunca foi a mesma coisa que `audit_log`** (`specs/auditoria.md`),
  que continua existindo normalmente e não foi tocado por esta remoção —
  `audit_log` gera SQL pra alguém rodar manualmente no banco oficial, um
  conceito completamente diferente do histórico de operações no bucket R2
  que foi removido aqui.

## Tela (`src/app/grupos-imagens/page.tsx`)

- Guard `!user.isAdmin` igual a `/configuracao-usuarios` (mensagem "Acesso
  restrito a administradores", sem nada mais renderizado).
- Breadcrumb no topo (`🗀 Raiz / seg1 / seg2 / ...`), cada segmento
  clicável — navega pra aquele nível.
- Caixas em cascata (`w-56` cada, `overflow-x-auto` na linha): uma por
  nível já aberto, lado a lado — clique numa pasta de qualquer caixa abre
  a próxima à direita (e descarta qualquer coluna mais funda que já
  existisse). Sem botão "subir" — ver "Navegação tipo Windows Explorer"
  acima pro histórico de por que isso mudou de um painel único pra caixas
  em cascata. **3ª rodada, pedido explícito do usuário**: "não quero ver
  isso [a caixa com 'Sem subpastas.'], quero ver só se tiver alguma
  subpasta mesmo" — uma coluna só é renderizada quando `col.folders.length
  > 0`; `columns` continua guardando a entrada mesmo vazia (preserva o
  índice usado por `pathSegments`/`selectAt`), só a caixa em si não
  aparece quando não há nenhuma subpasta pra mostrar.
- Abaixo das caixas: grade de cartões por imagem do caminho selecionado
  (miniatura via `<img>` direto na URL pública, nome, tamanho, data, link
  "Abrir", e os três botões Substituir/Renomear/Remover).
- "+ Adicionar imagem" — um único campo "Pasta" (texto livre, `<datalist>`
  sugere as subpastas do nível atual, mas aceita digitar qualquer caminho
  com `/`, inclusive um que ainda não existe — é assim que uma pasta nova
  "nasce"), nome do arquivo, seletor de arquivo (`accept="image/png"`),
  dois botões ("Adicionar nova" = `mode=add`, "Substituir existente" =
  `mode=replace`) — a tela não tenta adivinhar qual dos dois o usuário
  quer, até porque o mesmo formulário é reusado tanto pro "+ Adicionar
  imagem" do topo (pode ser add OU replace) quanto pelo botão "Substituir"
  de uma linha já existente (pré-preenchido, mas ainda com os dois botões
  — nada impede o usuário de, ali, optar por "Adicionar nova" com outro
  nome em vez de substituir).
- "Remover" (por linha) pede confirmação (`window.confirm`) antes de
  chamar a rota, mesmo padrão já usado em telas auxiliares deste projeto
  (ver `specs/telas-auxiliares.md`).

### Seleção múltipla + exclusão em lote

Pedido explícito do usuário: "Quero ter o controle total das imagens, que
em cada imagem que eu possa selecionar mais de uma ao mesmo tempo, neste
momento que eu consiga deletar estas imagens." Cada cartão de imagem ganhou
um checkbox (`selectedFiles: Set<string>`, por nome de arquivo) — clicar no
checkbox **ou** na própria miniatura seleciona (os dois ficam dentro do
mesmo `<label>`). Acima da grade: "Selecionar todas"/"Limpar seleção"
(alterna conforme já tem tudo selecionado ou não) e, só quando há pelo
menos uma selecionada, "Excluir selecionadas (N)".

- **Seleção é sempre relativa à pasta atual** — nomes de arquivo só fazem
  sentido dentro dela (duas pastas podem ter arquivos com o mesmo nome).
  `useEffect` limpa `selectedFiles` sempre que `currentPath` muda, pra
  nunca arrastar uma seleção "fantasma" de outra pasta.
- **Exclusão em lote é sequencial** (`for...of` + `await`, não
  `Promise.all`) — mesmo padrão de toda escrita em massa deste projeto
  (ver `specs/custeio-financeiro.md`, "Escritas financeiras em massa são
  sequenciais"): erro isolado por imagem, ordem previsível. Cada chamada é
  um `POST /delete` normal, sem nenhum caminho de escrita paralelo.
- Confirmação única (`window.confirm`) antes de começar o lote, mostrando
  a contagem. Ao final, toast resume quantas foram removidas e quantas
  falharam (se alguma falhar, o toast fica no estilo de erro) — uma falha
  isolada numa imagem nunca interrompe as demais do lote. **Bug real já
  corrigido**: até esta correção, o toast de falha só dizia "N falharam",
  sem motivo nenhum — cada `/api/r2-images/delete` já devolvia um
  `json.error` específico (igual ao delete individual mostra), mas o loop
  do lote descartava essa mensagem. Corrigido guardando a 1ª mensagem de
  erro encontrada e anexando ao toast (`"N falharam — <mensagem>"`) — foi
  o que permitiu diagnosticar o bug de `isValidFileName` acima (sem isso,
  o sintoma reportado era só "0 removidas, N falharam", sem pista
  nenhuma).

### Mover (uma imagem ou várias selecionadas)

Pedido explícito do usuário: "Quero ter a capacidade de mover imagens de
uma pasta para outra, podem ser uma única imagem ou várias selecionadas."
Dois caminhos, mesma rota por trás (`POST /rename`):
- **Uma imagem** — botão "Renomear" por linha já existente (pop-up
  "Renomear/Mover") — já permitia trocar pasta e/ou nome juntos desde a
  reescrita pra profundidade livre, sem mudança nesta rodada.
- **Várias selecionadas** — botão "Mover selecionadas (N)" (só aparece
  junto de "Excluir selecionadas" quando `selectedFiles.size > 0`) abre um
  pop-up com um único campo "Pasta de destino"; `submitBulkMove` chama
  `POST /rename` **uma vez por imagem selecionada**, sequencial (mesmo
  motivo do delete em lote: erro isolado, ordem previsível), sempre com
  `toFileName` igual ao nome original — **o lote não renomeia arquivo
  nenhum, só move**; trocar nome continua sendo só pelo fluxo de uma
  imagem por vez. Se o destino já tiver uma imagem com o mesmo nome, só
  aquela falha (a rota já recusa colisão de nome) — as outras do lote
  continuam normalmente; toast final resume quantas moveram e lista os
  nomes que falharam.

**Escolher a pasta de destino por árvore, não só por texto — pedido
explícito do usuário**: "Quando eu usar a função de Mover imagem, quero
que eu tenha um pop-up para ver a árvore de pastas para mover as imagens,
hoje está apenas um caminho de texto." `FolderTreePicker`
(`grupos-imagens/page.tsx`) é um componente de pop-up próprio, reusado
pelos dois fluxos de mover (uma imagem no pop-up "Renomear/Mover imagem",
e o lote no pop-up "Mover N imagem(ns)") — um botão "🗀 Escolher pasta" ao
lado do campo de texto ("Nova pasta"/"Pasta de destino") abre o pop-up já
navegado até o caminho que estava no campo. Mesmo visual de cascata
(colunas lado a lado, estilo Finder/macOS) da navegação principal da tela
— ver "Navegação tipo Windows Explorer" abaixo —, só que **confinado ao
pop-up** (estado próprio, nunca compartilha `columns`/`pathSegments` com a
navegação de fundo) e **só pastas** (nenhuma imagem é listada — não faz
sentido escolher um arquivo como destino de um move). Clicar numa pasta
abre a próxima coluna; o breadcrumb no topo do pop-up permite voltar a um
nível mais raso; "Selecionar esta pasta" devolve o caminho navegado pro
campo de texto que abriu o pop-up (`renameToPath` ou `bulkMoveToPath`) e
fecha. **O campo de texto não foi removido** — digitar continua funcionando
normalmente (inclusive pra apontar pra uma pasta que ainda não existe,
criada implicitamente ao mover a primeira imagem pra lá, mesmo
comportamento de sempre); o pop-up é só um jeito mais rápido de apontar
pra uma pasta já existente, sem precisar saber/digitar o caminho de
cabeça. Não foi estendido ao pop-up "Renomear / mover pasta inteira" nem
ao "+ Adicionar imagem" — o pedido foi especificamente sobre "mover
imagem", não sobre mover uma pasta inteira ou escolher pasta no upload.

**A pasta de origem nunca "some sozinha" ao ser esvaziada por um move ou
por uma exclusão — pedido explícito do usuário**: "É de conveniência do R2
ter o comportamento de que se eu movo todas as imagens de uma pasta para
outra, essa pasta é automaticamente deletada? Não quero isso." Resposta:
não é um "apagar automático" do app, é consequência direta de pasta não
ser uma entidade real no S3/R2 (ver "Terminologia" acima) — esvaziar uma
pasta via move (ou via exclusão) é indistinguível, pro bucket, de ela
nunca ter existido. Corrigido primeiro em `POST /api/r2-images/rename`:
depois do copy+delete, se a imagem saiu de verdade da pasta de origem
(`path !== toPath`, não só trocou de nome dentro da mesma pasta) e a
origem ficou sem nenhum conteúdo (`!folderHasContent(path)`), cria
automaticamente um marcador vazio ali (`createFolder`, mesmo mecanismo de
"+ Nova pasta" acima) — best-effort, nunca derruba o move em si, que já
teve sucesso. Como o botão "Mover selecionadas (N)" já chama essa mesma
rota uma vez por imagem, sequencial, essa correção cobre os dois casos
automaticamente (uma imagem só, ou o lote inteiro) sem nenhum código extra
do lado do cliente — só a última imagem a sair de uma pasta é que de fato
dispara a criação do marcador.

**Rodada seguinte, pedido explícito do usuário**: "Faz o mesmo quando
excluir a última imagem também" — a mesma proteção foi replicada em
`POST /api/r2-images/delete`, depois do `deleteImage`: se a
pasta ficou sem nenhum conteúdo depois da remoção, cria o mesmo marcador
vazio ali. Como "Excluir selecionadas (N)" (exclusão em lote) já chama
essa mesma rota uma vez por imagem, sequencial, esta correção também cobre
os dois casos (uma imagem só, ou o lote inteiro) sem código extra do lado
do cliente. Não sobrou nenhuma decisão de escopo "só move, não delete" —
as duas operações que podem esvaziar uma pasta por completo (mover tudo
pra fora, ou excluir tudo) agora preservam ela da mesma forma.

### Renomear/mover uma pasta inteira

Pedido explícito do usuário: "Quero poder renomear uma pasta, é possível?"
R2/S3 não tem rename de pasta nativo (pasta não é entidade real, só um
prefixo de chave — ver "Terminologia" acima) — a única forma é copiar todo
o conteúdo pro prefixo novo e só então apagar o antigo, igual ao mecanismo
de renomear um arquivo (`copyImage`+`deleteImage`), só que pra uma
subárvore inteira em vez de um objeto só.

- **`folderHasContent(folderPath)`** (`r2Images.ts`) — `MaxKeys: 1`, só
  confirma sim/não se existe algo abaixo daquele prefixo; usada tanto pra
  validar que a origem existe quanto pra garantir que o destino ainda está
  livre (a operação é **recusada** se já houver qualquer conteúdo lá —
  nunca mescla duas pastas silenciosamente).
- **`renameFolder(fromFolderPath, toFolderPath)`** (`r2Images.ts`) — lista
  TODAS as chaves sob o prefixo de origem (`listAllKeysUnderPrefix`, sem
  `Delimiter`, qualquer profundidade), copia cada uma pro prefixo novo
  (preservando o caminho relativo), e só depois de **todas** as cópias
  terem dado certo é que começa a apagar os originais. Ordem deliberada:
  se uma cópia no meio falhar, a função lança antes de apagar qualquer
  coisa — a origem fica 100% intacta, seguro tentar de novo. Se as cópias
  todas derem certo mas uma remoção específica falhar, o pior cenário é
  uma sobra isolada na origem (os arquivos já estão seguros no destino) —
  nunca perda de dado.
- **`POST /api/r2-images/rename-folder`** — `{ profileId, path, toPath }`
  (pastas de origem/destino, sem `fileName` — move tudo que está dentro).
  Recusa `path` vazio (não dá pra renomear a raiz), recusa se `path` não
  tiver conteúdo (404) ou se `toPath` já tiver (409).
- **Tela** — botão "✎" (aparece ao passar o mouse, `group-hover`) ao lado
  de cada pasta nas caixas em cascata, abre um pop-up "Renomear / mover
  pasta" com um único campo "Novo caminho" (prefenchido com o caminho
  atual — editar só o último segmento é "renomear", trocar tudo é "mover"
  pra outro lugar qualquer, o mesmo mecanismo serve pros dois). Depois de
  um rename bem-sucedido, a navegação **volta pra raiz** (`loadRoot()`, não
  só `refreshAll()`) — o caminho da pasta renomeada pode não existir mais
  exatamente como estava (se o usuário tiver navegado pra dentro dela ou
  de uma pasta-filha), então recomeçar do zero é mais simples e seguro que
  tentar remendar o estado de navegação em cascata.

### Remover uma pasta inteira

Pedido explícito do usuário: "Quero poder deletar uma pasta por completo."
Sem cópia de segurança (ver "Backup automático removido" acima — pedido
explícito do usuário, numa rodada posterior).

- **`deleteFolder(folderPath)`** (`r2Images.ts`) — lista todos os objetos
  sob o prefixo (`listAllObjectsUnderPrefix`, mesma função de
  `renameFolder`/`searchAll`) e apaga os originais direto. Devolve
  `{ count }`.
- **`POST /api/r2-images/delete-folder`** — `{ profileId, path }`. Recusa
  `path` vazio (não dá pra apagar a raiz) e recusa se a pasta não tiver
  conteúdo (404).
- **Tela** — botão "🗑" (aparece ao passar o mouse, ao lado do "✎" já
  existente) em cada pasta das caixas em cascata. Confirmação
  (`window.confirm`) avisa que é o conteúdo inteiro, qualquer profundidade
  — sem contar quantas imagens de antemão (saber isso exigiria uma
  varredura completa só pra popular o texto da confirmação; o toast final,
  depois de confirmar, já informa a contagem real). Depois de remover, a
  navegação volta pra raiz (`loadRoot()`), mesmo motivo do rename de
  pasta: o caminho atual pode não existir mais como estava.

### Criar uma pasta vazia

Pedido explícito do usuário: "Quero conseguir criar uma nova pasta
também." Até aqui, uma pasta só "nascia" implicitamente ao enviar a
primeira imagem pra um caminho novo (ver "Por que não existe uma tabela
'Grupos de Imagens'" acima) — isso continua valendo, mas agora também dá
pra criar uma pasta vazia explicitamente, sem precisar enviar nada ainda.

- **`createFolder(folderPath)`** (`r2Images.ts`) — como o S3/R2 não tem
  pasta de verdade, isso é o truque padrão também usado por ferramentas
  tipo AWS Console/Cyberduck: um objeto de 0 bytes cuja chave termina em
  `/`. Listado com `Delimiter`, essa chave vira um `CommonPrefix` (aparece
  como pasta em `browseFolder`) em vez de aparecer como arquivo. Ao
  navegar **pra dentro** dela, o próprio marcador aparece como uma chave
  igual ao prefixo consultado (`fileName` vazio depois do corte) — já é
  descartado pela checagem de segurança que `browseFolder` sempre teve
  (`if (!fileName) continue`, documentada como "a própria pasta, nunca
  deveria vir, mas por segurança"), então a pasta nova aparece
  corretamente vazia (0 imagens) até alguém enviar algo de verdade pra lá.
  Níveis intermediários não precisam de marcador próprio — criar
  diretamente `"A/B/C"` já faz `"A"` e `"A/B"` aparecerem sozinhos na
  cascata, porque o cálculo de `CommonPrefixes` do S3 deriva isso da
  própria estrutura da chave, independente da profundidade (mesmo
  comportamento que já valia pra pastas "nascidas" via upload).
- **`POST /api/r2-images/create-folder`** — `{ profileId, path }`. Recusa
  `path` vazio e recusa se já existir conteúdo nesse caminho (409 — nunca
  sobrescreve uma pasta já existente).
- **Tela** — botão "+ Nova pasta" ao lado de "+ Adicionar imagem" (só
  aparece na navegação normal, não durante uma busca — criar pasta não faz
  sentido em cima de um resultado de busca). Pop-up com um único campo
  "Caminho" (pré-preenchido com o caminho atual, texto livre, qualquer
  profundidade). Depois de criar, navega direto pra dentro da pasta nova
  (`loadPath`), em vez de só recarregar onde já estava.

### Busca global (pastas + imagens, bucket inteiro)

Pedido explícito do usuário: "Quero que você adicione um filtro de
pesquisa para todas as imagens e para todas as pastas também." Diferente
de toda a navegação normal (sempre lazy, um nível por vez — ver "Navegação
tipo Windows Explorer" acima), a busca é uma **varredura completa do
bucket sob demanda**, disparada só quando o usuário digita (nunca
automaticamente ao navegar) — essa é a exceção deliberada à regra de "não
varrer tudo de uma vez" do resto da tela: busca por substring não tem como
ser paginada/lazy, então o custo de listar tudo é aceito aqui, só aqui.

- **`searchAll(query)`** (`r2Images.ts`) — uma chamada só a
  `listAllObjectsUnderPrefix(getBasePrefix())` (a mesma função genérica que
  `renameFolder` já usava, generalizada pra também trazer `size`/
  `lastModified` de cada objeto) cobre as duas buscas ao mesmo tempo: toda
  pasta candidata é derivada da cadeia de diretórios de cada chave
  encontrada (sem round-trip separado pra pastas), e cada imagem é
  comparada pelo nome do arquivo. Filtro por substring, case-insensitive,
  sem acentuação especial.
- **`GET /api/r2-images/search?q=`** — exige 2+ caracteres (`400` se
  menor, pra não disparar varredura em cima de uma letra só). Limita a
  **200 resultados por tipo** na resposta (`MAX_RESULTS`) — a varredura em
  si sempre examina o bucket inteiro, mas não faz sentido mandar uma lista
  gigante pro cliente; `foldersTotal`/`filesTotal` vêm separados da
  contagem recortada, pra tela poder avisar "mostrando X de Y" quando o
  resultado real for maior que o limite.
- **Tela** — campo de busca sempre visível, logo abaixo do título (não
  dentro de nenhuma pasta específica). Debounce de 400ms — só dispara a
  requisição depois que o usuário parar de digitar, pra não varrer o
  bucket a cada tecla. Com 2+ caracteres digitados, a busca **substitui**
  por completo o breadcrumb + caixas em cascata + grade normal (não convive
  com eles) — mostra duas listas, "Pastas (N)" e "Imagens (N)": clicar
  numa pasta ou em "Ir até a pasta" (dentro de um resultado de imagem) sai
  do modo de busca e navega direto pra lá (`navigateToPath`, carrega todas
  as colunas intermediáras de uma vez com `Promise.all`, mesma lógica que
  `refreshAll` já usava, extraída pra um `loadPath(segments)` comum aos
  dois).

**2ª rodada, pedido explícito do usuário**: "Quero poder editar as imagens
que estão sendo apresentadas no meu filtro" — a 1ª versão só tinha
"Abrir"/"Ir até a pasta" num resultado de busca; renomear/substituir/
remover exigiam navegar até a pasta primeiro. Cada card de imagem nos
resultados de busca ganhou os mesmos três botões da grade normal
(Substituir/Renomear/Remover), agindo direto em cima daquele resultado,
sem precisar navegar antes:
- `openReplace`/`openRename`/`removeImage` deixaram de assumir sempre
  `currentPath` — passaram a aceitar um `folderPath` explícito (parâmetro
  opcional, default `currentPath`, pra nenhum call site da grade normal
  precisar mudar). `renameTarget` passou a guardar `fromPath` junto do
  `fileName` (antes só guardava o objeto `ImageObject`, que não carregava
  pasta nenhuma — `submitRename` usava `currentPath` direto, que seria
  **errado** num resultado de busca, já que a imagem pode estar numa pasta
  diferente da navegada no momento).
- `deleting` (estado de "removendo…" por linha) passou de chave só
  `fileName` pra chave composta `${folderPath}/${fileName}` — evita que
  remover uma imagem numa pasta deixe o botão de outra imagem com o
  **mesmo nome** só que em pasta diferente também parecendo "removendo";
  isso nunca acontecia na grade normal (uma pasta só pode ter um arquivo
  com cada nome), mas os resultados de busca mostram várias pastas ao
  mesmo tempo, então o nome sozinho deixou de ser uma chave única.
- **`refreshAfterChange()`** substituiu as chamadas diretas a `refreshAll()`
  depois de substituir/renomear/remover — se a edição veio de um resultado
  de busca (`searchQuery` com 2+ caracteres), refaz a busca (`runSearch`,
  extraída do `useEffect` de debounce pra poder ser chamada também daqui);
  senão recarrega a navegação normal, como já fazia antes. Importante
  porque um item editado pode sair do resultado (ex.: renomear o arquivo
  pra um nome que não bate mais com o termo buscado) — sem refazer a
  busca, a lista ficaria mostrando um resultado desatualizado.

## O que ficou fora do escopo desta 1ª versão

Pra não inflar demais uma primeira entrega, as seguintes seções do manual
da TI **não** têm equivalente nesta tela ainda — continuam só no fluxo
manual `rclone`/PowerShell descrito no manual, se precisar:

- **Backup completo do bucket** (seção 8.2 do manual, `rclone copy` do
  bucket inteiro pra uma pasta local) — fora de escopo; é uma operação de
  infraestrutura/backup, não de manutenção do catálogo dia a dia.
- **Gerar CSV com todas as imagens** (seção 8.3) e **árvore de pastas em
  texto** (seção 8.4) — a própria tela já mostra a árvore e a contagem
  ao vivo; exportar pra arquivo não foi pedido.
- **Envio em lote de uma pasta inteira** (seção 7.6, `rclone copy` com
  `--dry-run` antes) — a tela de hoje só envia uma imagem por vez (pelo
  formulário "+ Adicionar imagem"); enviar várias de uma vez continua
  exigindo o fluxo manual até ser pedido.

Se algum desses for pedido depois, a infraestrutura em `r2Images.ts` já dá
a base (listagem, upload, contagem) — não precisaria recomeçar do zero.
