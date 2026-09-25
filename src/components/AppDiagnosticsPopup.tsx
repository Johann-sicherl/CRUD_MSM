'use client'

import { useState } from 'react'
import type { DiagnosticSection, DiagnosticIssue } from '@/lib/appDiagnostics'
import { REVERSE_SEARCH_GROUPS, REVERSE_SEARCH_GROUP_ORDER } from '@/lib/appDiagnosticsGroups'

// Pop-up "Visão Geral Avançada Global" (nome anterior: "Diagnóstico da
// Aplicação" — pedido explícito do usuário pra renomear; código/arquivo
// continuam com o nome antigo, só o título visível mudou). Pedido
// explícito do usuário: "grande, tanto quanto os outros da aplicação"
// (mesmo max-w-[95vw] max-h-[90vh] de ImportReviewModal/
// ControladoriaImportReviewModal/CostImportReviewModal), "cascateado por
// tabelas... um dropdown com o título desta aba, e quando eu expanda, ele
// me mostre os problemas, caso não tenha, que seja sem erros, caso tenha
// que esteja vermelho esmaecido o dropdown completo".
//
// Rodada seguinte, pedidos explícitos do usuário: (1) fonte maior em todo
// o pop-up; (2) dentro do dropdown de Busca Reversa, separar os resultados
// em "Blocos" (ver `REVERSE_SEARCH_GROUP_ORDER`, `appDiagnosticsGroups.ts`
// — ordem erro-primeiro e nome de cada bloco); (3) "não separou cada
// equipamento em 'Caixinhas' e quando eu clico no equipamento ele me
// mostra os erro dele" — dentro de cada bloco, cada equipamento agora é
// sua própria caixinha clicável (`EquipmentBox` abaixo), com estado de
// expandido/recolhido independente por linha (nunca por seção inteira) —
// ao expandir, mostra a mesma mini-tabela Propriedade/Valor Esperado
// (Estrutura)/Código(s) que Geraram/Valor no Banco já usada em Busc. Itens
// Série Estrut. Protheus, a partir de `issue.details` (appDiagnostics.ts)
// — nunca reconstrói isso de `message`, que agora é só um resumo curto
// ("N erro(s) de propriedade.") pro cabeçalho da caixinha recolhida.

// Comparação exata contra as constantes (nunca substring — "Cadastrado,
// sem erros" também contém a palavra "erro", então um .includes('erro')
// pintaria esse bloco de vermelho por engano).
function groupTone(group: string): string {
  if (group === REVERSE_SEARCH_GROUPS.errors) return 'text-error'
  if (group === REVERSE_SEARCH_GROUPS.notRegistered) return 'text-amber-400'
  return 'text-on-surface-variant'
}

function IssueRow({ issue, messageTone }: { issue: DiagnosticIssue; messageTone: string }) {
  return (
    <li className="flex flex-col">
      <span className="font-mono text-base text-on-surface">{issue.rowLabel}</span>
      <span className={`text-base ${messageTone}`}>{issue.message}</span>
    </li>
  )
}

// Uma "caixinha" por equipamento, dentro de um bloco da Busca Reversa —
// clique expande e mostra os erros de propriedade dele (ou, se não tiver
// `details`, só a mensagem curta — caso de "não cadastrado"/"sem erros").
function EquipmentBox({
  issue,
  tone,
  isOpen,
  onToggle,
}: {
  issue: DiagnosticIssue
  tone: string
  isOpen: boolean
  onToggle: () => void
}) {
  const hasDetails = !!issue.details && issue.details.length > 0
  return (
    <div className="rounded border border-outline-variant/60 bg-surface-container overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-container-high transition-colors"
      >
        <span className="font-mono text-base text-on-surface">{issue.rowLabel}</span>
        <span className="flex items-center gap-2 shrink-0">
          <span className={`text-sm font-mono px-2 py-0.5 rounded-full border ${
            hasDetails
              ? 'text-error border-error/30 bg-error-container/20'
              : 'text-outline border-outline-variant bg-surface-container-low'
          }`}>
            {hasDetails ? `${issue.details!.length} erro(s)` : issue.message}
          </span>
          <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-outline-variant/40 px-3 py-2">
          {hasDetails ? (
            <div className="overflow-auto border border-outline-variant rounded">
              <table className="text-sm w-full">
                <thead className="bg-surface-container-highest">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-semibold text-on-surface-variant whitespace-nowrap">Propriedade</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-on-surface-variant whitespace-nowrap">Valor Esperado (Estrutura)</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-on-surface-variant whitespace-nowrap">Código(s) que Geraram</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-on-surface-variant whitespace-nowrap">Valor no Banco</th>
                  </tr>
                </thead>
                <tbody>
                  {issue.details!.map((d, i) => (
                    <tr key={i} className="border-t border-outline-variant/50 bg-error-container/10">
                      <td className="px-2 py-1.5 font-semibold text-on-surface whitespace-nowrap">{d.property}</td>
                      <td className="px-2 py-1.5 text-on-surface">{d.expected ?? '—'}</td>
                      <td className="px-2 py-1.5 text-outline font-mono">{d.via || '—'}</td>
                      <td className="px-2 py-1.5 text-on-surface">{d.dbValue ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={`text-base ${tone}`}>{issue.message}</div>
          )}
        </div>
      )}
    </div>
  )
}

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
  // Estado das caixinhas de equipamento, independente do estado das
  // seções/blocos — chave própria (seção+bloco+código+índice) pra nunca
  // colidir entre blocos ou seções diferentes.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleRow = (key: string) => {
    setExpandedRows(prev => {
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
            <h3 className="text-xl font-semibold text-on-surface">Visão Geral Avançada Global</h3>
            <p className="text-sm text-outline mt-0.5">
              {loading
                ? 'Analisando…'
                : error
                ? 'Falha ao rodar o diagnóstico.'
                : totalProblems === 0
                ? 'Nenhum problema encontrado.'
                : `${totalProblems} problema(s) encontrado(s).`}
            </p>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface text-2xl leading-none shrink-0">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-16 text-outline gap-3">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-base font-mono">Analisando…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center justify-center py-16 text-error gap-2 text-base">⚠ {error}</div>
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
                // Agrupa em blocos só quando pelo menos um issue tem
                // `group` — senão renderiza a lista única de sempre.
                const grouped = new Map<string, DiagnosticIssue[]>()
                for (const issue of section.issues) {
                  if (!issue.group) continue
                  const list = grouped.get(issue.group)
                  if (list) list.push(issue)
                  else grouped.set(issue.group, [issue])
                }
                const useGroups = grouped.size > 0
                const groupKeys = useGroups
                  ? [...REVERSE_SEARCH_GROUP_ORDER.filter(g => grouped.has(g)), ...Array.from(grouped.keys()).filter(g => !REVERSE_SEARCH_GROUP_ORDER.includes(g))]
                  : []
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
                      <span className={`text-base font-semibold ${flagged ? 'text-error' : 'text-on-surface'}`}>
                        {section.tableLabel}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-mono px-2 py-0.5 rounded-full border ${
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
                        <span className={`text-outline text-xl leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-outline-variant/50 px-4 py-3">
                        {!hasIssues ? (
                          <div className="text-base text-outline italic">{isSummary ? 'Nenhuma estrutura encontrada.' : 'Sem erros.'}</div>
                        ) : useGroups ? (
                          <div className="flex flex-col gap-4">
                            {groupKeys.map(group => (
                              <div key={group}>
                                <div className={`text-sm font-bold uppercase tracking-wide mb-2 ${groupTone(group)}`}>
                                  {group} ({grouped.get(group)!.length})
                                </div>
                                <div className="flex flex-col gap-2">
                                  {grouped.get(group)!.map((issue, i) => {
                                    const rowKey = `${section.key}::${group}::${issue.rowLabel}::${i}`
                                    return (
                                      <EquipmentBox
                                        key={rowKey}
                                        issue={issue}
                                        tone={groupTone(group)}
                                        isOpen={expandedRows.has(rowKey)}
                                        onToggle={() => toggleRow(rowKey)}
                                      />
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <ul className="flex flex-col gap-2">
                            {section.issues.map((issue, i) => (
                              <IssueRow key={i} issue={issue} messageTone="text-on-surface-variant" />
                            ))}
                          </ul>
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
            className="px-4 py-2 rounded-lg bg-primary text-on-primary text-base font-semibold hover:shadow-neon transition-all"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
