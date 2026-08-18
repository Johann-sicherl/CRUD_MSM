'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// Portão de acesso ao app inteiro — diferente do ProtheusAuthProvider (que só
// pede credenciais do SQL Server do Protheus, é opcional/dispensável e não
// bloqueia nada). Aqui, nada do app (Sidebar, telas, dados do Supabase) é
// renderizado até logar — por construção, não tem "fundo" pra vazar atrás da
// tela de login. Senha fixa no bundle (1234) não é segurança de verdade,
// é só identificação de perfil — ver PROFILES abaixo.

export type AppRole = 'engenharia' | 'gerente_adm_comercial'

export interface AppUser {
  username: string
  role: AppRole
  label: string
}

const PROFILES: Record<string, { password: string; role: AppRole }> = {
  'Engenharia do Produto':      { password: '1234', role: 'engenharia' },
  'Gerente Adm Comercial':      { password: '1234', role: 'gerente_adm_comercial' },
}

const STORAGE_KEY = 'app-auth-user'

interface AppAuthValue {
  user: AppUser
  logout: () => void
}

const AppAuthContext = createContext<AppAuthValue | null>(null)

export function useAppAuth(): AppAuthValue {
  const ctx = useContext(AppAuthContext)
  if (!ctx) throw new Error('useAppAuth must be used within AppAuthProvider')
  return ctx
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AppUser | null>(null)
  const [checked, setChecked] = useState(false)

  // sessionStorage (não localStorage): sobrevive a um F5, mas pede login de
  // novo se fechar a aba/navegador — evita ficar logado pra sempre num PC
  // compartilhado, sem exigir logar toda hora que atualiza a página.
  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { /* sessão corrompida, ignora */ }
    }
    setChecked(true)
  }, [])

  const login = (username: string, password: string): boolean => {
    const entry = PROFILES[username]
    if (!entry || entry.password !== password) return false
    const u: AppUser = { username, role: entry.role, label: username }
    setUser(u)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    return true
  }

  const logout = () => {
    setUser(null)
    sessionStorage.removeItem(STORAGE_KEY)
  }

  // Enquanto ainda não checou o sessionStorage, não mostra nada (nem a tela
  // de login nem o app) pra não "piscar" a tela de login antes de restaurar
  // uma sessão já existente.
  if (!checked) return null

  if (!user) return <LoginScreen onLogin={login} />

  return (
    <AppAuthContext.Provider value={{ user, logout }}>
      {children}
    </AppAuthContext.Provider>
  )
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => boolean }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!onLogin(username, password)) setError('Perfil ou senha inválidos')
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">Entrar — MSM Admin</h2>
        </div>
        <form className="p-5 flex flex-col gap-3" onSubmit={handleSubmit}>
          <p className="text-sm text-on-surface-variant">
            Selecione seu perfil e informe a senha para acessar o painel.
          </p>
          <label className="text-xs font-semibold text-on-surface-variant">
            Perfil
            <select
              autoFocus
              value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            >
              <option value="">Selecione...</option>
              {Object.keys(PROFILES).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-on-surface-variant">
            Senha
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </label>
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex items-center justify-end mt-2">
            <button
              type="submit"
              disabled={!username || !password}
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
