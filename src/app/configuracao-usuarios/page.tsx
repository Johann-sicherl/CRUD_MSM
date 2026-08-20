'use client'

import { useCallback, useEffect, useState } from 'react'
import { tables, getFormEditableFields } from '@/lib/schema'
import { MODULES, MODULE_GROUPS } from '@/lib/modules'
import { useAppAuth } from '@/lib/appAuthContext'

interface UserProfile {
  id: string
  name: string
  isAdmin: boolean
  canCreateDelete: boolean
  visibleModules: string[]
  editableFieldsByTable: Record<string, string[]>
}

export default function ConfiguracaoUsuariosPage() {
  const { user, refresh } = useAppAuth()
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<UserProfile | null>(null)
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  // Campo "Nova senha" do editor — nunca vem preenchido do servidor (a senha
  // não trafega de volta em nenhuma hipótese), em branco = não altera.
  const [passwordDraft, setPasswordDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null)

  const showToast = (msg: string, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchProfiles = useCallback(async (selectAfter?: string) => {
    setLoading(true)
    try {
      const res = await fetch('/api/user-profiles')
      const json = await res.json()
      const list: UserProfile[] = json.profiles || []
      setProfiles(list)
      const idToSelect = selectAfter ?? selectedId ?? list[0]?.id ?? null
      const found = list.find(p => p.id === idToSelect) ?? list[0] ?? null
      setSelectedId(found?.id ?? null)
      setDraft(found ? { ...found, visibleModules: [...found.visibleModules], editableFieldsByTable: { ...found.editableFieldsByTable } } : null)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fetchProfiles() }, [fetchProfiles])

  const selectProfile = (id: string) => {
    const p = profiles.find(p => p.id === id)
    setSelectedId(id)
    setDraft(p ? { ...p, visibleModules: [...p.visibleModules], editableFieldsByTable: { ...p.editableFieldsByTable } } : null)
    setPasswordDraft('')
    setError('')
  }

  const toggleModule = (key: string) => {
    setDraft(d => !d ? d : {
      ...d,
      visibleModules: d.visibleModules.includes(key)
        ? d.visibleModules.filter(k => k !== key)
        : [...d.visibleModules, key],
    })
  }

  const toggleField = (table: string, field: string) => {
    setDraft(d => {
      if (!d) return d
      const cur = new Set(d.editableFieldsByTable[table] ?? [])
      cur.has(field) ? cur.delete(field) : cur.add(field)
      return { ...d, editableFieldsByTable: { ...d.editableFieldsByTable, [table]: Array.from(cur) } }
    })
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name || newPassword.length < 4) return
    const res = await fetch('/api/user-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password: newPassword }),
    })
    const json = await res.json()
    if (!res.ok) { showToast(json.error || 'Erro ao criar usuário', true); return }
    setNewName('')
    setNewPassword('')
    await fetchProfiles(json.id)
    showToast(`Usuário "${name}" criado`)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Excluir o usuário "${name}"? Essa ação não pode ser desfeita.`)) return
    const res = await fetch(`/api/user-profiles/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) { showToast(json.error || 'Erro ao excluir usuário', true); return }
    await fetchProfiles()
    showToast(`Usuário "${name}" excluído`)
  }

  const handleSave = async () => {
    if (!draft) return
    if (passwordDraft && passwordDraft.length < 4) { setError('Senha deve ter pelo menos 4 caracteres'); return }
    setSaving(true)
    setError('')
    const res = await fetch(`/api/user-profiles/${draft.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(passwordDraft ? { ...draft, password: passwordDraft } : draft),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error || 'Erro ao salvar'); return }
    setPasswordDraft('')
    await fetchProfiles(draft.id)
    if (draft.id === user.id) await refresh()
    showToast('Alterações salvas')
  }

  if (!user.isAdmin) {
    return (
      <div className="p-8">
        <div className="bg-error-container/20 border border-error/30 text-error rounded-lg px-5 py-4 text-sm">
          Acesso restrito a administradores.
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 flex flex-col gap-4">
      <div>
        <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Administração · configuracao-usuarios
        </div>
        <h1 className="text-2xl font-bold text-on-surface">Configuração de Usuários</h1>
        <p className="text-on-surface-variant text-sm mt-1">
          Selecione um usuário para ver e editar a senha, quais módulos ele enxerga e quais colunas pode editar no formulário.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-outline gap-3">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-mono">Carregando...</span>
        </div>
      ) : (
        <div className="flex gap-5 items-start">
          {/* Lista de usuários */}
          <div className="w-72 shrink-0 bg-surface-container rounded border border-outline-variant overflow-hidden">
            <div className="flex flex-col divide-y divide-outline-variant/40">
              {profiles.map(p => (
                <button
                  key={p.id}
                  onClick={() => selectProfile(p.id)}
                  className={`flex items-center justify-between gap-2 px-4 py-3 text-left text-sm transition-colors ${
                    selectedId === p.id ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  {p.isAdmin && (
                    <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary">ADMIN</span>
                  )}
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-outline-variant flex flex-col gap-2">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
                placeholder="Nome do novo usuário"
                className="w-full bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
                  placeholder="Senha (mín. 4 caracteres)"
                  className="flex-1 min-w-0 bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || newPassword.length < 4}
                  className="shrink-0 px-3 py-1.5 bg-primary text-on-primary rounded text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-neon transition-shadow"
                >
                  + Adicionar
                </button>
              </div>
            </div>
          </div>

          {/* Editor */}
          {draft && (
            <div className="flex-1 min-w-0 bg-surface-container rounded border border-outline-variant p-5 flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={draft.name}
                  onChange={e => setDraft(d => d && { ...d, name: e.target.value })}
                  className="flex-1 min-w-0 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm font-semibold text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
                <button
                  onClick={() => handleDelete(draft.id, draft.name)}
                  className="shrink-0 px-3 py-2 text-sm border border-error/40 text-error hover:bg-error-container/20 rounded transition-colors"
                >
                  Excluir usuário
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">Nova senha</label>
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={e => setPasswordDraft(e.target.value)}
                  placeholder="Deixe em branco para manter a senha atual"
                  className="w-full max-w-xs bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.isAdmin}
                  onChange={e => setDraft(d => d && { ...d, isAdmin: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  <strong>Administrador</strong> — acesso total: enxerga e edita tudo, cria e exclui registros em qualquer tabela, e acessa esta tela de Configuração de Usuários. Ignora as opções abaixo.
                </span>
              </label>

              {!draft.isAdmin && (
                <>
                  <label className="flex items-start gap-2 text-sm text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.canCreateDelete}
                      onChange={e => setDraft(d => d && { ...d, canCreateDelete: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>Pode criar e excluir registros (nos módulos visíveis abaixo) — além de editar os campos liberados.</span>
                  </label>

                  <section>
                    <h2 className="text-sm font-semibold text-on-surface mb-2">Módulos visíveis</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {MODULE_GROUPS.map(group => (
                        <div key={group} className="bg-surface-container-low rounded border border-outline-variant p-3">
                          <div className="text-[10px] font-semibold text-outline uppercase tracking-[0.12em] font-mono mb-1.5">{group}</div>
                          <div className="flex flex-col gap-1">
                            {MODULES.filter(m => m.group === group).map(m => (
                              <label key={m.key} className="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={draft.visibleModules.includes(m.key)}
                                  onChange={() => toggleModule(m.key)}
                                />
                                <span className="truncate">{m.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h2 className="text-sm font-semibold text-on-surface mb-2">Colunas editáveis por tabela (no formulário)</h2>
                    <p className="text-xs text-outline mb-2">
                      Só tabelas marcadas como visíveis acima aparecem aqui. Nenhuma coluna marcada = o usuário só visualiza, não edita nada nessa tabela.
                    </p>
                    <div className="flex flex-col gap-2">
                      {Object.entries(tables)
                        .filter(([key]) => draft.visibleModules.includes(key))
                        .map(([key, schema]) => {
                          const fields = getFormEditableFields(schema)
                          const checkedSet = new Set(draft.editableFieldsByTable[key] ?? [])
                          return (
                            <details key={key} className="bg-surface-container-low rounded border border-outline-variant">
                              <summary className="px-3 py-2 text-sm text-on-surface cursor-pointer select-none">
                                {schema.label}
                                {checkedSet.size > 0 && (
                                  <span className="ml-2 text-[10px] font-mono text-primary">{checkedSet.size} campo{checkedSet.size !== 1 ? 's' : ''}</span>
                                )}
                              </summary>
                              <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                                {fields.map(f => (
                                  <label key={f.name} className="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checkedSet.has(f.name)}
                                      onChange={() => toggleField(key, f.name)}
                                    />
                                    <span className="truncate">{f.label}</span>
                                  </label>
                                ))}
                              </div>
                            </details>
                          )
                        })}
                    </div>
                  </section>
                </>
              )}

              {error && (
                <div className="flex items-center gap-2 bg-error-container/30 text-error text-sm px-4 py-3 rounded border border-error/20">
                  ⚠ {error}
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-outline-variant">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-60 transition-shadow"
                >
                  {saving
                    ? <><span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" /> Salvando...</>
                    : 'Salvar Alterações'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-lg shadow-lg text-sm animate-fade-in border ${
          toast.isError
            ? 'bg-error-container border-error/30 text-on-error-container'
            : 'bg-surface-container-highest border-outline-variant text-on-surface'
        }`}>
          {toast.isError ? '✕' : '✓'} {toast.msg}
        </div>
      )}
    </div>
  )
}
