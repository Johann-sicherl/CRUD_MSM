'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppAuth } from '@/lib/appAuthContext'
import { usePdmAuth } from '@/lib/pdmAuthContext'
import { tables } from '@/lib/schema'
import RecordModal from '@/components/RecordModal'
import type { PdmAccessoryRow } from '@/lib/pdmDb'
import { PDM_FIELD_MAP, comparePdmWithSupabase, displayText, pdmRowToPrefill, type PdmComparisonRow } from '@/lib/pdmCompare'

// Compara o catálogo de Cadastro de Componentes (banco de dados MSM) com o
// que está validado no PDM (AC_VALIDADO = 'S') — tela exclusiva do perfil
// Administrador (ver Sidebar.tsx e o guard abaixo). Consulta automaticamente
// ao abrir, desde que já conectado ao PDM (ver pdmAuthContext.tsx).
//
// Três estados de linha:
//  - normal: código existe nos dois, todos os campos batem.
//  - vermelho na CÉLULA: código existe nos dois, mas aquele campo diverge —
//    "Editar" abre o mesmo formulário de Cadastro de Componentes.
//  - vermelho esmaecido na LINHA: existe no PDM, não existe no banco MSM —
//    "+ Cadastrar" abre o mesmo formulário já pré-preenchido com os dados do PDM.
//  - cinza esmaecido na LINHA, sem interação: existe no banco MSM, não veio
//    na consulta ao PDM — só um lembrete visual do que falta inserir lá.

function resolveGroupName(rawId: unknown, groupNames: Map<number, string>): string {
  const n = rawId === null || rawId === undefined ? NaN : Number(String(rawId).trim())
  if (Number.isNaN(n)) return '—'
  return groupNames.get(n) ?? `#${n}`
}

export default function PdmConsultaAcessoriosPage() {
  const { user } = useAppAuth()
  const { creds: pdmCreds, openPrompt: openPdmPrompt } = usePdmAuth()

  const [pdmRows, setPdmRows] = useState<PdmAccessoryRow[] | null>(null)
  const [supabaseRows, setSupabaseRows] = useState<Record<string, unknown>[] | null>(null)
  const [groupNames, setGroupNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null)
  const [createPrefill, setCreatePrefill] = useState<Record<string, string> | null>(null)

  const fetchDbSide = useCallback(async () => {
    const [accRes, groupsRes] = await Promise.all([
      fetch('/api/accessories?limit=25000'),
      fetch('/api/accessory_groups?limit=1000'),
    ])
    const accJson = await accRes.json()
    const groupsJson = await groupsRes.json()
    if (!accRes.ok) throw new Error(accJson.error || 'Falha ao carregar Cadastro de Componentes')
    if (!groupsRes.ok) throw new Error(groupsJson.error || 'Falha ao carregar Grupo de Acessórios')
    setSupabaseRows(accJson.data || [])
    const names = new Map<number, string>()
    for (const g of (groupsJson.data || []) as { legacy_id: number; name: string }[]) names.set(g.legacy_id, g.name)
    setGroupNames(names)
  }, [])

  const runQuery = useCallback(async (creds: { user: string; password: string }) => {
    setLoading(true)
    setError('')
    try {
      const [pdmRes] = await Promise.all([
        fetch('/api/pdm-consulta-acessorios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: creds.user, password: creds.password }),
        }),
        fetchDbSide(),
      ])
      const pdmJson = await pdmRes.json()
      if (!pdmRes.ok) { setError(pdmJson.error || 'Falha ao consultar o banco PDM'); return }
      setPdmRows(pdmJson.rows || [])
    } catch {
      setError('Erro de comunicação com o banco PDM')
    } finally {
      setLoading(false)
    }
  }, [fetchDbSide])

  // Consulta sozinha ao abrir a tela, sem precisar clicar em nada — se ainda
  // não houver conexão ao PDM, abre o pop-up (o mesmo oferecido automaticamente
  // logo após conectar ao Protheus); assim que a conexão existir, dispara a
  // consulta uma única vez.
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (!pdmCreds) { openPdmPrompt(); return }
    if (autoRanRef.current) return
    autoRanRef.current = true
    runQuery(pdmCreds)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdmCreds])

  const comparison = useMemo<PdmComparisonRow[] | null>(() => {
    if (!pdmRows || !supabaseRows) return null
    return comparePdmWithSupabase(pdmRows, supabaseRows)
  }, [pdmRows, supabaseRows])

  const counts = useMemo(() => {
    if (!comparison) return null
    return {
      ok: comparison.filter(r => r.status === 'ok').length,
      mismatch: comparison.filter(r => r.status === 'mismatch').length,
      pdmOnly: comparison.filter(r => r.status === 'pdm-only').length,
      dbOnly: comparison.filter(r => r.status === 'supabase-only').length,
    }
  }, [comparison])

  if (!user.isAdmin) {
    return (
      <div className="p-8">
        <div className="bg-error-container/20 border border-error/30 text-error rounded-lg px-5 py-4 text-sm">
          Acesso restrito a administradores.
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-[108rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Consulta Banco de Dados · consulta pdm x banco msm
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Consulta PDM x Banco MSM</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Traz os itens validados no PDM (base VMI) e compara com o que está gravado em Cadastro de Componentes.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => pdmCreds ? runQuery(pdmCreds) : openPdmPrompt()}
          disabled={loading}
          className="px-4 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon disabled:opacity-50 transition-all"
        >
          {loading ? 'Consultando...' : comparison ? 'Atualizar consulta' : pdmCreds ? 'Consultar PDM' : 'Conectar e consultar PDM'}
        </button>
        {counts && (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant">{counts.ok} ok</span>
            <span className="px-2 py-1 rounded border border-error/30 bg-error/10 text-error">{counts.mismatch} divergente{counts.mismatch !== 1 ? 's' : ''}</span>
            <span className="px-2 py-1 rounded border border-error/30 bg-error/10 text-error">{counts.pdmOnly} só no PDM</span>
            <span className="px-2 py-1 rounded border border-outline-variant text-outline">{counts.dbOnly} só no Banco MSM</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-error-container/30 text-error text-sm px-4 py-3 rounded border border-error/20 mb-4">
          ⚠ {error}
        </div>
      )}

      {loading && !comparison && (
        <div className="text-sm text-on-surface-variant">Consultando o banco PDM...</div>
      )}

      {comparison && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant mb-3">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-error/15 border border-error/30 inline-block" /> célula divergente</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-error/10 border border-error/30 inline-block" /> só existe no PDM — falta cadastrar</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-surface-container-highest border border-outline-variant inline-block opacity-60" /> só existe no Banco MSM — falta inserir no PDM</span>
          </div>

          <div className="border border-outline-variant rounded-lg overflow-x-auto bg-surface-container-low">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container text-left text-xs text-outline uppercase tracking-wide">
                  <th className="px-4 py-2 whitespace-nowrap">Grupo</th>
                  <th className="px-4 py-2 whitespace-nowrap">Código Protheus</th>
                  {PDM_FIELD_MAP.filter(f => f.supabaseField !== 'legacy_group_id').map(f => (
                    <th key={f.supabaseField} className="px-4 py-2 whitespace-nowrap">{f.label}</th>
                  ))}
                  <th className="px-4 py-2 whitespace-nowrap text-right sticky right-0 bg-surface-container border-l border-outline-variant/40 z-10">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {comparison.map(row => {
                  const isGhost = row.status === 'supabase-only'
                  const isPdmOnly = row.status === 'pdm-only'
                  const diffFieldSet = row.status === 'ok' || row.status === 'mismatch'
                    ? new Set(row.diffs.map(d => d.supabaseField))
                    : new Set<string>()

                  const groupId = row.status === 'supabase-only' ? row.supabaseRow.legacy_group_id : row.pdm.idGrupo
                  const grupoLabel = resolveGroupName(groupId, groupNames)

                  return (
                    <tr
                      key={`${row.status}-${row.protheusCode}`}
                      className={
                        isGhost ? 'opacity-50 pointer-events-none bg-surface-container-highest'
                        : isPdmOnly ? 'bg-error/10'
                        : 'hover:bg-surface-container-high transition-colors'
                      }
                    >
                      <td className="px-4 py-2.5 text-on-surface-variant whitespace-nowrap">{grupoLabel}</td>
                      <td className="px-4 py-2.5 font-mono text-on-surface whitespace-nowrap">{row.protheusCode}</td>
                      {PDM_FIELD_MAP.filter(f => f.supabaseField !== 'legacy_group_id').map(f => {
                        const value = row.status === 'supabase-only'
                          ? displayText(row.supabaseRow[f.supabaseField])
                          : displayText(row.pdm[f.pdmKey])
                        const isDiff = diffFieldSet.has(f.supabaseField)
                        return (
                          <td key={f.supabaseField} className={`px-4 py-2.5 text-on-surface-variant whitespace-nowrap ${isDiff ? 'bg-error/15' : ''}`}
                            title={isDiff && row.status === 'mismatch' ? `Banco MSM: ${displayText(row.supabaseRow[f.supabaseField])}` : undefined}
                          >
                            {value}
                          </td>
                        )
                      })}
                      <td className={`px-4 py-2.5 text-right whitespace-nowrap sticky right-0 border-l border-outline-variant/40 z-10 ${
                        isGhost ? 'bg-surface-container-highest' : isPdmOnly ? 'bg-error-container' : 'bg-surface-container-low'
                      }`}>
                        {isPdmOnly && (
                          <button
                            onClick={() => setCreatePrefill(pdmRowToPrefill(row.pdm))}
                            className="text-on-error-container hover:opacity-80 text-xs font-semibold transition-opacity"
                          >
                            + Cadastrar
                          </button>
                        )}
                        {isGhost && <span className="text-outline text-xs font-medium">Ausente no PDM</span>}
                        {(row.status === 'ok' || row.status === 'mismatch') && (
                          <button
                            onClick={() => setEditRecord(row.supabaseRow)}
                            className="text-outline hover:text-primary text-xs font-medium transition-colors"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editRecord && (
        <RecordModal
          schema={tables.accessories}
          tableName="accessories"
          record={editRecord}
          onClose={() => setEditRecord(null)}
          onSaved={() => { setEditRecord(null); fetchDbSide() }}
        />
      )}

      {createPrefill && (
        <RecordModal
          schema={tables.accessories}
          tableName="accessories"
          prefill={createPrefill}
          onClose={() => setCreatePrefill(null)}
          onSaved={() => { setCreatePrefill(null); fetchDbSide() }}
        />
      )}
    </div>
  )
}
