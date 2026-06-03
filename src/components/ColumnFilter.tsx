'use client'

import { useState, useEffect, useRef } from 'react'

export default function ColumnFilter({
  searchValue,
  onSearchChange,
  selectedValues,
  onToggleValue,
  onClearValues,
  options,
  placeholder = 'filtrar...',
}: {
  searchValue: string
  onSearchChange: (v: string) => void
  selectedValues: string[]
  onToggleValue: (v: string) => void
  onClearValues: () => void
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

  const hasSelection = selectedValues.length > 0

  const filtered = options.filter(o =>
    !searchValue || o.toLowerCase().includes(searchValue.toLowerCase())
  )

  const allFilteredSelected =
    filtered.length > 0 && filtered.every(o => selectedValues.includes(o))

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      filtered.forEach(o => { if (selectedValues.includes(o)) onToggleValue(o) })
    } else {
      filtered.forEach(o => { if (!selectedValues.includes(o)) onToggleValue(o) })
    }
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          type="text"
          value={searchValue}
          onChange={e => onSearchChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
          placeholder={hasSelection ? `${selectedValues.length} sel.` : placeholder}
          className={`w-full min-w-[120px] bg-surface-container border rounded px-2 py-1 pr-7 text-[10px] font-normal normal-case tracking-normal focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors ${
            hasSelection
              ? 'border-primary bg-primary/5 placeholder:text-primary placeholder:font-semibold'
              : 'border-outline-variant text-on-surface hover:border-outline placeholder:text-outline/40'
          }`}
        />
        <button
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
          tabIndex={-1}
          className={`absolute right-1 top-1/2 -translate-y-1/2 leading-none transition-colors flex items-center gap-px ${
            hasSelection ? 'text-primary font-bold text-[9px]' : 'text-outline hover:text-primary text-[9px]'
          }`}
        >
          {hasSelection && <span className="text-[9px]">{selectedValues.length}</span>}
          <span>▾</span>
        </button>
      </div>

      {open && (
        <div className="absolute z-50 top-full left-0 w-full min-w-[180px] mt-0.5 bg-surface-container-highest border border-outline-variant rounded shadow-xl max-h-52 overflow-y-auto">

          {/* Todos — limpa seleção */}
          <label className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[10px] hover:bg-surface-container-high border-b border-outline-variant/40 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!hasSelection}
              onChange={() => { if (hasSelection) onClearValues() }}
              className="accent-primary"
            />
            <span className={`font-mono ${!hasSelection ? 'text-primary font-semibold' : 'text-outline'}`}>
              — Todos —
            </span>
          </label>

          {/* Selecionar / desmarcar todos visíveis */}
          {filtered.length > 1 && (
            <label className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[10px] hover:bg-surface-container-high border-b border-outline-variant/20 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAllFiltered}
                className="accent-primary"
              />
              <span className="font-mono text-outline italic">
                {allFilteredSelected ? 'Desmarcar todos' : 'Selecionar todos'}
              </span>
            </label>
          )}

          {filtered.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[10px] text-outline italic">Sem resultados</div>
          ) : (
            filtered.map(opt => {
              const checked = selectedValues.includes(opt)
              return (
                <label
                  key={opt}
                  className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-[10px] hover:bg-surface-container-high cursor-pointer select-none ${checked ? 'bg-primary/5' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleValue(opt)}
                    className="accent-primary"
                  />
                  <span className={`font-mono truncate ${checked ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
                    {opt}
                  </span>
                </label>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
