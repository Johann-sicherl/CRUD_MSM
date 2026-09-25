'use client'

import { useEffect, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'
import { useProtheusAuth } from '@/lib/protheusAuthContext'
import { usePdmAuth } from '@/lib/pdmAuthContext'
import type { DiagnosticSection } from '@/lib/appDiagnostics'
import AppDiagnosticsPopup from './AppDiagnosticsPopup'

const STORAGE_KEY = 'app-diagnostics-seen-build'

// Diagnóstico da Aplicação — pedido explícito do usuário: um pop-up
// automático "sempre na primeira abertura da aplicação, ou quando eu
// atualizo a aplicação". "Atualizar a aplicação" é detectado pelo hash do
// commit atual (NEXT_PUBLIC_APP_BUILD_SHA, embutido no build por
// next.config.js) — muda sozinho a cada `npm run build` novo em produção,
// sem precisar de nenhum passo manual. Comparado contra o que está salvo
// em localStorage: build nunca visto (ou primeiro acesso de sempre, sem
// nada salvo) → roda o diagnóstico e mostra o pop-up; mesmo build já visto
// → não mostra nada.
//
// Só Admin (pedido explícito do usuário) — e só depois que o Protheus já
// conectou (a checagem precisa da credencial; reusa a mesma conexão única
// do app inteiro, nunca pede uma segunda vez). Roda no máximo uma vez por
// carregamento da página (offeredRef equivalente via `triggeredRef`).

export default function AppDiagnosticsGate() {
  const { user: appUser } = useAppAuth()
  const { creds: protheusCreds } = useProtheusAuth()
  // PDM é opcional pra este pop-up — usado só se já conectado no instante
  // em que o Protheus dispara o diagnóstico (ver checkPdmVsSupabase,
  // appDiagnostics.ts, pra o que acontece quando ainda não está).
  const { creds: pdmCreds } = usePdmAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sections, setSections] = useState<DiagnosticSection[]>([])
  const [triggered, setTriggered] = useState(false)

  useEffect(() => {
    if (triggered || !appUser.isAdmin || !protheusCreds) return
    const buildSha = process.env.NEXT_PUBLIC_APP_BUILD_SHA ?? 'dev'
    const seen = localStorage.getItem(STORAGE_KEY)
    if (seen === buildSha) return

    setTriggered(true)
    setOpen(true)
    setLoading(true)
    setError('')
    fetch('/api/app-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: appUser.id,
        user: protheusCreds.user,
        password: protheusCreds.password,
        pdmUser: pdmCreds?.user,
        pdmPassword: pdmCreds?.password,
      }),
    })
      .then(async res => {
        const json = await res.json()
        if (!res.ok) { setError(json.error || 'Falha ao rodar o diagnóstico'); return }
        setSections(json.sections || [])
      })
      .catch(() => setError('Falha de rede ao rodar o diagnóstico'))
      .finally(() => setLoading(false))
  }, [triggered, appUser, protheusCreds, pdmCreds])

  const handleClose = () => {
    setOpen(false)
    // Só marca como "visto" se o diagnóstico rodou de verdade — uma falha
    // de rede/Protheus não fica marcada como vista; volta a tentar no
    // próximo carregamento da página em que o Admin conectar ao Protheus
    // (triggered é estado de componente, não sobrevive a um reload).
    if (error) return
    const buildSha = process.env.NEXT_PUBLIC_APP_BUILD_SHA ?? 'dev'
    localStorage.setItem(STORAGE_KEY, buildSha)
  }

  if (!open) return null
  return <AppDiagnosticsPopup sections={sections} loading={loading} error={error} onClose={handleClose} />
}
