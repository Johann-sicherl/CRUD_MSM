'use client'

import { useState, useEffect } from 'react'

const THEMES = [
  { id: 'cyberpunk', label: 'Ciberpunk',       bg: '#0d0e12', accent: '#fabd00' },
  { id: 'cinza',     label: 'Cinza & Amarelo',  bg: '#181818', accent: '#fabd00' },
  { id: 'luz',       label: 'Luz',              bg: '#f5f2e8', accent: '#9a6e00' },
]

const STEP    = 5
const MIN_PCT = 50
const MAX_PCT = 150

function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  document.documentElement.style.colorScheme = id === 'luz' ? 'light' : 'dark'
}

function applyZoom(pct: number) {
  document.documentElement.style.zoom = pct === 100 ? '' : `${pct}%`
}

export default function ThemeZoomBar() {
  const [theme, setTheme] = useState('cyberpunk')
  const [zoom,  setZoom]  = useState(100)

  useEffect(() => {
    const t = localStorage.getItem('app-theme') ?? 'cyberpunk'
    setTheme(t)
    applyTheme(t)

    const z = parseInt(localStorage.getItem('app-zoom') ?? '100', 10)
    setZoom(z)
    applyZoom(z)
  }, [])

  const handleTheme = (id: string) => {
    setTheme(id)
    applyTheme(id)
    localStorage.setItem('app-theme', id)
  }

  const handleZoom = (delta: number) => {
    setZoom(prev => {
      const next = Math.max(MIN_PCT, Math.min(MAX_PCT, prev + delta))
      applyZoom(next)
      localStorage.setItem('app-zoom', String(next))
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

      {/* Manual zoom */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-widest text-outline/60">Zoom</span>
        <button
          onClick={() => handleZoom(-STEP)}
          disabled={zoom <= MIN_PCT}
          className="w-5 h-5 flex items-center justify-center rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline disabled:opacity-30 transition-colors text-sm leading-none"
        >−</button>
        <span className="w-9 text-center text-primary font-semibold text-[10px]">{zoom}%</span>
        <button
          onClick={() => handleZoom(+STEP)}
          disabled={zoom >= MAX_PCT}
          className="w-5 h-5 flex items-center justify-center rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline disabled:opacity-30 transition-colors text-sm leading-none"
        >+</button>
      </div>

    </div>
  )
}
