import { supabaseAdmin } from './supabase'
import type { UserProfile } from './userProfileStore'

// Log de alterações da tela "Grupos de Imagens" (ver msm_image_change_log.sql)
// — equivalente automático do passo manual "Registre a alteração na seção
// 13" do manual da TI. Best-effort, mesmo espírito de record*Audit
// (sqlAudit.ts): uma falha ao gravar o log nunca deve impedir a operação
// real no bucket, que já terminou com sucesso quando isto é chamado.

export type ImageChangeAction = 'upload' | 'replace' | 'rename' | 'delete'

// folderPath é o caminho completo da pasta (profundidade livre — ver
// r2Images.ts), não mais um par fixo Grupo/Subgrupo. group_name/
// subgroup_name (colunas antigas, ver msm_image_change_log_folder_path.sql)
// não são mais escritos — ficam só como histórico das linhas gravadas
// antes dessa mudança.
export interface ImageChangeEntry {
  action: ImageChangeAction
  folderPath: string
  fileName: string
  toFolderPath?: string
  toFileName?: string
  backupKey?: string | null
  profile: UserProfile | null
}

export async function recordImageChange(entry: ImageChangeEntry): Promise<void> {
  await supabaseAdmin.from('image_change_log').insert({
    action: entry.action,
    folder_path: entry.folderPath,
    file_name: entry.fileName,
    to_folder_path: entry.toFolderPath ?? null,
    to_file_name: entry.toFileName ?? null,
    backup_key: entry.backupKey ?? null,
    profile_id: entry.profile?.id ?? null,
    profile_name: entry.profile?.name ?? null,
  })
}
