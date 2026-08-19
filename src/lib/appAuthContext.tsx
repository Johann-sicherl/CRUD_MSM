'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { UserProfile } from './userProfileStore'

// Portão de acesso ao app inteiro — diferente do ProtheusAuthProvider (que só
// pede credenciais do SQL Server do Protheus, é opcional/dispensável e não
// bloqueia nada). Aqui, nada do app (Sidebar, telas, dados do Supabase) é
// renderizado até logar — por construção, não tem "fundo" pra vazar atrás da
// tela de login. Sem senha nenhuma — é só identificação de perfil, cujas
// permissões (módulos visíveis, campos editáveis) são configuradas pela
// tela de Configuração de Usuários (acessível a quem é isAdmin) e ficam
// guardadas no servidor (ver src/lib/userProfileStore.ts), não no bundle.
// `import type` acima é apagado na compilação — não puxa 'fs' pro bundle do
// cliente, só o formato do objeto.

export interface AppUser extends UserProfile {
  label: string // alias de name, só pra leitura na UI (Sidebar etc.)
}

const STORAGE_KEY = 'app-auth-user-id'

interface AppAuthValue {
  user: AppUser
  logout: () => void
  refresh: () => Promise<void>
}

const AppAuthContext = createContext<AppAuthValue | null>(null)

export function useAppAuth(): AppAuthValue {
  const ctx = useContext(AppAuthContext)
  if (!ctx) throw new Error('useAppAuth must be used within AppAuthProvider')
  return ctx
}

async function fetchAllProfiles(): Promise<UserProfile[]> {
  const res = await fetch('/api/user-profiles')
  if (!res.ok) throw new Error('Falha ao carregar perfis')
  const json = await res.json()
  return (json.profiles || []) as UserProfile[]
}

function toAppUser(p: UserProfile): AppUser {
  return { ...p, label: p.name }
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]         = useState<AppUser | null>(null)
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [checked, setChecked]   = useState(false)
  const [error, setError]       = useState('')

  // sessionStorage (não localStorage): sobrevive a um F5, mas pede login de
  // novo se fechar a aba/navegador — evita ficar logado pra sempre num PC
  // compartilhado, sem exigir logar toda hora que atualiza a página.
  useEffect(() => {
    let cancelled = false
    fetchAllProfiles()
      .then(all => {
        if (cancelled) return
        setProfiles(all)
        const storedId = sessionStorage.getItem(STORAGE_KEY)
        const found = storedId ? all.find(p => p.id === storedId) : undefined
        if (found) setUser(toAppUser(found))
        else if (storedId) sessionStorage.removeItem(STORAGE_KEY) // perfil excluído — volta pro login
      })
      .catch(() => { if (!cancelled) setError('Não foi possível carregar os perfis de usuário') })
      .finally(() => { if (!cancelled) setChecked(true) })
    return () => { cancelled = true }
  }, [])

  const login = (id: string) => {
    const entry = profiles.find(p => p.id === id)
    if (!entry) return
    setUser(toAppUser(entry))
    sessionStorage.setItem(STORAGE_KEY, id)
  }

  const logout = () => {
    setUser(null)
    sessionStorage.removeItem(STORAGE_KEY)
  }

  // Recarrega as permissões do perfil atual do servidor — usado depois que
  // um admin edita o próprio perfil na Configuração de Usuários, pra sidebar
  // e telas refletirem na hora, sem precisar de F5.
  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const all = await fetchAllProfiles()
      const found = all.find(p => p.id === user.id)
      if (found) setUser(toAppUser(found))
      else { setUser(null); sessionStorage.removeItem(STORAGE_KEY) } // o próprio perfil foi excluído nesse meio-tempo
    } catch { /* melhor esforço — mantém as permissões já carregadas se falhar */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Enquanto ainda não checou o sessionStorage/perfis, não mostra nada (nem
  // a tela de login nem o app) pra não "piscar" a tela de login antes de
  // restaurar uma sessão já existente.
  if (!checked) return null

  if (!user) return <LoginScreen profiles={profiles} error={error} onLogin={login} />

  return (
    <AppAuthContext.Provider value={{ user, logout, refresh }}>
      {children}
    </AppAuthContext.Provider>
  )
}

function LoginScreen({ profiles, error, onLogin }: { profiles: UserProfile[]; error: string; onLogin: (id: string) => void }) {
  const [selected, setSelected] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (selected) onLogin(selected)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">Entrar — MSM Admin</h2>
        </div>
        <form className="p-5 flex flex-col gap-3" onSubmit={handleSubmit}>
          <p className="text-sm text-on-surface-variant">
            Selecione seu perfil para acessar o painel.
          </p>
          <label className="text-xs font-semibold text-on-surface-variant">
            Perfil
            <select
              autoFocus
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            >
              <option value="">Selecione...</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-xs text-error">{error}</p>}
          {!error && profiles.length === 0 && <p className="text-xs text-outline">Carregando perfis...</p>}
          <div className="flex items-center justify-end mt-2">
            <button
              type="submit"
              disabled={!selected}
              className="px-4 py-1.5 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
            >
              Entrar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
