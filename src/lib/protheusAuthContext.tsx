'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

// Single, app-wide Protheus connection prompt — shown once when the app is
// entered, instead of every individual screen (Busc. Itens Série Estrut.,
// Busc. Avançada Acessórios, Cadastro de Equipamentos/Componentes,
// Produtos Dependentes...) asking for the same credentials separately.
// Credentials still live only in memory for this browser tab (React state
// here, nothing in localStorage/cookies) and are sent per request exactly
// as before — this only centralizes WHERE they're collected, not how
// they're used or stored.

export interface ProtheusCreds { user: string; password: string }

interface ProtheusAuthValue {
  creds: ProtheusCreds | null
  connect: (user: string, password: string) => void
  disconnect: () => void
  openPrompt: () => void
}

const ProtheusAuthContext = createContext<ProtheusAuthValue | null>(null)

export function useProtheusAuth(): ProtheusAuthValue {
  const ctx = useContext(ProtheusAuthContext)
  if (!ctx) throw new Error('useProtheusAuth must be used within ProtheusAuthProvider')
  return ctx
}

export function ProtheusAuthProvider({ children }: { children: ReactNode }) {
  const [creds, setCreds] = useState<ProtheusCreds | null>(null)
  const [promptOpen, setPromptOpen] = useState(true)

  const connect = useCallback((user: string, password: string) => {
    setCreds({ user, password })
    setPromptOpen(false)
  }, [])
  const disconnect = useCallback(() => setCreds(null), [])
  const openPrompt = useCallback(() => setPromptOpen(true), [])

  return (
    <ProtheusAuthContext.Provider value={{ creds, connect, disconnect, openPrompt }}>
      {children}
      {promptOpen && (
        <ProtheusLoginModal onClose={() => setPromptOpen(false)} onConnect={connect} />
      )}
    </ProtheusAuthContext.Provider>
  )
}

function ProtheusLoginModal({ onClose, onConnect }: {
  onClose: () => void
  onConnect: (user: string, password: string) => void
}) {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">Conectar ao Banco Protheus</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none">✕</button>
        </div>
        <form
          className="p-5 flex flex-col gap-3"
          onSubmit={e => { e.preventDefault(); onConnect(user, password) }}
        >
          <p className="text-sm text-on-surface-variant">
            Informe seu usuário e senha do SQL Server (PROTHEUS12) uma única vez, no início da sessão — todas as
            telas que consultam o Protheus (verificação de status, buscas de estrutura, nomes de equipamento etc.)
            usam esta mesma conexão. Nada fica salvo; cada consulta abre e fecha sua própria conexão.
          </p>
          <label className="text-xs font-semibold text-on-surface-variant">
            Usuário
            <input
              type="text"
              autoFocus
              value={user}
              onChange={e => setUser(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </label>
          <label className="text-xs font-semibold text-on-surface-variant">
            Senha
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </label>
          <div className="flex items-center justify-end gap-2 mt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface">
              Agora não
            </button>
            <button
              type="submit"
              disabled={!user.trim() || !password}
              className="px-4 py-1.5 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
            >
              Conectar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
