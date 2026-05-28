'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    const v = localStorage.getItem('sidebar-pinned')
    if (v !== null) setPinned(v !== 'false')
  }, [])

  const handlePinChange = (v: boolean) => {
    setPinned(v)
    localStorage.setItem('sidebar-pinned', String(v))
  }

  return (
    <>
      <Sidebar pinned={pinned} onPinChange={handlePinChange} />
      <main
        className={`relative z-10 min-h-screen overflow-auto transition-[margin-left] duration-200 ${
          pinned ? 'ml-64' : 'ml-0'
        }`}
      >
        {children}
      </main>
    </>
  )
}
