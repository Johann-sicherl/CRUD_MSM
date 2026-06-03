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
     Measures at CSS zoom=100% so values are in natural pixel space.
     Uses sidebar offsetLeft in the formula so the sidebar width doesn't
     compress the available area incorrectly when zoomed.              ─── */
  const autoFit = useCallback(() => {
    document.documentElement.style.zoom = '100%'

    // Two RAFs: first triggers reflow, second measures after paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const mainEl = document.querySelector('main')
        if (!mainEl) return

        const sidebarW = (mainEl as HTMLElement).offsetLeft  // 256 pinned, 0 unpinned
        const availW   = mainEl.clientWidth                  // visible width of main
        const contentW = mainEl.scrollWidth                  // total content width

        if (contentW <= availW) {
          // Everything fits — keep at 100% CSS (base = 1)
          baseZoomRef.current = 1
          setUserPct(100)
          return
        }

        // Correct formula: accounts for the fact that zooming out expands the
        // viewport CSS-pixel space while the sidebar stays fixed in CSS pixels.
        const base = Math.max(
          MIN_PCT / 100,
          (availW + sidebarW) / (contentW + sidebarW)
        )
        baseZoomRef.current = base
        setUserPct(100)                                       // always reset to 100%
        document.documentElement.style.zoom = `${base * 100}%`
      })
    })
  }, [])

  /* ── Re-auto-fit on route change (backup: 400ms for non-table pages) ─── */
  useEffect(() => {
    const t = setTimeout(() => autoFit(), 400)
    return () => clearTimeout(t)
  }, [pathname, autoFit])

  /* ── Re-auto-fit when DataTable finishes loading real data ───────────── */
  useEffect(() => {
    const handler = () => autoFit()
    window.addEventListener('datatable:loaded', handler)
    return () => window.removeEventListener('datatable:loaded', handler)
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
