'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { tables, DOMAIN_LABELS } from '@/lib/schema'

const DOMAIN_ORDER = ['catalogo', 'regras', 'transacional', 'plataforma']

export default function Dashboard() {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState(false)

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

  const byDomain = DOMAIN_ORDER.map(domain => ({
    domain,
    items: Object.entries(tables).filter(([, s]) => s.domain === domain),
  }))

  const totalRecords = Object.values(counts).filter(v => v > 0).reduce((a, b) => a + b, 0)

  return (
    <div className="p-8 max-w-7xl">
      {/* Page header */}
      <div className="mb-8">
        <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">
          VMI Security · Monte Sua Máquina
        </div>
        <h1 className="text-2xl font-bold text-on-surface tracking-tight">Dashboard</h1>
        <p className="text-on-surface-variant text-sm mt-1">
          PostgreSQL 14.2 · 15 tabelas · painel administrativo
        </p>
      </div>

      {dbError && (
        <div className="mb-6 flex items-center gap-3 bg-error-container/20 border border-error/20 rounded-lg px-5 py-4 text-error text-sm">
          ⚠ <strong>Erro de conexão:</strong> Verifique as credenciais em{' '}
          <code className="bg-error-container/40 px-1 rounded font-mono text-xs">.env.local</code>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <div className="bg-surface-container border border-outline-variant rounded-lg p-5 col-span-2 lg:col-span-1">
          <div className="text-[10px] font-mono text-outline uppercase tracking-[0.12em] mb-2">Total de Registros</div>
          <div className="text-4xl font-bold text-primary neon-text font-mono">
            {loading ? <span className="animate-pulse">…</span> : totalRecords.toLocaleString('pt-BR')}
          </div>
          <div className="text-xs text-outline mt-1">15 tabelas ativas</div>
        </div>

        {DOMAIN_ORDER.map(domain => {
          const domainItems = Object.entries(tables).filter(([, s]) => s.domain === domain)
          const total = domainItems.reduce((acc, [t]) => acc + (counts[t] || 0), 0)
          return (
            <div key={domain} className="bg-surface-container border border-outline-variant rounded-lg p-5">
              <div className="text-[10px] font-mono text-outline uppercase tracking-[0.1em] mb-2">{DOMAIN_LABELS[domain]}</div>
              <div className="text-2xl font-bold text-on-surface font-mono">
                {loading ? <span className="animate-pulse">…</span> : total.toLocaleString('pt-BR')}
              </div>
              <div className="text-xs text-outline mt-1">{domainItems.length} tabelas</div>
            </div>
          )
        })}
      </div>

      {/* Table groups */}
      {byDomain.map(({ domain, items }) => (
        <div key={domain} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold text-outline uppercase tracking-[0.15em] font-mono">
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
                    <div className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">
                      {schema.label}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono ${
                      hasError ? 'bg-error-container/30 text-error' : 'bg-primary/10 text-primary'
                    }`}>
                      {loading ? '…' : hasError ? '!' : (count || 0).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-xs text-outline leading-relaxed">{schema.description}</p>
                  <div className="mt-3 text-xs text-outline group-hover:text-primary transition-colors font-mono">
                    Abrir →
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
