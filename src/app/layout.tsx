import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'MSM Admin — VMI Security',
  description: 'Painel de administração do banco de dados Monte Sua Máquina',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body className="bg-background text-on-surface flex min-h-screen overflow-hidden">
        <div className="scanning-grid fixed inset-0 pointer-events-none z-0" />
        <div className="scanning-line" />
        <Sidebar />
        <main className="relative z-10 flex-1 overflow-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
