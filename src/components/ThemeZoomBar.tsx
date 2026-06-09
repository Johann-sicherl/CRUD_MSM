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
  const fitGenRef       = useRef(0)   // increments on each autoFit call; stale RAF chains abort
  const pathname        = usePathname()

  /* ── Core auto-fit logic ─────────────────────────────────────────────────
     1. Increment generation so any in-flight RAF chain from a prior call aborts.
     2. Reset zoom to 100% so all measurements are in natural CSS pixels.
     3. Two RAFs: first triggers reflow, second reads stable post-paint geometry.
     4. If no <table> is present (page is loading or has no table), reset to 100%
        and bail — this prevents applying a wrong zoom calculated from scrollWidth.
     5. MARGIN added to contentW so the Ações column never clips at the edge.    ─ */
  const autoFit = useCallback(() => {
    const gen = ++fitGenRef.current
    document.documentElement.style.zoom = '100%'

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (fitGenRef.current !== gen) return   // stale — a newer call took over

        const mainEl = document.querySelector('main') as HTMLElement | null
        if (!mainEl) return

        const tables  = Array.from(mainEl.querySelectorAll('table')) as HTMLElement[]
        const tableW  = tables.reduce((mx, t) => Math.max(mx, t.offsetWidth), 0)

        // No table yet (loading state or table-free page) — stay at 100%
        if (tableW === 0) {
          baseZoomRef.current = 1
          setUserPct(100)
          return
        }

        const sidebarW = mainEl.offsetLeft    // 256 when pinned, 0 when not
        const availW   = mainEl.clientWidth   // visible main width at zoom=100%
        const contentW = tableW + MARGIN

        // zoom that makes the table fill exactly the available area, accounting
        // for the sidebar also scaling with CSS zoom (position: fixed scales too)
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

  /* ── Shared debounce — cancels any pending timer before scheduling a new one ─ */
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

  /* ── Re-auto-fit when DataTable finishes rendering real data ────────────── */
  useEffect(() => {
    const handler = () => scheduleAutoFit(50)
    window.addEventListener('datatable:loaded', handler)
    return () => window.removeEventListener('datatable:loaded', handler)
  }, [scheduleAutoFit])

  /* ── Re-auto-fit whenever the browser window is resized ────────────────── */
  useEffect(() => {
    const handler = () => scheduleAutoFit(150)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [scheduleAutoFit])

  /* ── Re-auto-fit after sidebar is pinned/unpinned (post-transition) ─────── */
  useEffect(() => {
    const handler = () => scheduleAutoFit(0)
    window.addEventListener('layout:changed', handler)
    return () => window.removeEventListener('layout:changed', handler)
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
