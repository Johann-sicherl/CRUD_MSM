'use client'

import { useState } from 'react'
import type { DiagnosticSection } from '@/lib/appDiagnostics'

// Pop-up do Diagnóstico da Aplicação — pedido explícito do usuário: "grande,
// tanto quanto os outros da aplicação" (mesmo max-w-[95vw] max-h-[90vh] de
// ImportReviewModal/ControladoriaImportReviewModal/CostImportReviewModal),
// "cascateado por tabelas... um dropdown com o título desta aba, e quando
// eu expanda, ele me mostre os problemas, caso não tenha, que seja sem
// erros, caso tenha que esteja vermelho esmaecido o dropdown completo".

export default function AppDiagnosticsPopup({
  sections,
  loading,
  error,
  onClose,
}: {
  sections: DiagnosticSection[]
  loading: boolean
  error: string
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // "summary" não conta como problema no resumo do topo — é inventário
  // (ex.: Busca Reversa), não uma lista de coisas erradas.
  const totalProblems = sections.reduce((sum, s) => sum + (s.mode === 'summary' ? 0 : s.issues.length), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-surface-container border border-outline-variant rounded-lg shadow-2xl w-full max-w-[95vw] max-h-[90vh] flex flex-col animate-fade-in">
        <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-semibold text-on-surface">Diagnóstico da Aplicação</h3>
            <p className="text-xs text-outline mt-0.5">
              {loading
                ? 'Analisando…'
                : error
                ? 'Falha ao rodar o diagnóstico.'
                : totalProblems === 0
                ? 'Nenhum problema encontrado.'
                : `${totalProblems} problema(s) encontrado(s).`}
            </p>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-xl leading-none shrink-0">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-16 text-outline gap-3">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-mono">Analisando…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center justify-center py-16 text-error gap-2 text-sm">⚠ {error}</div>
          )}

          {!loading && !error && (
            <div className="flex flex-col gap-3">
              {sections.map(section => {
                const isOpen = expanded.has(section.key)
                const isSummary = section.mode === 'summary'
                const hasIssues = section.issues.length > 0
                // "summary" nunca fica vermelho esmaecido só por ter itens
                // — é um inventário (ex.: Busca Reversa), não uma lista de
                // problemas. Só sections de 'problems' (padrão) acendem
                // vermelho quando têm algo.
                const flagged = hasIssues && !isSummary
                return (
                  <div
                    key={section.key}
                    className={`rounded-lg border overflow-hidden ${
                      flagged ? 'border-error/30 bg-error-container/10' : 'border-outline-variant bg-surface-container-low'
                    }`}
                  >
                    <button
                      onClick={() => toggle(section.key)}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                        flagged ? 'hover:bg-error-container/20' : 'hover:bg-surface-container-high'
                      }`}
                    >
                      <span className={`text-sm font-semibold ${flagged ? 'text-error' : 'text-on-surface'}`}>
                        {section.tableLabel}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${
                          flagged
                            ? 'text-error border-error/30 bg-error-container/20'
                            : 'text-outline border-outline-variant bg-surface-container'
                        }`}>
                          {flagged
                            ? `${section.issues.length} problema(s)`
                            : isSummary
                            ? (hasIssues ? `${section.issues.length} encontrada(s)` : 'nenhuma encontrada')
                            : 'sem erros'}
                        </span>
                        <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-outline-variant/50 px-4 py-3">
                        {hasIssues ? (
                          <ul className="flex flex-col gap-2 text-sm">
                            {section.issues.map((issue, i) => (
                              <li key={i} className="flex flex-col">
                                <span className="font-mono text-on-surface">{issue.rowLabel}</span>
                                <span className={isSummary && issue.message.startsWith('NÃO') ? 'text-amber-400' : 'text-on-surface-variant'}>
                                  {issue.message}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-sm text-outline italic">{isSummary ? 'Nenhuma estrutura encontrada.' : 'Sem erros.'}</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-outline-variant flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:shadow-neon transition-all"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
