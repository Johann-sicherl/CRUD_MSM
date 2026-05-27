import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'MSM Admin — VMI Security',
  description: 'Painel de administração do banco de dados Monte Sua Máquina',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-50 text-slate-900 flex min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
