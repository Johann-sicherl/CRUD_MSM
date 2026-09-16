'use client'

import { useMemo, useState } from 'react'
import { useProtheusAuth } from '@/lib/protheusAuthContext'
import type { Achado, Severidade, RegraCatalogo } from '@/lib/productIntelligence'
import { tables } from '@/lib/schema'

const SEVERIDADE_ORDER: Severidade[] = ['critico', 'alto', 'medio', 'baixo', 'pergunta']

const SEVERIDADE_LABELS: Record<Severidade, string> = {
  critico: 'Crítico',
  alto: 'Alto',
  medio: 'Médio',
  baixo: 'Baixo',
  pergunta: 'Pergunta em aberto',
}

const SEVERIDADE_CLASSES: Record<Severidade, string> = {
  critico: 'text-error border-error/40 bg-error-container/20',
  alto: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  medio: 'text-amber-300 border-amber-500/20 bg-amber-500/5',
  baixo: 'text-outline border-outline-variant bg-surface-container',
  pergunta: 'text-blue-400 border-blue-500/40 bg-blue-500/10',
}

function entidadeLabel(entidade: string): string {
  return tables[entidade]?.label ?? entidade
}

function formatChave(chave: Achado['chave']): string {
  return Object.entries(chave)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
}

function AchadoCard({ achado }: { achado: Achado }) {
  const cls = SEVERIDADE_CLASSES[achado.severidade]
  return (
    <div className={`rounded-lg border px-4 py-3 flex flex-col gap-1.5 ${cls}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/10">{achado.regra}</span>
        <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{entidadeLabel(achado.entidade)}</span>
        {formatChave(achado.chave) && (
          <span className="text-xs font-mono opacity-70">{formatChave(achado.chave)}</span>
        )}
      </div>
      <p className="text-sm text-on-surface">{achado.mensagem}</p>
      {achado.evidencia && Object.keys(achado.evidencia).length > 0 && (
        <div className="text-xs text-on-surface-variant font-mono bg-black/5 rounded px-2 py-1.5 mt-0.5 whitespace-pre-wrap break-words">
          {JSON.stringify(achado.evidencia, null, 0)}
        </div>
      )}
      {achado.sugestao && <p className="text-xs text-on-surface-variant">💡 {achado.sugestao}</p>}
      {achado.pergunta && <p className="text-xs text-on-surface-variant italic">❓ {achado.pergunta}</p>}
    </div>
  )
}

// Resumo em linguagem natural do que a varredura encontrou — não é um LLM de
// verdade (decisão explícita: sem custo de API nem chave nova), é só o
// motor de regras narrando o próprio resumo com o mesmo tom das mensagens
// que ele já produz por achado.
function buildNarrativeSummary(achados: Achado[], resumo: Record<string, number>, usedCheckTables: boolean): string {
  const fonte = usedCheckTables ? 'as 9 cópias _check (Double-check de Queries)' : 'as 9 tabelas de engenharia reais'
  if (achados.length === 0) {
    return `Varri ${fonte} contra o cadastro e a estrutura ao vivo do Protheus e não encontrei nenhuma inconsistência. Base consistente.`
  }
  const partes: string[] = []
  if (resumo.critico) partes.push(`${resumo.critico} crítico${resumo.critico !== 1 ? 's' : ''}`)
  if (resumo.alto) partes.push(`${resumo.alto} de severidade alta`)
  if (resumo.medio) partes.push(`${resumo.medio} de severidade média`)
  if (resumo.baixo) partes.push(`${resumo.baixo} de severidade baixa`)
  if (resumo.pergunta) partes.push(`${resumo.pergunta} pergunta${resumo.pergunta !== 1 ? 's' : ''} em aberto (não são erro — pedem confirmação sua)`)
  return `Varri ${fonte} contra o cadastro e a estrutura ao vivo do Protheus. Encontrei ${achados.length} achado${achados.length !== 1 ? 's' : ''}: ${partes.join(', ')}.`
}

// Relatório em texto pra copiar pra área de transferência — pedido explícito
// do usuário, mesmo espírito do "Copiar todas as regras": levar o resultado
// de uma varredura pra fora do app (discutir/aprimorar o motor). Recebe os
// achados JÁ FILTRADOS pela tela (severidade/tabela) — mesmo padrão de
// "copiar o que está visível" já usado em Auditoria (scopedRows) — e
// recalcula o resumo local a partir deles, nunca do resumo da varredura
// inteira, pra não misturar contagem total com uma lista filtrada.
function buildAchadosReportText(achados: Achado[], usedCheckTables: boolean, isFiltered: boolean): string {
  const resumoLocal: Record<string, number> = {}
  for (const a of achados) resumoLocal[a.severidade] = (resumoLocal[a.severidade] || 0) + 1

  const linhas: string[] = [
    'Inteligência do Produto — relatório de achados',
    buildNarrativeSummary(achados, resumoLocal, usedCheckTables),
  ]
  if (isFiltered) linhas.push('(filtro de severidade/tabela da tela aplicado — este relatório não cobre todos os achados da última varredura)')
  linhas.push('')

  for (const s of SEVERIDADE_ORDER) {
    const doGrupo = achados.filter(a => a.severidade === s)
    if (doGrupo.length === 0) continue
    linhas.push(`── ${SEVERIDADE_LABELS[s].toUpperCase()} (${doGrupo.length}) ──`, '')
    for (const a of doGrupo) {
      linhas.push(`[${a.regra}] ${entidadeLabel(a.entidade)}${formatChave(a.chave) ? ' · ' + formatChave(a.chave) : ''}`)
      linhas.push(a.mensagem)
      if (a.evidencia && Object.keys(a.evidencia).length > 0) linhas.push(`Evidência: ${JSON.stringify(a.evidencia)}`)
      if (a.sugestao) linhas.push(`Sugestão: ${a.sugestao}`)
      if (a.pergunta) linhas.push(`Pergunta: ${a.pergunta}`)
      linhas.push('')
    }
  }
  return linhas.join('\n').trim()
}

export default function InteligenciaProdutoPage() {
  const { creds: dbCreds } = useProtheusAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [achados, setAchados] = useState<Achado[] | null>(null)
  const [resumo, setResumo] = useState<Record<string, number>>({})
  const [severidadeFilter, setSeveridadeFilter] = useState<Severidade | ''>('')
  const [entidadeFilter, setEntidadeFilter] = useState('')
  // Pedido explícito do usuário: escolher se a varredura roda contra as
  // tabelas reais (produção) ou as cópias _check do Double-check de
  // Queries — nunca as duas juntas. `usedCheckTables` guarda o que a
  // ÚLTIMA análise concluída de fato usou (pode divergir do toggle atual
  // se a pessoa mudar de fonte sem rodar de novo).
  const [useCheckTables, setUseCheckTables] = useState(false)
  const [usedCheckTables, setUsedCheckTables] = useState(false)
  // Pedido explícito do usuário: copiar a lógica atual de todas as regras
  // pra área de transferência, pra discutir/aprimorar o motor fora do app.
  // Não depende de conexão Protheus — é só documentação estática do catálogo.
  const [copiedRegras, setCopiedRegras] = useState(false)
  // Idem, mas pro RELATÓRIO de achados de uma varredura já rodada (pedido
  // explícito do usuário, rodada seguinte: "quero copiar o relatório
  // também das ocorrências encontradas, não somente as regras").
  const [copiedAchados, setCopiedAchados] = useState(false)

  const handleCopyRegras = async () => {
    try {
      const res = await fetch('/api/product-intelligence/rules')
      const json = await res.json()
      const regras: RegraCatalogo[] = json.regras || []
      const texto = [
        `Inteligência do Produto — catálogo de regras (${regras.length})`,
        '',
        ...regras.map(r => `[${r.codigo}] ${r.categoria} — ${r.titulo}\n${r.descricao}`),
      ].join('\n\n')
      await navigator.clipboard.writeText(texto)
      setCopiedRegras(true)
      setTimeout(() => setCopiedRegras(false), 1500)
    } catch {
      setError('Falha ao copiar as regras')
    }
  }

  const runAnalysis = async () => {
    if (!dbCreds) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/product-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: dbCreds.user, password: dbCreds.password, useCheckTables }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao rodar a análise'); return }
      setAchados(json.achados as Achado[])
      setResumo(json.resumo || {})
      setUsedCheckTables(useCheckTables)
    } catch {
      setError('Erro de comunicação com o banco Protheus')
    } finally {
      setLoading(false)
    }
  }

  const entidadesPresentes = useMemo(
    () => Array.from(new Set((achados || []).map(a => a.entidade))).sort((a, b) => entidadeLabel(a).localeCompare(entidadeLabel(b), 'pt-BR')),
    [achados],
  )

  const filtrados = useMemo(() => {
    if (!achados) return []
    return achados.filter(a =>
      (!severidadeFilter || a.severidade === severidadeFilter) &&
      (!entidadeFilter || a.entidade === entidadeFilter)
    )
  }, [achados, severidadeFilter, entidadeFilter])

  const grouped = useMemo(() => {
    const map = new Map<Severidade, Achado[]>()
    for (const a of filtrados) {
      const lista = map.get(a.severidade)
      if (lista) lista.push(a)
      else map.set(a.severidade, [a])
    }
    return map
  }, [filtrados])

  const handleCopyAchados = async () => {
    try {
      const texto = buildAchadosReportText(filtrados, usedCheckTables, !!(severidadeFilter || entidadeFilter))
      await navigator.clipboard.writeText(texto)
      setCopiedAchados(true)
      setTimeout(() => setCopiedAchados(false), 1500)
    } catch {
      setError('Falha ao copiar o relatório')
    }
  }

  return (
    <div className="p-8 max-w-[72rem]">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
            Consulta Banco de Dados · inteligência do produto
          </div>
          <h1 className="text-3xl font-bold text-on-surface tracking-tight">Inteligência do Produto</h1>
          <p className="text-on-surface-variant text-base mt-1 max-w-3xl">
            Motor de regras que confronta as 9 tabelas de engenharia (Cadastro de Componentes, Grupo de
            Equipamentos, Cadastro de Equipamentos, Equipamento x Acessórios, Produtos Não Combináveis,
            Produtos Dependentes, Mesas de Roletes, Grupo de Acessórios, Cadastro de Alertas) contra o
            cadastro e a estrutura ao vivo do Protheus — acha inconsistência que a validação normal de
            escrita do app nunca pega, porque nunca olha o Protheus, ou porque o dado entrou via
            Atualizador Global (substituição total, sem validar campo por campo).
          </p>
        </div>
        <button
          onClick={handleCopyRegras}
          title="Copia o código, categoria e a lógica de todas as regras do motor, em texto — para revisar/aprimorar fora do app"
          className="shrink-0 px-3 py-1.5 text-xs rounded border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
        >
          {copiedRegras ? '✓ Copiado' : '📋 Copiar todas as regras'}
        </button>
      </div>

      <div className="mb-6 flex flex-col gap-3">
        {/* Fonte dos dados do Supabase — pedido explícito do usuário.
            O Protheus ao vivo é igual nos dois casos (não existe "_check"
            pro Protheus, só pras 9 tabelas de engenharia no Supabase). */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-on-surface-variant">Fonte dos dados:</span>
          <div className="flex items-center rounded border border-outline-variant overflow-hidden text-xs font-medium">
            <button
              type="button"
              onClick={() => setUseCheckTables(false)}
              className={`px-3 py-1.5 transition-colors ${!useCheckTables ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
            >
              Produção
            </button>
            <button
              type="button"
              onClick={() => setUseCheckTables(true)}
              title="Lê as 9 cópias _check gravadas em Double-check de Queries, em vez das tabelas reais"
              className={`px-3 py-1.5 border-l border-outline-variant transition-colors ${useCheckTables ? 'bg-blue-500/15 text-blue-400' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
            >
              _check
            </button>
          </div>
          {useCheckTables && (
            <span className="text-[11px] text-outline">
              Precisa ter gravado as tabelas _check antes, em Double-check de Queries.
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {dbCreds ? (
            <button
              onClick={runAnalysis}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:shadow-neon transition-all disabled:opacity-50"
            >
              {loading ? 'Analisando…' : '🧠 Rodar análise completa'}
            </button>
          ) : (
            <p className="text-xs text-outline">Conecte ao Protheus (barra lateral) para rodar a análise.</p>
          )}
          {loading && (
            <span className="text-xs text-outline">
              Carregando o cadastro e a estrutura do Protheus (pode levar 1–2 min na primeira vez) e cruzando com as {useCheckTables ? 'cópias _check' : '9 tabelas de engenharia'}…
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-error-container/20 border border-error/30 text-error rounded-lg px-4 py-3 text-sm">
          ⚠ {error}
        </div>
      )}

      {achados && (
        <div className="flex flex-col gap-5">
          <div className="bg-surface-container border border-outline-variant rounded-lg px-5 py-4 flex items-start justify-between gap-4">
            <p className="text-sm text-on-surface leading-relaxed">{buildNarrativeSummary(achados, resumo, usedCheckTables)}</p>
            {achados.length > 0 && (
              <button
                onClick={handleCopyAchados}
                title="Copia o relatório dos achados atualmente visíveis na tela (respeita os filtros de severidade/tabela ativos) para a área de transferência"
                className="shrink-0 px-3 py-1.5 text-xs rounded border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
              >
                {copiedAchados ? '✓ Copiado' : `📋 Copiar relatório (${filtrados.length})`}
              </button>
            )}
          </div>

          {achados.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={severidadeFilter}
                onChange={e => setSeveridadeFilter(e.target.value as Severidade | '')}
                className="px-3 py-2 text-sm bg-surface-container border border-outline-variant rounded text-on-surface-variant"
              >
                <option value="">Todas as severidades</option>
                {SEVERIDADE_ORDER.filter(s => resumo[s]).map(s => (
                  <option key={s} value={s}>{SEVERIDADE_LABELS[s]} ({resumo[s]})</option>
                ))}
              </select>
              <select
                value={entidadeFilter}
                onChange={e => setEntidadeFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-surface-container border border-outline-variant rounded text-on-surface-variant"
              >
                <option value="">Todas as tabelas</option>
                {entidadesPresentes.map(e => (
                  <option key={e} value={e}>{entidadeLabel(e)}</option>
                ))}
              </select>
              {(severidadeFilter || entidadeFilter) && (
                <button
                  onClick={() => { setSeveridadeFilter(''); setEntidadeFilter('') }}
                  className="text-xs text-outline hover:text-error transition-colors"
                >
                  ✕ Limpar filtros
                </button>
              )}
            </div>
          )}

          {SEVERIDADE_ORDER.filter(s => grouped.has(s)).map(s => (
            <div key={s} className="flex flex-col gap-2">
              <h2 className="text-sm font-bold text-on-surface uppercase tracking-wide">
                {SEVERIDADE_LABELS[s]} <span className="text-outline font-normal">({grouped.get(s)!.length})</span>
              </h2>
              <div className="flex flex-col gap-2">
                {grouped.get(s)!.map((a, i) => <AchadoCard key={`${a.regra}-${i}`} achado={a} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
