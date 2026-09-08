'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { tables, DOMAIN_LABELS } from '@/lib/schema'
import { useAppAuth } from '@/lib/appAuthContext'
import PendingControladoriaModal from '@/components/PendingControladoriaModal'
import CusteioComercialModal from '@/components/CusteioComercialModal'
import type { PendingControladoriaTable } from '@/app/api/dashboard/pending-controladoria/route'
import type { CusteioComercialTable } from '@/app/api/dashboard/custeio-comercial/route'

const DOMAIN_ORDER = ['catalogo', 'regras', 'plataforma']

export default function Dashboard() {
  const { user: appUser } = useAppAuth()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState(false)

  // Cartão "Pendências de Controladoria/Fiscal/Precificação" — só faz
  // sentido pra quem não é admin (Gerente Adm Comercial): quantos registros,
  // em todas as tabelas com campo de custo/IPI/margem/comissão etc., ainda
  // estão em 0 (a "chave" de pendência — ver localCostGuard.ts).
  const [pendingTables, setPendingTables] = useState<PendingControladoriaTable[] | null>(null)
  const [pendingModalOpen, setPendingModalOpen] = useState(false)

  // Cartão "Em Custeio (Comercial)" — só pro admin: visibilidade de quantos
  // componentes estão na fila de custeio da Gerente Adm Comercial (fila
  // pending_target_cost) e quantos já foram sinalizados com "Custo Imputado"
  // (status 'em_alteracao') vs. ainda aguardando (status 'novo'). novo/
  // emAlteracao vêm direto da contagem da fila (a fonte da verdade) — nunca
  // somados a partir de custeioTables, que é só a quebra por tabela e pode
  // ficar incompleta se algum código não bater com nenhuma linha (ver
  // "unmatched" e o comentário em api/dashboard/custeio-comercial/route.ts).
  const [custeioTables, setCusteioTables] = useState<CusteioComercialTable[] | null>(null)
  const [custeioTotals, setCusteioTotals] = useState<{ novo: number; emAlteracao: number; unmatched: number } | null>(null)
  const [custeioModalOpen, setCusteioModalOpen] = useState(false)

  useEffect(() => {
    fetch('/api/tables')
      .then(r => r.json())
      .then(data => {
        setCounts(data)
        setLoading(false)
        if (Object.values(data).some((v) => v === -1)) setDbError(true)
      })
      .catch(() => { setLoading(false); setDbError(true) })
  }, [])

  useEffect(() => {
    if (appUser.isAdmin) return
    let cancelled = false
    fetch('/api/dashboard/pending-controladoria')
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (!cancelled && json) setPendingTables(json.tables) })
      .catch(() => { if (!cancelled) setPendingTables([]) })
    return () => { cancelled = true }
  }, [appUser.isAdmin])

  useEffect(() => {
    if (!appUser.isAdmin) return
    let cancelled = false
    fetch('/api/dashboard/custeio-comercial')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled || !json) return
        setCusteioTables(json.tables)
        setCusteioTotals({ novo: json.novo ?? 0, emAlteracao: json.emAlteracao ?? 0, unmatched: json.unmatched ?? 0 })
      })
      .catch(() => { if (!cancelled) { setCusteioTables([]); setCusteioTotals({ novo: 0, emAlteracao: 0, unmatched: 0 }) } })
    return () => { cancelled = true }
  }, [appUser.isAdmin])

  const pendingTotal = (pendingTables ?? []).filter(t => t.count > 0).reduce((sum, t) => sum + t.count, 0)

  const byDomain = DOMAIN_ORDER.map(domain => ({
    domain,
    items: Object.entries(tables).filter(([, s]) => s.domain === domain),
  }))

  const totalRecords = Object.values(counts).filter(v => v > 0).reduce((a, b) => a + b, 0)

  return (
    <div className="p-8 max-w-7xl">
      {/* Page header */}
      <div className="mb-8">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          VMI Security · Monte Sua Máquina
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Dashboard</h1>
        <p className="text-on-surface-variant text-base mt-1">
          PostgreSQL 14.2 · 15 tabelas · painel administrativo
        </p>
      </div>

      {dbError && (
        <div className="mb-6 flex items-center gap-3 bg-error-container/20 border border-error/20 rounded-lg px-5 py-4 text-error text-base">
          ⚠ <strong>Erro de conexão:</strong> Verifique as credenciais em{' '}
          <code className="bg-error-container/40 px-1 rounded font-mono text-sm">.env.local</code>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <div className="bg-surface-container border border-outline-variant rounded-lg p-5 col-span-2 lg:col-span-1">
          <div className="text-xs font-mono text-outline uppercase tracking-[0.12em] mb-2">Total de Registros</div>
          <div className="text-5xl font-bold text-primary neon-text font-mono">
            {loading ? <span className="animate-pulse">…</span> : totalRecords.toLocaleString('pt-BR')}
          </div>
          <div className="text-sm text-outline mt-1">15 tabelas ativas</div>
        </div>

        {DOMAIN_ORDER.map(domain => {
          const domainItems = Object.entries(tables).filter(([, s]) => s.domain === domain)
          const total = domainItems.reduce((acc, [t]) => acc + (counts[t] || 0), 0)
          return (
            <div key={domain} className="bg-surface-container border border-outline-variant rounded-lg p-5">
              <div className="text-xs font-mono text-outline uppercase tracking-[0.1em] mb-2">{DOMAIN_LABELS[domain]}</div>
              <div className="text-3xl font-bold text-on-surface font-mono">
                {loading ? <span className="animate-pulse">…</span> : total.toLocaleString('pt-BR')}
              </div>
              <div className="text-sm text-outline mt-1">{domainItems.length} tabelas</div>
            </div>
          )
        })}

        {!appUser.isAdmin && (
          <button
            onClick={() => setPendingModalOpen(true)}
            disabled={pendingTables === null}
            title="Ver, tabela por tabela, os registros ainda sem custo/percentual real definido"
            className="bg-surface-container border border-amber-500/30 rounded-lg p-5 text-left hover:border-amber-500/60 hover:shadow-neon transition-all disabled:cursor-wait"
          >
            <div className="text-xs font-mono text-amber-400 uppercase tracking-[0.1em] mb-2">Pendências Controladoria</div>
            <div className="text-3xl font-bold text-amber-400 font-mono">
              {pendingTables === null ? <span className="animate-pulse">…</span> : pendingTotal.toLocaleString('pt-BR')}
            </div>
            <div className="text-sm text-outline mt-1">clique para ver por tabela</div>
          </button>
        )}

        {appUser.isAdmin && (
          <button
            onClick={() => setCusteioModalOpen(true)}
            disabled={custeioTotals === null}
            title="Visibilidade sobre a fila de custeio da Gerente Adm Comercial — quantos componentes aguardam custeio e quantos já têm Custo Imputado"
            className="bg-surface-container border border-blue-500/30 rounded-lg p-5 text-left hover:border-blue-500/60 hover:shadow-neon transition-all disabled:cursor-wait col-span-2 lg:col-span-1"
          >
            <div className="text-xs font-mono text-blue-400 uppercase tracking-[0.1em] mb-2">Em Custeio (Comercial)</div>
            <div className="text-3xl font-bold text-blue-400 font-mono">
              {custeioTotals === null ? <span className="animate-pulse">…</span> : (custeioTotals.novo + custeioTotals.emAlteracao).toLocaleString('pt-BR')}
            </div>
            <div className="text-sm text-outline mt-1 flex items-center gap-3">
              {custeioTotals === null ? 'clique para ver por tabela' : (
                <>
                  <span className="text-amber-400">{custeioTotals.novo.toLocaleString('pt-BR')} aguardando</span>
                  <span className="text-blue-400">{custeioTotals.emAlteracao.toLocaleString('pt-BR')} imputado{custeioTotals.emAlteracao !== 1 ? 's' : ''}</span>
                </>
              )}
            </div>
            {custeioTotals !== null && custeioTotals.unmatched > 0 && (
              <div className="text-xs text-error mt-1">
                ⚠ {custeioTotals.unmatched} código{custeioTotals.unmatched !== 1 ? 's' : ''} na fila sem registro correspondente
              </div>
            )}
          </button>
        )}
      </div>

      {/* Table groups */}
      {byDomain.map(({ domain, items }) => (
        <div key={domain} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-outline uppercase tracking-[0.15em] font-mono">
              {DOMAIN_LABELS[domain]}
            </h2>
            <div className="flex-1 h-px bg-outline-variant ml-2" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map(([tableName, schema]) => {
              const count = counts[tableName]
              const hasError = count === -1
              return (
                <Link
                  key={tableName}
                  href={`/${tableName}`}
                  className="bg-surface-container border border-outline-variant rounded-lg p-4 hover:border-primary hover:shadow-neon transition-all group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-base font-semibold text-on-surface group-hover:text-primary transition-colors">
                      {schema.label}
                    </div>
                    <span className={`text-sm font-bold px-2 py-0.5 rounded font-mono ${
                      hasError ? 'bg-error-container/30 text-error' : 'bg-primary/10 text-primary'
                    }`}>
                      {loading ? '…' : hasError ? '!' : (count || 0).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-sm text-outline leading-relaxed">{schema.description}</p>
                  <div className="mt-3 text-sm text-outline group-hover:text-primary transition-colors font-mono">
                    Abrir →
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      ))}

      {pendingModalOpen && pendingTables && (
        <PendingControladoriaModal tables={pendingTables} onClose={() => setPendingModalOpen(false)} />
      )}

      {custeioModalOpen && custeioTables && (
        <CusteioComercialModal tables={custeioTables} onClose={() => setCusteioModalOpen(false)} />
      )}
    </div>
  )
}
