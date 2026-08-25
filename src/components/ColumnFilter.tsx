'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface DropdownPos { top: number; left: number; width: number }

/** The app applies CSS `zoom` on <html> (user zoom preference). Coordinates
 *  from getBoundingClientRect() are in visual (zoomed) space, but top/left on
 *  a position:fixed element inside the zoomed root get re-scaled by the zoom —
 *  so they must be divided by the zoom factor to land where intended. */
function getRootZoom(): number {
  const el = document.documentElement as HTMLElement & { currentCSSZoom?: number }
  if (typeof el.currentCSSZoom === 'number' && el.currentCSSZoom > 0) return el.currentCSSZoom
  const z = getComputedStyle(el).zoom
  if (!z || z === 'normal') return 1
  const n = parseFloat(z)
  if (isNaN(n) || n <= 0) return 1
  return z.includes('%') ? n / 100 : n
}

export default function ColumnFilter({
  searchValue,
  onSearchChange,
  selectedValues,
  onToggleValue,
  onClearValues,
  options,
  placeholder = 'filtrar...',
  compact = false,
}: {
  searchValue: string
  onSearchChange: (v: string) => void
  selectedValues: string[]
  onToggleValue: (v: string) => void
  onClearValues: () => void
  options: string[]
  placeholder?: string
  compact?: boolean
}) {
  const [open, setOpen]     = useState(false)
  const [pos, setPos]       = useState<DropdownPos | null>(null)
  const [mounted, setMounted] = useState(false)
  // Estilo Excel: por padrão, digitar e apertar Enter SUBSTITUI o filtro
  // pelo que bateu com o texto digitado. Só soma à seleção já marcada
  // quando esta caixa está marcada — sem ela, uma segunda filtragem
  // acumulava com a primeira em vez de virar um filtro novo.
  const [addToFilter, setAddToFilter] = useState(false)
  const triggerRef  = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  const calcPos = useCallback((): DropdownPos | null => {
    if (!triggerRef.current) return null
    const r = triggerRef.current.getBoundingClientRect()
    // Anchor below the full header row so the dropdown never overlaps adjacent
    // filter inputs in the same <thead> row (the th has extra bottom padding
    // that r.bottom alone doesn't account for). Take whichever edge is lowest.
    const thead = triggerRef.current.closest('thead')
    const th    = triggerRef.current.closest('th')
    const top = Math.max(
      thead ? thead.getBoundingClientRect().bottom : 0,
      th    ? th.getBoundingClientRect().bottom    : 0,
      r.bottom,
    ) + 4
    const w = Math.max(r.width, 220)
    // Flip left when dropdown would overflow the viewport on the right
    const left = r.left + w > window.innerWidth
      ? Math.max(0, r.right - w)
      : r.left
    // Convert from visual coordinates back to the zoomed coordinate space
    const zoom = getRootZoom()
    return { top: top / zoom, left: left / zoom, width: w / zoom }
  }, [])

  const openDropdown = useCallback(() => {
    const p = calcPos()
    if (p) setPos(p)
    setOpen(true)
  }, [calcPos])

  // Close when click lands outside BOTH the trigger and the portal dropdown
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (dropdownRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // Keep dropdown aligned when the page scrolls or window resizes
  useEffect(() => {
    if (!open) return
    const update = () => {
      const p = calcPos()
      if (p) setPos(p)
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, calcPos])

  const hasSelection = selectedValues.length > 0
  const filtered = options.filter(o =>
    !searchValue || o.toLowerCase().includes(searchValue.toLowerCase())
  )
  const allFilteredSelected =
    filtered.length > 0 && filtered.every(o => selectedValues.includes(o))

  // Zera a seleção atual e marca só o que bate com o texto digitado agora —
  // o comportamento padrão (addToFilter desmarcado) do Enter na caixa de
  // busca, do "Selecionar todos" e de marcar uma opção nova direto na lista.
  const replaceWithFiltered = () => {
    onClearValues()
    filtered.forEach(o => onToggleValue(o))
  }

  const selectAllFiltered = () => {
    filtered.forEach(o => { if (!selectedValues.includes(o)) onToggleValue(o) })
  }

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      filtered.forEach(o => { if (selectedValues.includes(o)) onToggleValue(o) })
    } else if (addToFilter) {
      selectAllFiltered()
    } else {
      replaceWithFiltered()
    }
  }

  // Marcar uma opção da lista: com "Adicionar ao filtro" marcado, soma à
  // seleção já existente (comportamento de sempre). Desmarcado (estilo
  // Excel, padrão), marcar uma opção NOVA substitui a seleção atual em vez
  // de somar — mesmo critério do Enter na busca, pra não ficar acumulando
  // uma seleção antiga sem querer ao escolher outro item depois de digitar
  // um texto novo. Desmarcar uma opção já selecionada sempre só a remove,
  // com ou sem a caixa marcada.
  const selectOption = (opt: string) => {
    if (!addToFilter && !selectedValues.includes(opt)) onClearValues()
    onToggleValue(opt)
  }

  // Rendered into document.body via portal — fully escapes overflow/stacking context
  const dropdown = open && pos && mounted ? createPortal(
    <div
      ref={dropdownRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
      className="bg-surface-container-highest border border-outline-variant rounded shadow-xl max-h-52 overflow-y-auto"
    >
      {/* Estilo Excel: controla se marcar algo novo (Enter na busca,
          "Selecionar todos" ou uma opção da lista) soma ao filtro atual ou
          substitui por só o que foi marcado agora (padrão, desmarcado). */}
      <label className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[10px] hover:bg-surface-container-high border-b border-outline-variant/40 cursor-pointer select-none bg-surface-container-high/50">
        <input
          type="checkbox"
          checked={addToFilter}
          onChange={() => setAddToFilter(v => !v)}
          className="accent-primary"
        />
        <span className={`font-mono ${addToFilter ? 'text-primary font-semibold' : 'text-outline'}`}>
          Adicionar ao filtro
        </span>
      </label>

      {/* Todos — clears selection */}
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

      {/* Select / deselect all visible */}
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
                onChange={() => selectOption(opt)}
                className="accent-primary"
              />
              <span className={`font-mono truncate ${checked ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
                {opt}
              </span>
            </label>
          )
        })
      )}
    </div>,
    document.body
  ) : null

  return (
    <div ref={triggerRef} className={`relative${compact ? '' : ' min-w-[160px]'}`}>
      <div className="relative">
        <input
          type="text"
          value={searchValue}
          onChange={e => onSearchChange(e.target.value)}
          onFocus={openDropdown}
          onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'Enter' && searchValue.trim()) {
              // Digitou e apertou Enter: com "Adicionar ao filtro" marcado,
              // soma tudo que bate com o texto ao que já estava selecionado
              // (equivalente a "Selecionar todos" na lista); desmarcado
              // (padrão, estilo Excel), substitui a seleção por só o que
              // bateu agora.
              e.preventDefault()
              if (addToFilter) selectAllFiltered()
              else replaceWithFiltered()
              onSearchChange('')
              setOpen(false)
            }
          }}
          placeholder={hasSelection ? `${selectedValues.length} sel.` : placeholder}
          size={compact ? 1 : undefined}
          className={`w-full h-[1.75rem]${compact ? '' : ' min-w-[120px]'} bg-surface-container border rounded px-2 py-1 pr-7 text-[10px] font-normal normal-case tracking-normal focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors ${
            hasSelection
              ? 'border-primary bg-primary/5 placeholder:text-primary placeholder:font-semibold'
              : 'border-outline-variant text-on-surface hover:border-outline placeholder:text-outline/40'
          }`}
        />
        <button
          onMouseDown={e => { e.preventDefault(); open ? setOpen(false) : openDropdown() }}
          tabIndex={-1}
          className={`absolute right-1 top-1/2 -translate-y-1/2 leading-none transition-colors flex items-center gap-px ${
            hasSelection ? 'text-primary font-bold text-[9px]' : 'text-outline hover:text-primary text-[9px]'
          }`}
        >
          {hasSelection && <span className="text-[9px]">{selectedValues.length}</span>}
          <span>▾</span>
        </button>
      </div>
      {dropdown}
    </div>
  )
}
