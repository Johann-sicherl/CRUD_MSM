'use client'

import { useState, useEffect, useRef } from 'react'

export default function ColumnFilter({
  value,
  onChange,
  onSelect,
  options,
  placeholder = 'filtrar...',
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (v: string) => void
  options: string[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o => !value || o.toLowerCase().includes(value.toLowerCase()))

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
          placeholder={placeholder}
          className={`w-full min-w-[72px] bg-surface-container border rounded px-2 py-1 pr-5 text-[10px] font-normal normal-case tracking-normal placeholder:text-outline/40 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors ${
            value ? 'border-primary text-on-surface' : 'border-outline-variant text-on-surface hover:border-outline'
          }`}
        />
        <button
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
          tabIndex={-1}
          className={`absolute right-1 top-1/2 -translate-y-1/2 text-[9px] leading-none transition-colors ${value ? 'text-primary' : 'text-outline hover:text-primary'}`}
        >
          ▾
        </button>
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 min-w-full mt-0.5 bg-surface-container-highest border border-outline-variant rounded shadow-xl max-h-48 overflow-y-auto">
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onSelect(''); setOpen(false) }}
            className="w-full text-left px-2 py-1.5 text-[10px] text-outline hover:bg-surface-container-high border-b border-outline-variant/30 font-mono"
          >
            — Todos —
          </button>
          {filtered.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-outline italic">Sem resultados</div>
          ) : (
            filtered.map(opt => (
              <button
                key={opt}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onSelect(opt); setOpen(false) }}
                className={`w-full text-left px-2 py-1.5 text-[10px] hover:bg-surface-container-high font-mono truncate block ${
                  opt === value ? 'text-primary bg-primary/5' : 'text-on-surface-variant'
                }`}
              >
                {opt}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
