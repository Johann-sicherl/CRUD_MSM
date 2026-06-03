import type { Metadata } from 'next'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'

export const metadata: Metadata = {
  title: 'MSM Admin — VMI Security',
  description: 'Painel de administração do banco de dados Monte Sua Máquina',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-background text-on-surface min-h-screen">
        {/* Restore theme + zoom before first paint to avoid flash */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var t=localStorage.getItem('app-theme')||'cyberpunk';
            var z=localStorage.getItem('app-zoom')||'100';
            document.documentElement.dataset.theme=t;
            document.documentElement.style.zoom=z+'%';
            document.documentElement.style.colorScheme=t==='cyberpunk'?'dark':'light';
          })();
        `}} />
        <div className="scanning-grid fixed inset-0 pointer-events-none z-0" />
        <div className="scanning-line" />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
