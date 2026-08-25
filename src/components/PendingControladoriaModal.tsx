'use client'

import Link from 'next/link'
import type { PendingControladoriaTable } from '@/app/api/dashboard/pending-controladoria/route'

interface Props {
  tables: PendingControladoriaTable[]
  onClose: () => void
}

export default function PendingControladoriaModal({ tables, onClose }: Props) {
  const pending = tables.filter(t => t.count > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-lg animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">
            Pendências de <span className="text-primary">Controladoria/Fiscal/Precificação</span>
          </h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none transition-colors">✕</button>
        </div>

        <div className="px-6 py-4">
          {pending.length === 0 ? (
            <div className="text-sm text-outline text-center py-6">Nenhuma pendência — tudo em dia.</div>
          ) : (
            <ul className="divide-y divide-outline-variant/30">
              {pending.map(t => (
                <li key={t.tableName} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-on-surface truncate">{t.label}</div>
                    <div className="text-xs text-outline font-mono">{t.count.toLocaleString('pt-BR')} registro{t.count !== 1 ? 's' : ''} pendente{t.count !== 1 ? 's' : ''}</div>
                  </div>
                  <Link
                    href={`/${t.tableName}?view=novos`}
                    onClick={onClose}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary border border-primary/30 rounded hover:bg-primary/20 transition-colors whitespace-nowrap"
                  >
                    Ir para janela →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
