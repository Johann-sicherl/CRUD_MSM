import type { Achado } from './productIntelligence'

// "IA" interna da Camada B — decisão explícita do usuário: sem chamada real
// a nenhum LLM (nem Anthropic, nem OpenAI, nem outro), nunca. Isto é um
// parser heurístico de pergunta em português (mesmo espírito de
// solicComercialParser.ts — sem gramática formal, sem tentar reconhecer
// 100% das formas de perguntar) que decide QUAIS das 14 regras já
// implementadas (productIntelligence.ts) rodar de verdade, e sobre qual
// código/equipamento/grupo filtrar o resultado — nunca inventa achado: só
// traduz a pergunta pra um recorte do motor de regras determinístico e
// devolve exatamente o que ele calculou (a "regra de ouro" documentada em
// specs/contexto-negocio-inteligencia-produto.md).

const CODE_RE = /\b\d{2}\.\d{2}\.\d{4,6}(?:\.\d{2})?\b/g
const EQUIPMENT_RE = /equipamentos?\s*(?:n[ºo°]?\.?\s*)?(\d{1,6})/gi
const GROUP_RE = /grupos?\s*(?:n[ºo°]?\.?\s*)?(\d{1,6})/gi

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

interface KeywordRule { palavras: string[]; regras: string[] }

// Palavras sempre em minúsculo e sem acento (o texto da pergunta é
// normalizado do mesmo jeito antes de comparar) — uma pergunta pode bater
// em mais de uma linha (ex.: "duplicidade e incompatibilidade").
const KEYWORD_RULES: KeywordRule[] = [
  { palavras: ['nao existe no protheus', 'inexistente no protheus', 'nao cadastrado no protheus'], regras: ['R001'] },
  { palavras: ['orfao', 'sem equipamento cadastrado', 'equipamento inexistente'], regras: ['R002'] },
  { palavras: ['grupo inexistente', 'grupo invalido'], regras: ['R003'] },
  { palavras: ['alerta orfao', 'alerta inexistente'], regras: ['R070'] },
  { palavras: ['bloquead', 'bloqueio'], regras: ['R010', 'R011'] },
  { palavras: ['revisao'], regras: ['R012'] },
  { palavras: ['duplic', 'repetid'], regras: ['R020', 'R021'] },
  { palavras: ['depende', 'dependencia', 'dependente', 'entra junto', 'entra sozinho', 'obrigatorio'], regras: ['R030', 'R031', 'R081'] },
  { palavras: ['embalagem'], regras: ['R081'] },
  { palavras: ['incompat', 'exclui', 'nao pode ir junto', 'nao combina', 'combinacao'], regras: ['R040', 'R041'] },
  { palavras: ['faltando', 'incompleto', 'sem cadastro', 'nunca ofertado', 'sem nenhuma configuracao'], regras: ['R050', 'R051', 'R052'] },
  { palavras: ['familia', 'analogia', 'irmao', 'parecido com'], regras: ['R060'] },
  { palavras: ['sempre sai junto', 'sempre saem juntos', 'sempre vem junto', 'coincidencia', 'co-ocorrencia', 'cooc'], regras: ['R080'] },
  { palavras: ['serie', 'item de serie', 'especificacao tecnica', 'parametros de estrutura', 'processador', 'memoria'], regras: ['R090'] },
]

export interface ParsedProductQuestion {
  codigos: string[]
  equipamentos: string[]
  grupos: string[]
  regras: string[]
  reconhecida: boolean
}

export function parseProductQuestion(raw: string): ParsedProductQuestion {
  const text = raw || ''
  const codigos = Array.from(new Set(Array.from(text.matchAll(CODE_RE)).map(m => m[0].toUpperCase())))
  const equipamentos = Array.from(new Set(Array.from(text.matchAll(EQUIPMENT_RE)).map(m => m[1])))
  const grupos = Array.from(new Set(Array.from(text.matchAll(GROUP_RE)).map(m => m[1])))

  const t = stripAccents(text.toLowerCase())
  const regrasSet = new Set<string>()
  for (const kw of KEYWORD_RULES) {
    if (kw.palavras.some(p => t.includes(p))) for (const r of kw.regras) regrasSet.add(r)
  }
  const regras = Array.from(regrasSet)

  return {
    codigos, equipamentos, grupos, regras,
    reconhecida: codigos.length > 0 || equipamentos.length > 0 || grupos.length > 0 || regras.length > 0,
  }
}

// Filtra achados já calculados pelo motor de regras pelas entidades citadas
// na pergunta (código Protheus, equipamento, grupo) — olha em qualquer
// campo de achado.chave (codigo/codigoA/codigoB/equipamento/grupo/...),
// porque cada regra nomeia a própria chave diferente. Sem filtro nenhum
// citado (só regra, ou nada), devolve tudo sem recortar.
export function filterAchadosByEntities(achados: Achado[], parsed: ParsedProductQuestion): Achado[] {
  const wantAny = parsed.codigos.length > 0 || parsed.equipamentos.length > 0 || parsed.grupos.length > 0
  if (!wantAny) return achados
  const codigosSet = new Set(parsed.codigos)
  const equipSet = new Set(parsed.equipamentos)
  const grupoSet = new Set(parsed.grupos)
  return achados.filter(a =>
    Object.values(a.chave).some(v => {
      const s = String(v ?? '').trim()
      if (!s) return false
      return codigosSet.has(s.toUpperCase()) || equipSet.has(s) || grupoSet.has(s)
    })
  )
}

export function buildAskAnswer(parsed: ParsedProductQuestion, achados: Achado[], regrasRodadas: string[]): string {
  if (!parsed.reconhecida) {
    return 'Não consegui identificar um código Protheus, número de equipamento/grupo ou um assunto conhecido nessa pergunta. ' +
      'Tente citar um código (ex.: 27.11.01234), "equipamento 30", "grupo 22", ou palavras como bloqueado, duplicidade, ' +
      'incompatibilidade, dependência, embalagem, faltando, família, "sempre saem juntos" ou série/especificação.'
  }

  const escopo: string[] = []
  if (parsed.codigos.length) escopo.push(`código(s) ${parsed.codigos.join(', ')}`)
  if (parsed.equipamentos.length) escopo.push(`equipamento(s) ${parsed.equipamentos.join(', ')}`)
  if (parsed.grupos.length) escopo.push(`grupo(s) ${parsed.grupos.join(', ')}`)
  const escopoTxt = escopo.length ? ` para ${escopo.join(' e ')}` : ''

  const regrasTxt = parsed.regras.length > 0
    ? `a${regrasRodadas.length > 1 ? 's' : ''} regra${regrasRodadas.length > 1 ? 's' : ''} ${regrasRodadas.join(', ')}`
    : 'todas as 14 regras (nenhum assunto específico identificado na pergunta)'

  if (achados.length === 0) {
    return `Rodei ${regrasTxt}${escopoTxt} e não encontrei nenhum achado — nada pendente nesse recorte.`
  }
  return `Rodei ${regrasTxt}${escopoTxt} e encontrei ${achados.length} achado${achados.length !== 1 ? 's' : ''} — veja abaixo.`
}
