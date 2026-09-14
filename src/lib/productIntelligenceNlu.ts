import type { Achado, ProductIntelligenceContext } from './productIntelligence'

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
const EQUIPMENT_WORD_RE = /equipamentos?\s*(?:n[ºo°]?\.?\s*)?(\d{1,6})/gi
const GROUP_WORD_RE = /grupos?\s*(?:n[ºo°]?\.?\s*)?(\d{1,6})/gi
// "ID"/"Nº" explícito é mais confiável que só o número depois de
// "equipamento"/"grupo" — um número solto logo depois dessas palavras pode
// ser parte do nome/código comercial do produto, não o legacy_id de
// verdade (achado real: "EQUIPAMENTO 6040 SV ID 12" — 6040 é o nome
// comercial, 12 é o legacy_id; sem essa distinção o parser filtrava pelo
// número errado e devolvia "nenhum achado" — falsa sensação de "coerente"
// quando na verdade nada foi checado pro equipamento certo).
const ID_RE = /\bid\s*(?:n[ºo°]?\.?\s*)?[:.]?\s*(\d{1,6})\b/gi

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

type Row = Record<string, unknown>
const norm = (v: unknown) => String(v ?? '').trim()

interface KeywordRule { palavras: string[]; regras: string[] }

// Palavras sempre em minúsculo e sem acento (o texto da pergunta é
// normalizado do mesmo jeito antes de comparar) — uma pergunta pode bater
// em mais de uma linha (ex.: "duplicidade e incompatibilidade").
const KEYWORD_RULES: KeywordRule[] = [
  { palavras: ['nao existe no protheus', 'inexistente no protheus', 'nao cadastrado no protheus', 'nao cadastrad', 'nao esta cadastrad', 'nao estao cadastrad'], regras: ['R001'] },
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

  const idMatches = Array.from(new Set(Array.from(text.matchAll(ID_RE)).map(m => m[1])))
  const equipWordMatches = Array.from(new Set(Array.from(text.matchAll(EQUIPMENT_WORD_RE)).map(m => m[1])))
  const groupWordMatches = Array.from(new Set(Array.from(text.matchAll(GROUP_WORD_RE)).map(m => m[1])))
  const mencionaEquipamento = /equipamento/i.test(text)
  const mencionaGrupo = /\bgrupo/i.test(text)

  // "ID N" explícito vence o número solto perto de "equipamento"/"grupo"
  // quando a pergunta cita esse assunto — mesmo ID não dá pra usar pros
  // dois ao mesmo tempo (ambiguidade real, não resolvida: heurística, não
  // parser perfeito), então só reaproveita o ID pro que foi mencionado.
  const equipamentos = mencionaEquipamento && idMatches.length > 0 ? idMatches : equipWordMatches
  const grupos = mencionaGrupo && idMatches.length > 0 && !mencionaEquipamento ? idMatches : groupWordMatches

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
//
// Alguns campos guardam mais de um valor separado por vírgula (ex.:
// R080.chave.equipamentosRelacionados — um par de códigos pode estar
// associado a mais de um equipamento) — cada parte é checada
// separadamente, não só a string inteira.
export function filterAchadosByEntities(achados: Achado[], parsed: ParsedProductQuestion): Achado[] {
  const wantAny = parsed.codigos.length > 0 || parsed.equipamentos.length > 0 || parsed.grupos.length > 0
  if (!wantAny) return achados
  const codigosSet = new Set(parsed.codigos)
  const equipSet = new Set(parsed.equipamentos)
  const grupoSet = new Set(parsed.grupos)
  const bate = (s: string) => !!s && (codigosSet.has(s.toUpperCase()) || equipSet.has(s) || grupoSet.has(s))
  return achados.filter(a =>
    Object.values(a.chave).some(v => {
      const s = String(v ?? '').trim()
      if (!s) return false
      if (bate(s)) return true
      return s.includes(',') && s.split(',').some(part => bate(part.trim()))
    })
  )
}

export interface UnknownEntities {
  codigos: string[]
  equipamentos: string[]
  grupos: string[]
}

// "Zero achado" pode significar duas coisas bem diferentes: "conferi e está
// tudo certo" ou "o identificador citado nem existe em lugar nenhum — não
// tinha o que conferir". Sem essa distinção a IA pode responder "coerente"
// sobre um equipamento/grupo/código que ela nunca checou de verdade (achado
// real: confundir o legacy_id com outro número do nome do equipamento).
// Checa contra a fonte de verdade de cada tipo — não só a tabela "dona"
// (equipments.legacy_id, accessory_groups.legacy_id), mas também toda
// coluna de referência nas outras 8 tabelas e o cadastro Protheus, porque
// um código pode estar em uso na engenharia sem existir no Protheus (isso
// é literalmente o que R001 detecta) e ainda assim não deve ser tratado
// como "desconhecido" — só é desconhecido se não aparecer em lugar nenhum.
export function findUnknownEntities(ctx: ProductIntelligenceContext, parsed: ParsedProductQuestion): UnknownEntities {
  const t = ctx.tables

  const equipIds = new Set<string>()
  for (const r of t.equipments) { const v = norm((r as Row).legacy_id); if (v) equipIds.add(v) }
  for (const tabela of [t.relationship_equip_accessory, t.non_combinable_comps, t.roller_tables, t.standard_equipment_items, t.dependant_items]) {
    for (const r of tabela) { const v = norm((r as Row).legacy_equipment_id); if (v) equipIds.add(v) }
  }

  const groupIds = new Set<string>()
  for (const r of t.accessory_groups) { const v = norm((r as Row).legacy_id); if (v) groupIds.add(v) }
  for (const r of t.accessories) { const v = norm((r as Row).legacy_group_id); if (v) groupIds.add(v) }
  for (const r of t.non_combinable_comps) {
    const g1 = norm((r as Row).legacy_group_id); if (g1) groupIds.add(g1)
    const g2 = norm((r as Row).legacy_second_group_id); if (g2) groupIds.add(g2)
  }

  const codeIds = new Set<string>(Array.from(ctx.protheusInfo.keys()))
  const codeCols: [Row[], string[]][] = [
    [t.accessories as Row[], ['protheus_code']],
    [t.relationship_equip_accessory as Row[], ['protheus_code']],
    [t.non_combinable_comps as Row[], ['protheus_code', 'remove_list_code']],
    [t.roller_tables as Row[], ['protheus_code']],
    [t.standard_equipment_items as Row[], ['protheus_code']],
    [t.dependant_items as Row[], ['protheus_code', 'protheus_item_code']],
  ]
  for (const [rows, cols] of codeCols) for (const r of rows) for (const c of cols) { const v = norm(r[c]).toUpperCase(); if (v) codeIds.add(v) }

  return {
    codigos: parsed.codigos.filter(c => !codeIds.has(c)),
    equipamentos: parsed.equipamentos.filter(e => !equipIds.has(e)),
    grupos: parsed.grupos.filter(g => !groupIds.has(g)),
  }
}

export function buildAskAnswer(
  parsed: ParsedProductQuestion, achados: Achado[], regrasRodadas: string[], unknown?: UnknownEntities,
): string {
  if (!parsed.reconhecida) {
    return 'Não consegui identificar um código Protheus, número de equipamento/grupo ou um assunto conhecido nessa pergunta. ' +
      'Tente citar um código (ex.: 27.11.01234), "equipamento 30", "grupo 22", ou palavras como bloqueado, duplicidade, ' +
      'incompatibilidade, dependência, embalagem, faltando, família, "sempre saem juntos" ou série/especificação.'
  }

  const avisos: string[] = []
  if (unknown?.codigos.length) avisos.push(`código(s) ${unknown.codigos.join(', ')}`)
  if (unknown?.equipamentos.length) avisos.push(`equipamento(s) ${unknown.equipamentos.join(', ')} (legacy_id)`)
  if (unknown?.grupos.length) avisos.push(`grupo(s) ${unknown.grupos.join(', ')} (legacy_id)`)
  const avisoTxt = avisos.length
    ? `⚠ Não encontrei ${avisos.join(', ')} em nenhuma das 9 tabelas de engenharia nem no cadastro Protheus — confira o número/código (pode ser outro identificador, não o legacy_id, ou um número que faz parte do nome do equipamento, não o ID). `
    : ''

  const totalCitado = parsed.codigos.length + parsed.equipamentos.length + parsed.grupos.length
  const totalDesconhecido = (unknown?.codigos.length ?? 0) + (unknown?.equipamentos.length ?? 0) + (unknown?.grupos.length ?? 0)
  if (totalCitado > 0 && totalDesconhecido === totalCitado) {
    return `${avisoTxt}Não rodei a checagem de verdade contra nenhum registro: nenhum identificador citado existe no sistema. ` +
      'Isso NÃO significa "coerente" — significa que não havia o que conferir com esse número.'
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
    return `${avisoTxt}Rodei ${regrasTxt}${escopoTxt} contra o cadastro/estrutura ao vivo do Protheus e não encontrei nenhum achado — nada pendente nesse recorte.`
  }
  return `${avisoTxt}Rodei ${regrasTxt}${escopoTxt} contra o cadastro/estrutura ao vivo do Protheus e encontrei ${achados.length} achado${achados.length !== 1 ? 's' : ''} — veja abaixo.`
}
