import fs from 'fs'
import path from 'path'
import { tables, FORCE_TO_ONE_FIELDS } from './schema'
import { ALL_MODULE_KEYS } from './modules'

// Perfis de usuário do app (quem vê o quê, quem edita o quê) — arquivo local,
// mesmo padrão de local-data/real-costs.json: nunca vai pro Git, é próprio
// de cada instalação. Login aqui é só identificação (sem senha) — ver
// src/lib/appAuthContext.tsx; quem pode alterar isto é a tela de
// Configuração de Usuários, restrita a perfis com isAdmin=true.

const STORE_DIR = path.join(process.cwd(), 'local-data')
const STORE_PATH = path.join(STORE_DIR, 'user-profiles.json')

export interface UserProfile {
  id: string
  name: string
  isAdmin: boolean                              // acesso total: enxerga tudo, edita tudo, cria/exclui — ignora os campos abaixo
  canCreateDelete: boolean                       // perfis não-admin: pode inserir/excluir registros (além de editar campos liberados)
  visibleModules: string[]                       // chaves de src/lib/modules.ts
  editableFieldsByTable: Record<string, string[]> // tabela -> nomes de campo editáveis no formulário
}

// Estado de hoje, preservado tal e qual: Engenharia do Produto sem nenhuma
// restrição, Gerente Adm Comercial só com os módulos e campos de
// controladoria/preço/fiscal que já tinha liberado.
const CONTROLLERSHIP_TABLES = ['equipments', 'standard_equipment_items', 'accessories', 'dependant_items']

function defaultProfiles(): UserProfile[] {
  return [
    {
      id: 'engenharia-do-produto',
      name: 'Engenharia do Produto',
      isAdmin: true,
      canCreateDelete: true,
      visibleModules: ALL_MODULE_KEYS,
      editableFieldsByTable: {},
    },
    {
      id: 'gerente-adm-comercial',
      name: 'Gerente Adm Comercial',
      isAdmin: false,
      canCreateDelete: false,
      visibleModules: [
        'dashboard', 'explorador-relacoes', 'atualizador-global',
        'equipments', 'standard_equipment_items', 'accessories', 'custos-gerais-vmi',
        'dependant_items',
        'auditoria',
      ],
      editableFieldsByTable: Object.fromEntries(
        CONTROLLERSHIP_TABLES.map(t => [
          t,
          tables[t].fields.filter(f => FORCE_TO_ONE_FIELDS.includes(f.name)).map(f => f.name),
        ])
      ),
    },
  ]
}

function writeProfiles(profiles: UserProfile[]): void {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(profiles, null, 2), 'utf-8')
}

export function readProfiles(): UserProfile[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as UserProfile[]
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
    throw new Error('empty')
  } catch {
    const seeded = defaultProfiles()
    writeProfiles(seeded)
    return seeded
  }
}

function countAdmins(profiles: UserProfile[]): number {
  return profiles.filter(p => p.isAdmin).length
}

export function createProfile(name: string): UserProfile {
  const profiles = readProfiles()
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Nome não pode ficar em branco')
  if (profiles.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('Já existe um usuário com esse nome')
  }
  const profile: UserProfile = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    isAdmin: false,
    canCreateDelete: false,
    visibleModules: ['dashboard'],
    editableFieldsByTable: {},
  }
  profiles.push(profile)
  writeProfiles(profiles)
  return profile
}

export function updateProfile(id: string, patch: Partial<Omit<UserProfile, 'id'>>): UserProfile {
  const profiles = readProfiles()
  const idx = profiles.findIndex(p => p.id === id)
  if (idx === -1) throw new Error('Usuário não encontrado')

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (!trimmed) throw new Error('Nome não pode ficar em branco')
    if (profiles.some(p => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Já existe um usuário com esse nome')
    }
  }

  const next: UserProfile = { ...profiles[idx], ...patch, id }
  // Nunca deixa a última conta admin virar não-admin — ninguém mais
  // conseguiria abrir a Configuração de Usuários pra reverter isso.
  if (profiles[idx].isAdmin && !next.isAdmin && countAdmins(profiles) <= 1) {
    throw new Error('Não é possível remover o último administrador')
  }

  profiles[idx] = next
  writeProfiles(profiles)
  return next
}

export function deleteProfile(id: string): void {
  const profiles = readProfiles()
  const target = profiles.find(p => p.id === id)
  if (!target) throw new Error('Usuário não encontrado')
  if (profiles.length <= 1) throw new Error('Não é possível excluir o último usuário')
  if (target.isAdmin && countAdmins(profiles) <= 1) {
    throw new Error('Não é possível excluir o último administrador')
  }
  writeProfiles(profiles.filter(p => p.id !== id))
}
