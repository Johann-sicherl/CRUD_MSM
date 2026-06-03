'use client'

import { useState, useEffect } from 'react'

const THEMES = [
  { id: 'cyberpunk', label: 'Ciberpunk',       bg: '#0d0e12', accent: '#fabd00' },
  { id: 'amarelo',   label: 'Amarelo & Branco', bg: '#f5f0e0', accent: '#c8800a' },
  { id: 'salvia',    label: 'Verde Salvia',     bg: '#f2f7f4', accent: '#3d7a50' },
  { id: 'ardosia',   label: 'Azul Ardósia',     bg: '#f3f5fa', accent: '#3a5f9c' },
]

const ZOOM_STEPS = [80, 90, 100, 110, 120, 130]

function applyTheme(id: string) {
  document.documentElement.dataset.theme = id
  document.documentElement.style.colorScheme = id === 'cyberpunk' ? 'dark' : 'light'
}

function applyZoom(z: number) {
  document.documentElement.style.zoom = `${z}%`
}

export default function ThemeZoomBar() {
  const [theme, setTheme] = useState('cyberpunk')
  const [zoom,  setZoom]  = useState(100)

  useEffect(() => {
    const t = localStorage.getItem('app-theme') ?? 'cyberpunk'
    const z = Number(localStorage.getItem('app-zoom') ?? '100')
    setTheme(t)
    setZoom(z)
    applyTheme(t)
    applyZoom(z)
  }, [])

  const handleTheme = (id: string) => {
    setTheme(id)
    applyTheme(id)
    localStorage.setItem('app-theme', id)
  }

  const handleZoom = (delta: number) => {
    const idx  = ZOOM_STEPS.indexOf(zoom)
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + delta))]
    setZoom(next)
    applyZoom(next)
    localStorage.setItem('app-zoom', String(next))
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
              className="w-3 h-3 rounded-full shrink-0 border border-black/10"
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
          onClick={() => handleZoom(-1)}
          disabled={zoom <= ZOOM_STEPS[0]}
          className="w-5 h-5 flex items-center justify-center rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline disabled:opacity-30 transition-colors text-sm leading-none"
        >−</button>
        <span className="w-8 text-center text-primary font-semibold">{zoom}%</span>
        <button
          onClick={() => handleZoom(1)}
          disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          className="w-5 h-5 flex items-center justify-center rounded border border-outline-variant/40 hover:border-primary/40 hover:text-primary text-outline disabled:opacity-30 transition-colors text-sm leading-none"
        >+</button>
      </div>

    </div>
  )
}
