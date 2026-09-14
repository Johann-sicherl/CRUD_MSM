'use client'

import { useEffect, useMemo, useState } from 'react'
import { useProtheusAuth } from '@/lib/protheusAuthContext'
import type { Achado, Severidade } from '@/lib/productIntelligence'
import type { ParsedProductQuestion } from '@/lib/productIntelligenceNlu'
import { tables } from '@/lib/schema'

interface EquipmentOption { legacy_id: number; name: string; commercial_name: string }
interface GroupOption { legacy_id: number; name: string }

// Rótulo curto por regra pro checklist da aba "Pergunte à IA" — mesmos 20
// códigos de REGRAS_DISPONIVEIS (productIntelligence.ts), só que descritos
// aqui (não importados) pra não puxar o motor de regras inteiro pro bundle
// client-side; ver specs/telas-auxiliares.md pro detalhe de cada regra.
const REGRAS_INFO: { codigo: string; categoria: string; label: string }[] = [
  { codigo: 'R001', categoria: 'Integridade', label: 'Código não existe no Protheus' },
  { codigo: 'R002', categoria: 'Integridade', label: 'Equipamento referenciado mas ausente' },
  { codigo: 'R003', categoria: 'Integridade', label: 'Grupo referenciado mas ausente' },
  { codigo: 'R070', categoria: 'Integridade', label: 'Alerta referenciado mas ausente' },
  { codigo: 'R010', categoria: 'Estado', label: 'Bloqueado no Protheus mas ativo na oferta' },
  { codigo: 'R011', categoria: 'Estado', label: 'Inativo no catálogo mas ativo na oferta' },
  { codigo: 'R012', categoria: 'Estado', label: 'Revisão mais nova disponível' },
  { codigo: 'R020', categoria: 'Duplicidade', label: 'Chave duplicada (equipamento + código)' },
  { codigo: 'R021', categoria: 'Duplicidade', label: 'Opcional já está na estrutura padrão' },
  { codigo: 'R030', categoria: 'Dependência', label: 'Dependência esperada não declarada' },
  { codigo: 'R031', categoria: 'Dependência', label: 'Dependência para código não ofertado' },
  { codigo: 'R081', categoria: 'Dependência', label: 'Embalagem diverge entre Protheus e cadastro' },
  { codigo: 'R040', categoria: 'Incompatibilidade', label: 'Exclusão não recíproca' },
  { codigo: 'R041', categoria: 'Incompatibilidade', label: 'Incompatibilidade com item não ofertado' },
  { codigo: 'R050', categoria: 'Completude', label: 'Equipamento sem nenhuma configuração' },
  { codigo: 'R051', categoria: 'Completude', label: 'Mesa de roletes incompleta' },
  { codigo: 'R052', categoria: 'Completude', label: 'Cadastrado mas nunca ofertado' },
  { codigo: 'R060', categoria: 'Analogia', label: 'Divergência dentro da família de equipamentos' },
  { codigo: 'R080', categoria: 'Analogia', label: 'Códigos que sempre saem juntos (co-ocorrência)' },
  { codigo: 'R090', categoria: 'Itens de série', label: 'Especificação técnica diverge da estrutura' },
]

const REGRAS_POR_CATEGORIA = REGRAS_INFO.reduce<Record<string, typeof REGRAS_INFO>>((acc, r) => {
  (acc[r.categoria] ??= []).push(r)
  return acc
}, {})

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
function buildNarrativeSummary(achados: Achado[], resumo: Record<string, number>): string {
  if (achados.length === 0) {
    return 'Varri as 9 tabelas de engenharia contra o cadastro e a estrutura ao vivo do Protheus e não encontrei nenhuma inconsistência. Base consistente.'
  }
  const partes: string[] = []
  if (resumo.critico) partes.push(`${resumo.critico} crítico${resumo.critico !== 1 ? 's' : ''}`)
  if (resumo.alto) partes.push(`${resumo.alto} de severidade alta`)
  if (resumo.medio) partes.push(`${resumo.medio} de severidade média`)
  if (resumo.baixo) partes.push(`${resumo.baixo} de severidade baixa`)
  if (resumo.pergunta) partes.push(`${resumo.pergunta} pergunta${resumo.pergunta !== 1 ? 's' : ''} em aberto (não são erro — pedem confirmação sua)`)
  return `Varri as 9 tabelas de engenharia contra o cadastro e a estrutura ao vivo do Protheus. Encontrei ${achados.length} achado${achados.length !== 1 ? 's' : ''}: ${partes.join(', ')}.`
}

export default function InteligenciaProdutoPage() {
  const { creds: dbCreds } = useProtheusAuth()
  const [tab, setTab] = useState<'analise' | 'pergunte'>('analise')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [achados, setAchados] = useState<Achado[] | null>(null)
  const [resumo, setResumo] = useState<Record<string, number>>({})
  const [severidadeFilter, setSeveridadeFilter] = useState<Severidade | ''>('')
  const [entidadeFilter, setEntidadeFilter] = useState('')

  const [pergunta, setPergunta] = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [askError, setAskError] = useState('')
  const [askResposta, setAskResposta] = useState('')
  const [askAchados, setAskAchados] = useState<Achado[] | null>(null)
  const [askParsed, setAskParsed] = useState<ParsedProductQuestion | null>(null)
  const [askRegras, setAskRegras] = useState<string[]>([])

  // Filtro estruturado (recomendado) — seletores alimentados pela lista real
  // do banco, sem ambiguidade de parsing de texto nenhuma. Adicionado depois
  // de um bug real: texto livre sobre "EQUIPAMENTO 6040 SV ID 12" extraía o
  // número errado e a resposta parecia "coerente" sem ter checado nada —
  // ver specs/telas-auxiliares.md.
  const [equipamentosList, setEquipamentosList] = useState<EquipmentOption[]>([])
  const [gruposList, setGruposList] = useState<GroupOption[]>([])
  const [filtroEquipamento, setFiltroEquipamento] = useState('')
  const [filtroGrupo, setFiltroGrupo] = useState('')
  const [filtroCodigo, setFiltroCodigo] = useState('')
  const [filtroRegras, setFiltroRegras] = useState<Set<string>>(new Set())
  const [mostrarRegras, setMostrarRegras] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/equipments?limit=25000').then(r => r.json()),
      fetch('/api/accessory_groups?limit=25000').then(r => r.json()),
    ]).then(([eq, gr]) => {
      if (cancelled) return
      setEquipamentosList((eq.data || []) as EquipmentOption[])
      setGruposList((gr.data || []) as GroupOption[])
    }).catch(() => { /* listas de apoio — falha aqui não impede o modo texto livre */ })
    return () => { cancelled = true }
  }, [])

  const toggleFiltroRegra = (codigo: string) => {
    setFiltroRegras(prev => {
      const next = new Set(prev)
      if (next.has(codigo)) next.delete(codigo)
      else next.add(codigo)
      return next
    })
  }

  const limparFiltro = () => {
    setFiltroEquipamento('')
    setFiltroGrupo('')
    setFiltroCodigo('')
    setFiltroRegras(new Set())
  }

  const filtroAtivo = !!(filtroEquipamento || filtroGrupo || filtroCodigo.trim() || filtroRegras.size > 0)

  const runAsk = async () => {
    if (!dbCreds) return
    if (!filtroAtivo && !pergunta.trim()) return
    setAskLoading(true)
    setAskError('')
    try {
      const res = await fetch('/api/product-intelligence/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: dbCreds.user,
          password: dbCreds.password,
          pergunta: filtroAtivo ? '' : pergunta,
          filtro: filtroAtivo ? {
            equipamento: filtroEquipamento || undefined,
            grupo: filtroGrupo || undefined,
            codigo: filtroCodigo.trim() || undefined,
            regras: filtroRegras.size > 0 ? Array.from(filtroRegras) : undefined,
          } : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setAskError(json.error || 'Falha ao consultar'); return }
      setAskResposta(json.resposta || '')
      setAskAchados(json.achados as Achado[])
      setAskParsed(json.parsed || null)
      setAskRegras(json.regrasRodadas || [])
    } catch {
      setAskError('Erro de comunicação com o banco Protheus')
    } finally {
      setAskLoading(false)
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
        body: JSON.stringify({ user: dbCreds.user, password: dbCreds.password }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao rodar a análise'); return }
      setAchados(json.achados as Achado[])
      setResumo(json.resumo || {})
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

  return (
    <div className="p-8 max-w-[72rem]">
      <div className="mb-6">
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

      <div className="mb-6 flex items-center gap-1 border-b border-outline-variant">
        {(['analise', 'pergunte'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-primary text-on-surface' : 'border-transparent text-outline hover:text-on-surface-variant'
            }`}
          >
            {t === 'analise' ? '🧠 Análise completa' : '💬 Pergunte à IA'}
          </button>
        ))}
      </div>

      {tab === 'pergunte' && (
        <div className="flex flex-col gap-5">
          <div className="bg-surface-container border border-outline-variant rounded-lg px-5 py-4">
            <p className="text-sm text-on-surface-variant leading-relaxed">
              IA interna (sem chamada a nenhum serviço externo): escolha um equipamento/grupo/código e/ou uma
              regra abaixo (recomendado — sem ambiguidade nenhuma) ou digite uma pergunta em texto livre (atalho
              heurístico, pode não reconhecer toda forma de perguntar). Ela roda de verdade a(s) regra(s)
              correspondente(s) do motor acima e responde só com o que encontrou — nunca inventa um achado. Ver{' '}
              <span className="font-mono">specs/contexto-negocio-inteligencia-produto.md</span> pra o mapa completo.
            </p>
          </div>

          {dbCreds ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 bg-surface-container border border-outline-variant rounded-lg px-4 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-on-surface">O que você quer verificar?</span>
                  {filtroAtivo && (
                    <button onClick={limparFiltro} className="text-xs text-outline hover:text-error transition-colors">
                      ✕ Limpar
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-outline mb-1">Equipamento</label>
                    <select
                      value={filtroEquipamento}
                      onChange={e => setFiltroEquipamento(e.target.value)}
                      className="w-full px-2.5 py-2 text-sm bg-surface border border-outline-variant rounded text-on-surface"
                    >
                      <option value="">— Todos —</option>
                      {equipamentosList.map(eq => (
                        <option key={eq.legacy_id} value={String(eq.legacy_id)}>
                          {eq.legacy_id} — {eq.commercial_name || eq.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-outline mb-1">Grupo</label>
                    <select
                      value={filtroGrupo}
                      onChange={e => setFiltroGrupo(e.target.value)}
                      className="w-full px-2.5 py-2 text-sm bg-surface border border-outline-variant rounded text-on-surface"
                    >
                      <option value="">— Todos —</option>
                      {gruposList.map(g => (
                        <option key={g.legacy_id} value={String(g.legacy_id)}>{g.legacy_id} — {g.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-outline mb-1">Código Protheus</label>
                    <input
                      value={filtroCodigo}
                      onChange={e => setFiltroCodigo(e.target.value)}
                      placeholder="ex.: 27.11.01234"
                      className="w-full px-2.5 py-2 text-sm bg-surface border border-outline-variant rounded text-on-surface font-mono"
                    />
                  </div>
                </div>

                <div className="pt-1 border-t border-outline-variant/60">
                  {!mostrarRegras ? (
                    <button
                      onClick={() => setMostrarRegras(true)}
                      className="text-xs text-outline hover:text-on-surface-variant transition-colors mt-2"
                    >
                      Por padrão verifica tudo (14 regras) · escolher regras específicas ▾
                    </button>
                  ) : (
                    <div className="mt-2 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-outline">
                          {filtroRegras.size === 0 ? 'Verificando todas as 14 regras' : `${filtroRegras.size} regra(s) selecionada(s)`}
                        </span>
                        <button
                          onClick={() => { setFiltroRegras(new Set()); setMostrarRegras(false) }}
                          className="text-xs text-outline hover:text-on-surface-variant transition-colors"
                        >
                          ▴ recolher
                        </button>
                      </div>
                      <div className="flex flex-col gap-2">
                        {Object.entries(REGRAS_POR_CATEGORIA).map(([categoria, regras]) => (
                          <div key={categoria} className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-on-surface-variant w-[110px] shrink-0">{categoria}</span>
                            {regras.map(r => {
                              const ativo = filtroRegras.has(r.codigo)
                              return (
                                <button
                                  key={r.codigo}
                                  type="button"
                                  title={r.label}
                                  onClick={() => toggleFiltroRegra(r.codigo)}
                                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                                    ativo
                                      ? 'bg-primary text-on-primary border-primary'
                                      : 'bg-surface border-outline-variant text-on-surface-variant hover:border-outline'
                                  }`}
                                >
                                  {r.codigo}
                                </button>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[11px] text-outline">
                  Ou pergunta em texto livre {filtroAtivo && '(ignorado enquanto o filtro estruturado acima estiver preenchido)'}
                </label>
                <textarea
                  value={pergunta}
                  onChange={e => setPergunta(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !askLoading) { e.preventDefault(); runAsk() } }}
                  disabled={filtroAtivo}
                  placeholder='Ex.: "o equipamento 30 tem algum item bloqueado?", "27.11.01234 tem duplicidade?"'
                  rows={2}
                  className="w-full px-3 py-2.5 text-sm bg-surface-container border border-outline-variant rounded-lg text-on-surface resize-none disabled:opacity-40"
                />
              </div>

              <div>
                <button
                  onClick={runAsk}
                  disabled={askLoading || (!filtroAtivo && !pergunta.trim())}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:shadow-neon transition-all disabled:opacity-50"
                >
                  {askLoading ? 'Consultando…' : 'Perguntar'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-outline">Conecte ao Protheus (barra lateral) para perguntar.</p>
          )}

          {askError && (
            <div className="bg-error-container/20 border border-error/30 text-error rounded-lg px-4 py-3 text-sm">
              ⚠ {askError}
            </div>
          )}

          {askResposta && (
            <div className="flex flex-col gap-4">
              <div className="bg-surface-container border border-outline-variant rounded-lg px-5 py-4">
                <p className="text-sm text-on-surface leading-relaxed">{askResposta}</p>
                {askParsed?.reconhecida && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {askRegras.map(r => (
                      <span key={r} className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/10 text-on-surface-variant">{r}</span>
                    ))}
                  </div>
                )}
              </div>
              {askAchados && askAchados.length > 0 && (
                <div className="flex flex-col gap-2">
                  {askAchados.map((a, i) => <AchadoCard key={`${a.regra}-${i}`} achado={a} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'analise' && (<>
      <div className="mb-6 flex items-center gap-3 flex-wrap">
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
            Carregando o cadastro e a estrutura do Protheus (pode levar 1–2 min na primeira vez) e cruzando com as 9 tabelas de engenharia…
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-error-container/20 border border-error/30 text-error rounded-lg px-4 py-3 text-sm">
          ⚠ {error}
        </div>
      )}

      {achados && (
        <div className="flex flex-col gap-5">
          <div className="bg-surface-container border border-outline-variant rounded-lg px-5 py-4">
            <p className="text-sm text-on-surface leading-relaxed">{buildNarrativeSummary(achados, resumo)}</p>
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
      </>)}
    </div>
  )
}
