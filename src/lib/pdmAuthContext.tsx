'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useProtheusAuth } from './protheusAuthContext'
import { useAppAuth } from './appAuthContext'

// Conexão ao banco do PDM — igual à conexão ao Protheus (ver
// protheusAuthContext.tsx: credenciais só em memória desta aba, nunca em
// localStorage/cookies, enviadas por requisição), mas com duas diferenças
// deliberadas: (1) exclusiva do perfil Administrador — o pop-up nunca abre
// pra outro perfil, e (2) não abre sozinha ao entrar no app: só é oferecida
// automaticamente logo depois que a conexão ao Protheus é feita (ver
// PdmAuthProvider abaixo), já que é um banco adicional, só usado pela tela
// Consulta PDM x Banco MSM.

export interface PdmCreds { user: string; password: string }

interface PdmAuthValue {
  creds: PdmCreds | null
  connect: (user: string, password: string) => void
  disconnect: () => void
  openPrompt: () => void
}

const PdmAuthContext = createContext<PdmAuthValue | null>(null)

export function usePdmAuth(): PdmAuthValue {
  const ctx = useContext(PdmAuthContext)
  if (!ctx) throw new Error('usePdmAuth must be used within PdmAuthProvider')
  return ctx
}

export function PdmAuthProvider({ children }: { children: ReactNode }) {
  const { creds: protheusCreds } = useProtheusAuth()
  const { user } = useAppAuth()
  const [creds, setCreds] = useState<PdmCreds | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const offeredRef = useRef(false) // oferece o pop-up automático uma única vez por sessão

  useEffect(() => {
    if (offeredRef.current || !user.isAdmin || !protheusCreds || creds) return
    offeredRef.current = true
    setPromptOpen(true)
  }, [protheusCreds, user.isAdmin, creds])

  const connect = useCallback((u: string, password: string) => {
    setCreds({ user: u, password })
    setPromptOpen(false)
  }, [])
  const disconnect = useCallback(() => setCreds(null), [])
  const openPrompt = useCallback(() => setPromptOpen(true), [])

  return (
    <PdmAuthContext.Provider value={{ creds, connect, disconnect, openPrompt }}>
      {children}
      {user.isAdmin && promptOpen && (
        <PdmLoginModal onClose={() => setPromptOpen(false)} onConnect={connect} />
      )}
    </PdmAuthContext.Provider>
  )
}

function PdmLoginModal({ onClose, onConnect }: {
  onClose: () => void
  onConnect: (user: string, password: string) => void
}) {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">Conectar ao Banco PDM</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none">✕</button>
        </div>
        <form
          className="p-5 flex flex-col gap-3"
          onSubmit={e => { e.preventDefault(); onConnect(user, password) }}
        >
          <p className="text-sm text-on-surface-variant">
            Informe seu usuário e senha do SQL Server do PDM (base VMI, servidor srvvmis03) — usada pela tela
            Consulta PDM x Banco MSM, exclusiva do perfil Administrador. Nada fica salvo; cada consulta abre e
            fecha sua própria conexão.
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
