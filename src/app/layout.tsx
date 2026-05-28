import type { Metadata } from 'next'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'

export const metadata: Metadata = {
  title: 'MSM Admin — VMI Security',
  description: 'Painel de administração do banco de dados Monte Sua Máquina',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="bg-background text-on-surface min-h-screen">
        <div className="scanning-grid fixed inset-0 pointer-events-none z-0" />
        <div className="scanning-line" />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
