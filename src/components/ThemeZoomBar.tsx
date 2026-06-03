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

function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  document.documentElement.style.colorScheme = id === 'luz' ? 'light' : 'dark'
}

export default function ThemeZoomBar() {
  const [theme,   setTheme]   = useState('cyberpunk')
  // userPct: scale relative to auto-fit. 100 = auto-fit (all columns visible)
  const [userPct, setUserPct] = useState(100)
  // baseZoom: CSS zoom fraction so all columns fit (e.g. 0.72 means 72% CSS zoom)
  const baseZoomRef  = useRef(1)
  const pathname     = usePathname()

  /* ── Core auto-fit logic ─────────────────────────────────────────────────
     KEY: main has overflow-auto and the table lives inside an overflow-x-auto
     div. main.scrollWidth therefore equals main.clientWidth (the inner div
     creates its own scroll context). We must read table.offsetWidth directly,
     which reports the element's full layout width regardless of clipping.

     Zoom formula: at zoom z, viewport CSS pixels = V/z (V = physical width).
     Sidebar stays fixed at S CSS pixels. Table width T also stays fixed.
     Need V/z - S >= T  →  z = V / (T + S)  where V = availW + sidebarW.   ─ */
  const autoFit = useCallback(() => {
    document.documentElement.style.zoom = '100%'

    // Two RAFs: first triggers layout reflow, second reads after paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const mainEl = document.querySelector('main') as HTMLElement | null
        if (!mainEl) return

        const sidebarW = mainEl.offsetLeft    // 256 when pinned, 0 when not
        const availW   = mainEl.clientWidth   // visible main width at zoom=100%

        // Measure widest <table> inside main — bypasses overflow-x-auto clipping
        const tables  = Array.from(mainEl.querySelectorAll('table')) as HTMLElement[]
        const tableW  = tables.reduce((mx, t) => Math.max(mx, t.offsetWidth), 0)
        const contentW = tableW > 0 ? tableW : mainEl.scrollWidth

        // Formula works both ways:
        //  table too wide  → base < 1 → zoom out so table fits
        //  table too narrow → base > 1 → zoom in so table fills available space
        const V    = availW + sidebarW                         // true viewport width
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

  /* ── Re-auto-fit on route change (backup: 400ms for non-table pages) ─── */
  useEffect(() => {
    const t = setTimeout(() => autoFit(), 400)
    return () => clearTimeout(t)
  }, [pathname, autoFit])

  /* ── Re-auto-fit when DataTable finishes loading real data ──────────────
     setPageData triggers React re-render asynchronously. We defer by 100ms
     so the DOM has been updated with the full table before we measure.    ─ */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const handler = () => { t = setTimeout(() => autoFit(), 100) }
    window.addEventListener('datatable:loaded', handler)
    return () => { window.removeEventListener('datatable:loaded', handler); clearTimeout(t) }
  }, [autoFit])

  /* ── Restore theme from localStorage on mount ───────────────────────── */
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
