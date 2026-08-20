import fs from 'fs'
import path from 'path'
import { supabaseAdmin } from './supabase'
import { tables, FORCE_TO_ONE_FIELDS } from './schema'
import { ALL_MODULE_KEYS } from './modules'

// Perfis de usuário do app (quem loga, com que senha, quem vê/edita o quê) —
// ficam na tabela user_profiles do Supabase (ver msm_user_profiles.sql), não
// mais num arquivo local: assim qualquer máquina que rode o app enxerga os
// mesmos usuários e permissões. A senha fica em texto puro na coluna
// `password` — pedido explícito, sem hash (ver conversa no app: usuário
// pediu senha simples em vez de hash, ciente do risco).

const LEGACY_STORE_PATH = path.join(process.cwd(), 'local-data', 'user-profiles.json')

export interface UserProfile {
  id: string
  name: string
  isAdmin: boolean                              // acesso total: enxerga tudo, edita tudo, cria/exclui — ignora os campos abaixo
  canCreateDelete: boolean                       // perfis não-admin: pode inserir/excluir registros (além de editar campos liberados)
  visibleModules: string[]                       // chaves de src/lib/modules.ts
  editableFieldsByTable: Record<string, string[]> // tabela -> nomes de campo editáveis no formulário
}

interface ProfileRow {
  id: string
  name: string
  password: string
  is_admin: boolean
  can_create_delete: boolean
  visible_modules: string[]
  editable_fields_by_table: Record<string, string[]>
}

function fromRow(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    isAdmin: row.is_admin,
    canCreateDelete: row.can_create_delete,
    visibleModules: row.visible_modules ?? [],
    editableFieldsByTable: row.editable_fields_by_table ?? {},
  }
}

// Estado de hoje, preservado tal e qual: Engenharia do Produto sem nenhuma
// restrição, Gerente Adm Comercial só com os módulos e campos de
// controladoria/preço/fiscal que já tinha liberado.
const CONTROLLERSHIP_TABLES = ['equipments', 'standard_equipment_items', 'accessories', 'dependant_items']

function hardcodedDefaults(): Omit<ProfileRow, 'password'>[] {
  return [
    {
      id: 'engenharia-do-produto',
      name: 'Engenharia do Produto',
      is_admin: true,
      can_create_delete: true,
      visible_modules: ALL_MODULE_KEYS,
      editable_fields_by_table: {},
    },
    {
      id: 'gerente-adm-comercial',
      name: 'Gerente Adm Comercial',
      is_admin: false,
      can_create_delete: false,
      visible_modules: [
        'dashboard', 'explorador-relacoes', 'atualizador-global',
        'equipments', 'standard_equipment_items', 'accessories', 'custos-gerais-vmi',
        'dependant_items',
        'auditoria',
      ],
      editable_fields_by_table: Object.fromEntries(
        CONTROLLERSHIP_TABLES.map(t => [
          t,
          tables[t].fields.filter(f => FORCE_TO_ONE_FIELDS.includes(f.name)).map(f => f.name),
        ])
      ),
    },
  ]
}

// Primeira vez que a tabela user_profiles é lida vazia: se esta máquina
// ainda tem o arquivo local antigo (de antes da migração pro Supabase),
// reaproveita os módulos/campos já configurados nele em vez de perder esse
// ajuste — só falta senha, que nunca existiu ali, então entra "1234" nos
// dois casos. Sem o arquivo, cai nos padrões de sempre.
function seedSource(): Omit<ProfileRow, 'password'>[] {
  try {
    const raw = fs.readFileSync(LEGACY_STORE_PATH, 'utf-8')
    const legacy = JSON.parse(raw) as UserProfile[]
    if (Array.isArray(legacy) && legacy.length > 0) {
      return legacy.map(p => ({
        id: p.id,
        name: p.name,
        is_admin: p.isAdmin,
        can_create_delete: p.canCreateDelete,
        visible_modules: p.visibleModules,
        editable_fields_by_table: p.editableFieldsByTable,
      }))
    }
  } catch { /* sem arquivo legado — segue com os padrões de sempre */ }
  return hardcodedDefaults()
}

async function seedDefaultProfiles(): Promise<ProfileRow[]> {
  const seed = seedSource().map(p => ({ ...p, password: '1234' }))
  const { data, error } = await supabaseAdmin.from('user_profiles').insert(seed).select()
  if (error) throw new Error(error.message)
  return data as ProfileRow[]
}

export async function readProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabaseAdmin.from('user_profiles').select('*').order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  if (data && data.length > 0) return (data as ProfileRow[]).map(fromRow)
  const seeded = await seedDefaultProfiles()
  return seeded.map(fromRow)
}

function countAdmins(rows: { is_admin: boolean }[]): number {
  return rows.filter(r => r.is_admin).length
}

async function assertNameFree(name: string, excludeId?: string): Promise<void> {
  let query = supabaseAdmin.from('user_profiles').select('id').ilike('name', name)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  if (data && data.length > 0) throw new Error('Já existe um usuário com esse nome')
}

export async function createProfile(name: string, password: string): Promise<UserProfile> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Nome não pode ficar em branco')
  if (!password || password.length < 4) throw new Error('Senha deve ter pelo menos 4 caracteres')
  await assertNameFree(trimmed)

  const row = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    password,
    is_admin: false,
    can_create_delete: false,
    visible_modules: ['dashboard'],
    editable_fields_by_table: {},
  }
  const { data, error } = await supabaseAdmin.from('user_profiles').insert(row).select().single()
  if (error) throw new Error(error.message)
  return fromRow(data as ProfileRow)
}

export async function updateProfile(
  id: string,
  patch: Partial<Omit<UserProfile, 'id'>> & { password?: string },
): Promise<UserProfile> {
  const { data: currentData, error: fetchErr } = await supabaseAdmin.from('user_profiles').select('*').eq('id', id).maybeSingle()
  if (fetchErr) throw new Error(fetchErr.message)
  if (!currentData) throw new Error('Usuário não encontrado')
  const current = currentData as ProfileRow

  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (!trimmed) throw new Error('Nome não pode ficar em branco')
    await assertNameFree(trimmed, id)
    dbPatch.name = trimmed
  }
  if (patch.isAdmin !== undefined) dbPatch.is_admin = patch.isAdmin
  if (patch.canCreateDelete !== undefined) dbPatch.can_create_delete = patch.canCreateDelete
  if (patch.visibleModules !== undefined) dbPatch.visible_modules = patch.visibleModules
  if (patch.editableFieldsByTable !== undefined) dbPatch.editable_fields_by_table = patch.editableFieldsByTable
  if (patch.password) {
    if (patch.password.length < 4) throw new Error('Senha deve ter pelo menos 4 caracteres')
    dbPatch.password = patch.password
  }

  // Nunca deixa a última conta admin virar não-admin — ninguém mais
  // conseguiria abrir a Configuração de Usuários pra reverter isso.
  if (current.is_admin && patch.isAdmin === false) {
    const { data: allRows, error: allErr } = await supabaseAdmin.from('user_profiles').select('is_admin')
    if (allErr) throw new Error(allErr.message)
    if (countAdmins(allRows ?? [])  <= 1) throw new Error('Não é possível remover o último administrador')
  }

  const { data, error } = await supabaseAdmin.from('user_profiles').update(dbPatch).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return fromRow(data as ProfileRow)
}

export async function deleteProfile(id: string): Promise<void> {
  const { data: allRows, error } = await supabaseAdmin.from('user_profiles').select('id, is_admin')
  if (error) throw new Error(error.message)
  const rows = allRows ?? []
  const target = rows.find(r => r.id === id)
  if (!target) throw new Error('Usuário não encontrado')
  if (rows.length <= 1) throw new Error('Não é possível excluir o último usuário')
  if (target.is_admin && countAdmins(rows) <= 1) throw new Error('Não é possível excluir o último administrador')

  const { error: delErr } = await supabaseAdmin.from('user_profiles').delete().eq('id', id)
  if (delErr) throw new Error(delErr.message)
}

// Verifica usuário + senha no login — nunca devolve nada em caso de senha
// errada ou perfil inexistente (mesma mensagem genérica pros dois casos, pra
// não dar dica de quais nomes existem via tentativa e erro).
export async function verifyLogin(id: string, password: string): Promise<UserProfile | null> {
  const { data, error } = await supabaseAdmin.from('user_profiles').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  const row = data as ProfileRow
  if (row.password !== password) return null
  return fromRow(row)
}
