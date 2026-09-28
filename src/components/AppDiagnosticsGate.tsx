'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'
import { useProtheusAuth } from '@/lib/protheusAuthContext'
import { usePdmAuth } from '@/lib/pdmAuthContext'
import type { DiagnosticSection } from '@/lib/appDiagnostics'
import AppDiagnosticsPopup from './AppDiagnosticsPopup'

const PDM_CHECK_KEY = 'pdm_vs_supabase'

// Diagnóstico da Aplicação — pedido explícito do usuário: um pop-up
// automático que dispara sempre que o Admin conecta aos dois bancos
// (Protheus e PDM). Só Admin (pedido explícito do usuário) — e só depois
// que os DOIS já conectaram (pedido explícito do usuário: "quero que você
// dispare a consulta do pop-up de Análise, depois que for conectado os
// dois bancos de dados"). Reusa as mesmas conexões únicas do app inteiro,
// nunca pede uma credencial extra só pra isso.
//
// **Sem gate de "uma vez por build"** — pedido explícito do usuário,
// rodada seguinte: dar F5 e reconectar aos dois bancos não trazia o
// pop-up de volta, porque uma versão anterior marcava o build inteiro
// como "visto" em localStorage assim que o Admin fechava o pop-up uma
// vez (`NEXT_PUBLIC_APP_BUILD_SHA`/`app-diagnostics-seen-build`,
// removidos — ver `next.config.js`). Confirmado com o usuário: em vez de
// só limpar essa trava por engano/consertar o gate, a decisão foi
// abandonar o conceito — agora dispara **toda vez** que os dois bancos
// conectarem, inclusive de novo depois de um F5. Continua rodando no
// máximo uma vez por essa conexão (guarda `triggered`, dentro da mesma
// carga de página) — reconectar sem dar F5 (ex.: desconectar e conectar
// nos dois de novo pela Sidebar, sem recarregar) não dispara de novo; só
// um novo carregamento de página (que reseta `triggered` junto com as
// credenciais em memória) faz o pop-up disparar outra vez.
//
// PDM é oferecido automaticamente só depois do Protheus, e o Admin pode
// dispensar o modal ("Agora não") — se isso acontecer, o pop-up de
// Diagnóstico simplesmente não dispara nesta carga de página até o Admin
// conectar ao PDM manualmente (botão "Conectar PDM" na Sidebar, sempre
// disponível pra Admin — `canConnectPdm` é ignorado quando `isAdmin`).

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

  const handleClose = () => setOpen(false)

  if (!open) return null
  return <AppDiagnosticsPopup sections={sections} loading={loading} error={error} onClose={handleClose} />
}
