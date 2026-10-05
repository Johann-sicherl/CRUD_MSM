'use client'

import { createContext, useCallback, useContext, useState, type FormEvent, type ReactNode } from 'react'
import { useAppAuth } from './appAuthContext'

// Single, app-wide Protheus connection prompt — shown once when the app is
// entered, instead of every individual screen (Busc. Itens Série Estrut.,
// Busc. Avançada Acessórios, Cadastro de Equipamentos/Componentes,
// Produtos Dependentes...) asking for the same credentials separately.
// Credentials still live only in memory for this browser tab (React state
// here, nothing in localStorage/cookies) and are sent per request exactly
// as before — this only centralizes WHERE they're collected, not how
// they're used or stored.
//
// Disponível pra Administrador sempre, e pra qualquer outro perfil com
// canConnectProtheus ligado em Configuração de Usuários (ver
// userProfileStore.ts) — antes desta permissão existir, todo perfil sempre
// podia conectar; o default da coluna no banco preserva esse comportamento
// pra quem já está cadastrado (ver msm_add_connection_permissions.sql).

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
  const { user } = useAppAuth()
  const canConnect = user.isAdmin || user.canConnectProtheus
  const [creds, setCreds] = useState<ProtheusCreds | null>(null)
  const [promptOpen, setPromptOpen] = useState(canConnect)

  const connect = useCallback((user: string, password: string) => {
    setCreds({ user, password })
    setPromptOpen(false)
  }, [])
  const disconnect = useCallback(() => setCreds(null), [])
  const openPrompt = useCallback(() => setPromptOpen(true), [])

  return (
    <ProtheusAuthContext.Provider value={{ creds, connect, disconnect, openPrompt }}>
      {children}
      {canConnect && promptOpen && (
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
  // Achado real, pedido explícito do usuário: "teve vez que eu errei a
  // senha e passou, deu a flag verde do canto esquerdo inferior como se
  // tivesse dado certo" — antes, o submit só chamava onConnect direto, sem
  // testar nada contra o Protheus de verdade. Agora testa primeiro
  // (POST /api/protheus-test-connection, SELECT 1) e só marca como
  // conectado se autenticar; senão mostra o erro do driver (ex.: "Login
  // failed for user '...'") e deixa o modal aberto pra tentar de novo.
  const [testing, setTesting] = useState(false)
  const [localTesting, setLocalTesting] = useState(false)
  const [error, setError] = useState('')

  const testAndConnect = async (u: string, p: string) => {
    const res = await fetch('/api/protheus-test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: u, password: p }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error || 'Usuário ou senha incorretos'); return }
    onConnect(u, p)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setTesting(true)
    setError('')
    try {
      await testAndConnect(user, password)
    } catch {
      setError('Erro de comunicação ao testar a conexão')
    } finally {
      setTesting(false)
    }
  }

  // Pedido explícito do usuário: "crie um arquivo .txt único onde eu vou
  // colocar estes acessos... que tenha um botão de 'Logar com Dados
  // Locais'" — lê usuário/senha de local-data/local-access.txt (nunca
  // commitado, só nesta máquina — ver localCredentials.ts) e testa/conecta
  // exatamente como o submit normal, sem precisar digitar nada.
  const handleLocalLogin = async () => {
    setLocalTesting(true)
    setError('')
    try {
      const credRes = await fetch('/api/protheus-local-credentials')
      const credJson = await credRes.json()
      if (!credRes.ok) { setError(credJson.error || 'Nenhuma credencial local encontrada'); return }
      setUser(credJson.user)
      setPassword(credJson.password)
      await testAndConnect(credJson.user, credJson.password)
    } catch {
      setError('Erro de comunicação ao testar a conexão')
    } finally {
      setLocalTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">Conectar ao Banco Protheus</h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none">✕</button>
        </div>
        <form
          className="p-5 flex flex-col gap-3"
          onSubmit={handleSubmit}
        >
          <p className="text-sm text-on-surface-variant">
            Informe seu usuário e senha do SQL Server (PROTHEUS12) uma única vez, no início da sessão — todas as
            telas que consultam o Protheus (verificação de status, buscas de estrutura, nomes de equipamento etc.)
            usam esta mesma conexão. Nada fica salvo; cada consulta abre e fecha sua própria conexão.
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
                distinto ("protheus-user"/"protheus-password") já diferencia
                este formulário do de PDM/login do app, então não precisa do
                "off" pra evitar sugestão cruzada. */}
            <input
              type="text"
              name="protheus-user"
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
              name="protheus-password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </label>
          <div className="flex flex-col gap-2 mt-2">
            <button
              type="button"
              onClick={handleLocalLogin}
              disabled={testing || localTesting}
              title="Lê usuário e senha de local-data/local-access.txt (ver local-access.example.txt)"
              className="w-full px-3 py-1 text-xs border border-outline-variant rounded text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
            >
              {localTesting ? 'Conectando…' : '📁 Entrar com Dados Locais'}
            </button>
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={onClose} disabled={testing || localTesting} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50">
                Agora não
              </button>
              <button
                type="submit"
                disabled={!user.trim() || !password || testing || localTesting}
                className="px-4 py-1.5 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
              >
                {testing ? 'Conectando…' : 'Conectar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
