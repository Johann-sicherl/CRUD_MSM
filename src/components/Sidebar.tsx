'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { tables, DOMAIN_LABELS } from '@/lib/schema'

const DOMAIN_ORDER = ['catalogo', 'regras', 'transacional', 'plataforma']

export default function Sidebar() {
  const pathname = usePathname()

  const byDomain = DOMAIN_ORDER.map((domain) => ({
    domain,
    items: Object.entries(tables).filter(([, schema]) => schema.domain === domain),
  }))

  return (
    <aside className="w-64 min-h-screen bg-surface-container-low border-r border-outline-variant flex flex-col shrink-0 relative z-20">
      {/* Header */}
      <div className="px-5 py-5 border-b border-outline-variant">
        <div className="text-[10px] font-semibold text-outline uppercase tracking-[0.2em] mb-1 font-mono">VMI Security</div>
        <div className="text-base font-bold text-primary neon-text tracking-wider font-mono">COMMAND CENTER</div>
        <div className="text-[10px] text-outline mt-1 font-mono">PostgreSQL 14 · CRUD · MSM</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        <Link
          href="/"
          className={`flex items-center gap-2 px-4 py-2 mx-2 rounded text-sm transition-all ${
            pathname === '/'
              ? 'bg-primary/10 text-primary border-l-2 border-primary pl-[14px]'
              : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
          }`}
        >
          <span className="font-medium">Dashboard</span>
        </Link>

        {byDomain.map(({ domain, items }) => (
          <div key={domain} className="mt-5">
            <div className="px-4 py-1 text-[10px] font-semibold text-outline uppercase tracking-[0.15em] font-mono">
              {DOMAIN_LABELS[domain]}
            </div>
            {items.map(([tableName, schema]) => {
              const isActive = pathname === `/${tableName}`
              return (
                <Link
                  key={tableName}
                  href={`/${tableName}`}
                  className={`flex items-center px-4 py-2 mx-2 rounded text-sm transition-all ${
                    isActive
                      ? 'bg-primary/10 text-primary border-l-2 border-primary pl-[14px]'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span className="truncate">{schema.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-outline-variant text-[10px] text-outline font-mono">
        15 tabelas · v3.0
      </div>
    </aside>
  )
}
