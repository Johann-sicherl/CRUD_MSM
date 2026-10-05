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

function getClient(): S3Client {
  if (_client) return _client
  const accountId = envOrLocal('R2_ACCOUNT_ID')
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
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

export function buildKey(group: string, subgroup: string, fileName: string): string {
  return `${getBasePrefix()}${group}/${subgroup}/${fileName}`
}

export function buildPublicUrl(group: string, subgroup: string, fileName: string): string {
  const key = buildKey(group, subgroup, fileName)
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

// Grupo/Subgrupo: texto livre (acentos/espaços são esperados — "Acessórios",
// "CAMERAS"), só proíbe barra (quebraria a estrutura de chave) e nome vazio
// depois de aparar espaço.
export function isValidSegmentName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length > 0 && !trimmed.includes('/')
}

export interface ImageSubgroupNode {
  name: string
  count: number
}

export interface ImageGroupNode {
  name: string
  subgroups: ImageSubgroupNode[]
}

export interface ImageObject {
  fileName: string
  size: number
  lastModified: string | null
  url: string
}

// Lista todas as "pastas" de 1º nível sob o prefixo-base — no R2 (como em
// qualquer S3) não existe pasta de verdade, CommonPrefixes é só o efeito do
// parâmetro Delimiter agrupando chaves que compartilham o mesmo prefixo até
// a próxima barra. Pagina com ContinuationToken até `IsTruncated` ser falso
// — nunca assume que cabe tudo numa página só.
async function listCommonPrefixes(prefix: string): Promise<string[]> {
  const client = getClient()
  const bucket = getBucket()
  const prefixes: string[] = []
  let token: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
      ContinuationToken: token,
    }))
    for (const p of res.CommonPrefixes ?? []) {
      if (p.Prefix) prefixes.push(p.Prefix)
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return prefixes
}

async function countObjects(prefix: string): Promise<number> {
  const client = getClient()
  const bucket = getBucket()
  let total = 0
  let token: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
      ContinuationToken: token,
    }))
    total += (res.Contents ?? []).length
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return total
}

// Árvore Grupo → Subgrupo + contagem de imagens, 100% derivada do bucket ao
// vivo — não existe tabela local de "grupos cadastrados": no R2 a pasta só
// existe enquanto houver arquivo dentro dela (mesma frase do manual da
// TI), então manter uma lista separada no Supabase só criaria uma segunda
// fonte de verdade que pode divergir da real. "Criar um grupo/subgrupo
// novo" = digitar um nome novo na hora de enviar a primeira imagem (ver
// uploadImage) — a pasta passa a existir no mesmo instante.
export async function listGroupsTree(): Promise<ImageGroupNode[]> {
  const base = getBasePrefix()
  const groupPrefixes = await listCommonPrefixes(base)
  const groups: ImageGroupNode[] = []
  for (const groupPrefix of groupPrefixes) {
    const groupName = groupPrefix.slice(base.length, -1)
    const subgroupPrefixes = await listCommonPrefixes(groupPrefix)
    const subgroups: ImageSubgroupNode[] = []
    for (const subgroupPrefix of subgroupPrefixes) {
      const subgroupName = subgroupPrefix.slice(groupPrefix.length, -1)
      const count = await countObjects(subgroupPrefix)
      subgroups.push({ name: subgroupName, count })
    }
    subgroups.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    groups.push({ name: groupName, subgroups })
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return groups
}

export async function listImages(group: string, subgroup: string): Promise<ImageObject[]> {
  const client = getClient()
  const bucket = getBucket()
  const prefix = `${getBasePrefix()}${group}/${subgroup}/`
  const images: ImageObject[] = []
  let token: string | undefined
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
      ContinuationToken: token,
    }))
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue
      const fileName = obj.Key.slice(prefix.length)
      if (!fileName) continue // a própria "pasta", nunca deveria vir, mas por segurança
      images.push({
        fileName,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
        url: buildPublicUrl(group, subgroup, fileName),
      })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  images.sort((a, b) => a.fileName.localeCompare(b.fileName, 'pt-BR', { numeric: true }))
  return images
}

export async function imageExists(group: string, subgroup: string, fileName: string): Promise<boolean> {
  const client = getClient()
  try {
    await client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: buildKey(group, subgroup, fileName) }))
    return true
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'NotFound' || name === '404' || name === 'NoSuchKey') return false
    throw err
  }
}

export async function uploadImage(
  group: string,
  subgroup: string,
  fileName: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = getClient()
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: buildKey(group, subgroup, fileName),
    Body: body,
    ContentType: contentType,
  }))
}

// Copia um objeto pra outra chave — usado tanto pra renomear (copy + delete
// do original, já que o S3/R2 não tem "rename" de verdade, mesma razão do
// rclone usar moveto) quanto pra guardar uma cópia de segurança antes de
// substituir/remover (ver backupImage abaixo).
export async function copyImage(
  fromGroup: string, fromSubgroup: string, fromFileName: string,
  toGroup: string, toSubgroup: string, toFileName: string,
): Promise<void> {
  const client = getClient()
  const bucket = getBucket()
  const sourceKey = buildKey(fromGroup, fromSubgroup, fromFileName)
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: buildKey(toGroup, toSubgroup, toFileName),
    CopySource: `${bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
  }))
}

export async function deleteImage(group: string, subgroup: string, fileName: string): Promise<void> {
  const client = getClient()
  await client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: buildKey(group, subgroup, fileName) }))
}

// Backup automático antes de substituir/remover — o manual da TI pede isso
// como passo manual ("guarde uma cópia da versão atual"); aqui é automático
// a cada substituição/remoção, pra nunca depender de alguém lembrar de
// fazer isso na hora. Grava dentro do próprio bucket, num prefixo
// `_backup/<group>/<subgroup>/<timestamp>-<fileName>` — fora da árvore
// Grupo/Subgrupo normal (não aparece em listGroupsTree, que só varre o
// prefixo-base), então nunca é confundido com uma imagem "em uso" pela
// aplicação.
export async function backupImage(group: string, subgroup: string, fileName: string): Promise<string | null> {
  const exists = await imageExists(group, subgroup, fileName)
  if (!exists) return null
  const client = getClient()
  const bucket = getBucket()
  const sourceKey = buildKey(group, subgroup, fileName)
  const backupKey = `_backup/${group}/${subgroup}/${Date.now()}-${fileName}`
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: backupKey,
    CopySource: `${bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
  }))
  return backupKey
}
