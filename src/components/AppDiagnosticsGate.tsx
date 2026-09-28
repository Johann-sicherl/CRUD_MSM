'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'
import { useProtheusAuth } from '@/lib/protheusAuthContext'
import { usePdmAuth } from '@/lib/pdmAuthContext'
import type { DiagnosticSection } from '@/lib/appDiagnostics'
import AppDiagnosticsPopup from './AppDiagnosticsPopup'

const PDM_CHECK_KEY = 'pdm_vs_supabase'

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
  // Guarda qual credencial de PDM já foi refletida na seção "Consulta PDM
  // x Banco MSM" (pela rodada inicial ou pela re-execução avulsa abaixo) —
  // evita re-buscar a mesma coisa de novo se este efeito re-rodar por
  // outro motivo (ex.: appUser mudou de referência sem mudar de verdade).
  const pdmSyncedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (triggered || !appUser.isAdmin || !protheusCreds) return
    const buildSha = process.env.NEXT_PUBLIC_APP_BUILD_SHA ?? 'dev'
    const seen = localStorage.getItem(STORAGE_KEY)
    if (seen === buildSha) return

    setTriggered(true)
    setOpen(true)
    setLoading(true)
    setError('')
    // Se o PDM já estiver conectado bem no instante em que o diagnóstico
    // inicial dispara (raro, mas possível), essa credencial já entra nesta
    // primeira rodada — marca como sincronizada pra o efeito de re-execução
    // abaixo não buscar a mesma coisa de novo assim que ele rodar.
    pdmSyncedKeyRef.current = pdmCreds ? `${pdmCreds.user}:${pdmCreds.password}` : null
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

  // Re-executa só a Checagem #4 quando o PDM conecta (ou reconecta com
  // outro usuário) depois do diagnóstico inicial já ter rodado — pedido
  // explícito do usuário: "faz o PDM re-rodar sozinho quando conectar".
  // Não refaz as outras 3 checagens (Protheus/Busca Reversa não dependem
  // do PDM, refazê-las seria trabalho redundante) — só troca a seção
  // correspondente, pelo key, no pop-up já aberto (ou já fechado — a seção
  // é atualizada em segundo plano de qualquer forma, mesmo sem o pop-up
  // visível; só não aparece até o Admin reabrir, o que hoje não tem botão
  // próprio — ver limitação em specs/diagnostico-aplicacao.md).
  useEffect(() => {
    if (!triggered || !pdmCreds) return
    const key = `${pdmCreds.user}:${pdmCreds.password}`
    if (pdmSyncedKeyRef.current === key) return
    pdmSyncedKeyRef.current = key

    fetch('/api/app-diagnostics/pdm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: appUser.id, pdmUser: pdmCreds.user, pdmPassword: pdmCreds.password }),
    })
      .then(async res => {
        if (!res.ok) return
        const json = await res.json()
        if (!json.section) return
        setSections(prev => prev.map(s => (s.key === PDM_CHECK_KEY ? json.section : s)))
      })
      .catch(() => { /* best-effort — falha aqui não derruba o resto do pop-up já mostrado */ })
  }, [triggered, pdmCreds, appUser])

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
