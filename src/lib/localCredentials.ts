import fs from 'fs'
import path from 'path'

// Arquivo local, só nesta máquina, nunca commitado (local-data/ está no
// .gitignore) — onde o usuário guarda à mão as credenciais que ele mesmo
// digitaria nos pop-ups de login do Protheus/PDM e as chaves do bucket R2
// (ver local-access.example.txt na raiz do projeto pro formato exato).
// Pedido explícito do usuário: "é possível puxar do ambiente local o
// usuário de acesso ao banco de dados do Protheus e do PDM?... crie um
// arquivo .txt único". Só leitura — o app nunca escreve neste arquivo, só
// o próprio usuário edita.
//
// Nunca cacheado em memória: o arquivo é pequeno e pode ser editado à mão
// entre uma tentativa de login e outra (ex.: usuário corrige uma senha
// digitada errada) — relê do disco em toda chamada, pra nunca servir um
// valor desatualizado.

const FILE_PATH = path.join(process.cwd(), 'local-data', 'local-access.txt')

// Pedido explícito do usuário: a seção R2 do arquivo usa o mesmo formato do
// rclone.conf (chaves em minúsculo, "=" com espaço nos dois lados, dentro
// de "[r2]") — assim dá pra colar direto a configuração que já existe no
// rclone, sem reescrever à mão. Mapeia as chaves padrão do rclone pros
// nomes internos que r2Images.ts já lê via getLocalValue. Protheus/PDM
// continuam fora de seção, formato flat de sempre (PROTHEUS_USER=...).
// Mapeamento direto, sem nenhuma tentativa de decompor/reconstruir valor —
// "endpoint" é guardado como R2_ENDPOINT, igual ao texto que a TI forneceu,
// e r2Images.ts usa essa URL direto (ver getEndpoint() lá). Achado real: a
// 1ª versão tentava extrair um "Account ID" do endpoint via regex e
// reconstruía a URL a partir dele — quebrava silenciosamente sempre que o
// endpoint real não batia exatamente com o formato esperado pelo regex
// (ex.: sufixo de jurisdição .eu./.fips. que a Cloudflare às vezes usa).
// Guardar o valor como veio evita essa classe inteira de bug.
const R2_SECTION_KEY_MAP: Record<string, string> = {
  access_key_id: 'R2_ACCESS_KEY_ID',
  secret_access_key: 'R2_SECRET_ACCESS_KEY',
  endpoint: 'R2_ENDPOINT',
  bucket: 'R2_BUCKET',
  public_base_url: 'R2_PUBLIC_BASE_URL',
  base_prefix: 'R2_BASE_PREFIX',
}

function parseLocalAccessFile(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  let section = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    const sectionMatch = trimmed.match(/^\[(\w+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase()
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!key) continue

    if (section === 'r2') {
      const mapped = R2_SECTION_KEY_MAP[key.toLowerCase()]
      if (mapped) result[mapped] = value
      // demais chaves do rclone (type, provider, region, no_check_bucket)
      // são só informativas aqui — não usadas por r2Images.ts, ignoradas.
      continue
    }

    result[key] = value
  }
  return result
}

export function readLocalAccess(): Record<string, string> {
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf-8')
    return parseLocalAccessFile(raw)
  } catch {
    return {} // arquivo ainda não existe (usuário não criou, ou renomeou errado) — vazio é um estado válido
  }
}

export interface LocalDbCreds { user: string; password: string }

export function getLocalProtheusCreds(): LocalDbCreds | null {
  const data = readLocalAccess()
  if (!data.PROTHEUS_USER || !data.PROTHEUS_PASSWORD) return null
  return { user: data.PROTHEUS_USER, password: data.PROTHEUS_PASSWORD }
}

export function getLocalPdmCreds(): LocalDbCreds | null {
  const data = readLocalAccess()
  if (!data.PDM_USER || !data.PDM_PASSWORD) return null
  return { user: data.PDM_USER, password: data.PDM_PASSWORD }
}

// Usado por r2Images.ts como alternativa às variáveis de ambiente — a
// mesma chave (ex. "R2_ACCOUNT_ID") pode vir de .env.local OU deste
// arquivo; .env.local tem prioridade quando as duas existirem, pra nunca
// mudar o comportamento de quem já configurou em produção (ver
// specs/imagens-r2.md).
export function getLocalValue(key: string): string | undefined {
  const data = readLocalAccess()
  return data[key] || undefined
}
