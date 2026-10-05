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
// Aceita ponto/letra/número/hífen/underscore no nome (os códigos Protheus
// são cheios de ponto, ex. "27.02.00683.png"), mas nunca barra, pra nunca
// criar um "subcaminho" por engano a partir de um nome de arquivo.
const FILE_NAME_RE = /^[A-Za-z0-9._-]+\.png$/
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

// Copia um objeto pra outra chave — usado tanto pra renomear (copy + delete
// do original, já que o S3/R2 não tem "rename" de verdade, mesma razão do
// rclone usar moveto) quanto pra guardar uma cópia de segurança antes de
// substituir/remover (ver backupImage abaixo).
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

// Backup automático antes de substituir/remover — o manual da TI pede isso
// como passo manual ("guarde uma cópia da versão atual"); aqui é automático
// a cada substituição/remoção, pra nunca depender de alguém lembrar de
// fazer isso na hora. Grava dentro do próprio bucket, num prefixo
// `_backup/<folderPath>/<timestamp>-<fileName>` — fora da árvore navegável
// normal (nunca aparece em browseFolder, que só varre o prefixo-base),
// então nunca é confundido com uma imagem "em uso" pela aplicação.
export async function backupImage(folderPath: string, fileName: string): Promise<string | null> {
  const exists = await imageExists(folderPath, fileName)
  if (!exists) return null
  const client = getClient()
  const bucket = getBucket()
  const sourceKey = buildKey(folderPath, fileName)
  const normalized = normalizeFolderPath(folderPath)
  const backupKey = `_backup/${normalized ? `${normalized}/` : ''}${Date.now()}-${fileName}`
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: backupKey,
    CopySource: `${bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
  }))
  return backupKey
}
