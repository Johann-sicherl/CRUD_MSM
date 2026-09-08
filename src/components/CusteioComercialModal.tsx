'use client'

import Link from 'next/link'
import type { CusteioComercialTable } from '@/app/api/dashboard/custeio-comercial/route'

interface Props {
  tables: CusteioComercialTable[]
  onClose: () => void
}

export default function CusteioComercialModal({ tables, onClose }: Props) {
  const withActivity = tables.filter(t => t.novo > 0 || t.emAlteracao > 0 || t.outrasPendencias > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-lg animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h2 className="text-base font-semibold text-on-surface">
            Em Custeio — <span className="text-primary">Gerente Adm Comercial</span>
          </h2>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none transition-colors">✕</button>
        </div>

        <div className="px-6 py-2 flex items-center gap-4 text-xs text-on-surface-variant border-b border-outline-variant/40 flex-wrap">
          <span className="flex items-center gap-1.5 py-2"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-500/60 inline-block" /> aguardando custeio</span>
          <span className="flex items-center gap-1.5 py-2"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500/40 border border-blue-500/60 inline-block" /> custo imputado</span>
          <span className="flex items-center gap-1.5 py-2"><span className="w-2.5 h-2.5 rounded-sm bg-primary/40 border border-primary/60 inline-block" /> outra pendência (IPI/margem/comissão etc.)</span>
        </div>

        <div className="px-6 py-4">
          {withActivity.length === 0 ? (
            <div className="text-sm text-outline text-center py-6">Nenhuma pendência do lado da Comercial no momento.</div>
          ) : (
            <ul className="divide-y divide-outline-variant/30">
              {withActivity.map(t => (
                <li key={t.tableName} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-on-surface truncate">{t.label}</div>
                    <div className="text-xs font-mono mt-0.5 flex items-center gap-3 flex-wrap">
                      {t.novo > 0 && <span className="text-amber-400">{t.novo.toLocaleString('pt-BR')} aguardando</span>}
                      {t.emAlteracao > 0 && <span className="text-blue-400">{t.emAlteracao.toLocaleString('pt-BR')} imputado{t.emAlteracao !== 1 ? 's' : ''}</span>}
                      {t.outrasPendencias > 0 && <span className="text-primary">{t.outrasPendencias.toLocaleString('pt-BR')} outra{t.outrasPendencias !== 1 ? 's' : ''} pendência{t.outrasPendencias !== 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {t.novo > 0 && (
                      <Link
                        href={`/${t.tableName}?view=novos`}
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                      >
                        Ver novos →
                      </Link>
                    )}
                    {t.emAlteracao > 0 && (
                      <Link
                        href={`/${t.tableName}?view=em_alteracao`}
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/20 transition-colors whitespace-nowrap"
                      >
                        Ver imputados →
                      </Link>
                    )}
                    {t.outrasPendencias > 0 && t.novo === 0 && t.emAlteracao === 0 && (
                      <Link
                        href={`/${t.tableName}`}
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary border border-primary/30 rounded hover:bg-primary/20 transition-colors whitespace-nowrap"
                      >
                        Abrir →
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
