'use client'

import { useEffect, useMemo, useState } from 'react'
import { parseSolicComercial, type ParseResult } from '@/lib/solicComercialParser'
import { idbGet, idbSet } from '@/lib/idbStore'

const STORAGE_KEY = 'depurador-solic-comercial-input'

function Badge({ tone, children }: { tone: 'outline' | 'success' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'success'
    ? 'text-green-400 border-green-500/40 bg-green-500/10'
    : tone === 'amber'
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : 'text-outline border-outline-variant bg-surface-container'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>
      {children}
    </span>
  )
}

function buildCleanText(result: ParseResult): string {
  const lines: string[] = []
  if (result.items.length > 0) {
    lines.push('ITENS')
    for (const it of result.items) {
      const parts = [it.codes.join(' + '), '—', it.name]
      if (it.qty) parts.push(`(Qtd: ${it.qty})`)
      if (it.label) parts.push(`[${it.label}]`)
      lines.push(parts.join(' '))
    }
  }
  if (result.freeText.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('OBSERVAÇÕES / ESPECIFICAÇÕES SEM CÓDIGO')
    for (const ft of result.freeText) {
      lines.push(ft.label ? `[${ft.label}] ${ft.text}` : ft.text)
    }
  }
  return lines.join('\n')
}

export default function DepuradorSolicComercialPage() {
  const [raw, setRaw] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    idbGet<string>(STORAGE_KEY).then(saved => {
      if (saved) setRaw(saved)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!loaded) return
    idbSet(STORAGE_KEY, raw)
  }, [raw, loaded])

  const result = useMemo(() => parseSolicComercial(raw), [raw])
  const hasInput = raw.trim().length > 0
  const totalOcorrencias = result.items.reduce((acc, it) => acc + it.occurrences, 0)
  const itemsSemNome = result.items.filter(it => it.name === '(nome não identificado)').length

  const handleCopy = () => {
    navigator.clipboard.writeText(buildCleanText(result)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="p-8 max-w-[108rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · depurador solic. comercial
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Depurador Solic. Comercial</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Cole abaixo, à esquerda, o texto bagunçado que chega do comercial (nomes e códigos misturados, blocos
          repetidos, quantidades soltas, rótulos sem valor). O lado direito mostra uma versão organizada: itens com
          código (deduplicados, com a quantidade quando identificada) e, separadamente, os trechos de
          especificação/observação que não têm código nenhum. É uma limpeza heurística — o texto original é escrito
          por pessoas em formatos diferentes, então revise o resultado antes de usar; onde o nome de um item ficou
          ambíguo demais para arriscar, ele aparece como <span className="font-mono">(nome não identificado)</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lado esquerdo — texto bruto */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-on-surface-variant">Texto da solicitação (bruto)</label>
            {hasInput && (
              <button
                onClick={() => setRaw('')}
                className="text-xs text-outline hover:text-error transition-colors"
              >
                Limpar
              </button>
            )}
          </div>
          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder="Cole aqui o texto da solicitação comercial..."
            spellCheck={false}
            className="w-full h-[70vh] resize-none bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-sm font-mono text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
        </div>

        {/* Lado direito — resultado organizado */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <label className="text-xs font-semibold text-on-surface-variant">Resumo organizado</label>
            {hasInput && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone="outline">{result.items.length} itens únicos</Badge>
                {totalOcorrencias > result.items.length && (
                  <Badge tone="outline">{totalOcorrencias} ocorrências no texto</Badge>
                )}
                {result.freeText.length > 0 && <Badge tone="outline">{result.freeText.length} obs. sem código</Badge>}
                {itemsSemNome > 0 && <Badge tone="amber">{itemsSemNome} sem nome identificado</Badge>}
                <button
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded border border-outline-variant text-xs font-semibold text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
                >
                  {copied ? '✓ Copiado' : '📋 Copiar resultado'}
                </button>
              </div>
            )}
          </div>

          <div className="w-full h-[70vh] overflow-y-auto bg-surface-container-low border border-outline-variant rounded-lg">
            {!hasInput ? (
              <div className="h-full flex items-center justify-center text-sm text-outline px-6 text-center">
                Cole o texto da solicitação ao lado para ver o resumo organizado aqui.
              </div>
            ) : result.items.length === 0 && result.freeText.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-outline px-6 text-center">
                Nenhum item ou observação identificado nesse texto.
              </div>
            ) : (
              <div className="p-4 flex flex-col gap-5">
                {result.items.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-outline uppercase tracking-[0.15em] font-mono mb-2">
                      Itens ({result.items.length})
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {result.items.map((it, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-3 bg-surface-container rounded px-3 py-2 border border-outline-variant/60"
                        >
                          <span className="font-mono text-xs text-primary shrink-0 pt-0.5">
                            {it.codes.join(' + ')}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm ${it.name === '(nome não identificado)' ? 'text-amber-400 italic' : 'text-on-surface'}`}>
                              {it.name}
                            </div>
                            {it.label && (
                              <div className="text-[11px] text-outline mt-0.5">rótulo original: {it.label}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {it.qty != null && <Badge tone="outline">Qtd: {it.qty}</Badge>}
                            {it.occurrences > 1 && <Badge tone="outline">{it.occurrences}x</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.freeText.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-outline uppercase tracking-[0.15em] font-mono mb-2">
                      Observações / especificações sem código ({result.freeText.length})
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {result.freeText.map((ft, i) => (
                        <div
                          key={i}
                          className="bg-surface-container rounded px-3 py-2 border border-outline-variant/60"
                        >
                          {ft.label && (
                            <div className="text-[11px] font-semibold text-on-surface-variant mb-0.5">{ft.label}</div>
                          )}
                          <div className="text-sm text-on-surface-variant whitespace-pre-wrap">{ft.text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
