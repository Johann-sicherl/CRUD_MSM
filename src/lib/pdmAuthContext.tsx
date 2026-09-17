'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useProtheusAuth } from './protheusAuthContext'
import { useAppAuth } from './appAuthContext'

// Conexão ao banco do PDM — igual à conexão ao Protheus (ver
// protheusAuthContext.tsx: credenciais só em memória desta aba, nunca em
// localStorage/cookies, enviadas por requisição), mas com duas diferenças
// deliberadas: (1) só disponível pra quem tem permissão — Administrador
// sempre, e qualquer outro perfil com canConnectPdm ligado em Configuração
// de Usuários (o pop-up nunca abre pra quem não tem nenhum dos dois); e
// (2) não abre sozinha ao entrar no app: só é oferecida automaticamente
// logo depois que a conexão ao Protheus é feita (ver PdmAuthProvider
// abaixo), já que é um banco adicional, só usado pela tela Consulta PDM x
// Banco MSM.

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
  const canConnect = user.isAdmin || user.canConnectPdm
  const [creds, setCreds] = useState<PdmCreds | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const offeredRef = useRef(false) // oferece o pop-up automático uma única vez por sessão

  useEffect(() => {
    if (offeredRef.current || !canConnect || !protheusCreds || creds) return
    offeredRef.current = true
    setPromptOpen(true)
  }, [protheusCreds, canConnect, creds])

  const connect = useCallback((u: string, password: string) => {
    setCreds({ user: u, password })
    setPromptOpen(false)
  }, [])
  const disconnect = useCallback(() => setCreds(null), [])
  const openPrompt = useCallback(() => setPromptOpen(true), [])

  return (
    <PdmAuthContext.Provider value={{ creds, connect, disconnect, openPrompt }}>
      {children}
      {canConnect && promptOpen && (
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
  // Mesmo achado/mesmo padrão de ProtheusLoginModal (protheusAuthContext.tsx):
  // testar a credencial de verdade (POST /api/pdm-test-connection) antes de
  // marcar como conectado, em vez de aceitar qualquer usuário/senha digitado.
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setTesting(true)
    setError('')
    try {
      const res = await fetch('/api/pdm-test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Usuário ou senha incorretos'); return }
      onConnect(user, password)
    } catch {
      setError('Erro de comunicação ao testar a conexão')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">Conectar ao Banco PDM</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none">✕</button>
        </div>
        <form
          className="p-5 flex flex-col gap-3"
          onSubmit={handleSubmit}
        >
          <p className="text-sm text-on-surface-variant">
            Informe seu usuário e senha do SQL Server do PDM (base VMI, servidor srvvmis03) — usada pela tela
            Consulta PDM x Banco MSM. Nada fica salvo; cada consulta abre e fecha sua própria conexão.
          </p>
          {error && (
            <div className="text-error text-xs bg-error-container/20 border border-error/30 rounded px-3 py-2">
              ⚠ {error}
            </div>
          )}
          <label className="text-xs font-semibold text-on-surface-variant">
            Usuário
            {/* autoComplete="username"/"current-password" (em vez de "off") —
                são os valores que sinalizam pro Chrome "isto é um login de
                verdade", o que ajuda a acionar o aviso de salvar senha. O name
                distinto ("pdm-user"/"pdm-password") já diferencia este
                formulário do de Protheus/login do app, então não precisa do
                "off" pra evitar sugestão cruzada. */}
            <input
              type="text"
              name="pdm-user"
              autoComplete="username"
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
              name="pdm-password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </label>
          <div className="flex items-center justify-end gap-2 mt-2">
            <button type="button" onClick={onClose} disabled={testing} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50">
              Agora não
            </button>
            <button
              type="submit"
              disabled={!user.trim() || !password || testing}
              className="px-4 py-1.5 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
            >
              {testing ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
