# Grupos de Imagens (bucket Cloudflare R2)

Tela `/grupos-imagens` (link na caixa do grupo "Sistema" da Sidebar,
admin-only, fora do sistema de `visibleModules`/`MODULES` — ver
`specs/permissoes-e-perfis.md`, "Posição do link de `/grupos-imagens` na
Sidebar", pra por que não está em "Administração"). Pedido
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
  (`""`/omitido = raiz). Cada item de `files` também traz `group` (nome do
  grupo de Cadastro de Componentes, ou o nome do equipamento se o código
  for de Cadastro de Equipamentos, ou `null`) — ver "Agrupamento por grupo
  de componentes" abaixo.
- `POST /upload` — `multipart/form-data` (upload de arquivo de verdade):
  `profileId`, `path`, `fileName`, `file`. Sempre recusa se já existir uma
  imagem com esse nome na pasta (equivalente ao passo manual "confirme que
  ainda não existe imagem com esse código" do guia — aqui é checado pelo
  servidor, não só lembrado na checklist) — **nunca sobrescreve**. Só
  aceita `file.type === 'image/png'`. **Histórico**: até uma rodada
  posterior, tinha um parâmetro `mode` (`add`|`replace`) — `mode=replace`
  sobrescrevia o conteúdo de uma imagem já cadastrada; removido por
  completo, pedido explícito do usuário ("Remova a função de substituir e
  renomear a imagem"), ver "Substituir removido" abaixo.
- `POST /rename` — copy + delete (S3/R2 não tem rename nativo, mesmo
  motivo do `rclone` usar `moveto`) — equivalente à seção 7.4 do manual
  ("corrigir o nome de um arquivo enviado errado"), `path`/`toPath`
  (profundidade livre) + `fileName`/`toFileName`. Recusa se o destino já
  existir.
- `POST /delete` — `deleteImage`, sem cópia de segurança (ver "Backup
  automático removido" abaixo). Confirmação (`window.confirm`) é só no
  cliente — a rota em si não teria como "desfazer" a remoção.

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
- **`purgeBackups()` também foi removida, numa rodada seguinte — pedido
  explícito do usuário**: "REMOVA O BOTÃO DE LIMPAR BACKUP ANTIGO", logo
  depois de confirmar que o fix de `isValidFileName` resolveu o problema
  original de exclusão. A versão original desta seção tinha uma limpeza
  única das cópias que o mecanismo antigo já tinha criado em `_backup/`
  (botão "🗑 Limpar backups antigos" na tela, `POST
  /api/r2-images/purge-backups`, função `purgeBackups()` em
  `r2Images.ts`) — os três foram deletados por completo, sem deixar nada
  no lugar. Qualquer conteúdo que já estivesse sob `_backup/` continua lá
  (fora do prefixo-base, nunca aparece em `browseFolder`) — só não há mais
  um botão na tela pra limpar isso; quem precisar, usa o `rclone`/console
  do R2 diretamente.
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
  bug). **Confirmado pelo usuário**: o fix de `isValidFileName` resolveu o
  problema — as duas imagens (`"13 - BRANCO_CINZA.png"`/`"13 -
  CINZA.png"`) excluem normalmente agora.

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
- Abaixo das caixas: grade de cartões por imagem do caminho selecionado,
  **agrupada por grupo de Cadastro de Componentes/Equipamentos por padrão**
  (não mais uma lista única em ordem alfabética — ver "Agrupamento por
  grupo de componentes" abaixo, e "Chave 'Por grupo' / 'Lista única'"
  pra como desligar esse agrupamento), miniatura via `<img>` direto na
  URL pública, nome, tamanho, data, link "Abrir", e o botão "Remover" (ver
  "Substituir e Renomear removidos" abaixo pro porquê de não terem mais
  botão próprio).
- "+ Adicionar imagem" — ver "Nome do arquivo vem do próprio arquivo, só
  aceita selecionar vários de uma vez" abaixo.
- "Remover" (por linha) pede confirmação (`window.confirm`) antes de
  chamar a rota, mesmo padrão já usado em telas auxiliares deste projeto
  (ver `specs/telas-auxiliares.md`).

### Agrupamento por grupo de componentes

Pedido explícito do usuário: "Faça um JOIN com os Protheus_code de
Cadastro de Componentes, ou seja, tabela accessories, também com a tabela
de grupos de componentes, busque o grupo em que cada imagem/componente
está, hoje as imagens estão sendo exibidas em ordem alfabética... quero
que seja em formato de agrupamento de imagens pelo tipo de grupo."

- **`resolveFileGroups(fileNames)`** (`src/lib/imageAccessoryGroups.ts`,
  novo arquivo) — recebe os nomes dos arquivos de uma pasta e devolve um
  `Map<fileName, groupName | null>`. O **nome do arquivo sem a extensão
  `.png`** é o candidato a `protheus_code` (mesma convenção de
  nomenclatura das imagens do catálogo, ex. `"27.02.00683.png"` ->
  `"27.02.00683"`). Busca `accessories` inteira (`select('protheus_code,
  legacy_group_id').limit(25000)` — sem `.limit()` explícito o PostgREST
  capa em 1000 linhas, e Cadastro de Componentes passa disso facilmente)
  e compara em JS, sempre normalizado `.trim().toUpperCase()` nos dois
  lados — nunca via `.in()` do Postgres, que é sensível a caixa/espaço
  (ver `specs/dados-e-schema.md`, "Armadilha do `.in()`"; mesmo padrão já
  usado em `clone-architecture/route.ts`). Com os `legacy_group_id`
  resolvidos, busca só os grupos necessários em `accessory_groups`
  (`.in('legacy_id', ...)` — seguro aqui, é coluna numérica, não texto).
  **Rodada seguinte, pedido explícito do usuário**: "Quero que faça a
  mesma conexão com standard_equipment_items com o seu respectivo
  protheus_code, o mesmo link do protheus_code de accessories já
  existente" — mesmo mecanismo replicado pra Cadastro de Equipamentos:
  `standard_equipment_items.protheus_code` -> `legacy_equipment_id` ->
  `equipments.name` (pra um equipamento, o "grupo" é o próprio
  equipamento, igual `accessory_groups.name` é o grupo de um componente).
  `accessories` é checada primeiro; `standard_equipment_items` é o
  fallback pra código que não bate em `accessories` — as duas buscas (e
  as duas buscas de nome, `accessory_groups`/`equipments`) rodam em
  paralelo (`Promise.all`), não sequencial.
- **`GET /api/r2-images/browse`** — depois de `browseFolder` (puramente
  R2/S3), chama `resolveFileGroups` e anexa `group` em cada item de
  `files` antes de devolver a resposta. `browseFolder`/`r2Images.ts` em si
  **não foram tocados** — continuam só falando com o bucket; o JOIN com o
  banco de dados MSM vive só na rota, não na camada S3.
- **Tela** — `groupFiles(files)` (`grupos-imagens/page.tsx`) agrupa a
  lista (já ordenada alfabeticamente por `browseFolder`) pelo campo
  `group`: cada grupo nomeado vira sua própria caixa (mesmo visual de
  "caixa por seção" já usado no resto do app), com cabeçalho mostrando o
  nome do grupo + contagem (`"<grupo> (N)"`) e a grade de cartões daquele
  grupo logo abaixo — ver "Cada grupo em dropdown + filtro de grupos"
  abaixo pro cabeçalho ter virado um `<button>` colapsável. Grupos
  nomeados saem em **ordem alfabética entre si** (`localeCompare` pt-BR);
  dentro de cada grupo, a ordem alfabética de arquivo já vinda do
  servidor é preservada. Arquivos cujo nome não bate com nenhum
  `protheus_code` cadastrado (ou que bate mas o componente não tem grupo)
  caem numa caixa própria, rótulo fixo "Sem grupo / não cadastrado",
  **sempre por último** — nunca intercalada alfabeticamente com os grupos
  de verdade.
- **O que NÃO mudou**: seleção múltipla (`selectedFiles`), "Selecionar
  todas"/"Limpar seleção", exclusão/mover em lote continuam operando
  sobre a lista plana de arquivos da pasta, **através** das caixas de
  grupo — selecionar uma imagem num grupo e outra em outro grupo funciona
  normalmente, o agrupamento é só visual. Os resultados de busca global
  (ver "Busca global" abaixo) **não foram agrupados** — o pedido foi
  especificamente sobre a navegação normal de pasta, que é onde a ordem
  alfabética "crua" incomodava; a busca já mostra os resultados batendo
  com o termo digitado, uma lista normalmente curta o bastante pra não
  precisar de agrupamento.

### Cada grupo em dropdown + filtro de grupos

Pedido explícito do usuário, rodada seguinte: "Quero que a exibição de
cada grupo seja por um drop-down. Adicione na mesma altura do filtro já
existente, um filtro para filtrar os grupos que foram encontrados nas
pastas."

- **Dropdown por grupo** — o cabeçalho de cada caixa de grupo (antes só
  um `<div>` estático) virou um `<button>` clicável com `GroupChevron`
  (mesmo ícone/rotação de 90° já usado nos grupos colapsáveis da
  Sidebar — componente local, o de `Sidebar.tsx` não é exportado).
  `expandedGroups: Set<string>` (chave = rótulo do grupo) controla o
  estado — **nasce sempre vazio** (tudo colapsado), mesma convenção já
  estabelecida na Sidebar ("sempre começar com tudo colapsado"); clicar
  no cabeçalho expande/colapsa só aquele grupo, sem afetar os outros (não
  é accordion). Reseta ao trocar de pasta (`useEffect` em `currentPath`,
  mesmo padrão de `selectedFiles`) — os grupos de uma pasta não têm nada
  a ver com os da próxima.
- **Filtro de grupos** — botão "🗂 Filtrar grupos (X/Y)" ao lado do campo
  de busca global, **mesma linha/altura** (`flex items-start gap-2`, o
  campo de busca em `flex-1` e o botão do filtro com `shrink-0`), só
  visível fora do modo de busca (`!searchActive` — o agrupamento não se
  aplica a resultados de busca, ver acima). Abre um dropdown (não um
  pop-up de tela cheia, diferente dos outros modais desta tela) com um
  checkbox por grupo encontrado **na pasta atual** (`availableGroups`,
  derivado de `files`, mesma ordem de `groupFiles` — alfabética entre si,
  "Sem grupo / não cadastrado" sempre por último) — fecha sozinho ao
  clicar fora (`groupFilterRef` + listener de `mousedown` no
  `document`).
- **`hiddenGroups: Set<string>`, não `selectedGroups`** — decisão
  deliberada: o Set guarda os grupos **desmarcados**, não os marcados.
  Modelar como "visível por padrão, oculto por exceção" evita um caso
  especial irritante: com `selectedGroups` (vazio = nenhum visível,
  precisaria inicializar com todos os grupos só pra poder tirar um),
  desmarcar o 1º checkbox exigiria popular o Set inteiro antes; com
  `hiddenGroups` (vazio = nada oculto = tudo visível), desmarcar um
  checkbox é só adicionar aquele rótulo ao Set, sem nenhuma inicialização
  especial. Reseta ao trocar de pasta, mesmo motivo de `expandedGroups`
  acima.
- Se o filtro deixar **zero** grupos visíveis, a grade mostra um aviso
  ("Nenhum grupo selecionado no filtro...") em vez de ficar vazia sem
  explicação nenhuma.
- **O que NÃO mudou**: o conteúdo de cada grupo (quais arquivos, em que
  ordem) é exatamente o mesmo de antes — só ganhou um estado de
  expandido/colapsado por cima, e um filtro por cima disso pra decidir
  quais caixas aparecem na lista. Seleção múltipla/mover/excluir em lote
  continuam operando sobre `selectedFiles` normalmente, inclusive dentro
  de um grupo colapsado (uma imagem selecionada antes de colapsar o
  grupo continua selecionada, só não visível até expandir de novo).

### Chave "Por grupo" / "Lista única"

Pedido explícito do usuário: "Quero uma chave na parte superior da tela
para o usuário escolher se vai obter a visualização separada por grupos,
como é feito hoje, ou se vai ser sem essa separação, todas as imagens
juntas em ordem crescente."

- **`groupingEnabled: boolean`** (`grupos-imagens/page.tsx`) — **nasce
  `true`** ("como é feito hoje" é o ponto de partida, a chave só dá a
  opção de desligar). Não persiste entre pastas nem em `localStorage` de
  propósito — nunca foi pedido pra lembrar a escolha, e pastas diferentes
  podem ter quantidades de grupo bem diferentes (faz sentido poder
  escolher de novo a cada navegação).
- **Posição** — par de botões "Por grupo"/"Lista única" (estilo toggle,
  um deles sempre destacado em `bg-primary`) no canto superior direito da
  tela, na mesma linha do título "Grupos de Imagens" (`flex
  items-end justify-between` no cabeçalho) — "na parte superior da tela",
  pedido explícito. Some durante uma busca global (`!searchActive`) —
  a busca tem a própria exibição, nunca foi agrupada (ver "Busca global"
  abaixo), então a chave não faria sentido ali.
- **`groupingEnabled = false` ("Lista única")** — a grade volta a ser uma
  lista única, sem nenhuma caixa de grupo por cima, na mesma ordem
  alfabética ascendente que `browseFolder` já devolve do servidor
  (nenhum `sort` novo no cliente — a ordem "crescente" pedida já é a
  ordem natural, nunca foi alterada). O botão "🗂 Filtrar grupos" também
  some nesse modo (`!searchActive && groupingEnabled`) — não há grupo
  nenhum pra filtrar.
- **`renderImageCard(img)`** — o cartão de uma imagem (miniatura,
  checkbox, nome, tamanho/data, "Abrir"/"Remover") foi extraído pra uma
  função só, reusada tanto dentro de cada dropdown de grupo quanto na
  grade plana da "Lista única" — nunca duas implementações divergentes do
  mesmo cartão.
- **O que NÃO mudou**: a chave só decide COMO agrupar visualmente — os
  dados por trás (`files`, já com `group` resolvido pelo servidor) são os
  mesmos nos dois modos; `selectedFiles`/mover/excluir em lote continuam
  operando sobre a lista inteira da pasta independente do modo escolhido.

### Nome do arquivo vem do próprio arquivo, seleção múltipla pra adicionar

Pedido explícito do usuário: "tenho no pop-up que selecionar a imagem e
ainda preencher o nome do arquivo? Não faz sentido, a imagem é o arquivo,
e o nome da imagem é o nome do arquivo. Quero poder selecionar várias
imagens de uma só vez." A 1ª versão do pop-up "Adicionar / Substituir
imagem" tinha um campo "Nome do arquivo" solto, separado do seletor de
arquivo (`<input type="file">`) — digitado à mão mesmo quando o nome
óbvio já estava certo ali no próprio arquivo selecionado.

O campo "Nome do arquivo" **foi removido**; o seletor de arquivo passou a
ter `multiple`, e o nome de cada imagem enviada é sempre o próprio
`File.name` do arquivo escolhido, nunca digitado. "Adicionar nova(s)"
opera em **lote** — um `POST /upload` por arquivo selecionado, sequencial
(mesmo motivo de toda escrita em lote deste projeto: erro isolado por
arquivo, ordem previsível), cada um usando o próprio nome do arquivo como
`fileName`. **Toast/erro cobrem lote parcial** — se algum arquivo falhar
no meio do lote (nome inválido, já existe, erro de rede), o pop-up
continua aberto e mostra quantos enviaram com sucesso e quais falharam
(com o motivo de cada um); só fecha sozinho quando **todos** os arquivos
do lote tiverem sucesso. `refreshAfterChange()` é chamado de qualquer
forma, pra qualquer envio que tenha dado certo já aparecer na grade mesmo
que o pop-up continue aberto por causa de uma falha parcial.

**Histórico**: na rodada em que isso foi implementado, o pop-up ainda
tinha dois comportamentos (o descrito acima, mais um segundo fluxo aberto
pelo botão "Substituir" de uma linha já existente, com um nome-alvo fixo
diferente de cada arquivo selecionado) e um botão "Substituir
existente(s)" pra sobrescrever em lote. Os dois foram removidos por
completo numa rodada seguinte — ver "Substituir e Renomear removidos"
abaixo.

### Substituir e Renomear removidos

Pedido explícito do usuário: "Remova a função de substituir e renomear a
imagem." Confirmado via `AskUserQuestion` (duas perguntas, já que os dois
recursos tinham uma segunda forma de acesso que podia ou não estar
incluída no pedido):

1. **"Renomear" por linha foi removido; "Mover selecionadas (N)" em lote
   NÃO foi** — recomendado e confirmado pelo usuário. O botão "Renomear"
   de cada imagem (e de cada resultado de busca) abria o pop-up "Renomear
   / Mover imagem" (um arquivo por vez, nome e pasta editáveis juntos) —
   removido por completo: `openRename`/`submitRename`/`renameTarget`/
   `renameToPath`/`renameToFileName`/`renameSaving`/`renameError` e o
   próprio pop-up (`grupos-imagens/page.tsx`). "Mover selecionadas (N)"
   (ver "Mover (uma imagem ou várias selecionadas)" abaixo) continua
   existindo — é reorganizar pastas movendo várias imagens de uma vez
   mantendo o nome original, um conceito diferente de "renomear uma
   imagem", apesar de usar a mesma rota `POST /rename` por trás.
   `FolderTreePicker` (pop-up de árvore de pastas) continua existindo —
   era compartilhado entre os dois fluxos (`folderPickerFor: 'rename' |
   'bulk'`), agora só serve o Mover em lote (`folderPickerFor: 'bulk' |
   null`).
2. **"Substituir" por linha E "Substituir existente(s)" em lote foram os
   dois removidos** — recomendado e confirmado pelo usuário: nenhuma
   forma de sobrescrever o conteúdo de uma imagem já cadastrada continua
   na tela, nem por linha nem em lote. O botão "Substituir" de cada
   imagem (e de cada resultado de busca) e a opção "Substituir
   existente(s)" dentro do pop-up "+ Adicionar imagem" foram os dois
   removidos — `openReplace`/`addTargetFileName` (`grupos-imagens/
   page.tsx`) não existem mais; `submitAdd` perdeu o parâmetro `mode`
   (sempre adiciona). `POST /api/r2-images/upload` também perdeu o
   parâmetro `mode` — sempre recusa se já existir uma imagem com o mesmo
   nome na pasta, nunca sobrescreve (ver "Rotas" acima).

**O que NÃO mudou**: "Remover" por linha continua normal (nunca foi
mencionado no pedido). A rota `POST /api/r2-images/rename` em si não foi
tocada — continua existindo e sendo usada por "Mover selecionadas (N)".

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

### Mover em lote (várias selecionadas)

Pedido explícito do usuário: "Quero ter a capacidade de mover imagens de
uma pasta para outra, podem ser uma única imagem ou várias selecionadas."
Botão "Mover selecionadas (N)" (só aparece junto de "Excluir
selecionadas" quando `selectedFiles.size > 0`) abre um pop-up com um
único campo "Pasta de destino"; `submitBulkMove` chama `POST /rename`
**uma vez por imagem selecionada**, sequencial (mesmo motivo do delete em
lote: erro isolado, ordem previsível), sempre com `toFileName` igual ao
nome original — **o lote não renomeia arquivo nenhum, só move**. Se o
destino já tiver uma imagem com o mesmo nome, só aquela falha (a rota já
recusa colisão de nome) — as outras do lote continuam normalmente; toast
final resume quantas moveram e lista os nomes que falharam.

**Histórico**: o caminho de "uma única imagem" citado no pedido original
era o botão "Renomear" por linha (pop-up "Renomear/Mover imagem" — também
permitia trocar o nome, não só a pasta). Removido por completo numa
rodada seguinte, pedido explícito do usuário: "Remova a função de
substituir e renomear a imagem" — ver "Substituir e Renomear removidos"
acima. O mecanismo de mover em lote descrito aqui **não foi afetado** —
confirmado explicitamente com o usuário que só queria remover o renomear
de uma imagem por vez, não a reorganização de pastas em lote.

**Escolher a pasta de destino por árvore, não só por texto — pedido
explícito do usuário**: "Quando eu usar a função de Mover imagem, quero
que eu tenha um pop-up para ver a árvore de pastas para mover as imagens,
hoje está apenas um caminho de texto." `FolderTreePicker`
(`grupos-imagens/page.tsx`) é um componente de pop-up próprio — um botão
"🗀 Escolher pasta" ao lado do campo de texto ("Pasta de destino") abre o
pop-up já navegado até o caminho que estava no campo. Mesmo visual de
cascata (colunas lado a lado, estilo Finder/macOS) da navegação principal
da tela — ver "Navegação tipo Windows Explorer" abaixo —, só que
**confinado ao pop-up** (estado próprio, nunca compartilha
`columns`/`pathSegments` com a navegação de fundo) e **só pastas**
(nenhuma imagem é listada — não faz sentido escolher um arquivo como
destino de um move). Clicar numa pasta abre a próxima coluna; o
breadcrumb no topo do pop-up permite voltar a um nível mais raso;
"Selecionar esta pasta" devolve o caminho navegado pro campo de texto que
abriu o pop-up e fecha. **O campo de texto não foi removido** — digitar
continua funcionando normalmente (inclusive pra apontar pra uma pasta que
ainda não existe, criada implicitamente ao mover a primeira imagem pra
lá, mesmo comportamento de sempre); o pop-up é só um jeito mais rápido de
apontar pra uma pasta já existente, sem precisar saber/digitar o caminho
de cabeça. Não foi estendido ao pop-up "Renomear / mover pasta inteira"
nem ao "+ Adicionar imagem" — o pedido foi especificamente sobre "mover
imagem", não sobre mover uma pasta inteira ou escolher pasta no upload.
**Histórico**: na época desta mudança, `FolderTreePicker` era
compartilhado com o pop-up "Renomear/Mover imagem" (`folderPickerFor:
'rename' | 'bulk'`) — essa parte do componente foi retirada junto da
remoção do "Renomear" por linha (acima); hoje `folderPickerFor` só tem
`'bulk' | null`.

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
(Substituir/Renomear/Remover, na época), agindo direto em cima daquele
resultado, sem precisar navegar antes. **Histórico — `openReplace`/
`openRename` não existem mais**: os dois (e os botões "Substituir"/
"Renomear" correspondentes, tanto na grade normal quanto nos resultados
de busca) foram removidos numa rodada seguinte — ver "Substituir e
Renomear removidos" acima. Só `removeImage` continua, inclusive nos
resultados de busca.
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
