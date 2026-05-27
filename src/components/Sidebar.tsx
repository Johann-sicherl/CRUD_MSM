'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { tables, DOMAIN_LABELS } from '@/lib/schema'

const DOMAIN_ICONS: Record<string, string> = {
  catalogo: '📦',
  regras: '⚙️',
  transacional: '📋',
  plataforma: '👥',
}

const DOMAIN_ORDER = ['catalogo', 'regras', 'transacional', 'plataforma']

export default function Sidebar() {
  const pathname = usePathname()

  const byDomain = DOMAIN_ORDER.map((domain) => ({
    domain,
    items: Object.entries(tables).filter(([, schema]) => schema.domain === domain),
  }))

  return (
    <aside className="w-64 min-h-screen bg-slate-900 text-slate-100 flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-slate-700">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">VMI Security</div>
        <div className="text-lg font-bold text-white">MSM Admin</div>
        <div className="text-xs text-slate-400 mt-1">PostgreSQL 14 · CRUD</div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        <Link
          href="/"
          className={`flex items-center gap-2 px-4 py-2 text-sm mx-2 rounded-md transition-colors ${
            pathname === '/' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <span>🏠</span>
          <span>Dashboard</span>
        </Link>

        {byDomain.map(({ domain, items }) => (
          <div key={domain} className="mt-4">
            <div className="px-4 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <span>{DOMAIN_ICONS[domain]}</span>
              <span>{DOMAIN_LABELS[domain]}</span>
            </div>
            {items.map(([tableName, schema]) => {
              const isActive = pathname === `/${tableName}`
              return (
                <Link
                  key={tableName}
                  href={`/${tableName}`}
                  className={`flex items-center gap-2 px-4 py-2 text-sm mx-2 rounded-md transition-colors ${
                    isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate">{schema.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-500">
        15 tabelas · v3.0
      </div>
    </aside>
  )
}
