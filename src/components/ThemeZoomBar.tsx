'use client'

import { useState, useEffect, useCallback } from 'react'

const THEMES = [
  { id: 'cyberpunk', label: 'Ciberpunk',       bg: '#0d0e12', accent: '#fabd00' },
  { id: 'azul',      label: 'Ciberpunk Azul',  bg: '#060c18', accent: '#00c8f0' },
  { id: 'cinza',     label: 'Cinza & Amarelo',  bg: '#181818', accent: '#fabd00' },
]

const MIN_ZOOM = 50
const MAX_ZOOM = 130
const STEP     = 5

function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  document.documentElement.style.colorScheme = 'dark'
}

function applyZoom(z: number) {
  document.documentElement.style.zoom = `${z}%`
}

export default function ThemeZoomBar() {
  const [theme, setTheme] = useState('cyberpunk')
  const [zoom,  setZoom]  = useState(100)

  /* ── Auto-fit: set zoom so all table columns fit within main area ─────── */
  const autoFit = useCallback(() => {
    // 1. Reset to 100% so measurements are in natural pixel space
    document.documentElement.style.zoom = '100%'

    // 2. Two frames: first triggers reflow, second measures after paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const main = document.querySelector('main')
        if (!main) return

        const availW   = main.clientWidth   // visible area width at 100% zoom
        const contentW = main.scrollWidth   // total content width at 100% zoom

        if (contentW <= availW) {
          setZoom(100)
          localStorage.setItem('app-zoom', '100')
          return
        }

        const z = Math.max(MIN_ZOOM, Math.round((availW / contentW) * 100))
        applyZoom(z)
        setZoom(z)
        localStorage.setItem('app-zoom', String(z))
      })
    })
  }, [])

  /* ── Init from localStorage ─────────────────────────────────────────────── */
  useEffect(() => {
    const t         = localStorage.getItem('app-theme') ?? 'cyberpunk'
    const savedZoom = localStorage.getItem('app-zoom')

    setTheme(t)
    applyTheme(t)

    if (savedZoom) {
      const z = Number(savedZoom)
      setZoom(z)
      applyZoom(z)
    } else {
      // No saved zoom: auto-fit on first visit
      autoFit()
    }
  }, [autoFit])

  const handleTheme = (id: string) => {
    setTheme(id)
    applyTheme(id)
    localStorage.setItem('app-theme', id)
  }

  const handleZoom = (delta: number) => {
    setZoom(prev => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta))
      applyZoom(next)
      localStorage.setItem('app-zoom', String(next))
      return next
    })
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-1.5 bg-surface-container-high border-b border-outline-variant/40 text-[10px] font-mono shrink-0 select-none">

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

      {/* Zoom control */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-widest text-outline/60">Zoom</span>
        <button
          onClick={autoFit}
          title="Ajustar zoom para caber todas as colunas na tela"
          className="px-2 py-0.5 rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline transition-colors text-[9px] uppercase tracking-wider"
        >
          Auto
        </button>
        <button
          onClick={() => handleZoom(-STEP)}
          disabled={zoom <= MIN_ZOOM}
          className="w-5 h-5 flex items-center justify-center rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline disabled:opacity-30 transition-colors text-sm leading-none"
        >−</button>
        <span className="w-9 text-center text-primary font-semibold">{zoom}%</span>
        <button
          onClick={() => handleZoom(+STEP)}
          disabled={zoom >= MAX_ZOOM}
          className="w-5 h-5 flex items-center justify-center rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline disabled:opacity-30 transition-colors text-sm leading-none"
        >+</button>
      </div>

    </div>
  )
}
