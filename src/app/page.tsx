'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { tables, DOMAIN_LABELS, DOMAIN_COLORS } from '@/lib/schema'

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
        const hasError = Object.values(data).some((v) => v === -1)
        if (hasError) setDbError(true)
      })
      .catch(() => { setLoading(false); setDbError(true) })
  }, [])

  const byDomain = DOMAIN_ORDER.map(domain => ({
    domain,
    items: Object.entries(tables).filter(([, s]) => s.domain === domain),
  }))

  const colorMap: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    amber: 'border-amber-200 bg-amber-50',
    green: 'border-green-200 bg-green-50',
    purple: 'border-purple-200 bg-purple-50',
  }
  const badgeMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700',
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 mt-1">Monte Sua Máquina · VMI Security · PostgreSQL 14.2</p>
      </div>

      {dbError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">
          <strong>⚠️ Erro de conexão:</strong> Verifique as credenciais em <code className="bg-red-100 px-1 rounded">.env.local</code> e que o banco está acessível.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {DOMAIN_ORDER.map(domain => {
          const total = Object.entries(tables)
            .filter(([, s]) => s.domain === domain)
            .reduce((acc, [t]) => acc + (counts[t] || 0), 0)
          const color = DOMAIN_COLORS[domain]
          return (
            <div key={domain} className={`rounded-xl border p-4 ${colorMap[color]}`}>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{DOMAIN_LABELS[domain]}</div>
              <div className="text-3xl font-bold text-slate-800">
                {loading ? <span className="animate-pulse">…</span> : total.toLocaleString('pt-BR')}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {Object.entries(tables).filter(([, s]) => s.domain === domain).length} tabelas
              </div>
            </div>
          )
        })}
      </div>

      {byDomain.map(({ domain, items }) => {
        const color = DOMAIN_COLORS[domain]
        return (
          <div key={domain} className="mb-8">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
              {DOMAIN_LABELS[domain]}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {items.map(([tableName, schema]) => (
                <Link
                  key={tableName}
                  href={`/${tableName}`}
                  className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">
                      {schema.label}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeMap[color]}`}>
                      {loading ? '…' : counts[tableName] === -1 ? '!' : (counts[tableName] || 0).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{schema.description}</p>
                  <div className="mt-3 text-xs text-blue-500 group-hover:text-blue-700 font-medium">
                    Abrir →
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
