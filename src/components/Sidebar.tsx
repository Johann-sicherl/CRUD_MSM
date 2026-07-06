'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { tables, DOMAIN_LABELS } from '@/lib/schema'

interface Props {
  pinned: boolean
  onPinChange: (pinned: boolean) => void
}

const DOMAIN_ORDER = ['catalogo', 'regras']

export default function Sidebar({ pinned, onPinChange }: Props) {
  const pathname = usePathname()
  const [hovered, setHovered] = useState(false)
  const expanded = pinned || hovered

  const byDomain = DOMAIN_ORDER.map(domain => ({
    domain,
    items: Object.entries(tables).filter(([, schema]) => schema.domain === domain),
  }))

  return (
    <>
      {/* Thin trigger strip — shown only when sidebar is fully collapsed */}
      {!expanded && (
        <div
          className="fixed left-0 top-0 w-3 h-full z-40 bg-primary/20 border-r border-primary/30 cursor-e-resize"
          onMouseEnter={() => setHovered(true)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-full z-30 w-64 flex flex-col bg-surface-container-low border-r border-outline-variant shadow-2xl transition-transform duration-200 ease-in-out ${
          expanded ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Header */}
        <div className="relative px-4 py-4 border-b border-outline-variant flex flex-col items-center gap-2">
          <Image
            src="https://vmisecurity.com/wp-content/uploads/2021/11/logo-vmi-trademark.png"
            alt="VMI Security"
            width={160}
            height={56}
            className="object-contain"
            priority
            unoptimized
          />
          <div className="text-base font-bold text-primary neon-text tracking-wider font-mono">COMMAND CENTER</div>
          <div className="text-[10px] text-outline font-mono">PostgreSQL 14 · CRUD · MSM</div>

          {/* Pin button */}
          <button
            onClick={() => onPinChange(!pinned)}
            title={pinned ? 'Desafixar — sidebar recolhe ao tirar o mouse' : 'Fixar sidebar aberta'}
            className={`absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded transition-all ${
              pinned
                ? 'text-primary bg-primary/15 border border-primary/40 hover:bg-primary/25'
                : 'text-outline border border-outline-variant hover:border-primary/50 hover:text-primary'
            }`}
          >
            <PinIcon pinned={pinned} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3">
          <Link
            href="/"
            className={`flex items-center px-4 py-2 mx-2 rounded text-sm transition-all ${
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
              {domain === 'catalogo' && (
                <Link
                  href="/custos-gerais-vmi"
                  className={`flex items-center px-4 py-2 mx-2 rounded text-sm transition-all ${
                    pathname === '/custos-gerais-vmi'
                      ? 'bg-primary/10 text-primary border-l-2 border-primary pl-[14px]'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span className="truncate">Custos Gerais VMI</span>
                </Link>
              )}
            </div>
          ))}
        </nav>

        {/* Sistema */}
        <div className="mt-5 mb-2">
          <div className="px-4 py-1 text-[10px] font-semibold text-outline uppercase tracking-[0.15em] font-mono">
            Sistema
          </div>
          <Link
            href="/options"
            className={`flex items-center px-4 py-2 mx-2 rounded text-sm transition-all ${
              pathname === '/options'
                ? 'bg-primary/10 text-primary border-l-2 border-primary pl-[14px]'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            <span className="truncate">Listas de Opções</span>
          </Link>
          <Link
            href="/auditoria"
            className={`flex items-center px-4 py-2 mx-2 rounded text-sm transition-all ${
              pathname === '/auditoria'
                ? 'bg-primary/10 text-primary border-l-2 border-primary pl-[14px]'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            <span className="truncate">Auditoria</span>
          </Link>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-outline-variant text-[10px] text-outline font-mono flex items-center justify-between">
          <span>10 tabelas · v3.1</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${
            pinned
              ? 'text-primary border-primary/30 bg-primary/10'
              : 'text-outline border-outline-variant'
          }`}>
            {pinned ? 'FIXADO' : 'AUTO'}
          </span>
        </div>
      </aside>
    </>
  )
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={pinned ? undefined : { transform: 'rotate(45deg)' }}
    >
      <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z" />
    </svg>
  )
}
