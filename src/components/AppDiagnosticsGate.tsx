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
// Só Admin (pedido explícito do usuário) — e só depois que os DOIS bancos
// já conectaram: Protheus e PDM (pedido explícito do usuário, rodada
// seguinte: "quero que você dispare a consulta do pop-up de Análise,
// depois que for conectado os dois bancos de dados" — antes disparava só
// com o Protheus, e a Checagem #4 (PDM) ficava mostrando "não conectado"
// até o PDM conectar depois, com re-sincronização própria; agora o
// disparo inicial inteiro espera os dois). Reusa as mesmas conexões
// únicas do app inteiro, nunca pede uma segunda vez. Roda no máximo uma
// vez por carregamento da página (offeredRef equivalente via
// `triggeredRef`).
//
// PDM é oferecido automaticamente só depois do Protheus, e o Admin pode
// dispensar o modal ("Agora não") — se isso acontecer, o pop-up de
// Diagnóstico simplesmente não dispara nesta sessão até o Admin conectar
// ao PDM manualmente (botão "Conectar PDM" na Sidebar, sempre disponível
// pra Admin). Decisão deliberada: esperar os dois é o pedido explícito do
// usuário, e como o Admin sempre tem permissão pra conectar ao PDM
// (`canConnectPdm` é ignorado quando `isAdmin`), ele nunca fica travado
// sem um jeito de destravar o pop-up — só precisa dar esse passo a mais.

export default function AppDiagnosticsGate() {
  const { user: appUser } = useAppAuth()
  const { creds: protheusCreds } = useProtheusAuth()
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
    if (triggered || !appUser.isAdmin || !protheusCreds || !pdmCreds) return
    const buildSha = process.env.NEXT_PUBLIC_APP_BUILD_SHA ?? 'dev'
    const seen = localStorage.getItem(STORAGE_KEY)
    if (seen === buildSha) return

    setTriggered(true)
    setOpen(true)
    setLoading(true)
    setError('')
    // Os dois já estão conectados nesse ponto (guarda acima) — marca a
    // credencial de PDM já usada nesta primeira rodada, pra o efeito de
    // re-execução abaixo não buscar a mesma coisa de novo à toa.
    pdmSyncedKeyRef.current = `${pdmCreds.user}:${pdmCreds.password}`
    fetch('/api/app-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: appUser.id,
        user: protheusCreds.user,
        password: protheusCreds.password,
        pdmUser: pdmCreds.user,
        pdmPassword: pdmCreds.password,
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

  // Re-executa só a Checagem #4 quando o PDM reconecta com um usuário
  // diferente **depois** do diagnóstico inicial já ter rodado (ex.: Admin
  // desconecta e reconecta ao PDM pela Sidebar) — pedido explícito do
  // usuário, rodada anterior: "faz o PDM re-rodar sozinho quando
  // conectar". Agora que o disparo inicial já espera os dois bancos (ver
  // acima), este efeito não cobre mais "PDM ainda não conectado na
  // primeira vez" (isso nunca mais acontece — o pop-up só abre com os
  // dois já conectados) — só o caso de reconexão depois. Não refaz as
  // outras 3 checagens (Protheus/Busca Reversa não dependem do PDM,
  // refazê-las seria trabalho redundante) — só troca a seção
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
