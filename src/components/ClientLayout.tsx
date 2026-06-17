'use client'

import { useState, useEffect, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import ThemeZoomBar from '@/components/ThemeZoomBar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [pinned, setPinned] = useState(true)
  const pinnedRef = useRef(pinned)

  useEffect(() => {
    const v = localStorage.getItem('sidebar-pinned')
    if (v !== null) setPinned(v !== 'false')
  }, [])

  useEffect(() => { pinnedRef.current = pinned }, [pinned])

  const handlePinChange = (v: boolean) => {
    setPinned(v)
    localStorage.setItem('sidebar-pinned', String(v))
  }

  // Recolhe sidebar ao abrir ImportReviewModal; restaura ao fechar
  useEffect(() => {
    let wasPinned = false

    const onOpen = () => {
      wasPinned = pinnedRef.current
      if (pinnedRef.current) handlePinChange(false)
    }
    const onClose = () => {
      if (wasPinned) handlePinChange(true)
    }

    window.addEventListener('import-review:open',  onOpen)
    window.addEventListener('import-review:close', onClose)
    return () => {
      window.removeEventListener('import-review:open',  onOpen)
      window.removeEventListener('import-review:close', onClose)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Sidebar pinned={pinned} onPinChange={handlePinChange} />
      <main
        className={`relative z-10 min-h-screen flex flex-col transition-[margin-left] duration-200 ${
          pinned ? 'ml-64' : 'ml-0'
        }`}
      >
        <ThemeZoomBar />
        {children}
      </main>
    </>
  )
}
