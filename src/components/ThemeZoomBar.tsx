'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'

const THEMES = [
  { id: 'cyberpunk', label: 'Ciberpunk',       bg: '#0d0e12', accent: '#fabd00' },
  { id: 'cinza',     label: 'Cinza & Amarelo',  bg: '#181818', accent: '#fabd00' },
  { id: 'luz',       label: 'Luz',              bg: '#f5f2e8', accent: '#9a6e00' },
]

const STEP    = 5    // percent per +/− click
const MIN_PCT = 50
const MAX_PCT = 150
const MARGIN  = 40   // px buffer so the Ações column never clips at the edge

function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  document.documentElement.style.colorScheme = id === 'luz' ? 'light' : 'dark'
}

export default function ThemeZoomBar() {
  const [theme,   setTheme]   = useState('cyberpunk')
  const [userPct, setUserPct] = useState(100)
  const baseZoomRef     = useRef(1)
  const autoFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathname        = usePathname()

  /* ── Core auto-fit logic ─────────────────────────────────────────────────
     Reset zoom to 100% first so measurements are in natural CSS pixels.
     Two RAFs: first triggers layout reflow, second reads after paint.
     MARGIN added to contentW so the rightmost column (Ações) never clips.  ─ */
  const autoFit = useCallback(() => {
    document.documentElement.style.zoom = '100%'

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const mainEl = document.querySelector('main') as HTMLElement | null
        if (!mainEl) return

        const sidebarW = mainEl.offsetLeft    // 256 when pinned, 0 when not
        const availW   = mainEl.clientWidth   // visible main width at zoom=100%

        const tables  = Array.from(mainEl.querySelectorAll('table')) as HTMLElement[]
        const tableW  = tables.reduce((mx, t) => Math.max(mx, t.offsetWidth), 0)
        const contentW = (tableW > 0 ? tableW : mainEl.scrollWidth) + MARGIN

        const V    = availW + sidebarW
        const base = Math.min(
          MAX_PCT / 100,
          Math.max(MIN_PCT / 100, V / (contentW + sidebarW))
        )

        baseZoomRef.current = base
        setUserPct(100)
        document.documentElement.style.zoom = `${base * 100}%`
      })
    })
  }, [])

  /* ── Shared debounce — cancels any pending call before scheduling a new one.
     This ensures that route-change (400ms) and datatable:loaded (100ms) never
     both fire: whichever arrives last wins, producing a single zoom update.  ─ */
  const scheduleAutoFit = useCallback((delay: number) => {
    if (autoFitTimerRef.current !== null) clearTimeout(autoFitTimerRef.current)
    autoFitTimerRef.current = setTimeout(() => {
      autoFitTimerRef.current = null
      autoFit()
    }, delay)
  }, [autoFit])

  /* ── Re-auto-fit on route change (fallback for pages with no table) ─────── */
  useEffect(() => {
    scheduleAutoFit(400)
    return () => {
      if (autoFitTimerRef.current !== null) clearTimeout(autoFitTimerRef.current)
    }
  }, [pathname, scheduleAutoFit])

  /* ── Re-auto-fit when DataTable finishes loading real data ──────────────── */
  useEffect(() => {
    const handler = () => scheduleAutoFit(100)
    window.addEventListener('datatable:loaded', handler)
    return () => window.removeEventListener('datatable:loaded', handler)
  }, [scheduleAutoFit])

  /* ── Restore theme from localStorage on mount ───────────────────────────── */
  useEffect(() => {
    const t = localStorage.getItem('app-theme') ?? 'cyberpunk'
    setTheme(t)
    applyTheme(t)
  }, [])

  const handleTheme = (id: string) => {
    setTheme(id)
    applyTheme(id)
    localStorage.setItem('app-theme', id)
  }

  const handleZoom = (delta: number) => {
    setUserPct(prev => {
      const next = Math.max(MIN_PCT, Math.min(MAX_PCT, prev + delta))
      document.documentElement.style.zoom = `${baseZoomRef.current * next}%`
      return next
    })
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-1.5 bg-surface-container-high border-b border-outline-variant/40 font-mono shrink-0 select-none">

      {/* Theme selector */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] uppercase tracking-widest text-outline/60 mr-1">Tema</span>
        {THEMES.map(th => (
          <button
            key={th.id}
            onClick={() => handleTheme(th.id)}
            title={th.label}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-all text-[9px] border ${
              theme === th.id
                ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span
              className="w-3 h-3 rounded-full shrink-0 border border-white/10"
              style={{ background: `linear-gradient(135deg, ${th.bg} 50%, ${th.accent} 50%)` }}
            />
            {th.label}
          </button>
        ))}
      </div>

      {/* Zoom — 100% always means all columns visible */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-widest text-outline/60">Zoom</span>
        <button
          onClick={() => handleZoom(-STEP)}
          disabled={userPct <= MIN_PCT}
          className="w-5 h-5 flex items-center justify-center rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline disabled:opacity-30 transition-colors text-sm leading-none"
        >−</button>
        <span className="w-9 text-center text-primary font-semibold text-[10px]">{userPct}%</span>
        <button
          onClick={() => handleZoom(+STEP)}
          disabled={userPct >= MAX_PCT}
          className="w-5 h-5 flex items-center justify-center rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline disabled:opacity-30 transition-colors text-sm leading-none"
        >+</button>
      </div>

    </div>
  )
}
