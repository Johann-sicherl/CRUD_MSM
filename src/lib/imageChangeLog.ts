import { supabaseAdmin } from './supabase'
import type { UserProfile } from './userProfileStore'

// Log de alterações da tela "Grupos de Imagens" (ver msm_image_change_log.sql)
// — equivalente automático do passo manual "Registre a alteração na seção
// 13" do manual da TI. Best-effort, mesmo espírito de record*Audit
// (sqlAudit.ts): uma falha ao gravar o log nunca deve impedir a operação
// real no bucket, que já terminou com sucesso quando isto é chamado.

export type ImageChangeAction = 'upload' | 'replace' | 'rename' | 'delete'

export interface ImageChangeEntry {
  action: ImageChangeAction
  group: string
  subgroup: string
  fileName: string
  toGroup?: string
  toSubgroup?: string
  toFileName?: string
  backupKey?: string | null
  profile: UserProfile | null
}

export async function recordImageChange(entry: ImageChangeEntry): Promise<void> {
  await supabaseAdmin.from('image_change_log').insert({
    action: entry.action,
    group_name: entry.group,
    subgroup_name: entry.subgroup,
    file_name: entry.fileName,
    to_group_name: entry.toGroup ?? null,
    to_subgroup_name: entry.toSubgroup ?? null,
    to_file_name: entry.toFileName ?? null,
    backup_key: entry.backupKey ?? null,
    profile_id: entry.profile?.id ?? null,
    profile_name: entry.profile?.name ?? null,
  })
}
