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
- **Grupo / Subgrupo** — as duas primeiras pastas do caminho dentro do
  bucket (ex.: `Acessórios/CAMERAS`). No R2 (como em qualquer S3) **pasta
  não é uma entidade de verdade** — é só o efeito de agrupar chaves que
  compartilham o mesmo prefixo até a próxima barra (`Delimiter: '/'` no
  `ListObjectsV2`). Uma pasta só "existe" enquanto houver pelo menos um
  arquivo dentro dela — exatamente como o manual da TI descreve.
- **Chave (key)** — o caminho completo dentro do bucket, ex.:
  `img/Monte sua Máquina/Imagens - MSM/Acessórios/CAMERAS/27.02.00683.png`.
- **URL pública** — endereço pelo qual a aplicação e qualquer navegador
  abrem a imagem.

## Por que não existe uma tabela "Grupos de Imagens" no Supabase

Decisão deliberada, não uma lacuna: a árvore Grupo → Subgrupo é **100%
derivada do bucket ao vivo** (`listGroupsTree`, `src/lib/r2Images.ts`), via
`ListObjectsV2` com `Delimiter: '/'`, nunca de uma tabela local. Manter uma
lista separada de "grupos cadastrados" no Postgres criaria uma segunda
fonte de verdade que pode divergir da realidade do bucket (um grupo
existente no R2 mas não na lista, ou vice-versa) — exatamente o tipo de
inconsistência que este projeto evita em outros lugares (ver
`isControllershipTable` em `specs/dados-e-schema.md`, "nunca reintroduzir
lista hardcoded").

**"Criar um Grupo/Subgrupo novo" não é uma ação separada**: é só digitar,
no formulário "Adicionar imagem", um nome de Grupo/Subgrupo que ainda não
existe — a pasta passa a existir no bucket no exato momento em que a
primeira imagem é enviada pra lá, igual ao comportamento nativo do R2/S3
que o próprio manual da TI descreve.

## `src/lib/r2Images.ts` — server-only

Único ponto de contato com a API S3 do R2. `S3Client` (`@aws-sdk/client-s3`,
região `auto`, endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`)
é um singleton lazy, mesmo padrão de `src/lib/supabase.ts` (`getAdmin`/
`getClient` via `Proxy`, aqui simplificado pra uma função `getClient()`
só).

- `listGroupsTree()` — varre o prefixo-base (`R2_BASE_PREFIX`) com
  `Delimiter: '/'` pra achar os Grupos (`CommonPrefixes`), depois cada
  Grupo de novo pra achar os Subgrupos, depois conta os objetos de cada
  Subgrupo. Pagina com `ContinuationToken` até `IsTruncated` ser falso em
  toda chamada de listagem — nunca assume que cabe tudo numa página só
  (mesma disciplina de `.range()` explícito já documentada em
  `specs/dados-e-schema.md`, só que pro lado do S3 em vez do PostgREST).
  Sem cache — é uma tela de uso ocasional (Admin, manutenção pontual), e
  dado fresco logo depois de um upload importa mais que velocidade; se
  algum dia isso ficar lento (bucket com centenas de Grupos), o próximo
  passo natural é um cache curto, mesmo espírito do `BomDetailCache` de
  `protheusDb.ts`.
- `listImages(group, subgroup)` — lista as imagens de um Subgrupo
  específico (nome, tamanho, data, URL pública).
- `uploadImage` / `copyImage` / `deleteImage` / `imageExists` — operações
  básicas (`PutObjectCommand`/`CopyObjectCommand`/`DeleteObjectCommand`/
  `HeadObjectCommand`).
- `backupImage(group, subgroup, fileName)` — copia o objeto atual pra
  `_backup/<group>/<subgroup>/<timestamp>-<fileName>`, **dentro do mesmo
  bucket**, antes de qualquer substituição ou remoção. Automatiza o passo
  manual que o guia da TI pede ("guarde uma cópia da versão atual... para
  poder voltar atrás") — nunca depende de alguém lembrar de fazer isso. O
  prefixo `_backup/` fica fora da árvore que `listGroupsTree` varre (que só
  olha o prefixo-base de produção), então uma cópia de segurança nunca
  aparece como se fosse uma imagem "em uso" pela aplicação.
- `isValidFileName` / `isValidSegmentName` — validação de nome antes de
  qualquer operação: arquivo precisa terminar em `.png` minúsculo (mesma
  regra do manual da TI); Grupo/Subgrupo só não podem ficar vazios nem
  conter `/` (isso quebraria a própria estrutura de chave).
- `buildKey` / `buildPublicUrl` — monta a chave completa e a URL pública
  (`R2_PUBLIC_BASE_URL` + chave, cada segmento passado por
  `encodeURIComponent` — necessário porque Grupo/Subgrupo têm espaço e
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
no `rclone.conf` padrão) — continuam só no `.env.local`. Detalhe completo
(mapeamento de chave, extração do Account ID a partir do `endpoint`) em
`specs/pdm-protheus-integracao.md`, seção "Credenciais locais...".

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
mesmo caminho fixo (cada ação tem sua própria rota: `tree`/`list`/`changes`
são só `GET`, `upload`/`rename`/`delete` são só `POST`) — não corre o risco
de 405 em build de produção documentado em `specs/telas-auxiliares.md`.

- `GET /tree` — árvore Grupo/Subgrupo + contagem, ao vivo.
- `GET /list?group=&subgroup=` — imagens de um Subgrupo.
- `POST /upload` — `multipart/form-data` (upload de arquivo de verdade):
  `profileId`, `group`, `subgroup`, `fileName`, `mode` (`add`|`replace`),
  `file`. `mode=add` recusa se já existir uma imagem com esse nome
  (equivalente ao passo manual "confirme que ainda não existe imagem com
  esse código" do guia — aqui é checado pelo servidor, não só lembrado na
  checklist); `mode=replace` recusa se **não** existir (evita criar uma
  substituição "no vazio" sem querer). Só aceita `file.type ===
  'image/png'`. Faz `backupImage` antes de sobrescrever quando
  `mode=replace`.
- `POST /rename` — copy + delete (S3/R2 não tem rename nativo, mesmo
  motivo do `rclone` usar `moveto`) — equivalente à seção 7.4 do manual
  ("corrigir o nome de um arquivo enviado errado"), generalizado pra também
  mover entre Grupo/Subgrupo diferentes. Recusa se o destino já existir.
- `POST /delete` — `backupImage` + `deleteImage`. Confirmação (`window.confirm`)
  é só no cliente — a rota em si não teria como "desfazer" sozinha além da
  cópia de segurança automática.
- `GET /changes` — últimas 200 linhas de `image_change_log`, mais recente
  primeiro.

## `image_change_log` (`msm_image_change_log.sql`)

Equivalente automático da seção 13 do manual da TI ("Registre a alteração")
— cada upload/substituição/renomeação/remoção grava uma linha (`action`,
`group_name`/`subgroup_name`/`file_name`, `to_*` quando é um `rename`,
`backup_key` quando houve cópia de segurança, `profile_id`/`profile_name`
— snapshot do nome, sobrevive à exclusão do perfil). Gravado via
`recordImageChange` (`src/lib/imageChangeLog.ts`), sempre dentro de um
`try/catch` best-effort (mesmo espírito de `record*Audit`, `sqlAudit.ts`)
— uma falha ao gravar o log nunca desfaz a operação real no bucket, que já
tinha terminado com sucesso.

**Isto não é a mesma coisa que `audit_log`** (`specs/auditoria.md`) — não
reusado de propósito. `audit_log` existe pra gerar SQL que alguém roda
manualmente no banco oficial; uma operação no bucket R2 não é uma query
SQL nenhuma, então misturar os dois conceitos na mesma tabela confundiria
o que cada linha significa.

## Tela (`src/app/grupos-imagens/page.tsx`)

- Guard `!user.isAdmin` igual a `/configuracao-usuarios` (mensagem "Acesso
  restrito a administradores", sem nada mais renderizado).
- Coluna esquerda: árvore Grupo → Subgrupo (contagem por Subgrupo), clique
  seleciona e carrega as imagens dele à direita.
- Painel direito: grade de cartões por imagem (miniatura via `<img>` direto
  na URL pública, nome, tamanho, data, link "Abrir", e os três botões
  Substituir/Renomear/Remover).
- "+ Adicionar imagem" — Grupo/Subgrupo com `<datalist>` (sugere os já
  existentes, mas aceita digitar um nome novo — é assim que um
  Grupo/Subgrupo novo "nasce"), nome do arquivo, seletor de arquivo
  (`accept="image/png"`), dois botões ("Adicionar nova" = `mode=add`,
  "Substituir existente" = `mode=replace`) — a tela não tenta adivinhar
  qual dos dois o usuário quer, até porque o mesmo formulário é reusado
  tanto pro "+ Adicionar imagem" do topo (pode ser add OU replace) quanto
  pelo botão "Substituir" de uma linha já existente (pré-preenchido, mas
  ainda com os dois botões — nada impede o usuário de, ali, optar por
  "Adicionar nova" com outro nome em vez de substituir).
- "Remover" pede confirmação (`window.confirm`) antes de chamar a rota,
  mesmo padrão já usado em telas auxiliares deste projeto (ver
  `specs/telas-auxiliares.md`).
- "Ver histórico de alterações" — painel colapsável com as últimas 200
  linhas de `image_change_log`.

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
