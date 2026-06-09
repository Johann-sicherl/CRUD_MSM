'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import ThemeZoomBar from '@/components/ThemeZoomBar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    const v = localStorage.getItem('sidebar-pinned')
    if (v !== null) setPinned(v !== 'false')
  }, [])

  const handlePinChange = (v: boolean) => {
    setPinned(v)
    localStorage.setItem('sidebar-pinned', String(v))
    // Wait for the CSS margin-left transition (200ms) to finish before re-fitting
    setTimeout(() => window.dispatchEvent(new CustomEvent('layout:changed')), 220)
  }

  return (
    <>
      <Sidebar pinned={pinned} onPinChange={handlePinChange} />
      <main
        className={`relative z-10 min-h-screen flex flex-col overflow-auto transition-[margin-left] duration-200 ${
          pinned ? 'ml-64' : 'ml-0'
        }`}
      >
        <ThemeZoomBar />
        {children}
      </main>
    </>
  )
}
