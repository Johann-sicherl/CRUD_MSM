import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getLocalValue } from './localCredentials'

// Integração com o bucket Cloudflare R2 "images-msm" (ver specs/imagens-r2.md)
// — mesmo bucket que a equipe de TI/Engenharia já mantém manualmente via
// rclone/PowerShell. Credenciais (Account ID, Access Key, Secret Key) são
// infraestrutura compartilhada da equipe (guardadas no cofre de senhas
// corporativo, segundo o próprio manual da TI) — não são um login pessoal
// como Protheus/PDM, então nunca são digitadas numa tela. Podem vir de
// variável de ambiente (.env.local, mesmo padrão de SUPABASE_SECRET_KEY —
// ver src/lib/supabase.ts) OU do mesmo arquivo local-data/local-access.txt
// usado pelo botão "Entrar com Dados Locais" do Protheus/PDM (ver
// localCredentials.ts) — pedido explícito do usuário, pra ter um único
// lugar com todas as credenciais desta máquina. .env.local tem prioridade
// quando as duas existirem, pra nunca mudar o comportamento de quem já
// configurou isso em produção.
//
// R2 é compatível com a API S3 — o SDK oficial da AWS (@aws-sdk/client-s3)
// funciona direto, só trocando o endpoint.

let _client: S3Client | null = null

function envOrLocal(name: string): string {
  const v = process.env[name] || getLocalValue(name)
  if (!v) throw new Error(`${name} não configurada — defina no .env.local ou em local-data/local-access.txt (necessária para o Gerenciador de Imagens, ver specs/imagens-r2.md)`)
  return v
}

// R2_ENDPOINT é a URL completa (ex.: https://<account_id>.r2.cloudflarestorage.com,
// ou com sufixo de jurisdição tipo .eu./.fips. que a Cloudflare às vezes usa)
// exatamente como a TI fornece no bloco [r2] do rclone.conf — usada direto,
// sem tentar decompor/reconstruir a partir de um "Account ID" separado
// (achado real: a 1ª versão extraía o Account ID do endpoint via regex e
// reconstruía a URL; isso quebrava silenciosamente em qualquer formato de
// endpoint que não fosse exatamente "https://<id>.r2.cloudflarestorage.com"
// sem segmento extra). R2_ACCOUNT_ID continua aceito como alternativa (quem
// só tem o Account ID, não a URL completa — ex. configurado direto no
// .env.local) — só quando R2_ENDPOINT não está definido em nenhuma fonte.
function getEndpoint(): string {
  const direct = process.env.R2_ENDPOINT || getLocalValue('R2_ENDPOINT')
  if (direct) return direct.endsWith('/') ? direct.slice(0, -1) : direct
  return `https://${envOrLocal('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`
}

function getClient(): S3Client {
  if (_client) return _client
  _client = new S3Client({
    region: 'auto',
    endpoint: getEndpoint(),
    credentials: {
      accessKeyId: envOrLocal('R2_ACCESS_KEY_ID'),
      secretAccessKey: envOrLocal('R2_SECRET_ACCESS_KEY'),
    },
  })
  return _client
}

function getBucket(): string {
  return process.env.R2_BUCKET || getLocalValue('R2_BUCKET') || 'images-msm'
}

// Caminho-base dentro do bucket, exatamente como o manual da TI descreve —
// sempre com "/" no final. Configurável por env var/arquivo local (nunca
// hardcoded sem escape) porque o próprio nome tem espaço e acento ("Monte
// sua Máquina", "Imagens - MSM") — mais seguro deixar a grafia exata numa
// variável só, conferida uma vez, do que arriscar divergência entre código
// e bucket real (é exatamente o erro que o manual avisa: "uma letra
// maiúscula, um acento ou um espaço diferente faz a imagem sumir").
function getBasePrefix(): string {
  const raw = process.env.R2_BASE_PREFIX || getLocalValue('R2_BASE_PREFIX') || 'img/Monte sua Máquina/Imagens - MSM/'
  return raw.endsWith('/') ? raw : `${raw}/`
}

// Base da URL pública (ex.: https://images-msm.vmisecurity.com) — o manual
// enviado pela TI tem duas grafias diferentes pro mesmo domínio
// ("imagesmsm" numa tabela, "images-msm" nos exemplos), então em vez de
// chutar uma das duas, fica configurável por env var — confirme a grafia
// certa com a TI antes de preencher.
function getPublicBaseUrl(): string {
  const raw = envOrLocal('R2_PUBLIC_BASE_URL')
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

// folderPath é o caminho relativo dentro do prefixo-base, com profundidade
// livre (ex.: "Acessórios/CAMERAS", ou "Acessórios/CAMERAS/Extra") — nunca
// mais um par fixo Grupo/Subgrupo. "" (string vazia) é a raiz. Pedido
// explícito do usuário: "eu posso ter imagens em diferentes grupos e
// níveis, e não consigo ver o que está no nível acima da imagem hoje" —
// a 1ª versão desta tela assumia exatamente 2 níveis (Grupo > Subgrupo),
// o que escondia qualquer estrutura mais profunda já existente no bucket
// (criada fora do app, ex. via rclone). Navegação agora é tipo Windows
// Explorer: uma pasta por vez, com volta via breadcrumb — ver browseFolder.
function normalizeFolderPath(path: string): string {
  return path.trim().split('/').map(s => s.trim()).filter(Boolean).join('/')
}

export function buildKey(folderPath: string, fileName: string): string {
  const normalized = normalizeFolderPath(folderPath)
  return normalized ? `${getBasePrefix()}${normalized}/${fileName}` : `${getBasePrefix()}${fileName}`
}

export function buildPublicUrl(folderPath: string, fileName: string): string {
  const key = buildKey(folderPath, fileName)
  return `${getPublicBaseUrl()}/${key.split('/').map(encodeURIComponent).join('/')}`
}

// Só .png minúsculo — mesma regra do manual ("extensão .png minúscula").
// Aceita qualquer caractere no nome (espaço, acento, parênteses etc. — já
// existem arquivos reais no bucket assim, ex. "13 - BRANCO_CINZA.png",
// cadastrados fora do app via rclone), mas nunca barra, pra nunca criar um
// "subcaminho" por engano a partir de um nome de arquivo. **Histórico**: a
// 1ª versão só aceitava `[A-Za-z0-9._-]` — bug real já corrigido:
// "Remover"/"Renomear"/"Substituir" recusavam com "Pasta/arquivo inválido"
// qualquer arquivo já existente cujo nome tivesse espaço, mesmo sendo um
// nome perfeitamente válido no bucket — a tela listava a imagem
// normalmente (browseFolder não valida nome nenhum), só as ações
// recusavam agir nela.
const FILE_NAME_RE = /^[^/]+\.png$/
export function isValidFileName(name: string): boolean {
  return FILE_NAME_RE.test(name)
}

// Caminho de pasta: texto livre por segmento (acentos/espaços são
// esperados — "Acessórios", "CAMERAS"), qualquer profundidade separada por
// "/". "" (raiz) é válido. Cada segmento não pode ficar vazio nem ser "."/
// ".." — não é risco de travessia de verdade (chave do S3 é só uma string
// plana, não resolve ".." como filesystem), mas evitar isso impede nomes
// confusos na árvore.
export function isValidFolderPath(path: string): boolean {
  const trimmed = path.trim()
  if (trimmed === '') return true
  const segments = trimmed.split('/')
  return segments.every(seg => {
    const s = seg.trim()
    return s.length > 0 && s !== '.' && s !== '..'
  })
}

export interface ImageObject {
  fileName: string
  size: number
  lastModified: string | null
  url: string
}

export interface BrowseResult {
  path: string
  folders: string[]
  files: ImageObject[]
}

// Lista UM nível da árvore a partir de folderPath — pastas (CommonPrefixes)
// e arquivos (Contents) que estão diretamente dentro dela, nunca a árvore
// inteira de uma vez. No R2 (como em qualquer S3) não existe pasta de
// verdade — CommonPrefixes é só o efeito do parâmetro Delimiter agrupando
// chaves que compartilham o mesmo prefixo até a próxima barra; uma pasta só
// "existe" enquanto houver pelo menos um arquivo dentro dela (direto ou em
// subpasta). Pagina com ContinuationToken até `IsTruncated` ser falso —
// nunca assume que cabe tudo numa página só. Carregar um nível por vez (em
// vez da árvore inteira, como a 1ª versão fazia) também é mais barato: o
// bucket pode ter qualquer profundidade, então varrer tudo de uma vez não
// escala.
export async function browseFolder(folderPath: string): Promise<BrowseResult> {
  const client = getClient()
  const bucket = getBucket()
  const normalized = normalizeFolderPath(folderPath)
  const prefix = normalized ? `${getBasePrefix()}${normalized}/` : getBasePrefix()
  const folders: string[] = []
  const files: ImageObject[] = []
  let token: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
      ContinuationToken: token,
    }))
    for (const p of res.CommonPrefixes ?? []) {
      if (!p.Prefix) continue
      const name = p.Prefix.slice(prefix.length, -1)
      if (name) folders.push(name)
    }
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue
      const fileName = obj.Key.slice(prefix.length)
      if (!fileName) continue // a própria "pasta", nunca deveria vir, mas por segurança
      files.push({
        fileName,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
        url: buildPublicUrl(normalized, fileName),
      })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  folders.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  files.sort((a, b) => a.fileName.localeCompare(b.fileName, 'pt-BR', { numeric: true }))
  return { path: normalized, folders, files }
}

export async function imageExists(folderPath: string, fileName: string): Promise<boolean> {
  const client = getClient()
  try {
    await client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: buildKey(folderPath, fileName) }))
    return true
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'NotFound' || name === '404' || name === 'NoSuchKey') return false
    throw err
  }
}

export async function uploadImage(
  folderPath: string,
  fileName: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = getClient()
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: buildKey(folderPath, fileName),
    Body: body,
    ContentType: contentType,
  }))
}

// Cria uma pasta vazia — pedido explícito do usuário: "Quero conseguir
// criar uma nova pasta também" (até aqui, uma pasta só "nascia"
// implicitamente ao enviar a primeira imagem pra um caminho novo). No S3/R2
// não existe pasta de verdade (ver "Terminologia" em specs/imagens-r2.md),
// então isso é um truque padrão também usado por ferramentas tipo AWS
// Console/Cyberduck: um objeto de 0 bytes cuja chave termina em "/" —
// listado com Delimiter, essa chave vira um CommonPrefix (aparece como
// pasta em browseFolder) em vez de aparecer como arquivo. Ao navegar PRA
// DENTRO dela, o próprio marcador aparece como uma chave igual ao prefixo
// consultado (fileName vazio) — já é descartado pela checagem de
// segurança que browseFolder já tinha (`if (!fileName) continue`), então a
// pasta nova aparece corretamente vazia (0 imagens) até alguém enviar algo
// de verdade pra lá.
export async function createFolder(folderPath: string): Promise<void> {
  const normalized = normalizeFolderPath(folderPath)
  if (!normalized) throw new Error('Informe um caminho de pasta')
  const client = getClient()
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: `${getBasePrefix()}${normalized}/`,
    Body: Buffer.alloc(0),
  }))
}

// Copia um objeto pra outra chave — usado pra renomear (copy + delete do
// original, já que o S3/R2 não tem "rename" de verdade, mesma razão do
// rclone usar moveto).
export async function copyImage(
  fromFolderPath: string, fromFileName: string,
  toFolderPath: string, toFileName: string,
): Promise<void> {
  const client = getClient()
  const bucket = getBucket()
  const sourceKey = buildKey(fromFolderPath, fromFileName)
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: buildKey(toFolderPath, toFileName),
    CopySource: `${bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
  }))
}

export async function deleteImage(folderPath: string, fileName: string): Promise<void> {
  const client = getClient()
  await client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: buildKey(folderPath, fileName) }))
}

// Verifica se uma pasta tem algum conteúdo (arquivo em qualquer
// profundidade abaixo dela) — usado por renameFolder pra confirmar que a
// origem existe e que o destino ainda está livre, sem precisar listar tudo
// (MaxKeys: 1 já basta pra responder sim/não).
export async function folderHasContent(folderPath: string): Promise<boolean> {
  const normalized = normalizeFolderPath(folderPath)
  const prefix = normalized ? `${getBasePrefix()}${normalized}/` : getBasePrefix()
  const client = getClient()
  const res = await client.send(new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix, MaxKeys: 1 }))
  return (res.Contents?.length ?? 0) > 0
}

interface RawObject {
  key: string
  size: number
  lastModified: string | null
}

// Lista TODOS os objetos (qualquer profundidade, sem Delimiter) sob um
// prefixo — usado por renameFolder (que precisa mover a subárvore inteira,
// não um nível por vez como browseFolder) e por searchAll (busca global).
async function listAllObjectsUnderPrefix(prefix: string): Promise<RawObject[]> {
  const client = getClient()
  const bucket = getBucket()
  const objects: RawObject[] = []
  let token: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const obj of res.Contents ?? []) {
      if (obj.Key) objects.push({ key: obj.Key, size: obj.Size ?? 0, lastModified: obj.LastModified ? obj.LastModified.toISOString() : null })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return objects
}

// Renomeia/move uma pasta inteira (qualquer profundidade) — o R2/S3 não tem
// rename de pasta nativo (pasta não é uma entidade real, só um prefixo de
// chave), então é copiar todo o conteúdo pro prefixo novo e só então apagar
// o antigo. Pedido explícito do usuário: "Quero poder renomear uma pasta,
// é possível?"
//
// Ordem deliberada — copia TUDO primeiro, só depois apaga TUDO: se uma
// cópia no meio do caminho falhar, a função lança antes de apagar qualquer
// coisa, então a pasta de origem fica 100% intacta (seguro tentar de novo).
// Se as cópias todas derem certo mas uma remoção específica falhar, o pior
// cenário é uma sobra isolada na origem (os arquivos já estão seguros no
// destino) — nunca perda de dado.
export async function renameFolder(fromFolderPath: string, toFolderPath: string): Promise<number> {
  const fromNormalized = normalizeFolderPath(fromFolderPath)
  const toNormalized = normalizeFolderPath(toFolderPath)
  const fromPrefix = fromNormalized ? `${getBasePrefix()}${fromNormalized}/` : getBasePrefix()
  const client = getClient()
  const bucket = getBucket()

  const objects = await listAllObjectsUnderPrefix(fromPrefix)
  const keys = objects.map(o => o.key)
  const newKeys = keys.map(key => {
    const relative = key.slice(fromPrefix.length)
    return toNormalized ? `${getBasePrefix()}${toNormalized}/${relative}` : `${getBasePrefix()}${relative}`
  })

  for (let i = 0; i < keys.length; i++) {
    await client.send(new CopyObjectCommand({
      Bucket: bucket,
      Key: newKeys[i],
      CopySource: `${bucket}/${keys[i].split('/').map(encodeURIComponent).join('/')}`,
    }))
  }
  for (const key of keys) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  }
  return keys.length
}

export interface DeleteFolderResult {
  count: number
}

// Remove uma pasta inteira (qualquer profundidade) — pedido explícito do
// usuário: "Quero poder deletar uma pasta por completo." Sem cópia de
// segurança (ver "Backup automático removido" — pedido explícito do
// usuário: "não quero ter backup de nada") — apaga os originais direto.
export async function deleteFolder(folderPath: string): Promise<DeleteFolderResult> {
  const normalized = normalizeFolderPath(folderPath)
  const base = getBasePrefix()
  const prefix = normalized ? `${base}${normalized}/` : base
  const client = getClient()
  const bucket = getBucket()

  const objects = await listAllObjectsUnderPrefix(prefix)
  for (const o of objects) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.key }))
  }
  return { count: objects.length }
}

export interface SearchFileResult {
  folderPath: string
  fileName: string
  size: number
  lastModified: string | null
  url: string
}

export interface SearchResult {
  folders: string[]
  files: SearchFileResult[]
}

// Busca global (pastas + imagens) em todo o bucket, não só no nível
// navegado no momento — pedido explícito do usuário: "Quero que você
// adicione um filtro de pesquisa para todas as imagens e para todas as
// pastas também". Diferente de browseFolder (lazy, um nível por vez), isto
// é uma varredura completa deliberada sob demanda — só dispara quando o
// usuário pesquisa (nunca automaticamente ao navegar), então o custo de
// listar tudo de uma vez é aceitável aqui mesmo em buckets grandes/fundos.
//
// Uma chamada só a listAllObjectsUnderPrefix cobre as duas buscas: toda
// pasta é derivada da cadeia de diretórios de cada chave encontrada (sem
// precisar de uma segunda varredura separada pra pastas).
export async function searchAll(query: string): Promise<SearchResult> {
  const q = query.trim().toLowerCase()
  const base = getBasePrefix()
  const objects = await listAllObjectsUnderPrefix(base)
  const folderSet = new Set<string>()
  const files: SearchFileResult[] = []
  for (const obj of objects) {
    const relative = obj.key.slice(base.length)
    if (!relative) continue
    const segments = relative.split('/')
    const fileName = segments.pop()
    if (!fileName) continue
    for (let i = 1; i <= segments.length; i++) {
      folderSet.add(segments.slice(0, i).join('/'))
    }
    if (fileName.toLowerCase().includes(q)) {
      const folderPath = segments.join('/')
      files.push({ folderPath, fileName, size: obj.size, lastModified: obj.lastModified, url: buildPublicUrl(folderPath, fileName) })
    }
  }
  const folders = Array.from(folderSet)
    .filter(f => f.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  files.sort((a, b) => a.fileName.localeCompare(b.fileName, 'pt-BR', { numeric: true }))
  return { folders, files }
}
